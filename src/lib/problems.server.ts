import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_MODEL, aiApiKey, aiResponses, AiTokensBlockedError } from "./ai-endpoint.server";

/**
 * Problems ككيان مستقل: Problem (pb_statements) ↔ Ad (ad_statements) ↔ Product (pb_statement_products).
 * الاستخراج يتم داخل التحليل الموحد للإعلان فقط؛ هنا: إعادة الاستخدام/الإنشاء، الربط، ومراجعة وتشييك. ملف خادم فقط.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;
export type ProblemItem = { problem_description: string; classification: string; causal_link: string; evidence: string; confidence: number };

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

async function ask<T>(ownerId: string, content: Array<Record<string, unknown>>, name: string, schema: object): Promise<T> {
  const apiKey = await aiApiKey();
  if (!apiKey) throw new Error("مفتاح الذكاء الاصطناعي غير متاح");
  const res = await aiResponses(apiKey, {
    method: "POST",
    body: JSON.stringify({
      model: AI_MODEL, input: [{ role: "user", content }], stream: true, store: false, reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name, strict: true, schema } },
    }),
  }, ownerId, "problems_benefits");
  if (!res.ok) {
    if (res.status === 402) throw new AiTokensBlockedError("نفد رصيد الـ AI.");
    throw new Error(`AI http ${res.status}`);
  }
  const out = await readOutput(res);
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("رد الذكاء الاصطناعي فارغ");
  return JSON.parse(m[0]) as T;
}

const keyOf = (s: string) => s.normalize("NFKC").replace(/\u0640/g, "").replace(/\s+/g, " ").trim().toLowerCase();

async function imageUrlFor(db: Db, path: string | null): Promise<string | null> {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const { data } = await db.storage.from("ad-images").createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

async function activeProblems(db: Db, ownerId: string) {
  const { data } = await db.from("pb_statements").select("id, display_text, description")
    .eq("owner_id", ownerId).eq("kind", "problem").is("archived_at", null);
  return (data ?? []) as { id: string; display_text: string; description: string }[];
}

/** يقبل فقط ما صُنّف problem وله دليل وعلاقة سببية. */
export function acceptedProblems(problemFound: boolean, items: ProblemItem[] | undefined): ProblemItem[] {
  if (!problemFound) return [];
  return (items ?? []).filter((p) => p.classification === "problem" && p.problem_description?.trim() && p.evidence?.trim() && p.causal_link?.trim());
}

const MATCH_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: { index: { type: "integer" }, existing_id: { type: ["string", "null"] } },
        required: ["index", "existing_id"],
      },
    },
  },
  required: ["decisions"],
};

/**
 * Existing Problem → reuse، وإلا New Problem → ID من قاعدة البيانات. ثم Problem ↔ Ad و Problem ↔ Product.
 * المطابقة الدلالية (اختلاف الصياغة لا يعني مشكلة جديدة) تُطلب فقط عند وجود مشاكل موجودة؛ ليست استخراجًا.
 */
export async function linkAdProblems(db: Db, ownerId: string, adId: string, productId: string | null, items: ProblemItem[]) {
  if (!items.length) return { linked: 0, created: 0, reused: 0 };
  const list = await activeProblems(db, ownerId);
  const valid = new Set(list.map((e) => e.id));
  const byKey = new Map(list.map((e) => [keyOf(e.display_text), e.id]));
  let decisions: { index: number; existing_id: string | null }[] = [];
  const unkeyed = items.map((it, i) => ({ it, i })).filter(({ it }) => !byKey.has(keyOf(it.problem_description)));
  if (list.length && unkeyed.length) {
    const m = await ask<{ decisions: typeof decisions }>(ownerId, [{
      type: "input_text",
      text:
        "قارن كل مشكلة جديدة بقائمة المشاكل الموجودة حسب المعنى وليس الكلمات. إذا كانت نفس مشكلة العميل فعلًا فأعد existing_id من القائمة حرفيًا، وإلا existing_id=null. " +
        "لا تخترع IDs. اختلاف الصياغة وحده لا يعني مشكلة جديدة، وكلمة مشتركة أو موضوع عام أو تشابه نصي فقط ليس سببًا للتطابق. إن لم يكن الحكم واضحًا فاجعل existing_id=null.\n\n" +
        `الموجود:\n${list.map((e) => `- id=${e.id} | ${e.display_text} | ${e.description}`).join("\n")}\n\n` +
        `الجديد:\n${unkeyed.map(({ it, i }) => `[${i}] ${it.problem_description} | الدليل: ${it.evidence}`).join("\n")}`,
    }], "problem_match", MATCH_SCHEMA);
    decisions = m.decisions ?? [];
  }
  let created = 0, reused = 0, linked = 0;
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const key = keyOf(it.problem_description);
    const d = decisions.find((x) => x.index === i)?.existing_id;
    let sid: string | null = byKey.get(key) ?? (d && valid.has(d) ? d : null);
    if (sid) reused++;
    else {
      const { data: ins } = await db.from("pb_statements").upsert(
        { owner_id: ownerId, kind: "problem", normalized_key: key, display_text: it.problem_description.trim(), description: it.causal_link, normalizer_version: 3 },
        { onConflict: "owner_id,kind,normalized_key", ignoreDuplicates: true }).select("id");
      sid = (ins?.[0]?.id as string | undefined) ?? null;
      if (!sid) {
        const { data: e2 } = await db.from("pb_statements").select("id, merged_into").eq("owner_id", ownerId).eq("kind", "problem").eq("normalized_key", key).single();
        sid = ((e2?.merged_into as string | null) ?? (e2?.id as string | undefined)) ?? null;
        reused++;
      } else created++;
      if (sid) { valid.add(sid); byKey.set(key, sid); list.push({ id: sid, display_text: it.problem_description, description: it.causal_link }); }
    }
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    const { error: le } = await db.from("ad_statements").upsert({
      owner_id: ownerId, ad_id: adId, kind: "problem", source: "unified", raw_text: it.problem_description,
      normalized_key: sid, normalizer_version: 3, statement_id: sid,
      description: it.causal_link, evidence: it.evidence, confidence: it.confidence,
    }, { onConflict: "ad_id,statement_id", ignoreDuplicates: true });
    if (le) throw new Error(le.message);
    if (productId) {
      await db.from("pb_statement_products").upsert({
        owner_id: ownerId, statement_id: sid, product_id: productId, source: "unified", evidence: it.evidence, confidence: it.confidence,
      }, { onConflict: "statement_id,product_id", ignoreDuplicates: true });
    }
    linked++;
  }
  return { linked, created, reused };
}

// ───────────── مراجعة وتشييك v2: من المشاكل، حكم مستقل لكل علاقة Problem ↔ Product، اقتراحات فقط ─────────────

export const LINK_REVIEW_PROMPT =
  "المهمة\nأنت تراجع علاقة بين مشكلة عميل ومنتج.\n\n" +
  "السؤال الأساسي:\n«هل هذه المشكلة هي مشكلة حقيقية لدى العميل، وهل هذا المنتج تحديدًا يُشترى من أجل التعامل معها أو التخلص منها؟»\n\n" +
  "لا تحكم بناءً على تشابه الكلمات فقط.\nيجب أن يكون هناك ارتباط منطقي حقيقي بين المشكلة والمنتج.\n\n" +
  "قواعد الحكم\nممنوع أن تعتبر العلاقة صحيحة بسبب:\n" +
  "- كلمة مشتركة بين المشكلة والمنتج.\n- تشابه اسم المشكلة مع اسم المنتج.\n- تشابه نصي فقط.\n- انتمائهما لنفس المجال العام.\n" +
  "- وجودهما في نفس المكان أو الفئة.\n- كون المنتج قد يكون مفيدًا بشكل عام.\n- Feature في المنتج فقط.\n- Benefit فقط.\n- Solution فقط.\n" +
  "- Usage فقط.\n- Claim تسويقي فقط.\n- تخمين سبب شراء العميل.\n- افتراض أن كل منتج له علاقة بأي مشكلة مرتبطة بنفس المجال.\n\n" +
  "يجب أن تسأل:\n«هل المنتج نفسه يعالج أو يتعامل مباشرة مع المشكلة التي تصفها هذه الـProblem؟»\n\n" +
  "أمثلة\n" +
  "- مشكلة: جفاف البشرة\n  - منتج مرطب للبشرة → يمكن أن يكون مرتبطًا.\n  - منتج يذكر \"ترطيب\" كميزة جانبية فقط دون أن يكون هذا هو الغرض الحقيقي → لا تفترض الارتباط.\n" +
  "- مشكلة: صعوبة إزالة الشعر\n  - جهاز إزالة الشعر → يمكن أن يكون مرتبطًا.\n  - منتج لتنظيم أدوات التجميل → ليس بالضرورة مرتبطًا.\n" +
  "- مشكلة: فوضى الأسلاك وعدم التنظيم\n  - منظم أسلاك → يمكن أن يكون مرتبطًا.\n  - منظم ملابس للدولاب → غير مرتبط لمجرد أن الاثنين \"تنظيم\".\n" +
  "- مشكلة: فوضى وتكدس الملابس في الدولاب\n  - منظم ملابس/دولاب → يمكن أن يكون مرتبطًا.\n  - منظم أسلاك → غير مرتبط.\n" +
  "- مشكلة: انسداد الحوض والبلاعات\n  - أداة مخصصة للتعامل مع الانسدادات → يمكن أن تكون مرتبطة.\n  - أداة تنظيف عامة لا يوجد دليل كافٍ على أنها تعالج الانسداد → لا تفترض.\n\n" +
  "الحكم — لكل علاقة Problem ↔ Product حكم مستقل (لا يجوز إعطاء حكم واحد للمشكلة كلها):\n" +
  "valid: إذا كانت المشكلة مناسبة فعلًا للمنتج ويوجد أساس واضح لذلك.\n" +
  "invalid: إذا كانت العلاقة غير صحيحة، حتى لو كان المنتج في نفس المجال العام.\n" +
  "uncertain: إذا كانت البيانات غير كافية للحكم بثقة. عند الشك لا تخمن. استخدم uncertain.\n\n" +
  "إذا كانت العلاقة invalid: ابحث داخل جميع Problems النشطة الموجودة (القائمة أدناه فقط) عن Problem أخرى مناسبة لهذا المنتج. " +
  "إذا وجدت: suggested_existing_problem_id = الـID حرفيًا من القائمة مع السبب، و create_new_problem=false. " +
  "إذا لم تجد: افحص هل بيانات المنتج تكفي لإثبات وجود Problem حقيقية يمكن ربط المنتج بها؛ إذا نعم: create_new_problem=true و new_problem_description = وصف المشكلة المقترحة فقط مع new_problem_reason. إذا لا: لا تخترع Problem ولا تقترح تغييرًا. " +
  "لا تنشئ IDs أبدًا.\n" +
  "إذا كانت valid أو uncertain: suggested_existing_problem_id=null و create_new_problem=false و new_problem_description=null.\n" +
  "أنت لا تغيّر قاعدة البيانات؛ نتيجتك اقتراح فقط يراجعه المستخدم. اكتب بالعربية.";

const conf = { type: "string", enum: ["high", "medium", "low"] };
const nstr = { type: ["string", "null"] };
export const LINK_REVIEW_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          product_id: { type: "string" }, current_problem_id: { type: "string" },
          verdict: { type: "string", enum: ["valid", "invalid", "uncertain"] }, reason: { type: "string" },
          suggested_existing_problem_id: nstr, suggested_existing_problem_reason: nstr,
          create_new_problem: { type: "boolean" }, new_problem_description: nstr, new_problem_reason: nstr, confidence: conf,
        },
        required: ["product_id", "current_problem_id", "verdict", "reason", "suggested_existing_problem_id", "suggested_existing_problem_reason", "create_new_problem", "new_problem_description", "new_problem_reason", "confidence"],
      },
    },
  },
  required: ["results"],
};

export type LinkVerdict = {
  product_id: string; current_problem_id: string; verdict: "valid" | "invalid" | "uncertain"; reason: string;
  suggested_existing_problem_id: string | null; suggested_existing_problem_reason: string | null;
  create_new_problem: boolean; new_problem_description: string | null; new_problem_reason: string | null; confidence: "high" | "medium" | "low";
};

/** يفرض قواعد الشكل على رد الـAI: IDs من القاعدة فقط، ولا اقتراح إلا مع invalid. */
export function sanitizeVerdict(v: LinkVerdict, currentId: string, activeIds: Set<string>): LinkVerdict {
  const out = { ...v, current_problem_id: currentId };
  if (!["valid", "invalid", "uncertain"].includes(out.verdict)) out.verdict = "uncertain";
  if (out.verdict !== "invalid") {
    return { ...out, suggested_existing_problem_id: null, suggested_existing_problem_reason: null, create_new_problem: false, new_problem_description: null, new_problem_reason: null };
  }
  const sug = out.suggested_existing_problem_id;
  if (sug && activeIds.has(sug) && sug !== currentId) {
    return { ...out, create_new_problem: false, new_problem_description: null, new_problem_reason: null };
  }
  out.suggested_existing_problem_id = null; out.suggested_existing_problem_reason = null;
  if (!out.create_new_problem || !out.new_problem_description?.trim()) {
    out.create_new_problem = false; out.new_problem_description = null; out.new_problem_reason = null;
  }
  return out;
}

async function productFacts(db: Db, ownerId: string, productId: string) {
  const { data: ads } = await db.from("ads").select("analysis, product_description").eq("owner_id", ownerId).eq("product_id", productId).limit(3);
  return (ads ?? []).map((a) => {
    const pr = ((a.analysis ?? {}) as { product?: Record<string, unknown> }).product ?? {};
    return { description: pr["description"] ?? a.product_description ?? null, category: pr["category"] ?? null, type: pr["type"] ?? null, features: pr["features"] ?? [], usage: pr["usage"] ?? null };
  });
}

/** يراجع كل علاقات مشكلة واحدة ويحفظها كنتائج pending. لا يعدّل pb_statements ولا pb_statement_products. */
export async function reviewProblemLinks(db: Db, ownerId: string, problemId: string) {
  const problems = await activeProblems(db, ownerId);
  const problem = problems.find((p) => p.id === problemId);
  if (!problem) throw new Error("المشكلة غير موجودة أو غير نشطة");
  const { data: linkRows } = await db.from("pb_statement_products").select("id, product_id").eq("owner_id", ownerId).eq("statement_id", problemId);
  const links = (linkRows ?? []) as { id: string; product_id: string }[];
  if (!links.length) return { reviewed: 0 };
  const { data: prods } = await db.from("products").select("id, canonical_name, profile, image_url").eq("owner_id", ownerId).in("id", links.map((l) => l.product_id));
  const pmap = new Map(((prods ?? []) as { id: string; canonical_name: string; profile: unknown; image_url: string | null }[]).map((p) => [p.id, p]));
  const activeIds = new Set(problems.map((p) => p.id));
  const BATCH = 5;
  let reviewed = 0;
  for (let b = 0; b < links.length; b += BATCH) {
    const chunk = links.slice(b, b + BATCH).filter((l) => pmap.has(l.product_id));
    if (!chunk.length) continue;
    const content: Array<Record<string, unknown>> = [{
      type: "input_text",
      text: LINK_REVIEW_PROMPT + "\n\n" +
        `بيانات المشكلة\nProblem ID: ${problem.id}\nProblem display text: ${problem.display_text}\nProblem description: ${problem.description}\n\n` +
        `كل Problems النشطة الموجودة (للاقتراح فقط):\n${problems.filter((p) => p.id !== problem.id).map((p) => `- id=${p.id} | ${p.display_text} | ${p.description}`).join("\n") || "(لا يوجد)"}\n\n` +
        "المنتجات المرتبطة بهذه المشكلة — أعد نتيجة مستقلة لكل product_id (الصور مرفقة بنفس الترتيب عند توفرها):",
    }];
    for (const l of chunk) {
      const p = pmap.get(l.product_id)!;
      const facts = await productFacts(db, ownerId, p.id);
      content.push({ type: "input_text", text: `\n— Product ID: ${p.id}\nProduct name: ${p.canonical_name}\nملف المنتج: ${JSON.stringify(p.profile ?? {}).slice(0, 1200)}\nبيانات من إعلاناته (وصف/استخدام/خصائص/فئة): ${JSON.stringify(facts).slice(0, 1500)}` });
      const img = await imageUrlFor(db, p.image_url);
      if (img) content.push({ type: "input_image", image_url: img });
    }
    const r = await ask<{ results: LinkVerdict[] }>(ownerId, content, "problem_product_link_review", LINK_REVIEW_SCHEMA);
    for (const l of chunk) {
      const raw = (r.results ?? []).find((x) => x.product_id === l.product_id);
      const v = sanitizeVerdict(raw ?? { product_id: l.product_id, current_problem_id: problemId, verdict: "uncertain", reason: "لم يُرجع الـAI حكمًا لهذا المنتج", suggested_existing_problem_id: null, suggested_existing_problem_reason: null, create_new_problem: false, new_problem_description: null, new_problem_reason: null, confidence: "low" }, problemId, activeIds);
      await db.from("pb_link_reviews").update({ status: "superseded", decided_at: new Date().toISOString() }).eq("owner_id", ownerId).eq("link_id", l.id).eq("status", "pending");
      const { error } = await db.from("pb_link_reviews").insert({
        owner_id: ownerId, link_id: l.id, statement_id: problemId, product_id: l.product_id, verdict: v.verdict, reason: v.reason, confidence: v.confidence,
        suggested_problem_id: v.suggested_existing_problem_id, suggested_reason: v.suggested_existing_problem_reason,
        create_new_problem: v.create_new_problem, new_problem_description: v.new_problem_description, new_problem_reason: v.new_problem_reason,
      });
      if (error) throw new Error(error.message);
      reviewed++;
    }
  }
  return { reviewed };
}

/** تطبيق قرار المستخدم لنتيجة واحدة فقط، بعد إعادة التحقق من الملكية وعدم تغيّر البيانات. */
export async function decideLinkReview(db: Db, ownerId: string, reviewId: string, approve: boolean) {
  const { data: rv } = await db.from("pb_link_reviews").select("*").eq("id", reviewId).eq("owner_id", ownerId).maybeSingle();
  if (!rv) throw new Error("النتيجة غير موجودة");
  if (rv.status !== "pending") return { status: rv.status as string, note: "تم البت فيها سابقًا" };
  const finish = async (status: string, note: string | null) => {
    await db.from("pb_link_reviews").update({ status, status_note: note, decided_at: new Date().toISOString() }).eq("id", reviewId).eq("owner_id", ownerId);
    return { status, note };
  };
  if (!approve) return finish("rejected", null);
  const changes = rv.verdict === "invalid" && (rv.suggested_problem_id || rv.create_new_problem);
  if (!changes) return finish("approved", "لا يوجد تغيير على العلاقة");
  // إعادة التحقق
  const stale = (why: string) => finish("stale", `النتيجة قديمة وتحتاج إعادة مراجعة: ${why}`);
  const { data: link } = await db.from("pb_statement_products").select("id, statement_id, product_id").eq("id", rv.link_id).eq("owner_id", ownerId).maybeSingle();
  if (!link || link.statement_id !== rv.statement_id || link.product_id !== rv.product_id) return stale("العلاقة تغيّرت");
  const { data: cur } = await db.from("pb_statements").select("id").eq("id", rv.statement_id).eq("owner_id", ownerId).eq("kind", "problem").is("archived_at", null).maybeSingle();
  if (!cur) return stale("المشكلة الحالية لم تعد نشطة");
  const { data: prod } = await db.from("products").select("id").eq("id", rv.product_id).eq("owner_id", ownerId).maybeSingle();
  if (!prod) return stale("المنتج لم يعد موجودًا");
  let target: string | null = null;
  if (rv.suggested_problem_id) {
    const { data: t } = await db.from("pb_statements").select("id").eq("id", rv.suggested_problem_id).eq("owner_id", ownerId).eq("kind", "problem").is("archived_at", null).maybeSingle();
    if (!t) return stale("المشكلة المقترحة لم تعد موجودة");
    target = t.id as string;
  } else {
    const desc = String(rv.new_problem_description ?? "").trim();
    if (!desc) return stale("لا يوجد وصف للمشكلة الجديدة");
    const key = keyOf(desc);
    const { data: ins } = await db.from("pb_statements").upsert(
      { owner_id: ownerId, kind: "problem", normalized_key: key, display_text: desc, description: rv.new_problem_reason ?? "", normalizer_version: 3 },
      { onConflict: "owner_id,kind,normalized_key", ignoreDuplicates: true }).select("id");
    target = (ins?.[0]?.id as string | undefined) ?? null;
    if (!target) {
      const { data: e2 } = await db.from("pb_statements").select("id, merged_into").eq("owner_id", ownerId).eq("kind", "problem").eq("normalized_key", key).single();
      target = ((e2?.merged_into as string | null) ?? (e2?.id as string | undefined)) ?? null;
    }
    if (!target) throw new Error("تعذّر إنشاء المشكلة الجديدة");
  }
  const { error: e1 } = await db.from("pb_statement_products").upsert(
    { owner_id: ownerId, statement_id: target, product_id: rv.product_id, source: "review", evidence: rv.suggested_reason ?? rv.new_problem_reason ?? rv.reason, confidence: null },
    { onConflict: "statement_id,product_id", ignoreDuplicates: true });
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await db.from("pb_statement_products").delete().eq("id", link.id).eq("owner_id", ownerId);
  if (e2) throw new Error(e2.message);
  return finish("approved", rv.suggested_problem_id ? "نُقلت العلاقة إلى المشكلة المقترحة" : "أُنشئت مشكلة جديدة ونُقلت العلاقة إليها");
}

/**
 * رفض نتيجة مراجعة مع خيار نقل المنتج يدويًا إلى مشكلة يختارها المستخدم من القائمة المنسدلة،
 * أو إلى مشكلة جديدة ينشئها من النموذج — أو رفض دون أي تغيير. إعادة تحقق قبل أي نقل.
 */
export async function rejectLinkReview(
  db: Db,
  ownerId: string,
  input: { reviewId: string; targetProblemId: string | null; newProblemText: string | null; newProblemDescription: string }
): Promise<{ status: string; note: string | null; moved: boolean }> {
  const { data: rv } = await db.from("pb_link_reviews").select("*").eq("id", input.reviewId).eq("owner_id", ownerId).maybeSingle();
  if (!rv) throw new Error("النتيجة غير موجودة");
  if (rv.status !== "pending") return { status: rv.status as string, note: "تم البت فيها سابقًا", moved: false };
  const finish = async (note: string | null, moved = false) => {
    await db.from("pb_link_reviews").update({ status: "rejected", status_note: note, decided_at: new Date().toISOString() }).eq("id", input.reviewId).eq("owner_id", ownerId);
    return { status: "rejected", note, moved };
  };
  if (!input.targetProblemId && !input.newProblemText?.trim()) return finish(null);
  // إعادة التحقق قبل نقل العلاقة
  const { data: link } = await db.from("pb_statement_products").select("id, statement_id, product_id").eq("id", rv.link_id).eq("owner_id", ownerId).maybeSingle();
  if (!link || link.statement_id !== rv.statement_id || link.product_id !== rv.product_id) return finish("لم تُنقل العلاقة: تغيّرت بعد المراجعة");
  const { data: prod } = await db.from("products").select("id").eq("id", rv.product_id).eq("owner_id", ownerId).maybeSingle();
  if (!prod) return finish("لم تُنقل العلاقة: المنتج لم يعد موجودًا");
  let target: string | null = input.targetProblemId;
  if (target) {
    const { data: t } = await db.from("pb_statements").select("id").eq("id", target).eq("owner_id", ownerId).eq("kind", "problem").is("archived_at", null).maybeSingle();
    if (!t) return finish("لم تُنقل العلاقة: المشكلة المختارة لم تعد موجودة");
  } else {
    const desc = String(input.newProblemText ?? "").trim();
    const key = keyOf(desc);
    const { data: ins, error } = await db.from("pb_statements").upsert(
      { owner_id: ownerId, kind: "problem", normalized_key: key, display_text: desc, description: input.newProblemDescription.trim(), normalizer_version: 3 },
      { onConflict: "owner_id,kind,normalized_key", ignoreDuplicates: true }).select("id");
    if (error) throw new Error(error.message);
    target = (ins?.[0]?.id as string | undefined) ?? null;
    if (!target) {
      const { data: e2 } = await db.from("pb_statements").select("id, merged_into").eq("owner_id", ownerId).eq("kind", "problem").eq("normalized_key", key).single();
      target = ((e2?.merged_into as string | null) ?? (e2?.id as string | undefined)) ?? null;
    }
    if (!target) throw new Error("تعذّر إنشاء المشكلة الجديدة");
  }
  if (target === rv.statement_id) return finish("المشكلة المختارة هي نفسها المشكلة الحالية — لم يتغير شيء");
  const { error: e1 } = await db.from("pb_statement_products").upsert(
    { owner_id: ownerId, statement_id: target, product_id: rv.product_id, source: "review", evidence: "نقل يدوي من المستخدم عند رفض نتيجة المراجعة", confidence: null },
    { onConflict: "statement_id,product_id", ignoreDuplicates: true });
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await db.from("pb_statement_products").delete().eq("id", link.id).eq("owner_id", ownerId);
  if (e2) throw new Error(e2.message);
  return finish(input.targetProblemId ? "رُفض الاقتراح ونُقل المنتج يدويًا إلى المشكلة المختارة" : "رُفض الاقتراح وأُنشئت مشكلة جديدة نُقل إليها المنتج", true);
}

/**
 * إنشاء مشكلة يدويًا من المستخدم (نموذج «إنشاء مشكلة» في بطاقات نتائج المراجعة).
 * يعيد استخدام مشكلة موجودة مطابقة نصيًا بدل تكرارها، ويربط المنتج الحالي بها عند الطلب.
 */
export async function createManualProblem(
  db: Db,
  ownerId: string,
  input: { text: string; description: string; productId: string | null }
): Promise<{ id: string; existed: boolean; linked: boolean }> {
  const text = input.text.trim();
  const key = keyOf(text);
  const { data: ins, error } = await db.from("pb_statements").upsert(
    { owner_id: ownerId, kind: "problem", normalized_key: key, display_text: text, description: input.description.trim(), normalizer_version: 3 },
    { onConflict: "owner_id,kind,normalized_key", ignoreDuplicates: true }).select("id");
  if (error) throw new Error(error.message);
  let id = (ins?.[0]?.id as string | undefined) ?? null;
  let existed = false;
  if (!id) {
    existed = true;
    const { data: e2, error: e3 } = await db.from("pb_statements").select("id, merged_into").eq("owner_id", ownerId).eq("kind", "problem").eq("normalized_key", key).single();
    if (e3) throw new Error(e3.message);
    id = ((e2?.merged_into as string | null) ?? (e2?.id as string | undefined)) ?? null;
  }
  if (!id) throw new Error("تعذّر إنشاء المشكلة");
  let linked = false;
  if (input.productId) {
    const { data: prod } = await db.from("products").select("id").eq("id", input.productId).eq("owner_id", ownerId).maybeSingle();
    if (!prod) throw new Error("المنتج لم يعد موجودًا");
    const { error: le } = await db.from("pb_statement_products").upsert(
      { owner_id: ownerId, statement_id: id, product_id: input.productId, source: "review", evidence: "ربط يدوي من المستخدم", confidence: null },
      { onConflict: "statement_id,product_id", ignoreDuplicates: true });
    if (le) throw new Error(le.message);
    linked = true;
  }
  return { id, existed, linked };
}

// ───────────── تشييك دمج: هل مشكلتان محددتان هما نفس مشكلة العميل فعلًا؟ اقتراحات فقط، لا دمج تلقائي ─────────────

export const MERGE_REVIEW_PROMPT =
  "المهمة\nأنت تراجع مجموعة مشاكل عميل محددة لتقرر هل بعضها يصف نفس مشكلة العميل فعلًا (ويستحق الدمج) أم أنها مشاكل مختلفة.\n\n" +
  "السؤال الأساسي لكل زوج:\n«هل هاتان المشكلتان تصفان نفس معاناة العميل الحقيقية، بحيث يكون المنتج الذي يعالج إحداهما هو نفسه الذي يعالج الأخرى؟»\n\n" +
  "قواعد الحكم\n" +
  "- اختلاف الصياغة وحده لا يعني مشكلة جديدة: نفس المعنى بكلمات مختلفة = merge.\n" +
  "- كلمة مشتركة أو موضوع عام أو نفس المجال (مثل «تنظيم») ليس سببًا للدمج: فوضى الأسلاك ≠ فوضى الملابس في الدولاب.\n" +
  "- مشكلة عامة وأخرى أخصّ منها ليستا بالضرورة نفس المشكلة؛ ادمج فقط إذا كان المنتج المعالج واحدًا فعلًا.\n" +
  "- عند الشك لا تخمن: استخدم uncertain.\n\n" +
  "الحكم — لكل زوج حكم مستقل:\n" +
  "merge: نفس مشكلة العميل فعلًا؛ حدد target_problem_id = الـID الذي يجب أن تبقى عليه المشكلة (الأوضح والأشمل)، و source_problem_id = الـID الذي سيُدمج فيه.\n" +
  "separate: مشكلتان مختلفتان فعلًا.\n" +
  "uncertain: البيانات غير كافية للحكم بثقة.\n\n" +
  "أعد نتيجة لكل زوج مطلوب فقط، ولا تنشئ IDs أبدًا — استخدم الـIDs المعطاة حرفيًا.\n" +
  "أنت لا تغيّر قاعدة البيانات؛ نتيجتك اقتراح فقط يراجعه المستخدم ولا يُطبَّق أي دمج إلا بموافقته. اكتب بالعربية.";

export const MERGE_REVIEW_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          source_problem_id: { type: "string" }, target_problem_id: { type: "string" },
          verdict: { type: "string", enum: ["merge", "separate", "uncertain"] },
          reason: { type: "string" }, confidence: conf,
        },
        required: ["source_problem_id", "target_problem_id", "verdict", "reason", "confidence"],
      },
    },
  },
  required: ["results"],
};

export type MergeVerdict = {
  source_problem_id: string; target_problem_id: string;
  verdict: "merge" | "separate" | "uncertain"; reason: string; confidence: "high" | "medium" | "low";
};

/**
 * يقارن المشاكل المحددة زوجًا بزوج ويحفظ اقتراحات الدمج pending. لا يدمج شيئًا.
 * يُرجع فقط أزواج merge/uncertain — separate لا يحتاج قرارًا من المستخدم.
 */
export async function reviewProblemMerges(db: Db, ownerId: string, problemIds: string[]) {
  const problems = await activeProblems(db, ownerId);
  const chosen = problems.filter((p) => problemIds.includes(p.id));
  if (chosen.length < 2) throw new Error("حدّد مشكلتين نشطتين على الأقل لتشييك الدمج");
  const ids = new Set(chosen.map((p) => p.id));
  // كل الأزواج الممكنة
  const pairs: [typeof chosen[number], typeof chosen[number]][] = [];
  for (let i = 0; i < chosen.length; i++)
    for (let j = i + 1; j < chosen.length; j++) pairs.push([chosen[i]!, chosen[j]!]);
  const BATCH = 10;
  let reviewed = 0;
  for (let b = 0; b < pairs.length; b += BATCH) {
    const chunk = pairs.slice(b, b + BATCH);
    const r = await ask<{ results: MergeVerdict[] }>(ownerId, [{
      type: "input_text",
      text: MERGE_REVIEW_PROMPT + "\n\n" +
        `المشاكل المحددة:\n${chosen.map((p) => `- id=${p.id} | ${p.display_text} | ${p.description}`).join("\n")}\n\n` +
        `الأزواج المطلوب الحكم عليها (أعد نتيجة لكل زوج):\n${chunk.map(([a, b2], k) => `[${k}] A=${a.id} «${a.display_text}» ↔ B=${b2.id} «${b2.display_text}»`).join("\n")}`,
    }], "problem_merge_review", MERGE_REVIEW_SCHEMA);
    for (const [a, b2] of chunk) {
      const raw = (r.results ?? []).find((x) =>
        (x.source_problem_id === a.id && x.target_problem_id === b2.id) ||
        (x.source_problem_id === b2.id && x.target_problem_id === a.id));
      const v: MergeVerdict = raw && ids.has(raw.source_problem_id) && ids.has(raw.target_problem_id) && raw.source_problem_id !== raw.target_problem_id
        ? raw
        : { source_problem_id: a.id, target_problem_id: b2.id, verdict: "uncertain", reason: "لم يُرجع الـAI حكمًا صالحًا لهذا الزوج", confidence: "low" };
      if (!["merge", "separate", "uncertain"].includes(v.verdict)) v.verdict = "uncertain";
      if (v.verdict === "separate") { reviewed++; continue; } // لا قرار مطلوب
      await db.from("pb_merge_reviews")
        .update({ status: "superseded", decided_at: new Date().toISOString() })
        .eq("owner_id", ownerId).eq("source_statement_id", v.source_problem_id).eq("target_statement_id", v.target_problem_id).eq("status", "pending");
      const { error } = await db.from("pb_merge_reviews").insert({
        owner_id: ownerId, source_statement_id: v.source_problem_id, target_statement_id: v.target_problem_id,
        verdict: v.verdict, reason: v.reason, confidence: v.confidence,
      });
      if (error) throw new Error(error.message);
      reviewed++;
    }
  }
  return { reviewed };
}

/** تطبيق قرار المستخدم على اقتراح دمج: الموافقة تنقل كل الروابط وتؤرشف المشكلة المدموجة — بعد إعادة تحقق. */
export async function decideMergeReview(db: Db, ownerId: string, reviewId: string, approve: boolean) {
  const { data: rv } = await db.from("pb_merge_reviews").select("*").eq("id", reviewId).eq("owner_id", ownerId).maybeSingle();
  if (!rv) throw new Error("النتيجة غير موجودة");
  if (rv.status !== "pending") return { status: rv.status as string, note: "تم البت فيها سابقًا" };
  const finish = async (status: string, note: string | null) => {
    await db.from("pb_merge_reviews").update({ status, status_note: note, decided_at: new Date().toISOString() }).eq("id", reviewId).eq("owner_id", ownerId);
    return { status, note };
  };
  if (!approve) return finish("rejected", null);
  if (rv.verdict !== "merge") return finish("approved", "لا يوجد دمج مطلوب");
  const stale = (why: string) => finish("stale", `النتيجة قديمة وتحتاج إعادة مراجعة: ${why}`);
  const src = rv.source_statement_id as string, tgt = rv.target_statement_id as string;
  const { data: both } = await db.from("pb_statements").select("id, merged_into").eq("owner_id", ownerId).eq("kind", "problem").is("archived_at", null).in("id", [src, tgt]);
  const found = new Set((both ?? []).map((r) => r.id as string));
  if (!found.has(src) || !found.has(tgt)) return stale("إحدى المشكلتين لم تعد نشطة");
  // نقل روابط المنتجات
  const { data: links } = await db.from("pb_statement_products").select("id, product_id").eq("owner_id", ownerId).eq("statement_id", src);
  for (const l of links ?? []) {
    const { error: e1 } = await db.from("pb_statement_products").upsert(
      { owner_id: ownerId, statement_id: tgt, product_id: l.product_id, source: "review", evidence: "دمج مشاكل بموافقة المستخدم", confidence: null },
      { onConflict: "statement_id,product_id", ignoreDuplicates: true });
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await db.from("pb_statement_products").delete().eq("id", l.id).eq("owner_id", ownerId);
    if (e2) throw new Error(e2.message);
  }
  // نقل روابط الإعلانات
  const { error: e3 } = await db.from("ad_statements").update({ statement_id: tgt }).eq("owner_id", ownerId).eq("statement_id", src);
  if (e3) throw new Error(e3.message);
  // أرشفة المشكلة المدموجة
  const { error: e4 } = await db.from("pb_statements").update({ merged_into: tgt, archived_at: new Date().toISOString() }).eq("id", src).eq("owner_id", ownerId);
  if (e4) throw new Error(e4.message);
  return finish("approved", "دُمجت المشكلة ونُقلت كل روابطها");
}
