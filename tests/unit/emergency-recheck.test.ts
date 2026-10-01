import { describe, expect, it, vi, beforeEach } from "vitest";

// مسار التحليل الحالي مُحاكى: لا AI أثناء الاختبار.
const calls: string[] = [];
let blockAt: string | null = null;
vi.mock("../../src/lib/raw-ad-analyzer.server", () => ({
  processOne: vi.fn(async (db: any, job: any) => {
    calls.push(job.raw_ad_id);
    if (job.raw_ad_id === blockAt) return "blocked";
    const st = job.raw_ad_id.endsWith("r") ? "needs_review" : "completed";
    db.tables.raw_ad_analyses.find((x: any) => x.id === job.id).status = st;
    return "ok";
  }),
}));

import { stepRun, claimRun } from "../../src/lib/emergency-recheck.server";

function fakeDb(tables: Record<string, any[]>) {
  let n = 0;
  const from = (t: string) => {
    const f: ((r: any) => boolean)[] = [];
    let op: any = null, one = false, lim = Infinity, ord: string | null = null;
    const b: any = {
      select: () => b, order: (c: string) => ((ord = c), b), limit: (l: number) => ((lim = l), b),
      eq: (c: string, v: any) => (f.push((r) => r[c] === v), b),
      in: (c: string, v: any[]) => (f.push((r) => v.includes(r[c])), b),
      gt: (c: string, v: any) => (f.push((r) => r[c] > v), b),
      lte: (c: string, v: any) => (f.push((r) => r[c] <= v), b),
      or: (s: string) => (f.push((r) => s.includes("is.null") && (r.lease_until == null || r.lease_until < new Date().toISOString())), b),
      update: (p: any) => ((op = { u: p }), b),
      upsert: (p: any) => ((op = { up: p }), b),
      single: () => ((one = true), b), maybeSingle: () => ((one = true), b),
      then: (res: any) => {
        const rows = tables[t]!;
        let data: any;
        if (op?.up) {
          let r = rows.find((x) => x.source_ad_id === op.up.source_ad_id);
          if (!r) rows.push((r = { id: "j" + ++n, max_attempts: 3, product_id: null }));
          Object.assign(r, op.up); data = r;
        } else {
          let m = rows.filter((r) => f.every((g) => g(r)));
          if (ord) m = [...m].sort((a, c) => (a[ord!] < c[ord!] ? -1 : 1));
          m = m.slice(0, lim);
          if (op?.u) m.forEach((r) => Object.assign(r, op.u));
          data = one ? m[0] ?? null : m;
        }
        return Promise.resolve({ data, error: null }).then(res);
      },
    };
    return b;
  };
  return { from, tables } as any;
}

const raws = ["a1", "a2r", "a3", "a4", "a5"].map((id) => ({ id, owner_id: "u", source_ad_id: "s" + id, created_at: "2026-01-01" }));
function setup() {
  return fakeDb({
    competitor_raw_ads: raws.map((r) => ({ ...r })),
    raw_ad_analyses: [{ id: "old", owner_id: "u", raw_ad_id: "a1", source_ad_id: "sa1", status: "completed", max_attempts: 3 }],
    emergency_recheck_runs: [{ id: "R", owner_id: "u", status: "running", total: 5, processed: 0, completed: 0, needs_review: 0, failed: 0, last_raw_ad_id: null, cutoff_at: "2026-12-31", lease_until: null }],
  });
}

describe("إعادة الفحص الطارئة", () => {
  beforeEach(() => { calls.length = 0; blockAt = null; });

  it("كل الإعلانات تدخل حتى المحللة سابقًا، والنهاية completed", async () => {
    const db = setup();
    const run = await claimRun(db, "R");
    await stepRun(db, run!, Date.now() + 5000);
    expect(calls).toEqual(["a1", "a2r", "a3", "a4", "a5"]);
    expect(db.tables.emergency_recheck_runs[0]).toMatchObject({ status: "completed", processed: 5, completed: 4, needs_review: 1 });
  });

  it("لا عاملين معًا: الحجز الثاني يُرفض", async () => {
    const db = setup();
    expect(await claimRun(db, "R")).not.toBeNull();
    expect(await claimRun(db, "R")).toBeNull();
  });

  it("نفاد الرصيد يوقف مؤقتًا ويحفظ، والاستئناف يكمل من الـCheckpoint دون إعادة المكتمل", async () => {
    const db = setup();
    blockAt = "a4";
    await stepRun(db, (await claimRun(db, "R"))!, Date.now() + 5000);
    const r = db.tables.emergency_recheck_runs[0];
    expect(r).toMatchObject({ status: "paused", stop_reason: "credits", processed: 3, last_raw_ad_id: "a3" });
    calls.length = 0; blockAt = null;
    Object.assign(r, { status: "running", lease_until: null });
    await stepRun(db, (await claimRun(db, "R"))!, Date.now() + 5000);
    expect(calls).toEqual(["a4", "a5"]);
    expect(r).toMatchObject({ status: "completed", processed: 5 });
  });

  it("الإيقاف المؤقت/الإلغاء يمنع بدء إعلان جديد ويحفظ النتائج", async () => {
    const db = setup();
    const r = db.tables.emergency_recheck_runs[0];
    const run = (await claimRun(db, "R"))!;
    r.status = "cancelled";
    await stepRun(db, run, Date.now() + 5000);
    expect(calls).toEqual([]);
    expect(r.status).toBe("cancelled");
  });
});
