import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useRouteContext } from "@tanstack/react-router";

/**
 * نقطة التوقف (Last Position) — نظام مركزي واحد لكل صفحات القوائم.
 * يحفظ حالة الصفحة (رقم الصفحة، البحث، الفلاتر، الترتيب...) + موضع التمرير + عدد البطاقات المعروضة تدريجيًا،
 * في ذاكرة المتصفح الدائمة، بمفتاح معزول لكل مستخدم ولكل صفحة/نسخة صفحة.
 * لا يلمس الكاش ولا طريقة جلب البيانات، ولا يؤخر عرض الصفحة.
 */

const PREFIX = "kashaf-lp:v1:";
const TTL = 30 * 24 * 60 * 60 * 1000;

type Rec = { s: Record<string, unknown>; y?: number; n?: number; t: number };

const mem = new Map<string, Rec>();
const dirty = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function read(key: string): Rec {
  const hit = mem.get(key);
  if (hit) return hit;
  let rec: Rec = { s: {}, t: Date.now() };
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Rec;
      if (parsed && typeof parsed === "object" && Date.now() - (parsed.t ?? 0) < TTL) rec = { ...parsed, s: parsed.s ?? {} };
    }
  } catch {
    /* ignore */
  }
  mem.set(key, rec);
  return rec;
}

function flush() {
  timer = null;
  for (const key of dirty) {
    const rec = mem.get(key);
    try {
      if (rec) localStorage.setItem(key, JSON.stringify(rec));
    } catch {
      /* ignore */
    }
  }
  dirty.clear();
}

function write(key: string, patch: (r: Rec) => void) {
  const rec = read(key);
  patch(rec);
  rec.t = Date.now();
  dirty.add(key);
  if (!timer) timer = setTimeout(flush, 250);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

export type LastPosition = { key: string; snap: Rec };

/** مفتاح نقطة التوقف: المستخدم + الصفحة + أي معامل يميّز نسخة الصفحة. */
export function useLastPosition(pageId: string): LastPosition {
  const { user } = useRouteContext({ from: "/_authenticated" });
  const key = `${PREFIX}${user.id}:${pageId}`;
  // لقطة وقت فتح الصفحة؛ تُستخدم للاستعادة فقط.
  const snap = useMemo(() => {
    const r = read(key);
    return { ...r, s: { ...r.s } };
  }, [key]);
  return { key, snap };
}

/** مثل useState لكن قيمته جزء من نقطة التوقف. `override` (مثل قيمة من الرابط) يتقدّم على المحفوظ. */
export function useRemembered<T>(lp: LastPosition, field: string, initial: T, override?: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (override !== undefined) return override;
    return field in lp.snap.s ? (lp.snap.s[field] as T) : initial;
  });
  useEffect(() => {
    write(lp.key, (r) => {
      r.s[field] = value;
    });
  }, [lp.key, field, value]);
  return [value, setValue];
}

/**
 * يعيد الصفحة إلى 1 فقط عندما يتغيّر البحث/الفلتر/الترتيب فعلًا عن آخر ما حُفظ،
 * فلا تُصفَّر الصفحة المستعادة عند الفتح.
 */
export function useResetOnChange(lp: LastPosition, changeKey: string, reset: () => void) {
  const resetRef = useRef(reset);
  resetRef.current = reset;
  const last = useRef<string | undefined>(lp.snap.s["__ck"] as string | undefined);
  useEffect(() => {
    if (last.current !== undefined && last.current !== changeKey) resetRef.current();
    last.current = changeKey;
    write(lp.key, (r) => {
      r.s["__ck"] = changeKey;
    });
  }, [lp.key, changeKey]);
}

/** عدد البطاقات التي كانت معروضة تدريجيًا — لتُرسم الدفعة الكافية فقط للوصول لموضع التوقف. */
export function restoredCount(lp: LastPosition): number | undefined {
  return lp.snap.n;
}

/** بطاقات القائمة الحالية (أبناء الحاوية التي تحمل علامة data-lp-list). */
function listItems(): HTMLElement[] {
  const mark = document.querySelector<HTMLElement>("[data-lp-list]");
  const parent = mark?.parentElement;
  if (!parent) return [];
  return Array.from(parent.children).filter((c) => !(c as HTMLElement).hasAttribute("data-lp-list")) as HTMLElement[];
}

/** البطاقة الأولى الظاهرة أعلى الشاشة + بُعدها عن أعلى الشاشة. */
function currentAnchor(): { i: number; o: number } | null {
  const items = listItems();
  for (let i = 0; i < items.length; i++) {
    const r = items[i]!.getBoundingClientRect();
    if (r.bottom > 0) return { i, o: Math.round(r.top) };
  }
  return null;
}

/**
 * يحفظ موضع التمرير (بالبطاقة + بالبكسل) أثناء التصفح، ويستعيده بعد أن تُرسم البطاقات اللازمة.
 * `count` = عدد البطاقات المعروضة حاليًا من العرض التدريجي.
 */
export function useScrollMemory(lp: LastPosition, ready: boolean, count?: number) {
  const snapY = lp.snap.y ?? 0;
  const snapA = (lp.snap.s["__a"] as { i: number; o: number } | undefined) ?? null;
  const restored = useRef(!snapY && !snapA);
  const path = useRef(typeof window !== "undefined" ? window.location.pathname : "");

  useEffect(() => {
    if (count === undefined || !restored.current) return;
    write(lp.key, (r) => {
      r.n = count;
    });
  }, [lp.key, count]);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      // لا نحفظ أثناء الاستعادة، ولا بعد أن ينتقل الموجّه لصفحة أخرى.
      if (!restored.current || window.location.pathname !== path.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (window.location.pathname !== path.current) return;
        const a = currentAnchor();
        write(lp.key, (r) => {
          r.y = Math.round(window.scrollY);
          if (a) r.s["__a"] = a;
          else delete r.s["__a"];
        });
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, [lp.key]);

  useEffect(() => {
    if (restored.current || !ready) return;
    let frames = 0;
    let stable = 0;
    let raf = 0;
    const finish = () => {
      restored.current = true;
      cancelAnimationFrame(raf);
      detach();
    };
    const detach = () => {
      window.removeEventListener("wheel", finish);
      window.removeEventListener("touchstart", finish);
      window.removeEventListener("keydown", finish);
    };
    window.addEventListener("wheel", finish, { passive: true });
    window.addEventListener("touchstart", finish, { passive: true });
    window.addEventListener("keydown", finish);

    const targetY = (): number | null => {
      if (snapA) {
        const items = listItems();
        // ننتظر حتى تُرسم البطاقة المطلوبة من العرض التدريجي.
        if (items.length > snapA.i) return items[snapA.i]!.getBoundingClientRect().top + window.scrollY - snapA.o;
        return null;
      }
      const max = document.documentElement.scrollHeight - window.innerHeight;
      return max >= snapY ? snapY : null;
    };

    const tick = () => {
      frames++;
      const t = targetY();
      if (t !== null) {
        const top = Math.max(0, Math.round(t));
        if (Math.abs(window.scrollY - top) > 2) {
          window.scrollTo({ top, behavior: "instant" as ScrollBehavior });
          stable = 0;
        } else stable++;
        // نثبت الموضع عدة إطارات لأن ارتفاع البطاقات والصور قد يتغير بعد الرسم.
        if (stable >= 12) return finish();
      } else if (frames > 150) {
        window.scrollTo({ top: snapY, behavior: "instant" as ScrollBehavior });
        return finish();
      }
      if (frames > 240) return finish();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      detach();
    };
  }, [ready]);
}

/** الانتقال إلى صفحة جديدة (التالي/السابق) يبدأ دائمًا من الأعلى. */
export function scrollToTop() {
  if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
}
