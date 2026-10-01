import { describe, expect, it } from "vitest";
import { decideAiAccess, availableBalance } from "../../src/lib/ai-access.server";
import { parseTokenUsage } from "../../src/lib/ai-endpoint.server";

describe("صلاحيات استخدام الذكاء الاصطناعي", () => {
  it("رصيد التجربة الداخلي يُستهلك أولًا", () => {
    const decision = decideAiAccess({
      balance_egp: 100,
      held_egp: 0,
      trial_tokens_remaining: 20000,
    });
    expect(decision).toMatchObject({ allowed: true, source: "trial_tokens" });
  });

  it("بعد نفاد رصيد التجربة يُستخدم الرصيد المالي", () => {
    const decision = decideAiAccess({
      balance_egp: 50,
      held_egp: 10,
      trial_tokens_remaining: 0,
    });
    expect(decision).toMatchObject({ allowed: true, source: "kashaf_tokens" });
  });

  it("بلا رصيد تجربة ولا رصيد مالي يُمنع الاستخدام", () => {
    const decision = decideAiAccess({
      balance_egp: 10,
      held_egp: 10,
      trial_tokens_remaining: 0,
    });
    expect(decision.allowed).toBe(false);
  });

  it("الرصيد المتاح لا يصبح بالسالب", () => {
    expect(availableBalance({ balance_egp: 5, held_egp: 20, trial_tokens_remaining: 0 })).toBe(0);
  });
});

describe("قراءة عدّادات Tokens", () => {
  it("يقرأ الاستخدام من استجابة JSON", () => {
    const body = JSON.stringify({ usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 } });
    expect(parseTokenUsage(body)).toEqual({ inputTokens: 120, outputTokens: 30, totalTokens: 150 });
  });

  it("يقرأ الاستخدام من بث SSE ويحسب الإجمالي عند غيابه", () => {
    const body = [
      'data: {"type":"response.output_text.delta","delta":"مرحبا"}',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":5}}}',
    ].join("\n");
    expect(parseTokenUsage(body)).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it("يعيد أصفارًا عندما لا توجد عدّادات", () => {
    expect(parseTokenUsage("data: {}")).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });
});
