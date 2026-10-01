import { createFileRoute } from "@tanstack/react-router";

const WORK_MS = 45_000;

/** عامل «مراجعة وتشييك» في الخلفية: يعالج دفعة ثم يوقظ نفسه ما دام هناك عمل. */
export const Route = createFileRoute("/api/public/pb-review/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const isLocal = new URL(request.url).hostname === "localhost";
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        if (!isLocal) {
          const token = request.headers.get("x-discovery-token") ?? "";
          if (!token) return new Response("Unauthorized", { status: 401 });
          const { data: expected } = await supabaseAdmin.rpc("get_discovery_cron_token");
          if (!expected || token !== expected) return new Response("Unauthorized", { status: 401 });
        }
        const { processReviewJobs } = await import("@/lib/pb-review-jobs.server");
        const r = await processReviewJobs(supabaseAdmin, Date.now() + WORK_MS);
        if (r.remaining > 0 && r.processed > 0) {
          await new Promise((res) => setTimeout(res, 3000));
          const { error } = await supabaseAdmin.rpc("call_app_at" as never, { _base: r.wakeBase, _path: "/api/public/pb-review/tick" } as never);
          if (error) console.error("[pb-review] next hop failed", error.message);
        }
        return Response.json(r);
      },
    },
  },
});
