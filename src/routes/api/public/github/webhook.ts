import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * GitHub webhook: يحدّث اسم المستودع وآخر إصدار تلقائيًا عند كل push
 * (وعند نقل/إعادة تسمية المستودع أو ربط مستودع جديد بنفس الـ webhook).
 */
export const Route = createFileRoute("/api/public/github/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getExternalSecret } = await import("@/lib/secrets.server");
        const secret = await getExternalSecret("GITHUB_WEBHOOK_SECRET");
        if (!secret) return new Response("Not configured", { status: 500 });

        const body = await request.text();
        const sig = request.headers.get("x-hub-signature-256") ?? "";
        const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("Invalid signature", { status: 401 });
        }

        const event = request.headers.get("x-github-event") ?? "unknown";
        let payload: any;
        try {
          payload = JSON.parse(body);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        const repo = payload?.repository;
        if (!repo?.full_name) return new Response("ignored");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: current } = await supabaseAdmin
          .from("project_source_info")
          .select("push_count")
          .eq("id", true)
          .maybeSingle();

        const row: any = {
          id: true,
          repo_full_name: String(repo.full_name),
          repo_url: repo.html_url ?? null,
          repo_owner: repo.owner?.login ?? null,
          default_branch: repo.default_branch ?? null,
          last_event: event,
          updated_at: new Date().toISOString(),
        };
        if (event === "push") {
          const head = payload.head_commit;
          row.last_branch = String(payload.ref ?? "").replace("refs/heads/", "") || null;
          row.last_commit_sha = head?.id ?? payload.after ?? null;
          row.last_commit_message = head?.message ? String(head.message).slice(0, 500) : null;
          row.last_commit_at = head?.timestamp ?? null;
          row.last_pusher = payload.pusher?.name ?? null;
          row.push_count = (current?.push_count ?? 0) + 1;
        }

        const { error } = await supabaseAdmin.from("project_source_info").upsert(row as any);
        if (error) {
          console.error("github webhook upsert failed", error.message);
          return new Response("DB error", { status: 500 });
        }
        return new Response("ok");
      },
    },
  },
});
