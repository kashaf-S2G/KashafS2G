import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { matchRule } from "@/components/AdvancedFilter";
import type { AdWithCompetitor, CompetitorRow } from "@/lib/kashaf";
import { summarize, withStandaloneProducts } from "@/lib/product-summary";
import {
  PRODUCT_FIELD_LABELS,
  PRODUCT_FIELD_VALUES,
  aiTerm,
  type ProductListItem,
} from "@/lib/products-listing";

/**
 * صفحة المنتجات من الخادم: نفس الاستعلامات ونفس summarize() و withStandaloneProducts()
 * التي كان المتصفح يشغّلها، لكن على الخادم؛ المتصفح يستلم الصفحة المطلوبة فقط.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: any; error: any }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadAllProducts(sb: any): Promise<ProductListItem[]> {
  const [ads, competitors, overridesRes, rows] = await Promise.all([
    fetchAll<AdWithCompetitor>((a, b) =>
      sb.from("ads_with_duration").select("*").order("created_at", { ascending: false }).order("id").range(a, b),
    ),
    fetchAll<CompetitorRow>((a, b) =>
      sb.from("competitors").select("*").order("created_at", { ascending: false }).order("id").range(a, b),
    ),
    sb.from("product_code_overrides").select("product_key, code"),
    fetchAll<{ id: string; canonical_name: string; code: string; image_url: string | null; profile: unknown }>(
      (a, b) =>
        sb
          .from("products")
          .select("id, canonical_name, code, image_url, profile")
          .order("created_at", { ascending: false })
          .order("id")
          .range(a, b),
    ),
  ]);
  if (overridesRes.error) throw new Error(overridesRes.error.message);
  const overrides = new Map<string, string>(
    ((overridesRes.data ?? []) as { product_key: string; code: string }[]).map((r) => [r.product_key, r.code]),
  );
  const byId = new Map(competitors.map((c) => [c.id, c]));
  const withComp = ads.map((ad) => ({ ...ad, competitor: byId.get(ad.competitor_id) ?? null }));
  return withStandaloneProducts(summarize(withComp, overrides), rows).map(({ ads: _ads, ...rest }) => rest);
}

const ruleSchema = z.object({
  id: z.string().optional(),
  field: z.string().max(50),
  op: z.enum(["is", "is_not", "contains", "empty", "not_empty", "gte", "lte"]),
  value: z.string().max(500),
});

const inputSchema = z.object({
  search: z.string().max(200).default(""),
  rules: z.array(ruleSchema).max(20).default([]),
  aiIds: z.array(z.string().max(100)).max(20_000).nullable().default(null),
  pageSize: z.union([z.number().int().min(1).max(100), z.literal("all")]),
  page: z.number().int().min(1).max(100_000),
});

export type ProductsPageInput = z.input<typeof inputSchema>;
export type ProductsPageResult = {
  items: ProductListItem[];
  total: number;
  /** إجمالي المنتجات قبل البحث والفلاتر (لرسالة "لا توجد منتجات"). */
  allTotal: number;
  /** مفاتيح كل النتائج المطابقة — لزر "تحديد كل النتائج". */
  filteredKeys: string[];
  options: Record<string, string[]>;
};

export const getProductsPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data, context }): Promise<ProductsPageResult> => {
    return legacyCompute(await loadAllProducts(context.supabase), data);
  });

function legacyCompute(products: ProductListItem[], data: z.infer<typeof inputSchema>): ProductsPageResult {

    const options: Record<string, string[]> = {};
    for (const f of PRODUCT_FIELD_LABELS) {
      const set = new Set<string>();
      for (const p of products) for (const v of PRODUCT_FIELD_VALUES[f.id]!(p)) if (v) set.add(v);
      options[f.id] = [...set].sort((a, b) =>
        f.type === "number" ? Number(a) - Number(b) : a.localeCompare(b, "ar"),
      );
    }

    const aiIds = data.aiIds ? new Set(data.aiIds) : null;
    const q = data.search.trim().toLowerCase();
    const filtered = products.filter((p) => {
      if (aiIds && !aiIds.has(p.key)) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.code.toLowerCase().includes(q)) return false;
      return data.rules.every((rule) => {
        const def = PRODUCT_FIELD_LABELS.find((f) => f.id === rule.field);
        if (!def) return true;
        return matchRule(PRODUCT_FIELD_VALUES[rule.field]!(p), { ...rule, id: rule.id ?? "" }, def.type);
      });
    });

    const total = filtered.length;
    let items = filtered;
    if (data.pageSize !== "all") {
      const pageCount = Math.max(1, Math.ceil(total / data.pageSize));
      const start = (Math.min(data.page, pageCount) - 1) * data.pageSize;
      items = filtered.slice(start, start + data.pageSize);
    }
    return { items, total, allTotal: products.length, filteredKeys: filtered.map((p) => p.key), options };
}

/** مدخلات البحث الذكي (معرف + وصف نصي) لكل المنتجات، محسوبة على الخادم. */
export const getProductAiEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const products = await loadAllProducts(context.supabase);
    return products.map((p) => ({ id: p.key, term: aiTerm(p) }));
  });

// ============================================================================
// Phase 4 — Products من قاعدة البيانات (get_products_page).
// التنفيذ القديم أعلاه (getProductsPage / getProductAiEntries) باقٍ للمقارنة (Comparison Mode).
// ============================================================================

type NormalizedRule = { field: string; type: "text" | "number"; op: string; t?: string; n?: string };

/**
 * يحوّل القواعد إلى صيغة تنفذها قاعدة البيانات بنفس دلالة matchRule():
 * الحقل غير المعروف أو القيمة الفارغة (لغير empty/not_empty) أو الرقم غير الصالح = قاعدة لا تُقيّد.
 * تحليل الرقم وتحويل الأحرف الصغيرة يتمان بـ JavaScript نفسه لضمان التطابق.
 */
export function normalizeProductRules(rules: z.infer<typeof ruleSchema>[]): NormalizedRule[] {
  const out: NormalizedRule[] = [];
  for (const rule of rules) {
    const def = PRODUCT_FIELD_LABELS.find((f) => f.id === rule.field);
    if (!def) continue;
    const type = def.type === "number" ? "number" : "text";
    if (rule.op === "empty" || rule.op === "not_empty") {
      out.push({ field: rule.field, type, op: rule.op });
      continue;
    }
    const target = rule.value.trim();
    if (!target) continue;
    if (type === "number") {
      const n = Number(target);
      if (Number.isNaN(n)) continue;
      // نص رقمي (يدعم Infinity) لتفادي فقدان القيمة في JSON.
      out.push({ field: rule.field, type, op: rule.op, n: String(n) });
    } else {
      out.push({ field: rule.field, type, op: rule.op, t: target.toLowerCase() });
    }
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchProductsPageFromDb(sb: any, data: z.infer<typeof inputSchema>): Promise<ProductsPageResult> {
  const { data: res, error } = await sb.rpc("get_products_page", {
    _search: data.search.trim().toLowerCase(),
    _rules: normalizeProductRules(data.rules),
    _ai_ids: data.aiIds,
    _limit: data.pageSize === "all" ? null : data.pageSize,
    _page: data.page,
  });
  if (error) throw new Error(error.message);
  const r = res as ProductsPageResult;
  const options: Record<string, string[]> = {};
  for (const f of PRODUCT_FIELD_LABELS) options[f.id] = r.options?.[f.id] ?? [];
  return { items: r.items, total: r.total, allTotal: r.allTotal, filteredKeys: r.filteredKeys, options };
}

export const getProductsPageDb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data, context }): Promise<ProductsPageResult> => fetchProductsPageFromDb(context.supabase, data));

/** مدخلات البحث الذكي من قاعدة البيانات (نفس aiTerm). */
export const getProductAiEntriesDb = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const r = await fetchProductsPageFromDb(context.supabase, {
      search: "", rules: [], aiIds: null, pageSize: "all", page: 1,
    });
    return r.items.map((p) => ({ id: p.key, term: aiTerm(p) }));
  });

/** للمقارنة فقط: نفس منطق getProductsPage القديم كدالة قابلة للاستدعاء. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function legacyProductsPage(sb: any, data: z.infer<typeof inputSchema>) {
  return legacyCompute(await loadAllProducts(sb), data);
}
