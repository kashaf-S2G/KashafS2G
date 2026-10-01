import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  LayoutDashboard,
  Users,
  Megaphone,
  Package,
  Radar,
  Trophy,
  LogOut,
  Settings,
  User,
  
  CreditCard,
  ShieldCheck,
  Scale,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { isCurrentUserAdmin } from "@/lib/wallet.functions";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ProfileSettingsDialog } from "@/components/ProfileSettingsDialog";
import { useProfile } from "@/hooks/useProfile";

const NAV = [
  { to: "/", label: "لوحة التحكم", icon: LayoutDashboard },
  { to: "/competitors", label: "المنافسين", icon: Users },
  { to: "/competitor-discovery", label: "اكتشاف منافسين", icon: Radar },
  { to: "/ads", label: "الإعلانات", icon: Megaphone },
  { to: "/products", label: "المنتجات", icon: Package },
  { to: "/problems-benefits", label: "المشاكل", icon: Scale },
  { to: "/top10", label: "Top10", icon: Trophy },
  { to: "/discovery", label: "بنك المصطلحات والفئات", icon: Radar },
  
  { to: "/wallet", label: "شحن الرصيد", icon: CreditCard },
] as const;

const ADMIN_NAV = [
  { to: "/admin", label: "لوحة الأدمن", icon: ShieldCheck },
] as const;

export function AppSidebar() {
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile();
  const { state, isMobile } = useSidebar();
  const checkAdmin = useServerFn(isCurrentUserAdmin);
  // التحقق من صلاحية الأدمن يتم في الخادم؛ إخفاء الرابط تحسين واجهة فقط.
  const { data: isAdmin } = useQuery({
    queryKey: ["is-admin"],
    queryFn: () => checkAdmin(),
    enabled: Boolean(user),
    staleTime: 300_000,
  });
  const collapsed = state === "collapsed" && !isMobile;

  const displayName = profile?.full_name || user?.user_metadata?.["full_name"] || user?.email?.split("@")[0] || "المستخدم";
  const initials = displayName.slice(0, 2).toUpperCase();

  useEffect(() => {
    if (profile) document.documentElement.classList.toggle("dark", profile.dark_mode);
  }, [profile]);

  return (
    <Sidebar side="right" collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4 mb-4">
        {collapsed ? (
          <div className="flex justify-center">
            <Avatar className="size-11">
              {profile?.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt={displayName} className="object-cover" /> : null}
              <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
          </div>
        ) : user ? (
          <div className="flex items-center gap-4">
            <Avatar className="size-11 shrink-0">
              {profile?.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt={displayName} className="object-cover" /> : null}
              <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-medium text-sidebar-foreground">
                {displayName}
              </p>
              <p className="truncate text-xs text-sidebar-foreground/70" dir="ltr">
                {user.email}
              </p>
            </div>

            <ProfileSettingsDialog>
              <Button
                variant="outline"
                size="icon"
                className="size-9 shrink-0 border-sidebar-border bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                aria-label="فتح إعدادات الحساب"
                title="إعدادات الحساب"
              >
                <Settings className="size-[18px]" />
              </Button>
            </ProfileSettingsDialog>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <Avatar className="size-11 shrink-0">
              <AvatarFallback className="bg-muted text-muted-foreground">
                <User className="size-5" />
              </AvatarFallback>
            </Avatar>
            <p className="text-sm text-sidebar-foreground/70">غير مسجل</p>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {(isAdmin ? ADMIN_NAV : NAV).map(({ to, label, icon: Icon }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton asChild tooltip={label}>
                    <Link
                      to={to}
                      activeOptions={{ exact: to === "/" }}
                      className="data-[status=active]:bg-primary data-[status=active]:text-primary-foreground"
                    >
                      <Icon className="size-4" />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {user ? (
        <SidebarFooter>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => void signOut()}
          >
            <LogOut className="size-4 shrink-0" />
            {!collapsed ? "تسجيل الخروج" : null}
          </Button>
        </SidebarFooter>
      ) : null}
    </Sidebar>
  );
}
