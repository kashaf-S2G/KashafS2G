/* eslint-disable @typescript-eslint/no-explicit-any */
/** عامل «مراجعة وتشييك» في الخلفية: يستمر مهما أُغلقت الصفحة، والتقدم محفوظ في pb_review_jobs. */
type Db = any;
const LEASE_MS = 150_000;

type Job = {
  id: string; owner_id: string; kind: "fit" | "merge"; status: string; problem_ids: string[];
  cursor: number; total: number; reviewed: number; failed: number; log: string[]; wake_base: string | null;
};

async function claim(db: Db, id: string): Promise<Job | null> {
  const now = new Date().toISOString();
  const { data } = await db.from("pb_review_jobs")
    .update({ lease_expires_at: new Date(Date.now() + LEASE_MS).toISOString(), updated_at: now })
    .eq("id", id).eq("status", "running")
    .or(`lease_expires_at.is.null,lease_expires_at.lt.${now}`)
    .select("*").maybeSingle();
  return (data as Job) ?? null;
}

async function processJob(db: Db, job: Job, deadline: number) {
  const { reviewProblemLinks, reviewProblemMerges } = await import("./problems.server");
  const log = [...(job.log ?? [])];
  let { cursor, reviewed, failed } = job;
  while (cursor < job.total && Date.now() < deadline) {
    const { data: cur } = await db.from("pb_review_jobs").select("status").eq("id", job.id).maybeSingle();
    if (cur?.status !== "running") return; // إيقاف/إلغاء من المستخدم
    let stop = false;
    let label = "تشييك الدمج";
    try {
      if (job.kind === "merge") {
        await db.from("pb_review_jobs").update({ current_text: `تشييك دمج ${job.problem_ids.length} مشكلة...` }).eq("id", job.id);
        const r = await reviewProblemMerges(db, job.owner_id, job.problem_ids);
        reviewed += r.reviewed;
      } else {
        const pid = job.problem_ids[cursor]!;
        const { data: p } = await db.from("pb_statements").select("display_text").eq("id", pid).maybeSingle();
        label = p?.display_text ?? pid;
        await db.from("pb_review_jobs").update({ current_text: `مراجعة المشكلة ${cursor + 1} من ${job.total}: ${label}` }).eq("id", job.id);
        const r = await reviewProblemLinks(db, job.owner_id, pid);
        reviewed += r.reviewed;
      }
    } catch (e) {
      failed++;
      const msg = (e as Error).message;
      log.push(`${label}: فشل — ${msg}`);
      if (/رصيد|402|403/.test(msg)) { stop = true; log.push("توقفت المراجعة: نفد رصيد الـ AI أو تم رفض الطلب."); }
    }
    cursor++;
    const done = cursor >= job.total;
    const status = stop ? "stopped" : done ? "finished" : "running";
    // لا نكتب فوق إيقاف/إلغاء حدث أثناء المعالجة.
    const { data: now } = await db.from("pb_review_jobs").select("status").eq("id", job.id).maybeSingle();
    const keep = now?.status !== "running";
    await db.from("pb_review_jobs").update({
      cursor, reviewed, failed, log: log.slice(-100),
      ...(keep ? { lease_expires_at: null } : {
        status,
        current_text: stop ? "تم الإيقاف." : done ? (job.kind === "merge" ? "اكتمل تشييك الدمج. راجع اقتراحات الدمج بالأسفل — لا يُدمج شيء إلا بموافقتك." : "اكتملت المراجعة. راجع النتائج بالأسفل ووافق أو ارفض كل نتيجة.") : undefined,
        lease_expires_at: status === "running" ? new Date(Date.now() + LEASE_MS).toISOString() : null,
      }),
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    if (keep || stop) return;
  }
  // انتهى الوقت: حرر القفل ليكمل الـhop التالي.
  await db.from("pb_review_jobs").update({ lease_expires_at: null }).eq("id", job.id).eq("status", "running");
}

/** يعالج كل المهام الجارية حتى المهلة. يعيد المهام التي ما زالت جارية (لإيقاظ الـhop التالي). */
export async function processReviewJobs(db: Db, deadline: number) {
  const { data: jobs } = await db.from("pb_review_jobs").select("id").eq("status", "running").order("created_at").limit(20);
  let processed = 0;
  for (const j of (jobs ?? []) as { id: string }[]) {
    if (Date.now() > deadline) break;
    const job = await claim(db, j.id);
    if (!job) continue;
    processed++;
    await processJob(db, job, deadline);
  }
  const { data: left } = await db.from("pb_review_jobs").select("wake_base").eq("status", "running").limit(1);
  return { processed, remaining: (left ?? []).length, wakeBase: (left?.[0]?.wake_base as string | null) ?? null };
}
