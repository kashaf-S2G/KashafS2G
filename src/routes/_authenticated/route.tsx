import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { attachPersistence } from "@/lib/query-persist";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ context }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    // استعادة كاش هذا المستخدم فقط قبل عرض الصفحات (عرض فوري ثم تحديث صامت).
    await attachPersistence(context.queryClient, data.user.id);
    return { user: data.user };
  },
  component: () => <Outlet />,
});
