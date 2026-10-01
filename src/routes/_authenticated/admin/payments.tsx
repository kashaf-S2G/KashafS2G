import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  approvePaymentRequest,
  listPaymentRequests,
  rejectPaymentRequest,
} from "@/lib/wallet.functions";

export const Route = createFileRoute("/_authenticated/admin/payments")({
  head: () => ({
    meta: [
      { title: "الموافقة على طلبات الشحن | لوحة الأدمن كشاف" },
      { name: "description", content: "مراجعة طلبات شحن الرصيد وقبولها أو رفضها." },
      { property: "og:title", content: "الموافقة على طلبات الشحن | لوحة الأدمن كشاف" },
      { property: "og:description", content: "مراجعة طلبات شحن الرصيد وقبولها أو رفضها." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPaymentsPage,
});

const dateFormat = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { dateStyle: "medium", timeStyle: "short" });
const numberFormat = new Intl.NumberFormat("ar-EG-u-nu-latn");

function AdminPaymentsPage() {
  const queryClient = useQueryClient();
  const fetchRequests = useServerFn(listPaymentRequests);
  const approve = useServerFn(approvePaymentRequest);
  const reject = useServerFn(rejectPaymentRequest);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const requestsQuery = useQuery({
    queryKey: ["admin-payment-requests"],
    queryFn: () => fetchRequests({ data: {} }),
    retry: false,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-payment-requests"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-finance"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-accounts"] }),
      queryClient.invalidateQueries({ queryKey: ["wallet-state"] }),
      queryClient.invalidateQueries({ queryKey: ["wallet-ledger"] }),
    ]);
  };

  const approveMutation = useMutation({
    mutationFn: (id: string) => approve({ data: { id } }),
    onSuccess: async () => {
      await refresh();
      toast.success("تم قبول الطلب وإضافة الرصيد.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => reject({ data: { id, note: notes[id] ?? "" } }),
    onSuccess: async () => {
      await refresh();
      toast.success("تم رفض الطلب.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const busyId = approveMutation.isPending
    ? approveMutation.variables
    : rejectMutation.isPending
      ? rejectMutation.variables
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">الموافقة على طلبات الشحن</h1>
        <p className="text-sm text-muted-foreground">قبول أو رفض طلبات شحن الرصيد.</p>
      </div>

      {requestsQuery.isPending ? (
        <Card className="h-48 animate-pulse bg-muted/50" />
      ) : requestsQuery.isError ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-3 p-6 text-sm">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
            <p>{(requestsQuery.error as Error)?.message || "هذه الصفحة متاحة للأدمن فقط."}</p>
          </CardContent>
        </Card>
      ) : requestsQuery.data.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">لا توجد طلبات حتى الآن.</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {requestsQuery.data.map((request) => (
            <Card key={request.id}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-base">{request.userName}</CardTitle>
                <Badge
                  variant={
                    request.status === "approved"
                      ? "default"
                      : request.status === "rejected"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {request.status === "approved" ? "مقبول" : request.status === "rejected" ? "مرفوض" : "قيد المراجعة"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-sm text-muted-foreground">البريد الإلكتروني</p>
                    <p className="mt-1 break-all text-sm font-medium" dir="ltr">
                      {request.userEmail}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">المبلغ</p>
                    <p className="mt-1 text-sm font-medium">{numberFormat.format(request.amount)} جنيه</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">تاريخ الطلب</p>
                    <p className="mt-1 text-sm font-medium">{dateFormat.format(new Date(request.createdAt))}</p>
                  </div>
                </div>

                {request.proofUrl ? (
                  <a href={request.proofUrl} target="_blank" rel="noreferrer" className="block">
                    <img
                      src={request.proofUrl}
                      alt={`صورة تحويل ${request.userName}`}
                      loading="lazy"
                      className="max-h-72 w-full rounded-lg border border-border object-contain"
                    />
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">تعذر عرض صورة التحويل.</p>
                )}

                {request.status === "pending" ? (
                  <div className="space-y-3">
                    <Input
                      placeholder="سبب الرفض (اختياري)"
                      value={notes[request.id] ?? ""}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [request.id]: event.target.value }))
                      }
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => approveMutation.mutate(request.id)} disabled={busyId === request.id}>
                        {busyId === request.id && approveMutation.isPending ? (
                          <Loader2 className="animate-spin" />
                        ) : null}
                        قبول
                      </Button>
                      <Button
                        variant="outline"
                        className="text-destructive"
                        onClick={() => rejectMutation.mutate(request.id)}
                        disabled={busyId === request.id}
                      >
                        {busyId === request.id && rejectMutation.isPending ? (
                          <Loader2 className="animate-spin" />
                        ) : null}
                        رفض
                      </Button>
                    </div>
                  </div>
                ) : request.note ? (
                  <p className="text-sm text-muted-foreground">ملاحظة: {request.note}</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
