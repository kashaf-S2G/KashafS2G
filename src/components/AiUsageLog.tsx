import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAiUsageLog } from "@/lib/ai-account.functions";

const numberFormat = new Intl.NumberFormat("ar-EG-u-nu-latn");
const money = new Intl.NumberFormat("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  dateStyle: "short",
  timeStyle: "short",
});

/** أسماء العمليات الحقيقية المسجّلة في النظام. */
const OPERATION_LABELS: Record<string, string> = {
  ad_extract: "استخراج بيانات الإعلان",
  ad_classify: "تحليل الإعلانات",
  product_match: "مطابقة المنتجات",
  product_research: "ملف بحث المنتج",
  keywords_build: "توليد كلمات البحث",
  term_bank_build: "بناء بنك المصطلحات",
  term_bank_match: "مطابقة المصطلحات",
  discovery_categories: "تصنيفات الاكتشاف",
  other: "عملية أخرى",
};

const PERIOD_LABELS: Record<string, string> = {
  today: "اليوم",
  "7d": "آخر ٧ أيام",
  "30d": "آخر ٣٠ يومًا",
  all: "كل الفترات",
};

type Period = "today" | "7d" | "30d" | "all";


export function AiUsageLog() {
  const fetchLog = useServerFn(getAiUsageLog);
  const [period, setPeriod] = useState<Period>("30d");
  const [operation, setOperation] = useState<string>("all");

  const logQuery = useQuery({
    queryKey: ["ai-usage-log", period, operation],
    queryFn: () =>
      fetchLog({
        data: {
          period,
          operation: operation === "all" ? null : operation,
        },
      }),
    // يتحدّث تلقائيًا بعد تنفيذ عمليات الذكاء الاصطناعي دون إعادة تحميل الصفحة.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const log = logQuery.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">سجل استخدام AI</CardTitle>
        <CardDescription>عمليات الذكاء الاصطناعي المنفذة على حسابك واستهلاك Tokens.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">تكلفة اليوم</p>
            <p className="mt-1 text-2xl font-bold">
              {log ? `${money.format(log.todayEgp)} جنيه` : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">تكلفة الشهر</p>
            <p className="mt-1 text-2xl font-bold">
              {log ? `${money.format(log.monthEgp)} جنيه` : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">Tokens هذا الشهر</p>
            <p className="mt-1 text-2xl font-bold" dir="ltr">
              {log ? numberFormat.format(log.monthTokens) : "—"}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">الفترة الزمنية</p>
            <Select value={period} onValueChange={(value) => setPeriod(value as Period)}>
              <SelectTrigger aria-label="الفترة الزمنية">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PERIOD_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">نوع العملية</p>
            <Select value={operation} onValueChange={setOperation}>
              <SelectTrigger aria-label="نوع العملية">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل العمليات</SelectItem>
                {Object.entries(OPERATION_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {logQuery.isPending ? (
          <div className="space-y-2" aria-label="جارٍ تحميل سجل الاستخدام">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-12 animate-pulse rounded-md bg-muted/60" />
            ))}
          </div>
        ) : logQuery.isError || !log ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            تعذر تحميل سجل استخدام الذكاء الاصطناعي. حاول مرة أخرى لاحقًا.
          </p>
        ) : log.events.length === 0 ? (
          <p className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
            لا توجد عمليات AI حتى الآن.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">التاريخ والوقت</TableHead>
                  <TableHead className="text-right">نوع العملية</TableHead>
                  
                  <TableHead className="text-right">Input</TableHead>
                  <TableHead className="text-right">Output</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-right">التكلفة</TableHead>
                  <TableHead className="text-right">الرصيد بعدها</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="whitespace-nowrap">
                      {dateFormat.format(new Date(event.createdAt))}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {OPERATION_LABELS[event.operation] ?? event.operation}
                    </TableCell>
                    
                    <TableCell dir="ltr">{numberFormat.format(event.inputTokens)}</TableCell>
                    <TableCell dir="ltr">{numberFormat.format(event.outputTokens)}</TableCell>
                    <TableCell dir="ltr">{numberFormat.format(event.totalTokens)}</TableCell>
                    <TableCell>
                      <Badge variant={event.status === "success" ? "default" : "destructive"}>
                        {event.status === "success" ? "ناجحة" : "فاشلة"}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {`${money.format(event.chargedEgp)} جنيه`}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {event.balanceAfterEgp !== null
                        ? `${money.format(event.balanceAfterEgp)} جنيه`
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
