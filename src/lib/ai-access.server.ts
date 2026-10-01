/**
 * طبقة صلاحيات استخدام الذكاء الاصطناعي (خادم فقط).
 *
 * القواعد:
 * - لكل حساب رصيد تجربة داخلي يُمنح مرة واحدة عند إنشاء الحساب، ويُستهلك أولًا بلا أي خصم مالي.
 * - بعد نفاد رصيد التجربة يعتمد الاستخدام على الرصيد المالي بالجنيه (Pay-as-you-go).
 * - عند نفاد الاثنين يتوقف الذكاء الاصطناعي برسالة شحن واضحة.
 *
 * لا يوجد أي مسار يسمح باستخدام مفتاح مزوّد خاص بالمستخدم؛ كل العمليات تتم عبر مزوّدي كشاف.
 */

/** مصدر تنفيذ العملية كما يُخزَّن في قاعدة البيانات. */
export type AiSource = "kashaf_tokens" | "trial_tokens";

export type AiAccessDecision =
  | { allowed: true; source: AiSource; availableEgp: number; trialTokensRemaining: number }
  | { allowed: false; reason: "insufficient_balance"; message: string };

export type AccountState = {
  balance_egp: number | string | null;
  held_egp: number | string | null;
  trial_tokens_remaining: number | string | null;
};

export const INSUFFICIENT_BALANCE_MESSAGE =
  "نفد رصيد الـ AI. اشحن رصيدك لتستطيع البحث والزحف والتحليل والاكتشاف.";

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** الرصيد المالي المتاح للاستخدام = الرصيد الكلي − المبلغ المحجوز. */
export function availableBalance(account: AccountState): number {
  return Math.max(0, num(account.balance_egp) - num(account.held_egp));
}

/** رصيد التجربة الداخلي المتبقي (لا يُعرض للمستخدم). */
export function trialTokensRemaining(account: AccountState): number {
  return Math.max(0, Math.floor(num(account.trial_tokens_remaining)));
}

/** يحدّد مصدر تنفيذ عملية الذكاء الاصطناعي: رصيد التجربة الداخلي أولًا ثم الرصيد المالي. */
export function decideAiAccess(account: AccountState): AiAccessDecision {
  const availableEgp = availableBalance(account);
  const trial = trialTokensRemaining(account);

  if (trial > 0) {
    return { allowed: true, source: "trial_tokens", availableEgp, trialTokensRemaining: trial };
  }

  if (availableEgp > 0) {
    return { allowed: true, source: "kashaf_tokens", availableEgp, trialTokensRemaining: 0 };
  }

  return { allowed: false, reason: "insufficient_balance", message: INSUFFICIENT_BALANCE_MESSAGE };
}
