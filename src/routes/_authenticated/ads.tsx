import { createFileRoute } from "@tanstack/react-router";
import { useProgressiveList } from "@/lib/use-progressive-list";
import { useLastPosition, useRemembered, useResetOnChange, useScrollMemory, restoredCount } from "@/lib/last-position";
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { getAdsFilterOptions, getAdsPage, type AdsPageItem, type AdsPageInput } from "@/lib/ads.functions";
import { toast } from "sonner";
import { ExternalLink, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AdDialog } from "@/components/AdDialog";
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
import { Switch } from "@/components/ui/switch";
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
import {
  formatDate,
  friendlyError,
  useAds,
  useDeleteAd,
  useCompetitors,
  useProductCodeOverrides,
  useToggleAdStatus,
  type AdWithCompetitor,
} from "@/lib/kashaf";
import { adsLibraryUrl } from "@/lib/ads-library";
import { ListCountBar, ListPager } from "@/components/ListControls";

type AdsSearch = {
  competitorId?: string | undefined;
  product?: string | undefined;
  status?: "active" | "stopped" | undefined;
  compare?: boolean | undefined;
};

/**
 * وضع المقارنة (?compare=1): يشغّل منطق المتصفح القديم على كل الإعلانات
 * ويقارنه بنتيجة قاعدة البيانات (الإجمالي + ترتيب الصفحة + أرقام التكرار).
 */
function AdsCompare(props: {
  search: string;
  competitorId?: string | undefined;
  status?: string | undefined;
  rules: FilterRule[];
  fields: FilterFieldDef[];
  serverTotal: number;
  serverItems: AdsPageItem[];
  page: number;
  pageSize: number | "all";
}) {
  const { data: ads, isLoading } = useAds();
  if (isLoading || !ads) return <p className="mb-4 text-sm">جارٍ تحميل المنطق القديم للمقارنة…</p>;
  const q = props.search.trim().toLowerCase();
  const old = ads.filter((ad) => {
    const matchQ =
      !q ||
      ad.product_name.toLowerCase().includes(q) ||
      (ad.competitor?.competitor_name ?? "").toLowerCase().includes(q);
    if (!matchQ || (props.competitorId && ad.competitor_id !== props.competitorId)) return false;
    if (props.status && ad.status !== props.status) return false;
    return props.rules.every((rule) => {
      const def = props.fields.find((f) => f.id === rule.field);
      const getter = AD_FIELD_VALUES[rule.field];
      return !def || !getter ? true : matchRule(getter(ad), rule, def.type);
    });
  });
  const counts = new Map<string, number>();
  const index = new Map<string, number>();
  for (const ad of [...ads].sort((a, b) => a.creation_date.localeCompare(b.creation_date))) {
    const key = productKey(ad.product_name);
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    index.set(ad.id, next);
  }
  const start = props.pageSize === "all" ? 0 : (props.page - 1) * props.pageSize;
  const oldPage = props.pageSize === "all" ? old : old.slice(start, start + props.pageSize);
  const idsMatch =
    oldPage.length === props.serverItems.length &&
    oldPage.every((a, i) => a.id === props.serverItems[i]?.id);
  const numMatch = props.serverItems.every(
    (a) => a.product_index === index.get(a.id) && a.product_count === counts.get(productKey(a.product_name)),
  );
  const ok = old.length === props.serverTotal && idsMatch && numMatch;
  return (
    <Card className="mb-4 p-3 text-sm" data-compare-result={ok ? "match" : "mismatch"}>
      <p className="font-semibold">{ok ? "✅ مطابق" : "❌ غير مطابق"}</p>
      <p>الإجمالي: قديم {old.length} / جديد {props.serverTotal}</p>
      <p>ترتيب الصفحة: {idsMatch ? "مطابق" : "مختلف"} — أرقام التكرار: {numMatch ? "مطابقة" : "مختلفة"}</p>
    </Card>
  );
}

const AD_FIELD_VALUES: Record<string, (ad: AdWithCompetitor) => string[]> = {
  product: (ad) => [ad.product_name],
  competitor: (ad) => (ad.competitor?.competitor_name ? [ad.competitor.competitor_name] : []),
  platform: (ad) => (ad.competitor?.platform ? [ad.competitor.platform] : []),
  niche: (ad) => (ad.competitor?.niche ? [ad.competitor.niche] : []),
  status: (ad) => [ad.status === "active" ? "نشط" : "غير نشط"],
  activeDays: (ad) => [String(ad.active_days)],
  inactiveDays: (ad) => [String(ad.inactive_days)],
  creationDate: (ad) => [ad.creation_date],
};

const AD_FIELD_LABELS: { id: string; label: string; type: FilterFieldType }[] = [
  { id: "product", label: "اسم المنتج", type: "text" },
  { id: "competitor", label: "المنافس", type: "text" },
  { id: "platform", label: "المنصة", type: "text" },
  { id: "niche", label: "الفئة", type: "text" },
  { id: "status", label: "الحالة", type: "text" },
  { id: "activeDays", label: "أيام النشاط", type: "number" },
  { id: "inactiveDays", label: "أيام التوقف", type: "number" },
  { id: "creationDate", label: "تاريخ الإنشاء", type: "text" },
];

import { productCode, productKey } from "@/lib/product";
import { ProductImage } from "@/components/ProductCard";

function AdCardImage({ path, alt }: { path: string | null; alt: string }) {
  return <ProductImage path={path} alt={alt} className="h-28 w-28 shrink-0 sm:h-36 sm:w-36" />;
}

export const Route = createFileRoute("/_authenticated/ads")({
  validateSearch: (search: Record<string, unknown>): AdsSearch => ({
    competitorId: typeof search['competitorId'] === "string" ? search['competitorId'] : undefined,
    product: typeof search['product'] === "string" ? search['product'] : undefined,
    status: search['status'] === "active" || search['status'] === "stopped" ? search['status'] : undefined,
    compare: search['compare'] === 1 || search['compare'] === "1" || search['compare'] === true ? true : undefined,
  }),
  head: () => ({
    meta: [
      { title: "الإعلانات | Kashaf" },
      { name: "description", content: "كل إعلانات المنافسين مع مدة استمرار كل إعلان بالأيام." },
      { property: "og:title", content: "الإعلانات | Kashaf" },
      {
        property: "og:description",
        content: "كل إعلانات المنافسين مع مدة استمرار كل إعلان بالأيام.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdsRoute,
});

function AdsRoute() {
  const { competitorId, product, status, compare } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { userId } = useAuth();
  const { data: competitors = [] } = useCompetitors();
  const { data: codeOverrides } = useProductCodeOverrides();
  const deleteAd = useDeleteAd();
  const toggleStatus = useToggleAdStatus();
  const fetchPage = useServerFn(getAdsPage);
  const fetchOptions = useServerFn(getAdsFilterOptions);

  const lp = useLastPosition(`ads:${competitorId ?? ""}:${status ?? ""}:${product ?? ""}`);
  const [search, setSearch] = useRemembered(lp, "search", "", product);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const [rules, setRules] = useRemembered<FilterRule[]>(lp, "rules", []);
  const [dialog, setDialog] = useState<{ open: boolean; ad?: AdWithCompetitor | null }>({ open: false });
  const [toDelete, setToDelete] = useState<AdWithCompetitor | null>(null);
  const [page, setPage] = useRemembered(lp, "page", 1);
  const [pageSize, setPageSize] = useRemembered<number | "all">(lp, "pageSize", 20);

  // قيم الفلتر المتقدم تُحسب في قاعدة البيانات بدل تحميل كل الإعلانات.
  const { data: options = {} } = useQuery({
    queryKey: ["ads", "filter-options", userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: () => fetchOptions(),
  });

  const fields: FilterFieldDef[] = useMemo(
    () =>
      AD_FIELD_LABELS.map((field) => ({
        ...field,
        options: [...(options[field.id] ?? [])].sort((a, b) =>
          field.type === "number" ? Number(a) - Number(b) : a.localeCompare(b, "ar"),
        ),
      })),
    [options],
  );

  // نفس سلوك الفلتر القديم: القاعدة على حقل غير معروف لا تستبعد شيئًا.
  const activeRules = rules.filter((r) => fields.some((f) => f.id === r.field));
  const filterKey = JSON.stringify([debouncedSearch, competitorId, status, activeRules]);
  // مفتاح إعادة الترقيم يعتمد على القواعد نفسها حتى لا يُصفَّر الترقيم عند وصول قائمة الحقول.
  useResetOnChange(lp, JSON.stringify([debouncedSearch, competitorId, status, rules, pageSize]), () => setPage(1));

  const baseInput = {
    search: debouncedSearch,
    competitorId,
    status,
    rules: activeRules as AdsPageInput["rules"],
  };

  const { data: pageData, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["ads", "page", userId, filterKey, page, pageSize],
    enabled: Boolean(userId),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      if (pageSize !== "all") return fetchPage({ data: { ...baseInput, pageSize, page } });
      // خيار "الكل": يُجلب على دفعات من 100 كما كان يعرض كل النتائج سابقًا.
      const first = await fetchPage({ data: { ...baseInput, pageSize: 100, page: 1 } });
      const items = [...first.items];
      for (let p = 2; items.length < first.total; p += 1) {
        const next = await fetchPage({ data: { ...baseInput, pageSize: 100, page: p } });
        if (next.items.length === 0) break;
        items.push(...next.items);
      }
      return { items, total: first.total };
    },
  });

  const total = pageData?.total ?? 0;
  const pageCount = pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const filtered = pageData?.items ?? [];
  const progressive = useProgressiveList(filtered, `${filterKey}|${page}|${pageSize}`, 30, restoredCount(lp));
  useScrollMemory(lp, Boolean(pageData) && !isPlaceholderData, progressive.shown.length);
  const paged = {
    visible: filtered,
    total,
    page: Math.min(page, pageCount),
    pageCount,
    pageSize,
    setPage,
    setPageSize,
  };

  const activeCompetitor = competitors.find((p) => p.id === competitorId);

  // عدد تكرارات المنتج ورقم الإعلان داخلها يأتيان محسوبين من قاعدة البيانات.
  const { productCounts, productIndex } = useMemo(() => {
    const counts = new Map<string, number>();
    const index = new Map<string, number>();
    for (const ad of filtered) {
      counts.set(productKey(ad.product_name), ad.product_count);
      index.set(ad.id, ad.product_index);
    }
    return { productCounts: counts, productIndex: index };
  }, [filtered]);

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteAd.mutateAsync(toDelete.id);
      toast.success("تم حذف الإعلان");
    } catch (error) {
      toast.error(friendlyError(error));
    }
    setToDelete(null);
  };

  return (
    <AppShell
      title="الإعلانات"
      description={
        activeCompetitor ? `إعلانات المنافس «${activeCompetitor.competitor_name}»` : "جميع إعلانات المنافسين."
      }
      actions={
        <Button onClick={() => setDialog({ open: true, ad: null })} disabled={competitors.length === 0}>
          <Plus className="size-4" />
          إضافة إعلان
        </Button>
      }
    >
      <div className="mb-6 flex items-center gap-2">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث باسم المنتج أو المنافس..."
            className="pe-9"
          />
        </div>
        <AdvancedFilter fields={fields} rules={rules} onChange={setRules} />
      </div>

      {competitorId ? (
        <Button
          variant="ghost"
          size="sm"
          className="mb-4"
          onClick={() => navigate({ search: {} })}
        >
          إزالة فلتر المنافس
        </Button>
      ) : null}

      <ListCountBar paged={paged} noun="إعلان" />

      {compare ? (
        <AdsCompare
          search={debouncedSearch}
          competitorId={competitorId}
          status={status}
          rules={activeRules}
          fields={fields}
          serverTotal={total}
          serverItems={filtered}
          page={paged.page}
          pageSize={pageSize}
        />
      ) : null}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {competitors.length === 0 ? "أضف منافسًا أولًا ثم أضف إعلاناته." : "لا توجد إعلانات مطابقة."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {progressive.shown.map((ad) => (
            <Card key={ad.id} className="cv-auto p-3">
              <div className="flex gap-3">
                <div className="flex w-24 shrink-0 flex-col items-center gap-1.5 sm:w-28">
                  <AdCardImage path={ad.image_url} alt={ad.product_name} />
                  <span className="line-clamp-2 w-full break-words text-center text-xs font-medium leading-relaxed">
                    {ad.product_name}
                  </span>
                  <span className="w-full text-center font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {codeOverrides?.get(productKey(ad.product_name)) ?? productCode(ad.product_name)}
                    {(productCounts.get(productKey(ad.product_name)) ?? 1) > 1
                      ? ` · ${productIndex.get(ad.id)}/${productCounts.get(productKey(ad.product_name))}`
                      : null}
                  </span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold leading-relaxed">
                      {ad.competitor?.competitor_name ?? "—"}
                    </span>
                    <Badge
                      className="shrink-0 text-xs"
                      variant={ad.status === "active" ? "default" : "secondary"}
                    >
                      {ad.status === "active" ? "نشط" : "غير نشط"}
                    </Badge>
                  </div>

                  <div className="flex min-w-0 flex-wrap gap-1">
                    <Badge variant="outline" className="max-w-full truncate text-xs">{ad.competitor?.platform ?? "—"}</Badge>
                    <Badge variant="outline" className="max-w-full truncate text-xs">{ad.competitor?.niche ?? "—"}</Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      نشط {ad.active_days} يوم
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      توقف {ad.inactive_days} يوم
                    </span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{formatDate(ad.creation_date)}</span>
                    {ad.status === "inactive" && ad.end_date ? (
                      <span>· انتهى {formatDate(ad.end_date)}</span>
                    ) : null}
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-1 pt-1">
                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={ad.status === "active"}
                        onCheckedChange={() => toggleStatus.mutate(ad)}
                        aria-label="تغيير الحالة"
                      />
                      <span className="text-xs text-muted-foreground">نشط</span>
                    </div>
                    <div className="flex gap-0.5">
                      {ad.competitor ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() =>
                            window.open(
                              ad.source_url ?? (ad.competitor ? adsLibraryUrl(ad.competitor) : "#"),
                              "_blank",
                              "noopener,noreferrer",
                            )
                          }
                          aria-label="عرض الإعلان في مكتبة الإعلانات"
                        >
                          <ExternalLink className="size-4" />
                        </Button>
                      ) : null}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => setDialog({ open: true, ad })}
                        aria-label="تعديل"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => setToDelete(ad)}
                        aria-label="حذف"
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
          {progressive.sentinel}
        </div>
      )}

      <ListPager paged={paged} />

      <AdDialog
        open={dialog.open}
        ad={dialog.ad}
        competitors={competitors}
        defaultCompetitorId={competitorId}
        onOpenChange={(open) => setDialog((s) => ({ ...s, open }))}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الإعلان؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف «{toDelete?.product_name}» نهائيًا من المنافس المرتبط به.
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
