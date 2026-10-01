import type { FilterFieldType } from "@/components/AdvancedFilter";
import type { ProductSummary } from "@/lib/product-summary";

/** ملخص منتج بدون الإعلانات الخام — هذا ما يصل إلى المتصفح في صفحة المنتجات. */
export type ProductListItem = Omit<ProductSummary, "ads">;

export const PRODUCT_FIELD_VALUES: Record<string, (p: ProductListItem) => string[]> = {
  name: (p) => [p.name],
  code: (p) => [p.code],
  platform: (p) => p.platforms,
  niche: (p) => p.niches,
  page: (p) => p.competitorNames,
  status: (p) => p.statuses,
  activeAds: (p) => [String(p.activeAds)],
  stoppedAds: (p) => [String(p.stoppedAds)],
  activeCompetitors: (p) => [String(p.activeCompetitors)],
  stoppedCompetitors: (p) => [String(p.stoppedCompetitors)],
  activeDays: (p) => [String(p.activeDays)],
  inactiveDays: (p) => [String(p.inactiveDays)],
};

export const PRODUCT_FIELD_LABELS: { id: string; label: string; type: FilterFieldType }[] = [
  { id: "name", label: "اسم المنتج", type: "text" },
  { id: "code", label: "معرف المنتج", type: "text" },
  { id: "platform", label: "المنصة", type: "text" },
  { id: "niche", label: "الفئة", type: "text" },
  { id: "page", label: "المنافس", type: "text" },
  { id: "status", label: "الحالة", type: "text" },
  { id: "activeAds", label: "إعلانات نشطة", type: "number" },
  { id: "stoppedAds", label: "إعلانات متوقفة", type: "number" },
  { id: "activeCompetitors", label: "منافسون نشطون", type: "number" },
  { id: "stoppedCompetitors", label: "منافسون متوقفون", type: "number" },
  { id: "activeDays", label: "أيام نشاط", type: "number" },
  { id: "inactiveDays", label: "أيام توقف", type: "number" },
];

/** نص وصفي لكل منتج يُعطى للذكاء الاصطناعي ليفهم الطلبات الوصفية والعددية من البيانات الفعلية. */
export function aiTerm(p: ProductListItem): string {
  const competitors = p.activeCompetitors + p.stoppedCompetitors;
  return [
    p.name,
    `معرف: ${p.code}`,
    `الوصف: ${p.description ?? "غير متوفر"}`,
    `الفئات: ${p.niches.join("، ") || "غير محددة"}`,
    `المنصات: ${p.platforms.join("، ") || "غير محددة"}`,
    `الصفحات المعلنة: ${p.competitorNames.join("، ") || "لا يوجد"}`,
    `عدد المنافسين: ${competitors}`,
    `عدد الصفحات التي تعلن عنه: ${p.competitorNames.length}`,
    `منافسون نشطون: ${p.activeCompetitors}`,
    `منافسون متوقفون: ${p.stoppedCompetitors}`,
    `إعلانات نشطة: ${p.activeAds}`,
    `إجمالي الإعلانات: ${p.totalAds}`,
  ].join(" — ");
}
