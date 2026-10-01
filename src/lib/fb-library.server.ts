/** جلب وقراءة مكتبة إعلانات فيسبوك — بدون أي ذكاء اصطناعي. ملف خادم فقط. */
export type CrawledAd = {
  sourceAdId: string;
  sourceUrl: string;
  /** معرّف صفحة فيسبوك الحقيقي لصاحب الإعلان (المرجع في تحديد المنافس). */
  pageId: string | null;
  pageName: string;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  text: string;
  imageUrl: string | null;
};

function unescapeJson(raw: string) {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\\//g, "/");
  }
}

function field(chunk: string, name: string): string {
  const m = chunk.match(new RegExp(`"${name}":"((?:[^"\\\\]|\\\\.)*)"`));
  return m?.[1] ? unescapeJson(m[1]) : "";
}

function num(chunk: string, name: string): number | null {
  const m = chunk.match(new RegExp(`"${name}":(\\d+)`));
  return m?.[1] ? Number(m[1]) : null;
}

function isoFromEpoch(seconds: number | null): string | null {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** تطبيع الاسم للمقارنة بين اسم الصفحة عندنا واسم الصفحة في فيسبوك. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0640]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** رابط البحث داخل مكتبة إعلانات فيسبوك باسم الصفحة. */
export function searchUrl(pageName: string): string {
  const q = encodeURIComponent(pageName.trim());
  return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&q=${q}&search_type=keyword_unordered&media_type=all`;
}

/** رابط عرض كل إعلانات صفحة بمعرّفها الحقيقي. */
export function pageAdsUrl(
  pageId: string,
  activeStatus: string,
  mediaType: string,
  country: string,
): string {
  return `https://www.facebook.com/ads/library/?active_status=${activeStatus}&ad_type=all&country=${country}&view_all_page_id=${encodeURIComponent(pageId)}&search_type=page&media_type=${mediaType}`;
}

/**
 * قائمة الطلبات التي تُستنفد للوصول إلى كل إعلانات الصفحة المتاحة:
 * كل حالة (نشط/متوقف/الكل) × كل نوع وسيط × النطاق الجغرافي.
 * فيسبوك يقدّم دفعة محدودة لكل طلب، فاستنفاد الدفعات هو ما يوسّع التغطية.
 */
export function libraryRequestUrls(target: {
  pageName: string;
  pageId?: string | null;
}): string[] {
  // عدد قليل من الطلبات المركّزة: كثرة الطلبات تجعل فيسبوك يعيد صفحات فارغة.
  const urls: string[] = [];
  if (target.pageId) {
    for (const [s, c] of [["all", "ALL"], ["active", "ALL"], ["inactive", "ALL"], ["all", "EG"]] as const)
      urls.push(pageAdsUrl(target.pageId, s, "all", c));
    return urls;
  }
  const q = encodeURIComponent(target.pageName.trim());
  if (q) {
    for (const s of ["all", "active", "inactive"]) {
      urls.push(`https://www.facebook.com/ads/library/?active_status=${s}&ad_type=all&country=ALL&q=${q}&search_type=keyword_unordered&media_type=all`);
    }
  }
  return urls;
}

/** شرائح الترقيم: فيسبوك لا يتيح مؤشر صفحات عبر الطلب العادي، فنقسّم النتائج بنوع الوسيط لتوسيع التغطية. */
export const PAGINATION_SLICES = ["image", "video", "meme", "none"] as const;

/** رابط الدفعة التالية لنفس المسار (أو null إن انتهت الشرائح). */
export function nextBatchUrl(url: string, batch: number): { url: string; cursor: string } | null {
  const slice = PAGINATION_SLICES[batch - 1];
  if (!slice) return null;
  const u = new URL(url);
  u.searchParams.set("media_type", slice);
  return { url: u.toString(), cursor: `media_type=${slice}` };
}

/** يقرأ دفعة ويعيد معها مؤشر وجود نتائج إضافية من المصدر. */
export async function fetchLibraryBatch(url: string): Promise<{ ads: CrawledAd[]; hasMore: boolean; cursor: string | null }> {
  let hasMore = false;
  let cursor: string | null = null;
  const ads = await fetchLibraryPage(url, (html) => {
    hasMore = /"has_next_page":true/.test(html);
    cursor = html.match(/"(?:end_cursor|forward_cursor)":"([^"]{4,400})"/)?.[1] ?? null;
  });
  return { ads, hasMore, cursor };
}

/** يقرأ دفعة نتائج واحدة من مكتبة الإعلانات ويستخرج كل الإعلانات الظاهرة فيها. */
export async function fetchLibraryPage(url: string, onHtml?: (html: string) => void): Promise<CrawledAd[]> {
  const res = await fetch(url, {
    headers: {
      // فيسبوك يحجب الطلبات العادية لكنه يقدّم بيانات المكتبة لزاحف المعاينة.
      "User-Agent": "facebookexternalhit/1.1",
      "Accept-Language": "ar,en;q=0.8",
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = (await res.text()).slice(0, 6_000_000);
  // صفحة المكتبة الحقيقية تحتوي بياناتها؛ غيابها يعني حجبًا مؤقتًا أو صفحة تسجيل دخول.
  if (!html.includes("ad_library") && !html.includes("ad_archive_id")) throw new Error("blocked");
  onHtml?.(html);

  const marker = '"ad_archive_id":"';
  const out: CrawledAd[] = [];
  const seen = new Set<string>();
  let index = html.indexOf(marker);
  while (index !== -1) {
    const next = html.indexOf(marker, index + marker.length);
    const chunk = html.slice(index, next === -1 ? index + 12_000 : Math.min(next, index + 12_000));
    const id = chunk.match(/"ad_archive_id":"(\d+)"/)?.[1];
    index = next;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const text = [
      field(chunk, "title"),
      field(chunk, "link_description"),
      chunk.match(/"body":\{"text":"((?:[^"\\]|\\.)*)"/)?.[1]
        ? unescapeJson(chunk.match(/"body":\{"text":"((?:[^"\\]|\\.)*)"/)![1]!)
        : "",
      field(chunk, "caption"),
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 2000);

    const image =
      field(chunk, "original_image_url") ||
      field(chunk, "resized_image_url") ||
      field(chunk, "video_preview_image_url") ||
      null;

    const active = /"is_active":true/.test(chunk);
    out.push({
      sourceAdId: id,
      sourceUrl: `https://www.facebook.com/ads/library/?id=${id}`,
      pageId: chunk.match(/"page_id":"(\d+)"/)?.[1] ?? null,
      pageName: field(chunk, "page_name"),
      isActive: active,
      startDate: isoFromEpoch(num(chunk, "start_date")),
      endDate: active ? null : isoFromEpoch(num(chunk, "end_date")),
      text,
      imageUrl: image,
    });
  }
  return out;
}

/**
 * يجلب كل إعلانات المنافس المتاحة: يستنفد كل دفعات النتائج حتى تتوقف الدفعات
 * عن إضافة أي إعلان جديد. لا يوجد حد ثابت لعدد الإعلانات.
 */
export async function fetchAllLibraryAds(
  target: { pageName: string; pageId?: string | null },
  options?: { hardCap?: number; deadline?: number },
): Promise<{ ads: CrawledAd[]; requests: number; exhausted: boolean }> {
  const hardCap = options?.hardCap ?? 5000;
  const byId = new Map<string, CrawledAd>();
  const urls = libraryRequestUrls(target);
  let requests = 0;
  let failures = 0;
  let exhausted = true;
  let lastFailure = "";

  for (const url of urls) {
    if (byId.size >= hardCap || (options?.deadline && Date.now() > options.deadline)) {
      exhausted = false;
      break;
    }
    let batch: CrawledAd[] | null = null;
    for (let attempt = 0; attempt < 3 && batch === null; attempt++) {
      try {
        batch = await fetchLibraryPage(url);
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    requests += 1;
    if (batch === null) {
      failures += 1;
      continue;
    }
    for (const ad of batch) if (!byId.has(ad.sourceAdId)) byId.set(ad.sourceAdId, ad);
  }

  if (byId.size === 0 && target.pageId && requests > 0) {
    console.warn(`[ad-crawl] Empty results for page ${target.pageId}; requests=${requests}, failures=${failures}, lastFailure=${lastFailure}`);
    throw new Error("لم تُرجع مكتبة إعلانات فيسبوك إعلانات لهذه الصفحة؛ لا يمكن تأكيد نتيجة صفر. حاول مرة أخرى لاحقًا.");
  }
  if (byId.size === 0 && requests > 0 && failures === requests) {
    throw new Error("تعذّر الوصول إلى مكتبة إعلانات فيسبوك الآن (حجب مؤقت). أعد المحاولة بعد قليل.");
  }
  return { ads: [...byId.values()], requests, exhausted };
}

