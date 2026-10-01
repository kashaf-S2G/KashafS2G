-- Update ads_with_duration view to expose active_days and inactive_days at the end
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
  GREATEST(
    0,
    (
      COALESCE(
        CASE WHEN a.status = 'active' THEN (now() AT TIME ZONE 'utc')::date ELSE a.end_date END,
        (now() AT TIME ZONE 'utc')::date
      ) - a.creation_date
    )
  )::integer AS duration_days,
  (now() AT TIME ZONE 'utc')::date AS computed_on_utc,
  a.image_url,
  GREATEST(
    0,
    (
      COALESCE(
        CASE WHEN a.status = 'active' THEN (now() AT TIME ZONE 'utc')::date ELSE a.end_date END,
        (now() AT TIME ZONE 'utc')::date
      ) - a.creation_date
    )
  )::integer AS active_days,
  CASE
    WHEN a.status = 'active' THEN 0
    ELSE GREATEST(
      0,
      (now() AT TIME ZONE 'utc')::date - COALESCE(a.end_date, (now() AT TIME ZONE 'utc')::date)
    )
  END::integer AS inactive_days
FROM public.ads a;

-- Re-assert grants after replacing the view
REVOKE ALL ON public.ads_with_duration FROM anon;
GRANT SELECT ON public.ads_with_duration TO authenticated;
GRANT ALL ON public.ads_with_duration TO service_role;