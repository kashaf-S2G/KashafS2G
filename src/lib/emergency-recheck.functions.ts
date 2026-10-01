import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RUNS = "emergency_recheck_runs";

async function wake(db: { rpc: (...a: never[]) => unknown }) {
  const origin = new URL(getRequest().url).origin;
  const base = /^https:\/\/[a-z0-9.-]+$/.test(origin) ? origin : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any).rpc("call_app_at", { _base: base, _path: "/api/public/emergency-recheck/tick" });
  if (error) throw new Error("تعذّر تشغيل العامل: " + error.message);
}

/** حالة آخر جولة طوارئ + عدد الإعلانات الحالي (لنافذة التأكيد). */
export const getEmergencyRecheck = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const { count } = await db.from("competitor_raw_ads").select("id", { count: "exact", head: true }).eq("owner_id", uid);
    const { data } = await db.from(RUNS as never).select("*").eq("owner_id", uid).order("started_at", { ascending: false }).limit(1).maybeSingle();
    let run = data as { id: string; status: string; updated_at: string; stop_reason?: string | null } | null;
    // انقطاع العامل: قيد التشغيل لكن بلا عامل منذ مدة — لا نعيد التشغيل تلقائيًا.
    if (run && run.status === "running" && Date.now() - Date.parse(String(run.updated_at)) > 5 * 60_000) {
      await db.from(RUNS as never).update({ status: "interrupted", stop_reason: "worker" } as never).eq("id", run.id);
      run = { ...run, status: "interrupted", stop_reason: "worker" };
    }
    return { adsCount: count ?? 0, run: run as null | { id: string; status: string; total: number; processed: number; completed: number; needs_review: number; failed: number; stop_reason: string | null } };
  });

export const controlEmergencyRecheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { action: "start" | "pause" | "resume" | "cancel" }) => {
    if (!["start", "pause", "resume", "cancel"].includes(d?.action)) throw new Error("أمر غير صالح");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const { data: active } = await db.from(RUNS as never).select("id, status").eq("owner_id", uid).in("status", ["running", "paused", "interrupted"]).maybeSingle();
    const a = active as { id: string; status: string } | null;
    if (data.action === "start") {
      if (a) throw new Error("توجد عملية إعادة فحص طارئة جارية بالفعل.");
      const cutoff = new Date().toISOString();
      const { count } = await db.from("competitor_raw_ads").select("id", { count: "exact", head: true }).eq("owner_id", uid).lte("created_at", cutoff);
      const { error } = await db.from(RUNS as never).insert({ owner_id: uid, status: "running", total: count ?? 0, cutoff_at: cutoff } as never);
      if (error) throw new Error(error.code === "23505" ? "توجد عملية إعادة فحص طارئة جارية بالفعل." : error.message);
      await wake(db as never);
      return { ok: true };
    }
    if (!a) throw new Error("لا توجد عملية جارية.");
    if (data.action === "pause") await db.from(RUNS as never).update({ status: "paused", stop_reason: "manual" } as never).eq("id", a.id);
    if (data.action === "cancel") await db.from(RUNS as never).update({ status: "cancelled", finished_at: new Date().toISOString() } as never).eq("id", a.id);
    if (data.action === "resume") {
      await db.from(RUNS as never).update({ status: "running", stop_reason: null, lease_until: null } as never).eq("id", a.id);
      await wake(db as never);
    }
    return { ok: true };
  });
