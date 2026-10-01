/**
 * بطاقة الوصف المعيارية للمنتج: المرجع الذي يعتمد عليه الذكاء الاصطناعي والكود
 * معًا عند مطابقة أي إعلان جديد بمنتج موجود.
 * دوال نقية بلا شبكة — صالحة للخادم والمتصفح والاختبارات.
 */

export type ProductProfile = {
  /** الاسم الحقيقي للمنتج. */
  real_name: string;
  /** المرادفات والمسميات المختلفة (عربي/إنجليزي/عامية). */
  synonyms: string[];
  /** الأشكال والطرازات والمتغيرات (ألوان، مقاسات، إصدارات). */
  variants: string[];
  /** الخصائص والعلامات الفارقة. */
  features: string[];
  /** الاستخدام ووظيفة المنتج. */
  usage: string;
  /** وصف المنتج. */
  description: string;
  /** وصف وتحليل الصور والمعلومات البصرية المهمة. */
  visual: string[];
  /** الفروق التي تجعل منتجين مختلفين فعلًا. */
  distinguishing: string[];
  /** الفروق التي لا تمنع اعتبارهما نفس المنتج. */
  non_distinguishing: string[];
};

export const EMPTY_PROFILE: ProductProfile = {
  real_name: "",
  synonyms: [],
  variants: [],
  features: [],
  usage: "",
  description: "",
  visual: [],
  distinguishing: [],
  non_distinguishing: [],
};

function list(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = typeof item === "string" ? item.trim().slice(0, 160) : "";
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function text(value: unknown, max = 400): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** يقرأ بطاقة وصف مخزّنة (أو ناتج نموذج) إلى شكل آمن ومكتمل. */
export function parseProfile(raw: unknown): ProductProfile {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    real_name: text(source["real_name"], 160),
    synonyms: list(source["synonyms"], 16),
    variants: list(source["variants"]),
    features: list(source["features"]),
    usage: text(source["usage"], 300),
    description: text(source["description"]),
    visual: list(source["visual"]),
    distinguishing: list(source["distinguishing"]),
    non_distinguishing: list(source["non_distinguishing"]),
  };
}

function mergeList(a: string[], b: string[], max: number): string[] {
  const out = [...a];
  for (const item of b) if (!out.some((x) => x.toLowerCase() === item.toLowerCase())) out.push(item);
  return out.slice(0, max);
}

/** يدمج معرفة جديدة في بطاقة قائمة دون فقدان ما سبق. */
export function mergeProfile(base: ProductProfile, next: ProductProfile): ProductProfile {
  return {
    real_name: base.real_name || next.real_name,
    synonyms: mergeList(base.synonyms, next.synonyms, 24),
    variants: mergeList(base.variants, next.variants, 20),
    features: mergeList(base.features, next.features, 20),
    usage: base.usage || next.usage,
    description: base.description || next.description,
    visual: mergeList(base.visual, next.visual, 20),
    distinguishing: mergeList(base.distinguishing, next.distinguishing, 20),
    non_distinguishing: mergeList(base.non_distinguishing, next.non_distinguishing, 20),
  };
}

/** هل البطاقة فارغة عمليًا (لا تصلح مرجعًا للمطابقة)؟ */
export function isEmptyProfile(profile: ProductProfile): boolean {
  return (
    !profile.real_name &&
    !profile.description &&
    !profile.usage &&
    profile.synonyms.length === 0 &&
    profile.features.length === 0
  );
}

/** ملخّص نصي مختصر للبطاقة يُمرَّر للنموذج ضمن قائمة المرشّحين. */
export function profileDigest(profile: ProductProfile, fallbackName: string): string {
  const parts = [
    `الاسم الحقيقي: ${profile.real_name || fallbackName}`,
    profile.synonyms.length ? `مرادفات: ${profile.synonyms.slice(0, 8).join("، ")}` : "",
    profile.variants.length ? `متغيرات: ${profile.variants.slice(0, 6).join("، ")}` : "",
    profile.features.length ? `خصائص فارقة: ${profile.features.slice(0, 6).join("، ")}` : "",
    profile.usage ? `الاستخدام: ${profile.usage}` : "",
    profile.description ? `الوصف: ${profile.description}` : "",
    profile.visual.length ? `بصريًا: ${profile.visual.slice(0, 4).join("، ")}` : "",
    profile.distinguishing.length ? `يختلف عنه إذا: ${profile.distinguishing.slice(0, 5).join("، ")}` : "",
    profile.non_distinguishing.length
      ? `لا يختلف بسبب: ${profile.non_distinguishing.slice(0, 5).join("، ")}`
      : "",
  ].filter(Boolean);
  return parts.join(" | ").slice(0, 900);
}

/** مخطط JSON الصارم لبطاقة الوصف كما يعيدها النموذج. */
export const PROFILE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    real_name: { type: "string", description: "اسم المنتج الحقيقي بالعربية بكلمات قليلة" },
    synonyms: { type: "array", items: { type: "string" } },
    variants: { type: "array", items: { type: "string" } },
    features: { type: "array", items: { type: "string" } },
    usage: { type: "string" },
    description: { type: "string" },
    visual: { type: "array", items: { type: "string" } },
    distinguishing: { type: "array", items: { type: "string" } },
    non_distinguishing: { type: "array", items: { type: "string" } },
  },
  required: [
    "real_name",
    "synonyms",
    "variants",
    "features",
    "usage",
    "description",
    "visual",
    "distinguishing",
    "non_distinguishing",
  ],
} as const;
