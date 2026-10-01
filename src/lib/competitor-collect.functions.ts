import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CollectionRunView = {
  id: string;
  run_number: number;
  status: string;
  competitors_total: number;
  jobs_total: number;
  jobs_done: number;
  jobs_failed: number;
  ads_found: number;
  ads_new: number;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  control: string;
  ads_duplicate: number;
  ads_changed: number;
  ads_not_seen: number;
  jobs: { pending: number; running: number; retrying: number; stopped: number };
  last_success_at: string | null;
  coverage: { competitor_id: string; status: string; ads_found: number; jobs_failed: number; batches_max: number }[];
};

/** «زحف الآن»: ينشئ الجولة ومهامها، يوقظ العامل، ويعيد رقم الجولة فورًا. */
export const startCompetitorCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ competitorIds: z.array(z.string().uuid()).max(1000).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createCollectionRun } = await import("@/lib/competitor-collector.server");
    const { data: active } = await supabaseAdmin
      .from("competitor_collection_runs")
      .select("id, run_number")
      .eq("owner_id", context.userId)
      .in("status", ["queued", "running", "stopped"])
      .limit(1);
    if (active?.length) throw new Error(`يوجد جولة جمع قيد التنفيذ أو موقوفة (#${active[0]!.run_number}). استأنفها أو ألغها أولًا.`);

    // عنوان المعاينة id-preview محمي بتسجيل دخول Lovable فلا يصل إليه pg_net؛ نستخدم عنوان المشروع العام.
    const { workerOrigin } = await import("@/lib/worker-origin.server");
    const origin = new URL(getRequest().url).origin;
    const base = workerOrigin() ?? (/^https:\/\/[a-z0-9.-]+$/.test(origin) ? origin : null);
    const run = await createCollectionRun(supabaseAdmin, context.userId, data.competitorIds, "manual", base);
    if (run.jobs === 0) throw new Error("لا يوجد منافسون لجمع إعلاناتهم.");

    await supabaseAdmin.rpc("call_app_at" as never, { _base: base, _path: "/api/public/competitor-collect/tick" } as never);
    return run;
  });

/** آخر جولة جمع للمستخدم لعرض التقدم. */
export const getLatestCompetitorRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CollectionRunView | null> => {
    const { data } = await context.supabase
      .from("competitor_collection_runs")
      .select("id, run_number, status, competitors_total, jobs_total, jobs_done, jobs_failed, ads_found, ads_new, started_at, finished_at, error, control, ads_duplicate, ads_changed, ads_not_seen")
      .eq("owner_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const { data: coverage } = await context.supabase
      .from("competitor_collection_coverage" as never)
      .select("competitor_id, status, ads_found, jobs_failed, batches_max")
      .eq("run_id", (data as { id: string }).id);
    const runId = (data as { id: string }).id;
    const { data: jobRows } = await context.supabase
      .from("competitor_collection_jobs")
      .select("status, attempts")
      .eq("run_id", runId)
      .in("status", ["pending", "running", "stopped"])
      .limit(5000);
    const jobs = { pending: 0, running: 0, retrying: 0, stopped: 0 };
    for (const j of (jobRows ?? []) as { status: string; attempts: number }[]) {
      if (j.status === "running") jobs.running++;
      else if (j.status === "stopped") jobs.stopped++;
      else if (j.attempts > 0) jobs.retrying++;
      else jobs.pending++;
    }
    const { data: ok } = await context.supabase
      .from("competitor_collection_runs")
      .select("finished_at")
      .eq("owner_id", context.userId)
      .eq("status", "completed")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return {
      ...(data as unknown as Omit<CollectionRunView, "coverage" | "jobs" | "last_success_at">),
      jobs,
      last_success_at: (ok as { finished_at: string | null } | null)?.finished_at ?? null,
      coverage: (coverage ?? []) as CollectionRunView["coverage"],
    };
  });

async function ownRun(userId: string, runId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("competitor_collection_runs").select("id, owner_id, status, wake_base").eq("id", runId).maybeSingle();
  if (!data || data.owner_id !== userId) throw new Error("الجولة غير موجودة.");
  return { db: supabaseAdmin, run: data };
}

/** إيقاف/استئناف/إلغاء — تُنفَّذ نهائيًا داخل الطلب نفسه، والبيانات المجموعة تبقى محفوظة. */
export const controlCompetitorCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ runId: z.string().uuid(), action: z.enum(["stop", "resume", "cancel", "finish"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, run } = await ownRun(context.userId, data.runId);
    const now = new Date().toISOString();
    if (data.action === "resume") {
      await db.from("competitor_collection_runs").update({ control: "active", status: "running", finished_at: null, updated_at: now }).eq("id", run.id);
      await db.from("competitor_collection_jobs").update({ status: "pending", next_attempt_at: now, updated_at: now }).eq("run_id", run.id).eq("status", "stopped");
      await db.rpc("refresh_competitor_run", { _run_id: run.id });
      await db.rpc("arm_competitor_collect_backstop" as never);
      await db.rpc("call_app_at" as never, { _base: run.wake_base, _path: "/api/public/competitor-collect/tick" } as never);
      return { ok: true };
    }
    if (data.action === "finish") {
      // «اكتفيت بهذا القدر»: المعلّقة/المجمّدة تُغلق، وكل ما جُمع يبقى، والجولة تُختم فورًا.
      await db.from("competitor_collection_runs").update({ control: "stopped", updated_at: now }).eq("id", run.id);
      await db.from("competitor_collection_jobs").update({ status: "failed", error: "اكتفى المستخدم", error_type: "user_finished", finished_at: now, updated_at: now }).eq("run_id", run.id).in("status", ["pending", "stopped"]);
      await db.rpc("refresh_competitor_run", { _run_id: run.id });
      await db.from("competitor_collection_runs").update({ status: "partial", error: "أنهى المستخدم الجولة يدويًا — البيانات المجموعة محفوظة", finished_at: now, updated_at: now }).eq("id", run.id);
      return { ok: true };
    }
    // المهام الجارية تُكمل دفعتها الحالية؛ المعلّقة تُجمَّد كنقطة استئناف.
    await db.from("competitor_collection_runs").update({ control: "stopped", updated_at: now }).eq("id", run.id);
    await db
      .from("competitor_collection_jobs")
      .update({ status: data.action === "cancel" ? "failed" : "stopped", error: data.action === "cancel" ? "ألغاها المستخدم" : null, error_type: data.action === "cancel" ? "cancelled" : null, updated_at: now })
      .eq("run_id", run.id)
      .eq("status", "pending");
    if (data.action === "cancel") {
      await db.from("competitor_collection_runs").update({ status: "cancelled", finished_at: now, updated_at: now }).eq("id", run.id);
    } else {
      await db.rpc("refresh_competitor_run", { _run_id: run.id });
    }
    return { ok: true };
  });
