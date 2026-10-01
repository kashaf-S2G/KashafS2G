import { describe, expect, it } from "vitest";
import { classifyError } from "../../src/lib/competitor-collector.server";

describe("competitor collector error classification", () => {
  it("classifies source failures", () => {
    expect(classifyError("blocked")).toEqual({ type: "blocked", retryable: true });
    expect(classifyError("HTTP 429")).toEqual({ type: "rate_limit", retryable: true });
    expect(classifyError("The operation was aborted due to timeout").type).toBe("timeout");
    expect(classifyError("HTTP 404")).toEqual({ type: "http", retryable: false });
    expect(classifyError("HTTP 503")).toEqual({ type: "http", retryable: true });
    expect(classifyError("fetch failed").type).toBe("network");
    expect(classifyError("weird").type).toBe("unknown");
  });
});

import { fallbackAdId, normalizeAds } from "../../src/lib/competitor-collector.server";
describe("fallback ad identity", () => {
  const base = { pageId: "p1", pageName: "X", text: "hello  world", imageUrl: "i", sourceUrl: "u", isActive: true } as never;
  it("is stable and whitespace-insensitive", () => {
    expect(fallbackAdId(base)).toBe(fallbackAdId({ ...(base as object), text: "hello world" } as never));
    expect(fallbackAdId(base).startsWith("fp:")).toBe(true);
  });
  it("fills missing ids and dedupes within batch", () => {
    const out = normalizeAds([{ ...(base as object), sourceAdId: "" }, { ...(base as object), sourceAdId: "" }, { ...(base as object), sourceAdId: "123" }] as never);
    expect(out.length).toBe(2);
    expect(out.some((a) => a.sourceAdId === "123")).toBe(true);
  });
});
