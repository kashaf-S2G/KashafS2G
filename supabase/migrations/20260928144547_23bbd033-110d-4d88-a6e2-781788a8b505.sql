CREATE OR REPLACE FUNCTION public.kashaf_product_key(_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  -- مطابق لـ productKey في الواجهة: trim + lower + توحيد المسافات (نفس فئة \s في JavaScript)
  SELECT regexp_replace(
           regexp_replace(lower(coalesce(_name,'')),
             '^[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g'),
           '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g')
$$;

CREATE OR REPLACE FUNCTION public.get_ads_page(
  _search text DEFAULT NULL,
  _competitor_id uuid DEFAULT NULL,
  _status text DEFAULT NULL,
  _rules jsonb DEFAULT '[]'::jsonb,
  _limit integer DEFAULT 20,
  _offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  q text := lower(btrim(coalesce(_search,'')));
  lim int := LEAST(GREATEST(coalesce(_limit,20),1),100);
  off int := GREATEST(coalesce(_offset,0),0);
  result jsonb;
BEGIN
  WITH base AS (
    SELECT a.*, c.competitor_name AS c_name, c.platform AS c_platform, c.niche AS c_niche,
           to_jsonb(c) AS competitor_json,
           public.kashaf_product_key(a.product_name) AS pkey
    FROM public.ads_with_duration a
    LEFT JOIN public.competitors c ON c.id = a.competitor_id
  ),
  numbered AS (
    SELECT b.*,
      count(*) OVER (PARTITION BY b.pkey) AS product_count,
      row_number() OVER (PARTITION BY b.pkey ORDER BY b.creation_date ASC, b.created_at DESC, b.id ASC) AS product_index
    FROM base b
  ),
  vals AS (
    SELECT n.*,
      jsonb_build_object(
        'product', n.product_name,
        'competitor', n.c_name,
        'platform', n.c_platform,
        'niche', n.c_niche,
        'status', CASE WHEN n.status = 'active' THEN 'نشط' ELSE 'غير نشط' END,
        'creationDate', n.creation_date::text
      ) AS tv
    FROM numbered n
  ),
  filtered AS (
    SELECT v.* FROM vals v
    WHERE (q = '' OR strpos(lower(v.product_name), q) > 0 OR strpos(lower(coalesce(v.c_name,'')), q) > 0)
      AND (_competitor_id IS NULL OR v.competitor_id = _competitor_id)
      AND (_status IS NULL OR v.status = _status)
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(coalesce(_rules,'[]'::jsonb)) r
        WHERE NOT (
          CASE
            WHEN r->>'field' IN ('activeDays','inactiveDays') THEN
              CASE
                WHEN r->>'num' IS NULL THEN true
                WHEN r->>'op' = 'gte' THEN (CASE WHEN r->>'field'='activeDays' THEN v.active_days ELSE v.inactive_days END) >= (r->>'num')::numeric
                WHEN r->>'op' = 'lte' THEN (CASE WHEN r->>'field'='activeDays' THEN v.active_days ELSE v.inactive_days END) <= (r->>'num')::numeric
                WHEN r->>'op' = 'is'  THEN (CASE WHEN r->>'field'='activeDays' THEN v.active_days ELSE v.inactive_days END) = (r->>'num')::numeric
                ELSE true
              END
            WHEN r->>'field' IN ('product','competitor','platform','niche','status','creationDate') THEN
              CASE
                WHEN r->>'op' = 'empty' THEN btrim(coalesce(v.tv->>(r->>'field'),'')) = ''
                WHEN r->>'op' = 'not_empty' THEN btrim(coalesce(v.tv->>(r->>'field'),'')) <> ''
                WHEN btrim(coalesce(r->>'value','')) = '' THEN true
                WHEN r->>'op' = 'is' THEN coalesce(lower(btrim(v.tv->>(r->>'field'))) = lower(btrim(r->>'value')) AND btrim(v.tv->>(r->>'field')) <> '', false)
                WHEN r->>'op' = 'is_not' THEN NOT coalesce(lower(btrim(v.tv->>(r->>'field'))) = lower(btrim(r->>'value')) AND btrim(v.tv->>(r->>'field')) <> '', false)
                WHEN r->>'op' = 'contains' THEN coalesce(btrim(v.tv->>(r->>'field')) <> '' AND strpos(lower(btrim(v.tv->>(r->>'field'))), lower(btrim(r->>'value'))) > 0, false)
                ELSE true
              END
            ELSE true
          END
        )
      )
  ),
  page AS (
    SELECT f.* FROM filtered f
    ORDER BY f.created_at DESC, f.id ASC
    LIMIT lim OFFSET off
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'items', coalesce((
      SELECT jsonb_agg(
        (to_jsonb(p) - 'c_name' - 'c_platform' - 'c_niche' - 'competitor_json' - 'pkey' - 'tv')
        || jsonb_build_object('competitor', p.competitor_json)
        ORDER BY p.created_at DESC, p.id ASC)
      FROM page p), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.get_ads_filter_options()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH a AS (
    SELECT a.product_name, a.status, a.active_days, a.inactive_days, a.creation_date,
           c.competitor_name, c.platform, c.niche
    FROM public.ads_with_duration a LEFT JOIN public.competitors c ON c.id = a.competitor_id
  )
  SELECT jsonb_build_object(
    'product', coalesce((SELECT jsonb_agg(DISTINCT product_name) FROM a WHERE product_name <> ''), '[]'),
    'competitor', coalesce((SELECT jsonb_agg(DISTINCT competitor_name) FROM a WHERE coalesce(competitor_name,'') <> ''), '[]'),
    'platform', coalesce((SELECT jsonb_agg(DISTINCT platform) FROM a WHERE coalesce(platform,'') <> ''), '[]'),
    'niche', coalesce((SELECT jsonb_agg(DISTINCT niche) FROM a WHERE coalesce(niche,'') <> ''), '[]'),
    'status', coalesce((SELECT jsonb_agg(DISTINCT CASE WHEN status='active' THEN 'نشط' ELSE 'غير نشط' END) FROM a), '[]'),
    'activeDays', coalesce((SELECT jsonb_agg(DISTINCT active_days::text) FROM a), '[]'),
    'inactiveDays', coalesce((SELECT jsonb_agg(DISTINCT inactive_days::text) FROM a), '[]'),
    'creationDate', coalesce((SELECT jsonb_agg(DISTINCT creation_date::text) FROM a), '[]')
  )
$$;

CREATE INDEX IF NOT EXISTS ads_owner_created_id_idx ON public.ads (owner_id, created_at DESC, id);

REVOKE ALL ON FUNCTION public.get_ads_page(text, uuid, text, jsonb, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_ads_filter_options() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ads_page(text, uuid, text, jsonb, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ads_filter_options() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kashaf_product_key(text) TO authenticated, service_role;