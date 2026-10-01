import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { saveProjectSourceSettings, syncProjectSourceNow } from "@/lib/project-source-settings.functions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerFn } from "@tanstack/react-start";
import { getProjectSourceInfo } from "@/lib/project-source.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, Github, FolderGit2, RefreshCw } from "lucide-react";

const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("ar-EG") : "—");

function Row({ label, value, href }: { label: string; value: string | null | undefined; href?: string | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      {href && value ? (
        <a href={href} target="_blank" rel="noreferrer" className="font-mono text-primary underline-offset-2 hover:underline" dir="ltr">
          {value}
        </a>
      ) : (
        <span className="font-mono" dir="ltr">{value || "—"}</span>
      )}
    </div>
  );
}

export function ProjectSourcePanel() {
  const fetchInfo = useServerFn(getProjectSourceInfo);
  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: ["project-source-info"],
    queryFn: () => fetchInfo(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const qc = useQueryClient();
  const syncFn = useServerFn(syncProjectSourceNow);
  const sync = useMutation({
    mutationFn: () => syncFn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-source-info"] }),
  });
  const synced = useRef(false);
  useEffect(() => {
    if (!synced.current && data?.hasToken && data.github.repoFullName) {
      synced.current = true;
      sync.mutate();
    }
  }, [data?.hasToken, data?.github.repoFullName]);

  if (isPending) return <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>;
  if (error || !data) return <p className="text-sm text-destructive">تعذّر تحميل بيانات المشروع.</p>;

  const g = data.github;
  const b = data.build;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>تتحدث تلقائيًا كل دقيقة — آخر فحص: {fmt(data.checkedAt)}</span>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`ml-1 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> تحديث
        </Button>
        <Button size="sm" variant="outline" onClick={() => sync.mutate(undefined, { onSuccess: () => toast.success("تمت المزامنة مع GitHub") })} disabled={sync.isPending || !data.hasToken}>
          <Github className="ml-1 h-3.5 w-3.5" /> مزامنة الآن
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Database className="h-4 w-4" /> قاعدة البيانات</CardTitle>
            <CardDescription>تُقرأ من إعدادات الخادم الحالية مباشرة.</CardDescription>
          </CardHeader>
          <CardContent>
            <Row label="الاسم" value={data.names.db} />
            <Row label="معرّف المشروع (Ref)" value={data.database.ref} href={data.database.dashboardUrl} />
            <Row label="العنوان" value={data.database.host} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Github className="h-4 w-4" /> مستودع GitHub</CardTitle>
            <CardDescription>
              {g.repoFullName ? `آخر تحديث من GitHub: ${fmt(g.updatedAt)}` : "لم يصل أي إشعار من GitHub بعد."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.lastSyncError && <p className="mb-2 text-xs text-destructive">آخر خطأ مزامنة: {data.lastSyncError}</p>}
            <Row label="ربط الإشعارات" value={data.webhookConfigured ? "مفعّل" : "غير مفعّل"} />
            <Row label="المستودع" value={g.repoFullName} href={g.repoUrl} />
            <Row label="المالك" value={g.owner} />
            <Row label="الفرع" value={g.lastBranch ?? g.defaultBranch} />
            <Row label="آخر إصدار (commit)" value={g.lastCommitSha?.slice(0, 7)} href={g.repoUrl && g.lastCommitSha ? `${g.repoUrl}/commit/${g.lastCommitSha}` : null} />
            <Row label="وقت آخر إصدار" value={fmt(g.lastCommitAt)} />
            {g.lastCommitMessage && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{g.lastCommitMessage}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><FolderGit2 className="h-4 w-4" /> المشروع والإصدار المنشور</CardTitle>
            <CardDescription>يُسجَّل تلقائيًا مع كل نشر.</CardDescription>
          </CardHeader>
          <CardContent>
            <Row label="اسم المشروع" value={data.names.project} />
            <Row label="معرّف مشروع Lovable" value={b.lovableProjectId} href={b.lovableProjectId ? `https://lovable.dev/projects/${b.lovableProjectId}` : null} />
            <Row label="رقم الإصدار" value={b.commitCount ? `v${b.commitCount}` : null} />
            <Row label="كود الإصدار" value={b.commitSha?.slice(0, 7)} />
            <Row label="تاريخ الإصدار" value={fmt(b.commitDate)} />
            <Row label="وقت البناء" value={fmt(b.builtAt)} />
          </CardContent>
        </Card>
      </div>
      <SettingsForm names={data.names} repo={g.repoFullName} hasToken={data.hasToken} />
    </div>
  );
}

function SettingsForm({ names, repo, hasToken }: { names: { db: string | null; project: string | null }; repo: string | null; hasToken: boolean }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveProjectSourceSettings);
  const [dbName, setDbName] = useState(names.db ?? "");
  const [projectName, setProjectName] = useState(names.project ?? "");
  const [repoIn, setRepoIn] = useState(repo ?? "");
  const [token, setToken] = useState("");
  const save = useMutation({
    mutationFn: () => saveFn({ data: { dbName, projectName, repo: repoIn, token } }),
    onSuccess: (r) => {
      setToken("");
      qc.invalidateQueries({ queryKey: ["project-source-info"] });
      if (r.webhook === "failed") toast.warning("تم الحفظ، لكن تعذّر إضافة الربط على GitHub. تأكد أن الرمز يملك صلاحية إدارة Webhooks.");
      else toast.success(r.webhook === "skipped" ? "تم حفظ الأسماء" : "تم الحفظ وربط GitHub تلقائيًا");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">إعدادات المكان والربط</CardTitle>
        <CardDescription>اكتب الأسماء والمستودع ورمز GitHub، وسيتم إنشاء الربط تلقائيًا دون فتح GitHub.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="space-y-1"><Label>اسم قاعدة البيانات</Label><Input value={dbName} onChange={(e) => setDbName(e.target.value)} placeholder="bahthmontagat-hash's Project" /></div>
          <div className="space-y-1"><Label>اسم المشروع</Label><Input value={projectName} onChange={(e) => setProjectName(e.target.value)} /></div>
          <div className="space-y-1"><Label>المستودع (owner/name)</Label><Input dir="ltr" value={repoIn} onChange={(e) => setRepoIn(e.target.value)} placeholder="owner/repo" /></div>
          <div className="space-y-1">
            <Label>رمز GitHub {hasToken && <span className="text-xs text-muted-foreground">(محفوظ — اتركه فارغًا للإبقاء عليه)</span>}</Label>
            <Input dir="ltr" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_... / github_pat_..." />
          </div>
          <div className="md:col-span-2"><Button type="submit" disabled={save.isPending}>{save.isPending ? "جارٍ الحفظ..." : "حفظ وربط"}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}
