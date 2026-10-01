import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminOverviewStats, getFinancialSummary } from "@/lib/wallet.functions";

export const Route = createFileRoute("/_authenticated/admin/finance")({
  head: () => ({
    meta: [
      { title: "الملخص المالي | لوحة الأدمن كشاف" },
      { name: "description", content: "إيرادات الشحن الشهرية وحالة الطلبات في كشاف." },
      { property: "og:title", content: "الملخص المالي | لوحة الأدمن كشاف" },
      { property: "og:description", content: "إيرادات الشحن الشهرية وحالة الطلبات في كشاف." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminFinancePage,
});

const numberFormat = new Intl.NumberFormat("ar-EG-u-nu-latn");
const money = new Intl.NumberFormat("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const monthFormat = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { month: "long", year: "numeric" });

function AdminFinancePage() {
  const fetchSummary = useServerFn(getFinancialSummary);
  const fetchStats = useServerFn(getAdminOverviewStats);
  const summaryQuery = useQuery({
    queryKey: ["admin-finance"],
    queryFn: () => fetchSummary(),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const statsQuery = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => fetchStats(),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const data = summaryQuery.data;
  const stats = statsQuery.data;
  const isRefreshing = summaryQuery.isFetching || statsQuery.isFetching;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الملخص المالي</h1>
          <p className="text-sm text-muted-foreground">
            الإيداعات وخصومات الذكاء الاصطناعي والتكلفة الفعلية على كشاف.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void Promise.all([summaryQuery.refetch(), statsQuery.refetch()])}
          disabled={isRefreshing}
        >
          {isRefreshing ? <Loader2 className="animate-spin" /> : <RefreshCw className="size-4" />}
          تحديث الأرقام
        </Button>
      </div>

      {summaryQuery.isError ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-6 text-sm">{(summaryQuery.error as Error).message}</CardContent>
        </Card>
      ) : summaryQuery.isPending ? (
        <Card className="h-40 animate-pulse bg-muted/50" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {[
              { label: "الإيداعات المقبولة", value: `${money.format(data!.totalRevenue)} جنيه` },
              { label: "إيداعات معلّقة", value: `${money.format(data!.pendingRevenue)} جنيه` },
              { label: "طلبات مقبولة", value: numberFormat.format(data!.approvedCount) },
              { label: "طلبات مرفوضة", value: numberFormat.format(data!.rejectedCount) },
              {
                label: "أرصدة المستخدمين الحالية",
                value: stats ? `${money.format(stats.totalBalanceEgp)} جنيه` : "—",
              },
              {
                label: "مبالغ محجوزة الآن",
                value: stats ? `${money.format(stats.totalHeldEgp)} جنيه` : "—",
              },
              {
                label: "خصومات الذكاء الاصطناعي",
                value: stats ? `${money.format(stats.totalAiChargesEgp)} جنيه` : "—",
              },
              {
                label: "تكلفة المزوّدين الفعلية",
                value: stats ? `${usd.format(stats.totalProviderCostUsd)} دولار` : "—",
              },
            ].map((card) => (
              <Card key={card.label}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-bold sm:text-2xl">{card.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">الإيراد الشهري</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data!.monthly.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد مدفوعات مقبولة بعد.</p>
              ) : (
                data!.monthly.map((row) => (
                  <div
                    key={row.month}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <span>{monthFormat.format(new Date(`${row.month}-01T00:00:00Z`))}</span>
                    <span className="font-medium">
                      {numberFormat.format(row.revenue)} جنيه · {numberFormat.format(row.count)} طلب
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
