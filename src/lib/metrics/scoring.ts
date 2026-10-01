import type { ResolvedMetric } from "./types";

/** طريقة التقييم الوحيدة في النظام: محقق / غير محقق. */
export const SCORING_METHODS: { id: string; label: string; hint: string }[] = [
  { id: "binary", label: "محقق / غير محقق", hint: "المنتج يأخذ وزن المقياس كاملًا عند تحقق الشرط، و0 عند عدم تحققه." },
];

export const CONDITION_TYPES: { id: string; label: string }[] = [
  { id: "gte", label: "أكبر من أو يساوي" },
  { id: "lte", label: "أقل من أو يساوي" },
  { id: "between", label: "بين قيمتين" },
  { id: "percent_gte", label: "نسبة مئوية ≥" },
  { id: "score", label: "درجة" },
];

export function unitOf(metric: ResolvedMetric): string {
  const unit = (metric.calculation_definition as { unit?: string } | null)?.unit;
  if (unit) return unit;
  if (metric.value_type === "percent") return "%";
  if (metric.value_type === "days") return "يوم";
  if (metric.value_type === "count") return "";
  return "درجة";
}

export function formatValue(metric: ResolvedMetric, value: number | null): string {
  if (value === null) return "غير متوفرة";
  const unit = unitOf(metric);
  return unit === "%" ? `${value}%` : unit ? `${value} ${unit}` : String(value);
}

export function conditionLabel(metric: ResolvedMetric): string {
  const unit = unitOf(metric);
  const fmt = (n: number | null) =>
    n === null ? "—" : unit === "%" ? `${n}%` : unit ? `${n} ${unit}` : String(n);
  switch (metric.condition_type) {
    case "lte":
      return `≤ ${fmt(metric.target_value)}`;
    case "between":
      return `بين ${fmt(metric.minimum_value)} و ${fmt(metric.maximum_value)}`;
    default:
      return `≥ ${fmt(metric.target_value)}`;
  }
}

/** هل تحقق شرط المستخدم؟ */
export function isMet(metric: ResolvedMetric, value: number): boolean {
  const t = metric.target_value;
  switch (metric.condition_type) {
    case "lte":
      return t === null ? false : value <= t;
    case "between": {
      const lo = metric.minimum_value;
      const hi = metric.maximum_value;
      if (lo === null || hi === null) return false;
      return value >= lo && value <= hi;
    }
    default:
      return t === null ? false : value >= t;
  }
}

/** التقييم ثنائي فقط: 100 عند تحقق الشرط و0 عند عدم تحققه. */
export function scoreMetric(metric: ResolvedMetric, value: number): number {
  return isMet(metric, value) ? 100 : 0;
}
