/** قائمة الحظر: كل ما حذفه المستخدم لا يعود في أي زحف أو بحث قادم. */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Blocklist = {
  pages: Set<string>;
  ads: Set<string>;
  products: Set<string>;
  terms: Set<string>;
};

export function blockKeyOf(text: string): string {
  return String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadBlocklist(db: SupabaseClient<any>, ownerId: string): Promise<Blocklist> {
  const out: Blocklist = { pages: new Set(), ads: new Set(), products: new Set(), terms: new Set() };
  const { data } = await db
    .from("deleted_items")
    .select("item_type, block_key")
    .eq("owner_id", ownerId)
    .limit(10000);
  for (const r of (data ?? []) as { item_type: string; block_key: string }[]) {
    if (r.item_type === "page" || r.item_type === "competitor") out.pages.add(r.block_key);
    else if (r.item_type === "ad") out.ads.add(r.block_key);
    else if (r.item_type === "product") out.products.add(r.block_key);
    else if (r.item_type === "term" || r.item_type === "category") out.terms.add(r.block_key);
  }
  const { data: removed } = await db
    .from("discovery_terms")
    .select("term_key")
    .eq("owner_id", ownerId)
    .eq("status", "removed");
  for (const r of removed ?? []) out.terms.add(blockKeyOf(r.term_key as string));
  return out;
}
