import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * لمحة لحظية عن نشاط الذكاء الاصطناعي في تحليل الإعلانات الخام:
 * هل يعمل الآن؟ ماذا أنجز؟ وكم تبقى؟ تُقرأ من طابور raw_ad_analyses.
 */
export type AiActivity = {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  needsReview: number;
  /** متبقٍ فعليًا: منتظر + قيد المعالجة + فاشل سيُعاد تلقائيًا. */
  remaining: number;
  /** يعمل الآن: توجد مهام مؤجرة حديثًا أو اكتمل شيء خلال آخر دقيقتين. */
  active: boolean;
  /** متوقف بسبب الرصيد/الصلاحية: مهام منتظرة مؤجلة أكثر من 50 دقيقة. */
  blocked: boolean;
  lastError: string | null;
  lastDoneAt: string | null;
  /** عدد ما أُنجز خلال آخر 10 دقائق (لحساب السرعة والوقت المتبقي). */
  doneLast10m: number;
  recent: { id: string; status: string; page: string; text: string; product: string | null; score: number | null; at: string | null }[];
};

export const getAiActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AiActivity> => {
    const { supabase, userId } = context;
    const now = Date.now();
    const soon = new Date(now + 60_000).toISOString();
    const blockedAfter = new Date(now + 50 * 60_000).toISOString();
    // نتائج آخر جولة تحليل فقط (منذ آخر ضغط على زر التحليل)، وليست متراكمة.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ctl } = await supabaseAdmin.from("raw_ad_analysis_control" as never)
      .select("run_started_at").eq("owner_id", userId).maybeSingle();
    const since = ((ctl as { run_started_at?: string | null } | null)?.run_started_at) ?? new Date(0).toISOString();

    const count = async (filter: (q: any) => any) => {
      const { count: c } = await filter(
        supabase.from("raw_ad_analyses").select("id", { count: "exact", head: true }).eq("owner_id", userId),
      );
      return c ?? 0;
    };

    const [pending, processing, failed, needsReview, completed, retryable, blockedPending, recentDone] =
      await Promise.all([
        count((q) => q.eq("status", "pending")),
        count((q) => q.eq("status", "processing").gt("lease_expires_at", new Date(now).toISOString())),
        count((q) => q.eq("status", "failed").gte("attempts", 3).gte("updated_at", since)),
        count((q) => q.eq("status", "needs_review").gte("processing_completed_at", since)),
        count((q) => q.eq("status", "completed").gte("processing_completed_at", since)),
        // فاشل سيُعاد تلقائيًا (محاولاته لم تستنفد)
        count((q) => q.eq("status", "failed").lt("attempts", 3)),
        // منتظر مؤجّل بعيدًا = توقف بسبب الرصيد
        count((q) => q.eq("status", "pending").gt("next_attempt_at", blockedAfter)),
        count((q) => q.eq("status", "completed").gt("processing_completed_at", new Date(now - 2 * 60_000).toISOString())),
      ]);

    const { data: lastRows } = await supabase
      .from("raw_ad_analyses")
      .select("last_error, processing_completed_at")
      .eq("owner_id", userId)
      .not("last_error", "is", null)
      .gte("updated_at", since)
      .order("processing_completed_at", { ascending: false, nullsFirst: false })
      .limit(1);
    const { data: doneRows } = await supabase
      .from("raw_ad_analyses")
      .select("processing_completed_at")
      .eq("owner_id", userId)
      .eq("status", "completed")
      .gte("processing_completed_at", since)
      .order("processing_completed_at", { ascending: false })
      .limit(1);

    const since10 = new Date(now - 10 * 60_000).toISOString();
    const { count: doneLast10m } = await supabase.from("raw_ad_analyses")
      .select("id", { count: "exact", head: true }).eq("owner_id", userId)
      .in("status", ["completed", "needs_review"]).gt("processing_completed_at", since10);
    const { data: recentRows } = await supabase.from("raw_ad_analyses")
      .select("id, status, match_score, processing_completed_at, products(canonical_name), competitor_raw_ads(page_name, ad_text)")
      .eq("owner_id", userId).in("status", ["completed", "needs_review", "failed"])
      .not("processing_completed_at", "is", null)
      .gte("processing_completed_at", since)
      .order("processing_completed_at", { ascending: false }).limit(6);
    const recent = ((recentRows ?? []) as any[]).map((r) => ({
      id: r.id, status: r.status,
      page: r.competitor_raw_ads?.page_name ?? "",
      text: String(r.competitor_raw_ads?.ad_text ?? "").slice(0, 80),
      product: r.products?.canonical_name ?? null,
      score: r.match_score == null ? null : Number(r.match_score),
      at: r.processing_completed_at,
    }));

    const remaining = pending + processing + retryable;
    return {
      pending,
      processing,
      completed,
      failed,
      needsReview,
      remaining,
      active: processing > 0 || (recentDone > 0 && remaining > 0),
      blocked: remaining > 0 && blockedPending > 0 && processing === 0,
      lastError: (lastRows?.[0]?.last_error as string | null) ?? null,
      doneLast10m: doneLast10m ?? 0,
      recent,
      lastDoneAt: (doneRows?.[0]?.processing_completed_at as string | null) ?? null,
    };
  });
