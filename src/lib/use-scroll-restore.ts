/**
 * يحفظ موضع التمرير (السكرول) في ذاكرة المتصفح ويعيدك لنفس المكان عند العودة للصفحة،
 * حتى لو قفلت التطبيق خالص. لا يمس الروابط إطلاقًا.
 */
import { useEffect } from "react";

const PREFIX = "kashaf-scroll:";

export function useScrollRestore(key: string, ready: boolean) {
  const storageKey = PREFIX + key;

  // حفظ الموضع أثناء التمرير وعند مغادرة الصفحة.
  useEffect(() => {
    let raf = 0;
    const save = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          localStorage.setItem(storageKey, String(window.scrollY));
        } catch {
          /* ignore */
        }
      });
    };
    window.addEventListener("scroll", save, { passive: true });
    window.addEventListener("pagehide", save);
    return () => {
      save();
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", save);
      window.removeEventListener("pagehide", save);
    };
  }, [storageKey]);

  // استعادة الموضع بعد ما المحتوى يجهز ويرسم.
  useEffect(() => {
    if (!ready) return;
    let y = 0;
    try {
      y = Number(localStorage.getItem(storageKey) ?? "0") || 0;
    } catch {
      return;
    }
    if (y <= 0) return;
    // نحاول أكثر من مرة لأن ارتفاع الصفحة بيزيد مع تحميل البيانات والصور.
    let attempts = 0;
    const timer = setInterval(() => {
      window.scrollTo(0, y);
      attempts += 1;
      if (Math.abs(window.scrollY - y) < 4 || attempts >= 10) clearInterval(timer);
    }, 150);
    return () => clearInterval(timer);
  }, [storageKey, ready]);
}

/** مسح الموضع المحفوظ (مثلاً عند تغيير البحث أو الفلاتر جذريًا). */
export function clearSavedScroll(key: string) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
