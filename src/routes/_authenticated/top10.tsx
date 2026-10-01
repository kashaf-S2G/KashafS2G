import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Megaphone,
  Minus,
  Trash2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { getTop10, type Top10Item } from "@/lib/top10.functions";
import type { MetricResult } from "@/lib/metrics/types";
import type { ProductSummary } from "@/lib/product-summary";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { MetricSettingsDialog } from "@/components/MetricSettingsDialog";
import { MetricBreakdownDialog } from "@/components/MetricBreakdownDialog";
import { EditProductDialog } from "@/components/EditProductDialog";
import { useAds, useDeleteProduct, useProductCodeOverrides, useProductsTable } from "@/lib/kashaf";
import { summarize, withStandaloneProducts } from "@/lib/product-summary";
import { useResolvedMetrics } from "@/lib/metrics/store";
import { rankProducts } from "@/lib/metrics/engine";

export const Route = createFileRoute("/_authenticated/top10")({
  head: () => ({
    meta: [
      { title: "Top10 | Kashaf" },
      {
        name: "description",
        content: "أفضل 10 منتجات وفق مقاييس الـWinner التي تحددها بنفسك: شروط وأوزان قابلة للتعديل.",
      },
      { property: "og:title", content: "Top10 | Kashaf" },
      {
        property: "og:description",
        content: "أفضل 10 منتجات وفق مقاييس الـWinner التي تحددها بنفسك: شروط وأوزان قابلة للتعديل.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { compare?: string } =>
    s["compare"] === undefined ? {} : { compare: String(s["compare"]) },
  component: Top10Route,
});

const TREND = {
  up: { label: "صاعد", icon: ArrowUpRight, className: "text-primary" },
  flat: { label: "ثابت", icon: Minus, className: "text-muted-foreground" },
  down: { label: "هابط", icon: ArrowDownRight, className: "text-destructive" },
} as const;

const isUuid = (k: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k);

function Top10Route() {
  const { compare } = Route.useSearch();
  const compareMode = compare === "1";
  const { userId } = useAuth();
  const { metrics, isLoading: metricsLoading } = useResolvedMetrics();
  const deleteProduct = useDeleteProduct();
  const fetchTop10 = useServerFn(getTop10);

  // NEW: الحساب كاملًا على الخادم؛ المفتاح يتضمن الإعدادات ليُعاد الحساب عند تغييرها.
  const settingsSig = JSON.stringify(metrics.map((m) => [m.id, m.enabled, m.target_value, m.minimum_value, m.maximum_value, m.weight, m.scoring_method]));
  const newQuery = useQuery({
    queryKey: ["top10-server", userId, settingsSig],
    enabled: Boolean(userId) && !metricsLoading,
    queryFn: () => fetchTop10(),
  });
  const isLoading = newQuery.isLoading;
  const todayMs = newQuery.data?.todayMs ?? null;

  // نفس منطق صفحة المنتجات: تحديد يدوي مرتبط بمعرّف المنتج.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const toggleOne = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const ranked = useMemo(
    () =>
      (newQuery.data?.items ?? []).map((r) => ({
        ...r,
        product: { ...r.product, ads: [] } as ProductSummary,
        results: r.results as MetricResult[],
      })),
    [newQuery.data],
  );

  const enabledCount = metrics.filter((m) => m.enabled && m.is_active && m.is_available).length;
  const updatedAt =
    todayMs === null
      ? "—"
      : new Date().toLocaleTimeString("ar-EG-u-nu-latn", { hour: "2-digit", minute: "2-digit" });

  return (
    <AppShell title="Top10" description="أفضل 10 منتجات وفق مقاييس الـWinner الخاصة بك">
      {compareMode && newQuery.data ? <Top10Compare newData={newQuery.data} /> : null}
      {newQuery.error ? (
        <p className="mb-3 text-sm text-destructive">تعذر تحميل Top10: {(newQuery.error as Error).message}</p>
      ) : null}
      <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span>
            المقاييس المفعلة: <strong className="text-foreground">{enabledCount}</strong>
          </span>
          <span>
            آخر تحديث للتقييم: <strong className="text-foreground">{updatedAt}</strong>
          </span>
        </div>
        <MetricSettingsDialog metrics={metrics} />
      </Card>

      {isLoading || metricsLoading || todayMs === null ? (
        <p className="text-sm text-muted-foreground">جارٍ حساب التقييم...</p>
      ) : enabledCount === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">
            لا توجد مقاييس مفعّلة. افتح إعدادات المقاييس وفعّل ما يناسب تعريفك للمنتج الرابح.
          </p>
        </Card>
      ) : ranked.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">أضف إعلانات أولًا لتظهر المنتجات هنا.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {ranked.map((r, i) => {
            const trend = r.trend ? TREND[r.trend] : null;
            const TrendIcon = trend?.icon;
            return (
              <ProductCard
                key={r.product.key}
                product={r.product}
                selected={selected.has(r.product.key)}
                onToggleSelect={() => toggleOne(r.product.key)}
                header={
                   <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-b pb-1 text-[11px] sm:gap-2">
                     <span className="rounded-md bg-primary px-2 py-0.5 font-bold text-primary-foreground">
                      #{i + 1}
                    </span>
                     <Badge variant="outline" className="text-[11px]">
                      الدرجة {r.overallScore} / 100
                    </Badge>
                    <Badge variant="outline" className="text-[11px]">
                      المقاييس المحققة {r.metCount} من {r.enabledCount}
                    </Badge>
                    <Badge variant="outline" className="text-[11px]">
                      اكتمال البيانات {r.completeness}%
                    </Badge>
                    {trend && TrendIcon ? (
                      <span className={`flex items-center gap-1 text-[11px] ${trend.className}`}>
                        <TrendIcon className="size-3.5" />
                        {trend.label}
                      </span>
                    ) : null}
                  </div>
                }
                footer={
                   <div className="flex min-w-0 flex-wrap items-center gap-1">
                    <MetricBreakdownDialog productName={r.product.name} results={r.results} />
                    {isUuid(r.product.key) ? (
                      <>
                        <EditProductDialog product={r.product} />
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
                              <AlertDialogTitle>حذف «{r.product.name}»؟</AlertDialogTitle>
                              <AlertDialogDescription>
                                سيُحذف المنتج وكل بياناته الملحقة نهائيًا. لا يمكن التراجع عن هذا الإجراء.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>إلغاء</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  deleteProduct.mutate(
                                    { id: r.product.key, key: r.product.key },
                                    {
                                      onSuccess: () => {
                                        toast.success("تم حذف المنتج.");
                                        void newQuery.refetch();
                                        setSelected((prev) => {
                                          const next = new Set(prev);
                                          next.delete(r.product.key);
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
                    ) : (
                      <Button asChild size="sm" variant="ghost" className="h-6 gap-1 text-[11px] sm:h-7 sm:gap-1.5 sm:text-xs">
                        <Link to="/ads">
                          <Megaphone className="size-3.5 sm:size-4" />
                          الإعلانات
                        </Link>
                      </Button>
                    )}
                  </div>
                }
              />
            );
          })}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            الدرجة الإجمالية محسوبة على البيانات المتاحة فقط؛ المقاييس التي لا تتوفر بياناتها لا
            تُحتسب ولا تُمنح قيمة افتراضية.
          </p>
        </div>
      )}
    </AppShell>
  );
}

/**
 * Comparison Mode (?compare=1): يشغّل المسار القديم (المتصفح) كما هو ويقارنه حقلًا بحقل مع NEW.
 */
function Top10Compare({ newData }: { newData: { items: Top10Item[]; todayMs: number } }) {
  const { data: ads = [], isLoading } = useAds();
  const { data: codeOverrides } = useProductCodeOverrides();
  const { data: productRows = [] } = useProductsTable();
  const { metrics, isLoading: metricsLoading } = useResolvedMetrics();
  const [todayMs, setTodayMs] = useState<number | null>(null);
  useEffect(() => {
    setTodayMs(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`));
  }, [ads, metrics]);
  const products = useMemo(
    () => withStandaloneProducts(summarize(ads, codeOverrides), productRows).filter((p) => p.ads.length > 0),
    [ads, codeOverrides, productRows],
  );
  const oldRanked = useMemo(
    () => (todayMs === null ? [] : rankProducts(products, metrics, todayMs, 10)),
    [products, metrics, todayMs],
  );

  const diffs = useMemo(() => {
    if (todayMs === null) return null;
    const out: string[] = [];
    if (todayMs !== newData.todayMs)
      out.push(`today UTC: OLD=${new Date(todayMs).toISOString()} NEW=${new Date(newData.todayMs).toISOString()}`);
    const norm = (r: { product: object; results: unknown[] } & Record<string, unknown>) => {
      const { ads: _a, ...product } = r.product as ProductSummary;
      return JSON.parse(JSON.stringify({ ...r, product })) as Record<string, unknown> & {
        product: Record<string, unknown>;
        results: Record<string, unknown>[];
      };
    };
    const n = Math.max(oldRanked.length, newData.items.length);
    if (oldRanked.length !== newData.items.length)
      out.push(`عدد النتائج: OLD=${oldRanked.length} NEW=${newData.items.length}`);
    for (let i = 0; i < n; i++) {
      const o = oldRanked[i] ? norm(oldRanked[i] as never) : null;
      const w = newData.items[i] ? norm(newData.items[i] as never) : null;
      const pos = `#${i + 1}`;
      if (!o || !w) {
        out.push(`${pos}: ${o ? "موجود في OLD فقط" : "موجود في NEW فقط"}`);
        continue;
      }
      for (const f of ["overallScore", "metCount", "evaluatedCount", "enabledCount", "completeness", "trend"])
        if (JSON.stringify(o[f]) !== JSON.stringify(w[f]))
          out.push(`${pos} ${f}: OLD=${JSON.stringify(o[f])} NEW=${JSON.stringify(w[f])}`);
      const pk = new Set([...Object.keys(o.product), ...Object.keys(w.product)]);
      for (const f of pk)
        if (JSON.stringify(o.product[f]) !== JSON.stringify(w.product[f]))
          out.push(`${pos} product.${f}: OLD=${JSON.stringify(o.product[f])} NEW=${JSON.stringify(w.product[f])}`);
      const m = Math.max(o.results.length, w.results.length);
      for (let j = 0; j < m; j++) {
        const a = o.results[j];
        const b = w.results[j];
        const key = String(((a ?? b)?.["metric"] as { metric_key?: string })?.metric_key ?? j);
        if (JSON.stringify(a) !== JSON.stringify(b)) {
          for (const f of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]))
            if (JSON.stringify(a?.[f]) !== JSON.stringify(b?.[f]))
              out.push(`${pos} metric ${key}.${f}: OLD=${JSON.stringify(a?.[f])} NEW=${JSON.stringify(b?.[f])}`);
        }
      }
    }
    return out;
  }, [oldRanked, newData, todayMs]);

  if (isLoading || metricsLoading || diffs === null)
    return <Card className="mb-4 p-3 text-xs text-muted-foreground">وضع المقارنة: جارٍ حساب OLD...</Card>;
  return (
    <Card className={`mb-4 p-3 text-xs ${diffs.length ? "border-destructive" : "border-primary"}`} dir="ltr">
      <p className={`font-bold ${diffs.length ? "text-destructive" : "text-primary"}`}>
        Comparison OLD vs NEW: {diffs.length ? `${diffs.length} difference(s)` : `MATCH (${newData.items.length} items)`}
      </p>
      {diffs.length ? (
        <ul className="mt-2 max-h-64 list-disc overflow-auto ps-5 font-mono">
          {diffs.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
