import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * واجهة إدارية لحالة الأسرار الخارجية ونقلها إلى خزانة Supabase.
 *
 * لا تُعاد أي قيمة سرية إلى المتصفح، ولا تُسجَّل في أي log.
 * تستخدم نفس دوال الخزانة الموجودة (vault_has_secret / vault_set_secret)
 * ونفس طبقة القراءة الموحّدة في secrets.server.ts.
 */

export type SecretLocation = "environment" | "vault" | "both" | "missing";

export type SecretStatus = {
  name: string;
  service: string;
  purpose: string;
  transferable: boolean;
  required: boolean;
  inEnvironment: boolean;
  inVault: boolean;
  location: SecretLocation;
  /** هل يمكن نقل قيمته الحالية من البيئة إلى الخزانة؟ */
  vaultEligible: boolean;
};

async function assertAdmin(context: { supabase: { rpc: Function }; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || data !== true) throw new Error("هذه الصفحة متاحة للأدمن فقط.");
}

function locationOf(inEnv: boolean, inVault: boolean): SecretLocation {
  if (inEnv && inVault) return "both";
  if (inEnv) return "environment";
  if (inVault) return "vault";
  return "missing";
}

/** حالة كل سر خارجي بدون كشف أي قيمة (أدمن فقط). */
export const getSecretsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ secrets: SecretStatus[]; checkedAt: string }> => {
    await assertAdmin(context);

    const { SECRET_REGISTRY } = await import("./runtime-config.server");
    const { VAULT_SECRET_NAMES } = await import("./secrets.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const vaultNames = new Set<string>(VAULT_SECRET_NAMES as readonly string[]);

    const secrets = await Promise.all(
      SECRET_REGISTRY.map(async (spec) => {
        const raw = process.env[spec.name];
        const inEnvironment = Boolean(raw && raw.trim().length > 0);
        let inVault = false;
        if (vaultNames.has(spec.name)) {
          const { data } = await supabaseAdmin.rpc("vault_has_secret", { _name: spec.name });
          inVault = data === true;
        }
        return {
          name: spec.name,
          service: spec.service,
          purpose: spec.purpose,
          transferable: spec.transferable,
          required: spec.required,
          inEnvironment,
          inVault,
          location: locationOf(inEnvironment, inVault),
          vaultEligible: vaultNames.has(spec.name),
        } satisfies SecretStatus;
      }),
    );

    return { secrets, checkedAt: new Date().toISOString() };
  });

/**
 * نقل قيم الأسرار الخارجية الموجودة في بيئة المشروع إلى خزانة Supabase (أدمن فقط).
 * القراءة والكتابة تحدثان على الخادم فقط، ولا تعود أي قيمة إلى الواجهة.
 */
export const migrateSecretsToVault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ results: { name: string; status: "stored" | "skipped" | "failed"; message: string }[] }> => {
      await assertAdmin(context);

      const { VAULT_SECRET_NAMES, clearSecretCache } = await import("./secrets.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const results: { name: string; status: "stored" | "skipped" | "failed"; message: string }[] = [];

      for (const name of VAULT_SECRET_NAMES) {
        const raw = process.env[name] ?? (name === "OPENAI_ADMIN_API_KEY" ? process.env["OPENAI_ADMIN_KEY"] : undefined);
        const value = raw && raw.trim().length > 0 ? raw.trim() : undefined;

        if (!value) {
          results.push({
            name,
            status: "skipped",
            message: "لا توجد قيمة في بيئة المشروع، لذلك لم يتغيّر شيء في الخزانة.",
          });
          continue;
        }

        const { error } = await supabaseAdmin.rpc("vault_set_secret", { _name: name, _value: value });
        if (error) {
          results.push({ name, status: "failed", message: "تعذر الحفظ في الخزانة." });
          continue;
        }

        clearSecretCache(name);
        results.push({ name, status: "stored", message: "تم حفظ القيمة الحالية في الخزانة." });
      }

      return { results };
    },
  );

/**
 * حفظ قيمة مفتاح خارجي مباشرة في الخزانة (أدمن فقط).
 * يُستخدم فقط عندما لا توجد القيمة في بيئة المشروع الحالية (مثل بعد نقل المشروع).
 * القيمة لا تُعاد أبدًا ولا تُسجَّل في أي log.
 */
export const storeSecretInVault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string; value: string }) => {
    const name = String(input?.name ?? "");
    const value = String(input?.value ?? "").trim();
    if (!name) throw new Error("اسم المفتاح مطلوب.");
    if (value.length < 20) throw new Error("القيمة المُدخلة قصيرة جدًا ولا تشبه مفتاحًا صالحًا.");
    return { name, value };
  })
  .handler(async ({ context, data }): Promise<{ stored: true }> => {
    await assertAdmin(context);

    const { VAULT_SECRET_NAMES, clearSecretCache } = await import("./secrets.server");
    if (!(VAULT_SECRET_NAMES as readonly string[]).includes(data.name)) {
      throw new Error("هذا المفتاح غير مسموح بحفظه في الخزانة.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("vault_set_secret", { _name: data.name, _value: data.value });
    if (error) throw new Error("تعذر الحفظ في الخزانة.");

    clearSecretCache(data.name);
    return { stored: true };
  });
