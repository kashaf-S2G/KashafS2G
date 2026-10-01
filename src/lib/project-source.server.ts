/** مزامنة بيانات مستودع GitHub — ملف خادم فقط. لا تُعاد أي قيمة سرية للمتصفح. */
import { getExternalSecret } from "./secrets.server";

const gh = async (token: string, path: string, init?: RequestInit) => {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "kashaf-admin",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${json?.message ?? "خطأ غير معروف"}`);
  return json;
};

export { gh };

/** يقرأ المستودع وآخر إصدار من GitHub مباشرة ويحفظها (يتبع إعادة التسمية والنقل تلقائيًا). */
export async function syncRepoFromGithub(repoFullName?: string | null): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const token = await getExternalSecret("GITHUB_TOKEN");
  const { data: cur } = await supabaseAdmin.from("project_source_info").select("*").eq("id", true).maybeSingle();
  const name = repoFullName ?? cur?.repo_full_name;
  if (!token || !name) return;
  try {
    const repo = await gh(token, `/repos/${name}`);
    const commits = await gh(token, `/repos/${repo.full_name}/commits?per_page=1&sha=${repo.default_branch}`);
    const c = commits?.[0];
    await supabaseAdmin.from("project_source_info").upsert({
      id: true,
      repo_full_name: repo.full_name,
      repo_url: repo.html_url,
      repo_owner: repo.owner?.login ?? null,
      default_branch: repo.default_branch,
      last_branch: repo.default_branch,
      last_commit_sha: c?.sha ?? null,
      last_commit_message: c?.commit?.message ? String(c.commit.message).slice(0, 500) : null,
      last_commit_at: c?.commit?.committer?.date ?? null,
      last_pusher: c?.commit?.author?.name ?? null,
      last_event: "sync",
      last_sync_error: null,
      updated_at: new Date().toISOString(),
    } as any);
  } catch (e) {
    await supabaseAdmin
      .from("project_source_info")
      .upsert({ id: true, last_sync_error: (e as Error).message.slice(0, 300), updated_at: new Date().toISOString() } as any);
  }
}
