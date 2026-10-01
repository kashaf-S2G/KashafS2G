import { createFileRoute } from "@tanstack/react-router";

/** نقطة إيقاظ العامل الخلفي — يستدعيها الخادم وقاعدة البيانات برأس التحقق فقط. */
export const Route = createFileRoute("/api/public/jobs/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-discovery-token") ?? "";
        if (!token) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: expected } = await supabaseAdmin.rpc("get_discovery_cron_token");
        if (!expected || token !== expected) return new Response("Unauthorized", { status: 401 });

        const { runTick } = await import("@/lib/job-worker.server");
        const origin = new URL(request.url).origin;
        const result = await runTick(origin.startsWith("https://") ? origin : null, { schedule: true });
        return Response.json(result);
      },
    },
  },
});
