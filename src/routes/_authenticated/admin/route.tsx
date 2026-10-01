import { createFileRoute, Outlet, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Banknote,
  Wallet,
  Tags,
  Wrench,
  ShieldAlert,
  Menu,
  Settings,
  LogOut,
} from "lucide-react";
import { isCurrentUserAdmin } from "@/lib/wallet.functions";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ProfileSettingsDialog } from "@/components/ProfileSettingsDialog";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const ADMIN_NAV = [
  { to: "/admin", label: "نظرة عامة", icon: LayoutDashboard },
  { to: "/admin/accounts", label: "الحسابات", icon: Users },
  { to: "/admin/payments", label: "الموافقة على الإيداعات", icon: CreditCard },
  { to: "/admin/finance", label: "الملخص المالي", icon: Banknote },
  { to: "/admin/pricing", label: "التسعير", icon: Tags },
  { to: "/admin/cash-numbers", label: "أرقام الكاش", icon: Wallet },
  { to: "/admin/maintenance", label: "الصيانة", icon: Wrench },
] as const;

export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  component: AdminLayout,
});

function AdminLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const checkAdmin = useServerFn(isCurrentUserAdmin);
  const { data: isAdmin, isPending } = useQuery({
    queryKey: ["is-admin"],
    queryFn: () => checkAdmin(),
    staleTime: 300_000,
  });

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">جارٍ التحقق من الصلاحيات...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="flex max-w-md items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
          <p>هذه المنطقة متاحة للأدمن فقط.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full overflow-x-clip bg-background" dir="rtl">
      <aside className="hidden w-64 shrink-0 border-l border-border bg-secondary/50 lg:block">
        <div className="flex h-16 items-center border-b border-border px-4">
          <span className="text-lg font-bold">لوحة الأدمن</span>
        </div>
        <nav className="space-y-1 p-3">
          <AdminNavLinks />
        </nav>
        <div className="p-3">
          <AdminAccountPanel />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border bg-secondary/70 px-4 lg:justify-end">
          <div className="flex items-center gap-2 lg:hidden">
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" aria-label="فتح قائمة الأدمن">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className="w-[min(18rem,calc(100vw-2rem))] overflow-y-auto border-l border-border bg-sidebar p-0 text-sidebar-foreground shadow-xl"
              >
                <SheetTitle className="sr-only">قائمة الأدمن</SheetTitle>
                <div className="flex h-16 items-center border-b border-border px-4">
                  <span className="text-lg font-bold">لوحة الأدمن</span>
                </div>
                <nav className="space-y-1 p-3">
                  <AdminNavLinks onNavigate={() => setMobileNavOpen(false)} />
                </nav>
                <div className="border-t border-border p-3">
                  <AdminAccountPanel onAction={() => setMobileNavOpen(false)} />
                </div>
              </SheetContent>
            </Sheet>
            <span className="text-sm font-semibold lg:hidden">لوحة الأدمن</span>
          </div>

          <AdminAccountMenu />
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function AdminNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  return (
    <>
      {ADMIN_NAV.map(({ to, label, icon: Icon }) => {
        const active = pathname === to || pathname.startsWith(`${to}/`);
        return (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </>
  );
}

function AdminAccountMenu() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const displayName =
    profile?.full_name || user?.user_metadata?.["full_name"] || user?.email?.split("@")[0] || "الأدمن";
  const initials = displayName.slice(0, 2).toUpperCase();

  const handleSignOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="flex items-center gap-2">
      <div className="hidden min-w-0 text-end sm:block">
        <p className="truncate text-sm font-medium">{displayName}</p>
        <p className="truncate text-xs text-muted-foreground" dir="ltr">
          {user?.email}
        </p>
      </div>

      <Avatar className="size-9 shrink-0">
        {profile?.avatarUrl ? (
          <AvatarImage src={profile.avatarUrl} alt={displayName} className="object-cover" />
        ) : null}
        <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
          {initials}
        </AvatarFallback>
      </Avatar>

      <ProfileSettingsDialog>
        <Button variant="outline" size="icon" aria-label="إعدادات الحساب" title="إعدادات الحساب">
          <Settings className="size-[18px]" />
        </Button>
      </ProfileSettingsDialog>

      <Button
        variant="ghost"
        size="icon"
        aria-label="تسجيل الخروج"
        title="تسجيل الخروج"
        onClick={() => void handleSignOut()}
      >
        <LogOut className="size-[18px]" />
      </Button>
    </div>
  );
}

function AdminAccountPanel({ onAction }: { onAction?: () => void }) {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const displayName =
    profile?.full_name || user?.user_metadata?.["full_name"] || user?.email?.split("@")[0] || "الأدمن";
  const initials = displayName.slice(0, 2).toUpperCase();

  const handleSignOut = async () => {
    onAction?.();
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background/60 p-3">
      <div className="flex items-center gap-3">
        <Avatar className="size-10 shrink-0">
          {profile?.avatarUrl ? (
            <AvatarImage src={profile.avatarUrl} alt={displayName} className="object-cover" />
          ) : null}
          <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{displayName}</p>
          <p className="truncate text-xs text-muted-foreground" dir="ltr">
            {user?.email}
          </p>
        </div>
      </div>

      <ProfileSettingsDialog>
        <Button variant="outline" size="sm" className="w-full justify-start gap-2">
          <Settings className="size-4 shrink-0" />
          إعدادات الحساب
        </Button>
      </ProfileSettingsDialog>

      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2"
        onClick={() => void handleSignOut()}
      >
        <LogOut className="size-4 shrink-0" />
        تسجيل الخروج
      </Button>
    </div>
  );
}
