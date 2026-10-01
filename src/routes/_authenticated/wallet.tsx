import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock, Loader2, Upload, Wallet, XCircle } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  VODAFONE_CASH_NUMBER,
  createPaymentRequest,
  getPublicPaymentNumbers,
  getWalletState,
} from "@/lib/wallet.functions";
import { getWalletLedger } from "@/lib/ai-account.functions";
import { AiUsageLog } from "@/components/AiUsageLog";

export const Route = createFileRoute("/_authenticated/wallet")({
  head: () => ({
    meta: [
      { title: "شحن الرصيد | كشاف" },
      {
        name: "description",
        content: "اشحن رصيد كشاف بالجنيه المصري عبر فودافون كاش وادفع مقابل ما تستخدمه فقط.",
      },
      { property: "og:title", content: "شحن الرصيد | كشاف" },
      {
        property: "og:description",
        content: "اشحن رصيد كشاف بالجنيه المصري عبر فودافون كاش وادفع مقابل ما تستخدمه فقط.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WalletPage,
});

const money = new Intl.NumberFormat("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const LEDGER_LABELS: Record<string, string> = {
  deposit: "إيداع",
  ai_charge: "خصم ذكاء اصطناعي",
  admin_adjust: "تعديل إداري",
  refund: "استرداد",
};

function WalletPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fetchState = useServerFn(getWalletState);
  const fetchLedger = useServerFn(getWalletLedger);
  const submitRequest = useServerFn(createPaymentRequest);
  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const stateQuery = useQuery({ queryKey: ["wallet-state"], queryFn: () => fetchState() });
  const state = stateQuery.data;

  const ledgerQuery = useQuery({ queryKey: ["wallet-ledger"], queryFn: () => fetchLedger() });

  const fetchNumbers = useServerFn(getPublicPaymentNumbers);
  const numbersQuery = useQuery({
    queryKey: ["public-payment-numbers"],
    queryFn: () => fetchNumbers(),
    staleTime: 300_000,
  });
  const paymentNumbers =
    numbersQuery.data && numbersQuery.data.length > 0
      ? numbersQuery.data
      : [
          {
            id: "default",
            provider: "vodafone_cash",
            label: "فودافون كاش",
            number: VODAFONE_CASH_NUMBER,
            isActive: true,
            sortOrder: 0,
          },
        ];

  const minDeposit = state?.minDepositEgp ?? 200;
  const pending = state?.hasPendingRequest === true;

  const depositMutation = useMutation({
    mutationFn: async () => {
      const value = Number(amount);
      if (!Number.isFinite(value) || value < minDeposit) {
        throw new Error(`الحد الأدنى للإيداع ${minDeposit} جنيه.`);
      }
      if (!file) throw new Error("ارفع صورة التحويل أولًا.");
      if (!user) throw new Error("يجب تسجيل الدخول.");
      setUploading(true);
      try {
        const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${user.id}/${Date.now()}.${extension}`;
        const { error } = await supabase.storage.from("payment-proofs").upload(path, file, {
          contentType: file.type || "image/jpeg",
          upsert: false,
        });
        if (error) throw new Error("تعذر رفع صورة التحويل.");
        return await submitRequest({ data: { proofPath: path, amount: value } });
      } finally {
        setUploading(false);
      }
    },
    onSuccess: async () => {
      setFile(null);
      setAmount("");
      if (fileInput.current) fileInput.current.value = "";
      await queryClient.invalidateQueries({ queryKey: ["wallet-state"] });
      toast.success("تم إرسال طلب الشحن، وهو الآن قيد المراجعة.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const busy = depositMutation.isPending || uploading;

  return (
    <AppShell
      title="رصيدك في كشاف"
      description="ادفع مقابل ما تستخدمه فقط: اشحن رصيدك بالجنيه ويُخصم من الرصيد تكلفة كل عملية ذكاء اصطناعي."
    >
      <div className="mx-auto max-w-4xl space-y-4">
        {stateQuery.isPending ? (
          <Card className="h-48 animate-pulse bg-muted/50" />
        ) : stateQuery.isError || !state ? (
          <Card>
            <CardContent className="p-6 text-sm text-destructive">
              تعذر تحميل بيانات الرصيد. حاول مرة أخرى لاحقًا.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wallet className="size-4" />
                  رصيدك الحالي
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-sm text-muted-foreground">الرصيد المتاح</p>
                  <p className="mt-1 text-2xl font-bold">{money.format(state.availableEgp)} جنيه</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">إجمالي الرصيد</p>
                  <p className="mt-1 font-semibold">{money.format(state.balanceEgp)} جنيه</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">محجوز لعمليات جارية</p>
                  <p className="mt-1 font-semibold">{money.format(state.heldEgp)} جنيه</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">حالة آخر طلب</p>
                  <div className="mt-1">
                    {state.latestRequest ? (
                      <Badge
                        variant={
                          state.latestRequest.status === "approved"
                            ? "default"
                            : state.latestRequest.status === "rejected"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {state.latestRequest.status === "approved"
                          ? "تم القبول"
                          : state.latestRequest.status === "rejected"
                            ? "مرفوض"
                            : "قيد المراجعة"}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">لا يوجد طلب</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {pending ? (
              <Card className="border-primary/40 bg-primary/5">
                <CardContent className="flex items-start gap-3 p-5">
                  <Clock className="mt-0.5 size-5 shrink-0 text-primary" />
                  <p className="text-sm leading-6">
                    طلب الشحن قيد المراجعة. سيُضاف المبلغ إلى رصيدك بعد موافقة الإدارة، ولا يمكن إرسال
                    طلب آخر قبل مراجعة الطلب الحالي.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {state.latestRequest?.status === "rejected" ? (
              <Card className="border-destructive/40 bg-destructive/5">
                <CardContent className="flex items-start gap-3 p-5">
                  <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
                  <p className="text-sm leading-6">
                    تم رفض طلبك السابق.{state.latestRequest.note ? ` السبب: ${state.latestRequest.note}` : ""} يمكنك
                    إرسال طلب جديد.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">شحن الرصيد عبر Vodafone Cash</CardTitle>
                <CardDescription>
                  حوّل المبلغ الذي تريده (بحد أدنى {money.format(minDeposit)} جنيه)، ثم اكتب المبلغ وارفع صورة
                  التحويل.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  {paymentNumbers.map((item) => (
                    <div key={item.id} className="rounded-lg border border-border p-4">
                      <p className="text-sm text-muted-foreground">{item.label}</p>
                      <p className="mt-1 text-lg font-bold" dir="ltr">
                        {item.number}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="amount">المبلغ الذي حوّلته (جنيه)</Label>
                  <Input
                    id="amount"
                    type="number"
                    min={minDeposit}
                    step="1"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder={String(minDeposit)}
                    disabled={pending}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="proof">صورة التحويل</Label>
                  <Input
                    id="proof"
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    disabled={pending}
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  />
                  {file ? <p className="text-xs text-muted-foreground">{file.name}</p> : null}
                </div>

                <Button onClick={() => depositMutation.mutate()} disabled={!file || !amount || busy || pending}>
                  {busy ? <Loader2 className="animate-spin" /> : <Upload className="size-4" />}
                  {pending ? "طلبك قيد المراجعة" : "إرسال طلب الشحن"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">سجل الحركات المالية</CardTitle>
                <CardDescription>كل إيداع وخصم على رصيدك.</CardDescription>
              </CardHeader>
              <CardContent>
                {ledgerQuery.isPending ? (
                  <div className="h-24 animate-pulse rounded-md bg-muted/50" />
                ) : (ledgerQuery.data?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد حركات بعد.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {ledgerQuery.data!.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                        <div>
                          <p className="font-medium">{LEDGER_LABELS[entry.kind] ?? entry.kind}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(entry.createdAt).toLocaleString("ar-EG-u-nu-latn")}
                            {entry.note ? ` — ${entry.note}` : ""}
                          </p>
                        </div>
                        <div className="text-left">
                          <p className={entry.amountEgp < 0 ? "font-semibold text-destructive" : "font-semibold text-primary"}>
                            {entry.amountEgp < 0 ? "−" : "+"}
                            {money.format(Math.abs(entry.amountEgp))} جنيه
                          </p>
                          <p className="text-xs text-muted-foreground">
                            الرصيد بعدها {money.format(entry.balanceAfterEgp)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <AiUsageLog />
          </>
        )}
      </div>
    </AppShell>
  );
}
