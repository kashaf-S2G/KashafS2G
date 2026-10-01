-- Server-side variant: takes the verified user id, callable by service_role only.
CREATE OR REPLACE FUNCTION public.claim_legacy_records_for(_uid uuid)
RETURNS TABLE(claimed_pages integer, claimed_ads integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  first_uid uuid;
  p integer := 0;
  a integer := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required to claim legacy records';
  END IF;

  SELECT u.id INTO first_uid FROM auth.users u ORDER BY u.created_at ASC LIMIT 1;

  IF first_uid IS NULL OR _uid <> first_uid THEN
    RAISE EXCEPTION 'Forbidden: only the primary (first registered) account may claim legacy records';
  END IF;

  UPDATE public.pages SET owner_id = _uid WHERE owner_id IS NULL;
  GET DIAGNOSTICS p = ROW_COUNT;

  UPDATE public.ads SET owner_id = _uid WHERE owner_id IS NULL;
  GET DIAGNOSTICS a = ROW_COUNT;

  IF p > 0 OR a > 0 THEN
    INSERT INTO public.pc_changes (
      action_type, affected_component, description, reason,
      previous_state, new_state, status, author
    ) VALUES (
      'schema_update', 'pages+ads/owner_id',
      'تبنّي السجلات القديمة: ' || p || ' صفحة و' || a || ' إعلان',
      'صفوف يتيمة بلا مالك تم إسنادها للحساب الأساسي',
      'owner_id IS NULL', 'owner_id = ' || _uid::text,
      'completed', 'system:claim_legacy_records'
    );
  END IF;

  claimed_pages := p;
  claimed_ads := a;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_legacy_records_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_legacy_records_for(uuid) TO service_role;

-- Old browser-callable variant is no longer reachable from the client.
REVOKE ALL ON FUNCTION public.claim_legacy_records() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_legacy_records() TO service_role;