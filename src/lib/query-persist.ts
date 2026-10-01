/**
 * Persistent Client Cache مركزي فوق TanStack Query (متصفح فقط).
 *
 * - التخزين: IndexedDB (يدعم Structured Clone مثل Map، ولا يحجب الواجهة كـlocalStorage).
 * - العزل: حاوية مستقلة لكل مستخدم (المفتاح يتضمن user id)، والذاكرة تُمسح عند تبديل المستخدم.
 * - الصلاحية: 24 ساعة لكل Query حسب وقت تحميلها (dataUpdatedAt)، وليس نافذة مشتركة.
 * - الخادم هو المصدر الوحيد للحقيقة: النسخة المحلية تُعرض فورًا ثم تُستبدل بنتيجة الخادم.
 */
import type { Query, QueryClient } from "@tanstack/react-query";
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
  type PersistedClient,
  type Persister,
} from "@tanstack/react-query-persist-client";

export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BUSTER = "kashaf-cache-v1";
const DB_NAME = "kashaf-query-cache";
const STORE = "clients";

/** بادئات مفاتيح لا تُحفظ محليًا: حساسة، مؤقتة، عمليات جارية، أدمن، روابط صور مؤقتة. */
const EXCLUDED_PREFIXES = [
  "signed-image",
  "server-job",
  "secrets-status",
  "admin",
  "ai-activity",
  "wallet",
  "cd-state",
  "pb-review",
];

export function isPersistableQuery(query: Pick<Query, "queryKey" | "state">, now = Date.now()): boolean {
  if (query.state.status !== "success") return false;
  if (now - query.state.dataUpdatedAt > CACHE_MAX_AGE_MS) return false;
  const head = String(query.queryKey[0] ?? "");
  return !EXCLUDED_PREFIXES.some((p) => head === p || head.startsWith(`${p}-`) || head.startsWith(`${p}:`));
}

/** يحذف من النسخة المستعادة كل Query مضى على تحميلها أكثر من 24 ساعة. */
export function dropExpired(client: PersistedClient, now = Date.now()): PersistedClient {
  return {
    ...client,
    clientState: {
      ...client.clientState,
      queries: client.clientState.queries.filter((q) => now - q.state.dataUpdatedAt <= CACHE_MAX_AGE_MS),
    },
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = run(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

function createUserPersister(userId: string): Persister {
  const key = `user:${userId}`;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PersistedClient | null = null;
  return {
    persistClient(client) {
      pending = client;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const value = pending;
        pending = null;
        if (value) console.log("[DIAG] CACHE_UPDATE", value.clientState.queries.filter((q) => q.queryKey[0] === "products-table").map((q) => ({ key: JSON.stringify(q.queryKey.slice(4)), items: (q.state.data as { items?: unknown[] } | undefined)?.items?.length ?? 0 })));
        if (value) void idb("readwrite", (s) => s.put(dropExpired(value), key)).catch(() => undefined);
      }, 1000);
    },
    async restoreClient() {
      try {
        const saved = await idb<PersistedClient | undefined>("readonly", (s) => s.get(key));
        return saved ? dropExpired(saved) : undefined;
      } catch {
        return undefined;
      }
    },
    async removeClient() {
      await idb("readwrite", (s) => s.delete(key)).catch(() => undefined);
    },
  };
}

let activeUser: string | null = null;
let unsubscribe: (() => void) | null = null;
let restoring: Promise<void> | null = null;

/** يوقف الحفظ دون حذف النسخة المحفوظة (يُستدعى قبل مسح الذاكرة عند الخروج). */
export function detachPersistence() {
  unsubscribe?.();
  unsubscribe = null;
  activeUser = null;
  restoring = null;
}

/**
 * يستعيد كاش المستخدم نفسه فقط ثم يبدأ الحفظ. تبديل المستخدم يمسح الذاكرة أولًا،
 * فلا يمكن أن تظهر بيانات مستخدم آخر.
 */
export function attachPersistence(queryClient: QueryClient, userId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  if (activeUser === userId && restoring) return restoring;
  if (activeUser !== userId) {
    detachPersistence();
    queryClient.clear();
  }
  activeUser = userId;
  const persister = createUserPersister(userId);
  const opts = { queryClient, persister, buster: BUSTER };
  console.log("[DIAG] CACHE_RESTORE_START", new Date().toISOString());
  restoring = persistQueryClientRestore({ ...opts, maxAge: CACHE_MAX_AGE_MS })
    .catch(() => undefined)
    .then(() => {
      const listing = queryClient.getQueryCache().findAll({ queryKey: ["products-table", "listing"] });
      console.log("[DIAG] CACHE_RESTORE_SUCCESS (IndexedDB)", listing.map((q) => ({ key: JSON.stringify(q.queryKey.slice(4)), items: (q.state.data as { items?: unknown[] } | undefined)?.items?.length ?? 0 })));
      if (activeUser !== userId) return;
      unsubscribe = persistQueryClientSubscribe({
        ...opts,
        dehydrateOptions: { shouldDehydrateQuery: (q) => isPersistableQuery(q) },
      });
    });
  return restoring;
}
