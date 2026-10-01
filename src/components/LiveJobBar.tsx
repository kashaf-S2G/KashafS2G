/** شريط متابعة لحظي لأي عملية زحف: ماذا يحدث الآن، منذ متى، وآخر تحديث. */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ServerJob } from "@/lib/jobs.functions";
import type { JobRun } from "@/lib/job-run";
import { cn } from "@/lib/utils";

type Sj = { job: ServerJob | null; run: JobRun; starting: boolean; lastSync: number };

const PC_PHASE: Record<string, string> = {
  profiles: "يبني ملفات بحث للمنتجات",
  vocabulary: "يجهّز مفاتيح البحث",
  search: "يبحث عن إعلانات في مكتبة الإعلانات",
  analysis: "يحلّل الإعلانات ويطابقها مع منتجاتك",
};
const CC_PHASE: Record<string, string> = {
  search: "يبحث عن إعلانات وصفحات",
  analysis: "يحلّل الصفحات ويطابقها مع الفئات",
};

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m} د ${s} ث` : `${s} ث`;
}

function describe(j: ServerJob): { title: string; detail: string; percent: number | null } {
  if (j.products) {
    const p = j.products;
    return {
      title: `${PC_PHASE[p.phase] ?? "يعمل"}${p.currentKey ? ` — «${p.currentKey}»` : ""}`,
      detail: `مفاتيح ${p.keysDone}/${p.keysTotal} • إعلانات ${p.adsFound} • تم تحليل ${p.adsAnalyzed} • مطابقات ${p.matches}`,
      percent: p.keysTotal ? Math.round((p.keysDone / p.keysTotal) * 100) : null,
    };
  }
  if (j.cats) {
    const c = j.cats;
    return {
      title: `${CC_PHASE[c.phase] ?? "يعمل"}${c.currentKey ? ` — «${c.currentKey}»` : ""}`,
      detail: `مفاتيح ${c.keysDone}/${c.keysTotal} • صفحات ${c.pagesFound} • تم تحليل ${c.pagesAnalyzed} • مطابقة ${c.matches}`,
      percent: c.keysTotal ? Math.round((c.keysDone / c.keysTotal) * 100) : null,
    };
  }
  if (j.bank) {
    return {
      title: j.bank.phase === "categories" ? "يستخرج الفئات من منتجاتك" : "يستخرج مصطلحات البحث من منتجاتك",
      detail: `مصطلحات ${j.bank.terms} • فئات ${j.bank.categories}`,
      percent: null,
    };
  }
  return { title: "يعمل على الخادم", detail: "", percent: null };
}

export function LiveJobBar({ sj, className }: { sj: Sj; className?: string }) {
  const running = sj.job?.status === "running";
  const show = sj.starting || running;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!show) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [show]);
  if (!show) return null;

  const job = running ? sj.job : null;
  const d = job ? describe(job) : { title: "جارٍ بدء العملية على الخادم...", detail: "", percent: null };
  let title = d.title;
  if (sj.run.status === "paused") title = `موقوفة مؤقتًا — ${d.title}`;
  if (sj.run.status === "stopping") title = "جارٍ إنهاء العملية وحفظ ما تم...";
  const elapsed = job ? Math.max(0, Math.round((now - Date.parse(job.startedAt)) / 1000)) : 0;
  const since = Math.max(0, Math.round((now - sj.lastSync) / 1000));

  return (
    <div role="status" aria-live="polite" className={cn("mb-4 space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          {sj.run.paused ? (
            <span className="size-2.5 shrink-0 rounded-full bg-muted-foreground" />
          ) : (
            <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
          )}
          <span className="truncate">{title}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {job && <>المدة {fmt(elapsed)} • </>}آخر تحديث منذ {fmt(since)}
          {d.percent !== null && <> • {d.percent}%</>}
        </span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-primary/15">
        {d.percent !== null && d.percent > 0 ? (
          <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${d.percent}%` }} />
        ) : (
          <div className={cn("live-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-primary", sj.run.paused && "[animation-play-state:paused]")} />
        )}
      </div>
      {d.detail && <p className="text-xs text-muted-foreground">{d.detail}</p>}
    </div>
  );
}
