CREATE OR REPLACE VIEW public.ads_with_duration AS
SELECT a.id,
    a.page_id,
    a.product_name,
    a.creation_date,
    a.end_date,
    a.status,
    a.owner_id,
    a.created_at,
    a.updated_at,
    GREATEST(0, COALESCE(
        CASE WHEN a.status = 'active'::text THEN (now() AT TIME ZONE 'utc'::text)::date
             ELSE a.end_date END,
        (now() AT TIME ZONE 'utc'::text)::date) - a.creation_date) AS duration_days,
    (now() AT TIME ZONE 'utc'::text)::date AS computed_on_utc,
    a.image_url,
    GREATEST(0, COALESCE(
        CASE WHEN a.status = 'active'::text THEN (now() AT TIME ZONE 'utc'::text)::date
             ELSE a.end_date END,
        (now() AT TIME ZONE 'utc'::text)::date) - a.creation_date) AS active_days,
    CASE WHEN a.status = 'active'::text THEN 0
         ELSE GREATEST(0, (now() AT TIME ZONE 'utc'::text)::date - COALESCE(a.end_date, (now() AT TIME ZONE 'utc'::text)::date))
    END AS inactive_days,
    a.source_ad_id,
    a.source_url,
    a.source_platform,
    a.last_seen_at,
    a.product_id,
    p.canonical_name AS canonical_product_name,
    p.code AS product_code,
    a.product_description
   FROM public.ads a
   LEFT JOIN public.products p ON p.id = a.product_id;