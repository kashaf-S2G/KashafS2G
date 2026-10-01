/**
 * يعرض حالة عملية خلفية من الخادم ويرسل لها أوامر التحكم.
 * العملية تكمل على الخادم حتى لو أُغلقت الصفحة، والنتيجة تظهر عند العودة.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  controlServerJob,
  getServerJob,
  startServerJob,
  type JobControlCmd,
  type JobKind,
  type ServerJob,
} from "@/lib/jobs.functions";
import type { JobRun, JobStatus } from "@/lib/job-run";

const SEEN_KEY = "kashaf-seen-jobs";

function seen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}
function markSeen(id: string) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([id, ...seen().filter((x) => x !== id)].slice(0, 50)));
  } catch {
    /* ignore */
  }
}

export function useServerJob(
  kind: JobKind,
  opts: { onFinished?: (job: ServerJob) => string | null; onProgress?: () => void } = {},
) {
  const qc = useQueryClient();
  const getFn = useServerFn(getServerJob);
  const startFn = useServerFn(startServerJob);
  const controlFn = useServerFn(controlServerJob);
  const key = ["server-job", kind];
  const [starting, setStarting] = useState(false);

  const q = useQuery({
    queryKey: key,
    queryFn: () => getFn({ data: { kind } }),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : 20000),
  });
  const job = q.data ?? null;
  const running = job?.status === "running";

  // إشعار النتيجة مرة واحدة لكل جولة منتهية (حديثة).
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const prevRunning = useRef(false);
  useEffect(() => {
    if (running) {
      prevRunning.current = true;
      optsRef.current.onProgress?.();
      return;
    }
    if (!job || !job.finishedAt) return;
    const recent = Date.now() - Date.parse(job.finishedAt) < 6 * 60 * 60_000;
    if (!prevRunning.current && (!recent || seen().includes(job.id))) return;
    prevRunning.current = false;
    if (seen().includes(job.id)) return;
    markSeen(job.id);
    optsRef.current.onProgress?.();
    const msg = optsRef.current.onFinished?.(job);
    if (job.status === "failed" || job.status === "error") toast.error(job.error ?? msg ?? "تعذّر إكمال العملية.");
    else if (msg) toast.success(msg);
  }, [job, running]);

  const setControl = useCallback(
    async (control: JobControlCmd) => {
      if (!job || !running) return;
      qc.setQueryData(key, { ...job, control });
      try {
        await controlFn({ data: { kind, id: job.id, control } });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "تعذّر إرسال الأمر.");
      }
      void q.refetch();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [job, running, kind, controlFn, qc, q],
  );

  const start = useCallback(
    async (input: { competitorIds?: string[]; scope?: "selected" | "general"; selectedIds?: string[] } = {}) => {
      setStarting(true);
      try {
        await startFn({ data: { kind, ...input } });
        prevRunning.current = true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "تعذّر بدء العملية.");
      }
      await q.refetch();
      setStarting(false);
    },
    [startFn, kind, q],
  );

  let status: JobStatus = "idle";
  if (running) {
    status = job.control === "pause" ? "paused" : job.control === "stop" || job.control === "cancel" ? "stopping" : "running";
  }

  const run: JobRun = {
    status,
    active: running || starting,
    paused: status === "paused",
    start: async () => {},
    pause: () => void setControl("pause"),
    resume: () => void setControl("none"),
    stop: () => void setControl("stop"),
    cancel: () => void setControl("cancel"),
    reset: () => {},
  };

  return { job, run, start, refetch: q.refetch, starting, lastSync: q.dataUpdatedAt || Date.now() };
}
