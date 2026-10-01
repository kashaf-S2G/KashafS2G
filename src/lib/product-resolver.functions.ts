import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * الواجهة الوحيدة المسموح بها لكتابة إعلان: كل إعلان يمر إجباريًا على فلتر
 * توحيد المنتجات قبل ربطه بمنتج، ثم يُحفظ باسم المنتج الموحّد ومعرّفه.
 */

export type AdWriteInput = {
  id?: string | null;
  competitor_id: string;
  product_name: string;
  product_description?: string | null;
  creation_date: string;
  end_date?: string | null;
  status: "active" | "inactive";
  image_url?: string | null;
};

export type ReprocessProgress = {
  processed: number;
  linked: number;
  createdProducts: number;
  remaining: number;
  done: boolean;
  cursor: string | null;
};

type StorageHost = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number,
      ) => Promise<{ data: { signedUrl: string } | null }>;
    };
  };
};

/** رابط مؤقت لصورة مخزّنة كي يستطيع فلتر التوحيد استخدامها عند الغموض. */
async function signedUrl(
  supabase: StorageHost,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return path;
  try {
    const { data } = await supabase.storage.from("ad-images").createSignedUrl(path, 600);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/** إضافة أو تعديل إعلان مع توحيد المنتج إلزاميًا. */
export const saveAdWithProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AdWriteInput) => {
    if (!input.competitor_id) throw new Error("اختر المنافس أولًا.");
    if (!input.product_name?.trim()) throw new Error("اسم المنتج مطلوب.");
    return input;
  })
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { resolveProduct } = await import("@/lib/product-resolver.server");

    const image = await signedUrl(supabase, data.image_url);
    const resolved = await resolveProduct(supabase, userId, {
      rawName: data.product_name,
      description: data.product_description ?? null,
      adText: data.product_description ?? null,
      imageUrl: image,
    });

    const values = {
      competitor_id: data.competitor_id,
      product_name: resolved.canonicalName,
      product_description: data.product_description ?? null,
      creation_date: data.creation_date,
      end_date: data.status === "inactive" ? (data.end_date ?? null) : null,
      status: data.status,
      image_url: data.image_url ?? null,
      product_id: resolved.productId,
    };

    if (data.id) {
      const { error } = await supabase.from("ads").update(values).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("ads").insert({ ...values, owner_id: userId });
      if (error) throw new Error(error.message);
    }
    return { productCode: resolved.code, productName: resolved.canonicalName, created: resolved.created };
  });

/** كم إعلانًا ما زال بلا منتج موحّد. */
export const unresolvedAdsCount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { count } = await context.supabase
      .from("ads")
      .select("id", { count: "exact", head: true })
      .is("product_id", null);
    const { count: products } = await context.supabase
      .from("products")
      .select("id", { count: "exact", head: true });
    return { remaining: count ?? 0, products: products ?? 0 };
  });

/**
 * إعادة معالجة الإعلانات الحالية دفعة دفعة عبر نفس فلتر التوحيد.
 * لا تُحذف أي بيانات: تُحدَّث فقط رابطة المنتج والاسم الموحّد.
 */
export const reprocessAdProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { batch?: number; force?: boolean; cursor?: string | null } | undefined) => ({
    batch: Math.min(Math.max(input?.batch ?? 10, 1), 25),
    force: input?.force === true,
    cursor: input?.cursor ?? null,
  }))
  .handler(async ({ context, data }): Promise<ReprocessProgress> => {
    const { supabase, userId } = context;
    const { resolveProduct } = await import("@/lib/product-resolver.server");

    let query = supabase
      .from("ads")
      .select("id, product_name, product_description, image_url, created_at, product_id")
      .order("created_at", { ascending: true })
      .limit(data.batch);
    if (data.force) {
      if (data.cursor) query = query.gt("created_at", data.cursor);
    } else {
      query = query.is("product_id", null);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Array<{
      id: string;
      product_name: string;
      product_description: string | null;
      image_url: string | null;
      created_at: string;
      product_id: string | null;
    }>;

    let linked = 0;
    let createdProducts = 0;
    let cursor = data.cursor;

    for (const ad of list) {
      cursor = ad.created_at;
      try {
        const image = await signedUrl(supabase, ad.image_url);
        const resolved = await resolveProduct(
          supabase,
          userId,
          {
            rawName: ad.product_name,
            description: ad.product_description,
            adText: ad.product_description,
            imageUrl: image,
          },
          // «إعادة توحيد الكل» تعيد فهم كل إعلان من جديد وتبني بطاقات الوصف المعيارية.
          { rebuild: data.force },
        );
        const { error: updateError } = await supabase
          .from("ads")
          .update({ product_id: resolved.productId, product_name: resolved.canonicalName })
          .eq("id", ad.id);
        if (updateError) continue;
        linked += 1;
        if (resolved.created) createdProducts += 1;
      } catch {
        // إعلان واحد متعذّر لا يوقف الدفعة
      }
    }

    let remaining = 0;
    if (data.force) {
      const { count } = await supabase
        .from("ads")
        .select("id", { count: "exact", head: true })
        .gt("created_at", cursor ?? "1970-01-01");
      remaining = count ?? 0;
    } else {
      const { count } = await supabase
        .from("ads")
        .select("id", { count: "exact", head: true })
        .is("product_id", null);
      remaining = count ?? 0;
    }

    return {
      processed: list.length,
      linked,
      createdProducts,
      remaining,
      done: list.length === 0 || remaining === 0,
      cursor,
    };
  });
