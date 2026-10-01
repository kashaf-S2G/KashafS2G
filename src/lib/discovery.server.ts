/**
 * محرك اكتشاف الصفحات التجارية المصرية:
 * 1) بناء بنك المصطلحات من قاعدة المنتجات.
 * 2) البحث في مكتبة إعلانات فيسبوك (مصر، إعلانات نشطة) واستخراج الصفحات المرشحة.
 * 3) تصنيف الصفحات المرشحة لاحقًا مقابل فئات الصفحات الموجودة في البنك فقط.
 * ملف خادم فقط — لا يُستورد من كود المتصفح.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { AiBlockedError, limitWords } from "@/lib/ad-crawl.server";

type Db = SupabaseClient<Database>;

/** لا يوجد حد أدنى للمنتجات: يُبنى البنك من أي منتجات متاحة. */
export const MIN_PRODUCTS_FOR_BANK = 0;
const MAX_AUTO_CATEGORIES = 14;
const MAX_AUTO_TERMS = 200;

import { AI_MODEL, aiResponses } from "@/lib/ai-endpoint.server";

// ---------------------------------------------------------------- تنظيف المصطلحات

const AR_LETTERS = /[\u0621-\u064A]/;

/** تطبيع عربي للمقارنة ومنع التكرار: إزالة التشكيل والتطويل وتوحيد الهمزات. */
export function termKey(value: string): string {
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

const STOPWORDS = new Set(
  `من في على الى إلى عن مع هذا هذه هذي ذلك تلك كل او أو لا ما لم لن ان أن إن كان كانت ثم حتى بعد قبل بين عند غير بدون فقط جدا جداً الان الآن اليوم
  متوفر متوفرة متاح متاحة توصيل شحن مجاني مجانا مجاناً سعر السعر خصم خصومات عرض عروض جنيه جنية ج للطلب اطلب اطلبي اطلبه الطلب اطلبوا عبر واتساب رابط لينك
  الصفحة صفحة صفحتنا موقع موقعنا رسالة راسلنا كلمنا اتصل اتصلوا تواصل تواصلوا رقم ارقام الدفع عند الاستلام استلام لحد باب بيتك بيت البيت
  الجديد الجديدة جديد جديدة حصري حصريا حصرياً افضل أفضل احسن أحسن اجمل أجمل اقوى أقوى ارخص أرخص مميز مميزة رائع رائعة ممتاز ممتازة
  منتج منتجات المنتج المنتجات قطعة قطع مقاس مقاسات لون الوان ألوان جميع كافة يوجد يوجدلدينا لدينا عندنا معانا معنا يا بس كمان دلوقتي دلوقت
  هو هي هم انت انتي انتم نحن احنا انا أنا ليه ليك ليكي ازاي إزاي اللي الي التي الذي الذين ده دي دول فيه فيها فيهم عليه عليها منه منها له لها لهم
  الف ألف مية ميه مئة الف بس خلاص تمام اوك اوكي حاجة حاجات شيء اشياء وقت مدة سنة سنين شهر شهور يوم ايام أيام ساعة ساعات
  عرضنا عروضنا خصمنا نسبة لفترة محدودة الكمية كمية محدود محدودة سارع سارعي بادر بادري احجز احجزي حجز بكل مصر لكل انحاء جميع محافظات محافظة
  تصميم بجودة جودة عالية اصلي أصلي اصلية أصلية ضمان بضمان استبدال استرجاع`
    .split(/\s+/)
    .map(termKey)
    .filter(Boolean),
);

function isArabic(value: string): boolean {
  return AR_LETTERS.test(value);
}

function cleanWord(word: string): string | null {
  const key = termKey(word);
  if (!key || key.length < 3 || !isArabic(key)) return null;
  if (STOPWORDS.has(key)) return null;
  if (/^\d+$/.test(key)) return null;
  return key;
}

export type ExtractedTerm = { term: string; key: string; source: string };

/**
 * استخراج مصطلحات نظيفة من أسماء المنتجات وأوصافها.
 * دالة نقية قابلة للاختبار.
 */
export function extractTerms(input: {
  names: string[];
  descriptions: string[];
}): ExtractedTerm[] {
  const out = new Map<string, ExtractedTerm>();
  const add = (raw: string, source: string) => {
    const term = raw.trim().replace(/\s+/g, " ");
    const key = termKey(term);
    if (!key || !isArabic(key) || out.has(key)) return;
    out.set(key, { term, key, source });
  };

  for (const name of input.names) {
    const clean = name.replace(/[^\p{L}\p{N}\s]+/gu, " ").trim();
    const words = clean.split(/\s+/).filter(Boolean);
    // اسم المنتج كاملًا (إن كان عربيًا وقصيرًا)
    if (isArabic(clean) && words.length >= 1 && words.length <= 4) add(clean, "product_name");
    // الكلمات المفردة الدالة من الاسم
    for (const w of words) {
      const key = cleanWord(w);
      if (key) add(w.replace(/^(و|ال|بال|وال|لل)/, (m) => (w.length > 5 ? "" : m)), "product_name");
    }
  }

  for (const desc of input.descriptions) {
    const words = desc.replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter(Boolean);
    // ثنائيات الكلمات ذات المعنى + الكلمات الطويلة الدالة
    for (let i = 0; i < words.length; i += 1) {
      const a = words[i]!;
      const ka = cleanWord(a);
      if (ka && ka.length >= 4) add(a, "description");
      const b = words[i + 1];
      if (b) {
        const kb = cleanWord(b);
        if (ka && kb) add(`${a} ${b}`, "description");
      }
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------- بنك المصطلحات

export type BankBuildResult = {
  built: boolean;
  productsCount: number;
  addedTerms: number;
  addedCategories: number;
};

/** يستنتج فئات الصفحات المستهدفة من تحليل أسماء وأوصاف المنتجات. */
export async function deriveCategoriesFromProducts(
  apiKey: string,
  names: string[],
  descriptions: string[],
  ownerId?: string | null,
): Promise<string[]> {
  if (names.length === 0) return [];
  const sample = names.slice(0, 300).join("\n");
  const descSample = descriptions.slice(0, 60).map((d) => limitWords(d, 25)).join("\n");
  const prompt = `هذه قائمة منتجات تُباع في مصر:
${sample}

عيّنة من أوصاف المنتجات:
${descSample || "—"}

استنتج فئات الصفحات التجارية المصرية التي تبيع مثل هذه المنتجات (فئات صفحات لا فئات منتجات)، بحد أقصى ${MAX_AUTO_CATEGORIES} فئة، بالعربية، كل فئة من كلمة إلى ثلاث كلمات، بدون تكرار وبدون أسماء علامات تجارية.`;

  const res = await aiResponses(apiKey, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
      stream: false,
      store: false,
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          name: "page_categories",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: { categories: { type: "array", items: { type: "string" } } },
            required: ["categories"],
          },
        },
      },
    }),
  }, ownerId, "discovery_categories");
  if (!res.ok) {
    if (res.status === 402) throw new AiBlockedError("انتهى رصيد الذكاء الاصطناعي، يرجى إضافة رصيد.");
    if (res.status === 403) throw new AiBlockedError("خدمة الذكاء الاصطناعي موقوفة لهذا الحساب.");
    if (res.status === 429) throw new AiBlockedError("الخدمة مشغولة الآن، حاول لاحقًا.");
    throw new Error(`تعذّر تحليل فئات الصفحات (${res.status})`);
  }
  const json = (await res.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  let text = json.output_text ?? "";
  if (!text) {
    for (const item of json.output ?? []) {
      for (const c of item.content ?? []) if (c.type === "output_text" && c.text) text += c.text;
    }
  }
  const parsed = JSON.parse(text) as Partial<{ categories: string[] }>;
  const out: string[] = [];
  for (const raw of parsed.categories ?? []) {
    const value = String(raw ?? "").trim();
    if (!value || !termKey(value)) continue;
    if (out.some((x) => termKey(x) === termKey(value))) continue;
    out.push(value);
    if (out.length >= MAX_AUTO_CATEGORIES) break;
  }
  return out;
}

/** يبني بنك المصطلحات وفئات الصفحات من قاعدة المنتجات، مع منع التكرار واحترام المحذوف. */
export async function buildTermBank(db: Db, ownerId: string, apiKey?: string): Promise<BankBuildResult> {
  const { data: ads } = await db
    .from("ads")
    .select("product_name, product_description")
    .eq("owner_id", ownerId)
    .limit(2000);
  const rows = ads ?? [];
  const names = [...new Set(rows.map((r) => String(r.product_name ?? "").trim()).filter(Boolean))];
  const productsCount = new Set(names.map(termKey)).size;
  if (productsCount === 0) {
    return { built: false, productsCount, addedTerms: 0, addedCategories: 0 };
  }

  const { data: pages } = await db.from("competitors").select("niche").eq("owner_id", ownerId);
  const categories = [...new Set((pages ?? []).map((p) => String(p.niche ?? "").trim()).filter(Boolean))];
  const descriptionsForCats = rows.map((r) => String(r.product_description ?? "").trim()).filter(Boolean);
  if (apiKey) {
    try {
      const derived = await deriveCategoriesFromProducts(apiKey, names, descriptionsForCats, ownerId);
      for (const c of derived) if (!categories.some((x) => termKey(x) === termKey(c))) categories.push(c);
    } catch {
      // تحليل الفئات اختياري: نكمل ببناء المصطلحات حتى لو تعذّر التحليل.
    }
  }

  const { data: existing } = await db
    .from("discovery_terms")
    .select("kind, term_key, status, source")
    .eq("owner_id", ownerId);
  const known = new Set((existing ?? []).map((t) => `${t.kind}:${t.term_key}`));
  const autoCount = (existing ?? []).filter((t) => t.kind === "term" && t.source !== "manual" && t.status === "active").length;

  const descriptions = rows.map((r) => String(r.product_description ?? "").trim()).filter(Boolean);
  const terms = extractTerms({ names, descriptions });

  const toInsert: Array<Database["public"]["Tables"]["discovery_terms"]["Insert"]> = [];
  let budget = Math.max(0, MAX_AUTO_TERMS - autoCount);
  for (const t of terms) {
    if (budget <= 0) break;
    const k = `term:${t.key}`;
    if (known.has(k)) continue;
    known.add(k);
    toInsert.push({ owner_id: ownerId, kind: "term", term: t.term, term_key: t.key, source: t.source });
    budget -= 1;
  }
  let addedCategories = 0;
  for (const c of categories) {
    const key = termKey(c);
    if (!key) continue;
    const k = `category:${key}`;
    if (known.has(k)) continue;
    known.add(k);
    toInsert.push({ owner_id: ownerId, kind: "category", term: c, term_key: key, source: "category" });
    addedCategories += 1;
  }
  if (toInsert.length) {
    const { error } = await db.from("discovery_terms").insert(toInsert);
    if (error) throw new Error(error.message);
  }
  return {
    built: true,
    productsCount,
    addedTerms: toInsert.length - addedCategories,
    addedCategories,
  };
}

// ------------------------------------------- بناء البنك على خطوات (قابل للإيقاف والاستئناف)

export type BankStepResult = {
  productsCount: number;
  added: number;
  ids: string[];
  /** هل بقيت عناصر لم تُضف بعد في هذه المرحلة؟ */
  remaining: boolean;
};

/** الخطوة الأولى: إضافة فئات الصفحات (من المنافسين + استنتاج الذكاء الاصطناعي). */
export async function bankStepCategories(db: Db, ownerId: string, apiKey?: string): Promise<BankStepResult> {
  const { data: ads } = await db
    .from("ads")
    .select("product_name, product_description")
    .eq("owner_id", ownerId)
    .limit(2000);
  const rows = ads ?? [];
  const names = [...new Set(rows.map((r) => String(r.product_name ?? "").trim()).filter(Boolean))];
  const productsCount = new Set(names.map(termKey)).size;
  if (productsCount === 0) return { productsCount, added: 0, ids: [], remaining: false };

  const { data: pages } = await db.from("competitors").select("niche").eq("owner_id", ownerId);
  const categories = [...new Set((pages ?? []).map((p) => String(p.niche ?? "").trim()).filter(Boolean))];
  const descriptions = rows.map((r) => String(r.product_description ?? "").trim()).filter(Boolean);
  if (apiKey) {
    try {
      const derived = await deriveCategoriesFromProducts(apiKey, names, descriptions, ownerId);
      for (const c of derived) if (!categories.some((x) => termKey(x) === termKey(c))) categories.push(c);
    } catch {
      // تحليل الفئات اختياري.
    }
  }

  const { data: existing } = await db
    .from("discovery_terms")
    .select("kind, term_key")
    .eq("owner_id", ownerId);
  const known = new Set((existing ?? []).map((t) => `${t.kind}:${t.term_key}`));

  const toInsert: Array<Database["public"]["Tables"]["discovery_terms"]["Insert"]> = [];
  for (const c of categories) {
    const key = termKey(c);
    if (!key || known.has(`category:${key}`)) continue;
    known.add(`category:${key}`);
    toInsert.push({ owner_id: ownerId, kind: "category", term: c, term_key: key, source: "category" });
  }
  if (!toInsert.length) return { productsCount, added: 0, ids: [], remaining: false };

  const { data: inserted, error } = await db.from("discovery_terms").insert(toInsert).select("id");
  if (error) throw new Error(error.message);
  return {
    productsCount,
    added: inserted?.length ?? 0,
    ids: (inserted ?? []).map((r) => r.id as string),
    remaining: false,
  };
}

/** خطوة مصطلحات: تُضيف دفعة واحدة فقط من المصطلحات الجديدة وتخبر إن بقي المزيد. */
export async function bankStepTerms(db: Db, ownerId: string, batchSize = 25): Promise<BankStepResult> {
  const { data: ads } = await db
    .from("ads")
    .select("product_name, product_description")
    .eq("owner_id", ownerId)
    .limit(2000);
  const rows = ads ?? [];
  const names = [...new Set(rows.map((r) => String(r.product_name ?? "").trim()).filter(Boolean))];
  const productsCount = new Set(names.map(termKey)).size;
  if (productsCount === 0) return { productsCount, added: 0, ids: [], remaining: false };

  const { data: existing } = await db
    .from("discovery_terms")
    .select("kind, term_key, status, source")
    .eq("owner_id", ownerId);
  const known = new Set((existing ?? []).map((t) => `${t.kind}:${t.term_key}`));
  const autoCount = (existing ?? []).filter(
    (t) => t.kind === "term" && t.source !== "manual" && t.status === "active",
  ).length;
  let budget = Math.max(0, MAX_AUTO_TERMS - autoCount);
  if (budget === 0) return { productsCount, added: 0, ids: [], remaining: false };

  const descriptions = rows.map((r) => String(r.product_description ?? "").trim()).filter(Boolean);
  const pending = extractTerms({ names, descriptions }).filter((t) => !known.has(`term:${t.key}`));
  if (pending.length === 0) return { productsCount, added: 0, ids: [], remaining: false };

  const batch = pending.slice(0, Math.min(batchSize, budget));
  budget -= batch.length;
  const { data: inserted, error } = await db
    .from("discovery_terms")
    .insert(
      batch.map((t) => ({
        owner_id: ownerId,
        kind: "term" as const,
        term: t.term,
        term_key: t.key,
        source: t.source,
      })),
    )
    .select("id");
  if (error) throw new Error(error.message);

  return {
    productsCount,
    added: inserted?.length ?? 0,
    ids: (inserted ?? []).map((r) => r.id as string),
    remaining: pending.length > batch.length && budget > 0,
  };
}


/** يطابق استعلام المستخدم دلاليًا مع عناصر البنك (مصطلحات/فئات) ويعيد معرّفات العناصر المرتبطة. */
export async function aiMatchBankEntries(
  apiKey: string | undefined,
  query: string,
  entries: { id: string; term: string }[],
  ownerId?: string | null,
): Promise<string[]> {
  if (!apiKey) throw new AiBlockedError("خدمة الذكاء الاصطناعي غير مفعّلة.");
  if (entries.length === 0) return [];

  const list = entries.map((e) => `${e.id}\t${e.term}`).join("\n");
  const prompt = `أنت مساعد تصفية قوائم. لديك قائمة عناصر بصيغة "معرف<TAB>النص":
${list}

طلب المستخدم: «${query}»

أعد معرفات العناصر المرتبطة بطلب المستخدم دلاليًا (مجال، استخدام، مرادفات، موضوع عام أو فرعي). قد تتضمن نصوص العناصر بيانات رقمية مثل «إعلانات نشطة: N» و«إجمالي الإعلانات: N»؛ إن تضمّن الطلب شرطًا عدديًا (مثل: بدون إعلانات، إعلاناتها النشطة صفر، أكثر من 10 إعلانات) طبّقه على هذه الأرقام بدقة. لا تُعد أي عنصر غير مطابق بوضوح. إن لم يطابق شيء أعد قائمة فارغة.`;

  const res = await aiResponses(apiKey, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          name: "bank_matches",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: { matches: { type: "array", items: { type: "string" } } },
            required: ["matches"],
          },
        },
      },
    }),
  }, ownerId, "term_bank_match");
  if (!res.ok) {
    if (res.status === 402) throw new AiBlockedError("انتهى رصيد الذكاء الاصطناعي، يرجى إضافة رصيد.");
    if (res.status === 403) throw new AiBlockedError("خدمة الذكاء الاصطناعي موقوفة لهذا الحساب.");
    if (res.status === 429) throw new AiBlockedError("الخدمة مشغولة الآن، حاول لاحقًا.");
    throw new Error(`تعذّر البحث الذكي (${res.status})`);
  }

  // بث SSE: نجمع مقاطع النص حتى اكتمال الاستجابة.
  const reader = res.body?.getReader();
  if (!reader) throw new Error("تعذّر قراءة رد الذكاء الاصطناعي.");
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload) as {
          type?: string;
          delta?: string;
          response?: { output_text?: string };
        };
        if (evt.type === "response.output_text.delta" && evt.delta) text += evt.delta;
        else if (evt.type === "response.completed" && evt.response?.output_text && !text) {
          text = evt.response.output_text;
        }
      } catch {
        // سطر غير مكتمل: نتجاهله
      }
    }
  }

  let parsed: Partial<{ matches: string[] }> = {};
  try {
    parsed = JSON.parse(text) as Partial<{ matches: string[] }>;
  } catch {
    return [];
  }
  const valid = new Set(entries.map((e) => e.id));
  return [...new Set((parsed.matches ?? []).filter((id) => valid.has(id)))];
}
