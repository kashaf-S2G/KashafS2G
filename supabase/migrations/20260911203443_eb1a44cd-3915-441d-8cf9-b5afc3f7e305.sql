CREATE OR REPLACE FUNCTION public.acquire_discovery_run(_owner_id uuid, _trigger_type text DEFAULT 'manual')
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE new_id uuid;
BEGIN
  IF NOT (auth.role() = 'service_role' OR auth.uid() = _owner_id) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.discovery_runs
     SET status = 'failed', finished_at = now(), error = 'انتهت مهلة العملية السابقة.'
   WHERE owner_id = _owner_id AND status = 'running' AND lease_expires_at < now();
  INSERT INTO public.discovery_runs(owner_id, status, trigger_type, lease_expires_at)
  VALUES (_owner_id, 'running', _trigger_type, now() + interval '10 minutes')
  RETURNING id INTO new_id;
  RETURN new_id;
EXCEPTION WHEN unique_violation THEN
  RETURN NULL;
END;
$$;