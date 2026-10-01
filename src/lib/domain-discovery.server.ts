/**
 * اكتشاف منافسين حسب المجال (ملف خادم فقط).
 * الزحف بلا ذكاء اصطناعي: الكلمات المعتمدة → مكتبة إعلانات فيسبوك → competitor_raw_ads (بلا منافس بعد).
 * ثم تحليل الصفحات بالذكاء الاصطناعي، والقرار النهائي للمستخدم.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ask, keyOf, searchCandidateAds, type CandidateAd } from "@/lib/pcrawl.server";

type Db = SupabaseClient<Database>;
const anyDb = (db: Db) => db as unknown as SupabaseClient<any>;
const PAGES_PER_STEP = 3;
const KEYS_PER_STEP = 2;

export const DEFAULT_CRITERIA = [
  "ارتباط واضح بالمجال المحدد",
  "وجود إعلانات نشطة",
  "وجود منتجات أو خدمات مرتبطة بالمجال",
  "نشاط تجاري واضح (بيع فعلي وليس محتوى عامًا)",
];

const strList = (v: unknown, max = 40) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()).slice(0, max) : [];

/** أحدث 10 إعلانات منظمة للمجال: إعلانات المنافسين الذين يحمل مجالهم نفس اسم المجال. */
export async function latestDomainAds(db: Db, ownerId: string, domainName: string) {
  const { data: comps } = await db.from("competitors").select("id").eq("owner_id", ownerId).eq("niche", domainName).limit(200);
  const ids = (comps ?? []).map((c) => c.id);
  if (!ids.length) return [] as string[];
  const { data } = await db
    .from("ads").select("product_name, product_description").eq("owner_id", ownerId).in("competitor_id", ids)
    .order("created_at", { ascending: false }).limit(10);
  return (data ?? []).map((a) => `${a.product_name} — ${(a.product_description ?? "").slice(0, 400)}`);
}

const KW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { description: { type: "string" }, keywords: { type: "array", items: { type: "string" } } },
  required: ["description", "keywords"],
};

/** الوظيفة الأولى للذكاء الاصطناعي: وصف المجال + كلمات بحثية مقترحة (لا تُحفظ قبل اعتماد المستخدم). */
export async function generateDomainKeywords(
  apiKey: string,
  ownerId: string,
  d: { name: string; description: string; keywords: string[] },
  ads: string[],
) {
  const prompt = [
    "أنت خبير تسويق إلكتروني في السوق المصري والعربي. مهمتك تجهيز بحث عن منافسين على مكتبة إعلانات فيسبوك.",
    `المجال: ${d.name}`,
    `الوصف الحالي: ${d.description || "لا يوجد"}`,
    d.keywords.length ? `الكلمات الحالية: ${d.keywords.join("، ")}` : "",
    ads.length ? "أحدث إعلانات في هذا المجال:\n" + ads.map((a, i) => `(${i + 1}) ${a}`).join("\n") : "",
    "1) description: وصف مختصر (2-3 جمل) للنشاط والمنتجات/الخدمات التي تظهر فعليًا في هذا المجال.",
    "2) keywords: من 10 إلى 25 كلمة/عبارة بحث قصيرة (1-3 كلمات) بالعربية واللهجة المصرية كما يكتبها المعلنون، مرتبطة مباشرة بالمجال. تجنّب الكلمات العامة جدًا مثل (عرض، خصم، توصيل).",
  ].filter(Boolean).join("\n");
  const out = await ask(apiKey, [{ type: "input_text", text: prompt }], "domain_keywords", KW_SCHEMA, "كلمات المجال", ownerId, "keywords_build");
  const seen = new Set<string>();
  const keywords = strList(out["keywords"], 30).filter((k) => {
    const key = keyOf(k);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { description: String(out["description"] ?? "").trim().slice(0, 1200), keywords };
}

const PAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    related: { type: "boolean" },
    activity: { type: "string" },
    ads_related: { type: "boolean" },
    commercial: { type: "boolean" },
    meets_criteria: { type: "boolean" },
    match_percent: { type: "number" },
    reason: { type: "string" },
  },
  required: ["related", "activity", "ads_related", "commercial", "meets_criteria", "match_percent", "reason"],
};

/** الوظيفة الثانية: تحليل صفحة جمعها النظام بالفعل. */
async function analyzePage(apiKey: string, ownerId: string, domain: { name: string; description: string; criteria: string[] }, page: { page_name: string }, samples: string[]) {
  const criteria = domain.criteria.length ? domain.criteria : DEFAULT_CRITERIA;
  const prompt = [
    "أنت محلل منافسين. أمامك صفحة فيسبوك ونصوص إعلاناتها النشطة التي جمعها النظام، ومجال مستهدف وشروط منافس.",
    "لا تبحث عن شيء؛ حلّل البيانات المعطاة فقط. كن صارمًا.",
    `المجال: ${domain.name}`,
    `وصف المجال: ${domain.description || "—"}`,
    `شروط المنافس:\n${criteria.map((c) => `- ${c}`).join("\n")}`,
    `اسم الصفحة: ${page.page_name || "غير معروف"}`,
    "نصوص الإعلانات:",
    ...samples.map((t, i) => `(${i + 1}) ${t.slice(0, 600)}`),
    "أجب: related (مرتبطة بالمجال؟) activity (نوع المنتجات/الخدمات باختصار) ads_related commercial meets_criteria match_percent (0-100) reason (سبب مختصر بالعربية).",
  ].join("\n");
  return await ask(apiKey, [{ type: "input_text", text: prompt }], "domain_page_match", PAGE_SCHEMA, "تحليل الصفحة", ownerId, "discovery_categories");
}

/** يحفظ إعلانات كلمة واحدة في مخزن الإعلانات الخام بلا تكرار، ويجمّع الصفحات. */
async function persistKeyAds(db: Db, run: { id: string; owner_id: string; domain_id: string }, key: string, ads: CandidateAd[]) {
  const adb = anyDb(db);
  const now = new Date().toISOString();
  const list = ads.filter((a) => a.pageId && a.isActive !== false);
  if (!list.length) return { found: 0, fresh: 0, pages: 0 };
  const ids = list.map((a) => a.adId);
  const { data: existing } = await adb.from("competitor_raw_ads").select("id, source_ad_id, discovery_keys").eq("owner_id", run.owner_id).in("source_ad_id", ids);
  const known = new Map<string, { id: string; keys: string[] }>((existing ?? []).map((r: any) => [r.source_ad_id, { id: r.id, keys: r.discovery_keys ?? [] }]));
  const fresh = list.filter((a) => !known.has(a.adId));
  if (fresh.length) {
    await adb.from("competitor_raw_ads").upsert(
      fresh.map((a) => ({
        owner_id: run.owner_id,
        competitor_id: null,
        source_ad_id: a.adId,
        source_page_id: a.pageId,
        page_name: a.pageName || "",
        source_url: a.sourceUrl,
        ad_text: a.text || "",
        image_url: a.imageUrl,
        is_active: a.isActive,
        start_date: a.startedOn,
        first_seen_at: now,
        last_seen_at: now,
        is_new: false,
        seen_state: "seen",
        source_path: "domain_discovery",
        discovery_run_id: run.id,
        discovery_domain_id: run.domain_id,
        discovery_keys: [key],
        discovered_at: now,
      })),
      { onConflict: "owner_id,source_ad_id", ignoreDuplicates: true },
    );
  }
  for (const a of list) {
    const k = known.get(a.adId);
    if (k && !k.keys.includes(key)) await adb.from("competitor_raw_ads").update({ discovery_keys: [...k.keys, key].slice(0, 20) }).eq("id", k.id);
  }
  // تجميع حسب معرف الصفحة الثابت.
  const byPage = new Map<string, CandidateAd[]>();
  for (const a of list) byPage.set(a.pageId!, [...(byPage.get(a.pageId!) ?? []), a]);
  const pageIds = [...byPage.keys()];
  const [{ data: rej }, { data: comps }, { data: have }] = await Promise.all([
    adb.from("domain_page_rejections").select("page_id").eq("owner_id", run.owner_id).eq("domain_id", run.domain_id).in("page_id", pageIds),
    db.from("competitors").select("id, source_page_id").eq("owner_id", run.owner_id).in("source_page_id", pageIds),
    adb.from("domain_discovery_pages").select("id, page_id, search_keys, user_status, run_id").eq("owner_id", run.owner_id).eq("domain_id", run.domain_id).in("page_id", pageIds),
  ]);
  const rejected = new Set((rej ?? []).map((r: any) => r.page_id));
  const compBy = new Map((comps ?? []).map((c) => [c.source_page_id as string, c.id]));
  const haveBy = new Map((have ?? []).map((r: any) => [r.page_id, r]));
  let newPages = 0;
  for (const [pid, pads] of byPage) {
    if (rejected.has(pid)) continue;
    const first = pads[0]!;
    const lastAd = pads.map((a) => a.startedOn).filter(Boolean).sort().pop() ?? null;
    const row = haveBy.get(pid);
    const compId = compBy.get(pid) ?? null;
    if (row) {
      if (row.user_status === "rejected") continue;
      const patch: Record<string, unknown> = { search_keys: [...new Set([...(row.search_keys ?? []), key])].slice(0, 20) };
      if (row.run_id !== run.id) {
        Object.assign(patch, { run_id: run.id, status: compId ? "analyzed" : row.user_status === "pending" ? "pending" : "analyzed" });
        newPages += 1;
      }
      await adb.from("domain_discovery_pages").update(patch).eq("id", row.id);
      continue;
    }
    newPages += 1;
    await adb.from("domain_discovery_pages").insert({
      owner_id: run.owner_id,
      domain_id: run.domain_id,
      run_id: run.id,
      page_id: pid,
      page_name: first.pageName || pid,
      page_url: first.pageUrl || `https://www.facebook.com/${pid}`,
      image_url: first.imageUrl,
      ads_count: pads.length,
      last_ad_at: lastAd,
      search_keys: [key],
      status: compId ? "analyzed" : "pending",
      user_status: compId ? "existing" : "pending",
      competitor_id: compId,
      reason: compId ? "موجود بالفعل في المنافسين." : null,
    });
  }
  return { found: list.length, fresh: fresh.length, pages: newPages };
}

/** خطوة واحدة من الجولة. تعيد true عند انتهاء العمل الآلي (بانتظار مراجعة المستخدم). */
export async function domainDiscoveryStep(db: Db, ownerId: string, runId: string): Promise<boolean> {
  const adb = anyDb(db);
  const { data: run } = await adb.from("domain_discovery_runs").select("*").eq("id", runId).maybeSingle();
  if (!run || run.status !== "running") return true;
  const { data: domain } = await adb.from("competitor_domains").select("*").eq("id", run.domain_id).maybeSingle();
  if (!domain) {
    await adb.from("domain_discovery_runs").update({ status: "failed", error: "المجال غير موجود.", finished_at: new Date().toISOString() }).eq("id", runId);
    return true;
  }

  if (run.phase === "search") {
    const keys: string[] = run.keywords ?? [];
    let done = run.keys_done as number;
    let ads_found = Number(run.ads_found) || 0, ads_new = Number(run.ads_new) || 0, pages_found = Number(run.pages_found) || 0, keys_failed = Number(run.keys_failed) || 0;
    for (let i = 0; i < KEYS_PER_STEP && done < keys.length; i++) {
      const key = keys[done]!;
      try {
        const ads = await searchCandidateAds(key);
        const r = await persistKeyAds(db, { id: runId, owner_id: ownerId, domain_id: run.domain_id }, key, ads);
        ads_found += r.found;
        ads_new += r.fresh;
        pages_found += r.pages;
      } catch (e) {
        keys_failed += 1;
        console.error("[domain-discovery] key failed", key, e instanceof Error ? e.message : e);
      }
      done += 1;
    }
    const finished = done >= keys.length;
    await adb.from("domain_discovery_runs").update({
      keys_done: done, ads_found, ads_new, pages_found, keys_failed, ...(finished ? { phase: "analysis" } : {}),
    }).eq("id", runId);
    return false;
  }

  if (run.phase === "analysis") {
    const { data: pages } = await adb.from("domain_discovery_pages").select("*").eq("run_id", runId).eq("status", "pending").limit(PAGES_PER_STEP);
    if (!pages?.length) {
      await refreshRunCounts(db, runId);
      await adb.from("domain_discovery_runs").update({ phase: "review", status: "review" }).eq("id", runId);
      return true;
    }
    const { aiApiKey } = await import("@/lib/ai-endpoint.server");
    const apiKey = (await aiApiKey()) ?? "";
    for (const p of pages) {
      const { data: samples } = await adb.from("competitor_raw_ads").select("ad_text, start_date").eq("owner_id", ownerId).eq("source_page_id", p.page_id).order("last_seen_at", { ascending: false }).limit(6);
      const texts = (samples ?? []).map((s: any) => s.ad_text).filter(Boolean);
      if (!texts.length) {
        await adb.from("domain_discovery_pages").update({ status: "analyzed", decision: "no_match", reason: "لا توجد نصوص إعلانات كافية للتحليل.", analyzed_at: new Date().toISOString() }).eq("id", p.id);
        continue;
      }
      try {
        const out = await analyzePage(apiKey, ownerId, domain, p, texts);
        const pct = Math.max(0, Math.min(100, Number(out["match_percent"]) || 0));
        const ok = out["related"] === true && out["commercial"] === true && out["meets_criteria"] === true && pct >= 60;
        await adb.from("domain_discovery_pages").update({
          status: "analyzed",
          decision: ok ? "match" : "no_match",
          activity: String(out["activity"] ?? "").slice(0, 300),
          reason: String(out["reason"] ?? "").slice(0, 600),
          ai_result: { ...out, match_percent: pct },
          ads_count: Math.max(p.ads_count, texts.length),
          analyzed_at: new Date().toISOString(),
        }).eq("id", p.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await adb.from("domain_discovery_pages").update({ status: "failed", reason: `فشل التحليل: ${msg.slice(0, 300)}` }).eq("id", p.id);
        if (/رصيد|balance|blocked/i.test(msg)) {
          await adb.from("domain_discovery_runs").update({ control: "pause", note: "أُوقف التحليل: رصيد الذكاء الاصطناعي غير كافٍ." }).eq("id", runId);
          return false;
        }
      }
    }
    await refreshRunCounts(db, runId);
    return false;
  }
  return true;
}

export async function refreshRunCounts(db: Db, runId: string) {
  const adb = anyDb(db);
  const { data } = await adb.from("domain_discovery_pages").select("status, decision, user_status").eq("run_id", runId).limit(5000);
  const rows = (data ?? []) as { status: string; decision: string | null; user_status: string }[];
  await adb.from("domain_discovery_runs").update({
    pages_found: rows.length,
    pages_analyzed: rows.filter((r) => r.status !== "pending").length,
    suggested: rows.filter((r) => r.decision === "match" && r.user_status !== "existing").length,
    existing: rows.filter((r) => r.user_status === "existing").length,
  }).eq("id", runId);
}

export async function finishDomainRun(db: Db, runId: string, note: string) {
  await anyDb(db).from("domain_discovery_runs").update({ status: "done", phase: "done", finished_at: new Date().toISOString(), note }).eq("id", runId);
}
