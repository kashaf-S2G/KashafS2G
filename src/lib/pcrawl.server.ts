/**
 * منظومة زحف المنتجات — الإعلان هو وحدة البحث الأساسية.
 *
 * المسار الكامل:
 *   المنتجات المستهدفة → ملف بحث مؤقت لكل منتج → اختيار مصطلحات وفئات من البنك
 *   → Search Vocabulary → البحث عن إعلانات → إعلانات مرشحة → تحليل الإعلان ونصه وصورته
 *   → مطابقة هوية المنتج → إعلان مثبت → صفحة الإعلان تصبح مرشحًا منافسًا للمنتج.
 *
 * لا تُقبل صفحة إلا بإعلان مثبت لنفس المنتج الحقيقي، ولا يُنشأ منتج جديد من هذا المسار.
 * ملف خادم فقط.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { AiBlockedError, classifyAd, limitWords } from "@/lib/ad-crawl.server";
import { AI_MODEL, type AiOperation, aiApiKey, aiResponses } from "@/lib/ai-endpoint.server";
import { profileDigest, parseProfile } from "@/lib/product-profile";
import { EMPTY_RESEARCH, type PcrawlPhase, type PcrawlProgress, type ResearchProfile } from "@/lib/pcrawl.types";

type Db = SupabaseClient<Database>;

/** عدد المنتجات في الزحف العام لكل تشغيل. */
export const GENERAL_PRODUCTS = 8;
/** عدد المنتجات في الزحف الدوري لكل تشغيل. */
export const SCHEDULED_PRODUCTS = 5;
/** أقصى عدد مفاتيح بحث في الدورة الواحدة. */
const MAX_KEYS = 40;
/** أقصى عدد إعلانات تُقرأ من نتيجة بحث واحدة. */
const MAX_ADS_PER_SEARCH = 60;
/** عدد الإعلانات التي تُحلّل في الخطوة الواحدة. */
const ADS_PER_STEP = 2;
/** أقل درجة مطابقة تُقبل كإثبات. */
const MIN_MATCH = 0.75;
const MODEL = AI_MODEL;

// ------------------------------------------------------------------ أدوات عامة

export function keyOf(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function strList(value: unknown, max = 12, len = 160): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = typeof item === "string" ? item.trim().slice(0, len) : "";
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function str(value: unknown, max = 300): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function parseResearch(raw: unknown): ResearchProfile {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    real_name: str(s["real_name"], 160),
    alt_names: strList(s["alt_names"], 12),
    synonyms: strList(s["synonyms"], 16),
    description: str(s["description"], 500),
    category: str(s["category"], 80),
    usage: str(s["usage"], 300),
    function_use: str(s["function_use"], 300),
    features: strList(s["features"], 14),
    specs: strList(s["specs"], 14),
    form_design: str(s["form_design"], 300),
    sizes: strList(s["sizes"], 10),
    capacity: str(s["capacity"], 80),
    material: str(s["material"], 120),
    brand: str(s["brand"], 80),
    identifiers: strList(s["identifiers"], 10),
    distinguishing: strList(s["distinguishing"], 12),
  };
}

export function researchDigest(r: ResearchProfile, fallbackName: string): string {
  return [
    `الاسم: ${r.real_name || fallbackName}`,
    r.alt_names.length ? `أسماء بديلة: ${r.alt_names.join("، ")}` : "",
    r.synonyms.length ? `مرادفات: ${r.synonyms.join("، ")}` : "",
    r.category ? `الفئة: ${r.category}` : "",
    r.usage ? `الاستخدام: ${r.usage}` : "",
    r.function_use ? `الوظيفة: ${r.function_use}` : "",
    r.description ? `الوصف: ${r.description}` : "",
    r.features.length ? `الخصائص: ${r.features.join("، ")}` : "",
    r.specs.length ? `المواصفات: ${r.specs.join("، ")}` : "",
    r.form_design ? `الشكل والتصميم: ${r.form_design}` : "",
    r.sizes.length ? `المقاسات: ${r.sizes.join("، ")}` : "",
    r.capacity ? `القدرة/الحجم: ${r.capacity}` : "",
    r.material ? `الخامة: ${r.material}` : "",
    r.brand ? `العلامة التجارية: ${r.brand}` : "",
    r.identifiers.length ? `أرقام ومواصفات مميزة: ${r.identifiers.join("، ")}` : "",
    r.distinguishing.length ? `يختلف عنه إذا: ${r.distinguishing.join("، ")}` : "",
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 1400);
}

/** يقرأ نص نتيجة Responses API غير المتدفّقة. */
async function readJsonResponse(res: Response, what: string): Promise<Record<string, unknown>> {
  const body = await res.text();
  if (!res.ok) {
    let providerMessage = "";
    let providerType = "";
    let providerCode = "";
    try {
      const parsed = JSON.parse(body) as {
        error?: { message?: unknown; type?: unknown; code?: unknown };
        message?: unknown;
      };
      providerMessage = String(parsed.error?.message ?? parsed.message ?? "").trim();
      providerType = String(parsed.error?.type ?? "").trim();
      providerCode = String(parsed.error?.code ?? "").trim();
    } catch {
      providerMessage = body.trim().slice(0, 500);
    }

    const marker = [providerType, providerCode].filter(Boolean).join(" / ");
    const detail = [providerMessage, marker ? `(${marker})` : ""].filter(Boolean).join(" ");
    if (providerType === "insufficient_quota" || providerCode === "credit_balance_exhausted") {
      throw new AiBlockedError(
        "نفد رصيد حساب OpenAI المرتبط بالمشروع. أضف رصيدًا في فوترة OpenAI ثم اضغط «استئناف».",
      );
    }
    if (res.status === 402) {
      throw new AiBlockedError(detail || "انتهى رصيد الذكاء الاصطناعي، يرجى إضافة رصيد.");
    }
    if (res.status === 403) {
      throw new AiBlockedError(detail || "خدمة الذكاء الاصطناعي موقوفة لهذا الحساب.");
    }
    if (res.status === 429) {
      throw new AiBlockedError(detail || "رفضت OpenAI الطلب بسبب حد الاستخدام (429).");
    }
    throw new Error(`${what} (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const json = JSON.parse(body) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  let text = json.output_text ?? "";
  if (!text) {
    for (const item of json.output ?? []) {
      for (const c of item.content ?? []) if (c.type === "output_text" && c.text) text += c.text;
    }
  }
  return JSON.parse(text) as Record<string, unknown>;
}

export async function ask(
  apiKey: string,
  content: Array<Record<string, unknown>>,
  schemaName: string,
  schema: Record<string, unknown>,
  what: string,
  ownerId?: string | null,
  operation: AiOperation = "other",
): Promise<Record<string, unknown>> {
  const res = await aiResponses(apiKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      input: [{ role: "user", content }],
      stream: false,
      store: false,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: schemaName, strict: true, schema } },
    }),
  }, ownerId, operation);
  return await readJsonResponse(res, what);
}

// ------------------------------------------------------------------ (1) ملف البحث المؤقت

type ProductRow = {
  id: string;
  canonical_name: string;
  code: string;
  image_url: string | null;
  profile: unknown;
};

const RESEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    real_name: { type: "string" },
    alt_names: { type: "array", items: { type: "string" } },
    synonyms: { type: "array", items: { type: "string" } },
    description: { type: "string" },
    category: { type: "string" },
    usage: { type: "string" },
    function_use: { type: "string" },
    features: { type: "array", items: { type: "string" } },
    specs: { type: "array", items: { type: "string" } },
    form_design: { type: "string" },
    sizes: { type: "array", items: { type: "string" } },
    capacity: { type: "string" },
    material: { type: "string" },
    brand: { type: "string" },
    identifiers: { type: "array", items: { type: "string" } },
    distinguishing: { type: "array", items: { type: "string" } },
  },
  required: [
    "real_name",
    "alt_names",
    "synonyms",
    "description",
    "category",
    "usage",
    "function_use",
    "features",
    "specs",
    "form_design",
    "sizes",
    "capacity",
    "material",
    "brand",
    "identifiers",
    "distinguishing",
  ],
} as const;

/** يبني ملف بحث مؤقت لمنتج مستهدف (لا يمسّ المنتج الأصلي إطلاقًا). */
export async function buildResearchProfile(
  apiKey: string,
  product: ProductRow,
  adSample: { text: string; imageUrl: string | null } | null,
  ownerId?: string | null,
): Promise<ResearchProfile> {
  const stored = parseProfile(product.profile);
  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text:
        `افهم هوية هذا المنتج الحقيقية لغرض البحث عن إعلانات تعلن عنه.\n` +
        `اسم المنتج: ${product.canonical_name}\n` +
        `ما نعرفه عنه: ${profileDigest(stored, product.canonical_name)}\n` +
        (adSample?.text ? `نموذج من إعلان له:\n${limitWords(adSample.text, 120)}\n` : "") +
        `أعد وصفًا كاملًا: الاسم الحقيقي، أسماء بديلة، مرادفات (عربي وإنجليزي وعامية مصرية)، الوصف، الفئة، ` +
        `الاستخدام، الوظيفة، الخصائص، المواصفات، الشكل والتصميم، المقاسات، القدرة أو الحجم، الخامة، ` +
        `العلامة التجارية، أي أرقام أو مواصفات مميزة، وما يجعل منتجًا آخر مختلفًا عنه فعليًا.\n` +
        `اترك أي حقل غير معروف نصًا فارغًا أو قائمة فارغة، ولا تخترع معلومات.`,
    },
  ];
  const image = adSample?.imageUrl ?? product.image_url;
  if (image && /^https?:\/\//.test(image)) content.push({ type: "input_image", image_url: image });

  const parsed = await ask(apiKey, content, "product_research", RESEARCH_SCHEMA, "تعذّر بناء ملف بحث المنتج", ownerId, "product_research");
  const out = parseResearch(parsed);
  return { ...out, real_name: out.real_name || product.canonical_name };
}

// ------------------------------------------------------------------ (2+3) Search Vocabulary

export type VocabKey = { key: string; kind: string; productIds: string[] };

const VOCAB_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    keys: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string" },
          kind: { type: "string", enum: ["product_name", "alt_name", "synonym", "term", "category"] },
          product_codes: { type: "array", items: { type: "string" } },
        },
        required: ["key", "kind", "product_codes"],
      },
    },
  },
  required: ["keys"],
} as const;

/**
 * يبني قائمة مفاتيح البحث لهذه الدورة من أسماء المنتجات ومرادفاتها،
 * ومن المصطلحات والفئات الموجودة فعلًا في البنك، باختيار دلالي لا حرفي.
 * لا تُضاف أي مصطلحات جديدة إلى البنك من هنا.
 */
export async function buildVocabulary(
  apiKey: string,
  targets: Array<{ code: string; id: string; research: ResearchProfile; name: string }>,
  bank: { terms: string[]; categories: string[] },
  ownerId?: string | null,
): Promise<VocabKey[]> {
  const productsBlock = targets
    .map((t) => `الكود ${t.code}: ${researchDigest(t.research, t.name)}`)
    .join("\n---\n");

  const prompt =
    `سنبحث في مكتبة إعلانات فيسبوك عن إعلانات تُعلن عن المنتجات التالية.\n` +
    `المنتجات المستهدفة:\n${productsBlock}\n\n` +
    `بنك المصطلحات المتاح (لا تخترع مصطلحات جديدة، اختر منه فقط ما يناسب المنتجات دلاليًا):\n` +
    `${bank.terms.join(" | ") || "—"}\n\n` +
    `بنك الفئات المتاح (اختر منه فقط ما يناسب دلاليًا):\n${bank.categories.join(" | ") || "—"}\n\n` +
    `ابنِ قائمة مفاتيح بحث فعّالة تصل إلى إعلانات هذه المنتجات، وتتكوّن من:\n` +
    `أسماء المنتجات، أسمائها البديلة، مرادفاتها، ومصطلحات وفئات مناسبة من البنكين.\n` +
    `لا يشترط تطابق الكلمات حرفيًا مع اسم المنتج؛ الاختيار بالمعنى والنوع.\n` +
    `احذف التكرار والكلمات العامة جدًا والكلمات الضعيفة التي لا تصلح للبحث.\n` +
    `اربط كل مفتاح بأكواد المنتجات التي اخترته من أجلها (كود واحد على الأقل).\n` +
    `بحد أقصى ${MAX_KEYS} مفتاحًا.`;

  const parsed = await ask(
    apiKey,
    [{ type: "input_text", text: prompt }],
    "search_vocabulary",
    VOCAB_SCHEMA,
    "تعذّر بناء مفاتيح البحث",
    ownerId,
    "keywords_build",
  );

  const byCode = new Map(targets.map((t) => [t.code, t.id]));
  const bankKeys = new Set([...bank.terms, ...bank.categories].map(keyOf));
  // الأسماء المسموح بها لكل منتج: اسمه، اسمه الحقيقي، أسماؤه البديلة ومرادفاته.
  const productKeys = new Map<string, Set<string>>();
  for (const t of targets) {
    const set = new Set(
      [t.name, t.research.real_name, ...t.research.alt_names, ...t.research.synonyms]
        .map((n) => keyOf(String(n ?? "")))
        .filter(Boolean),
    );
    productKeys.set(t.id, set);
  }
  const seen = new Set<string>();
  const out: VocabKey[] = [];
  for (const raw of (parsed["keys"] as unknown[]) ?? []) {
    const item = (raw ?? {}) as Record<string, unknown>;
    const key = str(item["key"], 80).replace(/\s+/g, " ");
    const k = keyOf(key);
    if (!k || k.length < 3 || seen.has(k)) continue;
    const kind = str(item["kind"], 20) || "term";
    const ids = [
      ...new Set(
        strList(item["product_codes"], 40, 40)
          .map((c) => byCode.get(c.trim()))
          .filter((x): x is string => Boolean(x)),
      ),
    ];
    if (ids.length === 0) continue;
    // كل مفتاح يجب أن يكون إمّا من بنك المصطلحات/الفئات،
    // أو اسمًا فعليًا (أو بديلًا/مرادفًا) لأحد المنتجات المرتبطة به. لا اختراع.
    const fromBank = bankKeys.has(k);
    const fromProduct = ids.some((id) => productKeys.get(id)?.has(k));
    if (!fromBank && !fromProduct) continue;
    seen.add(k);
    out.push({ key, kind, productIds: ids });
    if (out.length >= MAX_KEYS) break;
  }
  return out;
}

/**
 * المرحلة الثالثة: العجز عن نتائج مرضية من اسم المنتج أو بنك المصطلحات.
 * هنا فقط يُسمح بتوليد مصطلحات جديدة بعد تحليل المنتج واستخداماته ووصفه وألفاظه،
 * مع منع تكرار أي مصطلح موجود في البنك، ثم تُضاف تلقائيًا إلى البنك.
 */
export async function generateVocabularyTerms(
  apiKey: string,
  targets: Array<{ code: string; id: string; research: ResearchProfile; name: string }>,
  existing: string[] = [],
  ownerId?: string | null,
): Promise<VocabKey[]> {
  const productsBlock = targets
    .map((t) => `الكود ${t.code}: ${researchDigest(t.research, t.name)}`)
    .join("\n---\n");

  const prompt =
    `حلّل المنتجات التالية ووّلد مصطلحات بحث عربية فعّالة تصل إلى إعلاناتها في مكتبة إعلانات فيسبوك.\n` +
    `المنتجات:\n${productsBlock}\n\n` +
    `اعتمد في التوليد على تحليل المنتج نفسه: استخدامه، وظيفته، وصفه، خصائصه، وألفاظ السوق الشائعة له.\n` +
    (existing.length
      ? `مصطلحات موجودة مسبقًا (لا تُكرّرها ولا تُعد صياغتها):\n${existing.slice(0, 400).join(" | ")}\n\n`
      : "") +
    `المصطلح يجب أن يكون قابلًا للبحث فعليًا (اسم شائع للمنتج، نوعه، استخدامه، أو وصف سوقي دقيق له).\n` +
    `تجنّب الكلمات العامة جدًا والكلمات الضعيفة والتكرار.\n` +
    `اربط كل مصطلح بأكواد المنتجات التي وُلّد من أجلها (كود واحد على الأقل).\n` +
    `بحد أقصى ${MAX_KEYS} مصطلحًا.`;

  const parsed = await ask(
    apiKey,
    [{ type: "input_text", text: prompt }],
    "generated_vocabulary",
    VOCAB_SCHEMA,
    "تعذّر توليد مصطلحات البحث",
    ownerId,
    "keywords_build",
  );

  const byCode = new Map(targets.map((t) => [t.code, t.id]));
  const known = new Set(existing.map((e) => keyOf(e)).filter(Boolean));
  const seen = new Set<string>();
  const out: VocabKey[] = [];
  for (const raw of (parsed["keys"] as unknown[]) ?? []) {
    const item = (raw ?? {}) as Record<string, unknown>;
    const key = str(item["key"], 80).replace(/\s+/g, " ");
    const k = keyOf(key);
    // لا تكرار لمصطلح موجود في البنك سابقًا.
    if (!k || k.length < 3 || seen.has(k) || known.has(k)) continue;
    const ids = [
      ...new Set(
        strList(item["product_codes"], 40, 40)
          .map((c) => byCode.get(c.trim()))
          .filter((x): x is string => Boolean(x)),
      ),
    ];
    if (ids.length === 0) continue;
    seen.add(k);
    out.push({ key, kind: "generated", productIds: ids });
    if (out.length >= MAX_KEYS) break;
  }
  return out;
}


/** يضيف المصطلحات المولّدة إلى بنك المصطلحات (بدون تكرار). */
async function addGeneratedTermsToBank(db: Db, ownerId: string, keys: VocabKey[]): Promise<void> {
  if (!keys.length) return;
  const { data: existing } = await db
    .from("discovery_terms")
    .select("term_key")
    .eq("owner_id", ownerId)
    .eq("kind", "term");
  const known = new Set((existing ?? []).map((t) => String(t.term_key)));
  const rows: Array<Database["public"]["Tables"]["discovery_terms"]["Insert"]> = [];
  for (const k of keys) {
    const key = keyOf(k.key);
    if (!key || known.has(key)) continue;
    known.add(key);
    rows.push({ owner_id: ownerId, kind: "term", term: k.key, term_key: key, source: "ai_generated", status: "active" });
  }
  if (rows.length) await db.from("discovery_terms").insert(rows);
}

// ------------------------------------------------------------------ (4) البحث عن إعلانات

export type CandidateAd = {
  adId: string;
  pageId: string | null;
  pageName: string;
  pageUrl: string;
  text: string;
  imageUrl: string | null;
  isActive: boolean;
  startedOn: string | null;
  sourceUrl: string;
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
function isoDate(chunk: string, name: string): string | null {
  const m = chunk.match(new RegExp(`"${name}":(\\d+)`));
  if (!m?.[1]) return null;
  const d = new Date(Number(m[1]) * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** رابط البحث: مصر، إعلانات نشطة، بحث بالكلمات — نفس مصدر وطريقة البحث المعتمدة. */
export function adSearchUrl(term: string): string {
  const q = encodeURIComponent(term.trim());
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=EG&q=${q}&search_type=keyword_unordered&media_type=all`;
}

/** يبحث بمفتاح واحد ويُرجع الإعلانات المرشحة (الإعلان هو النتيجة، وليست الصفحة). */
export async function searchCandidateAds(term: string): Promise<CandidateAd[]> {
  const res = await fetch(adSearchUrl(term), {
    headers: { "User-Agent": "facebookexternalhit/1.1", "Accept-Language": "ar,en;q=0.8" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return [];
  const html = (await res.text()).slice(0, 4_000_000);
  const marker = '"ad_archive_id":"';
  const out: CandidateAd[] = [];
  const seen = new Set<string>();
  let index = html.indexOf(marker);
  while (index !== -1 && out.length < MAX_ADS_PER_SEARCH) {
    const next = html.indexOf(marker, index + marker.length);
    const chunk = html.slice(index, next === -1 ? index + 12_000 : Math.min(next, index + 12_000));
    index = next;
    const adId = chunk.match(/"ad_archive_id":"(\d+)"/)?.[1];
    if (!adId || seen.has(adId)) continue;
    seen.add(adId);

    const pageId = chunk.match(/"page_id":"(\d+)"/)?.[1] ?? null;
    const pageName = field(chunk, "page_name");
    const bodyRaw = chunk.match(/"body":\{"text":"((?:[^"\\]|\\.)*)"/)?.[1];
    const text = [field(chunk, "title"), bodyRaw ? unescapeJson(bodyRaw) : "", field(chunk, "link_description"), field(chunk, "caption")]
      .filter(Boolean)
      .join("\n")
      .slice(0, 2000);
    const image =
      field(chunk, "original_image_url") ||
      field(chunk, "resized_image_url") ||
      field(chunk, "video_preview_image_url") ||
      null;
    if (!text && !image) continue;
    const uri = field(chunk, "page_profile_uri");
    out.push({
      adId,
      pageId,
      pageName,
      pageUrl: uri || (pageId ? `https://www.facebook.com/${pageId}` : ""),
      text,
      imageUrl: image,
      isActive: /"is_active":true/.test(chunk),
      startedOn: isoDate(chunk, "start_date"),
      sourceUrl: `https://www.facebook.com/ads/library/?id=${adId}`,
    });
  }
  return out;
}

// ------------------------------------------------------------------ (6+7) المطابقة

export type AdMatchVerdict = {
  productId: string;
  score: number;
  decision: "match" | "no_match";
  reasons: string[];
  differences: string[];
};

const MATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          product_code: { type: "string" },
          decision: { type: "string", enum: ["match", "no_match"] },
          score: { type: "number" },
          reasons: { type: "array", items: { type: "string" } },
          differences: { type: "array", items: { type: "string" } },
        },
        required: ["product_code", "decision", "score", "reasons", "differences"],
      },
    },
  },
  required: ["results"],
} as const;

/**
 * يقارن المنتج المستخرج من الإعلان بالمنتجات المستهدفة في هذه الدورة،
 * بهوية المنتج الحقيقي لا بتشابه الاسم.
 */
export async function matchAdToTargets(
  apiKey: string,
  ad: { text: string; imageUrl: string | null },
  extractedSummary: string,
  targets: Array<{ id: string; code: string; name: string; research: ResearchProfile }>,
  ownerId?: string | null,
): Promise<AdMatchVerdict[]> {
  const block = targets.map((t) => `الكود ${t.code}: ${researchDigest(t.research, t.name)}`).join("\n---\n");
  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text:
        `أمامك إعلان تجاري والمنتج المستخرج منه، وقائمة منتجات مستهدفة.\n` +
        `قرّر لكل منتج مستهدف: هل الإعلان يعلن عن نفس المنتج الحقيقي؟\n\n` +
        `المنتج المستخرج من الإعلان:\n${extractedSummary}\n\n` +
        `نص الإعلان:\n${limitWords(ad.text, 220)}\n\n` +
        `المنتجات المستهدفة:\n${block}\n\n` +
        `قواعد الحسم:\n` +
        `- اعتمد على هوية المنتج الحقيقي: الوظيفة، الاستخدام، الشكل، التصميم، المقاس، القدرة، الخامة، المواصفات، العلامة التجارية، الخصائص، والصورة.\n` +
        `- ممنوع القبول بسبب تشابه الاسم فقط، أو وجود كلمة البحث في الإعلان، أو تشابه الفئة العامة، أو تشابه الوظيفة العامة.\n` +
        `- إذا كان المنتج مختلفًا فعليًا فارفض المطابقة حتى لو كان قريبًا جدًا في الاسم أو الاستخدام.\n` +
        `- اختلاف البائع أو الصفحة أو صياغة الإعلان أو الاسم التجاري لا يمنع المطابقة إذا كان المنتج نفسه.\n` +
        `- أعطِ درجة من 0 إلى 1، وأسبابًا مختصرة للقبول، وأسباب الاختلاف عند الرفض.\n` +
        `- أدرج كل كود منتج مرة واحدة.`,
    },
  ];
  if (ad.imageUrl && /^https?:\/\//.test(ad.imageUrl)) content.push({ type: "input_image", image_url: ad.imageUrl });

  const parsed = await ask(apiKey, content, "ad_product_match", MATCH_SCHEMA, "تعذّر مطابقة الإعلان بالمنتج", ownerId, "product_match");
  const byCode = new Map(targets.map((t) => [t.code, t.id]));
  const out: AdMatchVerdict[] = [];
  const used = new Set<string>();
  for (const raw of (parsed["results"] as unknown[]) ?? []) {
    const item = (raw ?? {}) as Record<string, unknown>;
    const code = str(item["product_code"], 40).trim();
    const productId = byCode.get(code);
    if (!productId || used.has(productId)) continue;
    used.add(productId);
    const score = Math.max(0, Math.min(1, Number(item["score"] ?? 0)));
    const decision = item["decision"] === "match" && score >= MIN_MATCH ? "match" : "no_match";
    out.push({
      productId,
      score,
      decision,
      reasons: strList(item["reasons"], 6, 200),
      differences: strList(item["differences"], 6, 200),
    });
  }
  return out;
}

// ------------------------------------------------------------------ حالة ومنتجات مستهدفة

async function extendLease(db: Db, runId: string) {
  await db
    .from("pcrawl_runs")
    .update({ lease_expires_at: new Date(Date.now() + 10 * 60_000).toISOString() })
    .eq("id", runId);
}

async function loadRun(db: Db, runId: string) {
  const { data } = await db
    .from("pcrawl_runs")
    .select(
      "id, owner_id, scope, status, control, trigger_type, product_ids, keys_total, keys_done, ads_found, ads_new, ads_analyzed, matches, pages_candidates, profiles_built",
    )
    .eq("id", runId)
    .maybeSingle();
  return data;
}

/** يختار المنتجات المستهدفة لهذا التشغيل حسب نوعه. */
export async function pickTargetProducts(
  db: Db,
  ownerId: string,
  scope: string,
  selectedIds: string[] | null,
): Promise<string[]> {
  if (scope === "selected" && selectedIds?.length) {
    const { data } = await db
      .from("products")
      .select("id")
      .eq("owner_id", ownerId)
      .in("id", selectedIds.slice(0, 100));
    return (data ?? []).map((p) => p.id as string);
  }
  const limit = scope === "scheduled" ? SCHEDULED_PRODUCTS : GENERAL_PRODUCTS;
  const { data: products } = await db
    .from("products")
    .select("id, updated_at")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(2000);
  const all = (products ?? []).map((p) => p.id as string);
  if (all.length === 0) return [];
  const { data: targets } = await db
    .from("pcrawl_targets")
    .select("product_id, last_targeted_at")
    .eq("owner_id", ownerId);
  const seen = new Map((targets ?? []).map((t) => [t.product_id as string, (t.last_targeted_at as string | null) ?? ""]));
  // الدور: الأقدم استهدافًا أولًا، والذي لم يُستهدف إطلاقًا له الأولوية.
  const sorted = [...all].sort((a, b) => (seen.get(a) ?? "").localeCompare(seen.get(b) ?? ""));
  return sorted.slice(0, limit);
}

async function markTargeted(db: Db, ownerId: string, productIds: string[]) {
  if (productIds.length === 0) return;
  const now = new Date().toISOString();
  await db.from("pcrawl_targets").upsert(
    productIds.map((id) => ({ owner_id: ownerId, product_id: id, last_targeted_at: now })),
    { onConflict: "owner_id,product_id" },
  );
}

type TargetProduct = { id: string; code: string; name: string; research: ResearchProfile; hasProfile: boolean };

async function loadTargets(db: Db, ownerId: string, ids: string[]): Promise<{ rows: ProductRow[]; targets: TargetProduct[] }> {
  if (ids.length === 0) return { rows: [], targets: [] };
  const { data: products } = await db
    .from("products")
    .select("id, canonical_name, code, image_url, profile")
    .eq("owner_id", ownerId)
    .in("id", ids);
  const rows = (products ?? []) as ProductRow[];
  const { data: profiles } = await db
    .from("pcrawl_profiles")
    .select("product_id, research, built_at")
    .eq("owner_id", ownerId)
    .in("product_id", ids);
  const byProduct = new Map((profiles ?? []).map((p) => [p.product_id as string, p]));
  const targets = rows.map((r) => {
    const row = byProduct.get(r.id);
    const research = parseResearch(row?.research);
    return {
      id: r.id,
      code: r.code,
      name: r.canonical_name,
      research: research.real_name ? research : { ...EMPTY_RESEARCH, real_name: r.canonical_name },
      hasProfile: Boolean(row?.built_at && research.real_name),
    } satisfies TargetProduct;
  });
  return { rows, targets };
}

async function pauseRun(db: Db, ownerId: string, runId: string, reason: string): Promise<void> {
  await db
    .from("pcrawl_runs")
    .update({ status: "paused", finished_at: new Date().toISOString(), error: reason })
    .eq("id", runId);
  await db.from("pcrawl_state").upsert(
    { owner_id: ownerId, status: "paused", paused_reason: reason, paused_at: new Date().toISOString() },
    { onConflict: "owner_id" },
  );
}

/** ينهي التشغيل الحالي مع حفظ التقدّم كاملًا في قاعدة البيانات. */
export async function finishPcrawlRun(
  db: Db,
  ownerId: string,
  runId: string,
  status: "done" | "failed",
  error?: string | null,
): Promise<PcrawlProgress> {
  await db
    .from("pcrawl_runs")
    .update({ status, finished_at: new Date().toISOString(), error: error ?? null })
    .eq("id", runId);
  return await progressOf(db, ownerId, runId, "done", null);
}

export async function progressOf(
  db: Db,
  ownerId: string,
  runId: string,
  phase: PcrawlPhase,
  currentKey: string | null,
): Promise<PcrawlProgress> {
  const run = await loadRun(db, runId);
  const productIds = (run?.product_ids as string[] | null) ?? [];
  const { count: adsPending } = await db
    .from("pcrawl_ads")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("status", "pending");
  const { count: profilesReady } = productIds.length
    ? await db
        .from("pcrawl_profiles")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .in("product_id", productIds)
        .not("built_at", "is", null)
    : { count: 0 };
  const status = (run?.status as string) ?? "done";
  const { data: state } = await db
    .from("pcrawl_state")
    .select("status, paused_reason")
    .eq("owner_id", ownerId)
    .maybeSingle();

  return {
    runId,
    scope: (run?.scope as string) ?? "general",
    phase: status === "running" ? phase : "done",
    done: status !== "running",
    paused: status === "paused" ? ((state?.paused_reason as string | null) ?? "تم الإيقاف مؤقتًا.") : null,
    currentKey,
    productsTotal: productIds.length,
    profilesReady: profilesReady ?? 0,
    keysTotal: (run?.keys_total as number) ?? 0,
    keysDone: (run?.keys_done as number) ?? 0,
    adsFound: (run?.ads_found as number) ?? 0,
    adsNew: (run?.ads_new as number) ?? 0,
    adsAnalyzed: (run?.ads_analyzed as number) ?? 0,
    adsPending: adsPending ?? 0,
    matches: (run?.matches as number) ?? 0,
    pagesCandidates: (run?.pages_candidates as number) ?? 0,
  };
}

// ------------------------------------------------------------------ الصفحة المقبولة

/**
 * الإعلان المثبت يجعل صفحته مرشحًا مقبولًا لهذا المنتج:
 * تُضاف إلى مسار التحليل → المعلّق → موافقة المستخدم → منافس، بلا تكرار.
 */
async function promotePage(
  db: Db,
  ownerId: string,
  ad: { pageId: string | null; pageName: string; pageUrl: string; text: string },
  productId: string,
  searchKey: string,
): Promise<boolean> {
  // Page ID هو الهوية الأساسية للصفحة. بلا معرّف لا نخمّن بالاسم أو الرابط.
  if (!ad.pageId) return false;

  // أولًا: صفحة مسجّلة بالفعل كمنافس بنفس Page ID → هي نفس الصفحة، فلا نُنشئ سجلًا جديدًا.
  const { data: competitor } = await db
    .from("competitors")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("source_page_id", ad.pageId)
    .maybeSingle();

  const { data: existing } = await db
    .from("discovered_competitors")
    .select("id, matched_product_ids, matched_terms, times_seen, ads_sample, classification")
    .eq("owner_id", ownerId)
    .eq("platform", "Facebook")
    .eq("source_competitor_id", ad.pageId)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  if (existing) {
    const products = [...new Set([...((existing.matched_product_ids as string[] | null) ?? []), productId])];
    const terms = [...new Set([...((existing.matched_terms as string[] | null) ?? []), searchKey])].slice(0, 30);
    await db
      .from("discovered_competitors")
      .update({
        matched_product_ids: products,
        matched_terms: terms,
        competitor_name: ad.pageName || (existing as { competitor_name?: string }).competitor_name || ad.pageId,
        ads_sample: (existing.ads_sample as string | null) ?? ad.text.slice(0, 1500),
        times_seen: ((existing.times_seen as number) ?? 1) + 1,
        last_seen_at: nowIso,
      })
      .eq("id", existing.id);
    return false;
  }

  // منافس قائم بنفس Page ID: نتوقف هنا بلا إنشاء سجل صفحة جديد.
  if (competitor) return false;

  const { error } = await db.from("discovered_competitors").insert({
    owner_id: ownerId,
    platform: "Facebook",
    discovery_source: "product_ad",
    source_competitor_id: ad.pageId,
    competitor_name: ad.pageName || ad.pageId,
    competitor_url: ad.pageUrl || `https://www.facebook.com/${ad.pageId}`,
    fb_categories: [],
    active_ads: 1,
    ads_sample: ad.text.slice(0, 1500),
    matched_terms: [searchKey],
    matched_product_ids: [productId],
    classification: "pending",
    classification_note: null,
  });
  return !error;
}

// ------------------------------------------------------------------ خطوة واحدة

/**
 * خطوة واحدة محدودة من الزحف:
 * ملف بحث واحد، أو بناء مفاتيح الدورة، أو بحث بمفتاح واحد، ثم تحليل عدد صغير من الإعلانات.
 * كل تقدّم يُحفظ فورًا ليُستكمل من حيث توقف.
 */
export async function pcrawlStep(db: Db, ownerId: string, runId: string): Promise<PcrawlProgress> {
  const apiKey = await aiApiKey();
  const nowIso = new Date().toISOString();
  await extendLease(db, runId);

  const run = await loadRun(db, runId);
  if (!run || run.status !== "running") return await progressOf(db, ownerId, runId, "done", null);
  if (!apiKey) {
    await pauseRun(db, ownerId, runId, "خدمة الذكاء الاصطناعي غير مفعّلة.");
    return await progressOf(db, ownerId, runId, "done", null);
  }

  let productIds = (run.product_ids as string[] | null) ?? [];
  if (productIds.length === 0) {
    await finishPcrawlRun(db, ownerId, runId, "done", "لا توجد منتجات مستهدفة.");
    return await progressOf(db, ownerId, runId, "done", null);
  }

  const counts = {
    profiles: (run.profiles_built as number) ?? 0,
    keysTotal: (run.keys_total as number) ?? 0,
    keysDone: (run.keys_done as number) ?? 0,
    adsFound: (run.ads_found as number) ?? 0,
    adsNew: (run.ads_new as number) ?? 0,
    adsAnalyzed: (run.ads_analyzed as number) ?? 0,
    matches: (run.matches as number) ?? 0,
    pages: (run.pages_candidates as number) ?? 0,
  };
  const save = async () => {
    await db
      .from("pcrawl_runs")
      .update({
        profiles_built: counts.profiles,
        keys_total: counts.keysTotal,
        keys_done: counts.keysDone,
        ads_found: counts.adsFound,
        ads_new: counts.adsNew,
        ads_analyzed: counts.adsAnalyzed,
        matches: counts.matches,
        pages_candidates: counts.pages,
      })
      .eq("id", runId);
  };

  // مراجعة المفاتيح: لا بحث قبل أن يعتمد المستخدم مفاتيح البحث.
  const manualReview = (run.trigger_type as string | null) !== "scheduled";
  if (manualReview) {
    const { count: drafts } = await db
      .from("pcrawl_keys")
      .select("id", { count: "exact", head: true })
      .eq("run_id", runId)
      .eq("status", "draft");
    if ((drafts ?? 0) > 0) {
      if (run.control !== "review") await db.from("pcrawl_runs").update({ control: "review" }).eq("id", runId);
      return await progressOf(db, ownerId, runId, "review", null);
    }
  }
  const keyStatus = manualReview ? "draft" : "pending";

  const { rows, targets } = await loadTargets(db, ownerId, productIds);
  productIds = targets.map((t) => t.id);
  let phase: PcrawlPhase = "search";
  let currentKey: string | null = null;

  // (1) ملف بحث مؤقت لمنتج واحد في كل خطوة
  const missing = targets.find((t) => !t.hasProfile);
  if (missing) {
    phase = "profiles";
    const product = rows.find((r) => r.id === missing.id)!;
    const { data: adSample } = await db
      .from("ads")
      .select("product_description, image_url")
      .eq("owner_id", ownerId)
      .eq("product_id", product.id)
      .limit(1)
      .maybeSingle();
    try {
      const research = await buildResearchProfile(apiKey, product, {
        text: (adSample?.product_description as string | null) ?? "",
        imageUrl: (adSample?.image_url as string | null) ?? null,
      }, ownerId);
      await db.from("pcrawl_profiles").upsert(
        {
          owner_id: ownerId,
          product_id: product.id,
          research: research as unknown as Json,
          built_at: nowIso,
        },
        { onConflict: "owner_id,product_id" },
      );
      counts.profiles += 1;
      await save();
    } catch (error) {
      await save();
      if (error instanceof AiBlockedError) {
        await pauseRun(db, ownerId, runId, error.message);
        return await progressOf(db, ownerId, runId, "done", null);
      }
      // تعذّر ملف منتج واحد: نحفظه فارغًا حتى لا تتوقف الدورة عليه.
      await db.from("pcrawl_profiles").upsert(
        {
          owner_id: ownerId,
          product_id: product.id,
          research: { ...EMPTY_RESEARCH, real_name: product.canonical_name } as unknown as Json,
          built_at: nowIso,
        },
        { onConflict: "owner_id,product_id" },
      );
    }
    return await progressOf(db, ownerId, runId, phase, null);
  }

  // (1+2) بناء مفاتيح البحث: اسم المنتج أولًا، ثم مصطلحات وفئات البنك المناسبة
  if (counts.keysTotal === 0) {
    phase = "vocabulary";
    const { data: bankRows } = await db
      .from("discovery_terms")
      .select("kind, term")
      .eq("owner_id", ownerId)
      .eq("status", "active")
      .limit(1200);
    const bank = {
      terms: [...new Set((bankRows ?? []).filter((r) => r.kind === "term").map((r) => r.term as string))],
      categories: [...new Set((bankRows ?? []).filter((r) => r.kind === "category").map((r) => r.term as string))],
    };
    let keys: VocabKey[] = [];
    try {
      keys = await buildVocabulary(apiKey, targets, bank, ownerId);
    } catch (error) {
      await save();
      if (error instanceof AiBlockedError) {
        await pauseRun(db, ownerId, runId, error.message);
        return await progressOf(db, ownerId, runId, "done", null);
      }
      keys = [];
    }
    // أسماء المنتجات نفسها مفاتيح صالحة دائمًا وتتقدّم على غيرها.
    const nameKeys: VocabKey[] = targets.map((t) => ({
      key: t.research.real_name || t.name,
      kind: "product_name",
      productIds: [t.id],
    }));
    keys = [...nameKeys, ...keys];

    // (3) عجز عن مفاتيح كافية من الاسم والبنك: نولّد مصطلحات من تحليل المنتج،
    // بلا تكرار لما في البنك، ثم (4) نضيفها تلقائيًا إلى بنك المصطلحات.
    const bankAll = [...bank.terms, ...bank.categories];
    const bankUsed = keys.filter((k) => bankAll.some((b) => keyOf(b) === keyOf(k.key))).length;
    if (bankUsed === 0 || keys.length < targets.length * 3) {
      try {
        const generated = await generateVocabularyTerms(apiKey, targets, bankAll, ownerId);
        if (generated.length) {
          await addGeneratedTermsToBank(db, ownerId, generated);
          keys = [...keys, ...generated];
        }
      } catch (error) {
        if (error instanceof AiBlockedError) {
          await pauseRun(db, ownerId, runId, error.message);
          return await progressOf(db, ownerId, runId, "done", null);
        }
      }
    }

    const seen = new Set<string>();
    const insert = keys
      .filter((k) => {
        const kk = keyOf(k.key);
        if (!kk || seen.has(kk)) return false;
        seen.add(kk);
        return true;
      })
      .map((k) => ({
        owner_id: ownerId,
        run_id: runId,
        key_text: k.key,
        key_key: keyOf(k.key),
        kind: k.kind,
        product_ids: k.productIds,
        status: keyStatus,
      }));
    if (insert.length) await db.from("pcrawl_keys").insert(insert);
    counts.keysTotal = insert.length;
    await save();
    if (insert.length && manualReview) {
      await db.from("pcrawl_runs").update({ control: "review" }).eq("id", runId);
      return await progressOf(db, ownerId, runId, "review", null);
    }
    return await progressOf(db, ownerId, runId, phase, null);
  }


  // البحث بمفتاح واحد بالترتيب: اسم المنتج، ثم البنك، ثم المصطلحات المولّدة.
  const pickKey = async (kinds: string[] | null) => {
    let q = db
      .from("pcrawl_keys")
      .select("id, key_text, product_ids")
      .eq("run_id", runId)
      .eq("status", "pending");
    if (kinds) q = q.in("kind", kinds);
    const { data } = await q.order("created_at", { ascending: true }).limit(1);
    return data?.[0];
  };
  const nextKey =
    (await pickKey(["product_name", "alt_name", "synonym"])) ??
    (await pickKey(["term", "category"])) ??
    (await pickKey(null));

  if (nextKey) {
    phase = "search";
    currentKey = nextKey.key_text as string;
    let ads: CandidateAd[] = [];
    try {
      ads = await searchCandidateAds(currentKey);
    } catch {
      ads = [];
    }
    const keyProducts = (nextKey.product_ids as string[] | null) ?? [];
    if (ads.length) {
      const { data: existingAds } = await db
        .from("pcrawl_ads")
        .select("id, ad_id, via_keys, target_product_ids, status")
        .eq("owner_id", ownerId)
        .in("ad_id", ads.map((a) => a.adId));
      const known = new Map((existingAds ?? []).map((r) => [r.ad_id as string, r]));
      for (const ad of ads) {
        const row = known.get(ad.adId);
        if (row) {
          // منع التكرار بمعرّف الإعلان الحقيقي: نحدّث الربط فقط.
          const viaKeys = [...new Set([...((row.via_keys as string[] | null) ?? []), currentKey])].slice(0, 20);
          const products = [...new Set([...((row.target_product_ids as string[] | null) ?? []), ...keyProducts])];
          const grew = products.length > ((row.target_product_ids as string[] | null) ?? []).length;
          await db
            .from("pcrawl_ads")
            .update({
              via_keys: viaKeys,
              target_product_ids: products,
              last_seen_at: nowIso,
              // منتج مستهدف جديد لهذا الإعلان: يُعاد تحليله للمطابقة معه.
              status: grew && row.status === "analyzed" ? "pending" : (row.status as string),
            })
            .eq("id", row.id);
          continue;
        }
        const { error } = await db.from("pcrawl_ads").insert({
          owner_id: ownerId,
          ad_id: ad.adId,
          page_id: ad.pageId,
          page_name: ad.pageName,
          page_url: ad.pageUrl,
          ad_text: ad.text,
          image_url: ad.imageUrl,
          source_url: ad.sourceUrl,
          started_on: ad.startedOn,
          is_active: ad.isActive,
          via_keys: [currentKey],
          target_product_ids: keyProducts,
          run_id: runId,
        });
        if (!error) counts.adsNew += 1;
      }
    }
    await db
      .from("pcrawl_keys")
      .update({ status: "searched", found: ads.length, searched_at: nowIso })
      .eq("id", nextKey.id);
    counts.keysDone += 1;
    counts.adsFound += ads.length;
    await save();
  }

  // (6+7) تحليل عدد صغير من الإعلانات المعلّقة ومطابقتها بالمنتجات المستهدفة
  const { data: pendingAds } = await db
    .from("pcrawl_ads")
    .select("id, ad_id, page_id, page_name, page_url, ad_text, image_url, target_product_ids, via_keys")
    .eq("owner_id", ownerId)
    .eq("status", "pending")
    .overlaps("target_product_ids", productIds)
    .order("last_seen_at", { ascending: true })
    .limit(ADS_PER_STEP);

  for (const adRow of pendingAds ?? []) {
    if (!nextKey) phase = "analysis";
    const adTargets = targets.filter((t) => ((adRow.target_product_ids as string[] | null) ?? []).includes(t.id));
    if (adTargets.length === 0) {
      await db.from("pcrawl_ads").update({ status: "analyzed", analyzed_at: nowIso }).eq("id", adRow.id);
      continue;
    }
    const searchKey = ((adRow.via_keys as string[] | null) ?? [])[0] ?? "";
    try {
      // تحليل الإعلان نفسه: نصه وصورته والمنتج الظاهر فيه.
      const identity = await classifyAd(apiKey, {
        text: (adRow.ad_text as string) ?? "",
        imageUrl: (adRow.image_url as string | null) ?? null,
        niches: [],
        knownProducts: adTargets.map((t) => t.research.real_name || t.name),
      }, ownerId);
      const summary = [
        `الاسم: ${identity.product_name}`,
        identity.product_description ? `الوصف: ${identity.product_description}` : "",
        identity.function_use ? `الوظيفة والاستخدام: ${identity.function_use}` : "",
        identity.brand ? `العلامة: ${identity.brand}` : "",
        identity.size ? `المقاس/القدرة: ${identity.size}` : "",
        identity.form ? `الشكل والتصميم: ${identity.form}` : "",
        identity.specs.length ? `المواصفات: ${identity.specs.join("، ")}` : "",
        identity.distinguishing.length ? `فروق مهمة: ${identity.distinguishing.join("، ")}` : "",
      ]
        .filter(Boolean)
        .join(" | ");

      const verdicts = await matchAdToTargets(
        apiKey,
        { text: (adRow.ad_text as string) ?? "", imageUrl: (adRow.image_url as string | null) ?? null },
        summary,
        adTargets,
        ownerId,
      );

      for (const v of verdicts) {
        await db.from("pcrawl_matches").upsert(
          {
            owner_id: ownerId,
            pcrawl_ad_id: adRow.id as string,
            ad_id: adRow.ad_id as string,
            page_id: (adRow.page_id as string | null) ?? null,
            page_name: (adRow.page_name as string) ?? "",
            product_id: v.productId,
            score: v.score,
            decision: v.decision,
            reasons: v.reasons,
            differences: v.differences,
            extracted_name: identity.product_name,
            search_key: searchKey,
            run_id: runId,
          },
          { onConflict: "owner_id,pcrawl_ad_id,product_id" },
        );
        if (v.decision === "match") {
          counts.matches += 1;
          const created = await promotePage(
            db,
            ownerId,
            {
              pageId: (adRow.page_id as string | null) ?? null,
              pageName: (adRow.page_name as string) ?? "",
              pageUrl: (adRow.page_url as string) ?? "",
              text: (adRow.ad_text as string) ?? "",
            },
            v.productId,
            searchKey,
          );
          if (created) counts.pages += 1;
        }
      }

      await db
        .from("pcrawl_ads")
        .update({
          status: "analyzed",
          analyzed_at: nowIso,
          extracted: identity as unknown as Json,
          extracted_name: identity.product_name,
          error: null,
        })
        .eq("id", adRow.id);
      counts.adsAnalyzed += 1;
      await save();
    } catch (error) {
      await save();
      if (error instanceof AiBlockedError) {
        await pauseRun(db, ownerId, runId, error.message);
        return await progressOf(db, ownerId, runId, "done", null);
      }
      await db
        .from("pcrawl_ads")
        .update({ status: "error", error: error instanceof Error ? error.message : String(error) })
        .eq("id", adRow.id);
    }
  }

  await save();
  await db
    .from("pcrawl_state")
    .upsert({ owner_id: ownerId, status: "active", last_run_at: nowIso }, { onConflict: "owner_id" });

  // هل انتهت الدورة؟
  const { count: keysLeft } = await db
    .from("pcrawl_keys")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("status", "pending");
  const { count: adsLeft } = await db
    .from("pcrawl_ads")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("status", "pending")
    .overlaps("target_product_ids", productIds);

  // (3) نتائج غير مرضية بعد استنفاد الاسم والبنك: توليد مصطلحات جديدة مرة واحدة،
  // بلا تكرار لما في البنك، مع (4) إضافتها تلقائيًا إلى بنك المصطلحات.
  if ((keysLeft ?? 0) === 0 && (adsLeft ?? 0) === 0 && counts.matches === 0) {
    const { count: generatedCount } = await db
      .from("pcrawl_keys")
      .select("id", { count: "exact", head: true })
      .eq("run_id", runId)
      .eq("kind", "generated");
    if ((generatedCount ?? 0) === 0) {
      const { data: bankRows } = await db
        .from("discovery_terms")
        .select("term")
        .eq("owner_id", ownerId)
        .limit(1200);
      const bankAll = [...new Set((bankRows ?? []).map((r) => r.term as string))];
      try {
        const generated = await generateVocabularyTerms(apiKey, targets, bankAll, ownerId);
        if (generated.length) {
          await addGeneratedTermsToBank(db, ownerId, generated);
          const seen = new Set<string>();
          const insert = generated
            .filter((k) => {
              const kk = keyOf(k.key);
              if (!kk || seen.has(kk)) return false;
              seen.add(kk);
              return true;
            })
            .map((k) => ({
              owner_id: ownerId,
              run_id: runId,
              key_text: k.key,
              key_key: keyOf(k.key),
              kind: "generated",
              product_ids: k.productIds,
              status: keyStatus,
            }));
          if (insert.length) {
            await db.from("pcrawl_keys").insert(insert);
            counts.keysTotal += insert.length;
            await save();
            if (manualReview) {
              await db.from("pcrawl_runs").update({ control: "review" }).eq("id", runId);
              return await progressOf(db, ownerId, runId, "review", null);
            }
            return await progressOf(db, ownerId, runId, "vocabulary", null);
          }
        }
      } catch (error) {
        if (error instanceof AiBlockedError) {
          await pauseRun(db, ownerId, runId, error.message);
          return await progressOf(db, ownerId, runId, "done", null);
        }
      }
    }
  }

  if ((keysLeft ?? 0) === 0 && (adsLeft ?? 0) === 0) {

    await markTargeted(db, ownerId, productIds);
    return await finishPcrawlRun(db, ownerId, runId, "done");
  }

  return await progressOf(db, ownerId, runId, phase, currentKey);
}

/** تشغيل مجدول لمالك واحد: دفعة محدودة من الخطوات مع احترام حالة الإيقاف. */
export async function runScheduledPcrawl(db: Db, ownerId: string, maxSteps: number) {
  const { data: state } = await db
    .from("pcrawl_state")
    .select("status")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (state?.status === "paused") {
    // فحص واحد فقط لاكتشاف عودة الخدمة، دون استئناف كامل.
    if (!(await aiApiKey())) return { ownerId, skipped: "paused" as const };
    return { ownerId, skipped: "paused" as const };
  }

  const { data: runId, error } = await db.rpc("acquire_pcrawl_run", {
    _owner_id: ownerId,
    _trigger_type: "scheduled",
    _scope: "scheduled",
  });
  if (error) return { ownerId, skipped: error.message };
  if (!runId) return { ownerId, skipped: "already_running" as const };

  const ids = await pickTargetProducts(db, ownerId, "scheduled", null);
  await db.from("pcrawl_runs").update({ product_ids: ids }).eq("id", runId as string);

  let progress: PcrawlProgress | null = null;
  for (let i = 0; i < maxSteps; i += 1) {
    progress = await pcrawlStep(db, ownerId, runId as string);
    if (progress.done) break;
  }
  if (progress && !progress.done) {
    // نحفظ التقدّم ونُنهي التشغيل؛ الدورة القادمة تُكمل من حيث توقفنا.
    await db
      .from("pcrawl_runs")
      .update({ status: "done", finished_at: new Date().toISOString() })
      .eq("id", runId as string);
  }
  return { ownerId, progress };
}
