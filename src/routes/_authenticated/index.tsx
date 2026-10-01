import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users, Megaphone, Activity, Timer } from "lucide-react";
import { isCurrentUserAdmin } from "@/lib/wallet.functions";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, useAds, useCompetitors } from "@/lib/kashaf";
import { useAuth } from "@/hooks/useAuth";
import { getDashboardSummary, type DashboardSummary } from "@/lib/dashboard.functions";

/** وضع المقارنة (?compare=1): يشغّل المنطق القديم في المتصفح ويقارنه بملخص قاعدة البيانات. */
function DashboardComparison({ summary }: { summary: DashboardSummary }) {
  const { data: competitors, isLoading: l1 } = useCompetitors();
  const { data: ads, isLoading: l2 } = useAds();
  if (l1 || l2 || !competitors || !ads) return <p className="mt-4 text-sm">جارٍ تحميل المنطق القديم للمقارنة…</p>;
  const oldActive = ads.filter((a) => a.status === "active").length;
  const oldAvg = ads.length ? Math.round(ads.reduce((s, a) => s + a.duration_days, 0) / ads.length) : 0;
  const oldLongest = [...ads].sort((a, b) => b.duration_days - a.duration_days).slice(0, 5);
  const rows: [string, string, string][] = [
    ["competitorsCount", String(competitors.length), String(summary.competitorsCount)],
    ["totalAds", String(ads.length), String(summary.totalAds)],
    ["activeAds", String(oldActive), String(summary.activeAds)],
    ["averageDuration", String(oldAvg), String(summary.averageDuration)],
    [
      "longestRunningAds",
      oldLongest.map((a) => `${a.id}:${a.duration_days}:${a.competitor?.competitor_name ?? ""}`).join(","),
      summary.longestRunningAds.map((a) => `${a.id}:${a.duration_days}:${a.competitor_name ?? ""}`).join(","),
    ],
  ];
  const ok = rows.every(([, o, n]) => o === n);
  return (
    <Card className="mt-6" data-compare-result={ok ? "match" : "mismatch"}>
      <CardHeader>
        <CardTitle className="text-base">مقارنة القديم والجديد: {ok ? "متطابق" : "يوجد اختلاف"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-xs">
        {rows.map(([k, o, n]) => (
          <p key={k} className={o === n ? "" : "font-bold text-destructive"}>
            {k}: OLD={o} | NEW={n}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Kashaf | لوحة تحكم إعلانات المنافسين" },
      {
        name: "description",
        content: "كشاف: تابع المنافسين وإعلاناتهم ومدة استمرار كل إعلان بالأيام في لوحة واحدة.",
      },
      { property: "og:title", content: "Kashaf | لوحة تحكم إعلانات المنافسين" },
      {
        property: "og:description",
        content: "كشاف: تابع المنافسين وإعلاناتهم ومدة استمرار كل إعلان بالأيام في لوحة واحدة.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof Users;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function Dashboard() {
  const navigate = useNavigate();
  const checkAdmin = useServerFn(isCurrentUserAdmin);
  const { data: isAdmin } = useQuery({
    queryKey: ["is-admin"],
    queryFn: () => checkAdmin(),
    staleTime: 300_000,
  });

  useEffect(() => {
    if (isAdmin) void navigate({ to: "/admin", replace: true });
  }, [isAdmin, navigate]);

  const { userId } = useAuth();
  const fetchSummary = useServerFn(getDashboardSummary);
  const { data: summary } = useQuery({
    queryKey: ["dashboard-summary", userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: () => fetchSummary(),
  });
  const compare =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("compare") === "1";

  const competitorsCount = summary?.competitorsCount ?? 0;
  const totalAds = summary?.totalAds ?? 0;
  const activeAdsCount = summary?.activeAds ?? 0;
  const avgDuration = summary?.averageDuration ?? 0;
  const longest = summary?.longestRunningAds ?? [];

  return (
    <AppShell title="لوحة المتابعة" description="نظرة سريعة على المنافسين وإعلاناتهم.">
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatCard label="عدد المنافسين" value={competitorsCount} icon={Users} />
        <StatCard label="إجمالي الإعلانات" value={totalAds} icon={Megaphone} />
        <StatCard label="الإعلانات النشطة" value={activeAdsCount} icon={Activity} />
        <StatCard label="متوسط المدة (يوم)" value={avgDuration} icon={Timer} />
      </div>

      {compare && summary && <DashboardComparison summary={summary} />}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">أطول الإعلانات استمرارًا</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {longest.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              لا توجد إعلانات بعد. ابدأ من{" "}
              <Link to="/competitors" className="font-medium text-primary underline">
                صفحة المنافسين
              </Link>
              .
            </p>
          ) : (
            longest.map((ad) => (
              <div
                key={ad.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
              >
                <div>
                  <p className="font-medium">{ad.product_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ad.competitor_name ?? "—"} · {formatDate(ad.creation_date)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={ad.status === "active" ? "default" : "secondary"}>
                    {ad.status === "active" ? "نشط" : "غير نشط"}
                  </Badge>
                  <span className="text-sm font-semibold">{ad.duration_days} يوم</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
