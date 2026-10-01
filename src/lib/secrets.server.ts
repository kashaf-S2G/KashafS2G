/**
 * مصدر موحّد للأسرار الخارجية — ملف خادم فقط.
 *
 * ترتيب القراءة:
 * 1) متغيرات بيئة المشروع الحالي (خزانة المنصة) إن وُجدت.
 * 2) خزانة Supabase المشفّرة (Vault) عبر دالة محمية لا يستدعيها إلا مفتاح الخادم.
 *
 * بهذا الترتيب ينتقل المشروع بين حسابات Lovable مع بقاء نفس المفاتيح فعّالة،
 * طالما بقي مشروع Supabase نفسه. لا تُعاد أي قيمة سرية إلى المتصفح أبدًا.
 */

/** أسماء الأسرار الخارجية المسموح تخزينها في الخزانة. */
export const VAULT_SECRET_NAMES = ["OPENAI_API_KEY", "OPENAI_ADMIN_API_KEY"] as const;
export type VaultSecretName = (typeof VAULT_SECRET_NAMES)[number];

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: string | undefined; at: number }>();

function fromEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

async function fromVault(name: string): Promise<string | undefined> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("vault_get_secret", { _name: name });
    if (error) {
      console.error(`[secrets] تعذر قراءة ${name} من الخزانة.`);
      return undefined;
    }
    const value = typeof data === "string" ? data.trim() : "";
    return value.length > 0 ? value : undefined;
  } catch {
    console.error(`[secrets] تعذر الاتصال بخزانة الأسرار لقراءة ${name}.`);
    return undefined;
  }
}

/** يقرأ سرًا خارجيًا: بيئة المشروع أولًا ثم خزانة Supabase. */
export async function getExternalSecret(name: string): Promise<string | undefined> {
  const env = fromEnv(name);
  if (env) return env;

  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const value = await fromVault(name);
  cache.set(name, { value, at: Date.now() });
  return value;
}

/** يمسح ذاكرة التخزين المؤقت بعد تحديث سر في الخزانة. */
export function clearSecretCache(name?: string): void {
  if (name) cache.delete(name);
  else cache.clear();
}

/** مفتاح تشغيل OpenAI. */
export function openAiKey(): Promise<string | undefined> {
  return getExternalSecret("OPENAI_API_KEY");
}

/** مفتاح إدارة OpenAI (قراءة التكاليف فقط). */
export async function openAiAdminKeyAsync(): Promise<string | undefined> {
  return (
    (await getExternalSecret("OPENAI_ADMIN_API_KEY")) ?? (await getExternalSecret("OPENAI_ADMIN_KEY"))
  );
}
