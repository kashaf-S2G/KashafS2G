/**
 * تحكّم مرن موحّد للعمليات الطويلة (زحف، تحديث البنك...):
 * تشغيل / إيقاف مؤقت / استئناف / اكتفاء بهذا القدر / إلغاء.
 * الحلقة تعمل في المتصفح خطوة بخطوة، والتحكم يُقرأ قبل كل خطوة.
 */
import { useCallback, useRef, useState } from "react";

export type JobStatus = "idle" | "running" | "paused" | "stopping" | "done" | "cancelled" | "error";

/** إشارة التوقف التي يقرأها المنطق داخل الحلقة. */
export type JobSignal = "stop" | "cancel" | null;

export type JobControl = {
  /** ينتظر إن كانت العملية موقوفة مؤقتًا، ويعيد إشارة التوقف إن طُلبت. */
  checkpoint: () => Promise<JobSignal>;
  /** قراءة فورية بدون انتظار. */
  signal: () => JobSignal;
};

export type JobRun = {
  status: JobStatus;
  /** العملية مشتغلة أو موقوفة مؤقتًا (أي أنها لم تنتهِ بعد). */
  active: boolean;
  paused: boolean;
  start: (runner: (control: JobControl) => Promise<void>) => Promise<void>;
  pause: () => void;
  resume: () => void;
  /** اكتفاء بهذا القدر: إنهاء مرتب مع الاحتفاظ بما تم. */
  stop: () => void;
  /** إلغاء: إنهاء مع محاولة التراجع عمّا أُضيف في هذه الجولة. */
  cancel: () => void;
  reset: () => void;
};

export function useJobRun(): JobRun {
  const [status, setStatus] = useState<JobStatus>("idle");
  const pausedRef = useRef(false);
  const signalRef = useRef<JobSignal>(null);
  const waiters = useRef<Array<() => void>>([]);
  const busy = useRef(false);

  const release = () => {
    const list = waiters.current;
    waiters.current = [];
    for (const fn of list) fn();
  };

  const start = useCallback(async (runner: (control: JobControl) => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    pausedRef.current = false;
    signalRef.current = null;
    setStatus("running");

    const control: JobControl = {
      signal: () => signalRef.current,
      checkpoint: async () => {
        while (pausedRef.current && !signalRef.current) {
          await new Promise<void>((resolve) => waiters.current.push(resolve));
        }
        return signalRef.current;
      },
    };

    try {
      await runner(control);
      setStatus(signalRef.current === "cancel" ? "cancelled" : "done");
    } catch {
      setStatus("error");
    } finally {
      busy.current = false;
      pausedRef.current = false;
      release();
    }
  }, []);

  const pause = useCallback(() => {
    if (!busy.current || signalRef.current) return;
    pausedRef.current = true;
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    if (!busy.current) return;
    pausedRef.current = false;
    setStatus("running");
    release();
  }, []);

  const stop = useCallback(() => {
    if (!busy.current) return;
    signalRef.current = "stop";
    pausedRef.current = false;
    setStatus("stopping");
    release();
  }, []);

  const cancel = useCallback(() => {
    if (!busy.current) return;
    signalRef.current = "cancel";
    pausedRef.current = false;
    setStatus("stopping");
    release();
  }, []);

  const reset = useCallback(() => {
    if (busy.current) return;
    setStatus("idle");
  }, []);

  return {
    status,
    active: status === "running" || status === "paused" || status === "stopping",
    paused: status === "paused",
    start,
    pause,
    resume,
    stop,
    cancel,
    reset,
  };
}
