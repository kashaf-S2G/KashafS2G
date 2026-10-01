/**
 * دوال الخادم لمنظومة زحف المنتجات (الإعلان هو وحدة البحث الأساسية).
 * الواجهة تستدعي هذه الدوال فقط، والمحرك يبقى في ملف الخادم.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PcrawlKeyRow, PcrawlMatchRow, PcrawlOverview, PcrawlProgress } from "@/lib/pcrawl.types";

type Scope = "selected" | "general" | "scheduled";

/** يبدأ دورة زحف جديدة (أو يُكمل الدورة الجارية) ويُرجع أول تقدّم. */
export const startPcrawl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { scope?: unknown; selectedIds?: unknown } | undefined) => {
    const raw = String((input ?? {}).scope ?? "general");
    const scope: Scope = raw === "selected" || raw === "scheduled" ? raw : "general";
    const list = Array.isArray((input ?? {}).selectedIds) ? ((input as { selectedIds: unknown[] }).selectedIds) : [];
    const selectedIds = [
      ...new Set(list.filter((x): x is string => typeof x === "string" && x.length > 0)),
    ].slice(0, 100);
    if (scope === "selected" && selectedIds.length === 0) throw new Error("حدّد منتجًا واحدًا على الأقل.");
    return { scope, selectedIds };
  })
  .handler(async ({ context, data }): Promise<PcrawlProgress> => {
    const { supabase, userId } = context;
    const { pcrawlStep, pickTargetProducts } = await import("@/lib/pcrawl.server");

    await supabase
      .from("pcrawl_state")
      .upsert(
        { owner_id: userId, status: "active", paused_reason: null, last_run_at: new Date().toISOString() },
        { onConflict: "owner_id" },
      );

    const { data: runId, error } = await supabase.rpc("acquire_pcrawl_run", {
      _owner_id: userId,
      _trigger_type: "manual",
      _scope: data.scope,
    });
    if (error) throw new Error(error.message);

    let id = (runId as string | null) ?? null;
    if (!id) {
      // تشغيل جارٍ: نُكمل من حيث توقف بدل بدء دورة جديدة.
      const { data: live } = await supabase
        .from("pcrawl_runs")
        .select("id")
        .eq("owner_id", userId)
        .eq("status", "running")
        .order("started_at", { ascending: false })
        .limit(1);
      id = (live?.[0]?.id as string | undefined) ?? null;
      if (!id) throw new Error("تعذّر بدء الزحف، حاول مرة أخرى.");
      return await pcrawlStep(supabase, userId, id);
    }

    const ids = await pickTargetProducts(supabase, userId, data.scope, data.selectedIds.length ? data.selectedIds : null);
    await supabase.from("pcrawl_runs").update({ product_ids: ids }).eq("id", id);
    return await pcrawlStep(supabase, userId, id);
  });

/** خطوة واحدة محدودة من الزحف؛ التقدّم محفوظ دائمًا. */
export const pcrawlStepFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { runId: string }) => {
    if (!input?.runId) throw new Error("لا يوجد تشغيل جارٍ.");
    return { runId: input.runId };
  })
  .handler(async ({ context, data }): Promise<PcrawlProgress> => {
    const { pcrawlStep } = await import("@/lib/pcrawl.server");
    return await pcrawlStep(context.supabase, context.userId, data.runId);
  });

/** إنهاء التشغيل الحالي مع حفظ التقدّم ليُستكمل لاحقًا. */
export const stopPcrawl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { runId: string }) => ({ runId: String(input?.runId ?? "") }))
  .handler(async ({ context, data }): Promise<PcrawlProgress> => {
    const { finishPcrawlRun } = await import("@/lib/pcrawl.server");
    return await finishPcrawlRun(context.supabase, context.userId, data.runId, "done");
  });

/** استئناف الزحف بعد إيقاف مؤقت (نفاد رصيد الذكاء الاصطناعي مثلًا). */
export const resumePcrawl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("pcrawl_state")
      .upsert(
        { owner_id: context.userId, status: "active", paused_reason: null, paused_at: null },
        { onConflict: "owner_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** حالة المنظومة كما تعرضها الواجهة. */
export const pcrawlOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PcrawlOverview> => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();

    const [{ data: state }, { data: runs }] = await Promise.all([
      supabase.from("pcrawl_state").select("status, paused_reason, last_run_at").eq("owner_id", userId).maybeSingle(),
      supabase
        .from("pcrawl_runs")
        .select(
          "id, status, scope, started_at, lease_expires_at, product_ids, keys_total, keys_done, matches",
        )
        .eq("owner_id", userId)
        .order("started_at", { ascending: false })
        .limit(1),
    ]);

    const run = runs?.[0];
    const running =
      run && run.status === "running" && (!run.lease_expires_at || (run.lease_expires_at as string) > nowIso)
        ? (run.id as string)
        : null;

    const [{ count: adsTotal }, { count: adsPending }, { count: matches }, { count: pagesPending }] =
      await Promise.all([
        supabase.from("pcrawl_ads").select("id", { count: "exact", head: true }).eq("owner_id", userId),
        supabase
          .from("pcrawl_ads")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", userId)
          .eq("status", "pending"),
        supabase
          .from("pcrawl_matches")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", userId)
          .eq("decision", "match"),
        supabase
          .from("discovered_competitors")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", userId)
          .eq("discovery_source", "product_ad")
          .eq("classification", "pending"),
      ]);

    return {
      status: (state?.status as string) ?? "active",
      pausedReason: state?.status === "paused" ? ((state.paused_reason as string | null) ?? null) : null,
      runningId: running,
      lastRunAt: (state?.last_run_at as string | null) ?? ((run?.started_at as string | null) ?? null),
      lastStatus: (run?.status as string | null) ?? null,
      scope: (run?.scope as string | null) ?? null,
      productsTotal: ((run?.product_ids as string[] | null) ?? []).length,
      keysTotal: (run?.keys_total as number) ?? 0,
      keysDone: (run?.keys_done as number) ?? 0,
      adsTotal: adsTotal ?? 0,
      adsPending: adsPending ?? 0,
      matches: matches ?? 0,
      pagesPending: pagesPending ?? 0,
    };
  });

/** مفاتيح البحث للدورة الحالية أو الأخيرة. */
export const listPcrawlKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { runId?: string } | undefined) => ({ runId: input?.runId ?? null }))
  .handler(async ({ context, data }): Promise<PcrawlKeyRow[]> => {
    const { supabase, userId } = context;
    let runId = data.runId;
    if (!runId) {
      const { data: runs } = await supabase
        .from("pcrawl_runs")
        .select("id")
        .eq("owner_id", userId)
        .order("started_at", { ascending: false })
        .limit(1);
      runId = (runs?.[0]?.id as string | undefined) ?? null;
    }
    if (!runId) return [];
    const { data: rows, error } = await supabase
      .from("pcrawl_keys")
      .select("id, key_text, kind, status, found, product_ids, searched_at")
      .eq("owner_id", userId)
      .eq("run_id", runId)
      .order("created_at", { ascending: true })
      .limit(300);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id as string,
      keyText: r.key_text as string,
      kind: r.kind as string,
      status: r.status as string,
      found: (r.found as number) ?? 0,
      productIds: (r.product_ids as string[] | null) ?? [],
      searchedAt: (r.searched_at as string | null) ?? null,
    }));
  });

/**
 * نتائج المطابقة: Product → Search Key → Ad → Page مع الدرجة والقرار والأسباب،
 * وحالة الصفحة الناتجة في مسار الموافقة.
 */
export const listPcrawlMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { decision?: string; productIds?: unknown } | undefined) => {
    const decision = input?.decision === "match" || input?.decision === "no_match" ? input.decision : null;
    const list = Array.isArray(input?.productIds) ? input.productIds : [];
    const productIds = [...new Set(list.filter((x): x is string => typeof x === "string" && x.length > 0))].slice(0, 100);
    return { decision, productIds };
  })
  .handler(async ({ context, data }): Promise<PcrawlMatchRow[]> => {
    const { supabase, userId } = context;
    let query = supabase
      .from("pcrawl_matches")
      .select(
        "id, ad_id, page_id, page_name, product_id, score, decision, reasons, differences, extracted_name, search_key, created_at, pcrawl_ad_id",
      )
      .eq("owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(300);
    if (data.decision) query = query.eq("decision", data.decision);
    if (data.productIds.length) query = query.in("product_id", data.productIds);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    const matches = rows ?? [];
    if (matches.length === 0) return [];

    const adIds = [...new Set(matches.map((m) => m.pcrawl_ad_id as string))];
    const productIds = [...new Set(matches.map((m) => m.product_id as string))];
    const pageIds = [...new Set(matches.map((m) => m.page_id as string | null).filter((x): x is string => !!x))];

    const [{ data: ads }, { data: products }, { data: pages }] = await Promise.all([
      supabase.from("pcrawl_ads").select("id, ad_text, image_url, source_url, page_url").in("id", adIds),
      supabase.from("products").select("id, canonical_name, code").eq("owner_id", userId).in("id", productIds),
      pageIds.length
        ? supabase
            .from("discovered_competitors")
            .select("id, source_competitor_id, classification")
            .eq("owner_id", userId)
            .eq("discovery_source", "product_ad")
            .in("source_competitor_id", pageIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ]);

    const adById = new Map((ads ?? []).map((a) => [a.id as string, a]));
    const productById = new Map((products ?? []).map((p) => [p.id as string, p]));
    const pageBySource = new Map((pages ?? []).map((p) => [p["source_competitor_id"] as string, p]));

    return matches.map((m) => {
      const ad = adById.get(m.pcrawl_ad_id as string);
      const product = productById.get(m.product_id as string);
      const page = m.page_id ? pageBySource.get(m.page_id as string) : undefined;
      return {
        id: m.id as string,
        adId: m.ad_id as string,
        adText: ((ad?.ad_text as string | undefined) ?? "").slice(0, 1200),
        adImageUrl: (ad?.image_url as string | null | undefined) ?? null,
        adSourceUrl: (ad?.source_url as string | null | undefined) ?? null,
        pageId: (m.page_id as string | null) ?? null,
        pageName: (m.page_name as string) ?? "",
        pageUrl: (ad?.page_url as string | undefined) ?? "",
        productId: m.product_id as string,
        productName: (product?.canonical_name as string | undefined) ?? "منتج محذوف",
        productCode: (product?.code as string | undefined) ?? "",
        score: Number(m.score ?? 0),
        decision: m.decision as string,
        reasons: (m.reasons as string[] | null) ?? [],
        differences: (m.differences as string[] | null) ?? [],
        extractedName: (m.extracted_name as string | null) ?? null,
        searchKey: (m.search_key as string | null) ?? null,
        createdAt: m.created_at as string,
        pageRowId: (page?.["id"] as string | undefined) ?? null,
        pageStatus: (page?.["classification"] as string | undefined) ?? null,
      } satisfies PcrawlMatchRow;
    });
  });

/** حذف نتائج المطابقة (عناصر محددة، أو كل قسم مطابق/غير مطابق). */
export const deletePcrawlMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ids?: unknown; decision?: unknown } | undefined) => {
    const list = Array.isArray(input?.ids) ? input.ids : [];
    const ids = [...new Set(list.filter((x): x is string => typeof x === "string" && x.length > 0))].slice(0, 500);
    const raw = String((input ?? {}).decision ?? "");
    const decision = raw === "match" || raw === "no_match" ? raw : null;
    if (!ids.length && !decision) throw new Error("لا يوجد ما يُحذف.");
    return { ids, decision };
  })
  .handler(async ({ context, data }): Promise<{ deleted: number }> => {
    const { supabase, userId } = context;
    let query = supabase.from("pcrawl_matches").delete({ count: "exact" }).eq("owner_id", userId);
    if (data.ids.length) query = query.in("id", data.ids);
    else if (data.decision) query = query.eq("decision", data.decision);
    const { error, count } = await query;
    if (error) throw new Error(error.message);
    return { deleted: count ?? 0 };
  });

/** حذف مفاتيح البحث (مفتاح محدد أو كل مفاتيح آخر دورة). */
export const deletePcrawlKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ids?: unknown; all?: unknown; runId?: unknown } | undefined) => {
    const list = Array.isArray(input?.ids) ? input.ids : [];
    const ids = [...new Set(list.filter((x): x is string => typeof x === "string" && x.length > 0))].slice(0, 500);
    const all = Boolean((input ?? {}).all);
    const runId = typeof (input ?? {}).runId === "string" ? ((input as { runId: string }).runId) : null;
    if (!ids.length && !all) throw new Error("لا يوجد ما يُحذف.");
    return { ids, all, runId };
  })
  .handler(async ({ context, data }): Promise<{ deleted: number }> => {
    const { supabase, userId } = context;
    let query = supabase.from("pcrawl_keys").delete({ count: "exact" }).eq("owner_id", userId);
    if (data.ids.length) {
      query = query.in("id", data.ids);
    } else {
      let runId = data.runId;
      if (!runId) {
        const { data: runs } = await supabase
          .from("pcrawl_runs")
          .select("id")
          .eq("owner_id", userId)
          .order("started_at", { ascending: false })
          .limit(1);
        runId = (runs?.[0]?.id as string | undefined) ?? null;
      }
      if (!runId) return { deleted: 0 };
      query = query.eq("run_id", runId);
    }
    const { error, count } = await query;
    if (error) throw new Error(error.message);
    const { data: last } = await supabase
      .from("pcrawl_runs")
      .select("id")
      .eq("owner_id", userId)
      .order("started_at", { ascending: false })
      .limit(1);
    const lastId = last?.[0]?.id as string | undefined;
    if (lastId) {
      const [{ count: total }, { count: done }] = await Promise.all([
        supabase.from("pcrawl_keys").select("id", { count: "exact", head: true }).eq("run_id", lastId),
        supabase.from("pcrawl_keys").select("id", { count: "exact", head: true }).eq("run_id", lastId).eq("status", "searched"),
      ]);
      await supabase.from("pcrawl_runs").update({ keys_total: total ?? 0, keys_done: done ?? 0 }).eq("id", lastId);
    }
    return { deleted: count ?? 0 };
  });

/** الموافقة على صفحة ناتجة عن زحف المنتجات: تُضاف كمنافس إن لم تكن موجودة. */
export const approveDiscoveredPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: unknown } | undefined) => {
    const id = typeof (input ?? {}).id === "string" ? ((input as { id: string }).id) : "";
    if (!id) throw new Error("معرّف الصفحة مطلوب.");
    return { id };
  })
  .handler(async ({ context, data }): Promise<{ duplicate: boolean }> => {
    const { supabase, userId } = context;
    const { data: page, error } = await supabase
      .from("discovered_competitors")
      .select("id, competitor_name, competitor_url, platform, category, source_competitor_id")
      .eq("owner_id", userId)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!page) throw new Error("الصفحة غير موجودة.");

    const sourcePageId = (page.source_competitor_id as string | null) ?? null;
    let duplicate = false;
    if (sourcePageId) {
      const { data: existing } = await supabase
        .from("competitors")
        .select("id")
        .eq("owner_id", userId)
        .eq("source_page_id", sourcePageId)
        .maybeSingle();
      duplicate = Boolean(existing);
    }

    if (!duplicate) {
      const { error: insertError } = await supabase.from("competitors").insert({
        owner_id: userId,
        competitor_name: (page.competitor_name as string) ?? "صفحة بدون اسم",
        competitor_url: (page.competitor_url as string) ?? "",
        platform: (page.platform as string) ?? "facebook",
        niche: (page.category as string | null) ?? "غير محدد",
        source_page_id: sourcePageId,
      });
      if (insertError) throw new Error(insertError.message);
    }

    const { error: updateError } = await supabase
      .from("discovered_competitors")
      .update({ classification: "approved", classified_at: new Date().toISOString() })
      .eq("owner_id", userId)
      .eq("id", data.id);
    if (updateError) throw new Error(updateError.message);

    return { duplicate };
  });

/** رفض صفحة ناتجة عن زحف المنتجات حتى لا تظهر مرة أخرى في المرشحين. */
export const rejectDiscoveredPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: unknown } | undefined) => {
    const id = typeof (input ?? {}).id === "string" ? ((input as { id: string }).id) : "";
    if (!id) throw new Error("معرّف الصفحة مطلوب.");
    return { id };
  })
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("discovered_competitors")
      .update({ classification: "rejected", classified_at: new Date().toISOString() })
      .eq("owner_id", userId)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
