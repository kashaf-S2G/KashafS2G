import { createFileRoute } from "@tanstack/react-router";

/** عدد الخطوات لكل مالك في التشغيل الدوري (كل 3 ساعات). */
const MAX_STEPS = 12;

/**
 * نقطة التشغيل الدوري لزحف المنتجات — يستدعيها pg_cron برأس التحقق.
 * كل تشغيل يعمل على دفعة محدودة ويحفظ تقدّمه ليُستكمل من حيث توقف.
 */
export const Route = createFileRoute("/api/public/product-crawl/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-discovery-token") ?? "";
        if (!token) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: expected } = await supabaseAdmin.rpc("get_discovery_cron_token");
        if (!expected || token !== expected) return new Response("Unauthorized", { status: 401 });

        const { runScheduledPcrawl } = await import("@/lib/pcrawl.server");

        // كل مالك لديه منتجات مسجّلة يدخل الدور الدوري.
        const { data: owners } = await supabaseAdmin.from("products").select("owner_id").limit(5000);
        const ids = [...new Set((owners ?? []).map((o) => o.owner_id as string).filter(Boolean))];

        const results: unknown[] = [];
        for (const ownerId of ids) {
          try {
            results.push(await runScheduledPcrawl(supabaseAdmin, ownerId, MAX_STEPS));
          } catch (error) {
            results.push({ ownerId, error: error instanceof Error ? error.message : String(error) });
          }
        }
        return Response.json({ owners: ids.length, results });
      },
    },
  },
});
