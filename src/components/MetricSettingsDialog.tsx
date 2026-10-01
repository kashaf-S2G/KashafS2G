import { useState } from "react";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { unitOf } from "@/lib/metrics/scoring";
import { useSaveMetricSetting, useSaveMetricSettings } from "@/lib/metrics/store";
import { applyEnabledChange, applyWeightChange, normalizedWeights } from "@/lib/metrics/weights";
import type { ResolvedMetric } from "@/lib/metrics/types";

function toNum(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function MetricRow({
  metric,
  weight,
  onEnabledChange,
  onWeightChange,
}: {
  metric: ResolvedMetric;
  weight: number;
  onEnabledChange: (enabled: boolean) => void;
  onWeightChange: (weight: number) => void;
}) {
  const save = useSaveMetricSetting();
  const unit = unitOf(metric);

  const updateCondition = (patch: Partial<ResolvedMetric>) => {
    const next = { ...metric, ...patch };
    save.mutate(
      {
        metric_id: metric.id,
        enabled: next.enabled,
        target_value: next.target_value,
        minimum_value: next.minimum_value,
        maximum_value: next.maximum_value,
        weight: next.weight,
        scoring_method: "binary",
      },
      { onError: (e) => toast.error((e as Error).message) },
    );
  };

  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{metric.name}</p>
            {!metric.is_available ? (
              <Badge variant="secondary" className="text-[10px]">
                غير متاح حاليًا
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{metric.description}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            مصدر البيانات: {metric.data_source}
            {!metric.is_available ? " (بانتظار توفر البيانات)" : ""}
          </p>
        </div>
        <Switch
          checked={metric.enabled && metric.is_available}
          disabled={!metric.is_available}
          onCheckedChange={onEnabledChange}
        />
      </div>

      {metric.enabled && metric.is_available ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {metric.condition_type === "between" ? (
            <>
              <div className="space-y-1">
                <Label className="text-xs">أقل قيمة {unit ? `(${unit})` : ""}</Label>
                <Input
                  type="number"
                  defaultValue={metric.minimum_value ?? ""}
                  onBlur={(e) => updateCondition({ minimum_value: toNum(e.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">أعلى قيمة {unit ? `(${unit})` : ""}</Label>
                <Input
                  type="number"
                  defaultValue={metric.maximum_value ?? ""}
                  onBlur={(e) => updateCondition({ maximum_value: toNum(e.target.value) })}
                />
              </div>
            </>
          ) : (
            <div className="space-y-1">
              <Label className="text-xs">
                الشرط {metric.condition_type === "lte" ? "≤" : "≥"} {unit ? `(${unit})` : ""}
              </Label>
              <Input
                type="number"
                defaultValue={metric.target_value ?? ""}
                onBlur={(e) => updateCondition({ target_value: toNum(e.target.value) })}
              />
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">الوزن (%)</Label>
            <Input
              key={weight}
              type="number"
              min={0}
              max={100}
              step="1"
              defaultValue={weight}
              onBlur={(e) => {
                const v = toNum(e.target.value);
                if (v !== null && Math.round(v) !== Math.round(weight)) onWeightChange(v);
              }}
            />
          </div>

          <div className="flex items-end">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              عند التحقق يحصل المنتج على {weight}% من الدرجة، وعند عدم التحقق على 0.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MetricSettingsDialog({ metrics }: { metrics: ResolvedMetric[] }) {
  const [open, setOpen] = useState(false);
  const saveAll = useSaveMetricSettings();
  const weights = normalizedWeights(metrics);
  const total = [...weights.values()].reduce((a, b) => a + b, 0);

  const commit = (settings: ReturnType<typeof applyWeightChange>) =>
    saveAll.mutate(settings, { onError: (e) => toast.error((e as Error).message) });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Settings2 className="size-4" />
          إعدادات المقاييس
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto" dir="rtl">
        <DialogHeader className="text-right">
          <DialogTitle>إعدادات المقاييس</DialogTitle>
          <DialogDescription>
            التقييم ثنائي: المقياس إما محقق فيأخذ وزنه كاملًا أو غير محقق فيأخذ 0. مجموع أوزان
            المقاييس المفعلة 100% دائمًا، وأي تعديل في وزن يُعاد توزيعه على الباقي تلقائيًا.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg bg-muted px-3 py-2 text-xs">
          مجموع الأوزان الحالي: <strong>{Math.round(total)}%</strong>
        </div>

        <div className="grid gap-3">
          {metrics.map((m) => (
            <MetricRow
              key={m.id}
              metric={m}
              weight={weights.get(m.id) ?? 0}
              onEnabledChange={(enabled) => commit(applyEnabledChange(metrics, m.id, enabled))}
              onWeightChange={(w) => commit(applyWeightChange(metrics, m.id, w))}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
