REVOKE EXECUTE ON FUNCTION public.enqueue_raw_ad_analyses(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_raw_ad_analyses(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_raw_ad_analyses(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_raw_ad_analyses(integer, integer) TO service_role;