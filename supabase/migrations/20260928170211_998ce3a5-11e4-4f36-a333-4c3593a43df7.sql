CREATE OR REPLACE FUNCTION public.get_competitors_page(
  _search text DEFAULT '',
  _product text DEFAULT NULL,
  _ai_ids uuid[] DEFAULT NULL,
  _rules jsonb DEFAULT '[]'::jsonb,
  _sort text DEFAULT 'newest',
  _limit integer DEFAULT 20,
  _offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  q text := coalesce(_search, '');
  lim int := CASE WHEN _limit IS NULL THEN NULL ELSE LEAST(GREATEST(_limit, 1), 100) END;
  off int := GREATEST(coalesce(_offset, 0), 0);
  result jsonb;
BEGIN
  WITH counts AS (
    SELECT a.competitor_id,
           count(*)::int AS total_ads,
           count(*) FILTER (WHERE a.status = 'active')::int AS active_ads
    FROM public.ads_with_duration a
    GROUP BY a.competitor_id
  ),
  base AS (
    SELECT c.id, c.competitor_name, c.competitor_url, c.platform, c.niche, c.created_at,
           c.updated_at, c.owner_id, c.last_crawled_at, c.crawl_status, c.crawl_error,
           c.source_page_id, c.is_demo,
           coalesce(n.total_ads, 0) AS total_ads,
           coalesce(n.active_ads, 0) AS active_ads,
           jsonb_build_object(
             'name', c.competitor_name, 'url', c.competitor_url,
             'platform', c.platform, 'niche', c.niche,
             'totalAds', coalesce(n.total_ads, 0)::text,
             'activeAds', coalesce(n.active_ads, 0)::text
           ) AS tv
    FROM public.competitors c
    LEFT JOIN counts n ON n.competitor_id = c.id
  ),
  filtered AS (
    SELECT b.* FROM base b
    WHERE (_product IS NULL OR EXISTS (
            SELECT 1 FROM public.ads_with_duration a
            WHERE a.competitor_id = b.id AND a.status = 'active'
              AND lower(btrim(a.product_name)) = _product))
      AND (_ai_ids IS NULL OR b.id = ANY(_ai_ids))
      AND (q = '' OR strpos(lower(b.competitor_name), q) > 0 OR strpos(lower(b.competitor_url), q) > 0)
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(coalesce(_rules, '[]'::jsonb)) r
        WHERE NOT (
          CASE
            WHEN r->>'type' = 'number' THEN
              CASE
                WHEN r->>'op' = 'empty' THEN false
                WHEN r->>'op' = 'not_empty' THEN true
                WHEN r->>'num' IS NULL THEN true
                WHEN r->>'op' = 'gte' THEN (b.tv->>(r->>'field'))::numeric >= (r->>'num')::numeric
                WHEN r->>'op' = 'lte' THEN (b.tv->>(r->>'field'))::numeric <= (r->>'num')::numeric
                ELSE (b.tv->>(r->>'field'))::numeric = (r->>'num')::numeric
              END
            ELSE
              CASE
                WHEN r->>'op' = 'empty' THEN btrim(coalesce(b.tv->>(r->>'field'), '')) = ''
                WHEN r->>'op' = 'not_empty' THEN btrim(coalesce(b.tv->>(r->>'field'), '')) <> ''
                WHEN r->>'t' IS NULL THEN true
                WHEN r->>'op' = 'is' THEN coalesce(btrim(b.tv->>(r->>'field')) <> '' AND lower(btrim(b.tv->>(r->>'field'))) = r->>'t', false)
                WHEN r->>'op' = 'is_not' THEN NOT coalesce(btrim(b.tv->>(r->>'field')) <> '' AND lower(btrim(b.tv->>(r->>'field'))) = r->>'t', false)
                ELSE coalesce(btrim(b.tv->>(r->>'field')) <> '' AND strpos(lower(btrim(b.tv->>(r->>'field'))), r->>'t') > 0, false)
              END
          END
        )
      )
  ),
  ordered AS (
    SELECT f.*,
      row_number() OVER (ORDER BY
        CASE WHEN _sort = 'name' THEN f.competitor_name END COLLATE "ar-x-icu" ASC,
        f.created_at DESC, f.id ASC) AS rn
    FROM filtered f
  ),
  page AS (
    SELECT o.* FROM ordered o ORDER BY o.rn LIMIT lim OFFSET off
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'allTotal', (SELECT count(*) FROM base),
    'filteredIds', coalesce((SELECT jsonb_agg(o.id ORDER BY o.rn) FROM ordered o), '[]'::jsonb),
    'items', coalesce((SELECT jsonb_agg((to_jsonb(p) - 'tv' - 'rn') ORDER BY p.rn) FROM page p), '[]'::jsonb),
    'options', jsonb_build_object(
      'name', coalesce((SELECT jsonb_agg(v ORDER BY v COLLATE "ar-x-icu") FROM (SELECT DISTINCT competitor_name v FROM base WHERE competitor_name <> '') s), '[]'::jsonb),
      'url', coalesce((SELECT jsonb_agg(v ORDER BY v COLLATE "ar-x-icu") FROM (SELECT DISTINCT competitor_url v FROM base WHERE competitor_url <> '') s), '[]'::jsonb),
      'platform', coalesce((SELECT jsonb_agg(v ORDER BY v COLLATE "ar-x-icu") FROM (SELECT DISTINCT platform v FROM base WHERE platform <> '') s), '[]'::jsonb),
      'niche', coalesce((SELECT jsonb_agg(v ORDER BY v COLLATE "ar-x-icu") FROM (SELECT DISTINCT niche v FROM base WHERE niche <> '') s), '[]'::jsonb),
      'totalAds', coalesce((SELECT jsonb_agg(v::text ORDER BY v) FROM (SELECT DISTINCT total_ads v FROM base) s), '[]'::jsonb),
      'activeAds', coalesce((SELECT jsonb_agg(v::text ORDER BY v) FROM (SELECT DISTINCT active_ads v FROM base) s), '[]'::jsonb)
    )
  ) INTO result;
  RETURN result;
END $function$;

REVOKE ALL ON FUNCTION public.get_competitors_page(text, text, uuid[], jsonb, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_competitors_page(text, text, uuid[], jsonb, text, integer, integer) TO authenticated, service_role;