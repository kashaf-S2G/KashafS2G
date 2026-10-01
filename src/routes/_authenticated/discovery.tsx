import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, RefreshCw, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { LiveJobBar } from "@/components/LiveJobBar";
import { JobControls } from "@/components/JobControls";
import { CategoryCrawlPanel } from "@/components/CategoryCrawlPanel";
import { useServerJob } from "@/lib/use-server-job";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  addBankEntry,
  deleteBankEntry,
  getBank,
  listRemovedBankEntries,
  restoreBankEntry,
  searchBankEntriesAi,
  type BankEntry,
} from "@/lib/discovery.functions";


export const Route = createFileRoute("/_authenticated/discovery")({
  head: () => ({
    meta: [
      { title: "بنك المصطلحات والفئات | Kashaf" },
      {
        name: "description",
        content: "إدارة مصطلحات البحث وفئات المنتجات وتحديثها من بيانات المنتجات.",
      },
      { property: "og:title", content: "بنك المصطلحات والفئات | Kashaf" },
      {
        property: "og:description",
        content: "إدارة مصطلحات البحث وفئات المنتجات وتحديثها من بيانات المنتجات.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DiscoveryRoute,
});

/** خانة بحث ذكي بالمعنى: تُرسل نصوص القائمة للنموذج وتُبقي العناصر المرتبطة دلاليًا فقط. */
function AiSearchBar({
  entries,
  active,
  onApply,
  onClear,
}: {
  entries: BankEntry[];
  active: boolean;
  onApply: (ids: ReadonlySet<string>) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState("");
  const search = useServerFn(searchBankEntriesAi);
  const mutation = useMutation({
    mutationFn: (query: string) =>
      search({ data: { query, entries: entries.map((e) => ({ id: e.id, term: e.term })) } }),
    onSuccess: (ids) => {
      if (ids.length === 0) toast.info("لا توجد عناصر مرتبطة ببحثك.");
      else toast.success(`وجدت ${ids.length} عنصرًا مرتبطًا.`);
      onApply(new Set(ids));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (entries.length === 0) return null;

  return (
    <form
      className="mb-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim() && !active) mutation.mutate(q.trim());
      }}
    >
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="بحث ذكي بالمعنى... مثال: ما يخص أدوات منزلية"
        className="h-8 text-xs"
        disabled={active}
        aria-label="بحث ذكي بالمعنى"
      />
      {active ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 shrink-0 gap-1"
          onClick={() => {
            setQ("");
            onClear();
          }}
        >
          <X className="size-3.5" />
          مسح
        </Button>
      ) : (
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 gap-1"
          disabled={mutation.isPending || !q.trim()}
        >
          {mutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          بحث ذكي
        </Button>
      )}
    </form>
  );
}

function BankList({
  title,
  hint,
  placeholder,
  kind,
  entries,
  onChanged,
  selected,
  onToggle,
}: {
  title: string;
  hint: string;
  placeholder: string;
  kind: "term" | "category";
  entries: BankEntry[];
  onChanged: () => void;
  selected?: ReadonlySet<string>;
  onToggle?: (id: string) => void;
}) {
  const [value, setValue] = useState("");
  const [filter, setFilter] = useState("");
  const [aiMatched, setAiMatched] = useState<ReadonlySet<string> | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const add = useServerFn(addBankEntry);
  const remove = useServerFn(deleteBankEntry);

  /** ترتيب أبجدي ثابت حتى لا تتغير مواضع العناصر بين البحث والآخر. */
  const sorted = useMemo(
    () => [...entries].sort((a, b) => a.term.localeCompare(b.term, "ar")),
    [entries],
  );
  const visible = useMemo(() => {
    if (aiMatched) return sorted.filter((e) => aiMatched.has(e.id));
    const q = filter.trim();
    if (!q) return sorted;
    return sorted.filter((e) => e.term.includes(q));
  }, [sorted, filter, aiMatched]);

  const addMutation = useMutation({
    mutationFn: (term: string) => add({ data: { kind, term } }),
    onSuccess: () => {
      setValue("");
      setAiMatched(null);
      onChanged();
      toast.success(kind === "term" ? "تمت إضافة المصطلح." : "تمت إضافة الفئة.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      setAiMatched(null);
      onChanged();
      toast.success("تم الحذف.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-4">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">{title}</h2>
        <span className="text-xs text-muted-foreground">{entries.length}</span>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{hint}</p>

      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) addMutation.mutate(value);
        }}
      >
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} />
        <Button type="submit" size="icon" disabled={addMutation.isPending || !value.trim()}>
          {addMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        </Button>
      </form>

      <AiSearchBar
        entries={entries}
        active={aiMatched !== null}
        onApply={(ids) => setAiMatched(ids)}
        onClear={() => setAiMatched(null)}
      />

      {entries.length > 8 && !aiMatched ? (
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="ابحث داخل القائمة..."
          className="mb-3 h-8 text-xs"
        />
      ) : null}

      {aiMatched ? (
        <p className="mb-3 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Sparkles className="size-3" />
          نتائج البحث الذكي: {visible.length} من {entries.length}
        </p>
      ) : null}

      {entries.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">لا توجد عناصر بعد.</p>
      ) : visible.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">لا توجد نتائج مطابقة لبحثك.</p>
      ) : (
        <div className="flex max-h-72 flex-wrap content-start gap-1.5 overflow-y-auto">
          {visible.map((e) => (
            <span
              key={e.id}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${selected?.has(e.id) ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
            >
              {onToggle ? (
                <button type="button" aria-pressed={selected?.has(e.id)} onClick={() => onToggle(e.id)} title="حدّد للزحف">
                  {e.term}
                </button>
              ) : (
                e.term
              )}
              {e.hits > 0 ? <span className="text-[10px] text-muted-foreground">({e.hits})</span> : null}
              {confirmDeleteId === e.id ? (
                <>
                  <button
                    type="button"
                    aria-label={`تأكيد حذف ${e.term}`}
                    className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground"
                    disabled={removeMutation.isPending}
                    onClick={() => { removeMutation.mutate(e.id); setConfirmDeleteId(null); }}
                  >
                    حذف؟
                  </button>
                  <button type="button" aria-label="إلغاء الحذف" className="text-muted-foreground" onClick={() => setConfirmDeleteId(null)}>
                    <X className="size-3.5" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  aria-label={`حذف ${e.term}`}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                  disabled={removeMutation.isPending}
                  onClick={() => setConfirmDeleteId(e.id)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

function DiscoveryRoute() {
  const qc = useQueryClient();
  const bankFn = useServerFn(getBank);
  const removedFn = useServerFn(listRemovedBankEntries);
  const restoreEntry = useServerFn(restoreBankEntry);
  const [removedAi, setRemovedAi] = useState<ReadonlySet<string> | null>(null);
  const [selectedCats, setSelectedCats] = useState<ReadonlySet<string>>(new Set());
  const toggleCat = useCallback((id: string) => {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const bank = useQuery({ queryKey: ["discovery-bank"], queryFn: () => bankFn({ data: undefined }) });
  const removed = useQuery({ queryKey: ["discovery-removed"], queryFn: () => removedFn({ data: undefined }) });

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["discovery-bank"] });
    qc.invalidateQueries({ queryKey: ["discovery-removed"] });
  }, [qc]);

  const serverJob = useServerJob("bank", {
    onProgress: refresh,
    onFinished: (j) => {
      if (j.status === "cancelled") return "أُلغيت العملية وأُزيل ما أُضيف في هذه الجولة.";
      const s = `${j.bank?.terms ?? 0} مصطلح و${j.bank?.categories ?? 0} فئة جديدة.`;
      return j.note ? `${j.note} ${s}` : `تم تحديث البنك: ${s}`;
    },
  });
  const job = serverJob.run;
  const sj = serverJob.job;
  const buildNote = !sj
    ? null
    : sj.status === "running"
      ? sj.bank?.phase === "categories"
        ? "جارٍ استخراج الفئات من المنتجات..."
        : `جارٍ التحديث: ${sj.bank?.terms ?? 0} مصطلح و${sj.bank?.categories ?? 0} فئة حتى الآن.`
      : sj.finishedAt && Date.now() - Date.parse(sj.finishedAt) < 30 * 60_000
        ? sj.status === "cancelled"
          ? "أُلغيت العملية وأُزيل ما أُضيف في هذه الجولة."
          : sj.status === "failed"
            ? (sj.error ?? "تعذّر تحديث البنك.")
            : (sj.note ?? `اكتمل التحديث: ${sj.bank?.terms ?? 0} مصطلح و${sj.bank?.categories ?? 0} فئة جديدة.`)
        : null;

  const restoreEntryMutation = useMutation({
    mutationFn: (id: string) => restoreEntry({ data: { id } }),
    onSuccess: () => {
      refresh();
      toast.success("تمت الاستعادة.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startBuild = useCallback(() => {
    void serverJob.start();
  }, [serverJob]);

  const data = bank.data;

  return (
    <AppShell
      title="بنك المصطلحات والفئات"
      description="أدر مصطلحات البحث وفئات المنتجات وحدّثها مباشرة من بيانات منتجاتك."
      actions={
        job.active ? (
          <JobControls job={job} cancelLabel="إلغاء وحذف ما أُضيف" />
        ) : (
          <Button size="lg" className="gap-2 shadow-sm" onClick={startBuild}>
            <RefreshCw className="size-4" />
            تحديث البنك من المنتجات
          </Button>
        )
      }
    >
      <LiveJobBar sj={serverJob} />
      {job.active || buildNote ? (
        <Card className="mb-4 flex flex-wrap items-center gap-2 p-3 text-xs">
          {job.status === "running" ? <Loader2 className="size-3.5 animate-spin" /> : null}
          <span className="text-muted-foreground">
            {job.paused ? "موقوف مؤقتًا — " : ""}
            {buildNote ?? "جارٍ التحضير..."}
          </span>
        </Card>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-2">
        <Card className="p-3">
          <p className="text-lg font-bold leading-none">{data?.terms.length ?? 0}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">مصطلح</p>
        </Card>
        <Card className="p-3">
          <p className="text-lg font-bold leading-none">{data?.categories.length ?? 0}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">فئة</p>
        </Card>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <BankList
          title="المصطلحات"
          hint={`تُستخرج تلقائيًا من أسماء المنتجات وأوصافها (لديك الآن ${data?.productsCount ?? 0} منتج)، ويمكنك الإضافة والحذف يدويًا.`}
          placeholder="أضف مصطلح بحث بالعربية..."
          kind="term"
          entries={data?.terms ?? []}
          onChanged={refresh}
        />
        <BankList
          title="الفئات"
          hint="تُستنتج تلقائيًا من تحليل منتجاتك، ويمكنك الإضافة والحذف يدويًا."
          placeholder="أضف فئة مستهدفة..."
          kind="category"
          entries={data?.categories ?? []}
          onChanged={refresh}
          selected={selectedCats}
          onToggle={toggleCat}
        />
      </div>

      <CategoryCrawlPanel
        selectedIds={[...selectedCats].filter((id) => (data?.categories ?? []).some((c) => c.id === id))}
      />

      <Card className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h2 className="text-base font-bold">المصطلحات والفئات المحذوفة</h2>
          <span className="text-xs text-muted-foreground">{removed.data?.length ?? 0}</span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          العناصر المحذوفة لا تعود تلقائيًا عند تحديث البنك. أعِدها يدويًا من هنا عند الحاجة.
        </p>
        <AiSearchBar
          entries={removed.data ?? []}
          active={removedAi !== null}
          onApply={(ids) => setRemovedAi(ids)}
          onClear={() => setRemovedAi(null)}
        />
        {(removed.data?.length ?? 0) === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">لا توجد عناصر محذوفة.</p>
        ) : (
          <div className="flex max-h-60 flex-wrap gap-1.5 overflow-y-auto">
            {(removedAi ? removed.data?.filter((e) => removedAi.has(e.id)) : removed.data)?.map((e) => (
              <span
                key={e.id}
                title={e.removedAt ? `حُذف في: ${new Date(e.removedAt).toLocaleString("ar-EG-u-nu-latn")}` : undefined}
                className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-1 text-xs text-muted-foreground"
              >
                {e.term}
                <span className="text-[10px]">({e.kind === "term" ? "مصطلح" : "فئة"})</span>
                <button
                  type="button"
                  aria-label={`استعادة ${e.term}`}
                  className="transition-colors hover:text-foreground"
                  disabled={restoreEntryMutation.isPending}
                  onClick={() => restoreEntryMutation.mutate(e.id)}
                >
                  <RotateCcw className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </Card>
    </AppShell>
  );
}
