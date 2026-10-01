import { createFileRoute } from "@tanstack/react-router";

/** فحص مؤقت: هل يستطيع الخادم قراءة رمز المهام من القاعدة؟ يعيد قيمًا منطقية فقط. */
export const Route = createFileRoute("/api/public/debug-token")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc("get_discovery_cron_token");
          return Response.json({ ok: !error, hasToken: typeof data === "string" && data.length > 0, error: error?.message ?? null });
        } catch (e) {
          return Response.json({ ok: false, hasToken: false, error: String(e).slice(0, 200) });
        }
      },
    },
  },
});
