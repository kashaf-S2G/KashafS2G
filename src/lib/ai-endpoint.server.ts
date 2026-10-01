/**
 * طبقة موحّدة للاتصال بخدمة الذكاء الاصطناعي.
 * إذا كان مفتاح OpenAI الخاص بالمشروع موجودًا (OPENAI_API_KEY) تُستخدم OpenAI مباشرة،
 * وإلا يُستخدم مزوّد Lovable كخيار احتياطي.
 *
 * عند تمرير ownerId تُطبَّق المحاسبة المالية (Pay-as-you-go):
 * - يُقرأ السعر الساري للنموذج ويُحجز مبلغ تقديري من الرصيد قبل التنفيذ.
 * - نجاح المزوّد: تسوية الحجز بالمبلغ الفعلي وخصمه وتسجيله في wallet_ledger.
 * - فشل المزوّد: إلغاء الحجز بالكامل بدون أي خصم.
 * - رصيد التجربة الداخلي: تنفيذ بدون حجز أو خصم مالي.
 * الحجز والتسوية يتمّان داخل دوال قاعدة البيانات (SECURITY DEFINER + قفل الصف)،
 * مما يمنع الخصم المزدوج والرصيد السالب عند الطلبات المتزامنة.
 * ملف خادم فقط.
 */

/** أنواع عمليات الذكاء الاصطناعي الفعلية في المشروع. */
export type AiOperation =
  | "ad_extract"
  | "ad_classify"
  | "product_match"
  | "product_research"
  | "keywords_build"
  | "term_bank_build"
  | "term_bank_match"
  | "discovery_categories"
  | "problems_benefits"
  | "other";

/** خطأ يعني أن الذكاء الاصطناعي متوقف لهذا المستخدم (رصيد غير كافٍ). */
export class AiTokensBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiTokensBlockedError";
  }
}

/** النموذج الافتراضي لجميع عمليات الذكاء الاصطناعي في المنصة. */
export const AI_MODEL = "openai/gpt-6-luna";

/**
 * المفتاح المستخدم فعليًا للذكاء الاصطناعي (OpenAI أولًا ثم بوابة Lovable).
 * يُقرأ مفتاح OpenAI عبر الطبقة الموحّدة: بيئة المشروع ثم خزانة Supabase.
 */
export async function aiApiKey(): Promise<string | undefined> {
  const { openAiKey } = await import("./secrets.server");
  return (await openAiKey()) || process.env["LOVABLE_API_KEY"];
}

/** اسم النموذج الخارجي المستخدم مع OpenAI — ثابت دائمًا على gpt-6-luna. */
function openaiModel(): string {
  return "gpt-6-luna";
}

async function callProvider(
  apiKey: string | undefined,
  init: RequestInit,
  overrideOpenAiKey?: string,
): Promise<{ res: Response; model: string }> {
  const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
  const { openAiKey } = await import("./secrets.server");
  const openaiKey = overrideOpenAiKey || (await openAiKey());

  if (openaiKey) {
    const { reasoning: _reasoning, ...rest } = body;
    const model = openaiModel();
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({ ...rest, model }),
    });
    return { res, model };
  }

  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey ?? "",
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify(body),
  });
  return { res, model: String(body["model"] ?? "") };
}

function lastNumber(text: string, field: string): number {
  const matches = text.match(new RegExp(`"${field}"\\s*:\\s*(\\d+)`, "g"));
  if (!matches || matches.length === 0) return 0;
  const last = matches[matches.length - 1]!;
  const value = Number(last.replace(/[^0-9]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

/** يستخرج عدّادات Tokens من جسم الاستجابة (JSON أو SSE). */
export function parseTokenUsage(bodyText: string): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  const inputTokens = lastNumber(bodyText, "input_tokens");
  const outputTokens = lastNumber(bodyText, "output_tokens");
  const totalRaw = lastNumber(bodyText, "total_tokens");
  return {
    inputTokens,
    outputTokens,
    totalTokens: totalRaw > 0 ? totalRaw : inputTokens + outputTokens,
  };
}

type AccountRow = {
  balance_egp: number;
  held_egp: number;
  trial_tokens_remaining: number;
};

/**
 * ينفّذ طلب Responses API. يقبل نفس init الذي كان يُرسل إلى بوابة Lovable
 * ويحوّله تلقائيًا إلى OpenAI عند توفّر مفتاحها.
 * تمرير ownerId يفعّل التحقق من الرصيد والحجز والخصم والتسجيل.
 * operation هو اسم العملية الحقيقية في المشروع كما يظهر في سجل الاستخدام.
 */
export async function aiResponses(
  apiKey: string | undefined,
  init: RequestInit,
  ownerId?: string | null,
  operation: AiOperation = "other",
): Promise<Response> {
  if (!ownerId) return (await callProvider(apiKey, init)).res;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: account, error } = await supabaseAdmin
    .from("user_ai_accounts")
    .select("balance_egp, held_egp, trial_tokens_remaining")
    .eq("user_id", ownerId)
    .single();

  if (error || !account) throw new AiTokensBlockedError("تعذر التحقق من رصيد الذكاء الاصطناعي.");

  const { decideAiAccess } = await import("./ai-access.server");
  const decision = decideAiAccess(account as AccountRow);
  if (!decision.allowed) throw new AiTokensBlockedError(decision.message);

  const { getCurrentDynamicPrice, computeCharge, estimateHoldEgp } = await import("./ai-pricing.server");
  const requestedModel = (() => {
    try {
      return String((JSON.parse(String(init.body ?? "{}")) as { model?: string }).model ?? AI_MODEL);
    } catch {
      return AI_MODEL;
    }
  })();

  // رصيد التجربة الداخلي يُستهلك بالـTokens بلا حجز ولا خصم مالي.
  // السعر ديناميكي وموحّد لكل النماذج؛ اسم النموذج يُسجَّل فقط ولا يحدد السعر.
  const usesWallet = decision.source === "kashaf_tokens";
  const price = usesWallet ? await getCurrentDynamicPrice() : null;
  if (usesWallet && !price) {
    throw new AiTokensBlockedError("تسعير الذكاء الاصطناعي غير متاح حاليًا. حاول لاحقًا.");
  }

  // حجز المبلغ التقديري قبل التنفيذ — يمنع تجاوز الرصيد عند الطلبات المتزامنة.
  let holdId: string | null = null;
  if (price) {
    const { data: hold, error: holdError } = await supabaseAdmin.rpc("hold_ai_balance", {
      _owner_id: ownerId,
      _amount: estimateHoldEgp(price),
    });
    if (holdError || !hold) {
      throw new AiTokensBlockedError(
        String(holdError?.message ?? "").includes("INSUFFICIENT_BALANCE")
          ? INSUFFICIENT_BALANCE_HINT
          : "تعذر حجز رصيد العملية.",
      );
    }
    holdId = String(hold);
  }

  let res: Response;
  let model = requestedModel;
  try {
    const call = await callProvider(apiKey, init);
    res = call.res;
    model = call.model;
  } catch (providerError) {
    // فشل الاتصال بالمزوّد: إلغاء الحجز فورًا بدون أي خصم، ولا يُترك الحجز مفتوحًا.
    if (holdId) {
      const { error: releaseError } = await supabaseAdmin.rpc("release_ai_hold", { _hold_id: holdId });
      if (releaseError) {
        // محاولة أخيرة عبر المسار الجماعي، ثم يبقى الحجز محكومًا بانتهاء صلاحيته والمهمة المجدولة.
        const { error: sweepError } = await supabaseAdmin.rpc("release_stale_ai_holds", {
          _owner_id: ownerId,
        });
        console.error(
          "[ai] تعذر تحرير الحجز بعد فشل المزوّد",
          releaseError.message,
          sweepError?.message ?? "",
        );
      }
    }
    throw providerError;
  }

  const text = await res.text();
  const usage = res.ok ? parseTokenUsage(text) : { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const charge = price && res.ok ? computeCharge(price, usage.inputTokens, usage.outputTokens) : null;

  // تسجيل العملية أولًا؛ فشل التسجيل لا يمنع إنهاء المحاسبة.
  let usageId: string | null = null;
  const { data: usageRow, error: usageError } = await supabaseAdmin
    .from("ai_usage_events")
    .insert({
      owner_id: ownerId,
      source: decision.source,
      operation,
      status: res.ok ? "success" : "failed",
      model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      provider_code: price?.providerCode ?? null,
      model_price_id: price?.priceId ?? null,
      sell_input_egp_per_million: price?.sellInputEgpPerMillion ?? null,
      sell_output_egp_per_million: price?.sellOutputEgpPerMillion ?? null,
      provider_cost_usd: charge?.providerCostUsd ?? null,
      charged_egp: charge?.chargedEgp ?? 0,
    })
    .select("id")
    .single();
  if (usageError) console.error("[ai] تعذر تسجيل عملية الذكاء الاصطناعي", usageError.message);
  if (usageRow?.id) usageId = String(usageRow.id);

  // إنهاء المحاسبة بحالة نهائية مؤكدة: إما تسوية أو تحرير، وأي فشل يُرفع ولا يُبتلع.
  if (holdId && charge) {
    const { data: balanceAfter, error: settleError } = await supabaseAdmin.rpc("settle_ai_hold", {
      _hold_id: holdId,
      _actual: charge.chargedEgp,
      ...(usageId ? { _usage_id: usageId } : {}),
    });
    if (settleError && !String(settleError.message ?? "").includes("HOLD_ALREADY_CLOSED")) {
      // الحجز يبقى مفتوحًا لكنه ينتهي بصلاحيته ويُحرَّر تلقائيًا؛ الخطأ لا يُخفى.
      await supabaseAdmin.rpc("release_stale_ai_holds", { _owner_id: ownerId });
      throw new Error(`تعذر إنهاء محاسبة عملية الذكاء الاصطناعي: ${settleError.message}`);
    }
    if (usageId && balanceAfter !== null && balanceAfter !== undefined) {
      await supabaseAdmin
        .from("ai_usage_events")
        .update({ balance_after_egp: Number(balanceAfter) })
        .eq("id", usageId);
    }
  } else if (holdId) {
    // فشل المزوّد: تحرير الحجز بالكامل بدون خصم.
    const { error: releaseError } = await supabaseAdmin.rpc("release_ai_hold", { _hold_id: holdId });
    if (releaseError) {
      await supabaseAdmin.rpc("release_stale_ai_holds", { _owner_id: ownerId });
      throw new Error(`تعذر تحرير المبلغ المحجوز للعملية: ${releaseError.message}`);
    }
  }

  if (!usesWallet && usage.totalTokens > 0) {
    // خصم رصيد التجربة الداخلي ذريًا داخل قاعدة البيانات.
    const { error: trialError } = await supabaseAdmin.rpc("consume_trial_tokens", {
      _owner_id: ownerId,
      _tokens: usage.totalTokens,
    });
    if (trialError) throw new Error(`تعذر تحديث رصيد استخدام الذكاء الاصطناعي: ${trialError.message}`);
  }

  return new Response(text, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

const INSUFFICIENT_BALANCE_HINT =
  "نفد رصيد الـ AI. اشحن رصيدك لتستطيع البحث والزحف والتحليل والاكتشاف.";
