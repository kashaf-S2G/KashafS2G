import type { MetricSetting, ResolvedMetric } from "./types";

/** المقاييس التي تدخل في توزيع الأوزان: مفعّلة ومتاحة ونشطة. */
export function activeMetrics(metrics: ResolvedMetric[]): ResolvedMetric[] {
  return metrics.filter((m) => m.enabled && m.is_active && m.is_available);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * توزيع الأوزان بحيث يكون مجموع أوزان المقاييس المفعلة 100% دائمًا.
 * يُرجع خريطة: معرّف المقياس ← وزنه بالنسبة المئوية.
 */
export function normalizedWeights(metrics: ResolvedMetric[]): Map<string, number> {
  const active = activeMetrics(metrics);
  const out = new Map<string, number>();
  if (active.length === 0) return out;
  const sum = active.reduce((s, m) => s + Math.max(0, m.weight), 0);
  if (sum <= 0) {
    const even = round2(100 / active.length);
    active.forEach((m) => out.set(m.id, even));
  } else {
    active.forEach((m) => out.set(m.id, round2((Math.max(0, m.weight) / sum) * 100)));
  }
  // تصحيح فرق التقريب على أول مقياس حتى يكون المجموع 100 بالضبط.
  const total = [...out.values()].reduce((a, b) => a + b, 0);
  const firstId = active[0]!.id;
  out.set(firstId, round2((out.get(firstId) ?? 0) + (100 - total)));
  return out;
}

function toSettings(metrics: ResolvedMetric[], weights: Map<string, number>): MetricSetting[] {
  return metrics.map((m) => ({
    metric_id: m.id,
    enabled: m.enabled,
    target_value: m.target_value,
    minimum_value: m.minimum_value,
    maximum_value: m.maximum_value,
    weight: weights.get(m.id) ?? 0,
    scoring_method: "binary",
  }));
}

/**
 * تغيير وزن مقياس: يوزَّع الفرق بالتساوي على باقي المقاييس المفعلة
 * حتى يبقى المجموع 100%.
 */
export function applyWeightChange(
  metrics: ResolvedMetric[],
  metricId: string,
  requestedWeight: number,
): MetricSetting[] {
  const active = activeMetrics(metrics);
  const base = normalizedWeights(metrics);
  const target = Math.max(0, Math.min(100, requestedWeight));
  const others = active.filter((m) => m.id !== metricId);

  const next = new Map(base);
  if (!base.has(metricId)) return toSettings(metrics, base);

  if (others.length === 0) {
    next.set(metricId, 100);
    return toSettings(metrics, next);
  }

  next.set(metricId, round2(target));
  const remaining = 100 - target;
  const othersSum = others.reduce((s, m) => s + (base.get(m.id) ?? 0), 0);
  const delta = (target - (base.get(metricId) ?? 0)) / others.length;

  let adjusted = others.map((m) => ({ id: m.id, w: Math.max(0, (base.get(m.id) ?? 0) - delta) }));
  const adjSum = adjusted.reduce((s, x) => s + x.w, 0);
  if (adjSum <= 0) {
    const even = remaining / others.length;
    adjusted = others.map((m) => ({ id: m.id, w: even }));
  } else if (othersSum > 0) {
    adjusted = adjusted.map((x) => ({ id: x.id, w: (x.w / adjSum) * remaining }));
  }
  adjusted.forEach((x) => next.set(x.id, round2(x.w)));

  // تصحيح التقريب
  const total = [...active].reduce((s, m) => s + (next.get(m.id) ?? 0), 0);
  const fixId = others[0]!.id;
  next.set(fixId, round2((next.get(fixId) ?? 0) + (100 - total)));
  return toSettings(metrics, next);
}

/** تفعيل/تعطيل مقياس مع إعادة توزيع الأوزان على المقاييس المفعلة. */
export function applyEnabledChange(
  metrics: ResolvedMetric[],
  metricId: string,
  enabled: boolean,
): MetricSetting[] {
  const updated = metrics.map((m) => (m.id === metricId ? { ...m, enabled } : m));
  const weights = normalizedWeights(updated);
  return toSettings(updated, weights).map((s) =>
    s.metric_id === metricId ? { ...s, enabled } : s,
  );
}
