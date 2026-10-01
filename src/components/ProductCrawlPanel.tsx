/**
 * لوحة زحف المنتجات — تعكس المنطق الجديد:
 * Product → Ad Discovery → Product Match → Page
 * الإعلان هو الدليل، وصفحة الإعلان المثبت تُصبح مرشحًا منافسًا للمنتج.
 */
import { type ReactNode, useCallback, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Loader2,
  Megaphone,
  Play,
  ThumbsDown,

  ThumbsUp,
  Trash2,
  XCircle,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import {
  approveDiscoveredPage,
  deletePcrawlKeys,
  deletePcrawlMatches,
  listPcrawlKeys,
  listPcrawlMatches,
  pcrawlOverview,
  rejectDiscoveredPage,
  resumePcrawl,
} from "@/lib/pcrawl.functions";

import type { PcrawlProgress } from "@/lib/pcrawl.types";
import { addPcrawlKeys, approvePcrawlKeys } from "@/lib/jobs.functions";
import { Input } from "@/components/ui/input";
import { LiveJobBar } from "@/components/LiveJobBar";
import { JobControls } from "@/components/JobControls";
import { useServerJob } from "@/lib/use-server-job";
import { cn } from "@/lib/utils";

const PHASE_LABEL: Record<string, string> = {
  idle: "في الانتظار",
  profiles: "بناء ملفات بحث المنتجات",
  vocabulary: "بناء مفاتيح البحث",
  review: "بانتظار مراجعتك لمفاتيح البحث",
  search: "البحث عن إعلانات",
  analysis: "تحليل الإعلانات ومطابقة المنتج",
  done: "منتهٍ",
};

function CrawlResultSection({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  count: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-lg border bg-card"
    >
      <div className="flex items-center gap-1 pe-2">
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-auto min-w-0 flex-1 justify-between rounded-none px-4 py-3.5 hover:bg-muted/40"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="truncate text-sm font-medium">{title}</span>
              <span className="min-w-6 rounded-full bg-muted px-2 py-0.5 text-center text-xs font-normal text-muted-foreground">
                {count}
              </span>
            </span>
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
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


export function ProductCrawlPanel({ selectedIds }: { selectedIds: string[] }) {
  const qc = useQueryClient();
  const resume = useServerFn(resumePcrawl);
  const overviewFn = useServerFn(pcrawlOverview);
  const keysFn = useServerFn(listPcrawlKeys);
  const matchesFn = useServerFn(listPcrawlMatches);
  const deleteMatchesFn = useServerFn(deletePcrawlMatches);
  const deleteKeysFn = useServerFn(deletePcrawlKeys);

  const serverJob = useServerJob("products", {
    onProgress: () => {
      void qc.invalidateQueries({ queryKey: ["pcrawl-overview"] });
      void qc.invalidateQueries({ queryKey: ["pcrawl-keys"] });
      void qc.invalidateQueries({ queryKey: ["pcrawl-matches"] });
      void qc.invalidateQueries({ queryKey: ["competitors"] });
    },
    onFinished: (j) => {
      const s = j.products;
      if (j.control === "cancel") return "أُلغيت الجولة. ما حُفظ قبل الإلغاء يبقى كما هو.";
      const base = s ? `${s.adsNew} إعلانًا جديدًا، ${s.matches} مطابقة مثبتة، ${s.pagesCandidates} صفحة مرشحة.` : "";
      return j.note ? `${j.note} ${base}` : `انتهت الدورة: ${base}`;
    },
  });
  const job = serverJob.run;
  const progress: PcrawlProgress | null = serverJob.job?.products ?? null;



  const overview = useQuery({
    queryKey: ["pcrawl-overview"],
    queryFn: () => overviewFn({ data: undefined }),
    refetchOnWindowFocus: false,
  });
  const keys = useQuery({
    queryKey: ["pcrawl-keys"],
    queryFn: () => keysFn({ data: {} }),
    refetchOnWindowFocus: false,
  });
  const matches = useQuery({
    queryKey: ["pcrawl-matches"],
    queryFn: () => matchesFn({ data: {} }),
    refetchOnWindowFocus: false,
  });

  const refreshAll = useCallback(() => {
    void overview.refetch();
    void keys.refetch();
    void matches.refetch();
    void qc.invalidateQueries({ queryKey: ["competitors"] });
  }, [overview, keys, matches, qc]);

  const run = useCallback(
    async (scope: "selected" | "general") => {
      await serverJob.start({ scope, selectedIds: scope === "selected" ? selectedIds : [] });
    },
    [serverJob, selectedIds],
  );


  const approve = useMutation({
    mutationFn: (id: string) => approveDiscoveredPage({ data: { id } }),
    onSuccess: (res) => {
      toast.success(
        res.duplicate ? "الصفحة موجودة بالفعل كمنافس." : "تمت الموافقة على الصفحة كمنافس.",
      );
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const reject = useMutation({
    mutationFn: (id: string) => rejectDiscoveredPage({ data: { id } }),
    onSuccess: () => {
      toast.success("تم رفض الصفحة.");
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMatches = useMutation({
    mutationFn: (input: { ids?: string[]; decision?: "match" | "no_match" }) =>
      deleteMatchesFn({ data: input }),
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



  const addKeysFn = useServerFn(addPcrawlKeys);
  const approveKeysFn = useServerFn(approvePcrawlKeys);
  const [newTerms, setNewTerms] = useState("");
  const addKeys = useMutation({
    mutationFn: (terms: string[]) => addKeysFn({ data: { runId: serverJob.job!.id, terms } }),
    onSuccess: (res) => {
      toast.success(res.added ? `أُضيف ${res.added} مفتاح.` : "المفاتيح موجودة بالفعل.");
      setNewTerms("");
      refreshAll();
      void serverJob.refetch?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const approveKeys = useMutation({
    mutationFn: () => approveKeysFn({ data: { runId: serverJob.job!.id } }),
    onSuccess: () => {
      toast.success("تم اعتماد المفاتيح، بدأ البحث عن الإعلانات.");
      refreshAll();
      void serverJob.refetch?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const o = overview.data;
  const p = progress;
  const reviewing = p?.phase === "review" && !p.done;
  const draftKeys = (keys.data ?? []).filter((k) => k.status === "draft");
  const keyPercent = p && p.keysTotal > 0 ? Math.round((p.keysDone / p.keysTotal) * 100) : 0;
  const matchRows = matches.data ?? [];
  const proven = matchRows.filter((m) => m.decision === "match");
  const rejected = matchRows.filter((m) => m.decision !== "match");

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-medium">زحف المنتجات — البحث عن إعلانات تُعلن عن منتجاتك</p>
            <p className="text-muted-foreground">
              المسار: المنتج ← اكتشاف الإعلانات ← مطابقة هوية المنتج ← الصفحة. الإعلان المثبت هو
              دليل المنافسة.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={job.active || selectedIds.length === 0}
              onClick={() => void run("selected")}
            >
              {job.active ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              زحف المحدد ({selectedIds.length})
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={job.active}
              onClick={() => void run("general")}
            >
              زحف عام
            </Button>
            <JobControls job={job} cancelLabel="إلغاء الجولة" />
          </div>

        </div>

        <LiveJobBar sj={serverJob} className="mb-0" />
        {o?.pausedReason && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <span>{o.pausedReason}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void resume({ data: undefined }).then(() => {
                  toast.success("تم الاستئناف، ابدأ الزحف ليُكمل من حيث توقف.");
                  refreshAll();
                })
              }
            >
              استئناف
            </Button>
          </div>
        )}

        {p && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{PHASE_LABEL[p.phase] ?? p.phase}</span>
              {p.currentKey && (
                <span className="text-muted-foreground">مفتاح البحث: {p.currentKey}</span>
              )}
            </div>
            <Progress value={keyPercent} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>منتجات مستهدفة: {p.productsTotal}</span>
              <span>ملفات بحث جاهزة: {p.profilesReady}</span>
              <span>
                مفاتيح: {p.keysDone}/{p.keysTotal}
              </span>
              <span>إعلانات ظهرت: {p.adsFound}</span>
              <span>إعلانات جديدة: {p.adsNew}</span>
              <span>تم تحليلها: {p.adsAnalyzed}</span>
              <span>بانتظار التحليل: {p.adsPending}</span>
              <span>مطابقات مثبتة: {p.matches}</span>
              <span>صفحات مرشحة: {p.pagesCandidates}</span>
            </div>
          </div>
        )}

        {o && !p && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>إعلانات محفوظة: {o.adsTotal}</span>
            <span>بانتظار التحليل: {o.adsPending}</span>
            <span>مطابقات مثبتة: {o.matches}</span>
            <span>صفحات بانتظار موافقتك: {o.pagesPending}</span>
            {o.lastRunAt && <span>آخر تشغيل: {new Date(o.lastRunAt).toLocaleString("ar-EG-u-nu-latn")}</span>}
          </div>
        )}
      </div>

      {reviewing && (
        <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <div className="text-sm">
            <p className="font-medium">راجع مفاتيح البحث قبل بدء البحث ({draftKeys.length})</p>
            <p className="text-muted-foreground">
              احذف ما لا يناسب، وأضف مصطلحاتك يدويًا، ثم اضغط «اعتماد وبدء البحث».
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {draftKeys.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد مفاتيح. أضف مصطلحًا واحدًا على الأقل.</p>
            ) : (
              draftKeys.map((k) => (
                <Badge key={k.id} variant="outline" className="gap-1 pe-1">
                  {k.keyText}
                  <button
                    type="button"
                    aria-label={`حذف المفتاح ${k.keyText}`}
                    disabled={delKeys.isPending}
                    onClick={() => delKeys.mutate({ ids: [k.id] })}
                    className="rounded-full p-0.5 opacity-70 hover:bg-destructive/15 hover:text-destructive hover:opacity-100"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const terms = newTerms.split(/[\n,،]+/).map((t) => t.trim()).filter(Boolean);
              if (terms.length) addKeys.mutate(terms);
            }}
          >
            <Input
              value={newTerms}
              onChange={(e) => setNewTerms(e.target.value)}
              placeholder="أضف مصطلحات مفصولة بفاصلة"
              className="min-w-0 flex-1"
            />
            <Button type="submit" size="sm" variant="outline" disabled={addKeys.isPending || !newTerms.trim()}>
              إضافة
            </Button>
          </form>
          <Button
            size="sm"
            disabled={approveKeys.isPending || draftKeys.length === 0}
            onClick={() => approveKeys.mutate()}
          >
            {approveKeys.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            اعتماد وبدء البحث
          </Button>
        </div>
      )}

      <div className="space-y-2.5">
        <CrawlResultSection
          title="مفاتيح البحث في الدورة الأخيرة"
          count={keys.data?.length ?? 0}
          actions={
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0 text-destructive hover:text-destructive"
              disabled={delKeys.isPending}
              onClick={() => {
                if (!window.confirm("حذف كل مفاتيح البحث في الدورة الأخيرة؟")) return;
                delKeys.mutate({ all: true });
              }}
            >
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
                <Badge
                  key={k.id}
                  variant={k.status === "searched" ? "secondary" : "outline"}
                  className="gap-1 pe-1"
                >
                  {k.keyText}
                  {k.status === "searched" && (
                    <span className="text-[10px] opacity-70">({k.found})</span>
                  )}
                  <button
                    type="button"
                    aria-label={`حذف المفتاح ${k.keyText}`}
                    disabled={delKeys.isPending}
                    onClick={() => delKeys.mutate({ ids: [k.id] })}
                    className="rounded-full p-0.5 opacity-70 hover:bg-destructive/15 hover:text-destructive hover:opacity-100"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </CrawlResultSection>

        <CrawlResultSection
          title="الإعلانات المطابقة والصفحات الناتجة"
          count={proven.length}
          actions={
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0 text-destructive hover:text-destructive"
              disabled={delMatches.isPending}
              onClick={() => {
                if (!window.confirm("حذف كل نتائج قسم المطابق؟")) return;
                delMatches.mutate({ decision: "match" });
              }}
            >
              <Trash2 className="size-4" />
              حذف الكل
            </Button>
          }
        >

          {matches.isLoading ? (
            <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
          ) : proven.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              لا توجد مطابقات مثبتة بعد. ابدأ زحفًا محددًا أو عامًا.
            </p>
          ) : (
            <div className="grid gap-3">
              {proven.map((m) => (
                <div key={m.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <CheckCircle2 className="size-4 text-emerald-600" />
                    <span className="font-medium">{m.productName}</span>
                    <Badge variant="outline">{m.productCode}</Badge>
                    <Badge variant="secondary">درجة {Math.round(m.score * 100)}%</Badge>
                    {m.searchKey && (
                      <span className="text-xs text-muted-foreground">مفتاح: {m.searchKey}</span>
                    )}
                  </div>

                  <div className="mt-2 flex gap-3">
                    {m.adImageUrl && (
                      <img
                        src={m.adImageUrl}
                        alt={`إعلان ${m.productName}`}
                        loading="lazy"
                        className="size-20 shrink-0 rounded-md object-cover"
                      />
                    )}
                    <div className="min-w-0 space-y-1">
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Megaphone className="size-3" />
                        الإعلان الدليل: {m.adId}
                        {m.adSourceUrl && (
                          <a
                            href={m.adSourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 underline"
                          >
                            عرض <ExternalLink className="size-3" />
                          </a>
                        )}
                      </p>
                      <p className="line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">
                        {m.adText}
                      </p>
                      {m.extractedName && (
                        <p className="text-xs">المنتج المستخرج من الإعلان: {m.extractedName}</p>
                      )}
                    </div>
                  </div>

                  {m.reasons.length > 0 && (
                    <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
                      {m.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium">الصفحة:</span>
                      {m.pageUrl ? (
                        <a href={m.pageUrl} target="_blank" rel="noreferrer" className="underline">
                          {m.pageName || m.pageId}
                        </a>
                      ) : (
                        <span>{m.pageName || m.pageId}</span>
                      )}
                      <Badge variant="outline">
                        {m.pageStatus === "approved"
                          ? "منافس معتمد"
                          : m.pageStatus === "rejected"
                            ? "مرفوضة"
                            : m.pageStatus
                              ? "بانتظار الموافقة"
                              : "غير مسجّلة"}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {m.pageRowId && m.pageStatus !== "approved" && (
                        <>
                          <Button
                            size="sm"
                            disabled={approve.isPending}
                            onClick={() => approve.mutate(m.pageRowId as string)}
                          >
                            <ThumbsUp className="size-4" />
                            موافقة
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={reject.isPending}
                            onClick={() => reject.mutate(m.pageRowId as string)}
                          >
                            <ThumbsDown className="size-4" />
                            رفض
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={delMatches.isPending}
                        onClick={() => delMatches.mutate({ ids: [m.id] })}
                      >
                        <Trash2 className="size-4" />
                        حذف النتيجة
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CrawlResultSection>

        <CrawlResultSection
          title="الإعلانات غير المطابقة"
          count={rejected.length}
          actions={
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0 text-destructive hover:text-destructive"
              disabled={delMatches.isPending}
              onClick={() => {
                if (!window.confirm("حذف كل نتائج قسم غير المطابق؟")) return;
                delMatches.mutate({ decision: "no_match" });
              }}
            >
              <Trash2 className="size-4" />
              حذف الكل
            </Button>
          }
        >
          {rejected.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد إعلانات غير مطابقة.</p>
          ) : (
            <div className="grid gap-2">
              {rejected.slice(0, 30).map((m) => (
                <div key={m.id} className="rounded-md border p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <XCircle className="size-4 text-muted-foreground" />
                    <span className="font-medium">{m.productName}</span>
                    <span className="text-muted-foreground">إعلان {m.adId}</span>
                    <span className="text-muted-foreground">درجة {Math.round(m.score * 100)}%</span>
                    <button
                      type="button"
                      aria-label="حذف هذه النتيجة"
                      disabled={delMatches.isPending}
                      onClick={() => delMatches.mutate({ ids: [m.id] })}
                      className="ms-auto rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  {m.differences.length > 0 && (
                    <p className="mt-1 text-muted-foreground">
                      أسباب الاختلاف: {m.differences.join(" — ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CrawlResultSection>

      </div>
    </div>
  );
}
