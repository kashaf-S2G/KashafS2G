import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { persist } from "../../src/lib/competitor-collector.server";

// قاعدة بيانات وهمية في الذاكرة تكفي لمسار الحفظ الخام.
function fakeDb() {
  const tables: Record<string, Record<string, unknown>[]> = { competitor_raw_ads: [], ads: [] };
  const from = (t: string) => {
    const rows = (tables[t] ??= []);
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    let patch: Record<string, unknown> | null = null;
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), api),
      in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), api),
      update: (p: Record<string, unknown>) => ((patch = p), api),
      upsert: async (list: Record<string, unknown>[], o: { ignoreDuplicates?: boolean }) => {
        for (const x of list) {
          const i = rows.findIndex((r) => r.owner_id === x.owner_id && r.source_ad_id === x.source_ad_id);
          if (i < 0) rows.push({ ...x });
          else if (!o?.ignoreDuplicates) rows[i] = { ...rows[i], ...x };
        }
        return { error: null };
      },
      then: (res: (v: unknown) => void) => {
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (patch) hit.forEach((r) => Object.assign(r, patch));
        res({ data: hit, error: null });
      },
    };
    return api;
  };
  return { db: { from } as never, tables };
}

const job = (run: string) => ({ id: "j", run_id: run, owner_id: "o", competitor_id: "c", path: "all", batch: 1, url: "u", attempts: 0, max_attempts: 3 });
const ad = (id: string, text = "t") => ({ sourceAdId: id, pageId: "p", pageName: "P", text, imageUrl: null, sourceUrl: "s", isActive: true, startDate: null, endDate: null }) as never;

describe("collector flow", () => {
  it("new ads: raw record with first_seen, run and path", async () => {
    const { db, tables } = fakeDb();
    const r = await persist(db, job("r1"), [ad("1"), ad("2")]);
    expect(r.adsNew).toBe(2);
    const row = tables.competitor_raw_ads![0]!;
    expect(row.first_run_id).toBe("r1");
    expect(row.source_path).toBe("all");
    expect(row.first_seen_at).toBeTruthy();
  });
  it("existing ads: raw update only, first_seen preserved, change detected", async () => {
    const { db, tables } = fakeDb();
    await persist(db, job("r1"), [ad("1")]);
    const first = tables.competitor_raw_ads![0]!.first_seen_at;
    const r = await persist(db, job("r2"), [ad("1", "new text")]);
    expect(r).toEqual({ adsNew: 0, duplicate: 0, changed: 1 });
    expect(tables.competitor_raw_ads!.length).toBe(1);
    expect(tables.competitor_raw_ads![0]!.first_seen_at).toBe(first);
    expect(tables.competitor_raw_ads![0]!.last_run_id).toBe("r2");
  });
  it("duplicates & idempotency: same batch replayed creates nothing new", async () => {
    const { db, tables } = fakeDb();
    await persist(db, job("r1"), [ad("1"), ad("1")]);
    const r = await persist(db, job("r1"), [ad("1")]);
    expect(r).toEqual({ adsNew: 0, duplicate: 1, changed: 0 });
    expect(tables.competitor_raw_ads!.length).toBe(1);
  });
  it("empty response persists nothing", async () => {
    const { db, tables } = fakeDb();
    expect(await persist(db, job("r1"), [])).toEqual({ adsNew: 0, duplicate: 0, changed: 0 });
    expect(tables.competitor_raw_ads!.length).toBe(0);
  });
  it("zero AI: collector files import no AI modules", () => {
    for (const f of ["src/lib/competitor-collector.server.ts", "src/lib/fb-library.server.ts", "src/routes/api/public/competitor-collect/tick.ts", "src/lib/competitor-collect.functions.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/from ["'][^"']*(ai-|openai|ai_gateway|ad-extract|pcrawl|product-resolver)/i);
    }
  });
});
