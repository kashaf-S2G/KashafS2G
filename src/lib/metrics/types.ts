/** أنواع محرك المقاييس — مستقلة تمامًا عن مكوّنات الواجهة. */

export type ConditionType = "gte" | "lte" | "between" | "percent_gte" | "score";
export type ScoringMethod = "binary" | "threshold_linear" | "linear" | "range";
export type ValueType = "days" | "count" | "percent" | "score";

/** تعريف المقياس كما هو مخزّن في كتالوج المقاييس. */
export type MetricDefinition = {
  id: string;
  metric_key: string;
  name: string;
  description: string;
  data_source: string;
  value_type: ValueType | string;
  condition_type: ConditionType | string;
  default_target: number | null;
  default_min: number | null;
  default_max: number | null;
  default_weight: number;
  default_scoring_method: ScoringMethod | string;
  higher_is_better: boolean;
  is_available: boolean;
  is_active: boolean;
  sort_order: number;
  calculation_definition: Record<string, unknown>;
};

/** إعداد المستخدم لمقياس معيّن. */
export type MetricSetting = {
  metric_id: string;
  enabled: boolean;
  target_value: number | null;
  minimum_value: number | null;
  maximum_value: number | null;
  weight: number;
  scoring_method: ScoringMethod | string;
};

/** المقياس بعد دمج تعريفه مع إعداد المستخدم — المدخل الوحيد للمحرك. */
export type ResolvedMetric = MetricDefinition & MetricSetting;

export type MetricResult = {
  metric: ResolvedMetric;
  /** القيمة الفعلية للمنتج، أو null إذا كانت البيانات غير متوفرة. */
  value: number | null;
  /** درجة من 0 إلى 100، أو null إذا كانت البيانات غير متوفرة. */
  score: number | null;
  met: boolean | null;
  /** نص شرط المستخدم، مثل: ≥ 60 يوم */
  conditionLabel: string;
  /** نص القيمة الفعلية، مثل: 84 يوم */
  valueLabel: string;
  /** وزن المقياس بعد التوزيع (مجموع أوزان المقاييس المفعلة = 100). */
  weight: number;
  /** النقاط التي حصل عليها المنتج من هذا المقياس (الوزن كاملًا أو 0). */
  points: number | null;
};

export type ScoredProductBase = { key: string };

export type ScoredProduct<T extends ScoredProductBase> = {
  product: T;
  results: MetricResult[];
  /** الدرجة الإجمالية من 100 محسوبة على البيانات المتاحة فقط. */
  overallScore: number;
  metCount: number;
  evaluatedCount: number;
  enabledCount: number;
  /** نسبة اكتمال البيانات من 0 إلى 100. */
  completeness: number;
  trend: "up" | "flat" | "down" | null;
};
