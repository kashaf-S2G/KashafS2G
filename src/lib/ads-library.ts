import type { CompetitorRow } from "@/lib/kashaf";

/**
 * رابط مكتبة الإعلانات الخاصة بالمنافس حسب المنصة.
 * إن لم تكن للمنصة مكتبة إعلانات عامة نعيد رابط المنافس نفسه.
 */
export function adsLibraryUrl(competitor: Pick<CompetitorRow, "competitor_name" | "competitor_url" | "platform">): string {
  const q = encodeURIComponent(competitor.competitor_name.trim());
  switch (competitor.platform) {
    case "Facebook":
    case "Instagram":
      return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&q=${q}&search_type=keyword_unordered&media_type=all`;
    case "TikTok":
      return `https://library.tiktok.com/ads?region=all&adv_name=${q}&adv_biz_ids=&query_type=1`;
    case "YouTube":
      return `https://adstransparency.google.com/?region=anywhere&query=${q}`;
    default:
      // منصات أخرى: نبحث عن اسم المنافس داخل مكتبة إعلانات فيسبوك
      return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&q=${q}&search_type=keyword_unordered&media_type=all`;
  }
}

/** هل للمنصة مكتبة إعلانات عامة؟ */
export function hasAdsLibrary(platform: string): boolean {
  return ["Facebook", "Instagram", "TikTok", "YouTube"].includes(platform);
}
