import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CompetitorRow } from "@/lib/kashaf";

/** الحقول المسموح بها فقط (whitelist) — نفس حقول فلتر صفحة المنافسين. */
const TEXT_FIELDS = ["name", "url", "platform", "niche"] as const;
const NUMBER_FIELDS = ["totalAds", "activeAds"] as const;

const ruleSchema = z.object({
  field: z.string().max(50),
  op: z.string().max(20),
  value: z.string().max(500),
});

const inputSchema = z.object({
  search: z.string().max(200).default(""),
  product: z.string().max(500).optional(),
  aiIds: z.array(z.string().uuid()).max(5000).nullable().default(null),
  rules: z.array(ruleSchema).max(20).default([]),
  sort: z.enum(["newest", "name"]).default("newest"),
  pageSize: z.union([z.number().int().min(1).max(100), z.literal("all")]),
  page: z.number().int().min(1).max(100_000),
});

export type CompetitorsPageInput = z.input<typeof inputSchema>;
export type CompetitorPageItem = CompetitorRow & { total_ads: number; active_ads: number };
export type CompetitorsPageResult = {
  items: CompetitorPageItem[];
  total: number;
  allTotal: number;
  filteredIds: string[];
  options: Record<string, string[]>;
};

/** يحوّل القواعد إلى صيغة قاعدة البيانات بنفس دلالة matchRule() (القاعدة غير الصالحة لا تُقيّد). */
function normalizeRules(rules: z.infer<typeof ruleSchema>[]) {
  const out: { field: string; type: "text" | "number"; op: string; t?: string; num?: string }[] = [];
  for (const rule of rules) {
    const isText = (TEXT_FIELDS as readonly string[]).includes(rule.field);
    const isNum = (NUMBER_FIELDS as readonly string[]).includes(rule.field);
    if (!isText && !isNum) continue;
    const type = isNum ? "number" : "text";
    if (rule.op === "empty" || rule.op === "not_empty") {
      out.push({ field: rule.field, type, op: rule.op });
      continue;
    }
    const target = rule.value.trim();
    if (!target) continue;
    if (isNum) {
      const n = Number(target);
      if (Number.isNaN(n)) continue;
      out.push({ field: rule.field, type, op: rule.op, num: String(n) });
    } else {
      out.push({ field: rule.field, type, op: rule.op, t: target.toLowerCase() });
    }
  }
  return out;
}

export const getCompetitorsPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data, context }): Promise<CompetitorsPageResult> => {
    const all = data.pageSize === "all";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: res, error } = await (context.supabase as any).rpc("get_competitors_page", {
      _search: data.search.trim().toLowerCase(),
      _product: data.product ? data.product.trim().toLowerCase() : null,
      _ai_ids: data.aiIds,
      _rules: normalizeRules(data.rules),
      _sort: data.sort,
      _limit: all ? null : data.pageSize,
      _offset: all ? 0 : (data.page - 1) * (data.pageSize as number),
    });
    if (error) throw new Error(error.message);
    const r = (res ?? {}) as Partial<CompetitorsPageResult>;
    return {
      items: r.items ?? [],
      total: Number(r.total ?? 0),
      allTotal: Number(r.allTotal ?? 0),
      filteredIds: r.filteredIds ?? [],
      options: r.options ?? {},
    };
  });
