/**
 * تسعير عمليات الذكاء الاصطناعي (خادم فقط).
 *
 * القواعد:
 * - لكل مزوّد + نموذج سعر تكلفة بالدولار لكل مليون توكن (Input/Output).
 * - سعر البيع بالجنيه = التكلفة بالدولار × سعر الصرف × (1 + هامش الربح ÷ 100).
 * - الأسعار محفوظة بفترات صلاحية، والسعر المستخدم وقت التنفيذ يُخزَّن مع العملية.
 */

export type ModelPrice = {
  priceId: string;
  modelId: string;
  providerCode: string;
  modelCode: string;
  costInputUsdPerMillion: number;
  costOutputUsdPerMillion: number;
  sellInputEgpPerMillion: number;
  sellOutputEgpPerMillion: number;
};

export type PricingSettings = {
  marginPercent: number;
  usdToEgp: number;
  minDepositEgp: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
};

/** تقدير الحجز المسبق قبل تنفيذ العملية (يُسوّى بالمبلغ الفعلي بعدها). */
const ESTIMATE_INPUT_TOKENS = 40_000;
const ESTIMATE_OUTPUT_TOKENS = 8_000;
/** أدنى مبلغ يُحجز حتى لو كان تقدير التكلفة أصغر منه. */
const MIN_HOLD_EGP = 0.05;

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sellPrices(costUsdPerMillion: number, marginPercent: number, usdToEgp: number): number {
  return costUsdPerMillion * usdToEgp * (1 + Math.max(0, marginPercent) / 100);
}

export async function getPricingSettings(): Promise<PricingSettings> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("ai_pricing_settings")
    .select("margin_percent, usd_to_egp, min_deposit_egp, last_sync_at, last_sync_status, last_sync_error")
    .eq("id", true)
    .maybeSingle();

  return {
    marginPercent: data ? num(data.margin_percent) : 100,
    usdToEgp: data ? num(data.usd_to_egp) || 50 : 50,
    minDepositEgp: data ? num(data.min_deposit_egp) || 200 : 200,
    lastSyncAt: data?.last_sync_at ? String(data.last_sync_at) : null,
    lastSyncStatus: data?.last_sync_status ? String(data.last_sync_status) : null,
    lastSyncError: data?.last_sync_error ? String(data.last_sync_error) : null,
  };
}

type PriceRow = {
  id: string;
  model_id: string;
  cost_input_usd_per_million: number;
  cost_output_usd_per_million: number;
  sell_input_egp_per_million: number;
  sell_output_egp_per_million: number;
  ai_models: {
    model_code: string;
    ai_providers: { code: string } | null;
  } | null;
};

const PRICE_SELECT =
  "id, model_id, cost_input_usd_per_million, cost_output_usd_per_million, sell_input_egp_per_million, sell_output_egp_per_million, ai_models!inner(model_code, ai_providers!inner(code))";

function toPrice(row: PriceRow): ModelPrice {
  return {
    priceId: String(row.id),
    modelId: String(row.model_id),
    providerCode: row.ai_models?.ai_providers?.code ?? "openai",
    modelCode: row.ai_models?.model_code ?? "",
    costInputUsdPerMillion: num(row.cost_input_usd_per_million),
    costOutputUsdPerMillion: num(row.cost_output_usd_per_million),
    sellInputEgpPerMillion: num(row.sell_input_egp_per_million),
    sellOutputEgpPerMillion: num(row.sell_output_egp_per_million),
  };
}

/**
 * السعر الديناميكي الساري الآن (التكلفة الفعلية للمزوّد ÷ الاستهلاك الفعلي).
 * لا يعتمد على اسم النموذج، ولا يوجد رجوع صامت إلى سعر نموذج آخر.
 */
export async function getCurrentDynamicPrice(): Promise<ModelPrice | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { DYNAMIC_PRICE_CODE } = await import("./ai-providers.server");
  const { data } = await supabaseAdmin
    .from("ai_model_prices")
    .select(PRICE_SELECT)
    .is("effective_to", null)
    .eq("ai_models.model_code", DYNAMIC_PRICE_CODE)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return applyCurrentSettings(toPrice(data as unknown as PriceRow), await getPricingSettings());
}

/**
 * يعيد حساب سعر البيع من تكلفة المزوّد الديناميكية + الهامش وسعر الصرف الحاليين.
 * التكلفة تتحدث كل 12 ساعة، أما الهامش وسعر الصرف فيُقرآن عند كل عملية جديدة.
 */
export function applyCurrentSettings(
  price: ModelPrice,
  settings: { marginPercent: number; usdToEgp: number },
): ModelPrice {
  return {
    ...price,
    sellInputEgpPerMillion: sellPrices(price.costInputUsdPerMillion, settings.marginPercent, settings.usdToEgp),
    sellOutputEgpPerMillion: sellPrices(price.costOutputUsdPerMillion, settings.marginPercent, settings.usdToEgp),
  };
}

/** تكلفة العملية على المستخدم بالجنيه، وتكلفتها الفعلية على كشاف بالدولار. */
export function computeCharge(
  price: ModelPrice,
  inputTokens: number,
  outputTokens: number,
): { chargedEgp: number; providerCostUsd: number } {
  const inTokens = Math.max(0, inputTokens);
  const outTokens = Math.max(0, outputTokens);
  const chargedEgp =
    (inTokens / 1_000_000) * price.sellInputEgpPerMillion +
    (outTokens / 1_000_000) * price.sellOutputEgpPerMillion;
  const providerCostUsd =
    (inTokens / 1_000_000) * price.costInputUsdPerMillion +
    (outTokens / 1_000_000) * price.costOutputUsdPerMillion;
  return { chargedEgp: Math.round(chargedEgp * 1e6) / 1e6, providerCostUsd: Math.round(providerCostUsd * 1e8) / 1e8 };
}

/** المبلغ الذي يُحجز قبل تنفيذ العملية. */
export function estimateHoldEgp(price: ModelPrice): number {
  const { chargedEgp } = computeCharge(price, ESTIMATE_INPUT_TOKENS, ESTIMATE_OUTPUT_TOKENS);
  return Math.max(MIN_HOLD_EGP, chargedEgp);
}
