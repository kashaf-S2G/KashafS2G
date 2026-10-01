/**
 * The app no longer uses an offline service worker. On every load, remove any
 * previously installed /sw.js registration and its caches so no stale copy is served.
 * Home-screen install still works via public/manifest.webmanifest.
 */
export async function registerAppServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((reg) =>
          [reg.active, reg.waiting, reg.installing].some((w) => w?.scriptURL.endsWith("/sw.js")),
        )
        .map((reg) => reg.unregister()),
    );
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.allSettled(
        names
          .filter((n) => n.startsWith("kashaf-") || /(^|-)(precache-v\d+|runtime)-/.test(n))
          .map((n) => caches.delete(n)),
      );
    }
  } catch {
    // ignore — cleanup is best effort
  }
}
