import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  cleanProductName,
  isGenericIdentity,
  isNonProductName,
  productCodeFromKey,
  productIdentityKey,
  productSimilarity,
} from "@/lib/product-identity";
import {
  EMPTY_PROFILE,
  isEmptyProfile,
  mergeProfile,
  parseProfile,
  profileDigest,
  PROFILE_JSON_SCHEMA,
  type ProductProfile,
} from "@/lib/product-profile";
import { AI_MODEL, aiApiKey, aiResponses } from "@/lib/ai-endpoint.server";

/**
 * الطبقة المركزية الإلزامية لتوحيد المنتجات.
 * كل إعلان — من الزحف أو الإضافة اليدوية أو أي مصدر مستقبلي — يجب أن يمر من هنا
 * قبل ربطه بمنتج، ولا يُنشأ منتج جديد إلا بعد استنفاد كل محاولات المطابقة.
 *
 * المطابقة تعتمد على «بطاقة وصف معيارية» لكل منتج (اسم حقيقي، مرادفات، متغيرات،
 * خصائص فارقة، استخدام، وصف، ملاحظات بصرية، فروق مانعة وفروق غير مانعة)،
 * يفهمها الذكاء الاصطناعي ويرشّح لها الكود المرشّحين ويحسم بدرجة تطابق.
 * ملف خادم فقط.
 */

type Db = SupabaseClient<Database>;

export type ProductCandidateInput = {
  /** الاسم كما وصل من المصدر (قد يكون اسم متجر أو صياغة مختلفة). */
  rawName: string;
  /** وصف المنتج إن توفر. */
  description?: string | null;
  /** نص الإعلان الكامل إن توفر. */
  adText?: string | null;
  /** صورة الإعلان (رابط عام أو data URL) لتحليل المعلومات البصرية. */
  imageUrl?: string | null;
  /** أدلة الهوية المستخرجة من الإعلان: الوظيفة، البراند، المقاس، الشكل، المواصفات، الفروق. */
  evidence?: string | null;
};

export type ResolvedProduct = {
  productId: string;
  canonicalName: string;
  code: string;
  created: boolean;
  /** كيف تم الحسم: مفيد للتشخيص. */
  via: "alias" | "key" | "similar" | "ai" | "new";
  /** درجة التطابق عندما يحسم الذكاء الاصطناعي. */
  matchScore?: number;
};

type ProductRow = {
  id: string;
  canonical_name: string;
  canonical_key: string;
  code: string;
  image_url: string | null;
  profile: unknown;
};

const SELECT_COLUMNS = "id, canonical_name, canonical_key, code, image_url, profile";

/** تطابق اسمي شبه مؤكد يُقبل بدون سؤال النموذج (عند تعذّر الذكاء الاصطناعي أيضًا). */
const AUTO_MATCH = 0.88;
/** الحد الأدنى للترشيح إلى النموذج. */
const SHORTLIST_FLOOR = 0.05;
/** أقل درجة تطابق مقبولة للدمج؛ أقل من ذلك يبقى المنتجان منفصلين. */
const MIN_MATCH_SCORE = 0.75;
/** الأسماء العامة (كريم، زيت، جهاز...) تحتاج درجة أعلى حتى لا يُدمج منتجان مختلفان. */
const MIN_MATCH_SCORE_GENERIC = 0.85;
/** عدد المرشّحين الذين يراهم النموذج. */
const SHORTLIST_SIZE = 10;

function jsonFromStream(out: string): Record<string, unknown> | null {
  try {
    return JSON.parse(out) as Record<string, unknown>;
  } catch {
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

async function readStream(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload) as {
          type?: string;
          delta?: string;
          response?: { output_text?: string };
        };
        if (event.type === "response.output_text.delta" && event.delta) out += event.delta;
        else if (event.type === "response.completed" && event.response?.output_text) {
          out = event.response.output_text;
        }
      } catch {
        // أحداث غير مكتملة
      }
    }
  }
  return out;
}

type Verdict = {
  code: string | null;
  score: number;
  profile: ProductProfile | null;
};

/**
 * يفهم النموذج المنتج من الإعلان والصورة، يقارنه ببطاقات المنتجات المرشّحة،
 * ويعيد درجة تطابق وبطاقة وصف معيارية للمنتج كما فهمه.
 */
async function understandAndMatch(
  input: ProductCandidateInput,
  cleaned: string,
  candidates: ProductRow[],
  genericName = false,
  ownerId?: string | null,
): Promise<Verdict> {
  const apiKey = await aiApiKey();
  if (!apiKey) return { code: null, score: 0, profile: null };

  const list = candidates.length
    ? candidates
        .map((c, i) => `${i + 1}) الكود: ${c.code}\n${profileDigest(parseProfile(c.profile), c.canonical_name)}`)
        .join("\n---\n")
    : "لا يوجد منتجات مسجّلة بعد.";

  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text:
        `أنت مسؤول توحيد المنتجات في نظام مراقبة إعلانات المنافسين.\n` +
        `لديك بطاقات وصف معيارية لمنتجات مسجّلة، وإعلان جديد بنصه وصورته.\n` +
        `مهمتك: افهم المنتج الحقيقي في الإعلان، قارنه بالبطاقات، وأعطِ درجة تطابق ` +
        `(match_score بين 0 و1) مع أفضل مرشّح، ثم ابنِ بطاقة وصف معيارية للمنتج كما فهمته.\n\n` +
        `الحسم يعتمد على مجموعة الأدلة مجتمعة: نص الإعلان، الصورة، اسم المنتج، الوصف، ` +
        `الوظيفة والاستخدام، المواصفات، الشكل والتصميم، العلامة التجارية، الحجم/القدرة/المقاس، والخصائص.\n\n` +
        `قواعد الحسم:\n` +
        `- اسم المتجر أو البراند أو التصنيف العام ليس منتجًا.\n` +
        `- تشابه الاسم أو الفئة وحده لا يكفي أبدًا للدمج؛ "كريم لتنعيم الشعر" و"كريم للعناية بالبشرة" ` +
        `منتجان مختلفان رغم أن الاسم في الإعلانين "كريم".\n` +
        `- الدمج يشترط تطابق هوية المنتج ووظيفته واستخدامه وخصائصه الجوهرية.\n` +
        `- المنتج الحقيقي الواحد يبقى منتجًا واحدًا حتى لو اختلفت صورة الإعلان أو طريقة تصوير المنتج ` +
        `أو البائع أو الصفحة أو النص التسويقي أو السعر أو اللون أو الكمية أو التغليف أو اللغة.\n` +
        `- اختلاف الصورة وحده لا يعني اختلاف المنتج؛ ولا تنشئ منتجًا جديدًا لمجرد أن البائع مختلف.\n` +
        `- اختلاف الوظيفة أو النوع أو التقنية أو الطراز الجوهري يجعله منتجًا مختلفًا حتى لو تطابق الاسم.\n` +
        (genericName
          ? `- الاسم المستخرج عام لا يحدد هوية بذاته؛ لا تدمج إلا إذا أثبتت الأدلة أنه نفس المنتج الحقيقي.\n`
          : "") +
        `- إن لم تكن واثقًا فاختر "new"؛ الدمج الخاطئ أسوأ من الفصل.\n\n` +
        `بطاقات المنتجات المرشّحة:\n${list}\n\n` +
        `الإعلان الجديد:\nالاسم المستخرج: ${cleaned}\n` +
        (input.description ? `الوصف: ${input.description}\n` : "") +
        (input.evidence ? `أدلة الهوية:\n${String(input.evidence).slice(0, 1200)}\n` : "") +
        (input.adText ? `نص الإعلان: ${String(input.adText).slice(0, 1500)}\n` : ""),
    },
  ];
  if (input.imageUrl) content.push({ type: "input_image", image_url: input.imageUrl });

  try {
    const res = await aiResponses(apiKey, {
      method: "POST",
      body: JSON.stringify({
        model: AI_MODEL,
        input: [{ role: "user", content }],
        stream: true,
        store: false,
        reasoning: { effort: "low" },
        text: {
          format: {
            type: "json_schema",
            name: "product_match",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                decision: { type: "string", enum: ["match", "new"] },
                product_code: { type: "string", description: "كود المنتج المطابق أو نص فارغ" },
                match_score: { type: "number" },
                reason: { type: "string" },
                profile: PROFILE_JSON_SCHEMA,
              },
              required: ["decision", "product_code", "match_score", "reason", "profile"],
            },
          },
        },
      }),
    }, ownerId, "product_match");
    if (!res.ok) return { code: null, score: 0, profile: null };
    const parsed = jsonFromStream(await readStream(res));
    if (!parsed) return { code: null, score: 0, profile: null };

    const score = Number(parsed["match_score"] ?? 0);
    const code = String(parsed["product_code"] ?? "").trim();
    const floor = genericName ? MIN_MATCH_SCORE_GENERIC : MIN_MATCH_SCORE;
    const matched =
      parsed["decision"] === "match" && code && score >= floor
        ? (candidates.find((c) => c.code === code)?.code ?? null)
        : null;
    return { code: matched, score, profile: parseProfile(parsed["profile"]) };
  } catch {
    return { code: null, score: 0, profile: null };
  }
}

async function ensureAlias(db: Db, ownerId: string, productId: string, name: string) {
  const key = productIdentityKey(name);
  if (!key) return;
  await db
    .from("product_aliases")
    .upsert(
      { owner_id: ownerId, product_id: productId, alias_name: name.trim().slice(0, 200), alias_key: key },
      { onConflict: "owner_id,alias_key", ignoreDuplicates: true },
    );
}

/** تسجيل مرادفات البطاقة كأسماء بديلة حتى تُلتقط المطابقات القادمة بلا استدعاء نموذج. */
async function registerSynonyms(db: Db, ownerId: string, productId: string, profile: ProductProfile) {
  const names = [profile.real_name, ...profile.synonyms].filter(Boolean).slice(0, 12);
  for (const name of names) await ensureAlias(db, ownerId, productId, name);
}

/** تحديث بطاقة المنتج بالمعرفة الجديدة دون فقدان ما سبق. */
async function saveProfile(
  db: Db,
  productId: string,
  current: unknown,
  next: ProductProfile | null,
): Promise<void> {
  if (!next) return;
  const merged = mergeProfile(parseProfile(current), next);
  await db
    .from("products")
    .update({ profile: merged as unknown as Json, profile_updated_at: new Date().toISOString() })
    .eq("id", productId);
}

/** معرف فريد للمنتج: يعتمد على مفتاح الهوية، وعند التصادم يضيف لاحقة. */
async function freeCode(db: Db, ownerId: string, key: string): Promise<string> {
  const base = productCodeFromKey(key);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = attempt === 0 ? base : `${base}-${attempt}`;
    const { data } = await db
      .from("products")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("code", code)
      .maybeSingle();
    if (!data) return code;
  }
  return `P-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

/**
 * يحلّ منتج الإعلان: يعيد منتجًا موجودًا عند التطابق الموثوق، ولا ينشئ منتجًا جديدًا
 * إلا عند عدم وجود مطابقة مؤكدة. آمن للاستدعاء المتكرر لنفس الإعلان.
 */
export async function resolveProduct(
  db: Db,
  ownerId: string,
  input: ProductCandidateInput,
  options?: { useAi?: boolean; imagePathForProduct?: string | null; rebuild?: boolean },
): Promise<ResolvedProduct> {
  const useAi = options?.useAi !== false && Boolean(await aiApiKey());
  // إعادة البناء تتخطى الاختصارات النصية وتعيد الفهم الكامل للمنتج.
  const rebuild = options?.rebuild === true && useAi;
  const cleaned = cleanProductName(input.rawName || input.description || "منتج غير محدد");
  const key = productIdentityKey(cleaned) || productIdentityKey(input.rawName) || "منتج";
  /**
   * اسم عام مثل «كريم» أو «جهاز» لا يحدد هوية منتج، فلا يجوز الدمج به نصيًا؛
   * في هذه الحالة نتخطى اختصارات الاسم ونحسم بفهم الأدلة كلها.
   */
  const generic = isGenericIdentity(cleaned);
  const skipNameShortcuts = rebuild || (generic && useAi);

  // 1) اسم بديل مسجّل مسبقًا لنفس الهوية (يشمل مرادفات البطاقات المبنية سابقًا).
  const { data: alias } = skipNameShortcuts
    ? { data: null }
    : await db
    .from("product_aliases")
    .select(`product_id, products:product_id (${SELECT_COLUMNS})`)
    .eq("owner_id", ownerId)
    .eq("alias_key", key)
    .maybeSingle();
  const aliasProduct = (alias as { products?: ProductRow } | null)?.products;
  if (aliasProduct) {
    return {
      productId: aliasProduct.id,
      canonicalName: aliasProduct.canonical_name,
      code: aliasProduct.code,
      created: false,
      via: "alias",
    };
  }

  // 2) نفس مفتاح الهوية على مستوى المنتج.
  const { data: exact } = skipNameShortcuts
    ? { data: null }
    : await db
        .from("products")
        .select(SELECT_COLUMNS)
        .eq("owner_id", ownerId)
        .eq("canonical_key", key)
        .maybeSingle();
  if (exact) {
    const row = exact as ProductRow;
    await ensureAlias(db, ownerId, row.id, cleaned);
    return { productId: row.id, canonicalName: row.canonical_name, code: row.code, created: false, via: "key" };
  }

  // 3) ترشيح برمجي: تشابه الكلمات الدالة + أحدث المنتجات، ثم يحسم الفهم لا الاسم.
  const { data: allRows } = await db
    .from("products")
    .select(SELECT_COLUMNS)
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(4000);
  const all = (allRows ?? []) as ProductRow[];
  const scored = all
    .map((p) => ({ p, score: productSimilarity(cleaned, p.canonical_name) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];

  // بدون ذكاء اصطناعي: لا ندمج إلا عند تطابق اسمي شبه مؤكد، ولا نطبّقه على الأسماء العامة.
  if (!useAi && !generic && best && best.score >= AUTO_MATCH) {
    await ensureAlias(db, ownerId, best.p.id, cleaned);
    return {
      productId: best.p.id,
      canonicalName: best.p.canonical_name,
      code: best.p.code,
      created: false,
      via: "similar",
    };
  }

  let aiProfile: ProductProfile | null = null;

  if (useAi) {
    const shortlist = scored
      .filter((s) => s.score >= SHORTLIST_FLOOR)
      .slice(0, SHORTLIST_SIZE)
      .map((s) => s.p);
    // المنتجات ذات البطاقات الغنية تُضاف حتى لو لم يتشابه الاسم: الحسم بالفهم لا بالنص.
    for (const p of all) {
      if (shortlist.length >= SHORTLIST_SIZE) break;
      if (!shortlist.includes(p) && !isEmptyProfile(parseProfile(p.profile))) shortlist.push(p);
    }
    for (const p of all) {
      if (shortlist.length >= SHORTLIST_SIZE) break;
      if (!shortlist.includes(p)) shortlist.push(p);
    }

    const verdict = await understandAndMatch(input, cleaned, shortlist, generic, ownerId);
    aiProfile = verdict.profile;

    if (verdict.code) {
      const matched = all.find((p) => p.code === verdict.code)!;
      await ensureAlias(db, ownerId, matched.id, cleaned);
      await saveProfile(db, matched.id, matched.profile, aiProfile);
      if (aiProfile) await registerSynonyms(db, ownerId, matched.id, aiProfile);
      return {
        productId: matched.id,
        canonicalName: matched.canonical_name,
        code: matched.code,
        created: false,
        via: "ai",
        matchScore: verdict.score,
      };
    }
  } else if (isNonProductName(input.rawName) && best && best.score > 0) {
    // احتياط عند غياب الذكاء الاصطناعي واسم غير دال.
    await ensureAlias(db, ownerId, best.p.id, cleaned);
  }

  // 4) الاسم الحقيقي من البطاقة قد يطابق منتجًا قائمًا بمفتاح مختلف.
  const realName = aiProfile?.real_name?.trim();
  let finalName = realName && productIdentityKey(realName) ? cleanProductName(realName) : cleaned;
  // اسم عام بعد قرار «منتج جديد»: نُخصّصه بوظيفته حتى لا يُدمج مع منتج آخر يشترك في الاسم فقط.
  if (isGenericIdentity(finalName)) {
    const hint =
      aiProfile?.usage?.trim() ||
      aiProfile?.distinguishing?.[0]?.trim() ||
      input.description?.trim() ||
      "";
    if (hint) finalName = cleanProductName(`${finalName} ${hint}`.slice(0, 120)) || finalName;
  }
  const finalKey = productIdentityKey(finalName) || key;
  if (finalKey !== key) {
    const { data: viaAiKey } = await db
      .from("products")
      .select(SELECT_COLUMNS)
      .eq("owner_id", ownerId)
      .eq("canonical_key", finalKey)
      .maybeSingle();
    if (viaAiKey) {
      const row = viaAiKey as ProductRow;
      await ensureAlias(db, ownerId, row.id, cleaned);
      await ensureAlias(db, ownerId, row.id, finalName);
      await saveProfile(db, row.id, row.profile, aiProfile);
      return { productId: row.id, canonicalName: row.canonical_name, code: row.code, created: false, via: "ai" };
    }
  }

  // 5) منتج جديد: لم تتوفر مطابقة موثوقة، وتُبنى بطاقته لتكون مرجع المطابقات القادمة.
  const profile = aiProfile
    ? mergeProfile(aiProfile, { ...EMPTY_PROFILE, real_name: finalName })
    : { ...EMPTY_PROFILE, real_name: finalName, description: input.description?.trim().slice(0, 400) ?? "" };
  const code = await freeCode(db, ownerId, finalKey);
  const { data: created, error } = await db
    .from("products")
    .insert({
      owner_id: ownerId,
      canonical_name: finalName,
      canonical_key: finalKey,
      code,
      image_url: options?.imagePathForProduct ?? null,
      profile: profile as unknown as Json,
      profile_updated_at: new Date().toISOString(),
    })
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error || !created) {
    // تصادم متزامن على نفس المفتاح: نعيد قراءة المنتج القائم.
    const { data: again } = await db
      .from("products")
      .select(SELECT_COLUMNS)
      .eq("owner_id", ownerId)
      .eq("canonical_key", finalKey)
      .maybeSingle();
    if (!again) throw new Error(error?.message ?? "تعذّر إنشاء المنتج الموحّد.");
    const row = again as ProductRow;
    await ensureAlias(db, ownerId, row.id, cleaned);
    await saveProfile(db, row.id, row.profile, aiProfile);
    return { productId: row.id, canonicalName: row.canonical_name, code: row.code, created: false, via: "key" };
  }

  const row = created as ProductRow;
  await ensureAlias(db, ownerId, row.id, cleaned);
  if (finalName !== cleaned) await ensureAlias(db, ownerId, row.id, finalName);
  await registerSynonyms(db, ownerId, row.id, profile);
  return { productId: row.id, canonicalName: row.canonical_name, code: row.code, created: true, via: "new" };
}

/**
 * مطابقة إعلان بمنتج **موجود فعلًا** في قاعدة المنتجات، للقراءة فقط:
 * لا تُنشئ منتجًا ولا اسمًا بديلًا ولا تعدّل أي بطاقة.
 * تمرّ بنفس منظومة الهوية: الاسم البديل المسجّل، مفتاح الهوية، التشابه النصي،
 * ثم فهم النموذج للنص والصورة والوظيفة والوصف والمواصفات والعلامة والمرادفات.
 * تُستخدم في «زحف المنتجات» لإثبات أن الصفحة تعلن عن منتج مسجّل لدينا.
 */
export async function matchExistingProduct(
  db: Db,
  ownerId: string,
  input: ProductCandidateInput,
  options?: { useAi?: boolean },
): Promise<{ productId: string; canonicalName: string; code: string; score: number; via: string } | null> {
  const useAi = options?.useAi !== false && Boolean(await aiApiKey());
  const cleaned = cleanProductName(input.rawName || input.description || input.adText || "");
  const key = productIdentityKey(cleaned);
  const generic = isGenericIdentity(cleaned);

  if (key && !generic) {
    const { data: alias } = await db
      .from("product_aliases")
      .select(`product_id, products:product_id (${SELECT_COLUMNS})`)
      .eq("owner_id", ownerId)
      .eq("alias_key", key)
      .maybeSingle();
    const aliasProduct = (alias as { products?: ProductRow } | null)?.products;
    if (aliasProduct) {
      return {
        productId: aliasProduct.id,
        canonicalName: aliasProduct.canonical_name,
        code: aliasProduct.code,
        score: 1,
        via: "alias",
      };
    }

    const { data: exact } = await db
      .from("products")
      .select(SELECT_COLUMNS)
      .eq("owner_id", ownerId)
      .eq("canonical_key", key)
      .maybeSingle();
    if (exact) {
      const row = exact as ProductRow;
      return { productId: row.id, canonicalName: row.canonical_name, code: row.code, score: 1, via: "key" };
    }
  }

  const { data: allRows } = await db
    .from("products")
    .select(SELECT_COLUMNS)
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(4000);
  const all = (allRows ?? []) as ProductRow[];
  if (all.length === 0) return null;

  const scored = all
    .map((p) => ({ p, score: productSimilarity(cleaned, p.canonical_name) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];

  if (!useAi) {
    if (!generic && best && best.score >= AUTO_MATCH) {
      return {
        productId: best.p.id,
        canonicalName: best.p.canonical_name,
        code: best.p.code,
        score: best.score,
        via: "similar",
      };
    }
    return null;
  }

  const shortlist = scored
    .filter((s) => s.score >= SHORTLIST_FLOOR)
    .slice(0, SHORTLIST_SIZE)
    .map((s) => s.p);
  for (const p of all) {
    if (shortlist.length >= SHORTLIST_SIZE) break;
    if (!shortlist.includes(p) && !isEmptyProfile(parseProfile(p.profile))) shortlist.push(p);
  }
  for (const p of all) {
    if (shortlist.length >= SHORTLIST_SIZE) break;
    if (!shortlist.includes(p)) shortlist.push(p);
  }

  const verdict = await understandAndMatch(input, cleaned, shortlist, generic, ownerId);
  if (!verdict.code) return null;
  const matched = shortlist.find((p) => p.code === verdict.code);
  if (!matched) return null;
  return {
    productId: matched.id,
    canonicalName: matched.canonical_name,
    code: matched.code,
    score: verdict.score,
    via: "ai",
  };
}
