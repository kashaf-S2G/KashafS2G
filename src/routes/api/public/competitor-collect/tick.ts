import { createFileRoute } from "@tanstack/react-router";

const MAX_HOPS = 30;
const WORK_MS = 45_000;

/** عامل جمع إعلانات المنافسين: يعالج دفعة ثم يوقظ نفسه ما دامت هناك مهام متبقية. */
export const Route = createFileRoute("/api/public/competitor-collect/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-discovery-token") ?? "";
        if (!token) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: expected } = await supabaseAdmin.rpc("get_discovery_cron_token");
        if (!expected || token !== expected) return new Response("Unauthorized", { status: 401 });

        const hop = Number(request.headers.get("x-hop") ?? "0") || 0;
        const { processCollectionJobs } = await import("@/lib/competitor-collector.server");
        const result = await processCollectionJobs(supabaseAdmin, Date.now() + WORK_MS);

        // الخطوة التالية عبر قاعدة البيانات (طلب غير متزامن موثوق) بدل طلب قد يضيع.
        // لا خطوة تالية إن لم تُعالج أي مهمة (مهام مؤجلة فقط)؛ عند ذلك أو عند استنفاد الخطوات يتولى الإيقاظ الاحتياطي الاستكمال (كل دقيقتين أثناء وجود مهام فقط).
        if (result.remaining > 0 && result.processed > 0 && hop < MAX_HOPS) {
          await new Promise((r) => setTimeout(r, 2000));
          const origin = new URL(request.url).origin;
          const base = /^https:\/\/[a-z0-9.-]+$/.test(origin) ? origin : null;
          const { error } = await supabaseAdmin.rpc("call_app_at" as never, { _base: base, _path: "/api/public/competitor-collect/tick" } as never);
          if (error) console.error("[competitor-collect] next hop failed", error.message);
        }
        // الزحف لا يوقظ التحليل تلقائيًا — التحليل بالذكاء الاصطناعي يبدأ يدويًا من زر «تحليل وتكوين».
        return Response.json({ ...result, hop });
      },
    },
  },
});
