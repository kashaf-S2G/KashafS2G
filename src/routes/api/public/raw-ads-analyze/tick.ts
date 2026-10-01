import { createFileRoute } from "@tanstack/react-router";

const MAX_HOPS = 20;
const WORK_MS = 45_000;

/** عامل تحليل الإعلانات الخام الجديدة: يعالج دفعة ثم يوقظ نفسه ما دام هناك عمل ولم يتوقف الرصيد. */
export const Route = createFileRoute("/api/public/raw-ads-analyze/tick")({
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

        const hop = Number(request.headers.get("x-hop") ?? "0") || 0;
        const { processRawAdAnalyses } = await import("@/lib/raw-ad-analyzer.server");
        const { backfillImages } = await import("@/lib/raw-ad-analyzer.server");
        const images = await backfillImages(supabaseAdmin, Date.now() + 15_000).catch((e) => ({ error: String(e) }));
        if (new URL(request.url).searchParams.get("images_only") === "1") return Response.json({ images });
        const result = await processRawAdAnalyses(supabaseAdmin, Date.now() + WORK_MS);
        if (!result.paused && result.remaining > 0 && result.processed > 0 && hop < MAX_HOPS) {
          await new Promise((r) => setTimeout(r, 3000));
          const origin = new URL(request.url).origin;
          const base = /^https:\/\/[a-z0-9.-]+$/.test(origin) ? origin : null;
          const { error } = await supabaseAdmin.rpc("call_app_at" as never, { _base: base, _path: "/api/public/raw-ads-analyze/tick" } as never);
          if (error) console.error("[raw-ads-analyze] next hop failed", error.message);
        }
        return Response.json({ ...result, images, hop });
      },
    },
  },
});
