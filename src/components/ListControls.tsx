import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { scrollToTop } from "@/lib/last-position";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const ALL = "all";

/** ترقيم صفحات بسيط لأي قائمة، مع التحكم في عدد العناصر المعروضة. */
export function usePagedList<T>(items: T[], defaultPageSize = 20, persistKey?: string) {
  const storageKey = persistKey ? `kashaf-page:${persistKey}` : null;
  const [pageSize, setPageSize] = useState<number | "all">(defaultPageSize);
  const [page, setPage] = useState(() => {
    if (!storageKey) return 1;
    try {
      return Math.max(1, Number(localStorage.getItem(storageKey) ?? "1") || 1);
    } catch {
      return 1;
    }
  });

  const total = items.length;
  const pageCount = pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / pageSize));

  // أول تحميل للبيانات لا يصفّر الصفحة المستعادة من الذاكرة.
  const skipFirstReset = useRef(!!storageKey);
  useEffect(() => {
    if (skipFirstReset.current) {
      skipFirstReset.current = false;
      return;
    }
    setPage(1);
  }, [total, pageSize]);

  // تذكّر رقم الصفحة في ذاكرة المتصفح حتى يعود المستخدم لنفس مكانه.
  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, String(page));
    } catch {
      /* ignore */
    }
  }, [storageKey, page]);

  const visible = useMemo(() => {
    if (pageSize === "all") return items;
    const start = (Math.min(page, pageCount) - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageCount, pageSize]);

  return {
    visible,
    total,
    page: Math.min(page, pageCount),
    pageCount,
    pageSize,
    setPage,
    setPageSize,
  };
}

export type PagedList<T> = ReturnType<typeof usePagedList<T>>;

/** شريط أعلى القائمة: العدد الكلي + اختيار عدد العناصر في الصفحة. */
export function ListCountBar<T>({
  paged,
  noun,
  className = "",
}: {
  paged: PagedList<T>;
  /** اسم العنصر بالعربية، مثل: "منتج" أو "صفحة" أو "إعلان". */
  noun: string;
  className?: string;
}) {
  return (
    <div className={`mb-4 flex flex-wrap items-center justify-between gap-2 ${className}`}>
      <p className="text-sm font-semibold text-foreground">
        الإجمالي: <span className="text-primary">{paged.total}</span> {noun}
        {paged.pageCount > 1 ? (
          <span className="ms-2 text-xs font-normal text-muted-foreground">
            (المعروض {paged.visible.length} — صفحة {paged.page} من {paged.pageCount})
          </span>
        ) : null}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">عرض</span>
        <Select
          value={paged.pageSize === "all" ? ALL : String(paged.pageSize)}
          onValueChange={(v) => paged.setPageSize(v === ALL ? "all" : Number(v))}
        >
          <SelectTrigger className="h-9 w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
            <SelectItem value={ALL}>الكل</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/** أزرار التنقل بين الصفحات أسفل القائمة. */
export function ListPager<T>({ paged }: { paged: PagedList<T> }) {
  if (paged.pageCount <= 1) return null;
  return (
    <div className="mt-6 flex items-center justify-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={paged.page <= 1}
        onClick={() => {
          paged.setPage(paged.page - 1);
          scrollToTop();
        }}
      >
        السابق
      </Button>
      <span className="text-sm text-muted-foreground">
        {paged.page} / {paged.pageCount}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={paged.page >= paged.pageCount}
        onClick={() => {
          paged.setPage(paged.page + 1);
          scrollToTop();
        }}
      >
        التالي
      </Button>
    </div>
  );
}
