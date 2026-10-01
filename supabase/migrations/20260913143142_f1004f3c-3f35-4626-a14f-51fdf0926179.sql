ALTER TABLE public.ai_usage_events
  ADD COLUMN IF NOT EXISTS operation text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS remaining_after bigint;

ALTER TABLE public.ai_usage_events
  ADD CONSTRAINT ai_usage_events_status_check CHECK (status IN ('success','failed'));

DROP FUNCTION IF EXISTS public.consume_ai_tokens(uuid, bigint);

CREATE OR REPLACE FUNCTION public.consume_ai_tokens(_owner_id uuid, _tokens bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  remaining bigint;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.user_ai_accounts
     SET consumed_tokens = LEAST(granted_tokens, consumed_tokens + GREATEST(0, _tokens))
   WHERE user_id = _owner_id
  RETURNING GREATEST(0, granted_tokens - consumed_tokens) INTO remaining;

  RETURN COALESCE(remaining, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_tokens(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_ai_tokens(uuid, bigint) TO service_role;