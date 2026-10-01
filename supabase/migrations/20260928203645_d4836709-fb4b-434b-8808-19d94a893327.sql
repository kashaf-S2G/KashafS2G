CREATE OR REPLACE FUNCTION public.get_pb_statements_page(
  _kind text DEFAULT NULL,
  _search text DEFAULT '',
  _sort text DEFAULT 'newest',
  _limit integer DEFAULT 50,
  _page integer DEFAULT 1
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
WITH s AS (
  SELECT p.id, p.kind, p.display_text, p.normalized_key
  FROM public.pb_statements p
  WHERE (_kind IS NULL OR p.kind = _kind)
),
occ AS (
  SELECT DISTINCT o.statement_id, a.id AS ad_id, a.status, a.product_id, a.competitor_id, a.creation_date
  FROM public.ad_statements o
  JOIN public.ads a ON a.id = o.ad_id AND a.owner_id = o.owner_id
  WHERE o.statement_id IN (SELECT id FROM s)
),
agg AS (
  SELECT statement_id,
    count(DISTINCT ad_id) AS total_ads,
    count(DISTINCT ad_id) FILTER (WHERE status = 'active') AS active_ads,
    count(DISTINCT ad_id) FILTER (WHERE status IS DISTINCT FROM 'active') AS stopped_ads,
    count(DISTINCT product_id) AS products,
    count(DISTINCT competitor_id) AS competitors,
    min(creation_date) AS first_seen,
    max(creation_date) AS last_seen
  FROM occ GROUP BY statement_id
),
items AS (
  SELECT s.*, coalesce(g.total_ads,0) AS total_ads, coalesce(g.active_ads,0) AS active_ads,
    coalesce(g.stopped_ads,0) AS stopped_ads, coalesce(g.products,0) AS products,
    coalesce(g.competitors,0) AS competitors, g.first_seen, g.last_seen
  FROM s LEFT JOIN agg g ON g.statement_id = s.id
),
filtered AS (
  SELECT i.*, row_number() OVER (ORDER BY
    CASE WHEN _sort = 'newest' THEN i.last_seen END DESC NULLS LAST,
    CASE WHEN _sort = 'oldest' THEN i.first_seen END ASC NULLS LAST,
    CASE WHEN _sort = 'ads' THEN i.total_ads END DESC,
    CASE WHEN _sort = 'active_ads' THEN i.active_ads END DESC,
    CASE WHEN _sort = 'products' THEN i.products END DESC,
    CASE WHEN _sort = 'text' THEN i.display_text END COLLATE "ar-x-icu" ASC,
    i.id) AS pos
  FROM items i
  WHERE coalesce(_search,'') = '' OR strpos(lower(i.display_text), lower(_search)) > 0
),
cnt AS (SELECT count(*) AS total FROM filtered),
bounds AS (
  SELECT total, (least(greatest(coalesce(_page,1),1), greatest(1, ceil(total::numeric / _limit)::int)) - 1) * _limit AS start
  FROM cnt
)
SELECT jsonb_build_object(
  'total', (SELECT total FROM cnt),
  'allTotal', (SELECT count(*) FROM items),
  'items', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', f.id, 'kind', f.kind, 'text', f.display_text, 'key', f.normalized_key,
      'totalAds', f.total_ads, 'activeAds', f.active_ads, 'stoppedAds', f.stopped_ads,
      'products', f.products, 'competitors', f.competitors,
      'firstSeen', f.first_seen, 'lastSeen', f.last_seen
    ) ORDER BY f.pos)
    FROM filtered f, bounds b WHERE f.pos > b.start AND f.pos <= b.start + _limit
  ), '[]'::jsonb)
)
$$;
REVOKE ALL ON FUNCTION public.get_pb_statements_page(text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pb_statements_page(text, text, text, integer, integer) TO authenticated, service_role;