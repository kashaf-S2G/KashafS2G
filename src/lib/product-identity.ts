/**
 * هوية المنتج: تنظيف الاسم وتطبيعه ومقارنة المنتجات.
 * دوال نقية بلا أي اتصال بالشبكة — تُستخدم على الخادم والمتصفح والاختبارات.
 */

/** كلمات لا تدل على منتج: أسماء متاجر وبراندات عامة وكلمات تسويقية وتصنيفات فضفاضة. */
const NOISE_WORDS = new Set(
  [
    // متاجر وصفحات
    "متجر", "متاجر", "محل", "معرض", "صفحة", "حساب", "شركة", "مؤسسة", "مركز", "ماركة", "براند",
    "store", "shop", "shopping", "official", "page", "company", "brand", "market", "mall", "online",
    // كلمات تسويقية
    "عرض", "عروض", "خصم", "خصومات", "تخفيضات", "تخفيض", "مجانا", "مجاني", "توصيل", "شحن", "الدفع",
    "الاستلام", "اطلب", "اطلبي", "الان", "الآن", "جديد", "جديدة", "افضل", "أفضل", "اقوى", "أقوى",
    "حصري", "حصرية", "اصلي", "أصلي", "اصلية", "جمله", "جملة", "قطاعي", "سعر", "بسعر", "ريال",
    "جنيه", "درهم", "دينار", "تواصل", "واتساب", "رابط", "اضغط", "sale", "offer", "discount", "free",
    "delivery", "new", "best", "original", "price", "buy", "order", "now", "whatsapp",
    // تصنيفات عامة جدًا
    "منتج", "منتجات", "مستلزمات", "ادوات", "أدوات", "اكسسوار", "اكسسوارات", "إكسسوارات",
    "ملابس", "موديل", "قسم", "تشكيلة", "مجموعة", "collection", "products", "items",
    // حشو
    "من", "في", "على", "مع", "الى", "إلى", "عن", "او", "أو", "و", "ال", "هذا", "هذه", "the", "of",
    "for", "and", "with", "a", "an",
  ],
);

/** تطبيع الحروف العربية والأرقام والرموز. */
export function normalizeArabic(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** إزالة أداة التعريف حتى يتطابق "العرقسوس" مع "عرقسوس". */
function stripArticle(word: string): string {
  if (word.length > 4 && word.startsWith("ال")) return word.slice(2);
  return word;
}

/** كلمات المنتج الدالة بعد إزالة الحشو وأسماء المتاجر والكلمات التسويقية. */
export function productTokens(name: string): string[] {
  const words = normalizeArabic(name).split(" ").filter(Boolean);
  const kept = words
    .map(stripArticle)
    .filter((w) => w.length > 1 && !NOISE_WORDS.has(w) && !/^\d+$/.test(w));
  return [...new Set(kept.length ? kept : words.filter(Boolean))];
}

/** اسم المنتج بعد التنظيف، مع الحفاظ على ترتيب الكلمات الأصلي. */
export function cleanProductName(raw: string): string {
  const original = raw.trim().split(/\s+/).filter(Boolean);
  const keep = new Set(productTokens(raw));
  const words = original.filter((w) => keep.has(normalizeArabic(w)));
  const out = (words.length ? words : original).join(" ").trim();
  return out.slice(0, 120) || raw.trim().slice(0, 120);
}

/**
 * مفتاح الهوية: كلمات المنتج الدالة مرتبة أبجديًا، فيصبح "شاحن سيارة" و"سيارة شاحن"
 * نفس المفتاح، ولا تفرّقهما علامات الترقيم أو صيغة الحروف.
 */
export function productIdentityKey(name: string): string {
  return productTokens(name).sort().join(" ");
}

/** نسبة تشابه بين اسمي منتج بين 0 و1 (تقاطع الكلمات الدالة). */
export function productSimilarity(a: string, b: string): number {
  const left = new Set(productTokens(a));
  const right = new Set(productTokens(b));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** هل الاسم بلا أي كلمة دالة على منتج (اسم متجر أو تصنيف عام فقط)؟ */
export function isNonProductName(raw: string): boolean {
  return productTokens(raw).length === 0;
}

/**
 * رؤوس عامة: كلمات تصف نوع المنتج فقط ولا تحدد هويته (كريم، زيت، جهاز...).
 * اسم يتكوّن من هذه الكلمات فقط لا يصلح للدمج، لأن «كريم للشعر» و«كريم للبشرة»
 * منتجان مختلفان تمامًا رغم تشابه الاسم.
 */
const GENERIC_HEADS = new Set([
  "كريم", "كريمه", "زيت", "سيروم", "شامبو", "بلسم", "صابون", "غسول", "لوشن", "مرطب", "جل",
  "بودره", "بخاخ", "سبراي", "صبغه", "ماسك", "عطر", "برفان", "بارفان", "ديودرنت",
  "حبوب", "كبسولات", "اقراص", "مكمل", "فيتامين", "شراب", "مشروب", "شاي", "قهوه", "عسل",
  "جهاز", "اله", "ماكينه", "مكنه", "شاحن", "كابل", "سماعه", "سماعات", "ساعه", "موبايل",
  "حقيبه", "شنطه", "حذاء", "جاكيت", "فستان", "بنطلون", "قميص", "طقم", "بلوزه", "عبايه",
  "مفرش", "مرتبه", "بطانيه", "سجاده", "كرسي", "طاوله", "سرير", "لمبه", "مصباح", "مروحه",
  "خلاط", "مكواه", "علبه", "زجاجه", "فرشه", "مشط", "لعبه", "منظف", "مسحوق", "معطر", "دهان",
  "cream", "oil", "serum", "shampoo", "soap", "gel", "spray", "powder", "mask", "perfume",
  "device", "machine", "charger", "cable", "watch", "bag", "shoes", "lamp", "set", "kit",
]);

/**
 * هل الاسم عام لا يحدد هوية منتج بذاته؟ (لا كلمات دالة، أو كلماته كلها رؤوس عامة)
 * في هذه الحالة يجب ألّا يُدمج المنتج بالاسم وحده، بل بفهم وظيفته وخصائصه.
 */
export function isGenericIdentity(raw: string): boolean {
  const tokens = productTokens(raw);
  if (tokens.length === 0) return true;
  return tokens.every((t) => GENERIC_HEADS.has(t));
}

/** معرف مختصر ثابت مبني على مفتاح الهوية. */
export function productCodeFromKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 1679616;
  return `P-${hash.toString(36).toUpperCase().padStart(4, "0")}`;
}
