import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminOverviewStats } from "@/lib/wallet.functions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addOpenAiTopup,
  deleteOpenAiTopup,
  getProviderBalances,
  listOpenAiTopups,
} from "@/lib/ai-pricing.functions";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "نظرة عامة | لوحة الأدمن كشاف" },
      { name: "description", content: "ملخص الحسابات والأرصدة والإيرادات في كشاف." },
      { property: "og:title", content: "نظرة عامة | لوحة الأدمن كشاف" },
      { property: "og:description", content: "ملخص الحسابات والأرصدة والإيرادات في كشاف." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminOverviewPage,
});

const numberFormat = new Intl.NumberFormat("ar-EG-u-nu-latn");
const money = new Intl.NumberFormat("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const dateFormat = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { dateStyle: "short", timeStyle: "short" });

function AdminOverviewPage() {
  const fetchStats = useServerFn(getAdminOverviewStats);
  const fetchBalances = useServerFn(getProviderBalances);
  const statsQuery = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => fetchStats(),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const balancesQuery = useQuery({
    queryKey: ["admin-provider-balances"],
    queryFn: () => fetchBalances(),
    retry: false,
  });
  const fetchTopups = useServerFn(listOpenAiTopups);
  const topupsQuery = useQuery({
    queryKey: ["admin-openai-topups"],
    queryFn: () => fetchTopups(),
    retry: false,
  });

  const addTopup = useServerFn(addOpenAiTopup);
  const removeTopup = useServerFn(deleteOpenAiTopup);
  const [creditUsd, setCreditUsd] = useState("");
  const [creditSince, setCreditSince] = useState("");
  const [creditNote, setCreditNote] = useState("");
  const addMutation = useMutation({
    mutationFn: addTopup,
    onSuccess: () => {
      toast.success("تمت إضافة الشحنة وحساب الرصيد المتبقي.");
      setCreditUsd("");
      setCreditSince("");
      setCreditNote("");
      void Promise.all([topupsQuery.refetch(), balancesQuery.refetch()]);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: removeTopup,
    onSuccess: () => {
      toast.success("تم حذف الشحنة.");
      void Promise.all([topupsQuery.refetch(), balancesQuery.refetch()]);
    },
  });

  const s = statsQuery.data;

  const cards = [
    { label: "إجمالي المستخدمين", value: s ? numberFormat.format(s.totalUsers) : "—" },
    { label: "حسابات لديها رصيد", value: s ? numberFormat.format(s.fundedUsers) : "—" },
    { label: "طلبات قيد المراجعة", value: s ? numberFormat.format(s.pendingRequests) : "—" },
    { label: "طلبات مقبولة", value: s ? numberFormat.format(s.approvedRequests) : "—" },
    { label: "إجمالي الإيداعات", value: s ? `${money.format(s.totalRevenue)} جنيه` : "—" },
    { label: "أرصدة المستخدمين", value: s ? `${money.format(s.totalBalanceEgp)} جنيه` : "—" },
    { label: "مبالغ محجوزة", value: s ? `${money.format(s.totalHeldEgp)} جنيه` : "—" },
    { label: "خصومات الذكاء الاصطناعي", value: s ? `${money.format(s.totalAiChargesEgp)} جنيه` : "—" },
    {
      label: "تكلفة المزوّدين الفعلية",
      value: s ? `${usd.format(s.totalProviderCostUsd)} دولار` : "—",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">نظرة عامة</h1>
          <p className="text-sm text-muted-foreground">
            ملخص سريع لحالة المنصة، محسوب مباشرة من بيانات الحسابات والطلبات والاستهلاك.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => statsQuery.refetch()}
          disabled={statsQuery.isFetching}
        >
          {statsQuery.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw className="size-4" />}
          تحديث الأرقام
        </Button>
      </div>

      {statsQuery.isError ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-6 text-sm">{(statsQuery.error as Error).message}</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          {cards.map((card) => (
            <Card key={card.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg font-bold sm:text-2xl">{statsQuery.isPending ? "..." : card.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">رصيد كشاف لدى المزوّدين</CardTitle>
            <CardDescription>
              {balancesQuery.data
                ? `آخر مزامنة: ${dateFormat.format(new Date(balancesQuery.data.checkedAt))}`
                : "الرصيد والإنفاق خلال آخر 30 يومًا بالدولار."}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => balancesQuery.refetch()}
            disabled={balancesQuery.isFetching}
          >
            {balancesQuery.isFetching ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            مزامنة الرصيد
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {balancesQuery.isError ? (
            <p className="text-sm text-destructive">{(balancesQuery.error as Error).message}</p>
          ) : balancesQuery.isPending ? (
            <p className="text-sm text-muted-foreground">جارٍ القراءة…</p>
          ) : balancesQuery.data.balances.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا يوجد مزوّد نشط.</p>
          ) : (
            balancesQuery.data.balances.map((b) => (
              <div
                key={b.providerCode}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      b.status === "ok" ? "default" : b.status === "failed" ? "destructive" : "secondary"
                    }
                  >
                    {b.status === "ok" ? "متصل" : b.status === "failed" ? "فشل" : "غير متاح"}
                  </Badge>
                  <span dir="ltr" className="font-medium">
                    {b.providerCode}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                  <span>
                    الرصيد المتبقي:{" "}
                    <span className="font-medium text-foreground" dir="ltr">
                      {b.balanceUsd === null ? "—" : `${usd.format(b.balanceUsd)} $`}
                    </span>
                  </span>
                  <span>
                    إنفاق 30 يومًا:{" "}
                    <span className="font-medium text-foreground" dir="ltr">
                      {b.spendUsd30dUsd === null ? "—" : `${usd.format(b.spendUsd30dUsd)} $`}
                    </span>
                  </span>
                  {b.creditUsd !== null ? (
                    <span>
                      مبلغ الشحن:{" "}
                      <span className="font-medium text-foreground" dir="ltr">
                        {usd.format(b.creditUsd)} $
                      </span>
                      {b.spendSinceCreditUsd !== null ? (
                        <>
                          {" "}
                          · الإنفاق منذ الشحن:{" "}
                          <span className="font-medium text-foreground" dir="ltr">
                            {usd.format(b.spendSinceCreditUsd)} $
                          </span>
                        </>
                      ) : null}
                    </span>
                  ) : null}
                  {b.message ? <span>{b.message}</span> : null}
                </div>
              </div>
            ))
          )}

          <div className="rounded-md border border-dashed border-border p-3">
            <p className="text-sm font-medium">سجل شحنات حساب OpenAI</p>
            <p className="mt-1 text-xs text-muted-foreground">
              OpenAI لا يعرض الرصيد المتبقي عبر الواجهة. سجّل كل شحنة بمبلغها وتاريخها، ويُحسب المتبقي تلقائيًا =
              مجموع الشحنات − الإنفاق الفعلي منذ أول شحنة.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="credit-usd" className="text-xs">
                  المبلغ بالدولار
                </Label>
                <Input
                  id="credit-usd"
                  type="number"
                  min="0"
                  step="0.01"
                  dir="ltr"
                  value={creditUsd}
                  onChange={(e) => setCreditUsd(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="credit-since" className="text-xs">
                  تاريخ الشحن
                </Label>
                <Input
                  id="credit-since"
                  type="date"
                  dir="ltr"
                  value={creditSince}
                  onChange={(e) => setCreditSince(e.target.value)}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="credit-note" className="text-xs">
                  ملاحظة (اختياري)
                </Label>
                <Input
                  id="credit-note"
                  maxLength={200}
                  value={creditNote}
                  onChange={(e) => setCreditNote(e.target.value)}
                />
              </div>
              <div className="flex items-end sm:col-span-2">
                <Button
                  onClick={() =>
                    addMutation.mutate({
                      data: {
                        amountUsd: Number(creditUsd),
                        creditedAt: creditSince,
                        note: creditNote,
                      },
                    })
                  }
                  disabled={addMutation.isPending || !creditUsd || !creditSince}
                >
                  {addMutation.isPending ? <Loader2 className="animate-spin" /> : null}
                  إضافة شحنة
                </Button>
              </div>
            </div>
            {addMutation.isError ? (
              <p className="mt-2 text-sm text-destructive">{(addMutation.error as Error).message}</p>
            ) : null}

            <div className="mt-4 space-y-2">
              {topupsQuery.isPending ? (
                <p className="text-xs text-muted-foreground">جارٍ قراءة السجل…</p>
              ) : topupsQuery.data && topupsQuery.data.topups.length > 0 ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    مجموع الشحنات:{" "}
                    <span className="font-medium text-foreground" dir="ltr">
                      {usd.format(topupsQuery.data.totalUsd)} $
                    </span>
                  </p>
                  {topupsQuery.data.topups.map((t) => (
                    <div
                      key={t.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <span className="font-medium" dir="ltr">
                        {usd.format(t.amountUsd)} $
                      </span>
                      <span className="text-muted-foreground">
                        {dateFormat.format(new Date(t.creditedAt))}
                        {t.note ? ` · ${t.note}` : ""}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="حذف الشحنة"
                        title="حذف الشحنة"
                        onClick={() => deleteMutation.mutate({ data: { id: t.id } })}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                </>
              ) : (
                <p className={topupsQuery.isError ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                  {topupsQuery.isError ? (topupsQuery.error as Error).message : "لا توجد شحنات مسجّلة بعد."}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
