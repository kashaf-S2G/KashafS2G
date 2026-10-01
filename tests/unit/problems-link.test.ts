import { describe, it, expect, vi } from "vitest";
vi.mock("../../src/lib/ai-endpoint.server", () => ({ AI_MODEL: "m", aiApiKey: async () => null, aiResponses: async () => { throw new Error("AI must not be called"); }, AiTokensBlockedError: class extends Error {} }));
import { acceptedProblems, linkAdProblems, type ProblemItem } from "../../src/lib/problems.server";

// قاعدة بيانات وهمية في الذاكرة تحاكي القيود الفريدة.
function fakeDb() {
  const t: Record<string, Record<string, unknown>[]> = { pb_statements: [], ad_statements: [], pb_statement_products: [] };
  let n = 0;
  const uniq: Record<string, string[]> = { pb_statements: ["owner_id", "kind", "normalized_key"], ad_statements: ["ad_id", "statement_id"], pb_statement_products: ["statement_id", "product_id"] };
  const from = (name: string) => {
    const f: [string, unknown, string][] = [];
    const rows = () => t[name]!.filter((r) => f.every(([k, v, op]) => (op === "is" ? (r[k] ?? null) === v : r[k] === v)));
    const q: any = {
      select: () => q, eq: (k: string, v: unknown) => (f.push([k, v, "eq"]), q), is: (k: string, v: unknown) => (f.push([k, v, "is"]), q),
      single: async () => ({ data: rows()[0] ?? null }),
      then: (res: (x: unknown) => void) => res({ data: rows() }),
      upsert: (row: Record<string, unknown>) => {
        const dup = t[name]!.find((r) => uniq[name]!.every((k) => r[k] === row[k]));
        let ins: Record<string, unknown>[] = [];
        if (!dup) { const r = { id: `id-${++n}`, archived_at: null, merged_into: null, ...row }; t[name]!.push(r); ins = [r]; }
        const p: any = Promise.resolve({ data: ins, error: null });
        p.select = async () => ({ data: ins, error: null });
        return p;
      },
    };
    return q;
  };
  return { t, db: { from } as any };
}
const P = (d: string, c = "problem"): ProblemItem => ({ problem_description: d, classification: c, causal_link: "سبب", evidence: "دليل", confidence: 0.9 });

describe("Problem as first-class entity", () => {
  it("1: two ads same problem → one problem, 2 ad links", async () => {
    const { t, db } = fakeDb();
    await linkAdProblems(db, "A", "ad1", "p1", [P("جفاف البشرة وخشونتها")]);
    await linkAdProblems(db, "A", "ad2", "p1", [P("جفاف البشرة وخشونتها")]);
    expect(t.pb_statements!.length).toBe(1); expect(t.ad_statements!.length).toBe(2);
  });
  it("2: 100 ads → one problem, 100 links; 3: 10 products → 10 product links", async () => {
    const { t, db } = fakeDb();
    for (let i = 0; i < 100; i++) await linkAdProblems(db, "A", `ad${i}`, `p${i % 10}`, [P("صعوبة إزالة الشعر")]);
    expect(t.pb_statements!.length).toBe(1); expect(t.ad_statements!.length).toBe(100); expect(t.pb_statement_products!.length).toBe(10);
    await linkAdProblems(db, "A", "ad1", "p1", [P("صعوبة إزالة الشعر")]);
    expect(t.ad_statements!.length).toBe(100);
  });
  it("8/9: non-problem classifications and problem_found=false are rejected", () => {
    expect(acceptedProblems(true, [P("ترطيب البشرة", "benefit"), P("جهاز", "solution"), P("تنظيم", "feature")])).toEqual([]);
    expect(acceptedProblems(false, [P("جفاف البشرة")])).toEqual([]);
  });
  it("10/12: tenants isolated; IDs come from DB not AI", async () => {
    const { t, db } = fakeDb();
    await linkAdProblems(db, "A", "ad1", null, [P("جفاف البشرة")]);
    await linkAdProblems(db, "B", "ad2", null, [P("جفاف البشرة")]);
    expect(t.pb_statements!.map((r) => r.owner_id)).toEqual(["A", "B"]);
    expect(t.ad_statements!.every((l) => t.pb_statements!.some((s) => s.id === l.statement_id && s.owner_id === l.owner_id))).toBe(true);
    expect(String(t.pb_statements![0]!.id)).toMatch(/^id-/);
  });
});
