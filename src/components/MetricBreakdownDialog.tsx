import { useState } from "react";
import { ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { MetricResult } from "@/lib/metrics/types";

function statusBadge(r: MetricResult) {
  if (r.value === null)
    return (
      <Badge variant="secondary" className="text-[10px]">
        بيانات غير متوفرة
      </Badge>
    );
  return r.met ? (
    <Badge className="bg-primary/15 text-primary hover:bg-primary/15 text-[10px]">محقق</Badge>
  ) : (
    <Badge variant="destructive" className="text-[10px]">
      غير محقق
    </Badge>
  );
}

export function MetricBreakdownDialog({
  productName,
  results,
}: {
  productName: string;
  results: MetricResult[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
          <ListChecks className="size-4" />
          المقاييس المحققة
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto" dir="rtl">
        <DialogHeader className="text-right">
          <DialogTitle>مقاييس المنتج: {productName}</DialogTitle>
          <DialogDescription>
            لكل مقياس: القيمة الفعلية ← شرطك ← الدرجة، حتى تعرف سبب ترتيب المنتج.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد مقاييس مفعّلة.</p>
          ) : null}
          {results.map((r) => (
            <div key={r.metric.id} className="rounded-xl border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{r.metric.name}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {r.metric.description}
                  </p>
                </div>
                {statusBadge(r)}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                <div className="rounded-lg bg-muted px-2 py-1.5">
                  <p className="text-sm font-bold leading-none">{r.valueLabel}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">القيمة الفعلية</p>
                </div>
                <div className="rounded-lg bg-muted px-2 py-1.5">
                  <p className="text-sm font-bold leading-none">{r.conditionLabel}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">شرطك</p>
                </div>
                <div className="rounded-lg bg-muted px-2 py-1.5">
                  <p className="text-sm font-bold leading-none">{r.weight}%</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">الوزن</p>
                </div>
                <div className="rounded-lg bg-primary/10 px-2 py-1.5 text-primary">
                  <p className="text-sm font-bold leading-none">
                    {r.points === null ? "—" : `${r.points} من ${r.weight}`}
                  </p>
                  <p className="mt-1 text-[11px] opacity-80">النقاط</p>
                </div>
              </div>
              {r.value === null ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  البيانات غير متوفرة — لم يُحتسب هذا المقياس ضمن النتيجة (وهذا لا يعني أنه غير
                  محقق).
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
