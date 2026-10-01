import { createFileRoute } from "@tanstack/react-router";
import { AdminPasswordDialog } from "@/components/AdminPasswordDialog";
import { SecretsVaultPanel } from "@/components/SecretsVaultPanel";
import { ProjectSourcePanel } from "@/components/ProjectSourcePanel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/admin/maintenance")({
  head: () => ({
    meta: [
      { title: "الصيانة | لوحة الأدمن كشاف" },
      { name: "description", content: "أدوات الصيانة وإدارة كلمة مرور الحساب الإداري في كشاف." },
      { property: "og:title", content: "الصيانة | لوحة الأدمن كشاف" },
      { property: "og:description", content: "أدوات الصيانة وإدارة كلمة مرور الحساب الإداري في كشاف." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminMaintenancePage,
});

function AdminMaintenancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">الصيانة</h1>
        <p className="text-sm text-muted-foreground">أدوات إدارية حساسة.</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">مكان المشروع والإصدار</h2>
        <ProjectSourcePanel />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">كلمة مرور الحساب الإداري</CardTitle>
          <CardDescription>تعيين كلمة مرور جديدة للحساب الإداري المعتمد.</CardDescription>
        </CardHeader>
        <CardContent>
          <AdminPasswordDialog />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">المفاتيح الخارجية وخزانة Supabase</CardTitle>
          <CardDescription>
            حالة كل مفتاح فقط (بدون إظهار قيمته)، مع نقل القيم الحالية إلى الخزانة لتبقى فعّالة بعد نقل المشروع.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SecretsVaultPanel />
        </CardContent>
      </Card>
    </div>
  );
}
