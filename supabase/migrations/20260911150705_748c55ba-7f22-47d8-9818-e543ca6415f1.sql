DROP TABLE IF EXISTS public.pc_component_map CASCADE;
DROP TABLE IF EXISTS public.pc_changes CASCADE;
DROP TABLE IF EXISTS public.pc_decisions CASCADE;
DROP TABLE IF EXISTS public.pc_issues CASCADE;
DROP TABLE IF EXISTS public.pc_tasks CASCADE;
DROP TABLE IF EXISTS public.pc_phases CASCADE;
DROP TABLE IF EXISTS public.pc_db_snapshot CASCADE;

DROP FUNCTION IF EXISTS public.pc_autolog_decision() CASCADE;
DROP FUNCTION IF EXISTS public.pc_autolog_issue() CASCADE;
DROP FUNCTION IF EXISTS public.pc_autolog_phase() CASCADE;
DROP FUNCTION IF EXISTS public.pc_autolog_task() CASCADE;
DROP FUNCTION IF EXISTS public.pc_validate_issue() CASCADE;
DROP FUNCTION IF EXISTS public.pc_validate_phase() CASCADE;
DROP FUNCTION IF EXISTS public.pc_validate_task() CASCADE;
DROP FUNCTION IF EXISTS public.pc_resolve_component(text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.pc_log_external_change(text, text, text, text, text, text, text, text, text, text, timestamptz) CASCADE;
DROP FUNCTION IF EXISTS public.pc_scan_supabase_changes(boolean) CASCADE;

DROP SEQUENCE IF EXISTS public.pc_change_ref_seq CASCADE;
DROP TYPE IF EXISTS public.pc_status CASCADE;

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

  claimed_pages := p;
  claimed_ads := a;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_legacy_records()
 RETURNS TABLE(claimed_pages integer, claimed_ads integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
BEGIN
  RETURN QUERY SELECT * FROM public.claim_legacy_records_for(uid);
END;
$function$;

-- تبقى دالة pc_touch_updated_at لأنها مستخدمة في جداول الصفحات والإعلانات
