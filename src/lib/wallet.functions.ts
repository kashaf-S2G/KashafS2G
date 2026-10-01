import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** رقم فودافون كاش الاحتياطي إذا لم يضف الأدمن أرقامًا. */
export const VODAFONE_CASH_NUMBER = "01044137287";
/** الحد الأدنى للإيداع بالجنيه (القيمة الرسمية تأتي من إعدادات التسعير). */
export const DEFAULT_MIN_DEPOSIT = 200;

export type PaymentRequestStatus = "pending" | "approved" | "rejected";

export type MyPaymentRequest = {
  id: string;
  status: PaymentRequestStatus;
  amount: number;
  createdAt: string;
  reviewedAt: string | null;
  note: string | null;
};

export type WalletState = {
  balanceEgp: number;
  heldEgp: number;
  availableEgp: number;
  minDepositEgp: number;
  isAdmin: boolean;
  latestRequest: MyPaymentRequest | null;
  hasPendingRequest: boolean;
};

function toStatus(value: unknown): PaymentRequestStatus {
  return value === "approved" || value === "rejected" ? value : "pending";
}

function round2(value: unknown): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** حالة المحفظة المالية للمستخدم الحالي مع آخر طلب شحن. */
export const getWalletState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WalletState> => {
    const { getPricingSettings } = await import("./ai-pricing.server");

    const [accountRes, requestRes, adminRes, settings] = await Promise.all([
      context.supabase
        .from("user_ai_accounts")
        .select("balance_egp, held_egp")
        .eq("user_id", context.userId)
        .single(),
      context.supabase
        .from("payment_requests")
        .select("id, status, amount, created_at, reviewed_at, note")
        .eq("owner_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
      getPricingSettings(),
    ]);

    const account = accountRes.data;
    if (accountRes.error || !account) throw new Error("تعذر تحميل بيانات الرصيد.");

    const balance = round2(account.balance_egp);
    const held = round2(account.held_egp);
    const row = requestRes.data;
    const latestRequest: MyPaymentRequest | null = row
      ? {
          id: String(row.id),
          status: toStatus(row.status),
          amount: round2(row.amount),
          createdAt: String(row.created_at),
          reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
          note: row.note ? String(row.note) : null,
        }
      : null;

    return {
      balanceEgp: balance,
      heldEgp: held,
      availableEgp: Math.max(0, round2(balance - held)),
      minDepositEgp: settings.minDepositEgp,
      isAdmin: adminRes.data === true,
      latestRequest,
      hasPendingRequest: latestRequest?.status === "pending",
    };
  });

/** طلب شحن رصيد: المستخدم يكتب المبلغ الذي حوّله ويرفق صورة التحويل. */
export const createPaymentRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { proofPath: string; amount: number }) => {
    const proofPath = String(input.proofPath || "").trim();
    const amount = Number(input.amount);
    if (!proofPath) throw new Error("ارفع صورة التحويل أولًا.");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("أدخل مبلغ التحويل.");
    return { proofPath, amount: Math.round(amount * 100) / 100 };
  })
  .handler(async ({ context, data }): Promise<{ created: true }> => {
    if (!data.proofPath.startsWith(`${context.userId}/`)) {
      throw new Error("صورة التحويل غير صالحة.");
    }

    const { getPricingSettings } = await import("./ai-pricing.server");
    const { minDepositEgp } = await getPricingSettings();
    if (data.amount < minDepositEgp) {
      throw new Error(`الحد الأدنى للإيداع ${minDepositEgp} جنيه.`);
    }

    const { error } = await context.supabase.from("payment_requests").insert({
      owner_id: context.userId,
      amount: data.amount,
      method: "vodafone_cash",
      proof_path: data.proofPath,
      status: "pending",
    });

    if (error) {
      throw new Error(
        error.code === "23505"
          ? "لديك طلب قيد المراجعة بالفعل."
          : "تعذر إرسال طلب شحن الرصيد.",
      );
    }
    return { created: true };
  });

/* ============================ الأدمن ============================ */

export type AdminPaymentRequest = {
  id: string;
  status: PaymentRequestStatus;
  amount: number;
  createdAt: string;
  reviewedAt: string | null;
  note: string | null;
  userEmail: string;
  userName: string;
  proofUrl: string | null;
};

async function assertAdmin(context: { supabase: { rpc: Function }; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || data !== true) throw new Error("هذه الصفحة متاحة للأدمن فقط.");
}

export const isCurrentUserAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<boolean> => {
    const { data } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    return data === true;
  });

export const listPaymentRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { status?: string } | undefined) => ({
    status:
      input?.status === "approved" || input?.status === "rejected" || input?.status === "pending"
        ? (input.status as PaymentRequestStatus)
        : ("all" as const),
  }))
  .handler(async ({ context, data }): Promise<AdminPaymentRequest[]> => {
    await assertAdmin(context);

    let query = context.supabase
      .from("payment_requests")
      .select("id, owner_id, status, amount, created_at, reviewed_at, note, proof_path")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.status !== "all") query = query.eq("status", data.status);

    const { data: rows, error } = await query;
    if (error) throw new Error("تعذر تحميل طلبات الشحن.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    return await Promise.all(
      (rows ?? []).map(async (row) => {
        const [{ data: signed }, { data: userRes }, { data: profile }] = await Promise.all([
          supabaseAdmin.storage.from("payment-proofs").createSignedUrl(String(row.proof_path), 600),
          supabaseAdmin.auth.admin.getUserById(String(row.owner_id)),
          supabaseAdmin.from("profiles").select("full_name").eq("id", String(row.owner_id)).maybeSingle(),
        ]);

        return {
          id: String(row.id),
          status: toStatus(row.status),
          amount: Number(row.amount) || 0,
          createdAt: String(row.created_at),
          reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
          note: row.note ? String(row.note) : null,
          userEmail: userRes?.user?.email ?? "—",
          userName: profile?.full_name || "—",
          proofUrl: signed?.signedUrl ?? null,
        };
      }),
    );
  });

export const approvePaymentRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => ({ id: String(input.id) }))
  .handler(async ({ context, data }): Promise<{ approved: true }> => {
    // التحقق من صلاحية الأدمن يتم أيضًا داخل دالة قاعدة البيانات.
    const { error } = await context.supabase.rpc("approve_payment_request", {
      _request_id: data.id,
    });
    if (error) {
      throw new Error(
        error.message.includes("REQUEST_NOT_PENDING")
          ? "تمت مراجعة هذا الطلب بالفعل."
          : "تعذر قبول الطلب.",
      );
    }
    return { approved: true };
  });

export const rejectPaymentRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; note?: string }) => ({
    id: String(input.id),
    note: input.note ? String(input.note).slice(0, 300) : null,
  }))
  .handler(async ({ context, data }): Promise<{ rejected: true }> => {
    const { error } = await context.supabase.rpc("reject_payment_request", {
      _request_id: data.id,
      ...(data.note ? { _note: data.note } : {}),
    });
    if (error) {
      throw new Error(
        error.message.includes("REQUEST_NOT_PENDING")
          ? "تمت مراجعة هذا الطلب بالفعل."
          : "تعذر رفض الطلب.",
      );
    }
    return { rejected: true };
  });

// تعيين كلمة مرور جديدة للحساب الإداري المحدد فقط — البريد ثابت في الخادم ولا يأتي من الطلب.
const PASSWORD_RESET_TARGET_EMAIL = "bahthmontagat@gmail.com";

export const setAdminAccountPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { password: string }) => ({ password: String(input.password) }))
  .handler(async ({ context, data }): Promise<{ updated: true; email: string }> => {
    await assertAdmin(context);

    if (data.password.length < 8 || data.password.length > 72) {
      throw new Error("كلمة المرور يجب أن تكون بين 8 و72 حرفًا.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let targetId: string | null = null;
    for (let page = 1; page <= 20 && !targetId; page += 1) {
      const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error("تعذر الوصول إلى حسابات المستخدمين.");
      const match = list.users.find(
        (user) => user.email?.toLowerCase() === PASSWORD_RESET_TARGET_EMAIL,
      );
      if (match) targetId = match.id;
      if (list.users.length < 200) break;
    }

    if (!targetId) {
      throw new Error("الحساب غير موجود في النظام، يجب تسجيله أولًا قبل تعيين كلمة المرور.");
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetId, {
      password: data.password,
    });
    if (updateError) {
      throw new Error(updateError.message || "تعذر تعيين كلمة المرور.");
    }

    return { updated: true, email: PASSWORD_RESET_TARGET_EMAIL };
  });

/* ============================ لوحة الأدمن ============================ */

export type AdminOverviewStats = {
  totalUsers: number;
  /** عدد المستخدمين الذين لديهم رصيد قابل للاستخدام. */
  fundedUsers: number;
  pendingRequests: number;
  approvedRequests: number;
  /** إجمالي الإيداعات المقبولة بالجنيه. */
  totalRevenue: number;
  /** مجموع أرصدة المستخدمين الحالية بالجنيه. */
  totalBalanceEgp: number;
  /** مجموع المبالغ المحجوزة حاليًا بالجنيه. */
  totalHeldEgp: number;
  /** إجمالي خصومات الذكاء الاصطناعي بالجنيه. */
  totalAiChargesEgp: number;
  /** التكلفة الفعلية على كشاف لدى المزوّدين بالدولار. */
  totalProviderCostUsd: number;
};

export const getAdminOverviewStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminOverviewStats> => {
    await assertAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [
      { data: accounts, error: accountsError },
      { data: requests, error: requestsError },
      { data: usage, error: usageError },
    ] = await Promise.all([
      supabaseAdmin.from("user_ai_accounts").select("balance_egp, held_egp"),
      supabaseAdmin.from("payment_requests").select("status, amount"),
      supabaseAdmin.from("ai_usage_events").select("charged_egp, provider_cost_usd"),
    ]);

    if (accountsError) throw new Error("تعذر تحميل بيانات الحسابات.");
    if (requestsError) throw new Error("تعذر تحميل طلبات الدفع.");
    if (usageError) throw new Error("تعذر تحميل استخدام الذكاء الاصطناعي.");

    // عدّ المستخدمين فعليًا: listUsers لا يعيد إجماليًا موثوقًا، لذا نمرّ على الصفحات.
    let totalUsers = 0;
    for (let page = 1; page <= 20; page += 1) {
      const { data: batch, error: usersError } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (usersError) throw new Error("تعذر تحميل عدد المستخدمين.");
      const count = batch?.users?.length ?? 0;
      totalUsers += count;
      if (count < 200) break;
    }

    const rows = accounts ?? [];
    const totalBalance = rows.reduce((sum, a) => sum + (Number(a.balance_egp) || 0), 0);
    const totalHeld = rows.reduce((sum, a) => sum + (Number(a.held_egp) || 0), 0);
    const fundedUsers = rows.filter(
      (a) => (Number(a.balance_egp) || 0) - (Number(a.held_egp) || 0) > 0,
    ).length;

    const reqRows = requests ?? [];
    const revenue = reqRows
      .filter((r) => r.status === "approved")
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

    const usageRows = usage ?? [];

    return {
      totalUsers,
      fundedUsers,
      pendingRequests: reqRows.filter((r) => r.status === "pending").length,
      approvedRequests: reqRows.filter((r) => r.status === "approved").length,
      totalRevenue: round2(revenue),
      totalBalanceEgp: round2(totalBalance),
      totalHeldEgp: round2(totalHeld),
      totalAiChargesEgp: round2(
        usageRows.reduce((sum, r) => sum + (Number(r.charged_egp) || 0), 0),
      ),
      totalProviderCostUsd:
        Math.round(usageRows.reduce((sum, r) => sum + (Number(r.provider_cost_usd) || 0), 0) * 1e6) /
        1e6,
    };
  });

export type AdminAccount = {
  id: string;
  email: string;
  fullName: string;
  /** الرصيد المالي بالجنيه. */
  balanceEgp: number;
  /** المبلغ المحجوز حاليًا بالجنيه. */
  heldEgp: number;
  /** الرصيد المتاح للاستخدام بالجنيه. */
  availableEgp: number;
  /** إجمالي ما خُصم من هذا الحساب مقابل عمليات الذكاء الاصطناعي. */
  spentEgp: number;
  isAdmin: boolean;
  createdAt: string;
};

export const listAdminAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { search?: string; page?: number } | undefined) => ({
    search: String(input?.search || "").trim().toLowerCase(),
    page: Math.max(1, Math.floor(Number(input?.page) || 1)),
  }))
  .handler(async ({ context, data }): Promise<{ accounts: AdminAccount[]; total: number }> => {
    await assertAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const pageSize = 50;
    const { data: accounts, error: accountsError } = await supabaseAdmin
      .from("user_ai_accounts")
      .select("user_id, balance_egp, held_egp, created_at")
      .order("created_at", { ascending: false });

    if (accountsError) throw new Error("تعذر تحميل الحسابات.");

    const { data: roles, error: rolesError } = await supabaseAdmin.from("user_roles").select("user_id, role");
    if (rolesError) throw new Error("تعذر تحميل الأدوار.");

    const { data: charges } = await supabaseAdmin
      .from("wallet_ledger")
      .select("owner_id, amount_egp")
      .eq("kind", "ai_charge");

    const spentByOwner = new Map<string, number>();
    for (const row of charges ?? []) {
      const key = String(row.owner_id);
      spentByOwner.set(key, (spentByOwner.get(key) ?? 0) + Math.abs(Number(row.amount_egp) || 0));
    }

    const adminIds = new Set((roles ?? []).filter((r) => r.role === "admin").map((r) => String(r.user_id)));

    const enriched: AdminAccount[] = [];
    for (const row of accounts ?? []) {
      const { data: user } = await supabaseAdmin.auth.admin.getUserById(String(row.user_id));
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", String(row.user_id))
        .maybeSingle();

      const email = user?.user?.email ?? "—";
      const fullName = profile?.full_name ?? "—";

      if (data.search && !email.toLowerCase().includes(data.search) && !fullName.toLowerCase().includes(data.search)) {
        continue;
      }

      const balance = round2(row.balance_egp);
      const held = round2(row.held_egp);

      enriched.push({
        id: String(row.user_id),
        email,
        fullName,
        balanceEgp: balance,
        heldEgp: held,
        availableEgp: Math.max(0, round2(balance - held)),
        spentEgp: round2(spentByOwner.get(String(row.user_id)) ?? 0),
        isAdmin: adminIds.has(String(row.user_id)),
        createdAt: String(row.created_at),
      });
    }

    const total = enriched.length;
    const start = (data.page - 1) * pageSize;
    return { accounts: enriched.slice(start, start + pageSize), total };
  });

export const toggleAdminRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; isAdmin: boolean }) => ({
    userId: String(input.userId),
    isAdmin: Boolean(input.isAdmin),
  }))
  .handler(async ({ context, data }): Promise<{ isAdmin: boolean }> => {
    await assertAdmin(context);

    if (data.userId === context.userId && !data.isAdmin) {
      throw new Error("لا يمكنك سحب صلاحية الأدمن عن نفسك.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.isAdmin) {
      const { error } = await supabaseAdmin.from("user_roles").insert({ user_id: data.userId, role: "admin" });
      if (error && error.code !== "23505") throw new Error("تعذر منح صلاحية الأدمن.");
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", "admin");
      if (error) throw new Error("تعذر سحب صلاحية الأدمن.");
    }

    return { isAdmin: data.isAdmin };
  });

export type PaymentNumber = {
  id: string;
  provider: string;
  label: string;
  number: string;
  isActive: boolean;
  sortOrder: number;
};

export const listPaymentNumbers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaymentNumber[]> => {
    await assertAdmin(context);

    const { data, error } = await context.supabase
      .from("payment_numbers")
      .select("id, provider, label, number, is_active, sort_order")
      .order("sort_order", { ascending: true });

    if (error) throw new Error("تعذر تحميل أرقام التحويل.");

    return (data ?? []).map((row) => ({
      id: String(row.id),
      provider: row.provider,
      label: row.label,
      number: row.number,
      isActive: row.is_active,
      sortOrder: row.sort_order,
    }));
  });

export const upsertPaymentNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string; provider: string; label: string; number: string; isActive: boolean; sortOrder?: number }) => {
    const provider = String(input.provider || "vodafone_cash").trim();
    const label = String(input.label || "").trim();
    const number = String(input.number || "").trim();
    if (!label) throw new Error("أدخل اسم الظاهر للرقم.");
    if (!number) throw new Error("أدخل الرقم.");
    if (number.length < 8) throw new Error("الرقم قصير جدًا.");
    return {
      id: input.id ? String(input.id) : undefined,
      provider,
      label,
      number,
      isActive: Boolean(input.isActive),
      sortOrder: Math.max(0, Math.floor(Number(input.sortOrder) || 0)),
    };
  })
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    await assertAdmin(context);

    const payload = {
      provider: data.provider,
      label: data.label,
      number: data.number,
      is_active: data.isActive,
      sort_order: data.sortOrder,
    };

    if (data.id) {
      const { error } = await context.supabase.from("payment_numbers").update(payload).eq("id", data.id);
      if (error) throw new Error("تعذر تحديث الرقم.");
      return { id: data.id };
    }

    const { data: inserted, error } = await context.supabase.from("payment_numbers").insert(payload).select("id").single();
    if (error || !inserted) throw new Error("تعذر إضافة الرقم.");
    return { id: String(inserted.id) };
  });

export const deletePaymentNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => ({ id: String(input.id) }))
  .handler(async ({ context, data }): Promise<{ deleted: true }> => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("payment_numbers").delete().eq("id", data.id);
    if (error) throw new Error("تعذر حذف الرقم.");
    return { deleted: true };
  });

export const getPublicPaymentNumbers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaymentNumber[]> => {
    const { data, error } = await context.supabase
      .from("payment_numbers")
      .select("id, provider, label, number, is_active, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) throw new Error("تعذر تحميل أرقام التحويل.");

    return (data ?? []).map((row) => ({
      id: String(row.id),
      provider: row.provider,
      label: row.label,
      number: row.number,
      isActive: row.is_active,
      sortOrder: row.sort_order,
    }));
  });

export type FinancialSummary = {
  totalRevenue: number;
  pendingRevenue: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;
  monthly: { month: string; revenue: number; count: number }[];
};

export const getFinancialSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FinancialSummary> => {
    await assertAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("payment_requests")
      .select("status, amount, created_at")
      .order("created_at", { ascending: false });

    if (error) throw new Error("تعذر تحميل الملخص المالي.");

    const approved = (rows ?? []).filter((r) => r.status === "approved");
    const pending = (rows ?? []).filter((r) => r.status === "pending");
    const rejected = (rows ?? []).filter((r) => r.status === "rejected");

    const monthlyMap = new Map<string, { revenue: number; count: number }>();
    for (const r of approved) {
      const key = new Date(r.created_at).toISOString().slice(0, 7);
      const entry = monthlyMap.get(key) ?? { revenue: 0, count: 0 };
      entry.revenue += Number(r.amount) || 0;
      entry.count += 1;
      monthlyMap.set(key, entry);
    }

    const monthly = Array.from(monthlyMap.entries())
      .map(([month, { revenue, count }]) => ({ month, revenue, count }))
      .sort((a, b) => b.month.localeCompare(a.month));

    return {
      totalRevenue: approved.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
      pendingRevenue: pending.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
      approvedCount: approved.length,
      rejectedCount: rejected.length,
      pendingCount: pending.length,
      monthly,
    };
  });

