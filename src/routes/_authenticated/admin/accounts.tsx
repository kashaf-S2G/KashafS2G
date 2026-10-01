import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { listAdminAccounts, toggleAdminRole } from "@/lib/wallet.functions";

export const Route = createFileRoute("/_authenticated/admin/accounts")({
  head: () => ({
    meta: [
      { title: "الحسابات | لوحة الأدمن كشاف" },
      { name: "description", content: "إدارة حسابات المستخدمين وصلاحيات الأدمن في كشاف." },
      { property: "og:title", content: "الحسابات | لوحة الأدمن كشاف" },
      { property: "og:description", content: "إدارة حسابات المستخدمين وصلاحيات الأدمن في كشاف." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminAccountsPage,
});

const numberFormat = new Intl.NumberFormat("ar-EG-u-nu-latn");
const money = new Intl.NumberFormat("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { dateStyle: "medium" });

function AdminAccountsPage() {
  const queryClient = useQueryClient();
  const fetchAccounts = useServerFn(listAdminAccounts);
  const toggleRole = useServerFn(toggleAdminRole);
  const [search, setSearch] = useState("");

  const accountsQuery = useQuery({
    queryKey: ["admin-accounts", search],
    queryFn: () => fetchAccounts({ data: { search, page: 1 } }),
    retry: false,
  });

  const roleMutation = useMutation({
    mutationFn: (vars: { userId: string; isAdmin: boolean }) => toggleRole({ data: vars }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-overview"] }),
      ]);
      toast.success("تم تحديث الصلاحية.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">الحسابات</h1>
        <p className="text-sm text-muted-foreground">بحث وإدارة صلاحيات المستخدمين.</p>
      </div>

      <Input
        placeholder="بحث بالبريد أو الاسم"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="max-w-sm"
      />

      {accountsQuery.isError ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-6 text-sm">{(accountsQuery.error as Error).message}</CardContent>
        </Card>
      ) : accountsQuery.isPending ? (
        <Card className="h-40 animate-pulse bg-muted/50" />
      ) : accountsQuery.data.accounts.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">لا توجد حسابات مطابقة.</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            عدد النتائج: {numberFormat.format(accountsQuery.data.total)}
          </p>
          {accountsQuery.data.accounts.map((account) => (
            <Card key={account.id}>
              <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{account.fullName}</p>
                    {account.isAdmin ? <Badge>أدمن</Badge> : null}
                    <Badge variant={account.availableEgp > 0 ? "default" : "secondary"}>
                      {account.availableEgp > 0 ? "لديه رصيد" : "بدون رصيد"}
                    </Badge>
                  </div>
                  <p className="break-all text-xs text-muted-foreground" dir="ltr">
                    {account.email}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    الرصيد {money.format(account.balanceEgp)} جنيه · المتاح{" "}
                    {money.format(account.availableEgp)} جنيه · محجوز {money.format(account.heldEgp)} جنيه
                  </p>
                  <p className="text-xs text-muted-foreground">
                    إجمالي خصومات AI {money.format(account.spentEgp)} جنيه · انضم{" "}
                    {dateFormat.format(new Date(account.createdAt))}
                  </p>
                </div>
                <Button
                  variant={account.isAdmin ? "outline" : "default"}
                  size="sm"
                  disabled={roleMutation.isPending}
                  onClick={() => roleMutation.mutate({ userId: account.id, isAdmin: !account.isAdmin })}
                >
                  {account.isAdmin ? "سحب صلاحية الأدمن" : "منح صلاحية الأدمن"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
