/** دوال الخادم لعرض نتائج زحف الفئات وحذفها. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CcrawlKeyRow, CcrawlPageRow } from "@/lib/ccrawl.types";

const idsOf = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 500) : [];

/** مفاتيح البحث في آخر جولة. */
export const listCcrawlKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CcrawlKeyRow[]> => {
    const { supabase, userId } = context;
    const { data: run } = await supabase
      .from("ccrawl_runs").select("id").eq("owner_id", userId)
      .order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (!run) return [];
    const { data } = await supabase
      .from("ccrawl_keys").select("id, key_text, status, found").eq("run_id", run.id).order("created_at");
    return (data ?? []).map((k) => ({ id: k.id, keyText: k.key_text, status: k.status, found: k.found }));
  });

/** الصفحات التي تم تحليلها مع حالتها في مسار الموافقة. */
export const listCcrawlPages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CcrawlPageRow[]> => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("ccrawl_pages").select("*").eq("owner_id", userId).eq("status", "analyzed")
      .order("analyzed_at", { ascending: false }).limit(300);
    const rows = data ?? [];
    const pageIds = rows.map((r) => r.page_id);
    const status = new Map<string, { id: string; classification: string }>();
    if (pageIds.length) {
      const { data: disc } = await supabase
        .from("discovered_competitors").select("id, source_competitor_id, classification")
        .eq("owner_id", userId).eq("platform", "Facebook").in("source_competitor_id", pageIds);
      for (const d of disc ?? []) status.set(d.source_competitor_id, { id: d.id, classification: d.classification });
    }
    return rows.map((r) => ({
      id: r.id,
      pageId: r.page_id,
      pageName: r.page_name,
      pageUrl: r.page_url,
      imageUrl: r.image_url,
      adsSample: r.ads_sample ?? [],
      adIds: r.ad_ids ?? [],
      searchKey: r.search_key,
      score: Number(r.score) || 0,
      decision: r.decision,
      matchedCategories: r.matched_categories ?? [],
      reasons: r.reasons ?? [],
      differences: r.differences ?? [],
      pageRowId: status.get(r.page_id)?.id ?? null,
      pageStatus: status.get(r.page_id)?.classification ?? null,
    }));
  });

export const deleteCcrawlPages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ids?: unknown; decision?: unknown }) => ({
    ids: idsOf(input?.ids),
    decision: input?.decision === "match" || input?.decision === "no_match" ? input.decision : null,
  }))
  .handler(async ({ context, data }): Promise<{ deleted: number }> => {
    if (!data.ids.length && !data.decision) return { deleted: 0 };
    let q = context.supabase.from("ccrawl_pages").delete({ count: "exact" }).eq("owner_id", context.userId).eq("status", "analyzed");
    if (data.ids.length) q = q.in("id", data.ids);
    else if (data.decision) q = q.eq("decision", data.decision);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return { deleted: count ?? 0 };
  });

export const deleteCcrawlKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ids?: unknown; all?: unknown }) => ({ ids: idsOf(input?.ids), all: input?.all === true }))
  .handler(async ({ context, data }): Promise<{ deleted: number }> => {
    const { supabase, userId } = context;
    let ids = data.ids;
    if (data.all) {
      const keys = await supabase
        .from("ccrawl_runs").select("id").eq("owner_id", userId)
        .order("started_at", { ascending: false }).limit(1).maybeSingle();
      if (!keys.data) return { deleted: 0 };
      const { count, error } = await supabase
        .from("ccrawl_keys").delete({ count: "exact" }).eq("owner_id", userId).eq("run_id", keys.data.id).neq("status", "pending");
      if (error) throw new Error(error.message);
      return { deleted: count ?? 0 };
    }
    if (!ids.length) return { deleted: 0 };
    const { count, error } = await supabase.from("ccrawl_keys").delete({ count: "exact" }).eq("owner_id", userId).in("id", ids);
    if (error) throw new Error(error.message);
    ids = [];
    return { deleted: count ?? 0 };
  });
