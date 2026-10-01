/**
 * محاسبة كشاف مع مزوّدي الذكاء الاصطناعي (خادم فقط).
 *
 * التسعير ديناميكي بالكامل ومستقل عن اسم النموذج:
 *   تكلفة OpenAI الفعلية (organization/costs, group_by=line_item)
 *   ÷ الاستهلاك الفعلي لنفس الفترة (organization/usage/completions)
 *   = تكلفة المليون توكن (Input وOutput منفصلين).
 * لا توجد قائمة نماذج ولا سعر بديل من نموذج آخر؛ عند غياب بيانات موثوقة يبقى آخر سعر صالح.
 */
import { computeDynamicPrice, measurementWindow, sellPerMillionEgp, type CostLine, type UsageLine } from "./ai-dynamic-pricing";

/** رمز سلسلة السعر الديناميكي — ليست نموذجًا، بل "كل استهلاك المزوّد". */
export const DYNAMIC_PRICE_CODE = "__provider_actual__";

export type ProviderCostReport = {
  providerCode: string;
  status: "success" | "skipped" | "failed";
  message: string | null;
  providerCostUsd: number | null;
};

type Paged<T> = { data?: T[]; has_more?: boolean; next_page?: string | null };

async function fetchAllPages<T>(url: string, adminKey: string): Promise<T[]> {
  const out: T[] = [];
  let page: string | null = null;
  for (let i = 0; i < 20; i++) {
    const res = await fetch(page ? `${url}&page=${encodeURIComponent(page)}` : url, {
      headers: { Authorization: `Bearer ${adminKey}` },
    });
    if (!res.ok) throw new Error(`OpenAI ${new URL(url).pathname} أعاد ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as Paged<T>;
    out.push(...(body.data ?? []));
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return out;
}

export async function syncProviderPricing(): Promise<{ updated: number; reports: ProviderCostReport[] }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getPricingSettings } = await import("./ai-pricing.server");
  const { openAiAdminKeyAsync } = await import("./secrets.server");
  const settings = await getPricingSettings();
  const { start, end } = measurementWindow(new Date());
  const s = Math.floor(start.getTime() / 1000);
  const e = Math.floor(end.getTime() / 1000);

  const run: Record<string, unknown> = {
    provider_code: "openai",
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    models_updated: 0,
  };
  let updated = 0;
  let status: ProviderCostReport["status"] = "failed";
  let message: string | null = null;
  let totalCost: number | null = null;

  try {
    const adminKey = await openAiAdminKeyAsync();
    if (!adminKey) throw new Error("مفتاح إدارة OpenAI غير مضبوط؛ لا يمكن قراءة التكلفة والاستهلاك الفعليين.");

    const [costBuckets, usageBuckets] = await Promise.all([
      fetchAllPages<{ results?: { line_item?: string | null; amount?: { value?: number } }[] }>(
        `https://api.openai.com/v1/organization/costs?start_time=${s}&end_time=${e}&bucket_width=1d&group_by=line_item&limit=31`,
        adminKey,
      ),
      fetchAllPages<{ results?: { input_tokens?: number; output_tokens?: number }[] }>(
        `https://api.openai.com/v1/organization/usage/completions?start_time=${s}&end_time=${e}&bucket_width=1d&limit=31`,
        adminKey,
      ),
    ]);
    const costs: CostLine[] = costBuckets.flatMap((b) =>
      (b.results ?? []).map((r) => ({ lineItem: r.line_item ?? null, amountUsd: Number(r.amount?.value) || 0 })),
    );
    const usage: UsageLine[] = usageBuckets.flatMap((b) =>
      (b.results ?? []).map((r) => ({ inputTokens: Number(r.input_tokens) || 0, outputTokens: Number(r.output_tokens) || 0 })),
    );
    const result = computeDynamicPrice(costs, usage);
    totalCost = result.inputCostUsd + result.outputCostUsd + result.otherCostUsd;
    Object.assign(run, {
      provider_cost_usd: totalCost,
      input_cost_usd: result.inputCostUsd,
      output_cost_usd: result.outputCostUsd,
      other_cost_usd: result.otherCostUsd,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    });

    if (!result.ok) {
      status = "skipped";
      message = `${result.reason} بقي آخر سعر صالح.`;
    } else {
      const { data: modelRow } = await supabaseAdmin
        .from("ai_models")
        .select("id, ai_providers!inner(code)")
        .eq("model_code", DYNAMIC_PRICE_CODE)
        .eq("ai_providers.code", "openai")
        .maybeSingle();
      if (!modelRow) throw new Error("سلسلة السعر الديناميكي غير موجودة.");

      const sellIn = sellPerMillionEgp(result.costInputUsdPerMillion, settings.marginPercent, settings.usdToEgp);
      const sellOut = sellPerMillionEgp(result.costOutputUsdPerMillion, settings.marginPercent, settings.usdToEgp);
      const nowIso = new Date().toISOString();

      const { data: inserted, error } = await supabaseAdmin
        .from("ai_model_prices")
        .insert({
          model_id: modelRow.id,
          cost_input_usd_per_million: result.costInputUsdPerMillion,
          cost_output_usd_per_million: result.costOutputUsdPerMillion,
          margin_percent: settings.marginPercent,
          usd_to_egp: settings.usdToEgp,
          sell_input_egp_per_million: sellIn,
          sell_output_egp_per_million: sellOut,
          source: "actual",
          effective_from: nowIso,
        })
        .select("id")
        .single();
      if (error || !inserted) throw new Error(`تعذر حفظ السعر الجديد: ${error?.message ?? ""}`);

      // إغلاق السعر السابق فقط بعد نجاح إنشاء الجديد (التاريخ محفوظ ولا يُعاد حساب القديم).
      await supabaseAdmin
        .from("ai_model_prices")
        .update({ effective_to: nowIso })
        .eq("model_id", modelRow.id)
        .is("effective_to", null)
        .neq("id", inserted.id);

      updated = 1;
      status = "success";
      Object.assign(run, {
        models_updated: 1,
        price_id: inserted.id,
        cost_input_usd_per_million: result.costInputUsdPerMillion,
        cost_output_usd_per_million: result.costOutputUsdPerMillion,
      });
      if (result.otherCostUsd > 0) {
        message = `بنود غير توكنية ($${result.otherCostUsd.toFixed(4)}) غير داخلة في سعر التوكن.`;
      }
    }
  } catch (error) {
    status = "failed";
    message = `${error instanceof Error ? error.message : String(error)} — بقي آخر سعر صالح.`;
  }

  await supabaseAdmin.from("ai_provider_sync_runs").insert({ ...run, status, message } as never);
  await supabaseAdmin
    .from("ai_pricing_settings")
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: status,
      last_sync_error: status === "success" ? null : message,
    })
    .eq("id", true);

  return { updated, reports: [{ providerCode: "openai", status, message, providerCostUsd: totalCost }] };
}

export type ProviderBalance = {
  providerCode: string;
  /** الرصيد المتبقي لدى المزوّد بالدولار، إن كان المزوّد يوفّره. */
  balanceUsd: number | null;
  /** إجمالي الإنفاق لدى المزوّد خلال آخر 30 يومًا بالدولار. */
  spendUsd30dUsd: number | null;
  /** مبلغ الشحن المُدخل يدويًا بالدولار، إن وُجد. */
  creditUsd: number | null;
  /** تاريخ بدء احتساب مبلغ الشحن. */
  creditSince: string | null;
  /** الإنفاق منذ تاريخ الشحن بالدولار. */
  spendSinceCreditUsd: number | null;
  status: "ok" | "unavailable" | "failed";
  message: string | null;
};

/** إنفاق OpenAI خلال آخر 30 يومًا عبر مفتاح الإدارة. */
async function openaiSpend30d(adminKey: string): Promise<number> {
  const startTime = Math.floor(Date.now() / 1000) - 30 * 86_400;
  const res = await fetch(`https://api.openai.com/v1/organization/costs?start_time=${startTime}&limit=31`, {
    headers: { Authorization: `Bearer ${adminKey}` },
  });
  if (!res.ok) throw new Error(`تعذر قراءة إنفاق OpenAI (${res.status}).`);
  const payload = (await res.json()) as { data?: { results?: { amount?: { value?: number } }[] }[] };
  let total = 0;
  for (const bucket of payload.data ?? []) {
    for (const result of bucket.results ?? []) total += Number(result.amount?.value) || 0;
  }
  return Math.round(total * 1e6) / 1e6;
}

/** إنفاق OpenAI منذ تاريخ محدد (يُستخدم لحساب المتبقي من رصيد مشحون يدويًا). */
async function openaiSpendSince(adminKey: string, sinceIso: string): Promise<number> {
  const startTime = Math.floor(new Date(sinceIso).getTime() / 1000);
  let page: string | null = null;
  let total = 0;
  for (let i = 0; i < 12; i++) {
    const url =
      `https://api.openai.com/v1/organization/costs?start_time=${startTime}&limit=180` +
      (page ? `&page=${encodeURIComponent(page)}` : "");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${adminKey}` } });
    if (!res.ok) throw new Error(`تعذر قراءة إنفاق OpenAI (${res.status}).`);
    const payload = (await res.json()) as {
      data?: { results?: { amount?: { value?: number } }[] }[];
      has_more?: boolean;
      next_page?: string | null;
    };
    for (const bucket of payload.data ?? []) {
      for (const result of bucket.results ?? []) total += Number(result.amount?.value) || 0;
    }
    if (!payload.has_more || !payload.next_page) break;
    page = payload.next_page;
  }
  return Math.round(total * 1e6) / 1e6;
}

/** الرصيد المتبقي لدى OpenAI — واجهة قديمة قد لا تكون متاحة لكل الحسابات. */
async function openaiRemainingCredit(adminKey: string): Promise<number | null> {
  try {
    const res = await fetch("https://api.openai.com/dashboard/billing/credit_grants", {
      headers: { Authorization: `Bearer ${adminKey}` },
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { total_available?: number };
    const value = Number(payload.total_available);
    return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : null;
  } catch {
    return null;
  }
}

/** أرصدة وإنفاق كشاف لدى كل مزوّد نشط (أدمن فقط، لا تُعاد أي مفاتيح). */
export async function fetchProviderBalances(): Promise<ProviderBalance[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: providers } = await supabaseAdmin
    .from("ai_providers")
    .select("code")
    .eq("is_active", true)
    .order("code");

  const out: ProviderBalance[] = [];

  for (const provider of providers ?? []) {
    const code = String(provider.code);

    if (code !== "openai") {
      out.push({
        providerCode: code,
        balanceUsd: null,
        spendUsd30dUsd: null,
        creditUsd: null,
        creditSince: null,
        spendSinceCreditUsd: null,
        status: "unavailable",
        message: "هذا المزوّد لا يوفّر واجهة لقراءة الرصيد.",
      });
      continue;
    }

    const adminKey = process.env["OPENAI_ADMIN_API_KEY"] || process.env["OPENAI_ADMIN_KEY"];
    if (!adminKey) {
      out.push({
        providerCode: code,
        balanceUsd: null,
        spendUsd30dUsd: null,
        creditUsd: null,
        creditSince: null,
        spendSinceCreditUsd: null,
        status: "unavailable",
        message: "مفتاح إدارة OpenAI غير مضبوط.",
      });
      continue;
    }

    try {
      const { data: topups } = await supabaseAdmin
        .from("openai_topups")
        .select("amount_usd, credited_at")
        .order("credited_at", { ascending: true });

      const rows = topups ?? [];
      const creditUsd = Math.round(rows.reduce((sum, r) => sum + (Number(r.amount_usd) || 0), 0) * 1e6) / 1e6;
      const creditSince = rows.length > 0 ? String(rows[0]!.credited_at) : null;

      const [spend, apiBalance] = await Promise.all([
        openaiSpend30d(adminKey),
        openaiRemainingCredit(adminKey),
      ]);

      let balance = apiBalance;
      let message: string | null =
        apiBalance === null ? "OpenAI لا يعرض الرصيد المتبقي لهذا الحساب، الإنفاق فقط." : null;
      let spendSinceCreditUsd: number | null = null;

      if (creditUsd > 0 && creditSince) {
        spendSinceCreditUsd = await openaiSpendSince(adminKey, creditSince);
        balance = Math.round((creditUsd - spendSinceCreditUsd) * 1e6) / 1e6;
        message = "الرصيد محسوب من مجموع الشحنات المسجّلة ناقص الإنفاق منذ أول شحنة.";
      } else if (apiBalance === null) {
        message = "سجّل أول شحنة بالأسفل ليظهر الرصيد المتبقي.";
      }

      out.push({
        providerCode: code,
        balanceUsd: balance,
        spendUsd30dUsd: spend,
        creditUsd: creditUsd > 0 ? creditUsd : null,
        creditSince,
        spendSinceCreditUsd,
        status: "ok",
        message,
      });
    } catch (error) {
      out.push({
        providerCode: code,
        balanceUsd: null,
        spendUsd30dUsd: null,
        creditUsd: null,
        creditSince: null,
        spendSinceCreditUsd: null,
        status: "failed",
        message: error instanceof Error ? error.message : "خطأ غير معروف",
      });
    }
  }

  return out;
}
