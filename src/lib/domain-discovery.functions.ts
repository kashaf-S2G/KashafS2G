/** دوال صفحة «اكتشاف منافسين»: المجالات، الكلمات، الجولات، وقرار المستخدم. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DomainRow = {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  criteria: string[];
  descriptionUpdatedAt: string | null;
  keywordsUpdatedAt: string | null;
};

export type DomainRun = {
  id: string;
  status: string;
  phase: string;
  control: string;
  keysTotal: number;
  keysDone: number;
  keysFailed: number;
  adsFound: number;
  adsNew: number;
  pagesFound: number;
  pagesAnalyzed: number;
  suggested: number;
  existing: number;
  note: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type DomainPage = {
  id: string;
  pageId: string;
  pageName: string;
  pageUrl: string;
  imageUrl: string | null;
  adsCount: number;
  lastAdAt: string | null;
  searchKeys: string[];
  status: string;
  decision: string | null;
  activity: string | null;
  reason: string | null;
  matchPercent: number | null;
  userStatus: string;
  competitorId: string | null;
};

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const uuid = (v: unknown) => {
  const s = str(v, 64);
  if (!/^[0-9a-f-]{36}$/i.test(s)) throw new Error("معرف غير صالح.");
  return s;
};
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;

function mapDomain(d: any): DomainRow {
  return {
    id: d.id,
    name: d.name,
    description: d.description ?? "",
    keywords: d.keywords ?? [],
    criteria: d.criteria ?? [],
    descriptionUpdatedAt: d.description_updated_at,
    keywordsUpdatedAt: d.keywords_updated_at,
  };
}

async function ownDomain(db: any, userId: string, id: string) {
  const { data } = await db.from("competitor_domains").select("*").eq("id", id).eq("owner_id", userId).maybeSingle();
  if (!data) throw new Error("المجال غير موجود.");
  return data;
}

/** المجالات: المحفوظة + أسماء مجالات المنافسين الحاليين (تُنشأ تلقائيًا عند أول استخدام). */
export const listDomains = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DomainRow[]> => {
    const db = await admin();
    const { keyOf } = await import("@/lib/pcrawl.server");
    const uid = context.userId;
    const [{ data: doms }, { data: comps }] = await Promise.all([
      db.from("competitor_domains").select("*").eq("owner_id", uid).order("name"),
      db.from("competitors").select("niche").eq("owner_id", uid).limit(2000),
    ]);
    const have = new Set((doms ?? []).map((d: any) => d.name_key));
    const missing = [...new Set((comps ?? []).map((c: any) => String(c.niche ?? "").trim()).filter(Boolean))] as string[];
    const toAdd = missing.filter((n) => !have.has(keyOf(n)));
    if (toAdd.length) {
      await db.from("competitor_domains").upsert(
        toAdd.map((n) => ({ owner_id: uid, name: n, name_key: keyOf(n) })),
        { onConflict: "owner_id,name_key", ignoreDuplicates: true },
      );
      const { data: again } = await db.from("competitor_domains").select("*").eq("owner_id", uid).order("name");
      return (again ?? []).map(mapDomain);
    }
    return (doms ?? []).map(mapDomain);
  });

export const createDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { name?: unknown; description?: unknown }) => ({ name: str(i?.name, 120), description: str(i?.description, 1200) }))
  .handler(async ({ context, data }): Promise<DomainRow> => {
    if (!data.name) throw new Error("اسم المجال مطلوب.");
    const db = await admin();
    const { keyOf } = await import("@/lib/pcrawl.server");
    const key = keyOf(data.name);
    const { data: ex } = await db.from("competitor_domains").select("*").eq("owner_id", context.userId).eq("name_key", key).maybeSingle();
    if (ex) throw new Error("يوجد مجال بنفس الاسم بالفعل.");
    const { data: row, error } = await db.from("competitor_domains").insert({
      owner_id: context.userId,
      name: data.name,
      name_key: key,
      description: data.description,
      description_updated_at: data.description ? new Date().toISOString() : null,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return mapDomain(row);
  });

/** اقتراح وصف + كلمات بالذكاء الاصطناعي (لا يحفظ الكلمات قبل الاعتماد). */
export const suggestDomainKeywords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { domainId?: unknown }) => ({ domainId: uuid(i?.domainId) }))
  .handler(async ({ context, data }): Promise<{ description: string; keywords: string[]; adsUsed: number }> => {
    const db = await admin();
    const d = await ownDomain(db, context.userId, data.domainId);
    const { latestDomainAds, generateDomainKeywords } = await import("@/lib/domain-discovery.server");
    const ads = await latestDomainAds(db, context.userId, d.name);
    if (!ads.length && !str(d.description)) throw new Error("أضف وصفًا للمجال أولًا (لا توجد إعلانات سابقة له).");
    const apiKey = await (await import("@/lib/ai-endpoint.server")).aiApiKey();
    if (!apiKey) throw new Error("خدمة الذكاء الاصطناعي غير مهيأة.");
    const out = await generateDomainKeywords(apiKey, context.userId, { name: d.name, description: d.description ?? "", keywords: d.keywords ?? [] }, ads);
    if (out.description) {
      await db.from("competitor_domains").update({ description: out.description, description_updated_at: new Date().toISOString() }).eq("id", d.id);
    }
    return { description: out.description || d.description, keywords: out.keywords, adsUsed: ads.length };
  });

/** حفظ الوصف و/أو اعتماد الكلمات داخل المجال نفسه. */
export const saveDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { domainId?: unknown; description?: unknown; keywords?: unknown }) => ({
    domainId: uuid(i?.domainId),
    description: typeof i?.description === "string" ? str(i.description, 1200) : null,
    keywords: Array.isArray(i?.keywords) ? (i.keywords as unknown[]).map((k) => str(k, 80)).filter(Boolean).slice(0, 60) : null,
  }))
  .handler(async ({ context, data }): Promise<DomainRow> => {
    const db = await admin();
    await ownDomain(db, context.userId, data.domainId);
    const { keyOf } = await import("@/lib/pcrawl.server");
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {};
    if (data.description !== null) Object.assign(patch, { description: data.description, description_updated_at: now });
    if (data.keywords !== null) {
      const seen = new Set<string>();
      const kws = data.keywords.filter((k) => {
        const kk = keyOf(k);
        if (!kk || seen.has(kk)) return false;
        seen.add(kk);
        return true;
      });
      Object.assign(patch, { keywords: kws, keywords_updated_at: now });
    }
    const { data: row, error } = await db.from("competitor_domains").update(patch).eq("id", data.domainId).select("*").single();
    if (error) throw new Error(error.message);
    return mapDomain(row);
  });

function mapRun(r: any): DomainRun {
  return {
    id: r.id, status: r.status, phase: r.phase, control: r.control,
    keysTotal: r.keys_total, keysDone: r.keys_done, keysFailed: r.keys_failed,
    adsFound: r.ads_found, adsNew: r.ads_new, pagesFound: r.pages_found, pagesAnalyzed: r.pages_analyzed,
    suggested: r.suggested, existing: r.existing, note: r.note, error: r.error,
    startedAt: r.started_at, finishedAt: r.finished_at,
  };
}

export const startDomainRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { domainId?: unknown }) => ({ domainId: uuid(i?.domainId) }))
  .handler(async ({ context, data }): Promise<DomainRun> => {
    const db = await admin();
    const d = await ownDomain(db, context.userId, data.domainId);
    const keys: string[] = d.keywords ?? [];
    if (!keys.length) throw new Error("اعتمد الكلمات البحثية أولًا.");
    const { data: active } = await db.from("domain_discovery_runs").select("id").eq("owner_id", context.userId).eq("domain_id", d.id).eq("status", "running").limit(1);
    if (active?.length) throw new Error("توجد عملية اكتشاف جارية لهذا المجال.");
    const { data: run, error } = await db.from("domain_discovery_runs").insert({
      owner_id: context.userId, domain_id: d.id, status: "running", phase: "search", control: "none",
      keywords: keys, keys_total: keys.length,
    }).select("*").single();
    if (error) throw new Error(error.message);
    const { kickWorker } = await import("@/lib/job-worker.server");
    const { workerOrigin } = await import("@/lib/worker-origin.server");
    try { await kickWorker(workerOrigin()); } catch (e) { console.error("[domain] kick", e); }
    return mapRun(run);
  });

export const controlDomainRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { runId?: unknown; cmd?: unknown }) => ({
    runId: uuid(i?.runId),
    cmd: i?.cmd === "pause" || i?.cmd === "resume" || i?.cmd === "stop" || i?.cmd === "cancel" || i?.cmd === "finish" ? i.cmd : "resume",
  }))
  .handler(async ({ context, data }) => {
    const db = await admin();
    const { data: run } = await db.from("domain_discovery_runs").select("id, status").eq("id", data.runId).eq("owner_id", context.userId).maybeSingle();
    if (!run) throw new Error("العملية غير موجودة.");
    const { finishDomainRun } = await import("@/lib/domain-discovery.server");
    if (data.cmd === "finish" || data.cmd === "stop" || data.cmd === "cancel") {
      // يُنهى الطلب مباشرة داخل الطلب نفسه.
      await finishDomainRun(db, run.id, data.cmd === "cancel" ? "أُلغيت العملية." : data.cmd === "stop" ? "تم الاكتفاء بما أُنجز." : "انتهت المراجعة.");
      return { ok: true };
    }
    if (run.status !== "running") return { ok: true };
    await db.from("domain_discovery_runs").update({ control: data.cmd === "pause" ? "pause" : "none", note: null }).eq("id", run.id);
    if (data.cmd === "resume") {
      const { kickWorker } = await import("@/lib/job-worker.server");
      const { workerOrigin } = await import("@/lib/worker-origin.server");
      try { await kickWorker(workerOrigin()); } catch (e) { console.error("[domain] kick", e); }
    }
    return { ok: true };
  });

/** آخر عملية للمجال + صفحاتها. */
export const getDomainState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { domainId?: unknown }) => ({ domainId: uuid(i?.domainId) }))
  .handler(async ({ context, data }): Promise<{ run: DomainRun | null; pages: DomainPage[] }> => {
    const db = await admin();
    const { data: run } = await db.from("domain_discovery_runs").select("*").eq("owner_id", context.userId).eq("domain_id", data.domainId)
      .order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (!run) return { run: null, pages: [] };
    const { data: pages } = await db.from("domain_discovery_pages").select("*").eq("owner_id", context.userId).eq("run_id", run.id)
      .order("updated_at", { ascending: false }).limit(500);
    return {
      run: mapRun(run),
      pages: (pages ?? []).map((p: any) => ({
        id: p.id, pageId: p.page_id, pageName: p.page_name, pageUrl: p.page_url, imageUrl: p.image_url,
        adsCount: p.ads_count, lastAdAt: p.last_ad_at, searchKeys: p.search_keys ?? [], status: p.status,
        decision: p.decision, activity: p.activity, reason: p.reason,
        matchPercent: p.ai_result && typeof p.ai_result.match_percent === "number" ? p.ai_result.match_percent : null,
        userStatus: p.user_status, competitorId: p.competitor_id,
      })),
    };
  });

/** تنظيف نتائج العملية: حذف كل الصفحات التي انتهى قرارها (مقبولة/مرفوضة/موجودة/غير مطابقة)،
 *  مع تسجيل حظر لكل صفحة غير معتمدة حتى لا تعود في زحف هذا المجال — وقد تظهر في مجال آخر. */
export const cleanDomainResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { runId?: unknown }) => ({ runId: uuid(i?.runId) }))
  .handler(async ({ context, data }): Promise<{ removed: number }> => {
    const db = await admin();
    const uid = context.userId;
    const { data: run } = await db.from("domain_discovery_runs").select("id, domain_id").eq("id", data.runId).eq("owner_id", uid).maybeSingle();
    if (!run) throw new Error("العملية غير موجودة.");
    const { data: rows } = await db.from("domain_discovery_pages").select("id, page_id, competitor_id, user_status, decision")
      .eq("owner_id", uid).eq("run_id", run.id);
    const keep = new Set(
      (rows ?? []).filter((r: any) => r.user_status === "pending" && r.decision === "match").map((r: any) => r.id),
    );
    const toRemove = (rows ?? []).filter((r: any) => !keep.has(r.id));
    if (!toRemove.length) return { removed: 0 };
    // حظر الصفحات غير المعتمدة في هذا المجال (بدون تكرار).
    const toBlock = toRemove.filter((r: any) => !r.competitor_id).map((r: any) => r.page_id);
    if (toBlock.length) {
      const { data: existing } = await db.from("domain_page_rejections").select("page_id").eq("owner_id", uid).eq("domain_id", run.domain_id).in("page_id", toBlock);
      const have = new Set((existing ?? []).map((e: any) => e.page_id));
      const fresh = toBlock.filter((pid: string) => !have.has(pid));
      if (fresh.length) {
        await db.from("domain_page_rejections").insert(fresh.map((pid: string) => ({ owner_id: uid, domain_id: run.domain_id, page_id: pid })));
      }
    }
    const { error } = await db.from("domain_discovery_pages").delete().in("id", toRemove.map((r: any) => r.id));
    if (error) throw new Error(error.message);
    await (await import("@/lib/domain-discovery.server")).refreshRunCounts(db, run.id);
    return { removed: toRemove.length };
  });

/** قبول / رفض / إعادة تحليل صفحة. */
export const decideDomainPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { pageRowId?: unknown; action?: unknown; targetDomainId?: unknown }) => ({
    pageRowId: uuid(i?.pageRowId),
    targetDomainId: i?.targetDomainId ? uuid(i.targetDomainId) : null,
    action: i?.action === "accept" || i?.action === "reject" || i?.action === "retry" ? i.action : (() => { throw new Error("إجراء غير معروف."); })(),
  }))
  .handler(async ({ context, data }): Promise<{ ok: true; competitorId?: string; adsLinked?: number }> => {
    const db = await admin();
    const uid = context.userId;
    const { data: p } = await db.from("domain_discovery_pages").select("*").eq("id", data.pageRowId).eq("owner_id", uid).maybeSingle();
    if (!p) throw new Error("الصفحة غير موجودة.");
    const now = new Date().toISOString();

    if (data.action === "retry") {
      await db.from("domain_discovery_pages").update({ status: "pending", reason: null }).eq("id", p.id);
      if (p.run_id) {
        const { data: run } = await db.from("domain_discovery_runs").select("status").eq("id", p.run_id).maybeSingle();
        if (run && run.status !== "running") {
          await db.from("domain_discovery_runs").update({ status: "running", phase: "analysis", control: "none", finished_at: null }).eq("id", p.run_id);
        }
        const { kickWorker } = await import("@/lib/job-worker.server");
        const { workerOrigin } = await import("@/lib/worker-origin.server");
        try { await kickWorker(workerOrigin()); } catch (e) { console.error("[domain] kick", e); }
      }
      return { ok: true };
    }

    if (data.action === "reject") {
      const { data: ex } = await db.from("domain_page_rejections").select("id").eq("owner_id", uid).eq("domain_id", p.domain_id).eq("page_id", p.page_id).maybeSingle();
      if (!ex) await db.from("domain_page_rejections").insert({ owner_id: uid, domain_id: p.domain_id, page_id: p.page_id });
      await db.from("domain_discovery_pages").update({ user_status: "rejected" }).eq("id", p.id);
      if (p.run_id) await (await import("@/lib/domain-discovery.server")).refreshRunCounts(db, p.run_id);
      return { ok: true };
    }

    // قبول: إدخال في نظام المنافسين الحالي بلا تكرار.
    const d = await ownDomain(db, uid, data.targetDomainId ?? p.domain_id);
    let compId: string | null = null;
    const { data: byPage } = await db.from("competitors").select("id").eq("owner_id", uid).eq("source_page_id", p.page_id).maybeSingle();
    if (byPage) compId = byPage.id;
    else {
      const { data: byUrl } = await db.from("competitors").select("id").eq("owner_id", uid).eq("competitor_url", p.page_url).maybeSingle();
      if (byUrl) compId = byUrl.id;
    }
    if (!compId) {
      const { data: c, error } = await db.from("competitors").insert({
        owner_id: uid, competitor_name: p.page_name, competitor_url: p.page_url, platform: "Facebook",
        niche: d.name, source_page_id: p.page_id,
      }).select("id").single();
      if (error) throw new Error(error.message);
      compId = c.id;
    }
    // ربط الإعلانات الخام المجمّعة وتسليمها لخط معالجة المنافسين الحالي.
    const { data: linked } = await db.from("competitor_raw_ads")
      .update({ competitor_id: compId, is_new: true, updated_at: now })
      .eq("owner_id", uid).eq("source_page_id", p.page_id).is("competitor_id", null).select("id");
    await db.from("domain_discovery_pages").update({ user_status: "accepted", competitor_id: compId }).eq("id", p.id);
    if (p.run_id) await (await import("@/lib/domain-discovery.server")).refreshRunCounts(db, p.run_id);
    try {
      await db.rpc("enqueue_raw_ad_analyses", { _limit: 500 });
      const base = (await import("@/lib/worker-origin.server")).requestOrigin();
      await db.rpc("call_app_at", { _base: base, _path: "/api/public/raw-ads-analyze/tick" });
    } catch (e) {
      console.error("[domain] analyzer wake", e);
    }
    return { ok: true, competitorId: compId!, adsLinked: linked?.length ?? 0 };
  });
