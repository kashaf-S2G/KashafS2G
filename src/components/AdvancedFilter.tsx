import { Plus, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type FilterFieldType = "text" | "number";

export type FilterFieldDef = {
  id: string;
  label: string;
  type: FilterFieldType;
  /** القيم المتاحة — تُشتق تلقائيًا من البيانات الموجودة على المنصة. */
  options: string[];
};

export type FilterOperator =
  | "is"
  | "is_not"
  | "contains"
  | "empty"
  | "not_empty"
  | "gte"
  | "lte";

export type FilterRule = {
  id: string;
  field: string;
  op: FilterOperator;
  value: string;
};

const TEXT_OPS: { value: FilterOperator; label: string }[] = [
  { value: "is", label: "يساوي" },
  { value: "is_not", label: "لا يساوي" },
  { value: "contains", label: "يحتوي على" },
  { value: "empty", label: "فارغ" },
  { value: "not_empty", label: "غير فارغ" },
];

const NUMBER_OPS: { value: FilterOperator; label: string }[] = [
  { value: "is", label: "يساوي" },
  { value: "gte", label: "أكبر من أو يساوي" },
  { value: "lte", label: "أصغر من أو يساوي" },
];

export function opsFor(type: FilterFieldType) {
  return type === "number" ? NUMBER_OPS : TEXT_OPS;
}

export function needsValue(op: FilterOperator) {
  return op !== "empty" && op !== "not_empty";
}

export function opLabel(type: FilterFieldType, op: FilterOperator) {
  return opsFor(type).find((o) => o.value === op)?.label ?? op;
}

/** تطبيق قاعدة فلتر واحدة على مجموعة قيم عنصر. */
export function matchRule(values: string[], rule: FilterRule, type: FilterFieldType): boolean {
  const clean = values.map((v) => v.trim()).filter(Boolean);
  if (rule.op === "empty") return clean.length === 0;
  if (rule.op === "not_empty") return clean.length > 0;
  const target = rule.value.trim();
  if (!target) return true;

  if (type === "number") {
    const nums = clean.map(Number).filter((n) => !Number.isNaN(n));
    const t = Number(target);
    if (Number.isNaN(t)) return true;
    if (rule.op === "gte") return nums.some((n) => n >= t);
    if (rule.op === "lte") return nums.some((n) => n <= t);
    return nums.some((n) => n === t);
  }

  const lower = clean.map((v) => v.toLowerCase());
  const t = target.toLowerCase();
  if (rule.op === "is") return lower.includes(t);
  if (rule.op === "is_not") return !lower.includes(t);
  return lower.some((v) => v.includes(t));
}

export function newRule(fields: FilterFieldDef[]): FilterRule {
  const first = fields[0]!;
  return {
    id: crypto.randomUUID(),
    field: first.id,
    op: opsFor(first.type)[0]!.value,
    value: "",
  };
}

export function AdvancedFilter({
  fields,
  rules,
  onChange,
}: {
  fields: FilterFieldDef[];
  rules: FilterRule[];
  onChange: (rules: FilterRule[]) => void;
}) {
  const fieldById = (id: string) => fields.find((f) => f.id === id) ?? fields[0]!;

  const update = (id: string, patch: Partial<FilterRule>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const changeField = (id: string, fieldId: string) => {
    const def = fieldById(fieldId);
    update(id, { field: fieldId, op: opsFor(def.type)[0]!.value, value: "" });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="relative h-10 gap-2">
          <SlidersHorizontal className="size-4" />
          فلاتر
          {rules.length > 0 && (
            <Badge className="h-5 min-w-5 justify-center rounded-full px-1 text-[11px]">
              {rules.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,34rem)] space-y-2 p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">فلاتر متقدمة</p>
          {rules.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onChange([])}
            >
              مسح الكل
            </Button>
          )}
        </div>

        {rules.length === 0 && (
          <p className="text-xs text-muted-foreground">لا توجد فلاتر — أضف فلترًا للبدء.</p>
        )}

        <div className="space-y-2">
          {rules.map((rule) => {
            const def = fieldById(rule.field);
            return (
              <div
                key={rule.id}
                className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-1.5 rounded-lg border bg-muted/30 p-1.5"
              >
                <Select value={rule.field} onValueChange={(v) => changeField(rule.id, v)}>
                  <SelectTrigger className="h-8 min-w-0 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((f) => (
                      <SelectItem key={f.id} value={f.id} className="text-xs">
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={rule.op}
                  onValueChange={(v) =>
                    update(rule.id, {
                      op: v as FilterOperator,
                      ...(needsValue(v as FilterOperator) ? {} : { value: "" }),
                    })
                  }
                >
                  <SelectTrigger className="h-8 min-w-0 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {opsFor(def.type).map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {needsValue(rule.op) ? (
                  <Select
                    value={rule.value}
                    onValueChange={(v) => update(rule.id, { value: v })}
                    disabled={def.options.length === 0}
                  >
                    <SelectTrigger className="h-8 min-w-0 text-xs">
                      <SelectValue placeholder="القيمة" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {def.options.map((o) => (
                        <SelectItem key={o} value={o} className="text-xs">
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="truncate text-center text-[11px] text-muted-foreground">—</span>
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="إزالة هذا الفلتر"
                  className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => onChange(rules.filter((r) => r.id !== rule.id))}
                >
                  <X className="size-4" />
                </Button>
              </div>
            );
          })}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-8 w-full gap-1.5 text-xs"
          onClick={() => onChange([...rules, newRule(fields)])}
        >
          <Plus className="size-4" />
          إضافة فلتر جديد
        </Button>
      </PopoverContent>
    </Popover>
  );
}
