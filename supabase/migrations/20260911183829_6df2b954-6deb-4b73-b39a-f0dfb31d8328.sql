WITH normalized_ads AS (
  SELECT DISTINCT
    a.owner_id,
    a.product_name,
    lower(regexp_replace(translate(a.product_name, 'أإآٱةىؤئ', 'ااااهيوي'), '[ًٌٍَُِّْـ[:space:][:punct:]]+', '', 'g')) AS canonical_key
  FROM public.ads a
  WHERE a.owner_id IS NOT NULL
), ranked AS (
  SELECT owner_id, product_name, canonical_key,
         row_number() OVER (PARTITION BY owner_id, canonical_key ORDER BY length(product_name), product_name) AS rn
  FROM normalized_ads
), inserted AS (
  INSERT INTO public.products(owner_id, canonical_name, canonical_key, code)
  SELECT r.owner_id,
         r.product_name,
         r.canonical_key,
         COALESCE(
           (SELECT pco.code FROM public.product_code_overrides pco
             WHERE pco.owner_id = r.owner_id
               AND lower(regexp_replace(translate(pco.product_key, 'أإآٱةىؤئ', 'ااااهيوي'), '[ًٌٍَُِّْـ[:space:][:punct:]]+', '', 'g')) = r.canonical_key
             ORDER BY pco.updated_at DESC LIMIT 1),
           'P-' || upper(substr(md5(r.owner_id::text || ':' || r.canonical_key), 1, 8))
         )
  FROM ranked r
  WHERE r.rn = 1 AND r.canonical_key <> ''
  ON CONFLICT (owner_id, canonical_key) DO NOTHING
  RETURNING id
)
SELECT count(*) FROM inserted;

INSERT INTO public.product_aliases(owner_id, product_id, alias_name, alias_key)
SELECT DISTINCT ON (a.owner_id, alias_key)
       a.owner_id,
       p.id,
       a.product_name,
       lower(regexp_replace(translate(a.product_name, 'أإآٱةىؤئ', 'ااااهيوي'), '[ًٌٍَُِّْـ[:space:][:punct:]]+', '', 'g')) AS alias_key
FROM public.ads a
JOIN public.products p
  ON p.owner_id = a.owner_id
 AND p.canonical_key = lower(regexp_replace(translate(a.product_name, 'أإآٱةىؤئ', 'ااااهيوي'), '[ًٌٍَُِّْـ[:space:][:punct:]]+', '', 'g'))
WHERE a.owner_id IS NOT NULL
ON CONFLICT (owner_id, alias_key) DO NOTHING;

UPDATE public.ads a
SET product_id = p.id
FROM public.products p
WHERE a.product_id IS NULL
  AND p.owner_id = a.owner_id
  AND p.canonical_key = lower(regexp_replace(translate(a.product_name, 'أإآٱةىؤئ', 'ااااهيوي'), '[ًٌٍَُِّْـ[:space:][:punct:]]+', '', 'g'));

CREATE OR REPLACE VIEW public.ads_with_duration
WITH (security_invoker = true) AS
SELECT
  a.id,
  a.page_id,
  a.product_name,
  a.creation_date,
  a.end_date,
  a.status,
  a.owner_id,
  a.created_at,
  a.updated_at,
  GREATEST(0, (COALESCE(CASE WHEN a.status = 'active' THEN (now() AT TIME ZONE 'utc')::date ELSE a.end_date END, (now() AT TIME ZONE 'utc')::date) - a.creation_date))::integer AS duration_days,
  (now() AT TIME ZONE 'utc')::date AS computed_on_utc,
  a.image_url,
  GREATEST(0, (COALESCE(CASE WHEN a.status = 'active' THEN (now() AT TIME ZONE 'utc')::date ELSE a.end_date END, (now() AT TIME ZONE 'utc')::date) - a.creation_date))::integer AS active_days,
  CASE WHEN a.status = 'active' THEN 0 ELSE GREATEST(0, (now() AT TIME ZONE 'utc')::date - COALESCE(a.end_date, (now() AT TIME ZONE 'utc')::date)) END::integer AS inactive_days,
  a.source_ad_id,
  a.source_url,
  a.source_platform,
  a.last_seen_at,
  a.product_id,
  p.canonical_name AS canonical_product_name,
  p.code AS product_code
FROM public.ads a
LEFT JOIN public.products p ON p.id = a.product_id;
REVOKE ALL ON public.ads_with_duration FROM anon;
GRANT SELECT ON public.ads_with_duration TO authenticated;
GRANT ALL ON public.ads_with_duration TO service_role;