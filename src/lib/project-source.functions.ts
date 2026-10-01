import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BUILD_INFO } from "./build-info";

export type ProjectSourceInfo = {
  database: { ref: string | null; host: string | null; dashboardUrl: string | null; postgresVersion: string | null };
  github: {
    repoFullName: string | null;
    repoUrl: string | null;
    owner: string | null;
    defaultBranch: string | null;
    lastBranch: string | null;
    lastCommitSha: string | null;
    lastCommitMessage: string | null;
    lastCommitAt: string | null;
    lastPusher: string | null;
    pushCount: number;
    updatedAt: string | null;
  };
  build: typeof BUILD_INFO;
  names: { db: string | null; project: string | null };
  hasToken: boolean;
  lastSyncError: string | null;
  webhookConfigured: boolean;
  checkedAt: string;
};

/** بيانات مكان المشروع والإصدار — تُقرأ حيًّا في كل طلب (أدمن فقط). */
export const getProjectSourceInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProjectSourceInfo> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (isAdmin !== true) throw new Error("هذه البيانات متاحة للأدمن فقط.");
    const { getExternalSecret } = await import("./secrets.server");

    const url = process.env["SUPABASE_URL"] ?? "";
    let host: string | null = null;
    try {
      host = url ? new URL(url).host : null;
    } catch {
      host = null;
    }
    const ref = host?.endsWith(".supabase.co") ? (host.split(".")[0] ?? null) : null;

    const { data: gh } = await context.supabase
      .from("project_source_info")
      .select("*")
      .eq("id", true)
      .maybeSingle();

    return {
      database: {
        ref,
        host,
        dashboardUrl: ref ? `https://supabase.com/dashboard/project/${ref}` : null,
        postgresVersion: null,
      },
      github: {
        repoFullName: gh?.repo_full_name ?? null,
        repoUrl: gh?.repo_url ?? null,
        owner: gh?.repo_owner ?? null,
        defaultBranch: gh?.default_branch ?? null,
        lastBranch: gh?.last_branch ?? null,
        lastCommitSha: gh?.last_commit_sha ?? null,
        lastCommitMessage: gh?.last_commit_message ?? null,
        lastCommitAt: gh?.last_commit_at ?? null,
        lastPusher: gh?.last_pusher ?? null,
        pushCount: gh?.push_count ?? 0,
        updatedAt: gh?.updated_at ?? null,
      },
      build: BUILD_INFO,
      names: { db: (gh as any)?.db_display_name ?? null, project: (gh as any)?.project_display_name ?? null },
      hasToken: Boolean(await getExternalSecret("GITHUB_TOKEN")),
      lastSyncError: (gh as any)?.last_sync_error ?? null,
      webhookConfigured: Boolean(await getExternalSecret("GITHUB_WEBHOOK_SECRET")),
      checkedAt: new Date().toISOString(),
    };
  });
