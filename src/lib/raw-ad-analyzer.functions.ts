import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * زر «تحليل وتكوين بالذكاء الاصطناعي»: يوقظ عامل تحليل الإعلانات الخام المجمعة
 * دون بدء زحف جديد. مستقل تمامًا عن الزحف.
 */
export const startRawAdAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // بدء جولة جديدة: تفعيل المستخدم وإعادة الملغى إلى الطابور.
    await supabaseAdmin.from("raw_ad_analysis_control" as never)
      .upsert({ owner_id: context.userId, state: "active", updated_at: new Date().toISOString(), run_started_at: new Date().toISOString() } as never, { onConflict: "owner_id" });
    await supabaseAdmin.from("raw_ad_analyses").update({ status: "pending", next_attempt_at: new Date().toISOString() } as never)
      .eq("owner_id", context.userId).eq("status", "cancelled");
    const { count } = await supabaseAdmin
      .from("raw_ad_analyses")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", context.userId)
      .in("status", ["pending", "running"]);
    const origin = new URL(getRequest().url).origin;
    const base = /^https:\/\/[a-z0-9.-]+$/.test(origin) ? origin : null;
    const { error } = await supabaseAdmin.rpc("call_app_at" as never, { _base: base, _path: "/api/public/raw-ads-analyze/tick" } as never);
    if (error) throw new Error("تعذّر بدء التحليل: " + error.message);
    const { count: review } = await supabaseAdmin
      .from("raw_ad_analyses")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", context.userId)
      .eq("status", "needs_review");
    return { pending: count ?? 0, needsReview: review ?? 0 };
  });

/**
 * تشغيل تحليل الإعلانات الخام المنتظرة فورًا (للمدير فقط).
 * يعالج دفعات متتالية حتى يفرغ الطابور أو يتوقف الرصيد، بحد أقصى زمني آمن.
 */
export const runRawAdAnalysisNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Response("Forbidden", { status: 403 });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { processRawAdAnalyses } = await import("@/lib/raw-ad-analyzer.server");

    const totals = { queued: 0, processed: 0, ok: 0, failed: 0, paused: false, remaining: 0 };
    const overallDeadline = Date.now() + 50_000;
    while (Date.now() < overallDeadline) {
      const r = await processRawAdAnalyses(supabaseAdmin, Math.min(Date.now() + 12_000, overallDeadline));
      totals.queued = r.queued;
      totals.processed += r.processed;
      totals.ok += r.ok;
      totals.failed += r.failed;
      totals.paused = r.paused;
      totals.remaining = r.remaining;
      if (r.paused || r.remaining === 0 || r.processed === 0) break;
    }
    return totals;
  });

async function wakeAnalyzer(db: { rpc: (...a: never[]) => unknown }) {
  const origin = new URL(getRequest().url).origin;
  const base = /^https:\/\/[a-z0-9.-]+$/.test(origin) ? origin : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any).rpc("call_app_at", { _base: base, _path: "/api/public/raw-ads-analyze/tick" });
  if (error) throw new Error("تعذّر إيقاظ عامل التحليل: " + error.message);
}

/** حالة جولة التحليل الحالية للمستخدم (للعرض وأزرار التحكم). */
export const getRawAdAnalysisStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const { data: ctl } = await supabaseAdmin.from("raw_ad_analysis_control" as never).select("state, run_started_at").eq("owner_id", uid).maybeSingle();
    const since = (ctl as { run_started_at?: string | null } | null)?.run_started_at ?? null;
    const cnt = async (statuses: string[], sinceStart = false) => {
      let q = supabaseAdmin.from("raw_ad_analyses").select("id", { count: "exact", head: true }).eq("owner_id", uid).in("status", statuses);
      if (sinceStart && since) q = q.gte("processing_completed_at", since);
      const { count } = await q;
      return count ?? 0;
    };
    // «تمت» = ما أُنجز في الجولة الحالية فقط.
    const [pending, processing, done, cancelled] = await Promise.all([cnt(["pending", "failed"]), cnt(["processing"]), cnt(["completed", "needs_review"], true), cnt(["cancelled"])]);
    return { state: ((ctl as { state?: string } | null)?.state ?? "active") as "active" | "paused" | "idle", pending, processing, done, cancelled };
  });

/** التحكم في جولة التحليل: إيقاف مؤقت / استئناف / إلغاء الجولة / اكتفيت بهذا القدر. */
export const controlRawAdAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { action: "pause" | "resume" | "cancel" | "finish" }) => {
    if (!["pause", "resume", "cancel", "finish"].includes(d?.action)) throw new Error("أمر غير صالح");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const state = data.action === "pause" ? "paused" : data.action === "resume" ? "active" : "idle";
    const { error } = await supabaseAdmin.from("raw_ad_analysis_control" as never)
      .upsert({ owner_id: uid, state, updated_at: new Date().toISOString() } as never, { onConflict: "owner_id" });
    if (error) throw new Error(error.message);
    if (data.action === "cancel") {
      // إلغاء: إخراج المتبقي من الطابور؛ يعود للطابور عند بدء تحليل جديد.
      await supabaseAdmin.from("raw_ad_analyses").update({ status: "cancelled", lease_expires_at: null } as never)
        .eq("owner_id", uid).in("status", ["pending", "failed"]);
    }
    if (data.action === "resume") await wakeAnalyzer(supabaseAdmin as never);
    return { state };
  });
