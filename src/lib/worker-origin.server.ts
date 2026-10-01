import { getRequest } from "@tanstack/react-start/server";
import { BUILD_INFO } from "@/lib/build-info";

/** عنوان الموقع الذي يستدعيه الخادم لإيقاظ العامل (خادم فقط). */
export function workerOrigin(): string | null {
  try {
    const host = new URL(getRequest().url).host;
    if (host.includes("preview") || host.endsWith("-dev.lovable.app") || host.endsWith(".lovableproject.com")) {
      const id = BUILD_INFO.lovableProjectId;
      return id ? `https://project--${id}-dev.lovable.app` : null;
    }
    if (host.startsWith("localhost")) return null;
    return `https://${host}`;
  } catch {
    return null;
  }
}

/** أصل الطلب الحالي كعنوان https آمن، أو null. */
export function requestOrigin(): string | null {
  try {
    const origin = new URL(getRequest().url).origin;
    return /^https:\/\/[a-z0-9.-]+$/.test(origin) ? origin : null;
  } catch {
    return null;
  }
}
