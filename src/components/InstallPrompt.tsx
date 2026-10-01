import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onAppInstalled = () => {
      setInstalled(true);
      setVisible(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    // iOS لا يدعم beforeinstallprompt — نعرض إرشادات Safari مباشرة
    if (isIOS() && !isStandalone()) setVisible(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  if (!visible || installed || isStandalone()) return null;

  // الإغلاق مؤقت فقط — يعود الإشعار مع كل تحديث للصفحة
  const dismiss = () => setVisible(false);

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") setVisible(false);
    setDeferredPrompt(null);
  };

  return (
    <div className="fixed left-2 top-2 z-[60] flex items-center gap-1.5 rounded-full bg-primary py-1.5 pe-1.5 ps-3 shadow-md ring-1 ring-primary/30">
      <button
        type="button"
        onClick={install}
        className="flex items-center gap-1.5 text-xs font-bold text-primary-foreground"
      >
        {isIOS() ? (
          <Share className="size-4" />
        ) : (
          <Download className="size-4" />
        )}
        ثبت التطبيق
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="إغلاق"
        className="rounded-full bg-primary-foreground/15 p-1 text-primary-foreground transition-colors hover:bg-primary-foreground/30"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
