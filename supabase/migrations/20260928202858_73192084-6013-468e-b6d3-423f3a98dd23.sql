REVOKE ALL ON public.pb_statements, public.ad_statements FROM anon, authenticated;
GRANT SELECT ON public.pb_statements, public.ad_statements TO authenticated;