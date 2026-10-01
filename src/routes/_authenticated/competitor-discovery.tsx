import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ExternalLink, Loader2, Pause, Play, Plus, RotateCcw, Search, Sparkles, Square, Trash2, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  cleanDomainResults,
  controlDomainRun,
  createDomain,
  decideDomainPage,
  getDomainState,
  listDomains,
  saveDomain,
  startDomainRun,
  suggestDomainKeywords,
  type DomainPage,
} from "@/lib/domain-discovery.functions";

export const Route = createFileRoute("/_authenticated/competitor-discovery")({
  head: () => ({
    meta: [
      { title: "اكتشاف منافسين | Kashaf" },
      { name: "description", content: "اكتشف صفحات منافسة جديدة في مجالك من الإعلانات النشطة وراجعها قبل إضافتها." },
      { property: "og:title", content: "اكتشاف منافسين | Kashaf" },
      { property: "og:description", content: "اكتشف صفحات منافسة جديدة في مجالك من الإعلانات النشطة وراجعها قبل إضافتها." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CompetitorDiscoveryPage,
});

const PHASE_LABEL: Record<string, string> = {
  search: "جمع الإعلانات النشطة (بدون ذكاء اصطناعي)",
  analysis: "تحليل الصفحات بالذكاء الاصطناعي",
  review: "بانتظار مراجعتك",
  done: "انتهت",
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">{n}</span>
        {title}
      </h2>
      {children}
    </Card>
  );
}

function CompetitorDiscoveryPage() {
  const qc = useQueryClient();
  const fetchDomains = useServerFn(listDomains);
  const domainsQ = useQuery({ queryKey: ["cd-domains"], queryFn: () => fetchDomains() });
  const domains = domainsQ.data ?? [];
  const [domainId, setDomainIdState] = useState<string>("");
  const domainIdRef = useRef("");
  const setDomainId = (id: string) => {
    domainIdRef.current = id;
    setDomainIdState(id);
    try { if (id) localStorage.setItem("cd-domain", id); } catch { /* ignore */ }
  };
  useEffect(() => {
    if (domainIdRef.current || !domains.length) return;
    let saved = "";
    try { saved = localStorage.getItem("cd-domain") ?? ""; } catch { /* ignore */ }
    if (saved && domains.some((d) => d.id === saved)) setDomainId(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domains]);
  const domain = domains.find((d) => d.id === domainId) ?? null;

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [desc, setDesc] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [kwInput, setKwInput] = useState("");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editVal, setEditVal] = useState("");

  const savedKwKey = JSON.stringify(domain?.keywords ?? []);
  useEffect(() => {
    setDesc(domain?.description ?? "");
  }, [domain?.id, domain?.description]);
  useEffect(() => {
    setKeywords(domain?.keywords ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain?.id, savedKwKey]);

  const kwDirty = useMemo(() => JSON.stringify(keywords) !== JSON.stringify(domain?.keywords ?? []), [keywords, domain?.keywords]);

  const refreshDomains = () => qc.invalidateQueries({ queryKey: ["cd-domains"] });

  const create = useServerFn(createDomain);
  const createM = useMutation({
    mutationFn: () => create({ data: { name: newName, description: newDesc } }),
    onSuccess: async (d) => {
      toast.success(`تم حفظ المجال «${d.name}». المجال المختار لم يتغير.`);
      setAdding(false); setNewName(""); setNewDesc("");
      await refreshDomains();
      if (!domainIdRef.current) setDomainId(d.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useServerFn(saveDomain);
  const saveDescM = useMutation({
    mutationFn: () => save({ data: { domainId, description: desc } }),
    onSuccess: () => { toast.success("تم حفظ الوصف."); refreshDomains(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const approveM = useMutation({
    mutationFn: () => save({ data: { domainId, keywords } }),
    onSuccess: () => { toast.success("تم اعتماد الكلمات البحثية."); refreshDomains(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const suggest = useServerFn(suggestDomainKeywords);
  const suggestM = useMutation({
    mutationFn: async () => ({ forId: domainId, r: await suggest({ data: { domainId } }) }),
    onSuccess: ({ forId, r }) => {
      if (forId !== domainIdRef.current) {
        toast.info("وصلت الكلمات المقترحة لمجال آخر غير المختار حاليًا، فلم تُعرض هنا. ارجع لذلك المجال واطلبها مجددًا.");
        refreshDomains();
        return;
      }
      setDesc(r.description);
      const merged = [...keywords];
      for (const k of r.keywords) if (!merged.includes(k)) merged.push(k);
      setKeywords(merged);
      toast.success(`تم اقتراح ${r.keywords.length} كلمة${r.adsUsed ? ` من ${r.adsUsed} إعلانات حديثة` : ""}. راجعها ثم اعتمدها.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fetchState = useServerFn(getDomainState);
  const stateQ = useQuery({
    queryKey: ["cd-state", domainId],
    queryFn: () => fetchState({ data: { domainId } }),
    enabled: !!domainId,
    refetchInterval: (q) => (q.state.data?.run?.status === "running" ? 4000 : false),
  });
  const run = stateQ.data?.run ?? null;
  const pages = stateQ.data?.pages ?? [];
  const refreshState = () => qc.invalidateQueries({ queryKey: ["cd-state", domainId] });

  const start = useServerFn(startDomainRun);
  const startM = useMutation({
    mutationFn: () => start({ data: { domainId } }),
    onSuccess: () => { toast.success("بدأت عملية الاكتشاف."); refreshState(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const control = useServerFn(controlDomainRun);
  const controlM = useMutation({
    mutationFn: (cmd: "pause" | "resume" | "stop" | "cancel" | "finish") => control({ data: { runId: run!.id, cmd } }),
    onSuccess: () => refreshState(),
    onError: (e: Error) => toast.error(e.message),
  });

  const clean = useServerFn(cleanDomainResults);
  const cleanM = useMutation({
    mutationFn: () => clean({ data: { runId: run!.id } }),
    onSuccess: (r) => {
      toast.success(r.removed ? `تم تنظيف ${r.removed} صفحة. تبقى محظورة في هذا المجال فقط.` : "لا يوجد ما يُنظّف.");
      refreshState();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addKw = () => {
    const v = kwInput.trim();
    if (!v) return;
    if (keywords.some((k) => k.trim() === v)) { toast.info("الكلمة موجودة بالفعل."); return; }
    setKeywords([...keywords, v]);
    setKwInput("");
  };

  const suggested = pages.filter((p) => p.decision === "match" && p.userStatus === "pending");
  const running = run?.status === "running";

  return (
    <AppShell title="اكتشاف منافسين" description="اختر مجالًا، اعتمد كلماته البحثية، ثم راجع الصفحات المقترحة كمنافسين.">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <Step n={1} title="اختيار المجال">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              value={domainId}
              onChange={(e) => setDomainId(e.target.value)}
            >
              <option value="">{domainsQ.isLoading ? "جارٍ التحميل…" : "اختر مجالًا"}</option>
              {domains.map((d) => (
                <option key={d.id} value={d.id}>{d.name} ({d.keywords.length} كلمة)</option>
              ))}
            </select>
            <Button variant="outline" onClick={() => setAdding((v) => !v)}>
              <Plus className="ms-1 h-4 w-4" /> إضافة مجال جديد
            </Button>
          </div>
          {adding && (
            <div className="mt-3 flex flex-col gap-2 rounded-md border p-3">
              <Input placeholder="اسم المجال" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Textarea placeholder="وصف المجال: ما المنتجات أو الخدمات التي يقدمها؟" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={3} />
              <Button disabled={!newName.trim() || createM.isPending} onClick={() => createM.mutate()}>
                {createM.isPending && <Loader2 className="ms-1 h-4 w-4 animate-spin" />} حفظ المجال
              </Button>
            </div>
          )}
        </Step>

        {domain && (
          <>
            <Step n={2} title="وصف المجال">
              <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="لا يوجد وصف بعد." />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={desc === domain.description || saveDescM.isPending} onClick={() => saveDescM.mutate()}>
                  حفظ الوصف
                </Button>
                {domain.descriptionUpdatedAt && (
                  <span className="text-xs text-muted-foreground">آخر تحديث: {new Date(domain.descriptionUpdatedAt).toLocaleString("ar-EG")}</span>
                )}
              </div>
            </Step>

            <Step n={3} title="الكلمات البحثية">
              <Button size="sm" onClick={() => suggestM.mutate()} disabled={suggestM.isPending}>
                {suggestM.isPending ? <Loader2 className="ms-1 h-4 w-4 animate-spin" /> : <Sparkles className="ms-1 h-4 w-4" />}
                {domain.keywords.length ? "تحديث الكلمات البحثية" : "إنشاء الكلمات البحثية"}
              </Button>
              <div className="mt-3 flex flex-wrap gap-2">
                {keywords.length === 0 && <span className="text-sm text-muted-foreground">لا توجد كلمات بعد.</span>}
                {keywords.map((k, i) =>
                  editIdx === i ? (
                    <Input
                      key={i}
                      autoFocus
                      className="h-8 w-40"
                      value={editVal}
                      onChange={(e) => setEditVal(e.target.value)}
                      onBlur={() => {
                        const v = editVal.trim();
                        setKeywords(v ? keywords.map((x, j) => (j === i ? v : x)) : keywords.filter((_, j) => j !== i));
                        setEditIdx(null);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                  ) : (
                    <Badge key={i} variant="secondary" className="gap-1 py-1 text-sm">
                      <button type="button" onClick={() => { setEditIdx(i); setEditVal(k); }} title="تعديل">{k}</button>
                      <button type="button" aria-label={`حذف ${k}`} onClick={() => setKeywords(keywords.filter((_, j) => j !== i))}>
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ),
                )}
              </div>
              <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); addKw(); }}>
                <Input placeholder="إضافة كلمة بحثية" value={kwInput} onChange={(e) => setKwInput(e.target.value)} />
                <Button type="submit" variant="outline">إضافة</Button>
              </form>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button disabled={!kwDirty || !keywords.length || approveM.isPending} onClick={() => approveM.mutate()}>
                  <Check className="ms-1 h-4 w-4" /> اعتماد الكلمات البحثية
                </Button>
                {kwDirty && <span className="text-xs text-destructive">توجد تعديلات غير معتمدة.</span>}
                {!kwDirty && domain.keywordsUpdatedAt && (
                  <span className="text-xs text-muted-foreground">معتمدة: {new Date(domain.keywordsUpdatedAt).toLocaleString("ar-EG")}</span>
                )}
              </div>
            </Step>

            <Step n={4} title="بدء الاكتشاف">
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={running || kwDirty || !domain.keywords.length || startM.isPending} onClick={() => startM.mutate()}>
                  {startM.isPending ? <Loader2 className="ms-1 h-4 w-4 animate-spin" /> : <Search className="ms-1 h-4 w-4" />}
                  {run ? "إعادة تشغيل الاكتشاف" : "بدء اكتشاف المنافسين"}
                </Button>
                {running && (
                  <>
                    {run.control === "pause" ? (
                      <Button size="sm" variant="outline" onClick={() => controlM.mutate("resume")}><Play className="ms-1 h-4 w-4" /> استئناف</Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => controlM.mutate("pause")}><Pause className="ms-1 h-4 w-4" /> إيقاف مؤقت</Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => controlM.mutate("stop")}><Square className="ms-1 h-4 w-4" /> اكتفاء</Button>
                  </>
                )}
              </div>
              {run && (
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{run.control === "pause" && running ? "موقوفة مؤقتًا" : PHASE_LABEL[run.phase] ?? run.phase}</Badge>
                    {running && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>
                  {run.phase === "search" && running && (
                    <div className="h-2 overflow-hidden rounded bg-muted">
                      <div className="h-full bg-primary transition-all" style={{ width: `${run.keysTotal ? (run.keysDone / run.keysTotal) * 100 : 0}%` }} />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-muted-foreground sm:grid-cols-4">
                    <span>الكلمات: {run.keysDone}/{run.keysTotal}{run.keysFailed ? ` (فشل ${run.keysFailed})` : ""}</span>
                    <span>إعلانات: {run.adsFound} (جديدة {run.adsNew})</span>
                    <span>صفحات: {run.pagesAnalyzed}/{run.pagesFound}</span>
                    <span>مقترح: {run.suggested} · موجود: {run.existing}</span>
                  </div>
                  {run.note && <p className="text-xs text-muted-foreground">{run.note}</p>}
                  {run.error && <p className="text-xs text-destructive">{run.error}</p>}
                  {!running && run.phase === "done" && run.keysDone < run.keysTotal && (
                    <p className="text-xs text-muted-foreground">توقفت العملية قبل إكمال كل الكلمات.</p>
                  )}
                  {run.status === "done" && run.adsFound === 0 && (
                    <p className="text-xs text-destructive">لم يُعثر على أي إعلانات نشطة — قد تكون مكتبة الإعلانات غير متاحة أو الكلمات غير مناسبة.</p>
                  )}
                </div>
              )}
            </Step>

            {run && (
              <Step n={5} title={`المنافسون المقترحون (${suggested.length})`}>
                {suggested.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{running ? "ستظهر الاقتراحات بعد التحليل." : "لا توجد اقتراحات بانتظار قرارك."}</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {suggested.map((p) => <PageCard key={p.id} p={p} onDone={refreshState} domains={domains.filter((d) => d.id !== domainId)} />)}
                  </div>
                )}
              </Step>
            )}

            {run && pages.length > 0 && (
              <Step n={6} title={`كل النتائج (${pages.length})`}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">بعد انتهائك من المقترحات، نظّف النتائج — تبقى الصفحات محظورة في هذا المجال فقط وقد تظهر في مجال آخر.</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10"
                    disabled={cleanM.isPending || suggested.length > 0}
                    onClick={() => {
                      if (window.confirm("سيتم حذف كل النتائج التي انتهى قرارها (مقبولة/مرفوضة/غير مطابقة) مع إبقائها محظورة في هذا المجال. متابعة؟")) cleanM.mutate();
                    }}
                  >
                    {cleanM.isPending ? <Loader2 className="ms-1 h-4 w-4 animate-spin" /> : <Trash2 className="ms-1 h-4 w-4" />}
                    تنظيف النتائج
                  </Button>
                </div>
                {suggested.length > 0 && (
                  <p className="mb-3 text-xs text-muted-foreground">أنهِ قرار المقترحات أولًا (موافقة أو رفض) ليتاح التنظيف.</p>
                )}
                <div className="flex flex-col gap-2">
                  {pages.filter((p) => !suggested.includes(p)).map((p) => <PageCard key={p.id} p={p} onDone={refreshState} compact />)}
                </div>
              </Step>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function statusLabel(p: DomainPage) {
  if (p.userStatus === "accepted") return "مقبول";
  if (p.userStatus === "rejected") return "مرفوض";
  if (p.userStatus === "existing") return "موجود بالفعل في المنافسين";
  if (p.status === "pending") return "بانتظار التحليل";
  if (p.status === "failed") return "فشل التحليل";
  return p.decision === "match" ? "مقترح" : "غير مطابق";
}

function DomainPicker({ domains, disabled, onPick }: { domains: { id: string; name: string }[]; disabled: boolean; onPick: (id: string, name: string) => void }) {
  const qc = useQueryClient();
  const create = useServerFn(createDomain);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const createM = useMutation({
    mutationFn: (name: string) => create({ data: { name, description: "" } }),
    onSuccess: async (d) => {
      toast.success(`تم إنشاء المجال «${d.name}» وسيُضاف إليه.`);
      await qc.invalidateQueries({ queryKey: ["cd-domains"] });
      setOpen(false); setCreating(false); setNewName(""); setQ("");
      onPick(d.id, d.name);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) { setOpen(false); setCreating(false); } };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const filtered = domains.filter((d) => !q.trim() || d.name.includes(q.trim()));
  return (
    <div ref={wrapRef} className="relative">
      <Button
        variant="outline"
        className="h-14 gap-2 active:scale-95"
        disabled={disabled}
        onClick={() => { setOpen((v) => !v); setQ(""); setCreating(false); }}
      >
        اختيار نشاط…
      </Button>
      {open && (
        <div className="absolute end-0 top-full z-50 mt-1 w-64 rounded-md border bg-popover p-2 shadow-md">
          <Input autoFocus placeholder="ابحث عن نشاط…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9" />
          <div className="mt-2 max-h-48 overflow-y-auto">
            {filtered.map((d) => (
              <button
                key={d.id}
                type="button"
                className="flex w-full items-center rounded-sm px-2 py-2 text-start text-sm hover:bg-accent"
                onClick={() => { setOpen(false); onPick(d.id, d.name); }}
              >
                {d.name}
              </button>
            ))}
            {filtered.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">لا توجد نتائج.</p>}
          </div>
          <div className="mt-2 border-t pt-2">
            {creating ? (
              <div className="flex gap-1">
                <Input autoFocus placeholder="اسم المجال الجديد" value={newName} onChange={(e) => setNewName(e.target.value)} className="h-9" />
                <Button className="h-9 shrink-0" disabled={createM.isPending || !newName.trim()} onClick={() => createM.mutate(newName.trim())}>
                  {createM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                </Button>
              </div>
            ) : (
              <button
                type="button"
                className="flex w-full items-center gap-1 rounded-sm px-2 py-2 text-start text-sm text-primary hover:bg-accent"
                onClick={() => setCreating(true)}
              >
                <Plus className="h-4 w-4" /> إنشاء مجال جديد
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PageCard({ p, onDone, compact, domains = [] }: { p: DomainPage; onDone: () => void; compact?: boolean; domains?: { id: string; name: string }[] }) {
  const decide = useServerFn(decideDomainPage);
  const m = useMutation({
    mutationFn: (v: "accept" | "reject" | "retry" | { target: string }) =>
      decide({ data: typeof v === "object" ? { pageRowId: p.id, action: "accept", targetDomainId: v.target } : { pageRowId: p.id, action: v } }),
    onSuccess: (r, v) => {
      const action = typeof v === "object" ? "accept" : v;
      if (action === "accept") toast.success(`أُضيف إلى المنافسين${typeof v === "object" ? ` تحت «${domains.find((d) => d.id === v.target)?.name ?? ""}»` : ""} وتم تسليم ${r.adsLinked ?? 0} إعلانًا للمعالجة.`);
      else if (action === "reject") toast.success("تم الرفض ولن تظهر هذه الصفحة مجددًا في هذا المجال.");
      else toast.success("أُعيدت الصفحة للتحليل.");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const canDecide = p.userStatus === "pending" && p.status === "analyzed";
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <a href={p.pageUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium hover:underline">
            {p.pageName} <ExternalLink className="h-3 w-3" />
          </a>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{statusLabel(p)}</Badge>
            {p.matchPercent !== null && <span>تطابق {Math.round(p.matchPercent)}%</span>}
            <span>{p.adsCount} إعلان</span>
            {p.lastAdAt && <span>آخر إعلان {p.lastAdAt}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canDecide && (
            <>
              <Button className="h-14 gap-2 border border-primary/50 bg-primary/10 text-primary hover:bg-primary/20 active:scale-95" disabled={m.isPending} onClick={() => m.mutate("accept")}>
                <Check className="h-5 w-5" /> موافقة
              </Button>
              <Button variant="outline" className="h-14 gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 active:scale-95" disabled={m.isPending} onClick={() => m.mutate("reject")}>
                <X className="h-5 w-5" /> رفض
              </Button>
              <DomainPicker
                domains={domains}
                disabled={m.isPending}
                onPick={(id) => m.mutate({ target: id })}
              />
            </>
          )}
          {p.status === "failed" && p.userStatus === "pending" && (
            <Button variant="outline" className="h-14 gap-2 active:scale-95" disabled={m.isPending} onClick={() => m.mutate("retry")}>
              <RotateCcw className="h-5 w-5" /> إعادة التحليل
            </Button>
          )}
        </div>
      </div>
      {!compact && p.activity && <p className="mt-2 text-sm">النشاط: {p.activity}</p>}
      {p.reason && <p className="mt-1 text-xs text-muted-foreground">{p.reason}</p>}
      {!compact && p.searchKeys.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">وُجدت عبر: {p.searchKeys.join("، ")}</p>
      )}
    </div>
  );
}
