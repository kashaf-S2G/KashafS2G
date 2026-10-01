/**
 * لوحة زحف الفئات — نفس شكل ومنطق لوحة زحف المنتجات،
 * لكن الصفحة تُقبل إذا تخطّت نسبة تطابقها مع الفئات المحددة 70%.
 */
import { type ReactNode, useCallback, useState } from "react";
import { CheckCircle2, ChevronDown, ExternalLink, Loader2, Play, ThumbsDown, ThumbsUp, Trash2, XCircle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { approveDiscoveredPage, rejectDiscoveredPage } from "@/lib/pcrawl.functions";
import { deleteCcrawlKeys, deleteCcrawlPages, listCcrawlKeys, listCcrawlPages } from "@/lib/ccrawl.functions";
import { CATEGORY_MATCH_THRESHOLD } from "@/lib/ccrawl.types";
import { LiveJobBar } from "@/components/LiveJobBar";
import { JobControls } from "@/components/JobControls";
import { useServerJob } from "@/lib/use-server-job";
import { cn } from "@/lib/utils";

const PHASE_LABEL: Record<string, string> = {
  idle: "في الانتظار",
  search: "البحث عن إعلانات وصفحات",
  analysis: "تحليل الصفحات ومطابقة الفئات",
  done: "منتهٍ",
};

function Section({ title, count, actions, children }: { title: string; count: number; actions?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center gap-1 pe-2">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" className="h-auto min-w-0 flex-1 justify-between rounded-none px-4 py-3.5 hover:bg-muted/40">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="truncate text-sm font-medium">{title}</span>
              <span className="min-w-6 rounded-full bg-muted px-2 py-0.5 text-center text-xs font-normal text-muted-foreground">{count}</span>
            </span>
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
        {count > 0 && actions}
      </div>
      <CollapsibleContent>
        <div className="border-t px-4 py-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function CategoryCrawlPanel({ selectedIds }: { selectedIds: string[] }) {
  const qc = useQueryClient();
  const keysFn = useServerFn(listCcrawlKeys);
  const pagesFn = useServerFn(listCcrawlPages);
  const deletePagesFn = useServerFn(deleteCcrawlPages);
  const deleteKeysFn = useServerFn(deleteCcrawlKeys);
  const approveFn = useServerFn(approveDiscoveredPage);
  const rejectFn = useServerFn(rejectDiscoveredPage);

  const refreshAll = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["ccrawl-keys"] });
    void qc.invalidateQueries({ queryKey: ["ccrawl-pages"] });
    void qc.invalidateQueries({ queryKey: ["competitors"] });
  }, [qc]);

  const serverJob = useServerJob("cats", {
    onProgress: refreshAll,
    onFinished: (j) => {
      const s = j.cats;
      if (j.control === "cancel") return "أُلغيت الجولة. ما حُفظ قبل الإلغاء يبقى كما هو.";
      const base = s ? `${s.pagesFound} صفحة ظهرت، ${s.matches} صفحة مطابقة للفئات.` : "";
      return j.note ? `${j.note} ${base}` : `انتهت الدورة: ${base}`;
    },
  });
  const job = serverJob.run;
  const p = serverJob.job?.status === "running" ? (serverJob.job.cats ?? null) : null;
  const pausedNote = job.paused ? serverJob.job?.note : null;

  const keys = useQuery({ queryKey: ["ccrawl-keys"], queryFn: () => keysFn(), refetchOnWindowFocus: false });
  const pages = useQuery({ queryKey: ["ccrawl-pages"], queryFn: () => pagesFn(), refetchOnWindowFocus: false });

  const run = (scope: "selected" | "general") =>
    void serverJob.start({ scope, selectedIds: scope === "selected" ? selectedIds : [] });

  const approve = useMutation({
    mutationFn: (id: string) => approveFn({ data: { id } }),
    onSuccess: (res) => {
      toast.success(res.duplicate ? "الصفحة موجودة بالفعل كمنافس." : "تمت الموافقة على الصفحة كمنافس.");
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const reject = useMutation({
    mutationFn: (id: string) => rejectFn({ data: { id } }),
    onSuccess: () => {
      toast.success("تم رفض الصفحة.");
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const delPages = useMutation({
    mutationFn: (input: { ids?: string[]; decision?: "match" | "no_match" }) => deletePagesFn({ data: input }),
    onSuccess: (res) => {
      toast.success(`تم حذف ${res.deleted} نتيجة.`);
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const delKeys = useMutation({
    mutationFn: (input: { ids?: string[]; all?: boolean }) => deleteKeysFn({ data: input }),
    onSuccess: (res) => {
      toast.success(`تم حذف ${res.deleted} مفتاح بحث.`);
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const keyPercent = p && p.keysTotal > 0 ? Math.round((p.keysDone / p.keysTotal) * 100) : 0;
  const rows = pages.data ?? [];
  const proven = rows.filter((m) => m.decision === "match");
  const rejected = rows.filter((m) => m.decision !== "match");

  return (
    <div className="mb-6 space-y-4">
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-medium">زحف الفئات — البحث عن صفحات تعمل في نفس فئاتك</p>
            <p className="text-muted-foreground">
              المسار: الفئات ← اكتشاف الإعلانات ← تحليل الصفحة ← تُقبل إذا تخطّى تطابقها مع الفئات {CATEGORY_MATCH_THRESHOLD}%.
              حدّد فئات من القائمة بالضغط عليها لزحفها وحدها.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={job.active || selectedIds.length === 0} onClick={() => run("selected")}>
              {job.active ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              زحف المحدد ({selectedIds.length})
            </Button>
            <Button size="sm" variant="outline" disabled={job.active} onClick={() => run("general")}>
              زحف عام
            </Button>
            <JobControls job={job} cancelLabel="إلغاء الجولة" />
          </div>
        </div>

        <LiveJobBar sj={serverJob} className="mb-0" />
        {pausedNote && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{pausedNote}</div>
        )}

        {p && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{PHASE_LABEL[p.phase] ?? p.phase}</span>
              {p.currentKey && <span className="text-muted-foreground">مفتاح البحث: {p.currentKey}</span>}
            </div>
            <Progress value={keyPercent} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>فئات مستهدفة: {p.categories.length}</span>
              <span>مفاتيح: {p.keysDone}/{p.keysTotal}</span>
              <span>صفحات ظهرت: {p.pagesFound}</span>
              <span>تم تحليلها: {p.pagesAnalyzed}</span>
              <span>بانتظار التحليل: {p.pagesPending}</span>
              <span>صفحات مطابقة: {p.matches}</span>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2.5">
        <Section
          title="مفاتيح البحث في الدورة الأخيرة"
          count={keys.data?.length ?? 0}
          actions={
            <Button size="sm" variant="ghost" className="shrink-0 text-destructive hover:text-destructive" disabled={delKeys.isPending}
              onClick={() => { if (window.confirm("حذف كل مفاتيح البحث في الدورة الأخيرة؟")) delKeys.mutate({ all: true }); }}>
              <Trash2 className="size-4" />
              حذف الكل
            </Button>
          }
        >
          {(keys.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد مفاتيح بحث من دورة زحف بعد.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(keys.data ?? []).map((k) => (
                <Badge key={k.id} variant={k.status === "searched" ? "secondary" : "outline"} className="gap-1 pe-1">
                  {k.keyText}
                  {k.status === "searched" && <span className="text-[10px] opacity-70">({k.found})</span>}
                  <button type="button" aria-label={`حذف المفتاح ${k.keyText}`} disabled={delKeys.isPending}
                    onClick={() => delKeys.mutate({ ids: [k.id] })}
                    className="rounded-full p-0.5 opacity-70 hover:bg-destructive/15 hover:text-destructive hover:opacity-100">
                    <Trash2 className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </Section>

        <Section
          title="الصفحات المطابقة للفئات"
          count={proven.length}
          actions={
            <Button size="sm" variant="ghost" className="shrink-0 text-destructive hover:text-destructive" disabled={delPages.isPending}
              onClick={() => { if (window.confirm("حذف كل نتائج قسم المطابق؟")) delPages.mutate({ decision: "match" }); }}>
              <Trash2 className="size-4" />
              حذف الكل
            </Button>
          }
        >
          {pages.isLoading ? (
            <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
          ) : proven.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد صفحات مطابقة بعد. ابدأ زحفًا محددًا أو عامًا.</p>
          ) : (
            <div className="grid gap-3">
              {proven.map((m) => (
                <div key={m.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <CheckCircle2 className="size-4 text-primary" />
                    {m.pageUrl ? (
                      <a href={m.pageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline">
                        {m.pageName || m.pageId} <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="font-medium">{m.pageName || m.pageId}</span>
                    )}
                    <Badge variant="secondary">تطابق {Math.round(m.score * 100)}%</Badge>
                    {m.matchedCategories.map((c) => <Badge key={c} variant="outline">{c}</Badge>)}
                    {m.searchKey && <span className="text-xs text-muted-foreground">مفتاح: {m.searchKey}</span>}
                  </div>
                  <div className="mt-2 flex gap-3">
                    {m.imageUrl && (
                      <img src={m.imageUrl} alt={`إعلان من ${m.pageName}`} loading="lazy" className="size-20 shrink-0 rounded-md object-cover" />
                    )}
                    <p className="line-clamp-3 min-w-0 whitespace-pre-line text-xs text-muted-foreground">{m.adsSample[0]}</p>
                  </div>
                  {m.reasons.length > 0 && (
                    <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
                      {m.reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  )}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                    <Badge variant="outline">
                      {m.pageStatus === "approved" ? "منافس معتمد" : m.pageStatus === "rejected" ? "مرفوضة" : m.pageStatus ? "بانتظار الموافقة" : "غير مسجّلة"}
                    </Badge>
                    <div className="flex flex-wrap gap-2">
                      {m.pageRowId && m.pageStatus !== "approved" && (
                        <>
                          <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(m.pageRowId as string)}>
                            <ThumbsUp className="size-4" />
                            موافقة
                          </Button>
                          <Button size="sm" variant="outline" disabled={reject.isPending} onClick={() => reject.mutate(m.pageRowId as string)}>
                            <ThumbsDown className="size-4" />
                            رفض
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={delPages.isPending}
                        onClick={() => delPages.mutate({ ids: [m.id] })}>
                        <Trash2 className="size-4" />
                        حذف النتيجة
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title="الصفحات غير المطابقة"
          count={rejected.length}
          actions={
            <Button size="sm" variant="ghost" className="shrink-0 text-destructive hover:text-destructive" disabled={delPages.isPending}
              onClick={() => { if (window.confirm("حذف كل نتائج قسم غير المطابق؟")) delPages.mutate({ decision: "no_match" }); }}>
              <Trash2 className="size-4" />
              حذف الكل
            </Button>
          }
        >
          {rejected.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد صفحات غير مطابقة.</p>
          ) : (
            <div className="grid gap-2">
              {rejected.slice(0, 30).map((m) => (
                <div key={m.id} className="rounded-md border p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <XCircle className="size-4 text-muted-foreground" />
                    <span className="font-medium">{m.pageName || m.pageId}</span>
                    <span className="text-muted-foreground">تطابق {Math.round(m.score * 100)}%</span>
                    <button type="button" aria-label="حذف هذه النتيجة" disabled={delPages.isPending}
                      onClick={() => delPages.mutate({ ids: [m.id] })}
                      className="ms-auto rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  {m.differences.length > 0 && (
                    <p className="mt-1 text-muted-foreground">أسباب الاختلاف: {m.differences.join(" — ")}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
