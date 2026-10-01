/**
 * أوامر العمليات الخلفية من الواجهة: البدء يسجّل العملية على الخادم ويوقظ العامل،
 * والتحكم (إيقاف مؤقت / استئناف / اكتفاء / إلغاء) يُكتب في عمود control ويقرؤه العامل.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PcrawlPhase, PcrawlProgress } from "@/lib/pcrawl.types";
import type { CcrawlProgress } from "@/lib/ccrawl.types";
import { BUILD_INFO } from "@/lib/build-info";

export type JobKind = "products" | "bank" | "cats";
export type JobControlCmd = "none" | "pause" | "stop" | "cancel";

export type ServerJob = {
  id: string;
  kind: JobKind;
  status: string;
  control: string;
  startedAt: string;
  finishedAt: string | null;
  note: string | null;
  error: string | null;
  products?: PcrawlProgress;
  bank?: { phase: string; categories: number; terms: number };
  cats?: CcrawlProgress;
};

const TABLE = { products: "pcrawl_runs", bank: "bank_jobs", cats: "ccrawl_runs" } as const;
const PROJECT_ID = BUILD_INFO.lovableProjectId ?? "e024dabf-e234-45c0-bee2-855a3310c828";

function kindOf(v: unknown): JobKind {
  if (v === "products" || v === "bank" || v === "cats") return v;
  throw new Error("نوع عملية غير معروف.");
}

/** عنوان الموقع الذي يستدعيه الخادم لإيقاظ العامل (بدون جدار تسجيل الدخول للمعاينة). */
function workerOrigin(): string | null {
  try {
    const host = new URL(getRequest().url).host;
    if (
      host.includes("preview") ||
      host.endsWith("-dev.lovable.app") ||
      host.endsWith(".lovableproject.com")
    ) {
      return `https://project--${PROJECT_ID}-dev.lovable.app`;
    }
    if (host.startsWith("localhost")) return null;
    return `https://${host}`;
  } catch {
    return null;
  }
}

async function kick() {
  try {
    const { kickWorker } = await import("@/lib/job-worker.server");
    await kickWorker(workerOrigin());
  } catch (e) {
    console.error("[jobs] kick failed", e instanceof Error ? e.message : e);
  }
}

function pcPhase(r: any): PcrawlPhase {
  const total = ((r.product_ids as string[] | null) ?? []).length;
  if (r.status !== "running") return "done" as PcrawlPhase;
  if (r.control === "review") return "review" as PcrawlPhase;
  if (((r.profiles_built as number) ?? 0) < total) return "profiles" as PcrawlPhase;
  if (!r.keys_total) return "vocabulary" as PcrawlPhase;
  if (((r.keys_done as number) ?? 0) < (r.keys_total as number)) return "search" as PcrawlPhase;
  return "analysis" as PcrawlPhase;
}

/** آخر عملية من النوع المطلوب مع تقدّمها. */
export const getServerJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { kind: JobKind }) => ({ kind: kindOf(input?.kind) }))
  .handler(async ({ context, data }): Promise<ServerJob | null> => {
    const { supabase, userId } = context;
    const { data: rows } = await (supabase.from(TABLE[data.kind] as "pcrawl_runs") as any)
      .select("*")
      .eq("owner_id", userId)
      .order("started_at", { ascending: false })
      .limit(1);
    const r = rows?.[0] as any;
    if (!r) return null;
    // أصلح جولة منتجات وصل أمر إنهائها ولم يتمكن نداء العامل السابق من الوصول إليها.
    if (data.kind === "products" && r.status === "running" && (r.control === "stop" || r.control === "cancel")) {
      const note = r.control === "cancel" ? "أُلغيت الجولة." : "تم الاكتفاء بما أُنجز بناءً على طلبك.";
      const { finishPcrawlRun } = await import("@/lib/pcrawl.server");
      await finishPcrawlRun(supabase, userId, r.id, "done");
      await supabase.from("pcrawl_runs").update({ note }).eq("id", r.id).eq("owner_id", userId);
      r.status = "done";
      r.finished_at = new Date().toISOString();
      r.note = note;
    }
    const job: ServerJob = {
      id: r.id,
      kind: data.kind,
      status: r.status,
      control: r.control ?? "none",
      startedAt: r.started_at,
      finishedAt: r.finished_at ?? null,
      note: r.note ?? null,
      error: r.error ?? null,
    };
    if (data.kind === "products") {
      const { progressOf } = await import("@/lib/pcrawl.server");
      job.products = await progressOf(supabase, userId, r.id, pcPhase(r), null);
    } else if (data.kind === "cats") {
      const { ccrawlProgress } = await import("@/lib/ccrawl.server");
      job.cats = await ccrawlProgress(supabase, r);
    } else {
      job.bank = { phase: r.phase, categories: r.categories_added ?? 0, terms: r.terms_added ?? 0 };
    }
    return job;
  });

/** يبدأ عملية على الخادم ثم يعود فورًا. */
export const startServerJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { kind: JobKind; scope?: unknown; selectedIds?: unknown }) => {
    const ids = (v: unknown) =>
      Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0))].slice(0, 200) : [];
    return {
      kind: kindOf(input?.kind),
      scope: input?.scope === "selected" ? ("selected" as const) : ("general" as const),
      selectedIds: ids(input?.selectedIds).slice(0, 100),
    };
  })
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    const deadline = new Date(Date.now() + 100 * 365 * 24 * 3_600_000).toISOString();

    if (data.kind === "products") {
      if (data.scope === "selected" && data.selectedIds.length === 0) throw new Error("حدّد منتجًا واحدًا على الأقل.");
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
      if (!runId) {
        const { data: live } = await supabase
          .from("pcrawl_runs")
          .select("id")
          .eq("owner_id", userId)
          .eq("status", "running")
          .limit(1);
        if (!live?.[0]) throw new Error("تعذّر بدء الزحف، حاول مرة أخرى.");
        await kick();
        return { id: live[0].id as string };
      }
      const { pickTargetProducts } = await import("@/lib/pcrawl.server");
      const ids = await pickTargetProducts(supabase, userId, data.scope, data.selectedIds.length ? data.selectedIds : null);
      await supabase
        .from("pcrawl_runs")
        .update({ product_ids: ids, deadline_at: deadline, control: "none" })
        .eq("id", runId as string);
      await kick();
      return { id: runId as string };
    }

    if (data.kind === "cats") {
      const { data: live } = await supabase
        .from("ccrawl_runs")
        .select("id")
        .eq("owner_id", userId)
        .eq("status", "running")
        .limit(1);
      if (live?.[0]) {
        await kick();
        return { id: live[0].id as string };
      }
      if (data.scope === "selected" && data.selectedIds.length === 0) throw new Error("حدّد فئة واحدة على الأقل.");
      const { pickCategories } = await import("@/lib/ccrawl.server");
      const cats = await pickCategories(supabase, userId, data.scope === "selected" ? data.selectedIds : null);
      if (!cats.length) throw new Error("لا توجد فئات في البنك. أضف فئات أولًا.");
      const { data: row, error } = await supabase
        .from("ccrawl_runs")
        .insert({
          owner_id: userId,
          scope: data.scope,
          category_ids: cats.map((c) => c.id),
          categories: cats.map((c) => c.term),
          deadline_at: deadline,
        })
        .select("id")
        .single();
      if (error || !row) throw new Error(error?.message ?? "تعذّر بدء الزحف.");
      await kick();
      return { id: row.id };
    }

    const { data: live } = await supabase
      .from("bank_jobs")
      .select("id")
      .eq("owner_id", userId)
      .eq("status", "running")
      .limit(1);
    if (live?.[0]) {
      await kick();
      return { id: live[0].id as string };
    }
    const { data: row, error } = await supabase
      .from("bank_jobs")
      .insert({ owner_id: userId, deadline_at: deadline })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "تعذّر بدء التحديث.");
    await kick();
    return { id: row.id };
  });

/** يرسل أمر تحكم للعملية الجارية. */
export const controlServerJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { kind: JobKind; id: string; control: JobControlCmd }) => {
    const c = input?.control;
    return {
      kind: kindOf(input?.kind),
      id: String(input?.id ?? ""),
      control: (c === "pause" || c === "stop" || c === "cancel" ? c : "none") as JobControlCmd,
    };
  })
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { error } = await (context.supabase.from(TABLE[data.kind] as "pcrawl_runs") as any)
      .update({ control: data.control })
      .eq("id", data.id)
      .eq("owner_id", context.userId)
      .eq("status", "running");
    if (error) throw new Error(error.message);
    // إنهاء زحف المنتجات لا ينبغي أن يعتمد على وصول نداء خلفي آخر.
    if (data.kind === "products" && (data.control === "stop" || data.control === "cancel")) {
      const note = data.control === "cancel" ? "أُلغيت الجولة." : "تم الاكتفاء بما أُنجز بناءً على طلبك.";
      const { finishPcrawlRun } = await import("@/lib/pcrawl.server");
      await finishPcrawlRun(context.supabase, context.userId, data.id, "done");
      const { error: noteError } = await context.supabase
        .from("pcrawl_runs")
        .update({ note })
        .eq("id", data.id)
        .eq("owner_id", context.userId);
      if (noteError) throw new Error(noteError.message);
      return { ok: true };
    }
    if (data.control !== "pause") await kick();
    return { ok: true };
  });

async function recountKeys(supabase: any, runId: string) {
  const { count } = await supabase
    .from("pcrawl_keys")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId);
  const { count: done } = await supabase
    .from("pcrawl_keys")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("status", "searched");
  await supabase.from("pcrawl_runs").update({ keys_total: count ?? 0, keys_done: done ?? 0 }).eq("id", runId);
}

/** إضافة مفاتيح بحث يدوية إلى جولة المنتجات الجارية أثناء المراجعة. */
export const addPcrawlKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { runId: string; terms: unknown }) => {
    const list = Array.isArray(input?.terms) ? input.terms : [];
    const terms = [
      ...new Set(
        list
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.trim().replace(/\s+/g, " "))
          .filter((x) => x.length > 0 && x.length <= 120),
      ),
    ].slice(0, 50);
    if (!terms.length) throw new Error("اكتب مصطلحًا واحدًا على الأقل.");
    return { runId: String(input?.runId ?? ""), terms };
  })
  .handler(async ({ context, data }): Promise<{ added: number }> => {
    const { supabase, userId } = context;
    const { data: run } = await supabase
      .from("pcrawl_runs")
      .select("id, status, control, product_ids")
      .eq("id", data.runId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (!run || run.status !== "running" || run.control !== "review") {
      throw new Error("يمكن إضافة المفاتيح فقط أثناء مراجعة مفاتيح البحث.");
    }
    const keyOf = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
    const { data: existing } = await supabase.from("pcrawl_keys").select("key_key").eq("run_id", data.runId);
    const have = new Set((existing ?? []).map((e) => e.key_key as string));
    const insert = data.terms
      .filter((t) => !have.has(keyOf(t)))
      .map((t) => ({
        owner_id: userId,
        run_id: data.runId,
        key_text: t,
        key_key: keyOf(t),
        kind: "manual",
        product_ids: (run.product_ids as string[] | null) ?? [],
        status: "draft",
      }));
    if (insert.length) {
      const { error } = await supabase.from("pcrawl_keys").insert(insert);
      if (error) throw new Error(error.message);
    }
    await recountKeys(supabase, data.runId);
    return { added: insert.length };
  });

/** اعتماد مفاتيح البحث بعد مراجعتها: يبدأ البحث عن الإعلانات بها. */
export const approvePcrawlKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { runId: string }) => ({ runId: String(input?.runId ?? "") }))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { count } = await supabase
      .from("pcrawl_keys")
      .select("id", { count: "exact", head: true })
      .eq("run_id", data.runId)
      .eq("owner_id", userId)
      .eq("status", "draft");
    if (!count) throw new Error("لا توجد مفاتيح بحث لاعتمادها. أضف مفتاحًا واحدًا على الأقل.");
    const { error } = await supabase
      .from("pcrawl_keys")
      .update({ status: "pending" })
      .eq("run_id", data.runId)
      .eq("owner_id", userId)
      .eq("status", "draft");
    if (error) throw new Error(error.message);
    await recountKeys(supabase, data.runId);
    await supabase
      .from("pcrawl_runs")
      .update({ control: "none" })
      .eq("id", data.runId)
      .eq("owner_id", userId)
      .eq("status", "running");
    await kick();
    return { ok: true };
  });
