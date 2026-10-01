import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "الإعدادات | Kashaf" },
      {
        name: "description",
        content: "إعدادات حسابك الشخصي في كشاف.",
      },
      { property: "og:title", content: "الإعدادات | Kashaf" },
      {
        property: "og:description",
        content: "إعدادات حسابك الشخصي في كشاف.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const { user } = useAuth();

  return (
    <AppShell title="الإعدادات" description="تفاصيل حسابك الشخصي.">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">معلومات الحساب</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">البريد الإلكتروني</span>
            <span className="font-medium" dir="ltr">
              {user?.email ?? "—"}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">معرف المستخدم</span>
            <span className="font-mono text-xs" dir="ltr">
              {user?.id ?? "—"}
            </span>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
