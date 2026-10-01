REVOKE ALL ON FUNCTION public.claim_legacy_records() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_legacy_records() FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_legacy_records() TO authenticated;