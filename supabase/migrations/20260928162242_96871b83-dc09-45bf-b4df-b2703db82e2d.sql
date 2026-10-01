
-- Phase 4 — Products: read-only aggregation inside the database (mirrors summarize() + withStandaloneProducts() + filters).

CREATE OR REPLACE FUNCTION public.kashaf_js_trim(_s text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT regexp_replace(coalesce(_s,''),
    '^[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g')
$$;

-- JavaScript string length (UTF-16 code units).
CREATE OR REPLACE FUNCTION public.kashaf_utf16_len(_s text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT char_length(coalesce(_s,'')) + char_length(regexp_replace(coalesce(_s,''), '[^\U00010000-\U0010FFFF]', '', 'g'))
$$;

-- Mirror of productCode() in src/lib/product.ts (hash over UTF-16 code units).
CREATE OR REPLACE FUNCTION public.kashaf_product_code(_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE
  k text := public.kashaf_product_key(_name);
  h bigint := 0; cp int; i int; s text := ''; d int;
BEGIN
  FOR i IN 1..char_length(k) LOOP
    cp := ascii(substr(k, i, 1));
    IF cp > 65535 THEN
      h := (h * 31 + (((cp - 65536) >> 10) + 55296)) % 1679616;
      h := (h * 31 + (((cp - 65536) & 1023) + 56320)) % 1679616;
    ELSE
      h := (h * 31 + cp) % 1679616;
    END IF;
  END LOOP;
  IF h = 0 THEN s := '0'; END IF;
  WHILE h > 0 LOOP
    d := (h % 36)::int;
    s := substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', d + 1, 1) || s;
    h := h / 36;
  END LOOP;
  RETURN 'P-' || lpad(s, 4, '0');
END $$;

CREATE OR REPLACE FUNCTION public.get_products_page(
  _search text DEFAULT '',
  _rules jsonb DEFAULT '[]'::jsonb,
  _ai_ids text[] DEFAULT NULL,
  _limit integer DEFAULT NULL,
  _page integer DEFAULT 1
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
WITH a AS (
  SELECT a.id, a.competitor_id, a.status, a.product_id, a.image_url, a.product_description,
         a.active_days, a.inactive_days, a.product_code,
         public.kashaf_js_trim(a.product_name) AS first_name,
         public.kashaf_js_trim(coalesce(a.canonical_product_name, a.product_name)) AS disp,
         c.platform, c.niche, c.competitor_name,
         row_number() OVER (ORDER BY a.created_at DESC, a.id) AS rn
  FROM public.ads_with_duration a
  LEFT JOIN public.competitors c ON c.id = a.competitor_id
),
k AS (
  SELECT a.*, coalesce(ov.code, a.product_code, public.kashaf_product_code(a.disp)) AS code0
  FROM a LEFT JOIN public.product_code_overrides ov ON ov.product_key = public.kashaf_product_key(a.disp)
),
k2 AS (SELECT k.*, coalesce(k.product_id::text, k.code0) AS key FROM k),
firsts AS (SELECT DISTINCT ON (key) key, first_name, code0, rn FROM k2 ORDER BY key, rn),
img AS (SELECT DISTINCT ON (key) key, image_url FROM k2 WHERE coalesce(image_url,'') <> '' ORDER BY key, rn),
descr AS (
  SELECT DISTINCT ON (key) key, d FROM (
    SELECT key, rn, public.kashaf_js_trim(product_description) AS d FROM k2
  ) x WHERE d <> '' ORDER BY key, public.kashaf_utf16_len(d) DESC, rn
),
agg AS (
  SELECT key, count(*) AS total_ads,
         count(*) FILTER (WHERE status = 'active') AS active_ads,
         count(*) FILTER (WHERE status IS DISTINCT FROM 'active') AS stopped_ads,
         coalesce(sum(coalesce(active_days,0)),0) AS active_days,
         coalesce(sum(coalesce(inactive_days,0)),0) AS inactive_days,
         count(DISTINCT competitor_id) FILTER (WHERE status = 'active') AS active_comp
  FROM k2 GROUP BY key
),
stopcomp AS (
  SELECT s.key, count(DISTINCT s.competitor_id) AS n FROM k2 s
  WHERE s.status IS DISTINCT FROM 'active' AND s.competitor_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM k2 t WHERE t.key = s.key AND t.status = 'active' AND t.competitor_id = s.competitor_id)
  GROUP BY s.key
),
setv AS (
  SELECT key, fld, v, min(rn) AS frn FROM (
    SELECT key, rn, 'platform' AS fld, public.kashaf_js_trim(platform) AS v FROM k2 WHERE coalesce(platform,'') <> ''
    UNION ALL SELECT key, rn, 'niche', public.kashaf_js_trim(niche) FROM k2 WHERE coalesce(niche,'') <> ''
    UNION ALL SELECT key, rn, 'page', public.kashaf_js_trim(competitor_name) FROM k2 WHERE coalesce(competitor_name,'') <> ''
    UNION ALL SELECT key, rn, 'status', CASE WHEN status = 'active' THEN 'نشط' ELSE 'متوقف' END FROM k2
  ) x GROUP BY key, fld, v
),
sets AS (
  SELECT key,
    coalesce(array_agg(v ORDER BY frn) FILTER (WHERE fld='platform'), '{}') AS platforms,
    coalesce(array_agg(v ORDER BY frn) FILTER (WHERE fld='niche'), '{}') AS niches,
    coalesce(array_agg(v ORDER BY frn) FILTER (WHERE fld='page'), '{}') AS competitor_names,
    coalesce(array_agg(v ORDER BY frn) FILTER (WHERE fld='status'), '{}') AS statuses
  FROM setv GROUP BY key
),
listed AS (
  SELECT f.key, f.first_name AS sort_name, f.rn AS first_rn,
    coalesce(p.canonical_name, f.first_name) AS name,
    f.code0 AS code,
    CASE WHEN p.id IS NOT NULL THEN coalesce(p.image_url, img.image_url) ELSE img.image_url END AS image,
    CASE WHEN p.id IS NOT NULL AND jsonb_typeof(p.profile->'description') = 'string'
              AND public.kashaf_js_trim(p.profile->>'description') <> ''
         THEN public.kashaf_js_trim(p.profile->>'description') ELSE descr.d END AS description,
    g.active_comp AS active_competitors, coalesce(sc.n,0) AS stopped_competitors,
    g.active_ads, g.stopped_ads, g.active_days, g.inactive_days, g.total_ads,
    coalesce(s.platforms,'{}') AS platforms, coalesce(s.niches,'{}') AS niches,
    coalesce(s.competitor_names,'{}') AS competitor_names, coalesce(s.statuses,'{}') AS statuses
  FROM firsts f
  JOIN agg g ON g.key = f.key
  LEFT JOIN img ON img.key = f.key
  LEFT JOIN descr ON descr.key = f.key
  LEFT JOIN stopcomp sc ON sc.key = f.key
  LEFT JOIN sets s ON s.key = f.key
  LEFT JOIN public.products p ON p.id::text = f.key
),
items AS (
  SELECT 0 AS grp, row_number() OVER (ORDER BY p.created_at DESC, p.id) AS ord,
    p.id::text AS key, p.canonical_name AS name, p.code, p.image_url AS image,
    CASE WHEN jsonb_typeof(p.profile->'description') = 'string' AND public.kashaf_js_trim(p.profile->>'description') <> ''
         THEN p.profile->>'description' END AS description,
    0::bigint AS active_competitors, 0::bigint AS stopped_competitors, 0::bigint AS active_ads, 0::bigint AS stopped_ads,
    0::bigint AS active_days, 0::bigint AS inactive_days, 0::bigint AS total_ads,
    '{}'::text[] AS platforms, '{}'::text[] AS niches, '{}'::text[] AS competitor_names, '{}'::text[] AS statuses
  FROM public.products p WHERE NOT EXISTS (SELECT 1 FROM listed l WHERE l.key = p.id::text)
  UNION ALL
  SELECT 1, row_number() OVER (ORDER BY total_ads DESC, sort_name COLLATE "ar-x-icu", first_rn),
    key, name, code, image, description, active_competitors, stopped_competitors, active_ads, stopped_ads,
    active_days, inactive_days, total_ads, platforms, niches, competitor_names, statuses
  FROM listed
),
filtered AS (
  SELECT i.*, row_number() OVER (ORDER BY grp, ord) AS pos FROM items i
  WHERE (_ai_ids IS NULL OR i.key = ANY(_ai_ids))
    AND (coalesce(_search,'') = '' OR strpos(lower(i.name), _search) > 0 OR strpos(lower(i.code), _search) > 0)
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(_rules,'[]'::jsonb)) r
      WHERE NOT (
        CASE WHEN r->>'type' = 'number' THEN
          CASE r->>'op'
            WHEN 'empty' THEN false
            WHEN 'not_empty' THEN true
            ELSE (
              WITH nv AS (SELECT CASE r->>'field'
                WHEN 'activeAds' THEN i.active_ads WHEN 'stoppedAds' THEN i.stopped_ads
                WHEN 'activeCompetitors' THEN i.active_competitors WHEN 'stoppedCompetitors' THEN i.stopped_competitors
                WHEN 'activeDays' THEN i.active_days WHEN 'inactiveDays' THEN i.inactive_days END::numeric AS n)
              SELECT CASE r->>'op'
                WHEN 'gte' THEN n >= (r->>'n')::numeric
                WHEN 'lte' THEN n <= (r->>'n')::numeric
                ELSE n = (r->>'n')::numeric END FROM nv)
          END
        ELSE (
          WITH vals AS (
            SELECT lower(public.kashaf_js_trim(v)) AS lv FROM unnest(CASE r->>'field'
              WHEN 'name' THEN ARRAY[i.name] WHEN 'code' THEN ARRAY[i.code]
              WHEN 'platform' THEN i.platforms WHEN 'niche' THEN i.niches
              WHEN 'page' THEN i.competitor_names WHEN 'status' THEN i.statuses
              ELSE '{}'::text[] END) v
            WHERE public.kashaf_js_trim(v) <> ''
          )
          SELECT CASE r->>'op'
            WHEN 'empty' THEN NOT EXISTS (SELECT 1 FROM vals)
            WHEN 'not_empty' THEN EXISTS (SELECT 1 FROM vals)
            WHEN 'is' THEN EXISTS (SELECT 1 FROM vals WHERE lv = r->>'t')
            WHEN 'is_not' THEN NOT EXISTS (SELECT 1 FROM vals WHERE lv = r->>'t')
            ELSE EXISTS (SELECT 1 FROM vals WHERE strpos(lv, r->>'t') > 0) END
        ) END
      )
    )
),
cnt AS (SELECT count(*) AS total FROM filtered),
bounds AS (
  SELECT total,
    CASE WHEN _limit IS NULL THEN 0
         ELSE (least(greatest(coalesce(_page,1),1), greatest(1, ceil(total::numeric / _limit)::int)) - 1) * _limit END AS start
  FROM cnt
),
opt_text AS (
  SELECT fld, jsonb_agg(v ORDER BY v COLLATE "ar-x-icu", frn) AS vals FROM (
    SELECT fld, v, min(ord2) AS frn FROM (
      SELECT row_number() OVER (ORDER BY grp, ord) AS ord2, * FROM items
    ) it
    CROSS JOIN LATERAL (
      SELECT 'name' AS fld, it.name AS v UNION ALL SELECT 'code', it.code
      UNION ALL SELECT 'platform', unnest(it.platforms) UNION ALL SELECT 'niche', unnest(it.niches)
      UNION ALL SELECT 'page', unnest(it.competitor_names) UNION ALL SELECT 'status', unnest(it.statuses)
    ) x WHERE coalesce(v,'') <> '' GROUP BY fld, v
  ) y GROUP BY fld
),
opt_num AS (
  SELECT fld, jsonb_agg(n::text ORDER BY n) AS vals FROM (
    SELECT DISTINCT fld, n FROM items
    CROSS JOIN LATERAL (VALUES ('activeAds', active_ads), ('stoppedAds', stopped_ads),
      ('activeCompetitors', active_competitors), ('stoppedCompetitors', stopped_competitors),
      ('activeDays', active_days), ('inactiveDays', inactive_days)) x(fld, n)
  ) y GROUP BY fld
)
SELECT jsonb_build_object(
  'total', (SELECT total FROM cnt),
  'allTotal', (SELECT count(*) FROM items),
  'filteredKeys', coalesce((SELECT jsonb_agg(key ORDER BY pos) FROM filtered), '[]'::jsonb),
  'items', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'key', key, 'name', name, 'code', code, 'image', image, 'description', description,
      'activeCompetitors', active_competitors, 'stoppedCompetitors', stopped_competitors,
      'activeAds', active_ads, 'stoppedAds', stopped_ads, 'activeDays', active_days,
      'inactiveDays', inactive_days, 'totalAds', total_ads,
      'platforms', to_jsonb(platforms), 'niches', to_jsonb(niches),
      'competitorNames', to_jsonb(competitor_names), 'statuses', to_jsonb(statuses)
    ) ORDER BY pos)
    FROM filtered, bounds
    WHERE _limit IS NULL OR (pos > bounds.start AND pos <= bounds.start + _limit)
  ), '[]'::jsonb),
  'options', coalesce((SELECT jsonb_object_agg(fld, vals) FROM (SELECT * FROM opt_text UNION ALL SELECT * FROM opt_num) o), '{}'::jsonb)
)
$$;

REVOKE ALL ON FUNCTION public.get_products_page(text, jsonb, text[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_products_page(text, jsonb, text[], integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kashaf_js_trim(text), public.kashaf_utf16_len(text), public.kashaf_product_code(text) TO authenticated, service_role;
