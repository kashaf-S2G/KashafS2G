import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListCountBar, ListPager } from "@/components/ListControls";
import { useAuth } from "@/hooks/useAuth";
import { useLastPosition, useRemembered, useResetOnChange, useScrollMemory, restoredCount } from "@/lib/last-position";
import { startReviewJobFn, getReviewJobFn, controlReviewJobFn, listLinkReviews, decideLinkReviewFn, createManualProblemFn, listActiveProblemsFn, rejectLinkReviewFn, listMergeReviews, decideMergeReviewFn, type LinkReviewItem, type MergeReviewItem, getPbStatementsPage, PB_SORTS, type PbStatementItem } from "@/lib/problems-benefits.functions";
import { cn } from "@/lib/utils";

const TITLE = "المشاكل | Kashaf";
const DESC = "كل مشكلة ظهرت في إعلانات المنافسين مع عدد الإعلانات والمنتجات والمنافسين.";

export const Route = createFileRoute("/_authenticated/problems-benefits")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProblemsBenefitsRoute,
});

type Kind = "all" | "problem" | "benefit";
type Sort = (typeof PB_SORTS)[number];
const SORT_LABELS: Record<Sort, string> = {
  newest: "الأحدث ظهورًا",
  oldest: "الأقدم ظهورًا",
  ads: "الأكثر إعلانات",
  active_ads: "الأكثر إعلانات نشطة",
  products: "الأكثر منتجات",
  text: "أبجديًا",
};
const MAX_PAGE_SIZE = 100; // الحد الأقصى الذي يقبله الخادم

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("ar-EG") : "—");

function ProblemsBenefitsRoute() {
  const { userId } = useAuth();
  const fetchPage = useServerFn(getPbStatementsPage);
  const lp = useLastPosition("problems-benefits");
  const [search, setSearch] = useRemembered(lp, "search", "");
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const kind: Kind = "problem"; // الصفحة للمشاكل فقط
  const [sort, setSort] = useRemembered<Sort>(lp, "sort", "newest");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [page, setPage] = useRemembered(lp, "page", 1);
  const [pageSize, setPageSizeRaw] = useRemembered<number>(lp, "pageSize", 20);
  const setPageSize: React.Dispatch<React.SetStateAction<number | "all">> = (a) => {
    const v = typeof a === "function" ? a(pageSize) : a;
    setPageSizeRaw(v === "all" ? MAX_PAGE_SIZE : v);
  };

  const filterKey = JSON.stringify({ kind, search: debouncedSearch, sort });
  useResetOnChange(lp, `${filterKey}|${pageSize}`, () => setPage(1));

  // البحث والنوع والترتيب والعد والترقيم تتم في قاعدة البيانات؛ المتصفح يستلم الصفحة المطلوبة فقط.
  const { data, isLoading, isError, error, refetch, isPlaceholderData } = useQuery({
    queryKey: ["pb-statements", "listing", userId, filterKey, page, pageSize],
    enabled: Boolean(userId),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: () =>
      fetchPage({
        data: { kind, search: debouncedSearch, sort, page, pageSize },
      }),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const allCount = data?.allTotal ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // صفحة بعد النهاية: نرجع لآخر صفحة موجودة.
  useEffect(() => {
    if (data && page > pageCount) setPage(pageCount);
  }, [data, page, pageCount]);
  useScrollMemory(lp, Boolean(data) && !isPlaceholderData);
  const paged = { visible: items, total, page: Math.min(page, pageCount), pageCount, pageSize, setPage, setPageSize };

  // التحديد مرتبط بمعرّف pb_statements.id ومستقل عن البحث والترتيب.
  const pageIds = items.map((i) => i.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of pageIds) {
        if (allPageSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  return (
    <AppShell title="المشاكل" description="المشاكل المستخرجة من إعلانات المنافسين وأرقامها.">
      <ReviewCheckPanel selectedIds={selected} />
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:max-w-md">
            <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث في نص المشكلة..."
              className="pe-9"
              maxLength={200}
            />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger className="h-9 w-48" aria-label="الترتيب">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PB_SORTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {SORT_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
        <Button type="button" size="sm" variant={allPageSelected ? "default" : "outline"} onClick={togglePage}>
          {allPageSelected ? "إلغاء تحديد الصفحة" : "تحديد الصفحة"} ({pageIds.length})
        </Button>
        <span className="text-muted-foreground">تم تحديد {selected.size} عنصر</span>
        {selected.size > 0 && (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelected(new Set())}>
            إلغاء تحديد الكل
          </Button>
        )}
      </div>

      <ListCountBar paged={paged} noun="عنصر" />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
      ) : isError ? (
        <Card className="p-10 text-center">
          <p className="mb-3 text-sm text-destructive">تعذّر تحميل المشاكل: {(error as Error).message}</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : items.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {allCount === 0
              ? "لا توجد مشاكل أو فوائد بعد. ستظهر هنا تلقائيًا بعد تحليل إعلانات المنافسين."
              : "لا توجد مشاكل أو فوائد مطابقة للبحث أو النوع الحالي."}
          </p>
        </Card>
      ) : (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:gap-4">
          {items.map((it) => (
            <PbCard key={it.id} item={it} selected={selected.has(it.id)} onToggle={() => toggleOne(it.id)} />
          ))}
        </div>
      )}

      <ListPager paged={paged} />
    </AppShell>
  );
}

function PbCard({ item, selected, onToggle }: { item: PbStatementItem; selected: boolean; onToggle: () => void }) {
  const stats: [string, number | string][] = [
    ["الإعلانات", item.totalAds],
    ["نشطة", item.activeAds],
    ["متوقفة", item.stoppedAds],
    ["المنتجات", item.products],
    ["المنافسون", item.competitors],
    ["أول ظهور", fmtDate(item.firstSeen)],
    ["آخر ظهور", fmtDate(item.lastSeen)],
  ];
  return (
    <Card className={cn("min-w-0 p-4", selected && "ring-2 ring-primary")}>
      <div className="mb-3 flex items-start gap-3">
        <Checkbox checked={selected} onCheckedChange={onToggle} aria-label="تحديد" className="mt-1" />
        <div className="min-w-0 flex-1">
          <Badge variant={item.kind === "problem" ? "destructive" : "secondary"} className="mb-2">
            {item.kind === "problem" ? "مشكلة" : "فائدة"}
          </Badge>
          <p className="break-words text-sm font-semibold leading-relaxed">{item.text}</p>
          {item.description && <p className="mt-1 break-words text-xs text-muted-foreground">{item.description}</p>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {stats.map(([label, v]) =>
          label === "المنتجات" && Number(v) > 0 ? (
            <Link
              key={label}
              to="/products"
              search={{ pb: item.id }}
              className="rounded-md bg-primary/10 px-2 py-1.5 text-center text-primary transition-colors hover:bg-primary/20"
              title="عرض المنتجات المرتبطة"
            >
              <div className="text-[11px]">{label}</div>
              <div className="text-sm font-bold underline underline-offset-2">{v}</div>
            </Link>
          ) : (
            <div key={label} className="rounded-md bg-muted/40 px-2 py-1.5 text-center">
              <div className="text-[11px] text-muted-foreground">{label}</div>
              <div className="text-sm font-bold">{v}</div>
            </div>
          ),
        )}
      </div>
    </Card>
  );
}

type ReviewState = "idle" | "running" | "paused" | "finished" | "stopped" | "cancelled";

const VERDICT_LABEL: Record<string, string> = { valid: "صحيح", invalid: "غير صحيح", uncertain: "غير مؤكد" };
const STATUS_LABEL: Record<string, string> = { pending: "بانتظار قرارك", approved: "تمت الموافقة", rejected: "غير موافق", stale: "قديمة — تحتاج إعادة مراجعة" };

type CheckStage = "fit" | "merge";

function ReviewCheckPanel({ selectedIds }: { selectedIds: ReadonlySet<string> }) {
  const qc = useQueryClient();
  const { userId } = useAuth();
  const startFn = useServerFn(startReviewJobFn);
  const jobFn = useServerFn(getReviewJobFn);
  const controlFn = useServerFn(controlReviewJobFn);
  const [stage, setStage] = useState<CheckStage>("fit");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: jobData } = useQuery({
    queryKey: ["pb-review-job", userId], enabled: Boolean(userId), queryFn: () => jobFn(),
    refetchInterval: (q) => (q.state.data?.job?.status === "running" || q.state.data?.job?.status === "paused" ? 3000 : false),
  });
  const job = jobData?.job ?? null;
  const state: ReviewState = job ? job.status : "idle";
  const jobStage: CheckStage = job?.kind ?? stage;
  const current = err || job?.currentText || "";
  const done = job?.cursor ?? 0;
  const total = job?.total ?? 0;
  const stats = { reviewed: job?.reviewed ?? 0, failed: job?.failed ?? 0 };
  const log = job?.log ?? [];
  const lastCursor = useRef(-1);
  useEffect(() => {
    if (!job || job.cursor === lastCursor.current) return;
    lastCursor.current = job.cursor;
    qc.invalidateQueries({ queryKey: ["pb-link-reviews"] });
    qc.invalidateQueries({ queryKey: ["pb-merge-reviews"] });
  }, [job, qc]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["pb-review-job"] });
  const run = async () => {
    setErr(""); setBusy(true);
    try { await startFn({ data: { kind: stage, problemIds: [...selectedIds] } }); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); refresh(); }
  };
  const control = async (action: "pause" | "resume" | "finish" | "cancel") => {
    if (!job) return;
    try { await controlFn({ data: { id: job.id, action } }); } catch (e) { setErr((e as Error).message); }
    refresh();
  };

  const active = state === "running" || state === "paused";
  const pct = total ? Math.round((done / total) * 100) : 0;
  const mergeBlocked = stage === "merge" && selectedIds.size < 2;
  return (
    <Card className="mb-4 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="flex items-center gap-1 rounded-lg border p-1" role="radiogroup" aria-label="مرحلة التشييك">
          <Button type="button" size="sm" variant={stage === "fit" ? "default" : "ghost"} className="h-7" disabled={active} onClick={() => setStage("fit")}>تشييك ملائمة منتج</Button>
          <Button type="button" size="sm" variant={stage === "merge" ? "default" : "ghost"} className="h-7" disabled={active} onClick={() => setStage("merge")}>تشييك دمج</Button>
        </div>
        {!active && (
          <Button size="sm" onClick={run} disabled={mergeBlocked || busy}>
            {stage === "merge"
              ? `تشييك دمج المحدد (${selectedIds.size})`
              : selectedIds.size > 0 ? `مراجعة وتشييك المحدد فقط (${selectedIds.size})` : "مراجعة وتشييك"}
          </Button>
        )}
        {state === "running" && <Button size="sm" variant="outline" onClick={() => control("pause")}>إيقاف مؤقت</Button>}
        {state === "paused" && <Button size="sm" onClick={() => control("resume")}>استئناف</Button>}
        {active && <Button size="sm" variant="secondary" onClick={() => control("finish")}>اكتفيت بهذا القدر</Button>}
        {active && <Button size="sm" variant="destructive" onClick={() => control("cancel")}>إلغاء العملية</Button>}
        {!active && (
          <span className="text-xs text-muted-foreground">
            {stage === "merge"
              ? mergeBlocked
                ? "حدّد مشكلتين أو أكثر من القائمة أدناه ليفحص هل بعضها يصف نفس المشكلة ويستحق الدمج."
                : `سيقارن ${selectedIds.size} مشكلة محددة زوجًا بزوج ويقترح ما يستحق الدمج. لا يُدمج شيء إلا بموافقتك. تُخصم التكلفة من رصيد الـ AI.`
              : selectedIds.size > 0
                ? `سيراجع ${selectedIds.size} مشكلة محددة فقط (منها النشطة التي لها منتجات مرتبطة).`
                : "يفحص كل مشكلة مع كل منتج مرتبط بها بشكل مستقل. حدّد مشاكل بالقائمة أدناه لمراجعتها وحدها. النتائج اقتراحات فقط ولا يتغير شيء إلا بموافقتك. تُخصم التكلفة من رصيد الـ AI."}
          </span>
        )}
      </div>
      {(state !== "idle" || err) && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 break-words font-medium">{state === "paused" ? "متوقف مؤقتًا — " : ""}{current}</span>
            {total > 0 && <span className="shrink-0 text-muted-foreground">{done} / {total}</span>}
          </div>
          <Progress value={total ? pct : active ? 5 : 100} />
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>{jobStage === "merge" ? "أزواج رُوجعت" : "علاقات رُوجعت"}: <b>{stats.reviewed}</b></span>
            <span>فشل: <b>{stats.failed}</b></span>
          </div>
        </div>
      )}
      {log.length > 0 && (
        <ul className="mt-3 max-h-40 space-y-1 overflow-auto text-xs text-muted-foreground">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
      )}
      <ReviewResults />
      <MergeResults />
    </Card>
  );
}

const MERGE_VERDICT_LABEL: Record<string, string> = { merge: "يستحق الدمج", uncertain: "غير مؤكد" };

/** نتائج تشييك الدمج: اقتراحات فقط — الموافقة تدمج فعليًا، والرفض يبقي المشكلتين منفصلتين. */
function MergeResults() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listMergeReviews);
  const decideFn = useServerFn(decideMergeReviewFn);
  const [busy, setBusy] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const { data } = useQuery({ queryKey: ["pb-merge-reviews", userId], enabled: Boolean(userId), queryFn: () => listFn() });
  const items = data?.items ?? [];
  const pending = items.filter((i) => i.status === "pending");
  const visible = showDone ? items : pending;
  if (!items.length) return null;
  const decide = async (it: MergeReviewItem, approve: boolean) => {
    setBusy(it.id);
    try {
      const r = await decideFn({ data: { reviewId: it.id, approve } });
      if (r.status === "stale") alert(r.note);
    } catch (e) { alert((e as Error).message); }
    finally {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ["pb-merge-reviews"] });
      qc.invalidateQueries({ queryKey: ["pb-statements"] });
    }
  };
  return (
    <div className="mt-4 space-y-3 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <b>نتائج تشييك الدمج</b>
        <span className="text-xs text-muted-foreground">بانتظار قرارك: {pending.length}</span>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowDone((v) => !v)}>{showDone ? "إخفاء المحسومة" : "عرض المحسومة أيضًا"}</Button>
      </div>
      {visible.map((it) => (
        <div key={it.id} className="rounded-lg border p-3 text-sm">
          <p className="break-words"><span className="text-muted-foreground">المشكلة المدموجة:</span> <b>{it.source.text}</b></p>
          <p className="mt-1 break-words"><span className="text-muted-foreground">تُدمج في:</span> <b>{it.target.text}</b></p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={it.verdict === "merge" ? "secondary" : "outline"}>قرار AI: {MERGE_VERDICT_LABEL[it.verdict] ?? it.verdict}</Badge>
            <span className="text-xs text-muted-foreground">الثقة: {it.confidence}</span>
            {it.status !== "pending" && <Badge variant="outline">{STATUS_LABEL[it.status] ?? it.status}</Badge>}
          </div>
          <p className="mt-1 break-words text-xs"><span className="text-muted-foreground">السبب:</span> {it.reason}</p>
          {it.statusNote && <p className="mt-1 text-xs text-muted-foreground">{it.statusNote}</p>}
          {it.status === "pending" && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" disabled={busy === it.id || it.verdict !== "merge"} onClick={() => decide(it, true)}>موافق — ادمج</Button>
              <Button size="sm" variant="outline" disabled={busy === it.id} onClick={() => decide(it, false)}>غير موافق — أبقهما منفصلتين</Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ReviewResults() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listLinkReviews);
  const decideFn = useServerFn(decideLinkReviewFn);
  const [busy, setBusy] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const { data } = useQuery({ queryKey: ["pb-link-reviews", userId], enabled: Boolean(userId), queryFn: () => listFn() });
  const items = data?.items ?? [];
  const pending = items.filter((i) => i.status === "pending");
  const visible = showDone ? items : pending;
  if (!items.length) return null;
  const decide = async (it: LinkReviewItem, approve: boolean) => {
    setBusy(it.id);
    try {
      const r = await decideFn({ data: { reviewId: it.id, approve } });
      if (r.status === "stale") alert(r.note);
    } catch (e) { alert((e as Error).message); }
    finally {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ["pb-link-reviews"] });
      qc.invalidateQueries({ queryKey: ["pb-statements"] });
    }
  };
  return (
    <div className="mt-4 space-y-3 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <b>نتائج المراجعة</b>
        <span className="text-xs text-muted-foreground">بانتظار قرارك: {pending.length}</span>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowDone((v) => !v)}>{showDone ? "إخفاء المحسومة" : "عرض المحسومة أيضًا"}</Button>
      </div>
      {visible.map((it) => (
        <div key={it.id} className="rounded-lg border p-3 text-sm">
          <div className="flex gap-3">
            {it.product.image ? <img src={it.product.image} alt={it.product.name} className="size-16 shrink-0 rounded object-cover" loading="lazy" /> : <div className="size-16 shrink-0 rounded bg-muted" />}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="break-words"><span className="text-muted-foreground">المشكلة:</span> <b>{it.problem.text}</b> <span className="text-[10px] text-muted-foreground">({it.problem.id.slice(0, 8)})</span></p>
              <p className="break-words"><span className="text-muted-foreground">المنتج:</span> <b>{it.product.name}</b></p>
              {it.product.description && <p className="break-words text-xs text-muted-foreground">{it.product.description}</p>}
              <p className="text-xs text-muted-foreground">العلاقة الحالية: {it.problem.text} ← {it.product.name}</p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={it.verdict === "valid" ? "secondary" : it.verdict === "invalid" ? "destructive" : "outline"}>قرار AI: {VERDICT_LABEL[it.verdict] ?? it.verdict}</Badge>
            <span className="text-xs text-muted-foreground">الثقة: {it.confidence}</span>
            {it.status !== "pending" && <Badge variant="outline">{STATUS_LABEL[it.status] ?? it.status}</Badge>}
          </div>
          <p className="mt-1 break-words text-xs"><span className="text-muted-foreground">السبب:</span> {it.reason}</p>
          {it.verdict === "invalid" && it.suggested && (
            <p className="mt-1 break-words text-xs"><span className="text-muted-foreground">مشكلة موجودة مقترحة:</span> <b>{it.suggested.text}</b> ({it.suggested.id.slice(0, 8)}) — {it.suggested.reason}</p>
          )}
          {it.verdict === "invalid" && it.newProblem && (
            <p className="mt-1 break-words text-xs"><span className="text-muted-foreground">اقتراح إنشاء مشكلة جديدة:</span> <b>{it.newProblem.description}</b> — {it.newProblem.reason}</p>
          )}
          {it.verdict === "invalid" && !it.suggested && !it.newProblem && <p className="mt-1 text-xs text-muted-foreground">لا يوجد اقتراح بديل.</p>}
          {it.statusNote && <p className="mt-1 text-xs text-muted-foreground">{it.statusNote}</p>}
          {it.status === "pending" ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" disabled={busy === it.id} onClick={() => decide(it, true)}>موافق</Button>
              <RejectDialog item={it} disabled={busy === it.id} onPlainReject={() => decide(it, false)} />
              <CreateProblemButton item={it} />
            </div>
          ) : (
            <div className="mt-2">
              <CreateProblemButton item={it} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** زر يفتح نموذج إنشاء مشكلة جديدة — مع خيار ربط منتج البطاقة بها فورًا. */
function CreateProblemButton({ item }: { item: LinkReviewItem }) {
  const qc = useQueryClient();
  const createFn = useServerFn(createManualProblemFn);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(item.newProblem?.description ?? "");
  const [desc, setDesc] = useState("");
  const [linkProduct, setLinkProduct] = useState(true);
  const [busy, setBusy] = useState(false);
  const openForm = () => {
    setText(item.newProblem?.description ?? "");
    setDesc("");
    setLinkProduct(true);
    setOpen(true);
  };
  const save = async () => {
    if (text.trim().length < 3) return;
    setBusy(true);
    try {
      const r = await createFn({ data: { text, description: desc, productId: linkProduct ? item.product.id : null } });
      qc.invalidateQueries({ queryKey: ["pb-statements"] });
      setOpen(false);
      alert(r.existed ? "المشكلة موجودة أصلًا وتمت إعادة استخدامها" + (r.linked ? " وربط المنتج بها." : ".") : "تم إنشاء المشكلة" + (r.linked ? " وربط المنتج بها." : "."));
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size="sm" variant="outline" className="border-dashed" onClick={openForm}>إنشاء مشكلة</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>إنشاء مشكلة جديدة</DialogTitle>
            <DialogDescription>
              مشكلة جديدة تُضاف إلى قائمة المشاكل{linkProduct ? ` ويُربط المنتج «${item.product.name}» بها` : ""}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="np-text">نص المشكلة</Label>
              <Textarea id="np-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={500} placeholder="مثال: حل مشكلة انسدادات الحوض واللعلعات" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-desc">الوصف / الرابط السببي (اختياري)</Label>
              <Textarea id="np-desc" value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} maxLength={2000} placeholder="لماذا هذه مشكلة حقيقية للعميل؟" />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="np-link" checked={linkProduct} onCheckedChange={(v) => setLinkProduct(v === true)} />
              <Label htmlFor="np-link" className="text-sm font-normal">ربط المنتج «{item.product.name}» بالمشكلة الجديدة</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>إلغاء</Button>
            <Button onClick={save} disabled={busy || text.trim().length < 3}>إنشاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const NONE_CHOICE = "__none__";
const NEW_CHOICE = "__new__";

/**
 * زر «غير موافق»: يفتح حوارًا فيه قائمة منسدلة بكل المشاكل النشطة لاختيار المشكلة الصحيحة للمنتج،
 * أو خيار إنشاء مشكلة جديدة بنموذج داخل نفس الحوار (حتى لو لم تناسب أي مشكلة من القائمة)،
 * أو رفض دون أي تغيير.
 */
function RejectDialog({ item, disabled, onPlainReject }: { item: LinkReviewItem; disabled: boolean; onPlainReject: () => void }) {
  const qc = useQueryClient();
  const listProblemsFn = useServerFn(listActiveProblemsFn);
  const rejectFn = useServerFn(rejectLinkReviewFn);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string>(NONE_CHOICE);
  const [text, setText] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const { data } = useQuery({ queryKey: ["pb-active-problems", item.problem.id], enabled: open, queryFn: () => listProblemsFn() });
  const problems = (data?.problems ?? []).filter((p) => p.id !== item.problem.id);
  const isNew = choice === NEW_CHOICE;
  const canApply = choice === NONE_CHOICE || (!isNew || text.trim().length >= 3);
  const openDialog = () => {
    setChoice(item.suggested ? item.suggested.id : item.newProblem ? NEW_CHOICE : NONE_CHOICE);
    setText(item.newProblem?.description ?? "");
    setDesc("");
    setOpen(true);
  };
  const apply = async () => {
    setSaving(true);
    try {
      if (choice === NONE_CHOICE) {
        setOpen(false);
        onPlainReject();
        return;
      }
      const r = await rejectFn({
        data: {
          reviewId: item.id,
          targetProblemId: isNew ? null : choice,
          newProblemText: isNew ? text : null,
          newProblemDescription: desc,
        },
      });
      setOpen(false);
      alert(r.note ?? "تم الرفض");
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
      qc.invalidateQueries({ queryKey: ["pb-link-reviews"] });
      qc.invalidateQueries({ queryKey: ["pb-statements"] });
    }
  };
  return (
    <>
      <Button size="sm" variant="outline" disabled={disabled} onClick={openDialog}>غير موافق</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>غير موافق — ما المشكلة الصحيحة للمنتج؟</DialogTitle>
            <DialogDescription>
              اختَر المشكلة الصحيحة للمنتج «{item.product.name}» من القائمة، أو أنشئ مشكلة جديدة إن لم تناسبه أي مشكلة من القائمة.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>المشكلة الحالية (المراد رفض العلاقة بها)</Label>
              <p className="rounded-md bg-muted/40 px-3 py-2 text-sm break-words">{item.problem.text}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rj-choice">المشكلة الصحيحة</Label>
              <Select value={choice} onValueChange={setChoice}>
                <SelectTrigger id="rj-choice" className="w-full">
                  <SelectValue placeholder="اختر..." />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE_CHOICE}>رفض دون تغيير — لا تُنقل العلاقة</SelectItem>
                  {problems.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.text}</SelectItem>
                  ))}
                  <SelectItem value={NEW_CHOICE}>➕ إنشاء مشكلة جديدة...</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isNew && (
              <div className="space-y-4 rounded-md border border-dashed p-3">
                <div className="space-y-2">
                  <Label htmlFor="rj-text">نص المشكلة الجديدة</Label>
                  <Textarea id="rj-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={500} placeholder="مثال: حل مشكلة انسدادات الحوض والبلاعات" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rj-desc">الوصف / الرابط السببي (اختياري)</Label>
                  <Textarea id="rj-desc" value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} maxLength={2000} placeholder="لماذا هذه مشكلة حقيقية للعميل؟" />
                </div>
                <p className="text-xs text-muted-foreground">سيُربط المنتج «{item.product.name}» بالمشكلة الجديدة فورًا بعد الحفظ.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>إلغاء</Button>
            <Button variant={isNew ? "default" : "secondary"} onClick={apply} disabled={saving || !canApply}>
              {choice === NONE_CHOICE ? "رفض دون تغيير" : isNew ? "إنشاء المشكلة ونقل المنتج إليها" : "رفض ونقل المنتج للمشكلة المختارة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
