import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchLibraryBatch, libraryRequestUrls, nextBatchUrl, type CrawledAd } from "./fb-library.server";

/**
 * جامع إعلانات المنافسين: جولة ← مهام صغيرة مستقلة ← حفظ خام بلا تكرار.
 * لا ذكاء اصطناعي هنا إطلاقًا. ملف خادم فقط.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

const PARALLEL = 4;
const MIN_PARALLEL = 1;
const MAX_PARALLEL = 8;
const RETRY_DELAYS_S = [30, 120, 300];
const LEASE_S = 90;
const HEARTBEAT_MS = 30_000;

function pathOf(url: string): string {
  const u = new URL(url);
  const status = u.searchParams.get("active_status") ?? "all";
  const country = u.searchParams.get("country") ?? "ALL";
  return country === "ALL" ? status : `${status}_${country.toLowerCase()}`;
}

/** ينشئ جولة جمع ومهامها ويعيد رقمها فورًا (لا ينتظر الجمع). */
export async function createCollectionRun(
  db: Db,
  ownerId: string,
  competitorIds?: string[],
  triggerType = "manual",
  wakeBase: string | null = null,
): Promise<{ runId: string; runNumber: number; jobs: number }> {
  let q = db.from("competitors").select("id, competitor_name, source_page_id").eq("owner_id", ownerId);
  if (competitorIds?.length) q = q.in("id", competitorIds);
  const { data: competitors, error } = await q.limit(1000);
  if (error) throw error;

  const { data: run, error: runErr } = await db
    .from("competitor_collection_runs")
    .insert({ owner_id: ownerId, trigger_type: triggerType, status: "queued", wake_base: wakeBase, competitors_total: competitors?.length ?? 0 })
    .select("id, run_number")
    .single();
  if (runErr) throw runErr;

  const jobs = (competitors ?? []).flatMap((c) =>
    libraryRequestUrls({ pageName: c.competitor_name, pageId: c.source_page_id }).map((url) => ({
      run_id: run.id,
      owner_id: ownerId,
      competitor_id: c.id,
      path: pathOf(url),
      batch: 1,
      url,
    })),
  );
  if (jobs.length) {
    const { error: jobErr } = await db
      .from("competitor_collection_jobs")
      .upsert(jobs, { onConflict: "run_id,competitor_id,path,batch", ignoreDuplicates: true });
    if (jobErr) throw jobErr;
  }
  await db.rpc("refresh_competitor_run", { _run_id: run.id });
  if (jobs.length) await db.rpc("arm_competitor_collect_backstop" as never);
  return { runId: run.id, runNumber: Number(run.run_number), jobs: jobs.length };
}

type Job = { id: string; run_id: string; owner_id: string; competitor_id: string; path: string; batch: number; url: string; attempts: number; max_attempts: number };

/** بصمة المحتوى الخام لرصد تغيّر النص/الصورة/الرابط/الحالة — بلا ذكاء اصطناعي. */
function contentHash(a: CrawledAd): string {
  const raw = [a.text, a.imageUrl ?? "", a.sourceUrl, a.isActive ? 1 : 0, a.endDate ?? ""].join("\u0001");
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ":" + raw.length;
}

export type ErrorType = "blocked" | "rate_limit" | "timeout" | "network" | "http" | "parser" | "db" | "unknown";
export function classifyError(msg: string): { type: ErrorType; retryable: boolean } {
  const m = msg.toLowerCase();
  if (m.includes("blocked") || m.includes("checkpoint") || m.includes("login")) return { type: "blocked", retryable: true };
  if (m.includes("http 429")) return { type: "rate_limit", retryable: true };
  if (m.includes("timeout") || m.includes("abort")) return { type: "timeout", retryable: true };
  if (/http 4(0[0-9]|1[0-9])/.test(m) && !m.includes("408")) return { type: "http", retryable: false };
  if (m.includes("http ")) return { type: "http", retryable: true };
  if (m.includes("fetch failed") || m.includes("network") || m.includes("econn")) return { type: "network", retryable: true };
  if (m.includes("parse") || m.includes("parser")) return { type: "parser", retryable: true };
  if (m.includes("postgres") || m.includes("duplicate key") || m.includes("pgrst")) return { type: "db", retryable: true };
  return { type: "unknown", retryable: true };
}

type PersistResult = { adsNew: number; duplicate: number; changed: number };

/**
 * حفظ خام قابل للتكرار. الإعلان الموجود يُحدَّث خامًا فقط (لا AI، لا مطابقة، لا استخراج)،
 * والجديد يُنشأ مع first_seen_at و first_run_id و source_path للمرحلة اللاحقة فقط.
 */
/** هوية بديلة ثابتة عند غياب رقم الإعلان: بصمة الصفحة + النص + الصورة (بلا AI). */
export function fallbackAdId(a: Pick<CrawledAd, "pageId" | "pageName" | "text" | "imageUrl">): string {
  const raw = [a.pageId ?? a.pageName ?? "", (a.text ?? "").trim().replace(/\s+/g, " "), a.imageUrl ?? ""].join("\u0001");
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) | 0;
    h2 = ((h2 << 5) + h2 ^ c) | 0;
  }
  return `fp:${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

/** يضمن هوية لكل إعلان ويزيل التكرار داخل الدفعة نفسها. */
export function normalizeAds(ads: CrawledAd[]): CrawledAd[] {
  const seen = new Map<string, CrawledAd>();
  for (const a of ads) {
    const id = a.sourceAdId && String(a.sourceAdId).trim() ? String(a.sourceAdId).trim() : fallbackAdId(a);
    if (!seen.has(id)) seen.set(id, { ...a, sourceAdId: id });
  }
  return [...seen.values()];
}

export async function persist(db: Db, job: Job, rawAds: CrawledAd[]): Promise<PersistResult> {
  const ads = normalizeAds(rawAds);
  if (!ads.length) return { adsNew: 0, duplicate: 0, changed: 0 };
  const ids = ads.map((a) => a.sourceAdId);
  const { data: existing, error: exErr } = await db
    .from("competitor_raw_ads")
    .select("source_ad_id, content_hash, last_run_id")
    .eq("owner_id", job.owner_id)
    .in("source_ad_id", ids);
  if (exErr) throw exErr;
  const known = new Map((existing ?? []).map((r) => [r.source_ad_id as string, r as { content_hash: string | null; last_run_id: string | null }]));
  const now = new Date().toISOString();
  let duplicate = 0;
  let changed = 0;
  const fresh: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  for (const a of ads) {
    const hash = contentHash(a);
    const base = {
      owner_id: job.owner_id,
      competitor_id: job.competitor_id,
      source_ad_id: a.sourceAdId,
      source_page_id: a.pageId,
      page_name: a.pageName,
      source_url: a.sourceUrl,
      ad_text: a.text,
      image_url: a.imageUrl,
      is_active: a.isActive,
      start_date: a.startDate,
      end_date: a.endDate,
      content_hash: hash,
      seen_state: "active",
      last_seen_at: now,
      last_checked_at: now,
      last_run_id: job.run_id,
      updated_at: now,
    };
    const prev = known.get(a.sourceAdId);
    if (!prev) {
      // إعلان جديد تمامًا: is_new=true يبقى حتى تلتقطه مرحلة المعالجة اللاحقة (الزاحف لا يلمسه عند التحديث).
      fresh.push({ ...base, is_new: true, first_seen_at: now, first_run_id: job.run_id, source_path: job.path });
    } else {
      if (prev.last_run_id === job.run_id) duplicate++;
      const isChanged = prev.content_hash != null && prev.content_hash !== hash;
      if (isChanged) changed++;
      updates.push(isChanged ? { ...base, changed_at: now } : base);
    }
  }
  if (fresh.length) {
    // ignoreDuplicates يمنع الكتابة فوق first_seen_at إن سبقتنا مهمة موازية.
    const { error } = await db.from("competitor_raw_ads").upsert(fresh, { onConflict: "owner_id,source_ad_id", ignoreDuplicates: true });
    if (error) throw error;
  }
  if (updates.length) {
    const { error } = await db.from("competitor_raw_ads").upsert(updates, { onConflict: "owner_id,source_ad_id" });
    if (error) throw error;
  }
  // الإعلان الظاهر (بما فيه المتوقف العائد) يعود نشطًا في Kashaf بنفس السجل، بلا إنشاء ولا AI.
  const { error: adsErr } = await db
    .from("ads")
    .update({ last_seen_at: now, status: "active", end_date: null, updated_at: now })
    .eq("owner_id", job.owner_id)
    .in("source_ad_id", ids);
  if (adsErr) throw adsErr;
  return { adsNew: fresh.length, duplicate, changed };
}

/** يضيف الدفعة التالية لنفس المسار (Idempotent بفضل المفتاح الفريد). */
async function enqueueNext(db: Db, job: Job, cursor: string | null): Promise<boolean> {
  const next = nextBatchUrl(job.url, job.batch);
  if (!next) return false;
  const { error } = await db.from("competitor_collection_jobs").upsert(
    { run_id: job.run_id, owner_id: job.owner_id, competitor_id: job.competitor_id, path: job.path, batch: job.batch + 1, url: next.url, cursor: cursor ?? next.cursor },
    { onConflict: "run_id,competitor_id,path,batch", ignoreDuplicates: true },
  );
  if (error) throw error;
  return true;
}

async function runJob(db: Db, job: Job): Promise<boolean> {
  const beat = setInterval(() => {
    void db.rpc("heartbeat_competitor_job" as never, { _job_id: job.id, _lease_seconds: LEASE_S } as never);
  }, HEARTBEAT_MS);
  const t0 = Date.now();
  try {
    const { ads, hasMore, cursor } = await fetchLibraryBatch(job.url);
    const r = await persist(db, job, ads);
    const more = ads.length > 0 && (hasMore || r.adsNew > 0) ? await enqueueNext(db, job, cursor) : false;
    await db
      .from("competitor_collection_jobs")
      .update({
        status: "done", ads_found: ads.length, ads_new: r.adsNew, ads_duplicate: r.duplicate, ads_changed: r.changed,
        has_more: more, error: null, error_type: null, lease_expires_at: null,
        debug: { ms: Date.now() - t0, parsed: ads.length, source_has_more: hasMore, cursor, path: job.path, batch: job.batch },
        finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("status", "running");
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const { type, retryable } = classifyError(msg);
    const final = !retryable || job.attempts >= job.max_attempts;
    const delay = (type === "rate_limit" || type === "blocked" ? 2 : 1) * (RETRY_DELAYS_S[Math.min(Math.max(job.attempts - 1, 0), RETRY_DELAYS_S.length - 1)] ?? 60);
    await db
      .from("competitor_collection_jobs")
      .update({
        status: final ? "failed" : "pending",
        error: msg.slice(0, 500),
        error_type: type,
        debug: { ms: Date.now() - t0, path: job.path, batch: job.batch, attempt: job.attempts, error_type: type },
        lease_expires_at: null,
        next_attempt_at: new Date(Date.now() + delay * 1000).toISOString(),
        finished_at: final ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("status", "running");
    return false;
  } finally {
    clearInterval(beat);
  }
}

/**
 * يعالج المهام الجاهزة على دفعات متوازية محدودة حتى المهلة.
 * فشل مهمة لا يوقف غيرها؛ المهام العالقة تُستعاد تلقائيًا عند انتهاء مهلتها.
 */
export async function processCollectionJobs(db: Db, deadlineMs: number): Promise<{ processed: number; remaining: number }> {
  let processed = 0;
  // توازي متكيّف: يرتفع مع النجاح وينخفض مع الفشل/الحجب.
  let parallel = PARALLEL;
  const touchedRuns = new Set<string>();
  while (Date.now() < deadlineMs) {
    const { data: jobs, error } = await db.rpc("claim_competitor_jobs", { _limit: parallel, _lease_seconds: LEASE_S });
    if (error) throw error;
    const list = (jobs ?? []) as Job[];
    if (!list.length) break;
    const ok = await Promise.all(list.map((j) => runJob(db, j)));
    const rate = ok.filter(Boolean).length / ok.length;
    parallel = rate === 1 ? Math.min(MAX_PARALLEL, parallel + 1) : rate < 0.5 ? Math.max(MIN_PARALLEL, parallel - 2) : parallel;
    for (const j of list) touchedRuns.add(j.run_id);
    processed += list.length;
    for (const r of touchedRuns) {
      // دفعات أُضيفت بعد ضغط «إيقاف» تُجمَّد كنقطة استئناف بدل أن تبقى معلّقة.
      const { data: run } = await db.from("competitor_collection_runs").select("control").eq("id", r).maybeSingle();
      if (run && run.control !== "active") {
        await db.from("competitor_collection_jobs").update({ status: "stopped", updated_at: new Date().toISOString() }).eq("run_id", r).eq("status", "pending");
      }
      await db.rpc("refresh_competitor_run", { _run_id: r });
    }
  }
  const { count } = await db
    .from("competitor_collection_jobs")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "running"]);
  // مهام مؤجلة لإعادة المحاولة لاحقًا تحسب كمتبقية حتى لا تتوقف السلسلة.
  return { processed, remaining: count ?? 0 };
}
