ALTER TABLE public.pages RENAME TO competitors;
ALTER TABLE public.competitors RENAME COLUMN page_name TO competitor_name;
ALTER TABLE public.competitors RENAME COLUMN page_url TO competitor_url;
ALTER TABLE public.competitors RENAME CONSTRAINT pages_pkey TO competitors_pkey;
ALTER TABLE public.competitors RENAME CONSTRAINT pages_page_url_key TO competitors_competitor_url_key;
ALTER INDEX public.pages_owner_id_idx RENAME TO competitors_owner_id_idx;
ALTER INDEX public.pages_owner_last_crawled_idx RENAME TO competitors_owner_last_crawled_idx;
ALTER TRIGGER pages_touch ON public.competitors RENAME TO competitors_touch;
ALTER POLICY pages_select_own ON public.competitors RENAME TO competitors_select_own;
ALTER POLICY pages_insert_own ON public.competitors RENAME TO competitors_insert_own;
ALTER POLICY pages_update_own ON public.competitors RENAME TO competitors_update_own;
ALTER POLICY pages_delete_own ON public.competitors RENAME TO competitors_delete_own;

ALTER TABLE public.ads RENAME COLUMN page_id TO competitor_id;
ALTER TABLE public.ads RENAME CONSTRAINT ads_page_id_fkey TO ads_competitor_id_fkey;
ALTER INDEX public.ads_page_id_idx RENAME TO ads_competitor_id_idx;
ALTER VIEW public.ads_with_duration RENAME COLUMN page_id TO competitor_id;

ALTER TABLE public.crawl_page_items RENAME TO crawl_competitor_items;
ALTER TABLE public.crawl_competitor_items RENAME COLUMN page_id TO competitor_id;
ALTER TABLE public.crawl_competitor_items RENAME CONSTRAINT crawl_page_items_pkey TO crawl_competitor_items_pkey;
ALTER TABLE public.crawl_competitor_items RENAME CONSTRAINT crawl_page_items_page_id_fkey TO crawl_competitor_items_competitor_id_fkey;
ALTER TABLE public.crawl_competitor_items RENAME CONSTRAINT crawl_page_items_run_id_fkey TO crawl_competitor_items_run_id_fkey;
ALTER TABLE public.crawl_competitor_items RENAME CONSTRAINT crawl_page_items_run_id_page_id_key TO crawl_competitor_items_run_id_competitor_id_key;
ALTER INDEX public.crawl_page_items_run_status_idx RENAME TO crawl_competitor_items_run_status_idx;
ALTER POLICY crawl_page_items_select_own ON public.crawl_competitor_items RENAME TO crawl_competitor_items_select_own;
ALTER POLICY crawl_page_items_insert_own ON public.crawl_competitor_items RENAME TO crawl_competitor_items_insert_own;
ALTER POLICY crawl_page_items_update_own ON public.crawl_competitor_items RENAME TO crawl_competitor_items_update_own;
ALTER POLICY crawl_page_items_delete_own ON public.crawl_competitor_items RENAME TO crawl_competitor_items_delete_own;

ALTER TABLE public.crawl_runs RENAME COLUMN pages_scanned TO competitors_scanned;

ALTER TABLE public.discovered_pages RENAME TO discovered_competitors;
ALTER TABLE public.discovered_competitors RENAME COLUMN source_page_id TO source_competitor_id;
ALTER TABLE public.discovered_competitors RENAME COLUMN page_name TO competitor_name;
ALTER TABLE public.discovered_competitors RENAME COLUMN page_url TO competitor_url;
ALTER TABLE public.discovered_competitors RENAME CONSTRAINT discovered_pages_pkey TO discovered_competitors_pkey;
ALTER TABLE public.discovered_competitors RENAME CONSTRAINT discovered_pages_owner_id_platform_source_page_id_key TO discovered_competitors_owner_platform_source_id_key;
ALTER INDEX public.discovered_pages_pending_idx RENAME TO discovered_competitors_pending_idx;
ALTER TRIGGER discovered_pages_touch ON public.discovered_competitors RENAME TO discovered_competitors_touch;
ALTER POLICY discovered_pages_select_own ON public.discovered_competitors RENAME TO discovered_competitors_select_own;
ALTER POLICY discovered_pages_insert_own ON public.discovered_competitors RENAME TO discovered_competitors_insert_own;
ALTER POLICY discovered_pages_update_own ON public.discovered_competitors RENAME TO discovered_competitors_update_own;
ALTER POLICY discovered_pages_delete_own ON public.discovered_competitors RENAME TO discovered_competitors_delete_own;

ALTER TABLE public.discovery_runs RENAME COLUMN pages_found TO competitors_found;
ALTER TABLE public.discovery_runs RENAME COLUMN pages_new TO competitors_new;
ALTER TABLE public.discovery_runs RENAME COLUMN pages_classified TO competitors_classified;
ALTER TABLE public.discovery_runs RENAME COLUMN pages_matched TO competitors_matched;

DROP FUNCTION public.claim_legacy_records();
DROP FUNCTION public.claim_legacy_records_for(uuid);
CREATE FUNCTION public.claim_legacy_records_for(_uid uuid)
RETURNS TABLE(claimed_competitors integer, claimed_ads integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  first_uid uuid;
  c integer := 0;
  a integer := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required to claim legacy records';
  END IF;
  SELECT u.id INTO first_uid FROM auth.users u ORDER BY u.created_at ASC LIMIT 1;
  IF first_uid IS NULL OR _uid <> first_uid THEN
    RAISE EXCEPTION 'Forbidden: only the primary (first registered) account may claim legacy records';
  END IF;
  UPDATE public.competitors SET owner_id = _uid WHERE owner_id IS NULL;
  GET DIAGNOSTICS c = ROW_COUNT;
  UPDATE public.ads SET owner_id = _uid WHERE owner_id IS NULL;
  GET DIAGNOSTICS a = ROW_COUNT;
  claimed_competitors := c;
  claimed_ads := a;
  RETURN NEXT;
END;
$$;
CREATE FUNCTION public.claim_legacy_records()
RETURNS TABLE(claimed_competitors integer, claimed_ads integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  RETURN QUERY SELECT * FROM public.claim_legacy_records_for(uid);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_legacy_records_for(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_legacy_records() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_legacy_records() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_legacy_records_for(uuid) TO service_role;