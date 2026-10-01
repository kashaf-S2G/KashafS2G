import { describe, it, expect, vi } from "vitest";
vi.mock("../../src/lib/ai-endpoint.server", () => ({ AI_MODEL: "m", aiApiKey: async () => null, aiResponses: async () => { throw new Error("no"); }, AiTokensBlockedError: class extends Error {} }));
import { sanitizeVerdict, decideLinkReview, type LinkVerdict } from "../../src/lib/problems.server";

const V = (o: Partial<LinkVerdict>): LinkVerdict => ({ product_id: "p", current_problem_id: "x", verdict: "valid", reason: "r", suggested_existing_problem_id: null, suggested_existing_problem_reason: null, create_new_problem: false, new_problem_description: null, new_problem_reason: null, confidence: "high", ...o });
const act = new Set(["A", "B"]);

describe("sanitizeVerdict", () => {
  it("valid strips suggestions", () => expect(sanitizeVerdict(V({ suggested_existing_problem_id: "B", create_new_problem: true, new_problem_description: "d" }), "A", act)).toMatchObject({ suggested_existing_problem_id: null, create_new_problem: false }));
  it("invalid keeps existing suggestion only if in DB", () => {
    expect(sanitizeVerdict(V({ verdict: "invalid", suggested_existing_problem_id: "B" }), "A", act).suggested_existing_problem_id).toBe("B");
    expect(sanitizeVerdict(V({ verdict: "invalid", suggested_existing_problem_id: "FAKE" }), "A", act).suggested_existing_problem_id).toBeNull();
  });
  it("uncertain never proposes", () => expect(sanitizeVerdict(V({ verdict: "uncertain", create_new_problem: true, new_problem_description: "d" }), "A", act).create_new_problem).toBe(false));
});

function db(review: Record<string, unknown>, link: Record<string, unknown> | null) {
  const calls: string[] = [];
  const from = (t: string) => {
    const q: any = { select: () => q, eq: () => q, is: () => q, in: () => q,
      maybeSingle: async () => ({ data: t === "pb_link_reviews" ? review : t === "pb_statement_products" ? link : { id: "A" } }),
      update: (v: any) => { calls.push(`update:${t}:${v.status}`); return q; },
      delete: () => { calls.push(`delete:${t}`); return q; },
      upsert: () => { calls.push(`upsert:${t}`); return Promise.resolve({ error: null }); },
      then: (r: any) => r({ error: null }) };
    return q;
  };
  return { calls, db: { from } as any };
}
const R = { id: "r", owner_id: "o", link_id: "l", statement_id: "A", product_id: "p", status: "pending", verdict: "invalid", suggested_problem_id: "B", create_new_problem: false };

describe("decideLinkReview", () => {
  it("reject → no data change", async () => { const { calls, db: d } = db(R, null); await decideLinkReview(d, "o", "r", false); expect(calls).toEqual(["update:pb_link_reviews:rejected"]); });
  it("valid approve → no link change", async () => { const { calls, db: d } = db({ ...R, verdict: "valid", suggested_problem_id: null }, null); await decideLinkReview(d, "o", "r", true); expect(calls).toEqual(["update:pb_link_reviews:approved"]); });
  it("changed link → stale, no mutation", async () => { const { calls, db: d } = db(R, { id: "l", statement_id: "Z", product_id: "p" }); await decideLinkReview(d, "o", "r", true); expect(calls).toEqual(["update:pb_link_reviews:stale"]); });
  it("approve move → upsert new then delete old", async () => { const { calls, db: d } = db(R, { id: "l", statement_id: "A", product_id: "p" }); await decideLinkReview(d, "o", "r", true); expect(calls).toEqual(["upsert:pb_statement_products", "delete:pb_statement_products", "update:pb_link_reviews:approved"]); });
});
