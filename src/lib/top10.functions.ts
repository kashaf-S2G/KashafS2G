import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AdWithDuration, CompetitorRow, StandaloneProductRow } from "@/lib/kashaf";
import { summarize, withStandaloneProducts, type ProductSummary } from "@/lib/product-summary";
import { rankProducts } from "@/lib/metrics/engine";
import type { MetricDefinition, MetricSetting, ResolvedMetric } from "@/lib/metrics/types";

/**
 * Top10 من الخادم (Step 1): نفس الاستعلامات التي كان المتصفح يشغّلها (useAds، useProductCodeOverrides،
 * useProductsTable، useMetricDefinitions، useMetricSettings)، ونفس دمج الإعدادات (useResolvedMetrics)،
 * ونفس summarize/withStandaloneProducts/rankProducts دون أي تعديل. المتصفح يستلم أفضل 10 فقط.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: any; error: any }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export type Top10Item = {
  product: Omit<ProductSummary, "ads">;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  results: Record<string, any>[];
  overallScore: number;
  metCount: number;
  evaluatedCount: number;
  enabledCount: number;
  completeness: number;
  trend: "up" | "flat" | "down" | null;
};

export const getTop10 = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const [ads, competitors, overridesRes, rows, defsRes, settingsRes] = await Promise.all([
      fetchAll<AdWithDuration>((a, b) =>
        sb.from("ads_with_duration").select("*").order("created_at", { ascending: false }).order("id").range(a, b),
      ),
      fetchAll<CompetitorRow>((a, b) =>
        sb.from("competitors").select("*").order("created_at", { ascending: false }).order("id").range(a, b),
      ),
      sb.from("product_code_overrides").select("product_key, code"),
      fetchAll<StandaloneProductRow>((a, b) =>
        sb
          .from("products")
          .select("id, canonical_name, code, image_url, profile")
          .order("created_at", { ascending: false })
          .order("id")
          .range(a, b),
      ),
      sb.from("metrics").select("*").order("sort_order", { ascending: true }),
      sb.from("user_metric_settings").select("*"),
    ]);
    for (const r of [overridesRes, defsRes, settingsRes]) if (r.error) throw new Error(r.error.message);

    // نفس useAds
    const byId = new Map(competitors.map((c) => [c.id, c]));
    const withComp = ads.map((ad) => ({ ...ad, competitor: byId.get(ad.competitor_id) ?? null }));
    // نفس useProductCodeOverrides
    const overrides = new Map<string, string>(
      ((overridesRes.data ?? []) as { product_key: string; code: string }[]).map((r) => [r.product_key, r.code]),
    );
    // نفس useMetricDefinitions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const defs = ((defsRes.data ?? []) as any[]).map((m) => ({
      ...m,
      default_target: num(m.default_target),
      default_min: num(m.default_min),
      default_max: num(m.default_max),
      default_weight: Number(m.default_weight),
      calculation_definition: (m.calculation_definition ?? {}) as Record<string, unknown>,
    })) as MetricDefinition[];
    // نفس useMetricSettings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settings: MetricSetting[] = ((settingsRes.data ?? []) as any[]).map((s) => ({
      metric_id: s.metric_id,
      enabled: s.enabled,
      target_value: num(s.target_value),
      minimum_value: num(s.minimum_value),
      maximum_value: num(s.maximum_value),
      weight: Number(s.weight),
      scoring_method: s.scoring_method,
    }));
    // نفس useResolvedMetrics
    const sById = new Map(settings.map((s) => [s.metric_id, s]));
    const metrics: ResolvedMetric[] = defs.map((d) => {
      const s = sById.get(d.id);
      return {
        ...d,
        metric_id: d.id,
        enabled: s?.enabled ?? d.is_available,
        target_value: s?.target_value ?? d.default_target,
        minimum_value: s?.minimum_value ?? d.default_min,
        maximum_value: s?.maximum_value ?? d.default_max,
        weight: s?.weight ?? d.default_weight,
        scoring_method: s?.scoring_method ?? d.default_scoring_method,
      };
    });

    // نفس صيغة "اليوم" UTC في الصفحة
    const todayMs = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

    const products = withStandaloneProducts(summarize(withComp, overrides), rows).filter((p) => p.ads.length > 0);
    const ranked = rankProducts(products, metrics, todayMs, 10);

    const items: Top10Item[] = ranked.map((r) => {
      const { ads: _ads, ...product } = r.product;
      return { ...r, product };
    });
    // JSON round-trip: نتائج قابلة للتسلسل بالكامل.
    return JSON.parse(JSON.stringify({ items, todayMs })) as { items: Top10Item[]; todayMs: number };
  });
