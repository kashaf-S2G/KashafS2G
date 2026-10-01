/**
 * العامل الخلفي الموحّد: يكمل عمليات زحف المنتجات والفئات والبحث وتحديث البنك على الخادم
 * دون الحاجة لبقاء المتصفح مفتوحًا. لا يوجد حد زمني: الجولة تكمل حتى تنتهي،
 * أو يكتفي بها المستخدم / يلغيها. الجولة الموقوفة مؤقتًا تبقى معلّقة حتى تُستأنف أو تُلغى يدويًا.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;
export type JobKind = "products" | "bank" | "cats" | "domain";

/** مهلة شكلية بعيدة جدًا (الأعمدة القديمة تتطلب قيمة)؛ لا تُستخدم لإنهاء أي جولة. */
export const RUN_LIMIT_MS = 100 * 365 * 24 * 60 * 60_000;
const TICK_BUDGET_MS = 60_000;
const AUTO_INTERVAL_MS = 3 * 60 * 60_000;
/** تقدير مبدئي لمدة الخطوة؛ يتعدّل تلقائيًا حسب المدة الفعلية. */
const DEFAULT_STEP_MS = 30_000;

const TABLE = { products: "pcrawl_runs", bank: "bank_jobs", cats: "ccrawl_runs", domain: "domain_discovery_runs" } as const;

type RunRow = { id: string; owner_id: string; control: string; deadline_at: string | null; started_at: string };

async function listRunning(db: Db, kind: JobKind): Promise<RunRow[]> {
  const { data } = await (db.from(TABLE[kind] as "pcrawl_runs") as any)
    .select("id, owner_id, control, deadline_at, started_at")
    .eq("status", "running")
    .order("started_at", { ascending: true })
    .limit(200);
  return (data ?? []) as RunRow[];
}

async function finishProducts(db: Db, owner: string, runId: string, note: string | null) {
  const { finishPcrawlRun } = await import("./pcrawl.server");
  await finishPcrawlRun(db, owner, runId, "done");
  await db.from("pcrawl_runs").update({ note } as never).eq("id", runId);
}

async function finishBank(db: Db, job: { id: string; owner_id: string }, cancel: boolean, note: string | null) {
  if (cancel) {
    const { data } = await db.from("bank_jobs").select("added_ids").eq("id", job.id).maybeSingle();
    const ids = ((data?.added_ids as string[] | null) ?? []).slice(0, 1000);
    if (ids.length) await db.from("discovery_terms").delete().eq("owner_id", job.owner_id).in("id", ids);
  }
  await db
    .from("bank_jobs")
    .update({ status: cancel ? "cancelled" : "done", finished_at: new Date().toISOString(), note })
    .eq("id", job.id);
}

/** ينهي الجولة بأمر يدوي فقط (اكتفاء / إلغاء). لا حد زمني لأي عملية. يعيد true إن أُنهيت. */
async function settle(db: Db, kind: JobKind, r: RunRow, _estimateMs: number): Promise<boolean> {
  const control = r.control;
  if (control !== "stop" && control !== "cancel") return false;
  const note = control === "cancel" ? "أُلغيت الجولة." : "تم الاكتفاء بما أُنجز بناءً على طلبك.";
  if (kind === "products") await finishProducts(db, r.owner_id, r.id, note);
  else if (kind === "cats") await (await import("./ccrawl.server")).finishCcrawlRun(db, r.id, note);
  else if (kind === "domain") await (await import("./domain-discovery.server")).finishDomainRun(db, r.id, note);
  else await finishBank(db, r, control === "cancel", note);
  return true;
}

async function stepBank(db: Db, job: RunRow): Promise<boolean> {
  const { bankStepCategories, bankStepTerms } = await import("./discovery.server");
  const { data: row } = await db.from("bank_jobs").select("*").eq("id", job.id).maybeSingle();
  if (!row) return true;
  const added = (row.added_ids as string[]) ?? [];
  if (row.phase === "categories") {
    const apiKey = await (await import("./ai-endpoint.server")).aiApiKey();
    const res = await bankStepCategories(db, job.owner_id, apiKey);
    if (res.productsCount === 0) {
      await db
        .from("bank_jobs")
        .update({ status: "done", finished_at: new Date().toISOString(), note: "لا توجد منتجات بعد. أضف منتجات أو مصطلحات يدويًا." })
        .eq("id", job.id);
      return true;
    }
    await db
      .from("bank_jobs")
      .update({ phase: "terms", categories_added: row.categories_added + res.added, added_ids: [...added, ...res.ids] })
      .eq("id", job.id);
    return false;
  }
  const res = await bankStepTerms(db, job.owner_id);
  const done = !res.remaining || res.added === 0;
  await db
    .from("bank_jobs")
    .update({
      terms_added: row.terms_added + res.added,
      added_ids: [...added, ...res.ids],
      ...(done ? { status: "done", finished_at: new Date().toISOString(), note: null } : {}),
    })
    .eq("id", job.id);
  return done;
}

/** جدولة الجولات التلقائية كل 3 ساعات على الخادم. */
async function scheduleAuto(db: Db) {
  const since = Date.now() - AUTO_INTERVAL_MS;
  // زحف المنتجات
  const { data: prods } = await db.from("products").select("owner_id").limit(5000);
  const pOwners = [...new Set((prods ?? []).map((p) => p.owner_id as string).filter(Boolean))];
  const { pickTargetProducts } = await import("./pcrawl.server");
  for (const owner of pOwners) {
    const { data: st } = await db.from("pcrawl_state").select("status").eq("owner_id", owner).maybeSingle();
    if (st?.status === "paused") continue;
    const { data: last } = await db
      .from("pcrawl_runs")
      .select("started_at")
      .eq("owner_id", owner)
      .order("started_at", { ascending: false })
      .limit(1);
    const at = last?.[0]?.started_at ? Date.parse(last[0].started_at as string) : 0;
    if (at > since) continue;
    const { data: runId } = await db.rpc("acquire_pcrawl_run", { _owner_id: owner, _trigger_type: "scheduled", _scope: "scheduled" });
    if (!runId) continue;
    const ids = await pickTargetProducts(db, owner, "scheduled", null);
    await db
      .from("pcrawl_runs")
      .update({ product_ids: ids, deadline_at: new Date(Date.now() + RUN_LIMIT_MS).toISOString() } as never)
      .eq("id", runId as string);
  }
}

/** نداء واحد للعامل: ينفّذ خطوات حتى ميزانيته، ثم يتابع نفسه إن بقي عمل. */
export async function runTick(origin: string | null, opts: { schedule: boolean }) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const got = await db.rpc("acquire_worker_lease" as never, { _seconds: 150 } as never);
  if (got.data !== true) return { skipped: "busy" };

  const end = Date.now() + TICK_BUDGET_MS;
  const est = new Map<string, number>();
  let steps = 0;
  let remaining = false;
  try {
    if (opts.schedule) await scheduleAuto(db);
    for (;;) {
      let worked = false;
      remaining = false;
      // ترتيب عشوائي في كل دورة حتى لا تحتكر جولة طويلة وقت العامل وتبقى الجولات الأخرى معلّقة.
      const queue: { kind: JobKind; r: RunRow }[] = [];
      for (const k of ["products", "bank", "cats", "domain"] as JobKind[]) {
        for (const r of await listRunning(db, k)) queue.push({ kind: k, r });
      }
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = queue[i]!;
        queue[i] = queue[j]!;
        queue[j] = tmp;
      }
      {
        for (const { kind, r } of queue) {
          if (r.control === "pause" || r.control === "review") continue;
          const e = est.get(r.id) ?? DEFAULT_STEP_MS;
          if (await settle(db, kind, r, e)) continue;
          if (Date.now() + Math.min(e, 20_000) > end) {
            remaining = true;
            continue;
          }
          const t0 = Date.now();
          let finished = false;
          try {
            if (kind === "products") {
              const { pcrawlStep } = await import("./pcrawl.server");
              const p = await pcrawlStep(db, r.owner_id, r.id);
              finished = p.done;
            } else if (kind === "cats") {
              const { ccrawlStep } = await import("./ccrawl.server");
              finished = await ccrawlStep(db, r.owner_id, r.id);
            } else if (kind === "domain") {
              const { domainDiscoveryStep } = await import("./domain-discovery.server");
              finished = await domainDiscoveryStep(db, r.owner_id, r.id);
            } else {
              finished = await stepBank(db, r);
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`[worker] ${kind} ${r.id}:`, msg);
            if (kind === "bank") {
              await db.from("bank_jobs").update({ status: "failed", error: msg, finished_at: new Date().toISOString() }).eq("id", r.id);
              finished = true;
            }
          }
          const took = Date.now() - t0;
          est.set(r.id, Math.max(took, Math.round(((est.get(r.id) ?? took) + took) / 2)));
          steps += 1;
          worked = true;
          if (!finished) remaining = true;
        }
      }
      if (!worked || Date.now() > end - 5_000) break;
    }
  } finally {
    await db.rpc("release_worker_lease" as never, { _result: `steps=${steps}` } as never);
  }
  if (remaining) await kickWorker(origin);
  return { steps, remaining };
}

/** يوقظ العامل (نداء غير متزامن من قاعدة البيانات، لا يعتمد على المتصفح). */
export async function kickWorker(origin: string | null) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const base = origin && /^https:\/\/[a-z0-9.-]+$/.test(origin) ? origin : null;
  await db.rpc("call_app_at" as never, { _base: base, _path: "/api/public/jobs/tick" } as never);
}
