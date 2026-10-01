-- 1) Add image_url column to ads
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS image_url text;

-- 2) Update the ads_with_duration view to expose image_url at the end
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
  a.image_url
FROM public.ads a;

-- Re-assert grants after replacing the view
REVOKE ALL ON public.ads_with_duration FROM anon;
GRANT SELECT ON public.ads_with_duration TO authenticated;
GRANT ALL ON public.ads_with_duration TO service_role;

-- 3) Storage access policies: users can only manage images inside their own folder
DROP POLICY IF EXISTS "Users can upload own ad images" ON storage.objects;
DROP POLICY IF EXISTS "Users can read own ad images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own ad images" ON storage.objects;

CREATE POLICY "Users can upload own ad images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'ad-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can read own ad images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'ad-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete own ad images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'ad-images' AND (storage.foldername(name))[1] = auth.uid()::text);