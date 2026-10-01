/**
 * زحف الفئات — نفس منطق زحف المنتجات لكن شرط القبول مختلف:
 *   الفئات المحددة → مفاتيح بحث (الفئات + مصطلحات البنك) → إعلانات → تجميعها حسب الصفحة
 *   → تحليل الصفحة بالذكاء الاصطناعي → تُقبل إن تخطّت نسبة تطابقها مع الفئات 70%.
 * ملف خادم فقط.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { AiBlockedError } from "@/lib/ad-crawl.server";
import { AiTokensBlockedError, aiApiKey } from "@/lib/ai-endpoint.server";
import { ask, keyOf, searchCandidateAds } from "@/lib/pcrawl.server";
import { CATEGORY_MATCH_THRESHOLD, type CcrawlPhase, type CcrawlProgress } from "@/lib/ccrawl.types";

type Db = SupabaseClient<Database>;
const MAX_KEYS = 40;
const PAGES_PER_STEP = 2;
const MAX_SAMPLES = 6;

export function ccPhase(r: { status: string; keys_total: number; keys_done: number }): CcrawlPhase {
  if (r.status !== "running") return "done";
  if (!r.keys_total || r.keys_done < r.keys_total) return "search";
  return "analysis";
}

/** يحدد الفئات المستهدفة للجولة: المحددة، أو كل الفئات النشطة في الزحف العام. */
export async function pickCategories(db: Db, ownerId: string, ids: string[] | null) {
  let q = db.from("discovery_terms").select("id, term").eq("owner_id", ownerId).eq("kind", "category").eq("status", "active");
  if (ids?.length) q = q.in("id", ids);
  const { data } = await q.limit(100);
  return (data ?? []).map((r) => ({ id: r.id as string, term: r.term as string }));
}

async function buildKeys(db: Db, ownerId: string, runId: string, categories: string[], scope: string) {
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    const k = keyOf(t);
    if (!k || seen.has(k) || keys.length >= MAX_KEYS) return;
    seen.add(k);
    keys.push(t.trim());
  };
  categories.forEach(push);
  if (scope !== "selected") {
    const { data: terms } = await db
      .from("discovery_terms")
      .select("term")
      .eq("owner_id", ownerId)
      .eq("kind", "term")
      .eq("status", "active")
      .order("hits", { ascending: false })
      .limit(MAX_KEYS);
    (terms ?? []).forEach((t) => push(t.term as string));
  }
  if (keys.length) {
    await db.from("ccrawl_keys").insert(keys.map((k) => ({ owner_id: ownerId, run_id: runId, key_text: k })));
  }
  await db.from("ccrawl_runs").update({ keys_total: keys.length }).eq("id", runId);
  return keys.length;
}

const PAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    match_percent: { type: "number" },
    matched_categories: { type: "array", items: { type: "string" } },
    reasons: { type: "array", items: { type: "string" } },
    differences: { type: "array", items: { type: "string" } },
  },
  required: ["match_percent", "matched_categories", "reasons", "differences"],
};

async function analyzePage(
  apiKey: string,
  ownerId: string,
  page: { page_name: string; ads_sample: string[] },
  categories: string[],
) {
  const prompt = [
    "أنت محلل صفحات تجارية على فيسبوك. أمامك صفحة ونصوص من إعلاناتها، وقائمة فئات مستهدفة.",
    "قدّر نسبة (0-100) تمثّل مدى تطابق نشاط الصفحة ومنتجاتها مع الفئات المستهدفة: أي نسبة منتجات/إعلانات الصفحة التي تنتمي لهذه الفئات.",
    "كن صارمًا: صفحة عامة متنوعة أو بعيدة عن الفئات تأخذ نسبة منخفضة.",
    "matched_categories: الفئات من القائمة التي تنطبق فعلًا. reasons: أسباب التطابق. differences: أسباب الاختلاف. اكتب بالعربية باختصار.",
    `الفئات المستهدفة: ${categories.join("، ")}`,
    `اسم الصفحة: ${page.page_name || "غير معروف"}`,
    "نصوص الإعلانات:",
    ...page.ads_sample.map((t, i) => `(${i + 1}) ${t.slice(0, 700)}`),
  ].join("\n");
  const out = await ask(apiKey, [{ type: "input_text", text: prompt }], "page_category_match", PAGE_SCHEMA, "تحليل الصفحة", ownerId, "discovery_categories");
  const pct = Math.max(0, Math.min(100, Number(out["match_percent"]) || 0));
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : []);
  return {
    score: pct / 100,
    matched: list(out["matched_categories"]).filter((c) => categories.includes(c)),
    reasons: list(out["reasons"]),
    differences: list(out["differences"]),
    isMatch: pct > CATEGORY_MATCH_THRESHOLD,
  };
}

/** الصفحة المطابقة تدخل مسار الموافقة (معلّقة ← موافقة المستخدم ← منافس) بلا تكرار. */
async function promotePage(
  db: Db,
  ownerId: string,
  p: { page_id: string; page_name: string; page_url: string; ads_sample: string[]; search_key: string | null },
  matched: string[],
  score: number,
) {
  const { data: competitor } = await db
    .from("competitors").select("id").eq("owner_id", ownerId).eq("source_page_id", p.page_id).maybeSingle();
  const { data: existing } = await db
    .from("discovered_competitors")
    .select("id, matched_terms, times_seen")
    .eq("owner_id", ownerId).eq("platform", "Facebook").eq("source_competitor_id", p.page_id).maybeSingle();
  const now = new Date().toISOString();
  const terms = [...matched, ...(p.search_key ? [p.search_key] : [])];
  if (existing) {
    await db.from("discovered_competitors").update({
      matched_terms: [...new Set([...((existing.matched_terms as string[]) ?? []), ...terms])].slice(0, 30),
      category: matched[0] ?? null,
      confidence: score,
      times_seen: ((existing.times_seen as number) ?? 1) + 1,
      last_seen_at: now,
    }).eq("id", existing.id);
    return;
  }
  if (competitor) return;
  await db.from("discovered_competitors").insert({
    owner_id: ownerId,
    platform: "Facebook",
    discovery_source: "category_crawl",
    source_competitor_id: p.page_id,
    competitor_name: p.page_name || p.page_id,
    competitor_url: p.page_url || `https://www.facebook.com/${p.page_id}`,
    fb_categories: [],
    active_ads: p.ads_sample.length,
    ads_sample: p.ads_sample.join("\n---\n").slice(0, 1500),
    matched_terms: terms,
    matched_product_ids: [],
    category: matched[0] ?? null,
    confidence: score,
    classification: "pending",
  });
}

async function pause(db: Db, runId: string, msg: string) {
  await db.from("ccrawl_runs").update({ control: "pause", note: msg }).eq("id", runId);
}

export async function finishCcrawlRun(db: Db, runId: string, note: string | null) {
  await db.from("ccrawl_pages").update({ run_id: null }).eq("run_id", runId).eq("status", "pending");
  await db.from("ccrawl_runs").update({ status: "done", finished_at: new Date().toISOString(), note }).eq("id", runId);
}

/** خطوة واحدة محدودة: بحث بمفتاح واحد، ثم تحليل عدد صغير من الصفحات. يعيد true عند الانتهاء. */
export async function ccrawlStep(db: Db, ownerId: string, runId: string): Promise<boolean> {
  const { data: run } = await db.from("ccrawl_runs").select("*").eq("id", runId).maybeSingle();
  if (!run || run.status !== "running") return true;
  await db.from("ccrawl_runs").update({ lease_expires_at: new Date(Date.now() + 10 * 60_000).toISOString() }).eq("id", runId);
  const categories = (run.categories as string[]) ?? [];
  if (!categories.length) {
    await finishCcrawlRun(db, runId, "لا توجد فئات لمطابقة الصفحات معها. أضف فئات أولًا.");
    return true;
  }

  if (!run.keys_total) {
    const n = await buildKeys(db, ownerId, runId, categories, run.scope as string);
    if (!n) {
      await finishCcrawlRun(db, runId, "لا توجد مفاتيح بحث.");
      return true;
    }
    return false;
  }

  // (1) بحث بمفتاح واحد
  if (run.keys_done < run.keys_total) {
    const { data: key } = await db
      .from("ccrawl_keys").select("id, key_text").eq("run_id", runId).eq("status", "pending")
      .order("created_at").limit(1).maybeSingle();
    if (!key) {
      await db.from("ccrawl_runs").update({ keys_done: run.keys_total }).eq("id", runId);
      return false;
    }
    const ads = await searchCandidateAds(String(key.key_text)).catch(() => []);
    const byPage = new Map<string, typeof ads>();
    for (const ad of ads) {
      if (!ad.pageId) continue;
      byPage.set(ad.pageId, [...(byPage.get(ad.pageId) ?? []), ad]);
    }
    let added = 0;
    if (byPage.size) {
      const ids = [...byPage.keys()];
      const { data: known } = await db.from("ccrawl_pages").select("page_id").eq("owner_id", ownerId).in("page_id", ids);
      const { data: comps } = await db.from("competitors").select("source_page_id").eq("owner_id", ownerId).in("source_page_id", ids);
      const skip = new Set([...(known ?? []).map((k) => k.page_id as string), ...(comps ?? []).map((c) => c.source_page_id as string)]);
      const rows = ids.filter((id) => !skip.has(id)).map((id) => {
        const list = byPage.get(id)!;
        return {
          owner_id: ownerId,
          run_id: runId,
          page_id: id,
          page_name: list[0]!.pageName,
          page_url: list[0]!.pageUrl,
          image_url: list.find((a) => a.imageUrl)?.imageUrl ?? null,
          ads_sample: list.map((a) => a.text).filter(Boolean).slice(0, MAX_SAMPLES),
          ad_ids: list.map((a) => a.adId).slice(0, 20),
          search_key: key.key_text as string,
        };
      });
      if (rows.length) {
        const { error } = await db.from("ccrawl_pages").upsert(rows, { onConflict: "owner_id,page_id", ignoreDuplicates: true });
        if (!error) added = rows.length;
      }
    }
    await db.from("ccrawl_keys").update({ status: "searched", found: byPage.size, searched_at: new Date().toISOString() }).eq("id", key.id);
    await db.from("ccrawl_runs").update({ keys_done: run.keys_done + 1, pages_found: run.pages_found + added }).eq("id", runId);
  }

  // (2) تحليل الصفحات المعلّقة
  const { data: pending } = await db
    .from("ccrawl_pages").select("*").eq("run_id", runId).eq("status", "pending").order("created_at").limit(PAGES_PER_STEP);
  if (!pending?.length) {
    if (run.keys_done >= run.keys_total) {
      await finishCcrawlRun(db, runId, null);
      return true;
    }
    return false;
  }
  const apiKey = (await aiApiKey()) ?? "";
  let analyzed = 0;
  let matches = 0;
  for (const p of pending) {
    const samples = (p.ads_sample as string[]) ?? [];
    if (!samples.length) {
      await db.from("ccrawl_pages").update({ status: "analyzed", decision: "no_match", differences: ["لا توجد نصوص إعلانات كافية للتحليل."], analyzed_at: new Date().toISOString() }).eq("id", p.id);
      analyzed += 1;
      continue;
    }
    try {
      const v = await analyzePage(apiKey, ownerId, { page_name: p.page_name as string, ads_sample: samples }, categories);
      await db.from("ccrawl_pages").update({
        status: "analyzed",
        score: v.score,
        decision: v.isMatch ? "match" : "no_match",
        matched_categories: v.matched,
        reasons: v.reasons,
        differences: v.differences,
        analyzed_at: new Date().toISOString(),
      }).eq("id", p.id);
      if (v.isMatch) {
        await promotePage(db, ownerId, p as never, v.matched, v.score);
        matches += 1;
      }
      analyzed += 1;
    } catch (error) {
      if (error instanceof AiBlockedError || error instanceof AiTokensBlockedError) {
        await db.from("ccrawl_runs").update({ pages_analyzed: run.pages_analyzed + analyzed, matches: run.matches + matches }).eq("id", runId);
        await pause(db, runId, error.message);
        return false;
      }
      await db.from("ccrawl_pages").update({ status: "analyzed", decision: "no_match", error: error instanceof Error ? error.message : String(error), analyzed_at: new Date().toISOString() }).eq("id", p.id);
      analyzed += 1;
    }
  }
  const { data: fresh } = await db.from("ccrawl_runs").select("pages_analyzed, matches").eq("id", runId).maybeSingle();
  await db.from("ccrawl_runs").update({
    pages_analyzed: (fresh?.pages_analyzed ?? 0) + analyzed,
    matches: (fresh?.matches ?? 0) + matches,
  }).eq("id", runId);
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ccrawlProgress(db: Db, run: any): Promise<CcrawlProgress> {
  const { count } = await db.from("ccrawl_pages").select("id", { count: "exact", head: true }).eq("run_id", run.id).eq("status", "pending");
  const { data: key } = await db.from("ccrawl_keys").select("key_text").eq("run_id", run.id).eq("status", "pending").order("created_at").limit(1).maybeSingle();
  const phase = ccPhase(run as never);
  return {
    runId: run.id,
    scope: run.scope,
    phase,
    done: run.status !== "running",
    currentKey: phase === "search" ? ((key?.key_text as string) ?? null) : null,
    categories: run.categories ?? [],
    keysTotal: run.keys_total ?? 0,
    keysDone: run.keys_done ?? 0,
    pagesFound: run.pages_found ?? 0,
    pagesAnalyzed: run.pages_analyzed ?? 0,
    pagesPending: count ?? 0,
    matches: run.matches ?? 0,
  };
}
