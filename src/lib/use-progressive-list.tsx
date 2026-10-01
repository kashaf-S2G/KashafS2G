import { useEffect, useRef, useState } from "react";

/**
 * عرض تدريجي للقوائم الكبيرة: كل البيانات تبقى كما هي في الذاكرة والكاش،
 * لكن الشاشة ترسم دفعة أولى فقط ثم تضيف الدفعات التالية تلقائيًا عند اقتراب التمرير من النهاية.
 * القوائم الأصغر من الدفعة الأولى تُعرض كاملة كما كانت.
 */
export function useProgressiveList<T>(items: T[], resetKey: unknown, step = 30, initialCount?: number) {
  // عند العودة لنقطة التوقف نرسم فقط الدفعات التي كانت معروضة (لا القائمة كلها).
  const [count, setCount] = useState(() => Math.max(step, initialCount ?? step));
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // نعيد للدفعة الأولى فقط عند تغيّر المفتاح فعلًا (لا عند إعادة تشغيل التأثير).
  const lastKey = useRef(resetKey);
  useEffect(() => {
    if (Object.is(lastKey.current, resetKey)) return;
    lastKey.current = resetKey;
    setCount(step);
  }, [resetKey, step]);

  const hasMore = count < items.length;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setCount((c) => c + step);
      },
      { rootMargin: "1200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, step, count]);

  const shown = hasMore ? items.slice(0, count) : items;
  // العلامة تبقى دائمًا لتحدد حاوية القائمة لنظام نقطة التوقف.
  const sentinel = <div ref={sentinelRef} data-lp-list="" aria-hidden className={hasMore ? "col-span-full h-px" : "hidden"} />;
  return { shown, sentinel };
}
