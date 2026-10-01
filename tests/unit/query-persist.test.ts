import { describe, expect, it } from "vitest";
import { CACHE_MAX_AGE_MS, dropExpired, isPersistableQuery } from "../../src/lib/query-persist";

const now = 1_000_000_000_000;
const q = (key: unknown[], age: number, status = "success") =>
  ({ queryKey: key, state: { status, dataUpdatedAt: now - age } }) as never;

describe("persist policy", () => {
  it("persists successful fresh data", () => expect(isPersistableQuery(q(["ads", "u1"], 1000), now)).toBe(true));
  it("excludes sensitive/temporary/in-progress/admin/signed images", () => {
    for (const k of ["signed-image", "server-job", "secrets-status", "admin-pricing", "wallet", "cd-state"])
      expect(isPersistableQuery(q([k], 1000), now)).toBe(false);
  });
  it("excludes errors/pending", () => expect(isPersistableQuery(q(["ads"], 1, "error"), now)).toBe(false));
  it("per-query 24h: A at 10:00 kept, B older than 24h dropped", () => {
    const client = {
      timestamp: now, buster: "x",
      clientState: { mutations: [], queries: [
        { queryKey: ["A"], queryHash: "A", state: { dataUpdatedAt: now - (CACHE_MAX_AGE_MS - 1) } },
        { queryKey: ["B"], queryHash: "B", state: { dataUpdatedAt: now - (CACHE_MAX_AGE_MS + 1) } },
      ] },
    } as never;
    expect(dropExpired(client, now).clientState.queries.map((x) => x.queryHash)).toEqual(["A"]);
  });
});
