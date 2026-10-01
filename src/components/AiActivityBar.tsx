/** شريط لحظي يوضح ما يفعله الذكاء الاصطناعي الآن: هل يعمل؟ ماذا أنجز؟ وكم تبقى؟ */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Brain, CirclePause, Loader2 } from "lucide-react";
import { getAiActivity } from "@/lib/ai-activity.functions";
import { cn } from "@/lib/utils";

export function AiActivityBar({ className }: { className?: string }) {
  const get = useServerFn(getAiActivity);
  const { data: a } = useQuery({
    queryKey: ["ai-activity"],
    queryFn: () => get(),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return 15000;
      return d.active || d.remaining > 0 ? 3000 : 30000;
    },
  });
  if (!a || (a.remaining === 0 && a.completed === 0 && a.failed === 0 && a.needsReview === 0)) return null;

  const done = a.completed + a.needsReview + a.failed;
  const total = done + a.remaining;
  const perMin = a.doneLast10m / 10;
  const etaMin = perMin > 0 ? Math.ceil(a.remaining / perMin) : null;
  const eta = etaMin == null ? null : etaMin < 60 ? `${etaMin} دقيقة` : `${Math.floor(etaMin / 60)} ساعة و${etaMin % 60} دقيقة`;
  const working = a.active || (a.doneLast10m > 0 && a.remaining > 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  let title: string;
  let icon: React.ReactNode;
  if (working) {
    title = `الذكاء الاصطناعي يحلّل الإعلانات الآن — تبقّى ${a.remaining}`;
    icon = <Loader2 className="size-4 shrink-0 animate-spin text-primary" />;
  } else if (a.blocked) {
    title = `تحليل الذكاء الاصطناعي متوقف — الرصيد غير كافٍ (تبقّى ${a.remaining})`;
    icon = <CirclePause className="size-4 shrink-0 text-destructive" />;
  } else if (a.remaining > 0) {
    title = `في انتظار التحليل: ${a.remaining} إعلان`;
    icon = <Brain className="size-4 shrink-0 text-muted-foreground" />;
  } else {
    title = "لا يوجد تحليل ذكاء اصطناعي جارٍ حاليًا";
    icon = <Brain className="size-4 shrink-0 text-muted-foreground" />;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mb-4 space-y-2 rounded-lg border p-3 text-sm",
        a.blocked ? "border-destructive/30 bg-destructive/5" : "border-primary/30 bg-primary/5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          {icon}
          <span className="truncate">{title}</span>
        </span>
        <span className="text-xs text-muted-foreground">{pct}% مكتمل</span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-primary/15">
        {pct > 0 ? (
          <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${pct}%` }} />
        ) : (
          working && <div className="live-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-primary" />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        تم تحليل {a.completed} • قيد المعالجة {a.processing} • منتظر {a.pending}
        {a.needsReview > 0 && <> • يحتاج مراجعة {a.needsReview}</>}
        {a.failed > 0 && <> • فشل نهائيًا {a.failed}</>}
        {a.lastDoneAt && <> • آخر إنجاز {new Date(a.lastDoneAt).toLocaleString("ar-EG")}</>}
      </p>
      {working && (
        <p className="text-xs text-muted-foreground">
          السرعة: {perMin.toFixed(1)} إعلان/دقيقة{eta && <> • الوقت المتبقي تقريبًا: {eta}</>}
          {" "}• يعمل في الخلفية حتى لو أنهيت جولة الزحف أو أغلقت الصفحة.
        </p>
      )}
      {a.recent.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-primary">آخر النتائج</summary>
          <ul className="mt-2 space-y-1.5">
            {a.recent.map((r) => (
              <li key={r.id} className="rounded border bg-background/60 p-2">
                <div className="flex justify-between gap-2">
                  <span className="truncate font-medium">{r.page || "إعلان"}</span>
                  <span className={r.status === "completed" ? "text-primary" : r.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
                    {r.status === "completed" ? `✓ ${r.product ?? "مطابق"}` : r.status === "failed" ? "فشل" : "يحتاج مراجعة"}
                    {r.score != null && <> ({Math.round(r.score * (r.score <= 1 ? 100 : 1))}%)</>}
                  </span>
                </div>
                {r.text && <p className="truncate text-muted-foreground">{r.text}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {a.blocked && a.lastError && <p className="text-xs text-destructive">{a.lastError}</p>}
    </div>
  );
}
