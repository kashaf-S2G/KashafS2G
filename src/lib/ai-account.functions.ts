import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** نوع العملية كما هو مسجَّل في قاعدة البيانات. */
export type AiUsageEvent = {
  id: string;
  createdAt: string;
  operation: string;
  status: "success" | "failed";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** المبلغ المخصوم بالجنيه لهذه العملية. */
  chargedEgp: number;
  /** الرصيد المالي بعد العملية. */
  balanceAfterEgp: number | null;
};

export type AiUsageLog = {
  events: AiUsageEvent[];
  /** إجمالي المخصوم اليوم بالجنيه. */
  todayEgp: number;
  /** إجمالي المخصوم هذا الشهر بالجنيه. */
  monthEgp: number;
  /** إجمالي Tokens المستهلكة هذا الشهر. */
  monthTokens: number;
};

type UsageFilters = {
  period: "today" | "7d" | "30d" | "all";
  operation: string | null;
};

const PERIODS = new Set(["today", "7d", "30d", "all"]);

function periodStart(period: UsageFilters["period"]): string | null {
  const now = new Date();
  if (period === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }
  if (period === "7d") return new Date(now.getTime() - 7 * 86_400_000).toISOString();
  if (period === "30d") return new Date(now.getTime() - 30 * 86_400_000).toISOString();
  return null;
}

export const getAiUsageLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Partial<UsageFilters> | undefined): UsageFilters => ({
    period: PERIODS.has(String(input?.period)) ? (input!.period as UsageFilters["period"]) : "30d",
    operation: input?.operation ? String(input.operation) : null,
  }))
  .handler(async ({ context, data }): Promise<AiUsageLog> => {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    let query = context.supabase
      .from("ai_usage_events")
      .select(
        "id, created_at, operation, status, input_tokens, output_tokens, total_tokens, charged_egp, balance_after_egp",
      )
      .eq("owner_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);

    const from = periodStart(data.period);
    if (from) query = query.gte("created_at", from);
    if (data.operation) query = query.eq("operation", data.operation);

    const [{ data: rows, error }, monthRes] = await Promise.all([
      query,
      context.supabase
        .from("ai_usage_events")
        .select("created_at, total_tokens, charged_egp")
        .eq("owner_id", context.userId)
        .eq("status", "success")
        .gte("created_at", monthStart)
        .limit(5000),
    ]);

    if (error) throw new Error("تعذر تحميل سجل استخدام الذكاء الاصطناعي.");

    let todayEgp = 0;
    let monthEgp = 0;
    let monthTokens = 0;
    for (const row of monthRes.data ?? []) {
      const amount = Math.max(0, Number(row.charged_egp) || 0);
      monthEgp += amount;
      monthTokens += Math.max(0, Number(row.total_tokens) || 0);
      if (String(row.created_at) >= dayStart) todayEgp += amount;
    }

    return {
      todayEgp: round2(todayEgp),
      monthEgp: round2(monthEgp),
      monthTokens,
      events: (rows ?? []).map((row) => ({
        id: String(row.id),
        createdAt: String(row.created_at),
        operation: String(row.operation),
        status: row.status === "failed" ? "failed" : "success",
        inputTokens: Math.max(0, Number(row.input_tokens) || 0),
        outputTokens: Math.max(0, Number(row.output_tokens) || 0),
        totalTokens: Math.max(0, Number(row.total_tokens) || 0),
        chargedEgp: Math.max(0, Number(row.charged_egp) || 0),
        balanceAfterEgp:
          row.balance_after_egp === null || row.balance_after_egp === undefined
            ? null
            : round2(Number(row.balance_after_egp)),
      })),
    };
  });

/** حركة مالية واحدة في محفظة المستخدم. */
export type WalletEntry = {
  id: string;
  createdAt: string;
  kind: "deposit" | "ai_charge" | "admin_adjust" | "refund";
  amountEgp: number;
  balanceAfterEgp: number;
  note: string | null;
};

export const getWalletLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WalletEntry[]> => {
    const { data, error } = await context.supabase
      .from("wallet_ledger")
      .select("id, created_at, kind, amount_egp, balance_after_egp, note")
      .eq("owner_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw new Error("تعذر تحميل سجل الحركات المالية.");

    return (data ?? []).map((row) => ({
      id: String(row.id),
      createdAt: String(row.created_at),
      kind: row.kind as WalletEntry["kind"],
      amountEgp: round2(Number(row.amount_egp)),
      balanceAfterEgp: round2(Number(row.balance_after_egp)),
      note: row.note ? String(row.note) : null,
    }));
  });
