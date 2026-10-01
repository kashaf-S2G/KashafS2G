import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { controlEmergencyRecheck, getEmergencyRecheck } from "@/lib/emergency-recheck.functions";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const LABEL: Record<string, string> = {
  running: "قيد التشغيل", paused: "متوقفة مؤقتًا", interrupted: "متوقفة (انقطاع)", cancelled: "أُلغيت", completed: "اكتملت",
};

export function EmergencyRecheckPanel() {
  const qc = useQueryClient();
  const get = useServerFn(getEmergencyRecheck);
  const ctl = useServerFn(controlEmergencyRecheck);
  const [confirm, setConfirm] = useState<null | "start" | "cancel">(null);
  const q = useQuery({ queryKey: ["emergency-recheck"], queryFn: () => get(), refetchInterval: (s) => (s.state.data?.run?.status === "running" ? 4000 : false) });
  const m = useMutation({
    mutationFn: (action: "start" | "pause" | "resume" | "cancel") => ctl({ data: { action } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emergency-recheck"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const run = q.data?.run;
  const active = run && ["running", "paused", "interrupted"].includes(run.status);
  const pct = run?.total ? Math.round((run.processed / run.total) * 100) : 0;

  return (
    <div className="mb-4 rounded-md border border-destructive/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">إعادة فحص الإعلانات — طوارئ</div>
        {!active && (
          <Button variant="destructive" size="sm" disabled={m.isPending || !q.data} onClick={() => setConfirm("start")}>
            إعادة فحص كل الإعلانات
          </Button>
        )}
      </div>
      {run && (
        <div className="mt-3 space-y-2 text-sm">
          {run.status === "completed" && <div className="font-semibold">اكتملت إعادة الفحص</div>}
          {run.status !== "completed" && <Progress value={pct} />}
          {run.status !== "completed" && <div>{pct}%</div>}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>الإجمالي: {run.total}</span>
            <span>{run.status === "completed" ? "تم بنجاح" : "تم التحليل"}: {run.completed}</span>
            <span>محتاج مراجعة: {run.needs_review}</span>
            <span>فشل: {run.failed}</span>
            {run.status !== "completed" && <span>متبقي: {Math.max(0, run.total - run.processed)}</span>}
          </div>
          <div>الحالة: {LABEL[run.status] ?? run.status}</div>
          {run.status === "paused" && run.stop_reason === "credits" && (
            <div className="text-destructive">
              توقفت العملية بسبب نفاد رصيد الذكاء الاصطناعي. تم حفظ ما تم إنجازه: {run.processed} من {run.total}. عند الاستئناف ستكمل العملية من النقطة التي توقفت عندها.
            </div>
          )}
          {(run.status === "paused" || run.status === "interrupted") && (
            <div className="text-muted-foreground">تم حفظ التقدم. سيتم الاستئناف من آخر نقطة عند الضغط على «استئناف».</div>
          )}
          {active && (
            <div className="flex gap-2">
              {run.status === "running" ? (
                <Button size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate("pause")}>إيقاف مؤقت</Button>
              ) : (
                <Button size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate("resume")}>استئناف</Button>
              )}
              <Button size="sm" variant="outline" disabled={m.isPending} onClick={() => setConfirm("cancel")}>إلغاء</Button>
            </div>
          )}
        </div>
      )}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "start" ? "⚠️ إعادة فحص طارئة" : "إلغاء إعادة الفحص؟"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "start"
                ? `سيتم إعادة تحليل كل الإعلانات الموجودة حاليًا وعددها ${q.data?.adsCount ?? 0}، سواء كانت جديدة أو قديمة، محللة سابقًا أو غير محللة. قد يزيد استهلاك رصيد الذكاء الاصطناعي لأن كل إعلان سيُحلل من جديد. هذه العملية للطوارئ فقط وليست المسار الطبيعي.`
                : "لن تبدأ إعلانات جديدة، وتبقى النتائج المكتملة محفوظة."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={() => { m.mutate(confirm!); setConfirm(null); }}>
              {confirm === "start" ? "بدء إعادة الفحص" : "تأكيد الإلغاء"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
