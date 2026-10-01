import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getAdminPricing,
  syncPricingNow,
  testOpenAiAdminKey,
  updatePricingSettings,
} from "@/lib/ai-pricing.functions";

export const Route = createFileRoute("/_authenticated/admin/pricing")({
  head: () => ({
    meta: [
      { title: "التسعير | لوحة الأدمن كشاف" },
      { name: "description", content: "هامش الربح وسعر الصرف وأسعار نماذج الذكاء الاصطناعي في كشاف." },
      { property: "og:title", content: "التسعير | لوحة الأدمن كشاف" },
      {
        property: "og:description",
        content: "هامش الربح وسعر الصرف وأسعار نماذج الذكاء الاصطناعي في كشاف.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPricingPage,
});

const money = new Intl.NumberFormat("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const dateFormat = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { dateStyle: "short", timeStyle: "short" });

function AdminPricingPage() {
  const queryClient = useQueryClient();
  const fetchPricing = useServerFn(getAdminPricing);
  const saveSettings = useServerFn(updatePricingSettings);
  const runSync = useServerFn(syncPricingNow);
  const runKeyTest = useServerFn(testOpenAiAdminKey);

  const keyTestMutation = useMutation({
    mutationFn: () => runKeyTest(),
    onError: (error: Error) => toast.error(error.message),
  });

  const pricingQuery = useQuery({
    queryKey: ["admin-pricing"],
    queryFn: () => fetchPricing(),
    retry: false,
    refetchInterval: 10_000,
  });

  const [margin, setMargin] = useState("");
  const [rate, setRate] = useState("");
  const [minDeposit, setMinDeposit] = useState("");

  const data = pricingQuery.data;

  useEffect(() => {
    if (!data) return;
    setMargin(String(data.marginPercent));
    setRate(String(data.usdToEgp));
    setMinDeposit(String(data.minDepositEgp));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveSettings({
        data: {
          marginPercent: Number(margin),
          usdToEgp: Number(rate),
          minDepositEgp: Number(minDeposit),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-pricing"] });
      toast.success("تم حفظ إعدادات التسعير.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const syncMutation = useMutation({
    mutationFn: () => runSync(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-pricing"] });
      toast.success(result.updated ? "تم تحديث السعر الديناميكي." : "لم يتغير السعر؛ راجع حالة آخر دورة.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">التسعير</h1>
          <p className="text-sm text-muted-foreground">
            سعر العميل = تكلفة المزوّد الفعلية + هامش الربح، محسوبة بسعر الصرف الحالي.
          </p>
        </div>
        <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
          {syncMutation.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw className="size-4" />}
          مزامنة الأسعار الآن
        </Button>
      </div>

      {pricingQuery.isError ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-6 text-sm">{(pricingQuery.error as Error).message}</CardContent>
        </Card>
      ) : pricingQuery.isPending || !data ? (
        <Card className="h-40 animate-pulse bg-muted/50" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">الإعدادات</CardTitle>
              <CardDescription>
                آخر مزامنة:{" "}
                {data.lastSyncAt ? dateFormat.format(new Date(data.lastSyncAt)) : "لم تتم بعد"}
                {data.lastSyncStatus ? ` · ${data.lastSyncStatus}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.lastSyncError ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  {data.lastSyncError}
                </p>
              ) : null}
              <form
                className="grid gap-4 sm:grid-cols-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveMutation.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="margin">هامش الربح (٪)</Label>
                  <Input
                    id="margin"
                    dir="ltr"
                    inputMode="decimal"
                    value={margin}
                    onChange={(event) => setMargin(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rate">سعر الدولار بالجنيه</Label>
                  <Input
                    id="rate"
                    dir="ltr"
                    inputMode="decimal"
                    value={rate}
                    onChange={(event) => setRate(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="min-deposit">الحد الأدنى للإيداع (جنيه)</Label>
                  <Input
                    id="min-deposit"
                    dir="ltr"
                    inputMode="decimal"
                    value={minDeposit}
                    onChange={(event) => setMinDeposit(event.target.value)}
                  />
                </div>
                <div className="sm:col-span-3">
                  <Button type="submit" disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? <Loader2 className="animate-spin" /> : null}
                    حفظ الإعدادات
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">السعر الحالي المستخدم في العمليات الجديدة (موحّد لكل النماذج)</CardTitle>
            </CardHeader>
            <CardContent>
              {data.prices.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد أسعار محفوظة بعد. شغّل المزامنة.</p>
              ) : (
                <>
                <div className="space-y-3 md:hidden">
                  {data.prices.map((price) => (
                    <div
                      key={`card-${price.providerCode}-${price.modelCode}`}
                      className="rounded-lg border border-border p-3 text-sm"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="font-semibold">{price.displayName}</span>
                        <Badge variant="secondary" dir="ltr">
                          {price.providerCode}
                        </Badge>
                      </div>
                      <dl className="space-y-1.5">
                        {[
                          ["تكلفة Input (دولار/مليون)", usd.format(price.costInputUsdPerMillion)],
                          ["تكلفة Output (دولار/مليون)", usd.format(price.costOutputUsdPerMillion)],
                          ["سعر Input (جنيه/مليون)", money.format(price.sellInputEgpPerMillion)],
                          ["سعر Output (جنيه/مليون)", money.format(price.sellOutputEgpPerMillion)],
                        ].map(([label, value]) => (
                          <div key={label} className="flex items-center justify-between gap-3">
                            <dt className="text-muted-foreground">{label}</dt>
                            <dd dir="ltr">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
                <div className="hidden overflow-x-auto md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">النموذج</TableHead>
                        <TableHead className="text-right">المزوّد</TableHead>
                        <TableHead className="text-right">تكلفة Input (دولار/مليون)</TableHead>
                        <TableHead className="text-right">تكلفة Output (دولار/مليون)</TableHead>
                        <TableHead className="text-right">سعر Input (جنيه/مليون)</TableHead>
                        <TableHead className="text-right">سعر Output (جنيه/مليون)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.prices.map((price) => (
                        <TableRow key={`${price.providerCode}-${price.modelCode}`}>
                          <TableCell className="whitespace-nowrap">{price.displayName}</TableCell>
                          <TableCell dir="ltr">{price.providerCode}</TableCell>
                          <TableCell dir="ltr">{usd.format(price.costInputUsdPerMillion)}</TableCell>
                          <TableCell dir="ltr">{usd.format(price.costOutputUsdPerMillion)}</TableCell>
                          <TableCell dir="ltr">{money.format(price.sellInputEgpPerMillion)}</TableCell>
                          <TableCell dir="ltr">{money.format(price.sellOutputEgpPerMillion)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                </>
              )}
            </CardContent>
          </Card>

          {(() => {
            const run = data.syncRuns[0];
            if (!run) return null;
            const fmtD = (v: string | null) => (v ? dateFormat.format(new Date(v)) : "—");
            const fmtN = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-US"));
            const fmtU = (v: number | null) => (v === null ? "—" : `$${usd.format(v)}`);
            const rows: [string, string][] = [
              ["بداية فترة القياس", fmtD(run.periodStart)],
              ["نهاية فترة القياس", fmtD(run.periodEnd)],
              ["التكلفة الفعلية الإجمالية", fmtU(run.providerCostUsd)],
              ["تكلفة Input الفعلية", fmtU(run.inputCostUsd)],
              ["تكلفة Output الفعلية", fmtU(run.outputCostUsd)],
              ["بنود غير توكنية (غير داخلة في السعر)", fmtU(run.otherCostUsd)],
              ["استهلاك Input (توكن)", fmtN(run.inputTokens)],
              ["استهلاك Output (توكن)", fmtN(run.outputTokens)],
              ["السعر الناتج Input (دولار/مليون)", fmtU(run.costInputUsdPerMillion)],
              ["السعر الناتج Output (دولار/مليون)", fmtU(run.costOutputUsdPerMillion)],
              ["وقت تنفيذ الدورة", fmtD(run.createdAt)],
              ["آخر تحديث ناجح", fmtD(data.lastSuccessAt)],
            ];
            return (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">آخر دورة تسعير (كل 12 ساعة)</CardTitle>
                  <CardDescription>
                    السعر = التكلفة الفعلية من OpenAI ÷ الاستهلاك الفعلي لنفس الفترة، ثم × (1 + الهامش) × سعر الصرف. يتحدث تلقائيًا.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <Badge variant={run.status === "success" ? "default" : "destructive"}>
                    {run.status === "success" ? "ناجحة" : run.status === "skipped" ? "بيانات غير كافية" : "فاشلة"}
                  </Badge>
                  {run.message ? (
                    <p className="rounded-md border border-border bg-muted/40 p-3">{run.message}</p>
                  ) : null}
                  <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                    {rows.map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between gap-3">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd dir="ltr">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            );
          })()}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">مفتاح إدارة OpenAI</CardTitle>
              <CardDescription>
                يُستخدم لقراءة التكلفة والرصيد الفعلي من حساب OpenAI. يُحفظ باسم OPENAI_ADMIN_API_KEY.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="outline"
                onClick={() => keyTestMutation.mutate()}
                disabled={keyTestMutation.isPending}
              >
                {keyTestMutation.isPending ? <Loader2 className="animate-spin" /> : null}
                فحص المفتاح الآن
              </Button>
              {keyTestMutation.data ? (
                <p
                  className={`rounded-md border p-3 text-sm ${
                    keyTestMutation.data.ok
                      ? "border-border bg-muted/40"
                      : "border-destructive/40 bg-destructive/5"
                  }`}
                >
                  {keyTestMutation.data.message}
                </p>
              ) : null}
            </CardContent>
          </Card>


          <Card>
            <CardHeader>
              <CardTitle className="text-base">سجل المزامنة</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.syncRuns.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد عمليات مزامنة بعد.</p>
              ) : (
                data.syncRuns.map((run) => (
                  <div
                    key={run.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant={run.status === "success" ? "default" : "destructive"}>
                        {run.status === "success" ? "ناجحة" : run.status === "skipped" ? "بيانات غير كافية" : "فاشلة"}
                      </Badge>
                      <span dir="ltr">{run.providerCode}</span>
                    </div>
                    <span className="text-muted-foreground">
                      {run.providerCostUsd !== null ? `$${usd.format(run.providerCostUsd)} · ` : ""}{dateFormat.format(new Date(run.createdAt))}
                      {run.message ? ` · ${run.message}` : ""}
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
