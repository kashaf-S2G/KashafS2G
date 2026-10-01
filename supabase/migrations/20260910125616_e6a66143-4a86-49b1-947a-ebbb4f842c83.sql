-- 1) Remove broad orphan-claim policies (any authenticated user could take unowned rows)
DROP POLICY IF EXISTS pages_claim_orphans ON public.pages;
DROP POLICY IF EXISTS ads_claim_orphans ON public.ads;

-- 2) Restrict legacy claim to the first registered account, via SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.claim_legacy_records()
RETURNS TABLE(claimed_pages integer, claimed_ads integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  first_uid uuid;
  p integer := 0;
  a integer := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required to claim legacy records';
  END IF;

  SELECT u.id INTO first_uid FROM auth.users u ORDER BY u.created_at ASC LIMIT 1;

  IF first_uid IS NULL OR uid <> first_uid THEN
    RAISE EXCEPTION 'Forbidden: only the primary (first registered) account may claim legacy records';
  END IF;

  UPDATE public.pages SET owner_id = uid WHERE owner_id IS NULL;
  GET DIAGNOSTICS p = ROW_COUNT;

  UPDATE public.ads SET owner_id = uid WHERE owner_id IS NULL;
  GET DIAGNOSTICS a = ROW_COUNT;

  IF p > 0 OR a > 0 THEN
    INSERT INTO public.pc_changes (
      action_type, affected_component, description, reason,
      previous_state, new_state, status, author
    ) VALUES (
      'schema_update', 'pages+ads/owner_id',
      'تبنّي السجلات القديمة: ' || p || ' صفحة و' || a || ' إعلان',
      'صفوف يتيمة بلا مالك تم إسنادها للحساب الأساسي',
      'owner_id IS NULL', 'owner_id = ' || uid::text,
      'completed', 'system:claim_legacy_records'
    );
  END IF;

  claimed_pages := p;
  claimed_ads := a;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_legacy_records() FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_legacy_records() TO authenticated;

-- 3) Continuity automation: issues and decisions log themselves
CREATE OR REPLACE FUNCTION public.pc_validate_issue()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'resolved' THEN
    IF COALESCE(btrim(NEW.resolution), '') = '' THEN
      RAISE EXCEPTION 'pc_issues(%): resolution is required before status=resolved', NEW.title;
    END IF;
    NEW.resolved_at := COALESCE(NEW.resolved_at, now());
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS pc_issues_validate ON public.pc_issues;
CREATE TRIGGER pc_issues_validate
BEFORE INSERT OR UPDATE ON public.pc_issues
FOR EACH ROW EXECUTE FUNCTION public.pc_validate_issue();

CREATE OR REPLACE FUNCTION public.pc_autolog_issue()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.pc_changes (
    phase_id, task_id, action_type, affected_component, description, reason,
    previous_state, new_state, status, author
  ) VALUES (
    NEW.phase_id, NEW.task_id,
    CASE WHEN NEW.status = 'open' THEN 'issue_found' ELSE 'bug_fix' END,
    'pc_issues/' || NEW.title,
    'تحديث تلقائي لحالة المشكلة: ' || NEW.title,
    COALESCE(NULLIF(btrim(NEW.resolution), ''), NEW.description),
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE '' END,
    NEW.status,
    CASE WHEN NEW.status = 'open' THEN 'has_issues'::pc_status ELSE 'completed'::pc_status END,
    'system:autolog'
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS pc_issues_autolog ON public.pc_issues;
CREATE TRIGGER pc_issues_autolog
AFTER INSERT OR UPDATE ON public.pc_issues
FOR EACH ROW EXECUTE FUNCTION public.pc_autolog_issue();

CREATE OR REPLACE FUNCTION public.pc_autolog_decision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.pc_changes (
    phase_id, action_type, affected_component, description, reason,
    previous_state, new_state, status, author
  ) VALUES (
    NEW.phase_id, 'decision', 'pc_decisions/' || NEW.title,
    NEW.decision, COALESCE(NULLIF(btrim(NEW.context), ''), 'قرار معماري'),
    COALESCE(NULLIF(btrim(NEW.alternatives), ''), ''),
    COALESCE(NULLIF(btrim(NEW.consequences), ''), ''),
    'completed', 'system:autolog'
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS pc_decisions_autolog ON public.pc_decisions;
CREATE TRIGGER pc_decisions_autolog
AFTER INSERT ON public.pc_decisions
FOR EACH ROW EXECUTE FUNCTION public.pc_autolog_decision();