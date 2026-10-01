import { createFileRoute } from "@tanstack/react-router";

/** عامل إعادة الفحص الطارئة: يكمل من الـCheckpoint ثم يوقظ نفسه ما دامت الجولة قيد التشغيل. */
export const Route = createFileRoute("/api/public/emergency-recheck/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        if (url.hostname !== "localhost") {
          const token = request.headers.get("x-discovery-token") ?? "";
          const { data: expected } = await supabaseAdmin.rpc("get_discovery_cron_token");
          if (!token || !expected || token !== expected) return new Response("Unauthorized", { status: 401 });
        }
        const { claimRun, releaseRun, stepRun, RUNS } = await import("@/lib/emergency-recheck.server");
        const { data: runs } = await supabaseAdmin.from(RUNS as never).select("id").eq("status", "running").limit(50);
        let more = false;
        for (const { id } of (runs ?? []) as { id: string }[]) {
          const run = await claimRun(supabaseAdmin, id);
          if (!run) continue;
          try { if (await stepRun(supabaseAdmin, run, Date.now() + 40_000)) more = true; }
          catch (e) { console.error("[emergency-recheck]", e); more = true; }
          finally { await releaseRun(supabaseAdmin, id); }
        }
        if (more) {
          const base = /^https:\/\/[a-z0-9.-]+$/.test(url.origin) ? url.origin : null;
          await supabaseAdmin.rpc("call_app_at" as never, { _base: base, _path: "/api/public/emergency-recheck/tick" } as never);
        }
        return Response.json({ more });
      },
    },
  },
});
