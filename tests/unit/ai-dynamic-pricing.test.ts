import { describe, expect, it } from "vitest";
import { computeDynamicPrice, sellPerMillionEgp } from "../../src/lib/ai-dynamic-pricing";
import { computeCharge, type ModelPrice } from "../../src/lib/ai-pricing.server";

const M = 1_000_000;
function priceFromCycle(costUsd: number, id: string): ModelPrice {
  const r = computeDynamicPrice(
    [{ lineItem: "model-X, input", amountUsd: costUsd }, { lineItem: "model-X, output", amountUsd: costUsd }],
    [{ inputTokens: M, outputTokens: M }],
  );
  if (!r.ok) throw new Error(r.reason);
  return {
    priceId: id, modelId: "dyn", providerCode: "openai", modelCode: "__provider_actual__",
    costInputUsdPerMillion: r.costInputUsdPerMillion, costOutputUsdPerMillion: r.costOutputUsdPerMillion,
    sellInputEgpPerMillion: sellPerMillionEgp(r.costInputUsdPerMillion, 100, 50),
    sellOutputEgpPerMillion: sellPerMillionEgp(r.costOutputUsdPerMillion, 100, 50),
  };
}

describe("dynamic pricing", () => {
  it("$1 / 1M → 100 EGP, then $1.20 → 120 EGP; old ops unchanged", () => {
    const p1 = priceFromCycle(1, "p1");
    expect(p1.costInputUsdPerMillion).toBe(1);
    expect(p1.sellInputEgpPerMillion).toBe(100);
    const oldOp = computeCharge(p1, M, 0);
    expect(oldOp.chargedEgp).toBe(100);

    const p2 = priceFromCycle(1.2, "p2");
    expect(p2.costInputUsdPerMillion).toBeCloseTo(1.2);
    expect(p2.sellInputEgpPerMillion).toBeCloseTo(120);
    expect(computeCharge(p2, M, 0).chargedEgp).toBeCloseTo(120);
    // العملية القديمة محفوظة بقيمتها ولا يُعاد حسابها
    expect(oldOp.chargedEgp).toBe(100);
  });

  it("model name does not affect price (model-A vs model-B)", () => {
    const a = computeDynamicPrice(
      [{ lineItem: "model-A, input", amountUsd: 2 }, { lineItem: "model-A, output", amountUsd: 4 }],
      [{ inputTokens: M, outputTokens: M }],
    );
    const b = computeDynamicPrice(
      [{ lineItem: "model-B, input", amountUsd: 2 }, { lineItem: "model-B, output", amountUsd: 4 }],
      [{ inputTokens: M, outputTokens: M }],
    );
    expect(a).toEqual(b);
  });

  it("missing data keeps last price (no result)", () => {
    const r = computeDynamicPrice([], [{ inputTokens: M, outputTokens: M }]);
    expect(r.ok).toBe(false);
  });
});

import { applyCurrentSettings } from "../../src/lib/ai-pricing.server";

describe("current margin/exchange rate at operation time", () => {
  const base: ModelPrice = {
    priceId: "p", modelId: "dyn", providerCode: "openai", modelCode: "__provider_actual__",
    costInputUsdPerMillion: 1, costOutputUsdPerMillion: 1,
    sellInputEgpPerMillion: 100, sellOutputEgpPerMillion: 100, // محسوب وقت الدورة بسعر صرف 50
  };
  it("exchange-rate change applies to the next operation immediately", () => {
    const before = computeCharge(applyCurrentSettings(base, { marginPercent: 100, usdToEgp: 50 }), 1_000_000, 0);
    const after = computeCharge(applyCurrentSettings(base, { marginPercent: 100, usdToEgp: 60 }), 1_000_000, 0);
    expect(before.chargedEgp).toBe(100);
    expect(after.chargedEgp).toBe(120);
    expect(before.chargedEgp).toBe(100); // العملية السابقة لا تتغير
  });
  it("margin 100% = ×2; margin change applies immediately", () => {
    expect(computeCharge(applyCurrentSettings(base, { marginPercent: 100, usdToEgp: 50 }), 1_000_000, 0).chargedEgp).toBe(100);
    expect(computeCharge(applyCurrentSettings(base, { marginPercent: 50, usdToEgp: 50 }), 1_000_000, 0).chargedEgp).toBe(75);
  });
  it("provider cost is unchanged by margin/rate", () => {
    const c = computeCharge(applyCurrentSettings(base, { marginPercent: 100, usdToEgp: 60 }), 1_000_000, 0);
    expect(c.providerCostUsd).toBe(1);
  });
});
