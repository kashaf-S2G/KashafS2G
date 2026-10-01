import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

export const demoDataQueryKey = (userId: string | null) => ["demo-data", userId] as const;

/**
 * شريط توضيحي يظهر للمستخدم الجديد ما دامت البيانات التجريبية موجودة في حسابه،
 * مع إمكانية حذفها دفعة واحدة عند الاستعداد لإدخال بياناته الحقيقية.
 */
export function DemoDataBanner() {
  const { userId } = useAuth();
  const qc = useQueryClient();

  const { data: counts } = useQuery({
    queryKey: demoDataQueryKey(userId),
    enabled: Boolean(userId),
    queryFn: async () => {
      const [competitors, ads, products] = await Promise.all([
        supabase.from("competitors").select("id", { count: "exact", head: true }).eq("is_demo", true),
        supabase.from("ads").select("id", { count: "exact", head: true }).eq("is_demo", true),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("is_demo", true),
      ]);
      return {
        competitors: competitors.count ?? 0,
        ads: ads.count ?? 0,
        products: products.count ?? 0,
      };
    },
  });

  const total = (counts?.competitors ?? 0) + (counts?.ads ?? 0) + (counts?.products ?? 0);

  const clear = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("clear_demo_data");
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حذف البيانات التجريبية");
      void qc.invalidateQueries();
    },
    onError: () => toast.error("تعذّر حذف البيانات التجريبية، حاول مرة أخرى."),
  });

  if (!userId || total === 0) return null;

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-[16px] border border-border bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">هذه أمثلة تجريبية لتتعرّف على التطبيق</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            أضفنا {counts?.competitors ?? 0} منافسين و{counts?.products ?? 0} منتجات و
            {counts?.ads ?? 0} إعلانات من مجال التجارة الإلكترونية، لتشاهد كيف تُحسب مدة كل إعلان
            وكيف تظهر النتائج. احذفها متى شئت وابدأ ببياناتك الحقيقية.
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 gap-2"
        disabled={clear.isPending}
        onClick={() => clear.mutate()}
      >
        <Trash2 className="size-4" />
        {clear.isPending ? "جارٍ الحذف..." : "حذف البيانات التجريبية"}
      </Button>
    </div>
  );
}
