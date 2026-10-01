CREATE OR REPLACE FUNCTION public.get_dashboard_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH a AS (SELECT * FROM public.ads_with_duration),
  longest AS (
    SELECT a.id, a.product_name, a.creation_date, a.status, a.duration_days,
           c.competitor_name
    FROM a LEFT JOIN public.competitors c ON c.id = a.competitor_id
    ORDER BY a.duration_days DESC, a.created_at DESC, a.id ASC
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'competitorsCount', (SELECT count(*) FROM public.competitors),
    'totalAds', (SELECT count(*) FROM a),
    'activeAds', (SELECT count(*) FROM a WHERE a.status = 'active'),
    'averageDuration', COALESCE((SELECT round(sum(a.duration_days)::numeric / NULLIF(count(*),0)) FROM a), 0),
    'longestRunningAds', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.duration_days DESC) FROM longest l), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.get_dashboard_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary() TO authenticated, service_role;