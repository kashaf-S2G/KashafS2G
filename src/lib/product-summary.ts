import type { AdWithCompetitor } from "@/lib/kashaf";
import { productCode, productKey } from "@/lib/product";

/** ملخص منتج واحد مبني من إعلاناته. يُستخدم في صفحة المنتجات وصفحة Top10. */
export type ProductSummary = {
  key: string;
  name: string;
  code: string;
  image: string | null;
  description: string | null;
  activeCompetitors: number;
  stoppedCompetitors: number;
  activeAds: number;
  stoppedAds: number;
  activeDays: number;
  inactiveDays: number;
  totalAds: number;
  platforms: string[];
  niches: string[];
  competitorNames: string[];
  statuses: string[];
  /** الإعلانات الخام للمنتج — مصدر البيانات لمحرك المقاييس. */
  ads: AdWithCompetitor[];
};

export function summarize(ads: AdWithCompetitor[], overrides?: Map<string, string>): ProductSummary[] {
  const map = new Map<
    string,
    ProductSummary & {
      activeCompetitorIds: Set<string>;
      stoppedCompetitorIds: Set<string>;
      platformSet: Set<string>;
      nicheSet: Set<string>;
      competitorNameSet: Set<string>;
      statusSet: Set<string>;
    }
  >();
  for (const ad of ads) {
    const displayName = (ad.canonical_product_name ?? ad.product_name).trim();
    const nameKey = productKey(displayName);
    // المصدر الأول للحقيقة هو المنتج الموحّد في قاعدة البيانات، ثم المعرف اليدوي،
    // ثم المعرف المحسوب من الاسم للإعلانات القديمة التي لم تُعالج بعد.
    const code = overrides?.get(nameKey) ?? ad.product_code ?? productCode(displayName);
    // التجميع بالمنتج الموحّد إن وُجد، وإلا بالمعرف.
    const key = ad.product_id ?? code;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        key,
        name: ad.product_name.trim(),
        code,
        image: null,
        description: null,
        activeCompetitors: 0,
        stoppedCompetitors: 0,
        activeAds: 0,
        stoppedAds: 0,
        activeDays: 0,
        inactiveDays: 0,
        totalAds: 0,
        platforms: [],
        niches: [],
        competitorNames: [],
        statuses: [],
        ads: [],
        activeCompetitorIds: new Set<string>(),
        stoppedCompetitorIds: new Set<string>(),
        platformSet: new Set<string>(),
        nicheSet: new Set<string>(),
        competitorNameSet: new Set<string>(),
        statusSet: new Set<string>(),
      };
      map.set(key, entry);
    }
    entry.ads.push(ad);
    if (!entry.image && ad.image_url) entry.image = ad.image_url;
    // Multiple ads can describe the same product; keep the most complete text
    // rather than the first (often a short, automatically extracted caption).
    const description = ad.product_description?.trim();
    if (description && description.length > (entry.description?.length ?? 0)) {
      entry.description = description;
    }
    if (ad.status === "active") {
      if (ad.competitor_id) entry.activeCompetitorIds.add(ad.competitor_id);
      entry.activeAds += 1;
    } else {
      if (ad.competitor_id) entry.stoppedCompetitorIds.add(ad.competitor_id);
      entry.stoppedAds += 1;
    }
    entry.statusSet.add(ad.status === "active" ? "نشط" : "متوقف");
    if (ad.competitor?.platform) entry.platformSet.add(ad.competitor.platform.trim());
    if (ad.competitor?.niche) entry.nicheSet.add(ad.competitor.niche.trim());
    if (ad.competitor?.competitor_name) entry.competitorNameSet.add(ad.competitor.competitor_name.trim());
    entry.activeDays += ad.active_days ?? 0;
    entry.inactiveDays += ad.inactive_days ?? 0;
    entry.totalAds += 1;
  }
  return [...map.values()]
    .map(
      ({
        activeCompetitorIds,
        stoppedCompetitorIds,
        platformSet,
        nicheSet,
        competitorNameSet,
        statusSet,
        ...rest
      }) => ({
        ...rest,
        platforms: [...platformSet],
        niches: [...nicheSet],
        competitorNames: [...competitorNameSet],
        statuses: [...statusSet],
        activeCompetitors: activeCompetitorIds.size,
        // منافس يُحتسب متوقفة فقط إذا لم يعد بها أي إعلان نشط لهذا المنتج
        stoppedCompetitors: [...stoppedCompetitorIds].filter((id) => !activeCompetitorIds.has(id)).length,
      }),
    )
    .sort((a, b) => b.totalAds - a.totalAds || a.name.localeCompare(b.name, "ar"));
}

/** يضيف المنتجات الموحّدة التي لا تملك أي إعلان (مثل المنتجات المضافة يدويًا). */
export function withStandaloneProducts(
  list: ProductSummary[],
  rows: { id: string; canonical_name: string; code: string; image_url: string | null; profile: unknown }[],
): ProductSummary[] {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const known = new Set(list.map((p) => p.key));
  const extra: ProductSummary[] = rows
    .filter((r) => !known.has(r.id))
    .map((r) => {
      const desc = (r.profile as { description?: unknown } | null)?.description;
      return {
        key: r.id,
        name: r.canonical_name,
        code: r.code,
        image: r.image_url,
        description: typeof desc === "string" && desc.trim() ? desc : null,
        activeCompetitors: 0,
        stoppedCompetitors: 0,
        activeAds: 0,
        stoppedAds: 0,
        activeDays: 0,
        inactiveDays: 0,
        totalAds: 0,
        platforms: [],
        niches: [],
        competitorNames: [],
        statuses: [],
        ads: [],
      };
    });
  return [...extra, ...list.map((product) => {
    const row = rowsById.get(product.key);
    if (!row) return product;
    const description = (row.profile as { description?: unknown } | null)?.description;
    return {
      ...product,
      name: row.canonical_name,
      image: row.image_url ?? product.image,
      description: typeof description === "string" && description.trim() ? description.trim() : product.description,
    };
  })];
}
