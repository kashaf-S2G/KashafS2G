import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Problems & Benefits read layer — same pattern as getProductsPageDb:
 * search/filter/sort/pagination/aggregation run in get_pb_statements_page (SECURITY INVOKER, RLS = owner isolation).
 */
export const PB_SORTS = ["newest", "oldest", "ads", "active_ads", "products", "text"] as const;

export const pbPageInputSchema = z.object({
  kind: z.enum(["problem", "benefit"]).nullable().default(null),
  search: z.string().max(200).default(""),
  sort: z.enum(PB_SORTS).default("newest"),
  pageSize: z.number().int().min(1).max(100).default(50),
  page: z.number().int().min(1).max(100_000).default(1),
});

export type PbPageInput = z.input<typeof pbPageInputSchema>;

export type PbStatementItem = {
  id: string;
  kind: "problem" | "benefit";
  text: string;
  key: string;
  description: string;
  totalAds: number;
  activeAds: number;
  stoppedAds: number;
  products: number;
  competitors: number;
  firstSeen: string | null;
  lastSeen: string | null;
};

export type PbPageResult = { items: PbStatementItem[]; total: number; allTotal: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchPbPageFromDb(sb: any, data: z.infer<typeof pbPageInputSchema>): Promise<PbPageResult> {
  const { data: res, error } = await sb.rpc("get_pb_statements_page", {
    _kind: data.kind,
    _search: data.search.trim(),
    _sort: data.sort,
    _limit: data.pageSize,
    _page: data.page,
  });
  if (error) throw new Error(error.message);
  const r = res as PbPageResult;
  return { items: r.items ?? [], total: r.total ?? 0, allTotal: r.allTotal ?? 0 };
}

export const getPbStatementsPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => pbPageInputSchema.parse(d))
  .handler(async ({ data, context }): Promise<PbPageResult> => fetchPbPageFromDb(context.supabase, data));

// مسار pb_extract القديم (تحليل AI ثانٍ لكل إعلان) أُوقف: المشكلة تُستخرج داخل التحليل الموحد للإعلان.

/** مراجعة وتشييك: قائمة المشاكل النشطة التي لها منتجات مرتبطة (RLS = المالك فقط). */
export const listReviewProblems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const { data: probs, error } = await sb.from("pb_statements").select("id, display_text").eq("owner_id", context.userId).eq("kind", "problem").is("archived_at", null).order("created_at");
    if (error) throw new Error(error.message);
    const { data: links } = await sb.from("pb_statement_products").select("statement_id").eq("owner_id", context.userId);
    const has = new Set((links ?? []).map((l) => l.statement_id as string));
    return { problems: (probs ?? []).filter((p) => has.has(p.id as string)).map((p) => ({ id: p.id as string, text: p.display_text as string })) };
  });

/** يراجع علاقات مشكلة واحدة بالـAI ويحفظ النتائج pending. لا يغيّر أي علاقة. */
export const reviewProblemLinksFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ problemId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { reviewProblemLinks } = await import("./problems.server");
    return reviewProblemLinks(supabaseAdmin, context.userId, data.problemId);
  });

export type LinkReviewItem = {
  id: string; status: string; statusNote: string | null; verdict: string; reason: string; confidence: string; reviewedAt: string;
  problem: { id: string; text: string }; product: { id: string; name: string; image: string | null; description: string | null };
  suggested: { id: string; text: string; reason: string | null } | null;
  newProblem: { description: string; reason: string | null } | null;
};

/** نتائج المراجعة المحفوظة (المعلقة أولًا). */
export const listLinkReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ items: LinkReviewItem[] }> => {
    const sb = context.supabase;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (sb as any).from("pb_link_reviews").select("*").eq("owner_id", context.userId).in("status", ["pending", "approved", "rejected", "stale"]).order("reviewed_at", { ascending: false }).limit(300);
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rs = (rows ?? []) as any[];
    const sids = [...new Set(rs.flatMap((r) => [r.statement_id, r.suggested_problem_id]).filter(Boolean))];
    const pids = [...new Set(rs.map((r) => r.product_id))];
    const { data: st } = sids.length ? await sb.from("pb_statements").select("id, display_text").in("id", sids) : { data: [] };
    const { data: pr } = pids.length ? await sb.from("products").select("id, canonical_name, image_url, profile").in("id", pids) : { data: [] };
    const sm = new Map((st ?? []).map((s) => [s.id as string, s.display_text as string]));
    const pm = new Map((pr ?? []).map((p) => [p.id as string, p]));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const imgs = new Map<string, string | null>();
    for (const p of pr ?? []) {
      const u = p.image_url as string | null;
      if (!u) imgs.set(p.id as string, null);
      else if (/^https?:\/\//.test(u)) imgs.set(p.id as string, u);
      else imgs.set(p.id as string, (await supabaseAdmin.storage.from("ad-images").createSignedUrl(u, 3600)).data?.signedUrl ?? null);
    }
    const order = (s: string) => (s === "pending" ? 0 : 1);
    const items = rs.map((r): LinkReviewItem => {
      const p = pm.get(r.product_id) as any;
      const prof = (p?.profile ?? {}) as Record<string, unknown>;
      return {
        id: r.id, status: r.status, statusNote: r.status_note, verdict: r.verdict, reason: r.reason, confidence: r.confidence, reviewedAt: r.reviewed_at,
        problem: { id: r.statement_id, text: sm.get(r.statement_id) ?? "(مشكلة غير متاحة)" },
        product: { id: r.product_id, name: p?.canonical_name ?? "(منتج غير متاح)", image: imgs.get(r.product_id) ?? null, description: (prof["description"] as string | undefined) ?? null },
        suggested: r.suggested_problem_id ? { id: r.suggested_problem_id, text: sm.get(r.suggested_problem_id) ?? "(غير متاحة)", reason: r.suggested_reason } : null,
        newProblem: r.create_new_problem && r.new_problem_description ? { description: r.new_problem_description, reason: r.new_problem_reason } : null,
      };
    }).sort((a, b) => order(a.status) - order(b.status));
    return { items };
  });

/** إنشاء مشكلة جديدة يدويًا من المستخدم، مع إمكانية ربط منتج بها فورًا. */
export const createManualProblemFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      text: z.string().trim().min(3, "نص المشكلة قصير جدًا").max(500),
      description: z.string().trim().max(2000).default(""),
      productId: z.string().uuid().nullable().default(null),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createManualProblem } = await import("./problems.server");
    return createManualProblem(supabaseAdmin, context.userId, data);
  });

/** موافق / غير موافق لنتيجة واحدة فقط. */
export const decideLinkReviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ reviewId: z.string().uuid(), approve: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decideLinkReview } = await import("./problems.server");
    return decideLinkReview(supabaseAdmin, context.userId, data.reviewId, data.approve);
  });

/** كل المشاكل النشطة — للقائمة المنسدلة عند «غير موافق». */
export const listActiveProblemsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("pb_statements").select("id, display_text")
      .eq("owner_id", context.userId).eq("kind", "problem").is("archived_at", null)
      .order("display_text");
    if (error) throw new Error(error.message);
    return { problems: (data ?? []).map((p) => ({ id: p.id as string, text: p.display_text as string })) };
  });

/** رفض نتيجة مع نقل يدوي للمشكلة المختارة من القائمة أو مشكلة جديدة من النموذج — أو رفض دون تغيير. */
export const rejectLinkReviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      reviewId: z.string().uuid(),
      targetProblemId: z.string().uuid().nullable().default(null),
      newProblemText: z.string().trim().min(3, "نص المشكلة قصير جدًا").max(500).nullable().default(null),
      newProblemDescription: z.string().trim().max(2000).default(""),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { rejectLinkReview } = await import("./problems.server");
    return rejectLinkReview(supabaseAdmin, context.userId, data);
  });

/** مفاتيح المنتجات المرتبطة بمشكلة/فائدة — المفتاح نفسه المستخدم في get_products_page (product_id). */
export const getPbStatementProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ statementId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: st, error: e1 } = await sb.from("pb_statements").select("display_text, kind").eq("id", data.statementId).maybeSingle();
    if (e1) throw new Error(e1.message);
    // علاقة Problem ↔ Product المستقلة.
    const { data: links, error: e2 } = await sb.from("pb_statement_products").select("product_id").eq("statement_id", data.statementId);
    if (e2) throw new Error(e2.message);
    const keys = [...new Set((links ?? []).map((l) => (l as { product_id: string }).product_id).filter(Boolean))];
    return { text: (st?.display_text as string | undefined) ?? "", kind: (st?.kind as string | undefined) ?? "problem", keys };
  });

// ───────────── تشييك دمج ─────────────

/** يقارن المشاكل المحددة زوجًا بزوج بالـAI ويحفظ اقتراحات الدمج pending. لا يدمج شيئًا. */
export const reviewProblemMergesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ problemIds: z.array(z.string().uuid()).min(2).max(50) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { reviewProblemMerges } = await import("./problems.server");
    return reviewProblemMerges(supabaseAdmin, context.userId, data.problemIds);
  });

export type MergeReviewItem = {
  id: string; status: string; statusNote: string | null; verdict: string; reason: string; confidence: string; reviewedAt: string;
  source: { id: string; text: string }; target: { id: string; text: string };
};

/** نتائج تشييك الدمج المحفوظة (المعلقة أولًا). */
export const listMergeReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ items: MergeReviewItem[] }> => {
    const sb = context.supabase;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (sb as any).from("pb_merge_reviews").select("*").eq("owner_id", context.userId).order("reviewed_at", { ascending: false }).limit(300);
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rs = (rows ?? []) as any[];
    const sids = [...new Set(rs.flatMap((r) => [r.source_statement_id, r.target_statement_id]))];
    const { data: st } = sids.length ? await sb.from("pb_statements").select("id, display_text").in("id", sids) : { data: [] };
    const sm = new Map((st ?? []).map((s) => [s.id as string, s.display_text as string]));
    const order = (s: string) => (s === "pending" ? 0 : 1);
    const items = rs.map((r): MergeReviewItem => ({
      id: r.id, status: r.status, statusNote: r.status_note, verdict: r.verdict, reason: r.reason, confidence: r.confidence, reviewedAt: r.reviewed_at,
      source: { id: r.source_statement_id, text: sm.get(r.source_statement_id) ?? "(مشكلة غير متاحة)" },
      target: { id: r.target_statement_id, text: sm.get(r.target_statement_id) ?? "(مشكلة غير متاحة)" },
    })).sort((a, b) => order(a.status) - order(b.status));
    return { items };
  });

/** موافق / غير موافق لاقتراح دمج واحد. الموافقة تدمج فعليًا بعد إعادة تحقق. */
export const decideMergeReviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ reviewId: z.string().uuid(), approve: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decideMergeReview } = await import("./problems.server");
    return decideMergeReview(supabaseAdmin, context.userId, data.reviewId, data.approve);
  });

// ───────────── مهام «مراجعة وتشييك» في الخلفية ─────────────

export type ReviewJob = {
  id: string; kind: "fit" | "merge"; status: "running" | "paused" | "finished" | "stopped" | "cancelled";
  cursor: number; total: number; reviewed: number; failed: number; currentText: string; log: string[];
};

async function wakeReviewWorker(db: { rpc: (...a: never[]) => unknown }, base: string | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any).rpc("call_app_at", { _base: base, _path: "/api/public/pb-review/tick" });
  if (error) throw new Error("تعذّر بدء العمل في الخلفية: " + error.message);
}

/** يبدأ مهمة مراجعة في الخلفية — تستمر حتى لو أُغلقت الصفحة. */
export const startReviewJobFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ kind: z.enum(["fit", "merge"]), problemIds: z.array(z.string().uuid()).max(5000).default([]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { workerOrigin, requestOrigin } = await import("@/lib/worker-origin.server");
    const uid = context.userId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { data: open } = await db.from("pb_review_jobs").select("id").eq("owner_id", uid).in("status", ["running", "paused"]).limit(1);
    if ((open ?? []).length) throw new Error("توجد عملية مراجعة جارية بالفعل — أوقفها أو انتظر انتهاءها.");
    const { data: probs } = await db.from("pb_statements").select("id").eq("owner_id", uid).eq("kind", "problem").is("archived_at", null).order("created_at");
    const { data: links } = await db.from("pb_statement_products").select("statement_id").eq("owner_id", uid);
    const has = new Set(((links ?? []) as { statement_id: string }[]).map((l) => l.statement_id));
    const active = ((probs ?? []) as { id: string }[]).map((p) => p.id);
    const sel = new Set(data.problemIds);
    let ids: string[]; let skipped = 0;
    if (data.kind === "merge") {
      ids = active.filter((id) => sel.has(id));
      if (ids.length < 2) throw new Error("تشييك الدمج يحتاج تحديد مشكلتين نشطتين على الأقل.");
      if (ids.length > 50) throw new Error("حدّد 50 مشكلة كحد أقصى لتشييك الدمج.");
    } else {
      const withLinks = active.filter((id) => has.has(id));
      ids = sel.size ? withLinks.filter((id) => sel.has(id)) : withLinks;
      skipped = sel.size ? sel.size - ids.length : 0;
      if (!ids.length) throw new Error("لا توجد مشاكل قابلة للمراجعة — راجع أن المحدد من المشاكل النشطة وله منتجات مرتبطة.");
    }
    const base = workerOrigin() ?? requestOrigin();
    const { data: job, error } = await db.from("pb_review_jobs").insert({
      owner_id: uid, kind: data.kind, problem_ids: ids, total: data.kind === "merge" ? 1 : ids.length,
      wake_base: base, current_text: "بدأت العملية في الخلفية...",
      log: skipped > 0 ? [`تم تخطي ${skipped} مشكلة من المحدد (لا منتجات مرتبطة بها أو غير نشطة).`] : [],
    }).select("id").single();
    if (error) throw new Error(error.message);
    await wakeReviewWorker(db, base);
    return { id: job.id as string };
  });

/** آخر مهمة مراجعة للمستخدم. يوقظ العامل إن توقف دون قصد. */
export const getReviewJobFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ job: ReviewJob | null }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: r } = await (context.supabase as any).from("pb_review_jobs").select("*").eq("owner_id", context.userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!r) return { job: null };
    const stale = r.status === "running" && (!r.lease_expires_at || new Date(r.lease_expires_at).getTime() < Date.now()) && Date.now() - new Date(r.updated_at).getTime() > 60_000;
    if (stale) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await wakeReviewWorker(supabaseAdmin as never, r.wake_base).catch(() => undefined);
    }
    return { job: { id: r.id, kind: r.kind, status: r.status, cursor: r.cursor, total: r.total, reviewed: r.reviewed, failed: r.failed, currentText: r.current_text, log: r.log ?? [] } };
  });

/** إيقاف مؤقت / استئناف / اكتفيت / إلغاء — يُطبَّق فورًا في قاعدة البيانات. */
export const controlReviewJobFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), action: z.enum(["pause", "resume", "finish", "cancel"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { data: job } = await db.from("pb_review_jobs").select("status, wake_base").eq("id", data.id).eq("owner_id", context.userId).maybeSingle();
    if (!job) throw new Error("العملية غير موجودة");
    const map = { pause: ["paused", "متوقف مؤقتًا"], resume: ["running", "استئناف..."], finish: ["stopped", "تم الإيقاف."], cancel: ["cancelled", "أُلغيت العملية."] } as const;
    const [status, text] = map[data.action];
    const from = data.action === "resume" ? ["paused"] : ["running", "paused"];
    await db.from("pb_review_jobs").update({ status, current_text: text, updated_at: new Date().toISOString() }).eq("id", data.id).in("status", from);
    if (data.action === "resume") await wakeReviewWorker(db, job.wake_base);
    return { status };
  });
