import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AdWithCompetitor } from "@/lib/kashaf";

/** الحقول والعمليات المسموح بها فقط (whitelist) — لا يُبنى SQL من نصوص المتصفح. */
const TEXT_FIELDS = ["product", "competitor", "platform", "niche", "status", "creationDate"] as const;
const NUMBER_FIELDS = ["activeDays", "inactiveDays"] as const;

const ruleSchema = z.object({
  field: z.enum([...TEXT_FIELDS, ...NUMBER_FIELDS]),
  op: z.enum(["is", "is_not", "contains", "empty", "not_empty", "gte", "lte"]),
  value: z.string().max(500),
});

const inputSchema = z.object({
  search: z.string().max(200).default(""),
  competitorId: z.string().uuid().optional(),
  status: z.enum(["active", "stopped"]).optional(),
  rules: z.array(ruleSchema).max(20).default([]),
  pageSize: z.number().int().min(1).max(100),
  page: z.number().int().min(1).max(100_000),
});

export type AdsPageInput = z.input<typeof inputSchema>;
export type AdsPageItem = AdWithCompetitor & { product_count: number; product_index: number };
export type AdsPageResult = { items: AdsPageItem[]; total: number };

export const getAdsPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data, context }): Promise<AdsPageResult> => {
    const rules = data.rules.map((r) => {
      const isNum = (NUMBER_FIELDS as readonly string[]).includes(r.field);
      const t = r.value.trim();
      // نفس سلوك matchRule: قيمة رقمية غير صالحة أو فارغة = القاعدة لا تستبعد شيئًا.
      const num = isNum && t !== "" && !Number.isNaN(Number(t)) ? Number(t) : null;
      return { field: r.field, op: r.op, value: r.value, num };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: res, error } = await (context.supabase as any).rpc("get_ads_page", {
      _search: data.search,
      _competitor_id: data.competitorId ?? null,
      _status: data.status ?? null,
      _rules: rules,
      _limit: data.pageSize,
      _offset: (data.page - 1) * data.pageSize,
    });
    if (error) throw new Error(error.message);
    const r = (res ?? {}) as { items?: AdsPageItem[]; total?: number };
    return { items: r.items ?? [], total: Number(r.total ?? 0) };
  });

export const getAdsFilterOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Record<string, string[]>> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (context.supabase as any).rpc("get_ads_filter_options");
    if (error) throw new Error(error.message);
    return (data ?? {}) as Record<string, string[]>;
  });
