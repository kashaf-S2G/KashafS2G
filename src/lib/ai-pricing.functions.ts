import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** سعر نموذج معروض في لوحة الأدمن. */
export type AdminModelPrice = {
  modelCode: string;
  displayName: string;
  providerCode: string;
  costInputUsdPerMillion: number;
  costOutputUsdPerMillion: number;
  sellInputEgpPerMillion: number;
  sellOutputEgpPerMillion: number;
  effectiveFrom: string;
};

export type AdminPricingView = {
  marginPercent: number;
  usdToEgp: number;
  minDepositEgp: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  prices: AdminModelPrice[];
  syncRuns: {
    id: string;
    providerCode: string;
    status: string;
    modelsUpdated: number;
    message: string | null;
    providerCostUsd: number | null;
    createdAt: string;
    periodStart: string | null;
    periodEnd: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    inputCostUsd: number | null;
    outputCostUsd: number | null;
    otherCostUsd: number | null;
    costInputUsdPerMillion: number | null;
    costOutputUsdPerMillion: number | null;
  }[];
  lastSuccessAt: string | null;
};

async function assertAdmin(context: { supabase: { rpc: Function }; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || data !== true) throw new Error("هذه الصفحة متاحة للأدمن فقط.");
}

export const getAdminPricing = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminPricingView> => {
    await assertAdmin(context);

    const { getPricingSettings, sellPrices } = await import("./ai-pricing.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [settings, pricesRes, runsRes] = await Promise.all([
      getPricingSettings(),
      supabaseAdmin
        .from("ai_model_prices")
        .select(
          "cost_input_usd_per_million, cost_output_usd_per_million, sell_input_egp_per_million, sell_output_egp_per_million, effective_from, ai_models!inner(model_code, display_name, ai_providers!inner(code))",
        )
        .is("effective_to", null)
        .eq("ai_models.model_code", "__provider_actual__")
        .order("effective_from", { ascending: false }),
      supabaseAdmin
        .from("ai_provider_sync_runs")
        .select("id, provider_code, status, models_updated, message, provider_cost_usd, created_at, period_start, period_end, input_tokens, output_tokens, input_cost_usd, output_cost_usd, other_cost_usd, cost_input_usd_per_million, cost_output_usd_per_million")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const lastOk = await supabaseAdmin
      .from("ai_provider_sync_runs")
      .select("created_at")
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

    type Row = {
      cost_input_usd_per_million: number;
      cost_output_usd_per_million: number;
      sell_input_egp_per_million: number;
      sell_output_egp_per_million: number;
      effective_from: string;
      ai_models: { model_code: string; display_name: string; ai_providers: { code: string } | null } | null;
    };

    return {
      ...settings,
      prices: ((pricesRes.data ?? []) as unknown as Row[]).map((row) => ({
        modelCode: row.ai_models?.model_code ?? "—",
        displayName: row.ai_models?.display_name ?? "—",
        providerCode: row.ai_models?.ai_providers?.code ?? "—",
        costInputUsdPerMillion: Number(row.cost_input_usd_per_million) || 0,
        costOutputUsdPerMillion: Number(row.cost_output_usd_per_million) || 0,
        // سعر البيع الفعلي للعمليات الجديدة: التكلفة الحالية × (1 + الهامش الحالي) × سعر الصرف الحالي.
        sellInputEgpPerMillion: sellPrices(Number(row.cost_input_usd_per_million) || 0, settings.marginPercent, settings.usdToEgp),
        sellOutputEgpPerMillion: sellPrices(Number(row.cost_output_usd_per_million) || 0, settings.marginPercent, settings.usdToEgp),
        effectiveFrom: String(row.effective_from),
      })),
      syncRuns: (runsRes.data ?? []).map((row) => ({
        id: String(row.id),
        providerCode: String(row.provider_code),
        status: String(row.status),
        modelsUpdated: Number(row.models_updated) || 0,
        message: row.message ? String(row.message) : null,
        providerCostUsd: row.provider_cost_usd === null ? null : Number(row.provider_cost_usd),
        createdAt: String(row.created_at),
        periodStart: row.period_start ? String(row.period_start) : null,
        periodEnd: row.period_end ? String(row.period_end) : null,
        inputTokens: n(row.input_tokens),
        outputTokens: n(row.output_tokens),
        inputCostUsd: n(row.input_cost_usd),
        outputCostUsd: n(row.output_cost_usd),
        otherCostUsd: n(row.other_cost_usd),
        costInputUsdPerMillion: n(row.cost_input_usd_per_million),
        costOutputUsdPerMillion: n(row.cost_output_usd_per_million),
      })),
      lastSuccessAt: lastOk.data?.created_at ? String(lastOk.data.created_at) : null,
    };
  });

/** تعديل هامش الربح وسعر الصرف والحد الأدنى للإيداع (أدمن فقط). */
export const updatePricingSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { marginPercent: number; usdToEgp: number; minDepositEgp: number }) => {
    const marginPercent = Number(input.marginPercent);
    const usdToEgp = Number(input.usdToEgp);
    const minDepositEgp = Number(input.minDepositEgp);
    if (!Number.isFinite(marginPercent) || marginPercent < 0) throw new Error("هامش ربح غير صالح.");
    if (!Number.isFinite(usdToEgp) || usdToEgp <= 0) throw new Error("سعر صرف غير صالح.");
    if (!Number.isFinite(minDepositEgp) || minDepositEgp <= 0) throw new Error("حد أدنى غير صالح.");
    return { marginPercent, usdToEgp, minDepositEgp };
  })
  .handler(async ({ context, data }): Promise<{ updated: true }> => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("ai_pricing_settings")
      .update({
        margin_percent: data.marginPercent,
        usd_to_egp: data.usdToEgp,
        min_deposit_egp: data.minDepositEgp,
      })
      .eq("id", true);
    if (error) throw new Error("تعذر حفظ إعدادات التسعير.");
    return { updated: true };
  });

/** تشغيل مزامنة أسعار المزوّدين يدويًا من لوحة الأدمن. */
export const syncPricingNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ updated: number }> => {
    await assertAdmin(context);
    const { syncProviderPricing } = await import("./ai-providers.server");
    const { updated } = await syncProviderPricing();
    return { updated };
  });

export type AdminProviderBalance = {
  providerCode: string;
  balanceUsd: number | null;
  spendUsd30dUsd: number | null;
  creditUsd: number | null;
  creditSince: string | null;
  spendSinceCreditUsd: number | null;
  status: "ok" | "unavailable" | "failed";
  message: string | null;
};

export type OpenAiTopup = {
  id: string;
  amountUsd: number;
  creditedAt: string;
  note: string | null;
};

/** سجل شحنات حساب OpenAI (أدمن فقط). */
export const listOpenAiTopups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ topups: OpenAiTopup[]; totalUsd: number }> => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("openai_topups")
      .select("id, amount_usd, credited_at, note")
      .order("credited_at", { ascending: false });
    if (error) throw new Error("تعذر قراءة سجل الشحنات.");
    const topups = (data ?? []).map((row) => ({
      id: String(row.id),
      amountUsd: Number(row.amount_usd) || 0,
      creditedAt: String(row.credited_at),
      note: row.note ? String(row.note) : null,
    }));
    const totalUsd = Math.round(topups.reduce((sum, t) => sum + t.amountUsd, 0) * 1e6) / 1e6;
    return { topups, totalUsd };
  });

/** تسجيل شحنة جديدة في حساب OpenAI بمبلغها وتاريخها (أدمن فقط). */
export const addOpenAiTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { amountUsd: number; creditedAt: string; note?: string }) => {
    const amountUsd = Number(input.amountUsd);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error("مبلغ الشحن غير صالح.");
    const date = new Date(input.creditedAt);
    if (Number.isNaN(date.getTime())) throw new Error("تاريخ الشحن غير صالح.");
    const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 200) : null;
    return { amountUsd, creditedAt: date.toISOString(), note };
  })
  .handler(async ({ context, data }): Promise<{ added: true }> => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("openai_topups").insert({
      amount_usd: data.amountUsd,
      credited_at: data.creditedAt,
      note: data.note,
      created_by: context.userId,
    });
    if (error) throw new Error("تعذر تسجيل الشحنة.");
    return { added: true };
  });

/** حذف شحنة مسجّلة بالخطأ (أدمن فقط). */
export const deleteOpenAiTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("شحنة غير معروفة.");
    return { id: String(input.id) };
  })
  .handler(async ({ context, data }): Promise<{ deleted: true }> => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("openai_topups").delete().eq("id", data.id);
    if (error) throw new Error("تعذر حذف الشحنة.");
    return { deleted: true };
  });

/** مزامنة أرصدة كشاف لدى مزوّدي الذكاء الاصطناعي (أدمن فقط). */
export const getProviderBalances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ balances: AdminProviderBalance[]; checkedAt: string }> => {
    await assertAdmin(context);
    const { fetchProviderBalances } = await import("./ai-providers.server");
    return { balances: await fetchProviderBalances(), checkedAt: new Date().toISOString() };
  });

/** فحص مفتاح إدارة OpenAI وبيان سبب الفشل بالتفصيل (أدمن فقط، لا يُعاد المفتاح). */
export const testOpenAiAdminKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean; message: string }> => {
    await assertAdmin(context);
    const { openAiAdminKeyAsync } = await import("./secrets.server");
    const key = await openAiAdminKeyAsync();
    if (!key) {
      return {
        ok: false,
        message: "لا يوجد مفتاح إدارة محفوظ في المشروع باسم OPENAI_ADMIN_API_KEY، لذلك يتعذر تحديث السعر، ويستمر النظام باستخدام آخر سعر ديناميكي صالح.",
      };
    }

    const startTime = Math.floor(Date.now() / 1000) - 86_400;
    try {
      const res = await fetch(
        `https://api.openai.com/v1/organization/costs?start_time=${startTime}&limit=1`,
        { headers: { Authorization: `Bearer ${key}` } },
      );
      if (res.ok) return { ok: true, message: "المفتاح يعمل، وقراءة التكلفة من حساب OpenAI ناجحة." };

      const body = await res.text();
      const detail = body.slice(0, 300);
      if (res.status === 401)
        return { ok: false, message: `المفتاح مرفوض (401): غير صالح أو تم حذفه. ${detail}` };
      if (res.status === 403)
        return {
          ok: false,
          message: `المفتاح ليس مفتاح إدارة (403): أنشئ Admin key من إعدادات المؤسسة وليس مفتاح استخدام عادي. ${detail}`,
        };
      if (res.status === 429)
        return { ok: false, message: `تجاوز حد الطلبات مؤقتًا (429)، جرّب بعد قليل. ${detail}` };
      return { ok: false, message: `فشل الطلب (${res.status}). ${detail}` };
    } catch (error) {
      return {
        ok: false,
        message: `تعذر الاتصال بـ OpenAI: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

/** فحص مفتاح استخدام OpenAI العادي وبيان سبب الفشل بالتفصيل (أدمن فقط، لا يُعاد المفتاح). */
export const testOpenAiApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean; message: string }> => {
    await assertAdmin(context);
    const { openAiKey } = await import("./secrets.server");
    const key = await openAiKey();
    if (!key) {
      return {
        ok: false,
        message: "لا يوجد مفتاح OpenAI محفوظ في المشروع باسم OPENAI_API_KEY.",
      };
    }

    try {
      const res = await fetch("https://api.openai.com/v1/models?limit=1", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) return { ok: true, message: "المفتاح يعمل، وقراءة نماذج OpenAI ناجحة." };

      const body = await res.text();
      const detail = body.slice(0, 300);
      if (res.status === 401)
        return { ok: false, message: `المفتاح مرفوض (401): غير صالح أو تم حذفه. ${detail}` };
      if (res.status === 429)
        return { ok: false, message: `تجاوز حد الطلبات مؤقتًا (429)، جرّب بعد قليل. ${detail}` };
      return { ok: false, message: `فشل الطلب (${res.status}). ${detail}` };
    } catch (error) {
      return {
        ok: false,
        message: `تعذر الاتصال بـ OpenAI: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });
