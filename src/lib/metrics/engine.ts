import type { ProductSummary } from "@/lib/product-summary";
import { conditionLabel, formatValue, isMet, scoreMetric } from "./scoring";
import type { MetricResult, ResolvedMetric, ScoredProduct } from "./types";
import { METRIC_VALUES, productTrend } from "./values";
import { activeMetrics, normalizedWeights } from "./weights";

/**
 * محرك المقاييس: يقرأ إعدادات المستخدم وقيم المنتجات، يحسب نقاط كل مقياس
 * (وزنه كاملًا عند التحقق و0 عند عدم التحقق)، ثم اكتمال البيانات والدرجة الإجمالية.
 * البيانات غير المتوفرة لا تُحتسب إطلاقًا ولا تُعتبر "غير محققة".
 */
export function evaluateProduct(
  product: ProductSummary,
  metrics: ResolvedMetric[],
  todayMs: number,
): ScoredProduct<ProductSummary> {
  const enabled = activeMetrics(metrics);
  const weights = normalizedWeights(metrics);

  const results: MetricResult[] = enabled.map((metric) => {
    const compute = METRIC_VALUES[metric.metric_key];
    const raw = compute ? compute(product, todayMs) : null;
    const value = raw === null || Number.isNaN(raw) ? null : raw;
    const weight = weights.get(metric.id) ?? 0;
    const met = value === null ? null : isMet(metric, value);
    return {
      metric,
      value,
      score: value === null ? null : scoreMetric(metric, value),
      met,
      conditionLabel: conditionLabel(metric),
      valueLabel: formatValue(metric, value),
      weight,
      points: value === null ? null : met ? weight : 0,
    };
  });

  const evaluated = results.filter((r) => r.value !== null);
  // الوزن المتاح = أوزان المقاييس التي توفرت بياناتها فقط.
  const availableWeight = evaluated.reduce((sum, r) => sum + r.weight, 0);
  const earned = evaluated.reduce((sum, r) => sum + (r.points ?? 0), 0);
  const overallScore = availableWeight === 0 ? 0 : Math.round((earned / availableWeight) * 100);

  return {
    product,
    results,
    overallScore,
    metCount: results.filter((r) => r.met === true).length,
    evaluatedCount: evaluated.length,
    enabledCount: enabled.length,
    completeness: enabled.length === 0 ? 0 : Math.round((evaluated.length / enabled.length) * 100),
    trend: productTrend(product, todayMs),
  };
}

export function rankProducts(
  products: ProductSummary[],
  metrics: ResolvedMetric[],
  todayMs: number,
  limit = 10,
): ScoredProduct<ProductSummary>[] {
  return products
    .map((p) => evaluateProduct(p, metrics, todayMs))
    // لا يظهر المنتج في Top10 إلا إذا بلغ 60% أو أكثر من الدرجة المتاحة.
    .filter((p) => p.overallScore >= 60)
    .sort(
      (a, b) =>
        b.overallScore - a.overallScore ||
        b.metCount - a.metCount ||
        b.completeness - a.completeness,
    )
    .slice(0, limit);
}
