import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * تبنّي السجلات القديمة التي لا مالك لها.
 * يعمل على الخادم فقط بعد التحقق من هوية المستخدم، والقاعدة نفسها محفوظة داخل
 * الدالة: الحساب الأساسي وحده مسموح له بذلك.
 */
export const claimLegacyRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ competitors: number; ads: number }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("claim_legacy_records_for", {
      _uid: context.userId,
    });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as
      | { claimed_competitors: number; claimed_ads: number }
      | undefined;
    return { competitors: row?.claimed_competitors ?? 0, ads: row?.claimed_ads ?? 0 };
  });
