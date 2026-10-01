import type { AdWithCompetitor } from "@/lib/kashaf";
import type { ProductSummary } from "@/lib/product-summary";

/**
 * سجل حسابات قيم المقاييس.
 * كل مقياس جديد يُضاف هنا بمفتاحه فقط، دون أي تعديل على صفحة Top10.
 * إذا لم يوجد حساب للمفتاح، تُعتبر بيانات المقياس غير متوفرة (null).
 */
export type MetricValueComputer = (product: ProductSummary, todayMs: number) => number | null;

const DAY = 86_400_000;

function startMs(ad: AdWithCompetitor) {
  return Date.parse(`${ad.creation_date}T00:00:00Z`);
}

function endMs(ad: AdWithCompetitor, todayMs: number) {
  if (ad.status === "active") return todayMs;
  return ad.end_date ? Date.parse(`${ad.end_date}T00:00:00Z`) : todayMs;
}

function monthKey(ms: number) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** توزيع أيام النشاط على الأشهر لكل إعلانات المنتج، مع إمكانية حصره في نافذة زمنية. */
function monthlyActivity(product: ProductSummary, todayMs: number, fromMs = -Infinity) {
  const months = new Map<string, number>();
  for (const ad of product.ads) {
    let cursor = startMs(ad);
    const end = endMs(ad, todayMs);
    if (!Number.isFinite(cursor) || !Number.isFinite(end)) continue;
    if (cursor < fromMs) cursor = fromMs;
    while (cursor <= end) {
      const k = monthKey(cursor);
      months.set(k, (months.get(k) ?? 0) + 1);
      cursor += DAY;
    }
  }
  return months;
}

/** بداية نافذة الـ12 شهرًا الأخيرة. */
function last12MonthsStart(todayMs: number) {
  const d = new Date(todayMs);
  return Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth() + 1, 1);
}

/** أول تاريخ بدء لكل صفحة تعلن عن المنتج. */
function firstStartByCompetitor(product: ProductSummary) {
  const map = new Map<string, number>();
  for (const ad of product.ads) {
    if (!ad.competitor_id) continue;
    const s = startMs(ad);
    if (!Number.isFinite(s)) continue;
    const prev = map.get(ad.competitor_id);
    if (prev === undefined || s < prev) map.set(ad.competitor_id, s);
  }
  return map;
}

function lastEndByCompetitor(product: ProductSummary, todayMs: number) {
  const map = new Map<string, number>();
  for (const ad of product.ads) {
    if (!ad.competitor_id) continue;
    const e = endMs(ad, todayMs);
    if (!Number.isFinite(e)) continue;
    const prev = map.get(ad.competitor_id);
    if (prev === undefined || e > prev) map.set(ad.competitor_id, e);
  }
  return map;
}

export const METRIC_VALUES: Record<string, MetricValueComputer> = {
  ad_longevity: (p, today) => {
    if (p.ads.length === 0) return null;
    const first = Math.min(...p.ads.map(startMs));
    const last = Math.max(...p.ads.map((a) => endMs(a, today)));
    if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
    return Math.max(0, Math.round((last - first) / DAY));
  },

  current_spread: (p) => p.activeCompetitors,

  historical_spread: (p) => {
    const ids = new Set(p.ads.map((a) => a.competitor_id).filter(Boolean));
    return ids.size;
  },

  advertiser_growth: (p, today) => {
    const windowDays = 30;
    const firsts = [...firstStartByCompetitor(p).values()];
    if (firsts.length === 0) return null;
    const w = windowDays * DAY;
    const recent = firsts.filter((s) => s > today - w).length;
    const previous = firsts.filter((s) => s > today - 2 * w && s <= today - w).length;
    if (previous === 0) return recent > 0 ? 100 : 0;
    return Math.round(((recent - previous) / previous) * 100);
  },

  advertiser_retention: (p, today) => {
    const retentionDays = 30;
    const firsts = firstStartByCompetitor(p);
    const lasts = lastEndByCompetitor(p, today);
    // نحتسب فقط المنافسين الذين مضى على بدايتها المدة المحددة، وإلا فالبيانات غير كافية.
    const eligible = [...firsts.entries()].filter(
      ([, s]) => today - s >= retentionDays * DAY,
    );
    if (eligible.length === 0) return null;
    const retained = eligible.filter(
      ([id, s]) => (lasts.get(id) ?? s) - s >= retentionDays * DAY,
    ).length;
    return Math.round((retained / eligible.length) * 100);
  },

  activity_strength: (p) => {
    if (p.totalAds === 0) return null;
    return Math.round((p.activeAds / p.totalAds) * 100);
  },

  // عدد أشهر النشاط خلال آخر 12 شهرًا ÷ 12 × 100
  demand_stability: (p, today) => {
    const months = monthlyActivity(p, today, last12MonthsStart(today));
    if (months.size === 0) return null;
    return Math.round((months.size / 12) * 100);
  },

  // أكبر نشاط في شهر واحد ÷ إجمالي النشاط خلال آخر 12 شهرًا × 100
  seasonality: (p, today) => {
    const months = monthlyActivity(p, today, last12MonthsStart(today));
    if (months.size === 0) return null;
    const values = [...months.values()];
    const total = values.reduce((a, b) => a + b, 0);
    if (total === 0) return null;
    return Math.round((Math.max(...values) / total) * 100);
  },
};

/** اتجاه المنتج مبني على عدد الإعلانات الجديدة في آخر 30 يومًا مقابل الـ30 التي قبلها. */
export function productTrend(p: ProductSummary, todayMs: number): "up" | "flat" | "down" | null {
  if (p.ads.length === 0) return null;
  const w = 30 * DAY;
  const starts = p.ads.map(startMs).filter(Number.isFinite);
  const oldest = Math.min(...starts);
  if (todayMs - oldest < w) return null;
  const recent = starts.filter((s) => s > todayMs - w).length;
  const previous = starts.filter((s) => s > todayMs - 2 * w && s <= todayMs - w).length;
  if (recent > previous) return "up";
  if (recent < previous) return "down";
  return "flat";
}
