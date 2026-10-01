import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // يبقى في الذاكرة 24 ساعة ليُحفظ ويُستعاد؛ لا علاقة له بموعد التحديث.
        gcTime: 24 * 60 * 60 * 1000,
        // لا طلب جديد لمجرد التنقل خلال دقيقتين؛ بعدها تحديث صامت في الخلفية مع عرض الكاش.
        staleTime: 2 * 60 * 1000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    // صفحات القوائم تستعيد موضعها عبر نظام نقطة التوقف؛ لا نترك الموجّه يصفّر التمرير فوقه.
    scrollRestoration: ({ location }) => !/^\/(products|ads|competitors|problems-benefits)\/?$/.test(location.pathname),
    defaultPreloadStaleTime: 0,
  });

  return router;
};
