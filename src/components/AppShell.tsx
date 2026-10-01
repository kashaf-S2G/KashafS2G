import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { DemoDataBanner } from "@/components/DemoDataBanner";


export function AppShell({
  title,
  description,
  headerStart,
  actions,
  children,
}: {
  title: string;
  description?: string;
  headerStart?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full overflow-x-clip bg-background">
        <AppSidebar />

        <SidebarInset className="min-w-0 flex-1">
          <div className="flex min-h-24 items-center gap-3 border-b border-border bg-secondary/70 px-4 py-2 md:px-8">
            <SidebarTrigger className="size-11 [&_svg]:size-6" />
            <img
              src="/kashaf-header-logo.png"
              alt="Kashaf من S2G"
              className="h-10 w-auto shrink-0 object-contain sm:h-12 dark:hidden"
              width={854}
              height={292}
              decoding="async"
            />
            <img
              src="/kashaf-header-logo-dark.png"
              alt="Kashaf من S2G"
              aria-hidden="true"
              className="hidden h-10 w-auto shrink-0 object-contain sm:h-12 dark:block"
              width={854}
              height={292}
              decoding="async"
            />

          </div>

          <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
            <DemoDataBanner />
            <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
              <div className="flex items-center gap-3">
                {headerStart ? <div className="shrink-0">{headerStart}</div> : null}
                <div className="min-w-0">
                  <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl md:text-3xl">
                    {title}
                  </h1>
                  {description ? (
                    <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                  ) : null}
                </div>
              </div>
              <div className="[&>button]:w-full sm:[&>button]:w-auto">{actions}</div>
            </header>
            {children}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
