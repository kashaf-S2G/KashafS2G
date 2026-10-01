import { ImageIcon, ImageOff, Megaphone } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useSignedImageUrl } from "@/lib/kashaf";
import type { ProductListItem as ProductSummary } from "@/lib/products-listing";

/**
 * صورة مشتركة للبطاقات: نسخة مصغّرة، تحميل كسول، وحالات منفصلة
 * (لا توجد صورة / جارٍ التحميل / فشل). الفشل لا يغيّر بيانات الإعلان ولا يُعاد في حلقة.
 */
export function ProductImage({
  path,
  alt,
  className = "",
  size = 288,
}: {
  path: string | null;
  alt: string;
  className?: string;
  size?: number;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setThumbFailed(false);
    setFailed(false);
    setLoaded(false);
  }, [path]);
  const thumb = useSignedImageUrl(path, { width: size, height: size });
  // محاولة واحدة فقط للأصل إذا فشلت النسخة المصغّرة، ثم fallback.
  const original = useSignedImageUrl(thumbFailed ? path : null);
  const img = thumbFailed ? original : thumb;
  const external = Boolean(path) && /^(https?:|data:)/i.test(path ?? "");
  const state = !path ? "none" : failed || img.status === "error" ? "error" : img.url ? "ready" : "loading";

  return (
    <div className={`relative overflow-hidden rounded-lg bg-muted ${className}`}>
      {state === "none" && (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
          <ImageIcon className="size-7" />
          <span className="text-[10px]">لا توجد صورة</span>
        </div>
      )}
      {state === "error" && (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
          <ImageOff className="size-7" />
          <span className="text-[10px]">تعذّر تحميل الصورة</span>
        </div>
      )}
      {(state === "loading" || (state === "ready" && !loaded)) && (
        <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden />
      )}
      {state === "ready" && img.url && (
        <img
          src={img.url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => {
            console.warn("image load failed:", path);
            setLoaded(false);
            if (!thumbFailed && !external) setThumbFailed(true);
            else setFailed(true);
          }}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  );
}


export function Stat({
  label,
  value,
  hint,
  tone = "muted",
  to,
  search,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: "muted" | "primary" | "destructive";
  /** وجهة اختيارية عند الضغط على الإحصائية. */
  to?: string;
  search?: Record<string, string> | undefined;
}) {
  const toneClass =
    tone === "primary"
      ? "bg-primary/10 text-primary"
      : tone === "destructive"
        ? "bg-destructive/10 text-destructive"
        : "bg-muted text-muted-foreground";
  const className = `flex min-h-0 min-w-0 flex-col justify-center overflow-hidden rounded-lg px-2 py-1 sm:px-3 sm:py-2 ${toneClass}`;
  const body = (
    <>
      <p className="truncate text-sm font-bold leading-none sm:text-lg">{value}</p>
      <p className="mt-0.5 truncate text-[11px] leading-tight opacity-80 sm:mt-1.5 sm:text-sm">{label}</p>
    </>
  );
  if (to) {
    return (
      <Link
        to={to}
        search={search ?? {}}
        className={`${className} cursor-pointer transition-colors hover:brightness-95`}
        title={hint}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {body}
      </Link>
    );
  }
  return (
    <div className={className} title={hint}>
      {body}
    </div>
  );
}

/** بطاقة المنتج الموحّدة المستخدمة في صفحة المنتجات وصفحة Top10. */
export function ProductCard({
  product,
  header,
  footer,
  selected,
  onToggleSelect,
}: {
  product: ProductSummary;
  /** إضافات خاصة بسياق العرض (مثل ترتيب Top10 والدرجة). */
  header?: ReactNode;
  footer?: ReactNode;
  /** حالة التحديد اليدوي (اختيارية؛ تصبح البطاقة كلها قابلة للتحديد عند تمرير onToggleSelect). */
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const stats = [
    { label: "منافسون نشطون", value: product.activeCompetitors, hint: "عدد المنافسين الذين يوجد بها إعلان نشط لهذا المنتج — اضغط لعرضهم", tone: "muted", to: "/competitors", search: { product: product.name } },
    { label: "إعلان نشط", value: product.activeAds, hint: "إجمالي الإعلانات النشطة حاليًا لهذا المنتج — اضغط لعرضها", tone: "primary", to: "/ads", search: { product: product.name, status: "active" } },
    { label: "يوم نشاط", value: product.activeDays, hint: "مجموع أيام نشاط كل إعلانات هذا المنتج", tone: "primary" },
    { label: "إعلان متوقف", value: product.stoppedAds, hint: "إجمالي الإعلانات التي توقفت بعد إضافة المنتج — اضغط لعرضها", tone: "muted", to: "/ads", search: { product: product.name, status: "stopped" } },
  ] as const;
  const actions = footer ?? (
    <Button asChild size="sm" variant="ghost" className="h-6 gap-1 text-[11px] sm:h-7 sm:gap-1.5 sm:text-xs">
      <Link to="/ads">
        <Megaphone className="size-3.5 sm:size-4" />
        الإعلانات
      </Link>
    </Button>
  );

  return (
    <Card
      className={`cv-auto flex min-w-0 w-full flex-col gap-1 overflow-hidden p-2 sm:p-4 transition-shadow ${header ? "h-auto min-h-64" : "h-[max(13rem,calc((100dvh-5rem)/3))] sm:h-64"} ${onToggleSelect ? "cursor-pointer" : ""} ${selected ? "ring-2 ring-primary bg-primary/5" : ""}`}
      onClick={onToggleSelect ? () => onToggleSelect() : undefined}
      onKeyDown={onToggleSelect ? (event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggleSelect();
        }
      } : undefined}
      role={onToggleSelect ? "checkbox" : undefined}
      aria-checked={onToggleSelect ? !!selected : undefined}
      aria-label={onToggleSelect ? `تحديد ${product.name}` : undefined}
      tabIndex={onToggleSelect ? 0 : undefined}
    >
      {header ? <div className="min-w-0 shrink-0">{header}</div> : null}
      <div className={`flex min-h-0 flex-1 items-stretch gap-2 overflow-hidden sm:gap-4 ${header ? "min-h-36" : ""}`}>
        <div className="flex min-h-0 w-28 shrink-0 flex-col items-start gap-1 overflow-hidden sm:w-36">
          <ProductImage path={product.image} alt={product.name} className="h-28 w-28 shrink-0 sm:h-36 sm:w-36" />
          <div className="w-full">
            {onToggleSelect ? (
              <div className="flex w-full items-start gap-1.5 pb-0.5">
                <Checkbox
                  className="mt-0.5 shrink-0"
                  checked={!!selected}
                  onCheckedChange={onToggleSelect}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={selected ? `إلغاء تحديد ${product.name}` : `تحديد ${product.name}`}
                />
                <span className="min-w-0 break-words text-xs font-medium leading-5 [overflow-wrap:anywhere]" title={product.name}>
                  {product.name}
                </span>
              </div>
            ) : (
              <span className="block w-full text-xs font-medium leading-5 [overflow-wrap:anywhere]" title={product.name}>
                {product.name}
              </span>
            )}
            <span className="block w-full font-mono text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]" title={product.code}>
              {product.code}
            </span>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
          <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-1 sm:gap-2">
            {stats.map((stat) => <Stat key={stat.label} {...stat} />)}
          </div>
          {product.description ? (
            <p className="line-clamp-3 h-[3.125rem] shrink-0 overflow-hidden break-words text-xs leading-snug text-foreground/85 [overflow-wrap:anywhere]" title={product.description}>
              {product.description}
            </p>
          ) : null}
        </div>
      </div>
      <div
        className={`mt-1 flex min-w-0 shrink-0 items-center justify-end gap-1 sm:gap-2 ${header ? "flex-wrap" : "h-8 overflow-x-auto whitespace-nowrap"}`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {actions}
      </div>
    </Card>
  );
}
