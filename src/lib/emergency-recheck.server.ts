/**
 * إعادة فحص كل الإعلانات — طوارئ. مُنسّق يدوي فقط يستدعي مسار التحليل الحالي (processOne) كما هو.
 * Checkpoint: الإعلانات مرتبة بالمعرّف؛ last_raw_ad_id = آخر إعلان اكتمل، والاستئناف يبدأ بعده مباشرة.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;
export const RUNS = "emergency_recheck_runs";
const LEASE_S = 240;

type Run = { id: string; owner_id: string; status: string; last_raw_ad_id: string | null; cutoff_at: string; total: number; processed: number; completed: number; needs_review: number; failed: number };

/** يحجز الجولة لعامل واحد فقط (تحديث ذري مشروط). */
export async function claimRun(db: Db, runId: string): Promise<Run | null> {
  const now = new Date().toISOString();
  const { data } = await db.from(RUNS).update({ lease_until: new Date(Date.now() + LEASE_S * 1000).toISOString() })
    .eq("id", runId).eq("status", "running").or(`lease_until.is.null,lease_until.lt.${now}`).select("*").maybeSingle();
  return (data as Run | null) ?? null;
}

export async function releaseRun(db: Db, runId: string) {
  await db.from(RUNS).update({ lease_until: null }).eq("id", runId);
}

/** يعالج الإعلانات التالية للـCheckpoint حتى المهلة أو أمر إيقاف. يعيد true إن بقي عمل. */
export async function stepRun(db: Db, run: Run, deadlineMs: number): Promise<boolean> {
  const { processOne } = await import("./raw-ad-analyzer.server");
  const c = { processed: run.processed, completed: run.completed, needs_review: run.needs_review, failed: run.failed };
  let cursor = run.last_raw_ad_id;
  while (Date.now() < deadlineMs) {
    const { data: cur } = await db.from(RUNS).select("status").eq("id", run.id).single();
    if (cur?.status !== "running") return false; // إيقاف مؤقت / إلغاء: لا نبدأ إعلانًا جديدًا.
    let q = db.from("competitor_raw_ads").select("id, owner_id, source_ad_id").eq("owner_id", run.owner_id)
      .lte("created_at", run.cutoff_at).order("id").limit(1);
    if (cursor) q = q.gt("id", cursor);
    const { data: rows } = await q;
    const raw = rows?.[0];
    if (!raw) {
      await db.from(RUNS).update({ status: "completed", finished_at: new Date().toISOString(), lease_until: null }).eq("id", run.id);
      return false;
    }
    let outcome: "completed" | "needs_review" | "failed";
    if (!raw.source_ad_id || !String(raw.source_ad_id).trim()) {
      outcome = "failed";
    } else {
      const { data: job, error } = await db.from("raw_ad_analyses").upsert({
        owner_id: raw.owner_id, raw_ad_id: raw.id, source_ad_id: raw.source_ad_id, status: "processing", attempts: 1,
        lease_expires_at: new Date(Date.now() + 180_000).toISOString(), processing_started_at: new Date().toISOString(),
        next_attempt_at: new Date().toISOString(),
      }, { onConflict: "owner_id,source_ad_id" }).select("id, owner_id, raw_ad_id, source_ad_id, attempts, max_attempts, product_id").single();
      if (error || !job) outcome = "failed";
      else {
        const r = await processOne(db, job as never);
        if (r === "blocked") {
          // نفاد الرصيد: لا نتقدّم بالـCheckpoint، نوقف مؤقتًا ولا نعيد التشغيل تلقائيًا.
          await db.from(RUNS).update({ status: "paused", stop_reason: "credits", lease_until: null }).eq("id", run.id);
          return false;
        }
        const { data: after } = await db.from("raw_ad_analyses").select("status").eq("id", job.id).single();
        outcome = r === "failed" ? "failed" : after?.status === "needs_review" ? "needs_review" : "completed";
      }
    }
    cursor = raw.id;
    c.processed++; c[outcome]++;
    await db.from(RUNS).update({ ...c, last_raw_ad_id: cursor, lease_until: new Date(Date.now() + LEASE_S * 1000).toISOString() }).eq("id", run.id);
  }
  return true;
}
