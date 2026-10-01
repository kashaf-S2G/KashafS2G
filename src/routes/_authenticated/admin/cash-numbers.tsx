import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  deletePaymentNumber,
  listPaymentNumbers,
  upsertPaymentNumber,
} from "@/lib/wallet.functions";

export const Route = createFileRoute("/_authenticated/admin/cash-numbers")({
  head: () => ({
    meta: [
      { title: "أرقام الكاش | لوحة الأدمن كشاف" },
      { name: "description", content: "إدارة أرقام التحويل الظاهرة لمشتركي كشاف." },
      { property: "og:title", content: "أرقام الكاش | لوحة الأدمن كشاف" },
      { property: "og:description", content: "إدارة أرقام التحويل الظاهرة لمشتركي كشاف." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminCashNumbersPage,
});

function AdminCashNumbersPage() {
  const queryClient = useQueryClient();
  const fetchNumbers = useServerFn(listPaymentNumbers);
  const upsert = useServerFn(upsertPaymentNumber);
  const remove = useServerFn(deletePaymentNumber);

  const [label, setLabel] = useState("");
  const [number, setNumber] = useState("");
  const [provider, setProvider] = useState("vodafone_cash");

  const numbersQuery = useQuery({
    queryKey: ["admin-payment-numbers"],
    queryFn: () => fetchNumbers(),
    retry: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-payment-numbers"] });

  const addMutation = useMutation({
    mutationFn: () =>
      upsert({ data: { provider, label, number, isActive: true, sortOrder: numbersQuery.data?.length ?? 0 } }),
    onSuccess: async () => {
      setLabel("");
      setNumber("");
      await refresh();
      toast.success("تمت إضافة الرقم.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (vars: { id: string; provider: string; label: string; number: string; isActive: boolean; sortOrder: number }) =>
      upsert({ data: vars }),
    onSuccess: async () => {
      await refresh();
      toast.success("تم تحديث حالة الرقم.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: async () => {
      await refresh();
      toast.success("تم حذف الرقم.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">أرقام الكاش</h1>
        <p className="text-sm text-muted-foreground">الأرقام المفعّلة تظهر للمستخدمين في صفحة شحن الرصيد.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">إضافة رقم جديد</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="label">الاسم الظاهر</Label>
            <Input id="label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="فودافون كاش" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="number">الرقم</Label>
            <Input id="number" dir="ltr" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="01000000000" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="provider">المزوّد</Label>
            <Input id="provider" dir="ltr" value={provider} onChange={(e) => setProvider(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button className="w-full" disabled={addMutation.isPending} onClick={() => addMutation.mutate()}>
              إضافة
            </Button>
          </div>
        </CardContent>
      </Card>

      {numbersQuery.isError ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-6 text-sm">{(numbersQuery.error as Error).message}</CardContent>
        </Card>
      ) : numbersQuery.isPending ? (
        <Card className="h-32 animate-pulse bg-muted/50" />
      ) : numbersQuery.data.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">لا توجد أرقام مضافة.</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {numbersQuery.data.map((row) => (
            <Card key={row.id}>
              <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{row.label}</p>
                    <Badge variant={row.isActive ? "default" : "secondary"}>{row.isActive ? "مفعّل" : "موقوف"}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground" dir="ltr">
                    {row.number}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`active-${row.id}`}
                      checked={row.isActive}
                      onCheckedChange={(checked) =>
                        toggleMutation.mutate({
                          id: row.id,
                          provider: row.provider,
                          label: row.label,
                          number: row.number,
                          isActive: checked,
                          sortOrder: row.sortOrder,
                        })
                      }
                    />
                    <Label htmlFor={`active-${row.id}`} className="text-sm">
                      ظاهر للمستخدمين
                    </Label>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    aria-label="حذف الرقم"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(row.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
