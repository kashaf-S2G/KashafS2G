import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DashboardLongestAd = {
  id: string;
  product_name: string;
  competitor_name: string | null;
  creation_date: string;
  status: string;
  duration_days: number;
};

export type DashboardSummary = {
  competitorsCount: number;
  totalAds: number;
  activeAds: number;
  averageDuration: number;
  longestRunningAds: DashboardLongestAd[];
};

/** ملخص الصفحة الرئيسية محسوبًا داخل قاعدة البيانات للمستخدم الحالي (RLS). */
export const getDashboardSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardSummary> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (context.supabase as any).rpc("get_dashboard_summary");
    if (error) throw new Error(error.message);
    const d = (data ?? {}) as Partial<DashboardSummary>;
    return {
      competitorsCount: Number(d.competitorsCount ?? 0),
      totalAds: Number(d.totalAds ?? 0),
      activeAds: Number(d.activeAds ?? 0),
      averageDuration: Number(d.averageDuration ?? 0),
      longestRunningAds: d.longestRunningAds ?? [],
    };
  });
