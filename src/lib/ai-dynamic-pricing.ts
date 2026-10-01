/**
 * منطق التسعير الديناميكي (دوال نقية بلا شبكة ولا قاعدة بيانات — قابلة للاختبار).
 *
 * السعر = التكلفة الفعلية المدفوعة للمزوّد ÷ حجم الاستهلاك الفعلي المقابل لنفس الفترة.
 * Input وOutput يُحسبان كلٌ على حدة، ولا يدخل اسم أي نموذج في الحساب.
 */

export type CostLine = { lineItem: string | null; amountUsd: number };
export type UsageLine = { inputTokens: number; outputTokens: number };

export type DynamicPriceResult =
  | {
      ok: true;
      inputCostUsd: number;
      outputCostUsd: number;
      otherCostUsd: number;
      inputTokens: number;
      outputTokens: number;
      costInputUsdPerMillion: number;
      costOutputUsdPerMillion: number;
    }
  | {
      ok: false;
      reason: string;
      inputCostUsd: number;
      outputCostUsd: number;
      otherCostUsd: number;
      inputTokens: number;
      outputTokens: number;
    };

/** تصنيف بند التكلفة حسب نوع الاستهلاك فقط (input / output) وليس حسب النموذج. */
export function classifyLineItem(lineItem: string | null): "input" | "output" | "other" {
  const s = (lineItem ?? "").toLowerCase().trim();
  if (/(^|[\s,])output$/.test(s)) return "output";
  if (/(^|[\s,])(cached )?input$/.test(s)) return "input";
  return "other";
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

export function computeDynamicPrice(costs: CostLine[], usage: UsageLine[]): DynamicPriceResult {
  let inputCostUsd = 0;
  let outputCostUsd = 0;
  let otherCostUsd = 0;
  for (const c of costs) {
    const v = Number(c.amountUsd) || 0;
    const kind = classifyLineItem(c.lineItem);
    if (kind === "input") inputCostUsd += v;
    else if (kind === "output") outputCostUsd += v;
    else otherCostUsd += v;
  }
  let inputTokens = 0;
  let outputTokens = 0;
  for (const u of usage) {
    inputTokens += Number(u.inputTokens) || 0;
    outputTokens += Number(u.outputTokens) || 0;
  }
  const base = {
    inputCostUsd: round(inputCostUsd, 8),
    outputCostUsd: round(outputCostUsd, 8),
    otherCostUsd: round(otherCostUsd, 8),
    inputTokens,
    outputTokens,
  };
  if (inputTokens <= 0 || outputTokens <= 0) {
    return { ok: false, reason: "لا يوجد استهلاك Input/Output كافٍ في فترة القياس.", ...base };
  }
  if (inputCostUsd <= 0 || outputCostUsd <= 0) {
    return { ok: false, reason: "بنود التكلفة الفعلية لـInput/Output غير متاحة بعد لفترة القياس.", ...base };
  }
  return {
    ok: true,
    ...base,
    costInputUsdPerMillion: round((inputCostUsd / inputTokens) * 1_000_000, 8),
    costOutputUsdPerMillion: round((outputCostUsd / outputTokens) * 1_000_000, 8),
  };
}

/** سعر البيع بالجنيه لكل مليون = التكلفة × (1 + الهامش) × سعر الصرف. الهامش 100٪ = ×2. */
export function sellPerMillionEgp(costUsdPerMillion: number, marginPercent: number, usdToEgp: number): number {
  return costUsdPerMillion * (1 + Math.max(0, marginPercent) / 100) * usdToEgp;
}

/** فترة القياس: آخر 7 أيام UTC مكتملة (بيانات التكلفة لدى OpenAI يومية). */
export function measurementWindow(now: Date, days = 7): { start: Date; end: Date } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - days * 86_400_000);
  return { start, end };
}
