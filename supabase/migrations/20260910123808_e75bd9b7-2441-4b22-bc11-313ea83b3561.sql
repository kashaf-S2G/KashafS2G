CREATE POLICY pages_claim_orphans ON public.pages
FOR UPDATE TO authenticated
USING (owner_id IS NULL)
WITH CHECK (owner_id = auth.uid());

CREATE POLICY ads_claim_orphans ON public.ads
FOR UPDATE TO authenticated
USING (owner_id IS NULL)
WITH CHECK (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.claim_legacy_records()
RETURNS TABLE(claimed_pages integer, claimed_ads integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  p integer := 0;
  a integer := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required to claim legacy records';
  END IF;

  UPDATE public.pages SET owner_id = uid WHERE owner_id IS NULL;
  GET DIAGNOSTICS p = ROW_COUNT;

  UPDATE public.ads SET owner_id = uid WHERE owner_id IS NULL;
  GET DIAGNOSTICS a = ROW_COUNT;

  claimed_pages := p;
  claimed_ads := a;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_legacy_records() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_legacy_records() FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_legacy_records() TO authenticated;