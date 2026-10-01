import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_MODEL, aiApiKey, aiResponses, AiTokensBlockedError } from "./ai-endpoint.server";
import { resolveProduct } from "./product-resolver.server";
import { storeAdImage, storeAdImageResult } from "./ad-crawl.server";
import { buildUnifiedPrompt } from "./unified-ad-prompt";
import { acceptedProblems, linkAdProblems, type ProblemItem } from "./problems.server";

/**
 * المرحلة الثانية: تحويل الإعلان الخام الجديد (competitor_raw_ads.is_new) إلى إعلان منظم في ads.
 * تعمل فقط على الإعلانات غير المعالجة؛ source_ad_id هو مفتاح الهوية والـidempotency.
 * لا تلمس منطق الزحف ولا حالة النشاط. ملف خادم فقط.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

export const ANALYSIS_VERSION = "unified-v1";
const BATCH = 6;
const LEASE_S = 180;
const RETRY_S = [60, 300, 900];
const MIN_PRODUCT_CONFIDENCE = 0.5;

type Job = { id: string; owner_id: string; raw_ad_id: string; source_ad_id: string; attempts: number; max_attempts: number; product_id: string | null };

const nullableStr = { type: ["string", "null"] };
const nullableNum = { type: ["number", "null"] };
const strList = { type: "array", items: { type: "string" } };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    ad: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: nullableStr, hook: nullableStr, cta: nullableStr, creative_type: nullableStr, creative_description: nullableStr,
        core_message: nullableStr, offer: nullableStr, price: nullableNum, discount: nullableStr, currency: nullableStr,
        target_audience: nullableStr, marketing_angle: nullableStr, main_benefit: nullableStr,
        landing_url: nullableStr, offer_confidence: nullableNum, creative_confidence: nullableNum,
      },
      required: ["title", "hook", "cta", "creative_type", "creative_description", "core_message", "offer", "price", "discount", "currency", "target_audience", "marketing_angle", "main_benefit", "landing_url", "offer_confidence", "creative_confidence"],
    },
    product: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: nullableStr, name_confidence: nullableNum, category: nullableStr, category_confidence: nullableNum,
        description: nullableStr, type: nullableStr, brand: nullableStr, brand_confidence: nullableNum,
        price: nullableNum, currency: nullableStr, price_confidence: nullableNum, variants: strList, features: strList,
        usage: nullableStr, problem_solved: nullableStr,
      },
      required: ["name", "name_confidence", "category", "category_confidence", "description", "type", "brand", "brand_confidence", "price", "currency", "price_confidence", "variants", "features", "usage", "problem_solved"],
    },
    product_understanding: {
      type: "object",
      additionalProperties: false,
      properties: {
        nature: nullableStr, what_it_is: nullableStr, components: nullableStr, how_it_works: nullableStr, how_it_is_used: nullableStr,
        actual_uses: nullableStr, intended_change: nullableStr, customer_state_before_use: nullableStr, customer_pain_or_difficulty: nullableStr,
        problem_bought_for: nullableStr, what_customer_wants_to_get_rid_of: nullableStr, evidence: nullableStr,
      },
      required: ["nature", "what_it_is", "components", "how_it_works", "how_it_is_used", "actual_uses", "intended_change", "customer_state_before_use", "customer_pain_or_difficulty", "problem_bought_for", "what_customer_wants_to_get_rid_of", "evidence"],
    },
    problem_found: { type: "boolean" },
    problems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          problem_description: { type: "string" },
          classification: { type: "string", enum: ["problem", "feature", "solution", "benefit", "usage", "offer", "claim", "objection", "marketing"] },
          causal_link: { type: "string" }, evidence: { type: "string" }, confidence: { type: "number" },
        },
        required: ["problem_description", "classification", "causal_link", "evidence", "confidence"],
      },
    },
    no_problem_reason: nullableStr,
  },
  required: ["ad", "product", "product_understanding", "problem_found", "problems", "no_problem_reason"],
};

async function readOutput(res: Response): Promise<string> {
  const text = await res.text();
  let out = "";
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const e = JSON.parse(line.slice(5).trim()) as { type?: string; delta?: string; response?: { output_text?: string } };
      if (e.type === "response.output_text.delta" && e.delta) out += e.delta;
      else if (e.type === "response.completed" && e.response?.output_text) out = e.response.output_text;
    } catch { /* حدث غير مكتمل */ }
  }
  return out;
}

type Analysis = {
  ad: Record<string, unknown>; product: Record<string, unknown> & { name: string | null; name_confidence: number | null };
  product_understanding: Record<string, unknown>; problem_found: boolean; problems: ProblemItem[]; no_problem_reason: string | null;
};

async function analyze(ownerId: string, raw: Record<string, unknown>): Promise<Analysis> {
  const apiKey = await aiApiKey();
  if (!apiKey) throw new Error("مفتاح الذكاء الاصطناعي غير متاح");
  // البيانات الخام فقط — لا نتائج AI سابقة.
  const facts = [
    `source_ad_id: ${raw["source_ad_id"]}`, `page_name: ${raw["page_name"]}`, `source_page_id: ${raw["source_page_id"] ?? "null"}`,
    `source_url: ${raw["source_url"] ?? "null"}`, `start_date: ${raw["start_date"] ?? "null"}`, `end_date: ${raw["end_date"] ?? "null"}`,
    `source_path: ${raw["source_path"] ?? "null"}`, `ad_text:\n${String(raw["ad_text"] ?? "").slice(0, 3000)}`,
  ].join("\n");
  const content: Array<Record<string, unknown>> = [{ type: "input_text", text: buildUnifiedPrompt(facts) }];
  if (raw["image_url"]) content.push({ type: "input_image", image_url: raw["image_url"] });
  const res = await aiResponses(apiKey, {
    method: "POST",
    body: JSON.stringify({
      model: AI_MODEL, input: [{ role: "user", content }], stream: true, store: false, reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "unified_ad_analysis", strict: true, schema: SCHEMA } },
    }),
  }, ownerId, "ad_extract");
  if (!res.ok) throw new Error(`AI http ${res.status}`);
  const out = await readOutput(res);
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("parse: رد الذكاء الاصطناعي فارغ");
  return JSON.parse(m[0]) as Analysis;
}

export async function processOne(db: Db, job: Job): Promise<"ok" | "blocked" | "failed"> {
  const now = () => new Date().toISOString();
  try {
    const { data: raw, error } = await db.from("competitor_raw_ads").select("*").eq("id", job.raw_ad_id).single();
    if (error || !raw) throw new Error(error?.message ?? "الإعلان الخام غير موجود");

    // إعلان أساسي موجود لنفس source_ad_id: لا AI ولا تكرار — نربط فقط.
    const { data: existingAd } = await db.from("ads").select("id, product_id").eq("owner_id", job.owner_id).eq("source_ad_id", job.source_ad_id).maybeSingle();
    if (existingAd) {
      await db.from("raw_ad_analyses").update({ status: "completed", ad_id: existingAd.id, product_id: existingAd.product_id, processing_completed_at: now(), lease_expires_at: null, last_error: null }).eq("id", job.id);
      await db.from("competitor_raw_ads").update({ is_new: false }).eq("id", job.raw_ad_id);
      return "ok";
    }

    const a = await analyze(job.owner_id, raw);
    const conf = Number(a.product.name_confidence ?? 0);
    const base = { result: a, model: AI_MODEL, analysis_version: ANALYSIS_VERSION };

    if (!a.product.name || conf < MIN_PRODUCT_CONFIDENCE) {
      // هوية المنتج غير مؤكدة: لا نربط بمنتج خاطئ ولا ننشئ إعلانًا حتى المراجعة.
      await db.from("raw_ad_analyses").update({ ...base, status: "needs_review", match_status: "UNCERTAIN", match_score: conf, processing_completed_at: now(), lease_expires_at: null, last_error: null }).eq("id", job.id);
      return "ok";
    }

    // نسخ صورة الإعلان إلى التخزين الخاص (روابط فيسبوك مؤقتة).
    const copy = raw.image_url ? await storeAdImageResult(job.owner_id, raw.image_url) : null;
    const storedImage = copy?.path ?? null;
    // فشل النسخ لا يُعتبر نجاحًا: يُسجَّل سببه مع الإعلان.
    const imageCopy = copy ? (copy.path ? { ok: true } : { ok: false, reason: copy.reason, at: now() }) : null;
    if (copy && !copy.path) console.warn("ad image copy failed:", job.source_ad_id, copy.reason);
    const imagePath: string | null = storedImage ?? raw.image_url ?? null;

    let productId = job.product_id;
    let matchStatus: "MATCHED" | "NEW_PRODUCT" = "MATCHED";
    let score: number | null = null;
    if (!productId) {
      const evidence = [a.product["category"], a.product["brand"], a.product["type"], a.product["usage"], ...((a.product["features"] as string[]) ?? [])].filter(Boolean).join(" | ");
      const r = await resolveProduct(db, job.owner_id, {
        rawName: a.product.name, description: (a.product["description"] as string) ?? null, adText: raw.ad_text, imageUrl: raw.image_url, evidence,
      }, { imagePathForProduct: storedImage });
      productId = r.productId;
      matchStatus = r.created ? "NEW_PRODUCT" : "MATCHED";
      score = r.matchScore ?? null;
      if (r.created) await db.from("products").update({ created_from_source_ad_id: job.source_ad_id }).eq("id", productId);
      // حفظ المنتج فورًا حتى لا يُنشأ منتج مكرر عند إعادة المحاولة.
      await db.from("raw_ad_analyses").update({ product_id: productId, match_status: matchStatus, match_score: score }).eq("id", job.id);
    }

    const { data: comp } = await db.from("competitors").select("platform").eq("id", raw.competitor_id).maybeSingle();
    const { data: ad, error: adErr } = await db.from("ads").upsert({
      owner_id: job.owner_id, competitor_id: raw.competitor_id, product_id: productId, raw_ad_id: raw.id,
      product_name: a.product.name, product_description: (a.product["description"] as string) ?? raw.ad_text?.slice(0, 500) ?? "",
      source_ad_id: job.source_ad_id, source_page_id: raw.source_page_id, source_url: raw.source_url, image_url: imagePath,
      source_platform: comp?.platform ?? "Facebook",
      creation_date: raw.start_date ?? String(raw.first_seen_at).slice(0, 10),
      end_date: raw.is_active ? null : raw.end_date, status: raw.is_active && raw.seen_state !== "stopped" ? "active" : "inactive",
      last_seen_at: raw.last_seen_at,
      analysis: {
        ad: a.ad, product: a.product, product_understanding: a.product_understanding, problem_found: a.problem_found,
        problems: a.problems, no_problem_reason: a.no_problem_reason, version: ANALYSIS_VERSION, image_copy: imageCopy,
      },
    }, { onConflict: "owner_id,source_platform,source_ad_id" }).select("id").single();
    if (adErr) throw adErr;

    // Problem من نفس التحليل (بدون AI استخراج ثانٍ): Existing → reuse، New → ID من قاعدة البيانات، ثم Problem ↔ Ad و Problem ↔ Product.
    try {
      const link = await linkAdProblems(db, job.owner_id, ad.id, productId, acceptedProblems(a.problem_found, a.problems));
      await db.from("ads").update({ pb_status: "done", pb_result: { source: "unified", ...link, no_problem_reason: a.no_problem_reason }, pb_processed_at: now() }).eq("id", ad.id);
    } catch (le) {
      const lm = le instanceof Error ? le.message : String(le);
      if (le instanceof AiTokensBlockedError) throw le;
      await db.from("ads").update({ pb_status: "failed", pb_result: { source: "unified", error: lm.slice(0, 500) }, pb_processed_at: now() }).eq("id", ad.id);
    }

    await db.from("raw_ad_analyses").update({ ...base, status: "completed", ad_id: ad.id, processing_completed_at: now(), lease_expires_at: null, last_error: null }).eq("id", job.id);
    await db.from("products").update({ created_from_ad_id: ad.id }).eq("id", productId).eq("created_from_source_ad_id", job.source_ad_id).is("created_from_ad_id", null);
    if (storedImage) await db.from("products").update({ image_url: storedImage }).eq("id", productId).is("image_url", null);
    await db.from("competitor_raw_ads").update({ is_new: false }).eq("id", job.raw_ad_id);
    return "ok";
  } catch (e) {
    const pe = e as { message?: string; details?: string; code?: string };
    const msg = e instanceof Error ? e.message : pe?.message ? [pe.code, pe.message, pe.details].filter(Boolean).join(" · ") : String(e);
    const blocked = e instanceof AiTokensBlockedError || /http 40[23]/.test(msg);
    const delay = RETRY_S[Math.min(job.attempts - 1, RETRY_S.length - 1)] ?? 900;
    await db.from("raw_ad_analyses").update({
      // الرصيد/الصلاحية: يعود للانتظار بلا استهلاك محاولة ويتوقف الدفع كله.
      status: blocked ? "pending" : "failed", attempts: blocked ? Math.max(0, job.attempts - 1) : job.attempts,
      last_error: msg.slice(0, 500), lease_expires_at: null,
      next_attempt_at: new Date(Date.now() + (blocked ? 3600 : delay) * 1000).toISOString(),
    }).eq("id", job.id);
    return blocked ? "blocked" : "failed";
  }
}

/** إصلاح الصور: ينسخ صور الإعلانات ذات الروابط الخارجية المؤقتة إلى التخزين، ويعطي كل منتج بلا صورة صورة أحد إعلاناته. */
export async function backfillImages(db: Db, deadlineMs: number, limit = 40) {
  let copied = 0, productsFixed = 0;
  const { data: ads } = await db.from("ads").select("id, owner_id, image_url").like("image_url", "http%").order("created_at", { ascending: false }).limit(limit);
  for (const ad of (ads ?? []) as Array<{ id: string; owner_id: string; image_url: string }>) {
    if (Date.now() > deadlineMs) break;
    const path = await storeAdImage(ad.owner_id, ad.image_url);
    // رابط منتهٍ لا يمكن استعادته: نفرّغه حتى لا نحاول كل مرة.
    const expired = !path && /[?&]oe=([0-9a-f]+)/i.test(ad.image_url) && parseInt(ad.image_url.match(/[?&]oe=([0-9a-f]+)/i)?.[1] ?? "0", 16) * 1000 < Date.now();
    if (path || expired) { await db.from("ads").update({ image_url: path }).eq("id", ad.id); if (path) copied++; }
  }
  const { data: prods } = await db.from("products").select("id").is("image_url", null).eq("is_demo", false).limit(200);
  for (const p of (prods ?? []) as Array<{ id: string }>) {
    const { data: withImg } = await db.from("ads").select("image_url").eq("product_id", p.id).not("image_url", "is", null).not("image_url", "like", "http%").order("created_at").limit(1).maybeSingle();
    const img = (withImg as { image_url?: string } | null)?.image_url;
    if (img) { await db.from("products").update({ image_url: img }).eq("id", p.id).is("image_url", null); productsFixed++; }
  }
  return { copied, productsFixed, remaining: (ads ?? []).length - copied };
}

/** يدرج الجديد في الطابور ويعالج دفعات صغيرة حتى المهلة؛ يتوقف فورًا عند نفاد الرصيد. */
export async function processRawAdAnalyses(db: Db, deadlineMs: number) {
  const { data: queued } = await db.rpc("enqueue_raw_ad_analyses" as never, { _limit: 500 } as never);
  let processed = 0, ok = 0, failed = 0, paused = false;
  while (Date.now() < deadlineMs && !paused) {
    const { data, error } = await db.rpc("claim_raw_ad_analyses" as never, { _limit: BATCH, _lease_seconds: LEASE_S } as never);
    if (error) throw error;
    const jobs = (data ?? []) as Job[];
    if (!jobs.length) break;
    // تحليل الدفعة بالتوازي لتسريع الطابور.
    const results = await Promise.all(jobs.map((j) => processOne(db, j)));
    for (const r of results) {
      processed++;
      if (r === "ok") ok++; else if (r === "failed") failed++; else paused = true;
    }
  }
  const { count } = await db.from("raw_ad_analyses").select("id", { count: "exact", head: true })
    .or("status.eq.pending,status.eq.processing,and(status.eq.failed,attempts.lt.3)").lte("next_attempt_at", new Date().toISOString());
  return { queued: Number(queued ?? 0), processed, ok, failed, paused, remaining: count ?? 0 };
}
