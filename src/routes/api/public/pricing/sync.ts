import { createFileRoute } from "@tanstack/react-router";

/**
 * مزامنة أسعار مزوّدي الذكاء الاصطناعي كل 12 ساعة — يستدعيها pg_cron برأس تحقق.
 * فشل مزوّد واحد لا يوقف الباقي، وآخر سعر صالح يبقى ساريًا.
 */
export const Route = createFileRoute("/api/public/pricing/sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-discovery-token") ?? "";
        if (!token) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: expected } = await supabaseAdmin.rpc("get_discovery_cron_token");
        if (!expected || token !== expected) return new Response("Unauthorized", { status: 401 });

        try {
          const { syncProviderPricing } = await import("@/lib/ai-providers.server");
          const { updated, reports } = await syncProviderPricing();
          return Response.json({
            updated,
            providers: reports.map((r) => ({ provider: r.providerCode, status: r.status, message: r.message })),
          });
        } catch (error) {
          // فشل المزامنة لا يغيّر الأسعار السارية.
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
          );
        }
      },
    },
  },
});
