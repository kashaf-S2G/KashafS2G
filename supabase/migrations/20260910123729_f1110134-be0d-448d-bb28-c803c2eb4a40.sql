-- 1) Legacy ownership adoption -------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_legacy_records()
RETURNS TABLE(claimed_pages integer, claimed_ads integer)
LANGUAGE plpgsql
SECURITY DEFINER
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

-- 2) Re-assert hardened access on pages/ads ------------------------------------
REVOKE ALL ON public.pages FROM anon;
REVOKE ALL ON public.ads FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ads TO authenticated;
GRANT ALL ON public.pages TO service_role;
GRANT ALL ON public.ads TO service_role;
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

-- 3) Server-side (UTC) ad duration ---------------------------------------------
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
  (now() AT TIME ZONE 'utc')::date AS computed_on_utc
FROM public.ads a;

REVOKE ALL ON public.ads_with_duration FROM anon;
GRANT SELECT ON public.ads_with_duration TO authenticated;
GRANT ALL ON public.ads_with_duration TO service_role;

-- 4) Continuity archive automation ---------------------------------------------
CREATE OR REPLACE FUNCTION public.pc_validate_task()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND COALESCE(btrim(NEW.verification_notes), '') = '' THEN
    RAISE EXCEPTION 'pc_tasks(%): verification_notes is required before status=completed', NEW.task_key;
  END IF;
  IF NEW.status = 'has_issues' AND COALESCE(btrim(NEW.blocked_reason), '') = '' THEN
    RAISE EXCEPTION 'pc_tasks(%): blocked_reason is required when status=has_issues', NEW.task_key;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.pc_validate_phase()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    IF COALESCE(btrim(NEW.done_summary), '') = '' OR COALESCE(btrim(NEW.last_known_state), '') = '' THEN
      RAISE EXCEPTION 'pc_phases(%): done_summary and last_known_state are required before status=completed', NEW.phase_key;
    END IF;
    IF EXISTS (SELECT 1 FROM public.pc_tasks t WHERE t.phase_id = NEW.id AND t.status <> 'completed') THEN
      RAISE EXCEPTION 'pc_phases(%): every task must be completed first', NEW.phase_key;
    END IF;
    IF EXISTS (SELECT 1 FROM public.pc_issues i WHERE i.phase_id = NEW.id AND i.status = 'open') THEN
      RAISE EXCEPTION 'pc_phases(%): open issues must be resolved first', NEW.phase_key;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.pc_autolog_task()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.pc_changes (
    phase_id, task_id, action_type, affected_component, description, reason,
    previous_state, new_state, status, author
  ) VALUES (
    NEW.phase_id,
    NEW.id,
    CASE WHEN NEW.status = 'completed' THEN 'task_completed' ELSE 'task_incomplete' END,
    'pc_tasks/' || NEW.task_key,
    'تحديث تلقائي لحالة المهمة: ' || NEW.title,
    COALESCE(NULLIF(btrim(NEW.verification_notes), ''), COALESCE(NEW.blocked_reason, 'تسجيل تلقائي من قاعدة البيانات')),
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status::text ELSE '' END,
    NEW.status::text,
    NEW.status,
    'system:autolog'
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.pc_autolog_phase()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.pc_changes (
    phase_id, action_type, affected_component, description, reason,
    previous_state, new_state, status, author
  ) VALUES (
    NEW.id,
    'workflow_change',
    'pc_phases/' || NEW.phase_key,
    'تحديث تلقائي لحالة المرحلة: ' || NEW.name,
    COALESCE(NULLIF(btrim(NEW.last_known_state), ''), 'تسجيل تلقائي من قاعدة البيانات'),
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status::text ELSE '' END,
    NEW.status::text,
    NEW.status,
    'system:autolog'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pc_tasks_validate ON public.pc_tasks;
CREATE TRIGGER pc_tasks_validate BEFORE INSERT OR UPDATE ON public.pc_tasks
FOR EACH ROW EXECUTE FUNCTION public.pc_validate_task();

DROP TRIGGER IF EXISTS pc_phases_validate ON public.pc_phases;
CREATE TRIGGER pc_phases_validate BEFORE INSERT OR UPDATE ON public.pc_phases
FOR EACH ROW EXECUTE FUNCTION public.pc_validate_phase();

DROP TRIGGER IF EXISTS pc_tasks_autolog ON public.pc_tasks;
CREATE TRIGGER pc_tasks_autolog AFTER INSERT OR UPDATE ON public.pc_tasks
FOR EACH ROW EXECUTE FUNCTION public.pc_autolog_task();

DROP TRIGGER IF EXISTS pc_phases_autolog ON public.pc_phases;
CREATE TRIGGER pc_phases_autolog AFTER INSERT OR UPDATE ON public.pc_phases
FOR EACH ROW EXECUTE FUNCTION public.pc_autolog_phase();