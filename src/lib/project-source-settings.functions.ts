import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BUILD_INFO } from "./build-info";

async function assertAdmin(context: { supabase: { rpc: Function }; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (data !== true) throw new Error("متاح للأدمن فقط.");
}

/** حفظ إعدادات المكان من الواجهة: الأسماء الظاهرة + ربط GitHub تلقائيًا (أدمن فقط). */
export const saveProjectSourceSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { dbName?: string; projectName?: string; repo?: string; token?: string }) => ({
    dbName: String(i?.dbName ?? "").trim().slice(0, 120),
    projectName: String(i?.projectName ?? "").trim().slice(0, 120),
    repo: String(i?.repo ?? "")
      .trim()
      .replace(/^https?:\/\/github\.com\//, "")
      .replace(/\.git$/, "")
      .replace(/\/$/, ""),
    token: String(i?.token ?? "").trim(),
  }))
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getExternalSecret, clearSecretCache } = await import("./secrets.server");
    const { gh, syncRepoFromGithub } = await import("./project-source.server");

    await supabaseAdmin.from("project_source_info").upsert({
      id: true,
      db_display_name: data.dbName || null,
      project_display_name: data.projectName || null,
      updated_at: new Date().toISOString(),
    } as any);

    if (data.token) {
      if (data.token.length < 20) throw new Error("رمز GitHub غير صالح.");
      const { error } = await supabaseAdmin.rpc("vault_set_secret", { _name: "GITHUB_TOKEN", _value: data.token });
      if (error) throw new Error("تعذر حفظ رمز GitHub.");
      clearSecretCache("GITHUB_TOKEN");
    }

    if (!data.repo) return { ok: true, webhook: "skipped" as const };
    if (!/^[\w.-]+\/[\w.-]+$/.test(data.repo)) throw new Error("اكتب المستودع بصيغة owner/name.");

    const token = await getExternalSecret("GITHUB_TOKEN");
    if (!token) throw new Error("أدخل رمز GitHub أولًا.");

    // التحقق من المستودع (يتبع النقل/إعادة التسمية)
    const repo = await gh(token, `/repos/${data.repo}`);

    // كلمة سر webhook تُنشأ تلقائيًا وتُحفظ في الخزانة
    let secret = await getExternalSecret("GITHUB_WEBHOOK_SECRET");
    if (!secret) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      secret = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      await supabaseAdmin.rpc("vault_set_secret", { _name: "GITHUB_WEBHOOK_SECRET", _value: secret });
      clearSecretCache("GITHUB_WEBHOOK_SECRET");
    }

    const hookUrl = `https://project--${BUILD_INFO.lovableProjectId ?? "26c9e961-61f2-44fd-a3b4-95fc02e17c12"}.lovable.app/api/public/github/webhook`;
    let webhook: "created" | "updated" | "failed" = "failed";
    try {
      const hooks: any[] = await gh(token, `/repos/${repo.full_name}/hooks`);
      const existing = hooks.find((h) => h?.config?.url === hookUrl);
      const body = JSON.stringify({
        active: true,
        events: ["push", "repository"],
        config: { url: hookUrl, content_type: "json", secret, insecure_ssl: "0" },
      });
      if (existing) {
        await gh(token, `/repos/${repo.full_name}/hooks/${existing.id}`, { method: "PATCH", body });
        webhook = "updated";
      } else {
        const h = await gh(token, `/repos/${repo.full_name}/hooks`, { method: "POST", body: JSON.stringify({ name: "web", ...JSON.parse(body) }) });
        await supabaseAdmin.from("project_source_info").upsert({ id: true, webhook_id: h?.id ?? null } as any);
        webhook = "created";
      }
    } catch {
      webhook = "failed";
    }

    await syncRepoFromGithub(repo.full_name);
    return { ok: true, webhook };
  });

/** مزامنة فورية من GitHub (أدمن فقط). */
export const syncProjectSourceNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { syncRepoFromGithub } = await import("./project-source.server");
    await syncRepoFromGithub();
    return { ok: true };
  });
