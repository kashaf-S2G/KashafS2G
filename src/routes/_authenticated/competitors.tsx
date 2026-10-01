import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useProgressiveList } from "@/lib/use-progressive-list";
import { useLastPosition, useRemembered, useResetOnChange, useScrollMemory, restoredCount } from "@/lib/last-position";
import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { getCompetitorsPage, type CompetitorPageItem, type CompetitorsPageInput } from "@/lib/competitors.functions";
import { useServerFn } from "@tanstack/react-start";
import { searchBankEntriesAi } from "@/lib/discovery.functions";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, Sparkles, X } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ExternalLink,
  Pencil,
  Plus,
  Search,
  Trash2,
  Megaphone,
  Loader2,
} from "lucide-react";
import { CompetitorAnalyzeButton, CompetitorCollectButton, CompetitorCollectProgress, RawAnalysisControls } from "@/components/CompetitorCollectPanel";
import { AiActivityBar } from "@/components/AiActivityBar";
import { EmergencyRecheckPanel } from "@/components/EmergencyRecheckPanel";

import { AppShell } from "@/components/AppShell";
import { AdDialog } from "@/components/AdDialog";
import { CompetitorDialog } from "@/components/CompetitorDialog";
import {
  AdvancedFilter,
  matchRule,
  type FilterFieldDef,
  type FilterFieldType,
  type FilterRule,
} from "@/components/AdvancedFilter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ListCountBar, ListPager } from "@/components/ListControls";
import {
  friendlyError,
  useAds,
  useDeleteCompetitor,
  useCompetitors,
  type CompetitorRow,
} from "@/lib/kashaf";

type CompetitorFilterSummary = CompetitorRow & { totalAds: number; activeAds: number };

const COMPETITOR_FIELD_VALUES: Record<string, (competitor: CompetitorFilterSummary) => string[]> = {
  name: (competitor) => [competitor.competitor_name],
  url: (competitor) => [competitor.competitor_url],
  platform: (competitor) => [competitor.platform],
  niche: (competitor) => [competitor.niche],
  totalAds: (competitor) => [String(competitor.totalAds)],
  activeAds: (competitor) => [String(competitor.activeAds)],
};

const COMPETITOR_FIELD_LABELS: { id: string; label: string; type: FilterFieldType }[] = [
  { id: "name", label: "اسم المنافس", type: "text" },
  { id: "url", label: "رابط المنافس", type: "text" },
  { id: "platform", label: "المنصة", type: "text" },
  { id: "niche", label: "الفئة", type: "text" },
  { id: "totalAds", label: "عدد الإعلانات", type: "number" },
  { id: "activeAds", label: "الإعلانات النشطة", type: "number" },
];


export const Route = createFileRoute("/_authenticated/competitors")({
  validateSearch: (search: Record<string, unknown>): { product?: string | undefined; compare?: boolean | undefined } => ({
    product: typeof search['product'] === "string" ? search['product'] : undefined,
    compare: search['compare'] === 1 || search['compare'] === "1" || search['compare'] === true ? true : undefined,
  }),
  head: () => ({
    meta: [
      { title: "المنافسون | Kashaf" },
      { name: "description", content: "أضف وأدر المنافسين مع عدد إعلاناتهم النشطة." },
      { property: "og:title", content: "المنافسون | Kashaf" },
      { property: "og:description", content: "أضف وأدر المنافسين مع عدد إعلاناتهم النشطة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CompetitorsRoute,
});

function CompetitorsRoute() {
  const navigate = useNavigate();
  const { product, compare } = Route.useSearch();
  const { userId } = useAuth();
  const fetchPage = useServerFn(getCompetitorsPage);
  const deleteCompetitor = useDeleteCompetitor();

  const lp = useLastPosition(`competitors:${product ?? ""}`);
  const [search, setSearch] = useRemembered(lp, "search", "");
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const [sortBy, setSortBy] = useRemembered<"newest" | "name">(lp, "sort", "newest");
  const [rules, setRules] = useRemembered<FilterRule[]>(lp, "rules", []);
  const [aiIdList, setAiIdList] = useRemembered<string[] | null>(lp, "aiIds", null);
  const aiIds = useMemo<ReadonlySet<string> | null>(() => (aiIdList ? new Set(aiIdList) : null), [aiIdList]);
  const setAiIds = (v: ReadonlySet<string> | null) => setAiIdList(v ? [...v] : null);
  const [aiQuery, setAiQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [competitorDialog, setCompetitorDialog] = useState<{ open: boolean; competitor?: CompetitorRow | null }>({ open: false });
  const [adDialog, setAdDialog] = useState<{ open: boolean; competitorId?: string }>({ open: false });
  const [toDelete, setToDelete] = useState<CompetitorPageItem | null>(null);
  // قائمة المنافسين الكاملة تُطلب فقط عند فتح نافذة "إعلان جديد" (قائمة الاختيار فيها).
  const { data: dialogCompetitors = [] } = useCompetitors(adDialog.open);

  // نفس سلوك usePagedList: الصفحة تُحفظ في ذاكرة المتصفح وتعود لـ 1 عند تغيّر النتائج أو حجم الصفحة.
  const [pageSize, setPageSize] = useRemembered<number | "all">(lp, "pageSize", 20);
  const [page, setPage] = useRemembered(lp, "page", 1);


  const baseInput = {
    search: debouncedSearch,
    product: product || undefined,
    aiIds: aiIds ? [...aiIds] : null,
    rules: rules.map(({ field, op, value }) => ({ field, op, value })),
    sort: sortBy,
  };
  const filterKey = JSON.stringify(baseInput);

  // البحث والفلاتر والترتيب والتقسيم والأعداد تتم في قاعدة البيانات؛ المتصفح يستلم الصفحة الحالية فقط.
  const { data: pageData, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["competitors", userId, "page", filterKey, page, pageSize],
    enabled: Boolean(userId),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: () => fetchPage({ data: { ...baseInput, page, pageSize } }),
  });

  const total = pageData?.total ?? 0;
  const pageCount = pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / pageSize));
  useResetOnChange(lp, `${filterKey}|${pageSize}`, () => setPage(1));
  useEffect(() => {
    if (pageData && page > pageCount) setPage(pageCount);
  }, [pageData, page, pageCount]);

  const filtered = pageData?.items ?? [];
  const progressive = useProgressiveList(filtered, `${filterKey}|${page}|${pageSize}`, 30, restoredCount(lp));
  useScrollMemory(lp, Boolean(pageData) && !isPlaceholderData, progressive.shown.length);
  const filteredIds = pageData?.filteredIds ?? [];
  const paged = { visible: filtered, total, page: Math.min(page, pageCount), pageCount, pageSize, setPage, setPageSize };

  const fields: FilterFieldDef[] = useMemo(
    () => COMPETITOR_FIELD_LABELS.map((field) => ({ ...field, options: pageData?.options[field.id] ?? [] })),
    [pageData?.options],
  );

  const aiSearch = useServerFn(searchBankEntriesAi);
  const aiMutation = useMutation({
    mutationFn: async (query: string) => {
      // مدخلات البحث الذكي كما كانت: كل المنافسين مع أعدادهم (تُطلب عند الضغط فقط).
      const all = await fetchPage({
        data: { search: "", aiIds: null, rules: [], sort: "newest", page: 1, pageSize: "all" },
      });
      return aiSearch({
        data: {
          query,
          entries: all.items.map((p) => ({
            id: p.id,
            term: `${p.competitor_name} — ${p.niche} — ${p.platform} — إعلانات نشطة: ${p.active_ads} — إجمالي الإعلانات: ${p.total_ads}`,
          })),
        },
      });
    },
    onSuccess: (ids) => {
      if (ids.length === 0) toast.info("لا يوجد منافسون مرتبطون ببحثك.");
      else toast.success(`وجدت ${ids.length} منافسًا مرتبطًا.`);
      setAiIds(new Set(ids));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // تذكّر مكان التمرير في ذاكرة المتصفح والرجوع له عند العودة للصفحة.

  const selectedCount = selected.size;
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllFiltered = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) for (const id of filteredIds) next.delete(id);
      else for (const id of filteredIds) next.add(id);
      return next;
    });

  const [crawlOpen, setCrawlOpen] = useState(false);

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteCompetitor.mutateAsync(toDelete.id);
      toast.success("تم حذف المنافس وإعلاناته");
    } catch (error) {
      toast.error(friendlyError(error));
    }
    setToDelete(null);
  };

  return (
    <AppShell
      title="المنافسون"
      description="المنافسون الذين تتابعهم."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setCompetitorDialog({ open: true, competitor: null })}>
            <Plus className="size-4" />
            إضافة منافس
          </Button>
        </div>

      }
    >
      <Collapsible open={crawlOpen} onOpenChange={setCrawlOpen} className="mb-4">
        <div className="rounded-lg border bg-card">
          <CollapsibleTrigger asChild>
            <button type="button" className="flex w-full items-center justify-between gap-2 p-4 text-start">
              <span className="flex items-center gap-2 font-medium">
                <Sparkles className="size-4 text-primary" /> زحف المنافسين والتحليل بالذكاء الاصطناعي
              </span>
              <ChevronDown className={cn("size-4 transition-transform", crawlOpen && "rotate-180")} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t p-4">
              <div className="mb-4 flex flex-wrap gap-2">
                <CompetitorCollectButton selectedIds={[...selected]} />
                <CompetitorAnalyzeButton />
              </div>
              <CompetitorCollectProgress />
              <RawAnalysisControls />
              <EmergencyRecheckPanel />
              <AiActivityBar className="mb-0" />
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو الرابط..."
            className="pe-9"
          />
        </div>
        <AdvancedFilter fields={fields} rules={rules} onChange={setRules} />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
          aria-label="ترتيب المنافسين"
        >
          <option value="newest">الأحدث إضافة</option>
          <option value="name">الاسم</option>
        </select>
      </div>

      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (aiQuery.trim() && !aiMutation.isPending) aiMutation.mutate(aiQuery.trim());
        }}
      >
        <div className="relative flex-1">
          <Sparkles className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={aiQuery}
            onChange={(e) => setAiQuery(e.target.value)}
            placeholder="بحث ذكي... مثال: المنافسون الذين يعملون فى مجال الملابس"
            className="pe-9"
            aria-label="بحث ذكي بالمعنى"
          />
        </div>
        <Button type="submit" variant="secondary" disabled={aiMutation.isPending || !aiQuery.trim()}>
          {aiMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          بحث ذكي
        </Button>
        {aiIds && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setAiIds(null);
              setAiQuery("");
            }}
          >
            <X className="size-4" />
            إلغاء
          </Button>
        )}
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={allFilteredSelected} onCheckedChange={toggleAllFiltered} />
          تحديد كل النتائج ({filteredIds.length})
        </label>
        <span className="text-muted-foreground">المحدد: {selectedCount}</span>
        {selectedCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setSelected(new Set())}
          >
            مسح التحديد
          </Button>
        )}
      </div>

      {compare ? <CompetitorsCompare input={baseInput} page={paged.page} pageSize={pageSize} /> : null}

      <ListCountBar paged={paged} noun="منافس" />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">لا يوجد منافسون مطابقون. أضف منافسًا جديدًا للبدء.</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {progressive.shown.map((competitor) => {
            const c = { total: competitor.total_ads, active: competitor.active_ads };
            return (
              <Card
                key={competitor.id}
                className={`cv-auto flex flex-col ${selected.has(competitor.id) ? "ring-2 ring-primary" : ""}`}
              >
                <CardHeader className="pb-3">
                  <CardTitle className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 text-base">
                    <Checkbox
                      className="mt-1"
                      checked={selected.has(competitor.id)}
                      onCheckedChange={() => toggleOne(competitor.id)}
                      aria-label={`تحديد ${competitor.competitor_name}`}
                    />
                    <span className="min-w-0 break-words">{competitor.competitor_name}</span>
                    <Badge variant="outline" className="shrink-0">{competitor.platform}</Badge>
                  </CardTitle>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 w-full justify-center gap-2"
                    onClick={() => window.open(competitor.competitor_url, "_blank", "noopener,noreferrer")}
                  >
                    <ExternalLink className="size-4 shrink-0" />
                    زيارة المنافس
                  </Button>
                </CardHeader>
                <CardContent className="flex-1 space-y-3">
                  <p className="text-sm text-muted-foreground">المجال: {competitor.niche}</p>
                  <div className="flex gap-2">
                    <div className="flex-1 rounded-lg bg-muted p-3 text-center">
                      <p className="text-xl font-bold">{c.total}</p>
                      <p className="text-xs text-muted-foreground">إعلان</p>
                    </div>
                    <div className="flex-1 rounded-lg bg-muted p-3 text-center">
                      <p className="text-xl font-bold text-primary">{c.active}</p>
                      <p className="text-xs text-muted-foreground">نشط</p>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => navigate({ to: "/ads", search: { competitorId: competitor.id } })}
                  >
                    عرض الإعلانات
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAdDialog({ open: true, competitorId: competitor.id })}>
                    <Megaphone className="size-4" />
                    إعلان جديد
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCompetitorDialog({ open: true, competitor })}>
                    <Pencil className="size-4" />
                    تعديل
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setToDelete(competitor)}>
                    <Trash2 className="size-4 text-destructive" />
                    حذف
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
          {progressive.sentinel}
        </div>
      )}

      <ListPager paged={paged} />

      <CompetitorDialog
        open={competitorDialog.open}
        competitor={competitorDialog.competitor}
        onOpenChange={(open) => setCompetitorDialog((s) => ({ ...s, open }))}
      />
      <AdDialog
        open={adDialog.open}
        competitors={dialogCompetitors}
        defaultCompetitorId={adDialog.competitorId}
        onOpenChange={(open) => setAdDialog((s) => ({ ...s, open }))}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المنافس؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف «{toDelete?.competitor_name}» مع {toDelete?.total_ads ?? 0} إعلان مرتبط بها. لا يمكن
              التراجع.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

/**
 * وضع المقارنة (?compare=1): يشغّل المنطق القديم في المتصفح (كل المنافسين + كل الإعلانات)
 * ويقارنه بنتيجة قاعدة البيانات لنفس البحث والفلاتر وفلتر المنتج والترتيب، عنصرًا بعنصر.
 */
function CompetitorsCompare({
  input,
  page,
  pageSize,
}: {
  input: Omit<CompetitorsPageInput, "page" | "pageSize">;
  page: number;
  pageSize: number | "all";
}) {
  const { userId } = useAuth();
  const fetchPage = useServerFn(getCompetitorsPage);
  const { data: competitors, isLoading: l1 } = useCompetitors();
  const { data: ads, isLoading: l2 } = useAds();
  const key = JSON.stringify(input);
  const { data: server } = useQuery({
    queryKey: ["competitors", userId, "compare-all", key],
    enabled: Boolean(userId),
    queryFn: () => fetchPage({ data: { ...input, page: 1, pageSize: "all" } }),
  });
  const { data: serverPage } = useQuery({
    queryKey: ["competitors", userId, "compare-page", key, page, pageSize],
    enabled: Boolean(userId),
    queryFn: () => fetchPage({ data: { ...input, page, pageSize } }),
  });
  if (l1 || l2 || !competitors || !ads || !server || !serverPage)
    return <p className="mb-4 text-sm">جارٍ تحميل المنطق القديم للمقارنة…</p>;

  // ===== المنطق القديم كما هو =====
  const counts = new Map<string, { total: number; active: number }>();
  for (const ad of ads) {
    const entry = counts.get(ad.competitor_id) ?? { total: 0, active: 0 };
    entry.total += 1;
    if (ad.status === "active") entry.active += 1;
    counts.set(ad.competitor_id, entry);
  }
  const summaries: CompetitorFilterSummary[] = competitors.map((c) => {
    const n = counts.get(c.id) ?? { total: 0, active: 0 };
    return { ...c, totalAds: n.total, activeAds: n.active };
  });
  const fields = COMPETITOR_FIELD_LABELS.map((field) => {
    const values = new Set<string>();
    const getter = COMPETITOR_FIELD_VALUES[field.id]!;
    for (const c of summaries) for (const v of getter(c)) if (v) values.add(v);
    return {
      ...field,
      options: [...values].sort((a, b) => (field.type === "number" ? Number(a) - Number(b) : a.localeCompare(b, "ar"))),
    };
  });
  let productIds: Set<string> | null = null;
  if (input.product) {
    const q = input.product.trim().toLowerCase();
    productIds = new Set();
    for (const ad of ads) if (ad.status === "active" && ad.product_name.trim().toLowerCase() === q) productIds.add(ad.competitor_id);
  }
  const aiSet = input.aiIds ? new Set(input.aiIds) : null;
  const q = (input.search ?? "").trim().toLowerCase();
  const rules = (input.rules ?? []) as FilterRule[];
  const oldFiltered = summaries.filter((p) => {
    if (productIds && !productIds.has(p.id)) return false;
    if (aiSet && !aiSet.has(p.id)) return false;
    if (q && !p.competitor_name.toLowerCase().includes(q) && !p.competitor_url.toLowerCase().includes(q)) return false;
    return rules.every((rule) => {
      const def = fields.find((f) => f.id === rule.field);
      const getter = COMPETITOR_FIELD_VALUES[rule.field];
      return !def || !getter ? true : matchRule(getter(p), rule, def.type);
    });
  });
  const old =
    input.sort === "name"
      ? [...oldFiltered].sort((a, b) => a.competitor_name.localeCompare(b.competitor_name, "ar"))
      : oldFiltered;
  const oldPage =
    pageSize === "all" ? old : old.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  // ===== المقارنة =====
  const pickOld = (p: CompetitorFilterSummary) => [p.id, p.competitor_name, p.totalAds, p.activeAds];
  const pickNew = (p: CompetitorPageItem) => [p.id, p.competitor_name, p.total_ads, p.active_ads];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const checks: [string, boolean][] = [
    ["إجمالي النتائج", old.length === server.total],
    ["إجمالي المنافسين", summaries.length === server.allTotal],
    ["المعرّفات والترتيب", same(old.map((p) => p.id), server.items.map((p) => p.id))],
    ["الأسماء", same(old.map((p) => p.competitor_name), server.items.map((p) => p.competitor_name))],
    ["إجمالي الإعلانات", same(old.map((p) => p.totalAds), server.items.map((p) => p.total_ads))],
    ["الإعلانات النشطة", same(old.map((p) => p.activeAds), server.items.map((p) => p.active_ads))],
    ["تحديد كل النتائج", same(old.map((p) => p.id), server.filteredIds)],
    ["قوائم الفلاتر", fields.every((f) => same(f.options, server.options[f.id] ?? []))],
    ["الصفحة الحالية", same(oldPage.map(pickOld), serverPage.items.map(pickNew)) && serverPage.total === old.length],
  ];
  let firstDiff: string | null = null;
  for (let i = 0; i < Math.max(old.length, server.items.length) && !firstDiff; i += 1) {
    const a = old[i] ? pickOld(old[i]!) : null;
    const b = server.items[i] ? pickNew(server.items[i]!) : null;
    if (!same(a, b)) firstDiff = `#${i + 1}: قديم ${JSON.stringify(a)} / جديد ${JSON.stringify(b)}`;
  }
  const badOptions = fields.filter((f) => !same(f.options, server.options[f.id] ?? [])).map((f) => f.label);
  const ok = checks.every(([, v]) => v);
  return (
    <Card className="mb-4 p-3 text-sm" data-compare-result={ok ? "match" : "mismatch"}>
      <p className="font-semibold">{ok ? "✅ مطابق" : "❌ غير مطابق"}</p>
      <p>
        الإجمالي: قديم {old.length} من {summaries.length} / جديد {server.total} من {server.allTotal}
      </p>
      {checks.map(([label, v]) => (
        <p key={label}>
          {label}: {v ? "مطابق" : "مختلف"}
        </p>
      ))}
      {firstDiff && <p className="text-destructive">أول اختلاف: {firstDiff}</p>}
      {badOptions.length > 0 && <p className="text-destructive">قوائم مختلفة: {badOptions.join("، ")}</p>}
    </Card>
  );
}
