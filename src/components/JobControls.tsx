/** أزرار التحكم المرن الموحّدة لأي عملية طويلة. */
import { CircleSlash, Loader2, Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JobRun } from "@/lib/job-run";

export function JobControls({
  job,
  size = "sm",
  cancelLabel = "إلغاء",
  className,
}: {
  job: JobRun;
  size?: "sm" | "default" | "lg";
  cancelLabel?: string;
  className?: string;
}) {
  if (!job.active) return null;

  return (
    <div className={className ? `flex flex-wrap items-center gap-2 ${className}` : "flex flex-wrap items-center gap-2"}>
      {job.status === "stopping" ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          جارٍ الإنهاء...
        </span>
      ) : job.paused ? (
        <Button type="button" size={size} variant="outline" className="gap-1.5" onClick={job.resume}>
          <Play className="size-3.5" />
          استئناف
        </Button>
      ) : (
        <Button type="button" size={size} variant="outline" className="gap-1.5" onClick={job.pause}>
          <Pause className="size-3.5" />
          إيقاف مؤقت
        </Button>
      )}

      {job.status !== "stopping" ? (
        <>
          <Button type="button" size={size} variant="secondary" className="gap-1.5" onClick={job.stop}>
            <Square className="size-3.5" />
            اكتفيت بهذا القدر
          </Button>
          <Button type="button" size={size} variant="ghost" className="gap-1.5 text-destructive" onClick={job.cancel}>
            <CircleSlash className="size-3.5" />
            {cancelLabel}
          </Button>
        </>
      ) : null}
    </div>
  );
}
