import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { claimLegacyRecords } from "@/lib/legacy-claim.functions";
import { saveAdWithProduct } from "@/lib/product-resolver.functions";

export type Platform = "Facebook" | "Instagram" | "TikTok" | "Snapchat" | "YouTube" | "أخرى";

export const PLATFORMS: Platform[] = [
  "Facebook",
  "Instagram",
  "TikTok",
  "Snapchat",
  "YouTube",
  "أخرى",
];

export type CompetitorRow = {
  id: string;
  competitor_name: string;
  competitor_url: string;
  platform: string;
  niche: string;
  created_at: string;
  last_crawled_at: string | null;
};

export type AdRow = {
  id: string;
  competitor_id: string;
  product_name: string;
  /** المنتج الموحّد الذي حسمه فلتر التوحيد المركزي. */
  product_id?: string | null;
  canonical_product_name?: string | null;
  product_code?: string | null;
  product_description: string | null;
  creation_date: string;
  end_date: string | null;
  status: "active" | "inactive";
  image_url: string | null;
  source_url: string | null;
  created_at: string;
};

/** صف الإعلان كما يصله التطبيق: المدة محسوبة داخل قاعدة البيانات بتوقيت UTC. */
export type AdWithDuration = AdRow & {
  duration_days: number;
  active_days: number;
  inactive_days: number;
  computed_on_utc: string;
};

export type AdWithCompetitor = AdWithDuration & { competitor: CompetitorRow | null };

/**
 * دالة نقية لحساب المدة بالأيام اعتمادًا على "اليوم" الممرَّر (YYYY-MM-DD).
 * مصدر الحقيقة هو العرض `ads_with_duration` في قاعدة البيانات (UTC)؛
 * هذه الدالة نسخة مطابقة تُستخدم للاختبارات وكحل احتياطي فقط.
 */
export function adDurationDays(
  ad: Pick<AdRow, "creation_date" | "end_date" | "status">,
  todayUtcIso: string,
): number {
  const day = 86_400_000;
  const start = Date.parse(`${ad.creation_date}T00:00:00Z`);
  const endIso = ad.status === "active" ? todayUtcIso : (ad.end_date ?? todayUtcIso);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  const days = Math.round((end - start) / day);
  return days < 0 ? 0 : days;
}

/**
 * حساب أيام التوقف للإعلان: 0 للإعلان النشط، وعدد الأيام من تاريخ الانتهاء حتى
 * تاريخ اليوم الممرَّر للإعلان غير النشط.
 */
export function adInactiveDays(
  ad: Pick<AdRow, "end_date" | "status">,
  todayUtcIso: string,
): number {
  if (ad.status === "active") return 0;
  const day = 86_400_000;
  const endIso = ad.end_date ?? todayUtcIso;
  const end = Date.parse(`${endIso}T00:00:00Z`);
  const today = Date.parse(`${todayUtcIso}T00:00:00Z`);
  const days = Math.round((today - end) / day);
  return days < 0 ? 0 : days;
}

/** تاريخ اليوم بتوقيت UTC بصيغة YYYY-MM-DD. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("ar-EG-u-nu-latn", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const AD_IMAGES_BUCKET = "ad-images";

/** رفع صورة المنتج إلى Storage وإرجاع المسار (path) الخاص بها. */
export async function uploadAdImage(file: File): Promise<string> {
  const ownerId = await requireUserId();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const path = `${ownerId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(AD_IMAGES_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

/** الحصول على رابط مؤقت (signed URL) لمسار صورة داخل الـ Storage الخاص. */
export async function signedImageUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return path;
  const { data, error } = await supabase.storage
    .from(AD_IMAGES_BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) {
    console.error("signedImageUrl error:", error.message);
    return null;
  }
  return data.signedUrl;
}

/** حذف صورة المنتج من Storage. */
export async function deleteAdImage(path: string) {
  await requireUserId();
  const { error } = await supabase.storage.from(AD_IMAGES_BUCKET).remove([path]);
  if (error) throw error;
}

const SIGNED_TTL_S = 60 * 60 * 24 * 7;

export type SignedImage = { url: string | null; status: "none" | "loading" | "ready" | "error" };

/**
 * رابط مؤقت لصورة داخل الـ Storage، مخزّن في كاش TanStack Query حتى لا يُولَّد في كل Render.
 * الكاش أقصر من صلاحية الرابط بساعة، فيُجدَّد الرابط قبل انتهائه فقط.
 * عند تمرير width/height يُطلب نسخة مصغّرة (Image Transformation) مع بقاء الأصل كما هو.
 */
export function useSignedImageUrl(
  path: string | null | undefined,
  size?: { width: number; height: number },
): SignedImage {
  const external = Boolean(path) && (/^https?:\/\//i.test(path!) || path!.startsWith("data:"));
  const q = useQuery({
    queryKey: ["signed-image", path ?? null, size?.width ?? 0, size?.height ?? 0],
    enabled: Boolean(path) && !external,
    staleTime: (SIGNED_TTL_S - 3600) * 1000,
    gcTime: (SIGNED_TTL_S - 3600) * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(AD_IMAGES_BUCKET)
        .createSignedUrl(
          path!,
          SIGNED_TTL_S,
          size ? { transform: { width: size.width, height: size.height, resize: "cover", quality: 70 } } : undefined,
        );
      if (error) throw error;
      return data.signedUrl;
    },
  });
  if (!path) return { url: null, status: "none" };
  if (external) return { url: path, status: "ready" };
  if (q.data) return { url: q.data, status: "ready" };
  if (q.isError) return { url: null, status: "error" };
  return { url: null, status: "loading" };
}

/** يجلب كل الصفوف على دفعات من 1000 (حد الخادم الافتراضي) حتى لا تُقطع البيانات. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: any; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

/** مدة كاش بيانات الإعلانات والمنافسين عند التنقل بين الصفحات. */
const DATA_STALE_MS = 60_000;

function fetchCompetitors() {
  return fetchAll<CompetitorRow>((a, b) =>
    supabase.from("competitors").select("*").order("created_at", { ascending: false }).order("id").range(a, b),
  );
}

export function useCompetitors(enabled = true) {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ["competitors", userId],
    enabled: Boolean(userId) && enabled,
    staleTime: DATA_STALE_MS,
    queryFn: fetchCompetitors,
  });
}

export function useAds() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["ads", userId],
    enabled: Boolean(userId),
    staleTime: DATA_STALE_MS,
    queryFn: async (): Promise<AdWithCompetitor[]> => {
      const [adsData, competitorsData] = await Promise.all([
        fetchAll<AdWithDuration>((a, b) =>
          supabase.from("ads_with_duration").select("*").order("created_at", { ascending: false }).order("id").range(a, b),
        ),
        // نفس كاش useCompetitors: لا طلب مكرر للمنافسين.
        qc.fetchQuery({ queryKey: ["competitors", userId], queryFn: fetchCompetitors, staleTime: DATA_STALE_MS }),
      ]);
      const adsRes = { data: adsData };
      const competitorsRes = { data: competitorsData };

      const competitors = new Map((competitorsRes.data ?? []).map((p) => [p.id, p as CompetitorRow]));
      return ((adsRes.data ?? []) as unknown as AdWithDuration[]).map((ad) => ({
        ...ad,
        competitor: competitors.get(ad.competitor_id) ?? null,
      }));
    },
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["competitors"] });
    qc.invalidateQueries({ queryKey: ["ads"] });
    qc.invalidateQueries({ queryKey: ["product-code-overrides"] });
    // قائمة المنتجات المحسوبة على الخادم تعتمد على الإعلانات والمنافسين والأكواد.
    qc.invalidateQueries({ queryKey: ["products-table", "listing"] });
  };
}

/** خريطة المعرفات اليدوية للمنتجات: مفتاح المنتج ← المعرف المخصص. */
export function useProductCodeOverrides() {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ["product-code-overrides", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase
        .from("product_code_overrides")
        .select("product_key, code");
      if (error) throw error;
      return new Map(
        (data ?? []).map((r) => [r.product_key as string, r.code as string]),
      );
    },
  });
}

/** حفظ معرف يدوي لمنتج (أو حذفه عند تمرير null/فارغ فيعود المعرف التلقائي). */
export function useSaveProductCodeOverride() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ key, code }: { key: string; code: string | null }) => {
      const ownerId = await requireUserId();
      const trimmed = code?.trim() ?? "";
      if (trimmed) {
        const { error } = await supabase
          .from("product_code_overrides")
          .upsert(
            { owner_id: ownerId, product_key: key, code: trimmed },
            { onConflict: "owner_id,product_key" },
          );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("product_code_overrides")
          .delete()
          .eq("product_key", key);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });
}

export type CompetitorInput = Omit<CompetitorRow, "id" | "created_at" | "last_crawled_at">;
export type AdInput = Pick<
  AdRow,
  | "competitor_id"
  | "product_name"
  | "product_description"
  | "creation_date"
  | "end_date"
  | "status"
  | "image_url"
>;

async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new Error("يجب تسجيل الدخول أولًا لحفظ البيانات.");
  return userId;
}

export function useSaveCompetitor() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string | undefined; values: CompetitorInput }) => {
      const ownerId = await requireUserId();
      if (id) {
        const { error } = await supabase.from("competitors").update(values).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("competitors").insert({ ...values, owner_id: ownerId });
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });
}

export function useDeleteCompetitor() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      await requireUserId();
      const { error } = await supabase.from("competitors").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/**
 * حفظ الإعلان يمر دائمًا عبر دالة الخادم التي تشغّل فلتر توحيد المنتجات؛
 * الكتابة المباشرة على جدول الإعلانات مرفوضة من قاعدة البيانات.
 */
export function useSaveAd() {
  const invalidate = useInvalidate();
  const save = useServerFn(saveAdWithProduct);
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string | undefined; values: AdInput }) => {
      await requireUserId();
      return await save({
        data: {
          ...(id ? { id } : {}),
          competitor_id: values.competitor_id,
          product_name: values.product_name,
          product_description: values.product_description ?? null,
          creation_date: values.creation_date,
          end_date: values.end_date ?? null,
          status: values.status,
          image_url: values.image_url ?? null,
        },
      });
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useDeleteAd() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      await requireUserId();
      const { error } = await supabase.from("ads").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** الحالة الجديدة وتاريخ الانتهاء عند تبديل حالة الإعلان (UTC). */
export function nextAdStatus(ad: Pick<AdRow, "status" | "end_date">, todayUtcIso: string) {
  const next = ad.status === "active" ? "inactive" : "active";
  return {
    status: next as "active" | "inactive",
    end_date: next === "inactive" ? (ad.end_date ?? todayUtcIso) : null,
  };
}

export function useToggleAdStatus() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (ad: AdRow) => {
      await requireUserId();
      const { error } = await supabase
        .from("ads")
        .update(nextAdStatus(ad, todayUtc()))
        .eq("id", ad.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** تبنّي السجلات القديمة التي لا مالك لها وإسنادها للمستخدم الحالي. */
export function useClaimLegacyRecords() {
  const invalidate = useInvalidate();
  const claim = useServerFn(claimLegacyRecords);
  return useMutation({
    mutationFn: async () => {
      await requireUserId();
      return await claim({ data: undefined });
    },
    onSuccess: invalidate,
  });
}

export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("duplicate key") || message.includes("competitors_competitor_url_key")) {
    return "هذا الرابط مُضاف بالفعل، لا يمكن إضافة نفس المنافس مرتين.";
  }
  if (message.includes("row-level security") || message.includes("permission denied")) {
    return "لا تملك صلاحية على هذا السجل. تأكد من تسجيل الدخول بالحساب الصحيح.";
  }
  return message || "حدث خطأ غير متوقع";
}

export type StandaloneProductRow = {
  id: string;
  canonical_name: string;
  code: string;
  image_url: string | null;
  profile: unknown;
};

/** كل المنتجات الموحّدة للمستخدم (بما فيها المنتجات المضافة يدويًا بلا إعلانات). */
export function useProductsTable() {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ["products-table", userId],
    enabled: Boolean(userId),
    queryFn: () =>
      fetchAll<StandaloneProductRow>((a, b) =>
        supabase
          .from("products")
          .select("id, canonical_name, code, image_url, profile")
          .order("created_at", { ascending: false })
          .order("id")
          .range(a, b),
      ),
  });
}

/** إنشاء منتج مستقل غير مرتبط بأي منافس أو إعلان (لإطلاق زحف عليه). */
export function useCreateStandaloneProduct() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: { name: string; description: string; image?: File | null }) => {
      if (!userId) throw new Error("يجب تسجيل الدخول");
      const { productCode, productKey } = await import("@/lib/product");
      const name = values.name.trim();
      if (!name) throw new Error("اكتب اسم المنتج");
      const imagePath = values.image ? await uploadAdImage(values.image) : null;
      const { data, error } = await supabase
        .from("products")
        .insert({
          owner_id: userId,
          canonical_name: name,
          canonical_key: productKey(name),
          code: productCode(name),
          image_url: imagePath,
          profile: values.description.trim() ? { description: values.description.trim() } : {},
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") throw new Error("يوجد منتج بنفس الاسم أو المعرف بالفعل.");
        throw error;
      }
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products-table"] }),
  });
}

/** تعديل بيانات منتج موجود (الاسم والوصف والصورة). */
export function useUpdateProduct() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      id: string;
      name: string;
      description: string;
      image?: File | null;
      currentKey: string;
    }) => {
      if (!userId) throw new Error("يجب تسجيل الدخول");
      const { productKey } = await import("@/lib/product");
      const name = values.name.trim();
      if (!name) throw new Error("اكتب اسم المنتج");
      const imageUrl = values.image ? await uploadAdImage(values.image) : null;
      const patch = {
        canonical_name: name,
        canonical_key: productKey(name),
        profile: values.description.trim() ? { description: values.description.trim() } : {},
        ...(imageUrl ? { image_url: imageUrl } : {}),
      };
      const { error } = await supabase.from("products").update(patch).eq("id", values.id);
      if (error) {
        if (error.code === "23505") throw new Error("يوجد منتج بنفس الاسم أو المعرف بالفعل.");
        throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products-table"] });
      qc.invalidateQueries({ queryKey: ["ads"] });
    },
  });
}

/** حذف منتج مع بياناته الملحقة؛ يُرفض إذا كانت له إعلانات مرتبطة. */
export function useDeleteProduct() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: { id: string; key: string }) => {
      if (!userId) throw new Error("يجب تسجيل الدخول");
      const { count, error: countErr } = await supabase
        .from("ads")
        .select("id", { count: "exact", head: true })
        .eq("product_id", values.id);
      if (countErr) throw countErr;
      if ((count ?? 0) > 0) {
        throw new Error("لا يمكن حذف منتج مرتبط بإعلانات. احذف إعلاناته أولًا.");
      }
      // بيانات ملحقة بالمنتج تُحذف قبله لتفادي قيود الربط.
      await supabase.from("product_aliases").delete().eq("product_id", values.id);
      await supabase.from("pcrawl_profiles").delete().eq("product_id", values.id);
      await supabase.from("pcrawl_targets").delete().eq("product_id", values.id);
      await supabase.from("pcrawl_matches").delete().eq("product_id", values.id);
      await supabase.from("product_code_overrides").delete().eq("product_key", values.key);
      const { error } = await supabase.from("products").delete().eq("id", values.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products-table"] });
      qc.invalidateQueries({ queryKey: ["ads"] });
    },
  });
}
