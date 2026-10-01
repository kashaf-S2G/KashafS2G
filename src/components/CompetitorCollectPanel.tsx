import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCheck, CircleSlash, Loader2, Play, RefreshCw, Sparkles, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { controlCompetitorCollection, getLatestCompetitorRun, startCompetitorCollection } from "@/lib/competitor-collect.functions";
import { controlRawAdAnalysis, getRawAdAnalysisStatus, startRawAdAnalysis } from "@/lib/raw-ad-analyzer.functions";
import { Pause } from "lucide-react";

const STATUS: Record<string, string> = {
  queued: "في الانتظار",
  running: "جارٍ الجمع",
  completed: "مكتملة",
  partial: "جزئية",
  failed: "فاشلة",
  cancelled: "ملغاة",
  finished: "أنهاها المستخدم",
  stopped: "موقوفة مؤقتًا",
};

const COVERAGE: Record<string, string> = {
  complete: "كاملة",
  partial: "جزئية",
  empty: "بلا إعلانات",
  failed: "فاشلة",
  running: "جارية",
};

export function CompetitorCollectButton({ selectedIds = [] }: { selectedIds?: string[] }) {
  const qc = useQueryClient();
  const start = useServerFn(startCompetitorCollection);
  const { data: run } = useLatestRun();
  const busy = run?.status === "queued" || run?.status === "running" || run?.status === "stopped";
  const m = useMutation({
    mutationFn: () => start({ data: selectedIds.length ? { competitorIds: selectedIds } : {} }),
    onSuccess: (r) => {
      toast.success(`بدأت جولة الجمع #${r.runNumber}${selectedIds.length ? ` لـ ${selectedIds.length} منافس محدد` : ""}`);
      qc.invalidateQueries({ queryKey: ["competitor-run"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "تعذّر بدء الجمع"),
  });
  return (
    <Button variant="outline" onClick={() => m.mutate()} disabled={m.isPending || busy}>
      {m.isPending || busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      {selectedIds.length ? `زحف المحدد (${selectedIds.length})` : "زحف الآن"}
    </Button>
  );
}

/** زر «تحليل وتكوين بالذكاء الاصطناعي»: يحلل الإعلانات الخام المجمعة دون زحف جديد. */
export function CompetitorAnalyzeButton() {
  const qc = useQueryClient();
  const start = useServerFn(startRawAdAnalysis);
  const m = useMutation({
    mutationFn: () => start({}),
    onSuccess: (r) => {
      if (r.pending > 0) toast.success(`بدأ التحليل — ${r.pending} إعلان في الطابور`);
      else toast.info(`لا توجد إعلانات بانتظار التحليل — كل إعلانات المنافسين حُلّلت بالفعل${r.needsReview ? ` (${r.needsReview} تحتاج مراجعتك)` : ""}.`);
      qc.invalidateQueries({ queryKey: ["ai-activity"] });
      qc.invalidateQueries({ queryKey: ["raw-analysis-status"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "تعذّر بدء التحليل"),
  });
  return (
    <Button variant="outline" onClick={() => m.mutate()} disabled={m.isPending}>
      {m.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      تحليل وتكوين بالذكاء الاصطناعي
    </Button>
  );
}

export function RawAnalysisControls() {
  const qc = useQueryClient();
  const get = useServerFn(getRawAdAnalysisStatus);
  const control = useServerFn(controlRawAdAnalysis);
  const { data: st } = useQuery({
    queryKey: ["raw-analysis-status"],
    queryFn: () => get(),
    refetchInterval: (q) => (q.state.data && (q.state.data.pending + q.state.data.processing > 0) ? 4000 : 15000),
  });
  const ctl = useMutation({
    mutationFn: (action: "pause" | "resume" | "cancel" | "finish") => control({ data: { action } }),
    onSuccess: (_r, a) => {
      toast.success({ pause: "تم الإيقاف المؤقت بعد الدفعة الحالية", resume: "تم استئناف التحليل", cancel: "تم إلغاء الجولة", finish: "تم إنهاء التحليل والاحتفاظ بما تم تكوينه" }[a]);
      qc.invalidateQueries({ queryKey: ["raw-analysis-status"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "تعذّر تنفيذ الأمر"),
  });
  if (!st) return null;
  const open = st.pending + st.processing;
  const running = st.state === "active" && open > 0;
  const paused = st.state === "paused";
  if (!running && !paused) return null;
  const total = open + st.done;
  const pct = total ? Math.round((st.done / total) * 100) : 0;
  return (
    <div className="mb-4 rounded-lg border bg-card p-4 text-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Sparkles className="size-4" /> التحليل والتكوين بالذكاء الاصطناعي — {paused ? "موقوف مؤقتًا" : "جارٍ"}
        </span>
        <span className="text-muted-foreground">منتظرة: {st.pending} · جارية: {st.processing} · تمت: {st.done}</span>
      </div>
      <Progress value={pct} />
      <div className="mt-3 flex flex-wrap gap-2">
        {paused ? (
          <Button size="sm" variant="outline" className="gap-1.5" disabled={ctl.isPending} onClick={() => ctl.mutate("resume")}>
            <Play className="size-3.5" /> استئناف
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="gap-1.5" disabled={ctl.isPending} onClick={() => ctl.mutate("pause")}>
            <Pause className="size-3.5" /> توقف مؤقت
          </Button>
        )}
        <Button size="sm" variant="secondary" className="gap-1.5" disabled={ctl.isPending} onClick={() => ctl.mutate("finish")}>
          <CheckCheck className="size-3.5" /> اكتفيت بهذا القدر
        </Button>
        <Button size="sm" variant="destructive" className="gap-1.5" disabled={ctl.isPending} onClick={() => ctl.mutate("cancel")}>
          <CircleSlash className="size-3.5" /> إلغاء الجولة
        </Button>
      </div>
    </div>
  );
}

function useLatestRun() {
  const get = useServerFn(getLatestCompetitorRun);
  return useQuery({
    queryKey: ["competitor-run"],
    queryFn: () => get(),
    refetchInterval: (q) => (q.state.data && ["queued", "running"].includes(q.state.data.status) ? 3000 : false),
  });
}

export function CompetitorCollectProgress() {
  const { data: run } = useLatestRun();
  const qc = useQueryClient();
  const control = useServerFn(controlCompetitorCollection);
  const ctl = useMutation({
    mutationFn: (action: "stop" | "resume" | "cancel" | "finish") => control({ data: { runId: run!.id, action } }),
    onSuccess: (_r, a) => { if (a === "finish") toast.success("تم إنهاء الجولة والاحتفاظ بكل ما جُمع"); qc.invalidateQueries({ queryKey: ["competitor-run"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "تعذّر تنفيذ الأمر"),
  });
  if (!run) return null;
  const live = run.status === "running" || run.status === "queued";
  const partialCount = run.coverage.filter((c) => ["partial", "failed", "empty"].includes(c.status)).length;
  const finished = run.jobs_done + run.jobs_failed;
  const pct = run.jobs_total ? Math.round((finished / run.jobs_total) * 100) : 0;
  return (
    <div className="mb-4 rounded-lg border bg-card p-4 text-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          جولة الجمع #{run.run_number} — {STATUS[run.status] ?? run.status}
        </span>
        <span className="text-muted-foreground">
          {finished}/{run.jobs_total} مهمة · {run.ads_found} إعلان · {run.ads_new} جديد
          {run.jobs_failed > 0 ? ` · ${run.jobs_failed} فشلت` : ""}
        </span>
      </div>
      <Progress value={pct} />
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>منتظرة: {run.jobs.pending}</span>
        <span>جارية: {run.jobs.running}</span>
        <span>إعادة محاولة: {run.jobs.retrying}</span>
        {run.jobs.stopped > 0 && <span>مجمّدة: {run.jobs.stopped}</span>}
        <span>فريدة: {Math.max(run.ads_found - run.ads_duplicate, 0)}</span>
        <span>مكررة: {run.ads_duplicate}</span>
        <span>تغيّرت: {run.ads_changed}</span>
        {run.ads_not_seen > 0 && <span>لم تعد تظهر: {run.ads_not_seen}</span>}
        {partialCount > 0 && <span>منافسون بتغطية ناقصة: {partialCount}</span>}
        <span>آخر جمع مكتمل: {run.last_success_at ? new Date(run.last_success_at).toLocaleString("ar-EG") : "—"}</span>
      </div>
      {(live || run.status === "stopped") && (
        <div className="mt-3 flex flex-wrap gap-2">
          {run.status === "stopped" ? (
            <Button size="sm" variant="outline" className="gap-1.5" disabled={ctl.isPending} onClick={() => ctl.mutate("resume")}>
              <Play className="size-3.5" /> استئناف
            </Button>
          ) : run.control === "active" ? (
            <Button size="sm" variant="outline" className="gap-1.5" disabled={ctl.isPending} onClick={() => ctl.mutate("stop")}>
              <Square className="size-3.5" /> إيقاف
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> جارٍ الإيقاف بعد الدفعة الحالية...</span>
          )}
          <Button size="sm" variant="secondary" className="gap-1.5" disabled={ctl.isPending} onClick={() => ctl.mutate("finish")}>
            <CheckCheck className="size-3.5" /> اكتفيت بهذا القدر
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5 text-destructive" disabled={ctl.isPending} onClick={() => ctl.mutate("cancel")}>
            <CircleSlash className="size-3.5" /> إلغاء الجولة
          </Button>
        </div>
      )}
      {run.coverage.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>تغطية المنافسين:</span>
          {(["complete", "partial", "empty", "failed", "running"] as const).map((s) => {
            const n = run.coverage.filter((c) => c.status === s).length;
            return n ? <span key={s}>{COVERAGE[s]}: {n}</span> : null;
          })}
        </div>
      )}
      {run.error && run.status !== "running" && <p className="mt-2 text-xs text-destructive">{run.error}</p>}
    </div>
  );
}
