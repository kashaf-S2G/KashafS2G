import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BankEntry = {
  id: string;
  kind: "term" | "category";
  term: string;
  source: string;
  hits: number;
  lastSearchedAt: string | null;
  removedAt: string | null;
};

export type BankOverview = {
  terms: BankEntry[];
  categories: BankEntry[];
  productsCount: number;
};


/** بنك المصطلحات والفئات النشط. */
export const getBank = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BankOverview> => {
    const { supabase, userId } = context;
    const { termKey } = await import("@/lib/discovery.server");

    const [{ data: rows }, { data: ads }] = await Promise.all([
      supabase
        .from("discovery_terms")
        .select("id, kind, term, source, hits, last_searched_at, removed_at")
        .eq("owner_id", userId)
        .eq("status", "active")
        .order("term"),
      supabase.from("ads").select("product_name").eq("owner_id", userId).limit(2000),
    ]);

    const map = (list: typeof rows) =>
      (list ?? []).map((r) => ({
        id: r.id as string,
        kind: r.kind as "term" | "category",
        term: r.term as string,
        source: r.source as string,
        hits: (r.hits as number) ?? 0,
        lastSearchedAt: (r.last_searched_at as string | null) ?? null,
        removedAt: (r.removed_at as string | null) ?? null,
      }));
    const all = map(rows);

    return {
      terms: all.filter((t) => t.kind === "term"),
      categories: all.filter((t) => t.kind === "category"),
      productsCount: new Set((ads ?? []).map((a) => termKey(String(a.product_name ?? ""))).filter(Boolean)).size,
    };
  });

/** إضافة مصطلح أو فئة صفحات يدويًا. */
export const addBankEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { kind: "term" | "category"; term: string }) => {
    const term = input.term.trim().replace(/\s+/g, " ");
    if (!term) throw new Error("اكتب المصطلح أو الفئة أولًا.");
    if (term.length > 80) throw new Error("النص طويل جدًا.");
    if (input.kind !== "term" && input.kind !== "category") throw new Error("نوع غير صحيح.");
    return { kind: input.kind, term };
  })
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { termKey } = await import("@/lib/discovery.server");
    const key = termKey(data.term);
    if (!key) throw new Error("نص غير صالح.");

    const { data: existing } = await supabase
      .from("discovery_terms")
      .select("id, status")
      .eq("owner_id", userId)
      .eq("kind", data.kind)
      .eq("term_key", key)
      .maybeSingle();

    if (existing) {
      // منع التكرار: نُعيد تنشيط السجل الموجود بدل إنشاء سجل جديد.
      const { error } = await supabase
        .from("discovery_terms")
        .update({ status: "active", term: data.term, source: "manual", removed_at: null })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    const { error } = await supabase.from("discovery_terms").insert({
      owner_id: userId,
      kind: data.kind,
      term: data.term,
      term_key: key,
      source: "manual",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** حذف مصطلح أو فئة: يُستبعد نهائيًا ولا يعود عند تحديث البنك. */
export const deleteBankEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    // حذف ناعم: نحفظ السجل بحالة "removed" كقائمة استبعاد دائمة
    // حتى لا يُعيد بناء البنك التلقائي إضافته مرة أخرى.
    const { error } = await context.supabase
      .from("discovery_terms")
      .update({ status: "removed", source: "manual", removed_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** قائمة المحذوفات من البنك (مصطلحات وفئات) — لا تعود إلا يدويًا. */
export const listRemovedBankEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BankEntry[]> => {
    const { data, error } = await context.supabase
      .from("discovery_terms")
      .select("id, kind, term, source, hits, last_searched_at, removed_at")
      .eq("owner_id", context.userId)
      .eq("status", "removed")
      .order("removed_at", { ascending: false, nullsFirst: false })
      .order("term");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      kind: r.kind as "term" | "category",
      term: r.term as string,
      source: r.source as string,
      hits: (r.hits as number) ?? 0,
      lastSearchedAt: (r.last_searched_at as string | null) ?? null,
      removedAt: (r.removed_at as string | null) ?? null,
    }));
  });

/** بحث ذكي بالمعنى داخل عناصر بنك المصطلحات/الفئات. */
export const searchBankEntriesAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { query?: unknown; entries?: unknown }) => {
    const query = String(input?.query ?? "").trim();
    if (!query) throw new Error("اكتب ما تبحث عنه أولًا.");
    if (query.length > 200) throw new Error("نص البحث طويل جدًا.");
    const raw = Array.isArray(input?.entries) ? input.entries : [];
    const entries = raw
      .filter(
        (e): e is { id: string; term: string } =>
          !!e && typeof (e as { id?: unknown }).id === "string" && typeof (e as { term?: unknown }).term === "string",
      )
      .slice(0, 600);
    return { query, entries };
  })
  .handler(async ({ data, context }): Promise<string[]> => {
    const { aiMatchBankEntries } = await import("@/lib/discovery.server");
    return await aiMatchBankEntries(await (await import("@/lib/ai-endpoint.server")).aiApiKey(), data.query, data.entries, context.userId);
  });

/** استرجاع مصطلح أو فئة من المحذوفات. */
export const restoreBankEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("discovery_terms")
      .update({ status: "active", removed_at: null })
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


/** بناء البنك تلقائيًا من قاعدة المنتجات (إن كانت كافية). */
export const buildBank = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { buildTermBank } = await import("@/lib/discovery.server");
    return await buildTermBank(context.supabase, context.userId, await (await import("@/lib/ai-endpoint.server")).aiApiKey());
  });

export type BankStep = { productsCount: number; added: number; ids: string[]; remaining: boolean };

/** خطوة فئات البنك — أول خطوة في تحديث البنك المرن. */
export const bankStepCategoriesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BankStep> => {
    const { bankStepCategories } = await import("@/lib/discovery.server");
    return await bankStepCategories(
      context.supabase,
      context.userId,
      await (await import("@/lib/ai-endpoint.server")).aiApiKey(),
    );
  });

/** خطوة مصطلحات واحدة (دفعة صغيرة) حتى يمكن الإيقاف بين الدفعات. */
export const bankStepTermsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BankStep> => {
    const { bankStepTerms } = await import("@/lib/discovery.server");
    return await bankStepTerms(context.supabase, context.userId);
  });

/** تراجع عن عناصر أُضيفت في جولة تحديث أُلغيت. */
export const undoBankEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ids?: unknown }) => {
    const raw = Array.isArray(input?.ids) ? input.ids : [];
    return { ids: raw.filter((x): x is string => typeof x === "string").slice(0, 1000) };
  })
  .handler(async ({ context, data }): Promise<{ deleted: number }> => {
    if (data.ids.length === 0) return { deleted: 0 };
    const { error } = await context.supabase
      .from("discovery_terms")
      .delete()
      .eq("owner_id", context.userId)
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    return { deleted: data.ids.length };
  });

