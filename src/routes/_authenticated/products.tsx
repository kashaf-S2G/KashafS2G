import { createFileRoute } from "@tanstack/react-router";
import { useProgressiveList } from "@/lib/use-progressive-list";
import { useLastPosition, useRemembered, useResetOnChange, useScrollMemory, restoredCount } from "@/lib/last-position";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Search, Sparkles, Trash2, X } from "lucide-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { searchBankEntriesAi } from "@/lib/discovery.functions";


import { AppShell } from "@/components/AppShell";
import {
  AdvancedFilter,
  matchRule,
  type FilterFieldDef,
  type FilterFieldType,
  type FilterRule,
} from "@/components/AdvancedFilter";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ListCountBar, ListPager } from "@/components/ListControls";
import { useAuth } from "@/hooks/useAuth";
import { getProductAiEntriesDb, getProductsPage, getProductsPageDb } from "@/lib/products.functions";
import { getPbStatementProducts } from "@/lib/problems-benefits.functions";
import { PRODUCT_FIELD_LABELS, PRODUCT_FIELD_VALUES, type ProductListItem } from "@/lib/products-listing";
import { useAds, useDeleteProduct, useProductCodeOverrides, useProductsTable } from "@/lib/kashaf";
import { NewProductDialog } from "@/components/NewProductDialog";
import { EditProductDialog } from "@/components/EditProductDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ProductCard } from "@/components/ProductCard";
import { ProductCrawlPanel } from "@/components/ProductCrawlPanel";
import { AiActivityBar } from "@/components/AiActivityBar";


import { summarize, withStandaloneProducts } from "@/lib/product-summary";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/products")({
  head: () => ({
    meta: [
      { title: "المنتجات | Kashaf" },
      {
        name: "description",
        content: "كل منتج فريد مع عدد المنافسين والإعلانات النشطة والمتوقفة وأيام النشاط والتوقف.",
      },
      { property: "og:title", content: "المنتجات | Kashaf" },
      {
        property: "og:description",
        content: "كل منتج فريد مع عدد المنافسين والإعلانات النشطة والمتوقفة وأيام النشاط والتوقف.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { compare?: boolean | undefined; pb?: string | undefined } => ({
    compare: search["compare"] === 1 || search["compare"] === "1" || search["compare"] === true ? true : undefined,
    pb: typeof search["pb"] === "string" && search["pb"] ? search["pb"] : undefined,
  }),
  component: ProductsRoute,
});

function ProductsRoute() {
  const { compare, pb } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { userId } = useAuth();
  const fetchPage = useServerFn(getProductsPageDb);
  const fetchAiEntries = useServerFn(getProductAiEntriesDb);
  const fetchPbProducts = useServerFn(getPbStatementProducts);
  const lp = useLastPosition(`products:${pb ?? ""}`);
  const [search, setSearch] = useRemembered(lp, "search", "");
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const [rules, setRules] = useRemembered<FilterRule[]>(lp, "rules", []);
  const [aiIdList, setAiIdList] = useRemembered<string[] | null>(lp, "aiIds", null);
  const aiIds = useMemo<ReadonlySet<string> | null>(() => (aiIdList ? new Set(aiIdList) : null), [aiIdList]);
  const setAiIds = (v: ReadonlySet<string> | null) => setAiIdList(v ? [...v] : null);
  // فلتر «المنتجات المرتبطة بمشكلة/فائدة» القادم من صفحة المشاكل والفوائد.
  const { data: pbFilter } = useQuery({
    queryKey: ["pb-statement-products", userId, pb],
    enabled: Boolean(userId && pb),
    queryFn: () => fetchPbProducts({ data: { statementId: pb! } }),
  });
  useEffect(() => {
    if (pb && pbFilter) setAiIds(new Set(pbFilter.keys));
  }, [pb, pbFilter]);
  const clearPb = () => {
    setAiIds(null);
    navigate({ search: (s) => ({ ...s, pb: undefined }) });
  };
  const [aiQuery, setAiQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [page, setPage] = useRemembered(lp, "page", 1);
  const [pageSize, setPageSize] = useRemembered<number | "all">(lp, "pageSize", 20);
  const deleteProduct = useDeleteProduct();
  const isUuid = (k: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k);

  const input = {
    search: debouncedSearch,
    rules,
    aiIds: aiIds ? [...aiIds] : null,
  };
  const filterKey = JSON.stringify(input);
  useResetOnChange(lp, `${filterKey}|${pageSize}`, () => setPage(1));

  // التجميع والبحث والفلاتر تتم على الخادم؛ المتصفح يستلم الصفحة المطلوبة فقط.
  const listingKey = ["products-table", "listing", userId, filterKey, page, pageSize] as const;
  const queryClientDiag = useQueryClient();
  const { data: pageData, isLoading, isPlaceholderData, dataUpdatedAt } = useQuery({
    queryKey: listingKey,
    enabled: Boolean(userId),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      console.log("[DIAG] BACKEND_REQUEST_START", { page, pageSize });
      const r = await fetchPage({ data: { ...input, page, pageSize } });
      console.log("[DIAG] BACKEND_RESULT_COUNT", r.items.length, "total", r.total);
      return r;
    },
  });
  // [DIAG] تشخيص مؤقت لمصدر بيانات المنتجات — يُحذف بعد التشخيص.
  useEffect(() => {
    const cached = queryClientDiag.getQueryState(listingKey);
    console.log("[DIAG] CACHE_KEY", JSON.stringify(listingKey));
    console.log("[DIAG] CACHE_SOURCE", cached?.data ? `in-memory (restored/prev) updatedAt=${new Date(cached.dataUpdatedAt).toISOString()}` : isPlaceholderData ? "placeholder (keepPreviousData of other key)" : "none");
    const all = queryClientDiag.getQueryCache().findAll({ queryKey: ["products-table", "listing"] });
    console.log("[DIAG] CACHE_ITEM_COUNT per key", all.map((q) => ({ key: q.queryKey.slice(4), items: (q.state.data as { items?: unknown[] } | undefined)?.items?.length ?? 0 })));
    if (pageData) console.log(isPlaceholderData ? "[DIAG] PRODUCTS_RENDER_FROM_PLACEHOLDER" : "[DIAG] PRODUCTS_RENDER_FROM_CACHE_OR_FETCH", "FINAL_RENDER_COUNT", pageData.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize, page, filterKey, dataUpdatedAt, isPlaceholderData]);

  const aiSearch = useServerFn(searchBankEntriesAi);
  const aiMutation = useMutation({
    mutationFn: async (query: string) =>
      aiSearch({ data: { query, entries: await fetchAiEntries() } }),
    onSuccess: (ids) => {
      if (ids.length === 0) toast.info("لا توجد منتجات مرتبطة ببحثك.");
      else toast.success(`وجدت ${ids.length} منتجًا مرتبطًا.`);
      setAiIds(new Set(ids));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // القوائم المنسدلة تُبنى على الخادم من البيانات الحالية، فأي قيمة جديدة تظهر تلقائيًا.
  const fields: FilterFieldDef[] = useMemo(
    () => PRODUCT_FIELD_LABELS.map((f) => ({ ...f, options: pageData?.options[f.id] ?? [] })),
    [pageData?.options],
  );

  const total = pageData?.total ?? 0;
  const pageCount = pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const filtered = pageData?.items ?? [];
  const progressive = useProgressiveList(filtered, `${filterKey}|${page}|${pageSize}`, 30, restoredCount(lp));
  useScrollMemory(lp, Boolean(pageData) && !isPlaceholderData, progressive.shown.length);
  const filteredKeys = pageData?.filteredKeys ?? [];
  const allCount = pageData?.allTotal ?? 0;
  const paged = { visible: filtered, total, page: Math.min(page, pageCount), pageCount, pageSize, setPage, setPageSize };

  // التحديد حالة مستقلة مرتبطة بمعرّف المنتج، لا تتأثر بالبحث أو الفلاتر أو الترتيب.
  const selectedCount = selected.size;
  // مفاتيح المنتجات الموحّدة فقط تصلح لزحف المنتجات (المنتجات غير الموحّدة تُستثنى).
  const selectedProductIds = useMemo(
    () => [...selected].filter((k) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)),
    [selected],
  );
  const allFilteredSelected = filteredKeys.length > 0 && filteredKeys.every((k) => selected.has(k));


  const toggleOne = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleAllFiltered = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) for (const k of filteredKeys) next.delete(k);
      else for (const k of filteredKeys) next.add(k);
      return next;
    });


  return (
    <AppShell
      title="المنتجات"
      description="كل منتج فريد وأرقامه مستنبطة تلقائيًا من المنافسين والإعلانات."
    >
      <Collapsible defaultOpen={false} open={discoveryOpen} onOpenChange={setDiscoveryOpen}>
        <Card className="mb-4 overflow-hidden">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between p-4 text-start hover:bg-muted/50"
            >
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-base font-bold">البحث والزحف</h2>
                {!discoveryOpen && selectedCount > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>تم تحديد {selectedCount} منتج</span>
                  </div>
                )}
              </div>
              <ChevronDown className={cn("size-4 transition-transform", discoveryOpen && "rotate-180")} />
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="border-t p-4">
              <div className="mb-6 flex items-center gap-2">
                <div className="relative flex-1 sm:max-w-md">
                  <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="ابحث باسم المنتج أو معرفه..."
                    className="pe-9"
                  />
                </div>
                <AdvancedFilter fields={fields} rules={rules} onChange={setRules} />
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
                    placeholder="بحث ذكي... مثال: المنتجات اللي ليها أكثر من 3 منافسين"
                    className="pe-9"
                    aria-label="بحث ذكي بالمعنى داخل المنتجات"
                  />
                </div>
                <Button type="submit" variant="secondary" disabled={aiMutation.isPending || !aiQuery.trim()}>
                  {aiMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
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

              <ProductCrawlPanel selectedIds={selectedProductIds} />
              <AiActivityBar />
            </div>


          </CollapsibleContent>
        </Card>
      </Collapsible>

      <div className="mb-4 flex justify-end">
        <NewProductDialog />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
        <Button type="button" size="sm" variant={allFilteredSelected ? "default" : "outline"} onClick={toggleAllFiltered}>
          {allFilteredSelected ? "إلغاء تحديد الكل" : "تحديد كل النتائج"} ({filteredKeys.length})
        </Button>
        <span className="text-muted-foreground">تم تحديد {selectedCount} منتج</span>
        {selectedCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setSelected(new Set())}
          >
            إلغاء تحديد الكل
          </Button>
        )}
        {aiIds && !pb ? <span className="text-xs text-muted-foreground">(نتائج بحث ذكي — التحديد يدوي)</span> : null}
      </div>
      {pb ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span>
            المنتجات التي {pbFilter?.kind === "benefit" ? "تحقق الفائدة" : "تحل المشكلة"}:{" "}
            <b>{pbFilter?.text ?? "..."}</b>
          </span>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={clearPb}>
            <X className="size-3.5" />
            عرض كل المنتجات
          </Button>
        </div>
      ) : null}





      <ListCountBar paged={paged} noun="منتج" />

      {compare ? <ProductsCompare search={debouncedSearch} rules={rules} aiIds={aiIds} /> : null}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {allCount === 0 ? "أضف منتجًا جديدًا أو إعلانات لتظهر المنتجات هنا." : "لا توجد منتجات مطابقة."}
          </p>
        </Card>
      ) : (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:gap-4">
          {progressive.shown.map((p) => (
            <ProductCard
              key={p.key}
              product={p}
              selected={selected.has(p.key)}
              onToggleSelect={() => toggleOne(p.key)}
              footer={
                isUuid(p.key) ? (
                  <>
                    <EditProductDialog product={p} />
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 text-[11px] text-destructive hover:text-destructive sm:h-8 sm:gap-1.5 sm:text-xs"
                        >
                          <Trash2 className="size-3.5 sm:size-4" />
                          حذف
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent dir="rtl">
                        <AlertDialogHeader>
                          <AlertDialogTitle>حذف «{p.name}»؟</AlertDialogTitle>
                          <AlertDialogDescription>
                            سيُحذف المنتج وكل بياناته الملحقة نهائيًا. لا يمكن التراجع عن هذا الإجراء.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>إلغاء</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() =>
                              deleteProduct.mutate(
                                { id: p.key, key: p.key },
                                {
                                  onSuccess: () => {
                                    toast.success("تم حذف المنتج.");
                                    setSelected((prev) => {
                                      const next = new Set(prev);
                                      next.delete(p.key);
                                      return next;
                                    });
                                  },
                                  onError: (err: Error) => toast.error(err.message),
                                },
                              )
                            }
                          >
                            حذف نهائي
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                ) : undefined
              }
            />
          ))}
          {progressive.sentinel}
        </div>
      )}

      <ListPager paged={paged} />
    </AppShell>
  );
}

/**
 * وضع المقارنة (?compare=1): يشغّل المنطق القديم في المتصفح (كل الإعلانات + summarize)
 * ويقارنه بنتيجة الخادم لنفس البحث والفلاتر، حقلًا بحقل وبنفس الترتيب.
 */
function ProductsCompare({
  search,
  rules,
  aiIds,
}: {
  search: string;
  rules: FilterRule[];
  aiIds: ReadonlySet<string> | null;
}) {
  const { userId } = useAuth();
  const { data: ads, isLoading: l1 } = useAds();
  const { data: codeOverrides, isLoading: l2 } = useProductCodeOverrides();
  const { data: productRows, isLoading: l3 } = useProductsTable();
  const fetchPage = useServerFn(getProductsPageDb);
  const fetchLegacy = useServerFn(getProductsPage);
  const input = { search, rules, aiIds: aiIds ? [...aiIds] : null };
  const { data: server } = useQuery({
    queryKey: ["products-table", "compare", userId, JSON.stringify(input)],
    enabled: Boolean(userId),
    queryFn: () => fetchPage({ data: { ...input, page: 1, pageSize: "all" } }),
  });
  const { data: legacy } = useQuery({
    queryKey: ["products-table", "compare-legacy", userId, JSON.stringify(input)],
    enabled: Boolean(userId),
    queryFn: () => fetchLegacy({ data: { ...input, page: 1, pageSize: "all" } }),
  });
  if (l1 || l2 || l3 || !ads || !productRows || !server || !legacy)
    return <p className="mb-4 text-sm">جارٍ تحميل المنطق القديم للمقارنة…</p>;

  const products: ProductListItem[] = withStandaloneProducts(summarize(ads, codeOverrides), productRows);
  const fields = PRODUCT_FIELD_LABELS;
  const q = search.trim().toLowerCase();
  const old = products.filter((p) => {
    if (aiIds && !aiIds.has(p.key)) return false;
    if (q && !p.name.toLowerCase().includes(q) && !p.code.toLowerCase().includes(q)) return false;
    return rules.every((rule) => {
      const def = fields.find((f) => f.id === rule.field);
      if (!def) return true;
      return matchRule(PRODUCT_FIELD_VALUES[rule.field]!(p), rule, def.type);
    });
  });
  const pick = (p: ProductListItem) => ({
    key: p.key,
    name: p.name,
    code: p.code,
    image: p.image,
    description: p.description,
    totalAds: p.totalAds,
    activeAds: p.activeAds,
    stoppedAds: p.stoppedAds,
    activeCompetitors: p.activeCompetitors,
    stoppedCompetitors: p.stoppedCompetitors,
    activeDays: p.activeDays,
    inactiveDays: p.inactiveDays,
    competitorNames: p.competitorNames,
    platforms: p.platforms,
    niches: p.niches,
    statuses: p.statuses,
  });
  const checks: [string, (p: ProductListItem) => unknown][] = [
    ["المعرّفات والترتيب", (p) => p.key],
    ["الأسماء والأكواد", (p) => [p.name, p.code]],
    ["عدد الإعلانات", (p) => [p.totalAds, p.activeAds, p.stoppedAds, p.activeDays, p.inactiveDays]],
    ["نشط / متوقف", (p) => [p.activeCompetitors, p.stoppedCompetitors, p.statuses]],
    ["المنافسون", (p) => p.competitorNames],
    ["المنصات", (p) => p.platforms],
    ["الفئات", (p) => p.niches],
    ["الصور والوصف", (p) => [p.image, p.description]],
    ["المنتجات المستقلة", (p) => p.totalAds === 0],
    ["كل الحقول", pick],
  ];
  const sameLen = old.length === server.items.length && old.length === server.total;
  const rows = checks.map(([label, f]) => [
    label,
    sameLen && old.every((p, i) => JSON.stringify(f(p)) === JSON.stringify(f(server.items[i]!))),
  ] as const);
  const totalsOk = sameLen && products.length === server.allTotal;
  // أول اختلاف بدقة: الموضع والحقل والقيمتان.
  let firstDiff: string | null = null;
  for (let i = 0; i < Math.max(old.length, server.items.length) && !firstDiff; i += 1) {
    const a = old[i] ? pick(old[i]!) : null;
    const b = server.items[i] ? pick(server.items[i]!) : null;
    if (!a || !b) { firstDiff = `#${i + 1}: موجود في ${a ? "القديم" : "الجديد"} فقط`; break; }
    for (const k of Object.keys(a) as (keyof typeof a)[]) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
        firstDiff = `#${i + 1} (${a.key}) ${k}: قديم ${JSON.stringify(a[k])} / جديد ${JSON.stringify(b[k])}`;
        break;
      }
    }
  }
  const legacyOk =
    JSON.stringify(legacy.items.map(pick)) === JSON.stringify(server.items.map(pick)) &&
    JSON.stringify(legacy.options) === JSON.stringify(server.options) &&
    JSON.stringify(legacy.filteredKeys) === JSON.stringify(server.filteredKeys);
  const ok = totalsOk && legacyOk && !firstDiff && rows.every(([, v]) => v);
  return (
    <Card className="mb-4 p-3 text-sm" data-compare-result={ok ? "match" : "mismatch"}>
      <p className="font-semibold">{ok ? "✅ مطابق" : "❌ غير مطابق"}</p>
      <p>
        الإجمالي: قديم {old.length} من {products.length} / جديد {server.total} من {server.allTotal}
      </p>
      <p>الخادم القديم مقابل قاعدة البيانات (العناصر والقوائم والمفاتيح): {legacyOk ? "مطابق" : "مختلف"}</p>
      {firstDiff && <p className="text-destructive">أول اختلاف: {firstDiff}</p>}
      {rows.map(([label, v]) => (
        <p key={label}>
          {label}: {v ? "مطابق" : "مختلف"}
        </p>
      ))}
    </Card>
  );
}
