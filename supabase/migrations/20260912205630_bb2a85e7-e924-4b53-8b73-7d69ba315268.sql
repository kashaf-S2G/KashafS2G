
CREATE OR REPLACE FUNCTION public.acquire_pcrawl_run(_owner_id uuid, _trigger_type text, _scope text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _id uuid;
BEGIN
  IF NOT (auth.role() = 'service_role' OR auth.uid() = _owner_id) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.pcrawl_runs
     SET status = 'done', finished_at = now()
   WHERE owner_id = _owner_id
     AND status = 'running'
     AND lease_expires_at IS NOT NULL
     AND lease_expires_at < now();

  IF EXISTS (SELECT 1 FROM public.pcrawl_runs WHERE owner_id = _owner_id AND status = 'running') THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.pcrawl_runs (owner_id, status, trigger_type, scope, lease_expires_at)
  VALUES (_owner_id, 'running', _trigger_type, _scope, now() + interval '10 minutes')
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.acquire_pcrawl_run(uuid, text, text) FROM anon;
