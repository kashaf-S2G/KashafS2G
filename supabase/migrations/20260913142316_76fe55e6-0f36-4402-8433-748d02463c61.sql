CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('kashaf_tokens','user_api_key')),
  model text NOT NULL DEFAULT '',
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ai_usage_events TO authenticated;
GRANT ALL ON public.ai_usage_events TO service_role;

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_usage_events_select_own" ON public.ai_usage_events;
CREATE POLICY "ai_usage_events_select_own" ON public.ai_usage_events
  FOR SELECT TO authenticated USING (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS ai_usage_events_owner_created_idx
  ON public.ai_usage_events (owner_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.consume_ai_tokens(_owner_id uuid, _tokens bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _remaining bigint;
BEGIN
  IF _tokens IS NULL OR _tokens <= 0 THEN
    SELECT GREATEST(0, granted_tokens - consumed_tokens) INTO _remaining
    FROM public.user_ai_accounts WHERE user_id = _owner_id;
    RETURN COALESCE(_remaining, 0);
  END IF;

  UPDATE public.user_ai_accounts
  SET consumed_tokens = LEAST(granted_tokens, consumed_tokens + _tokens),
      updated_at = now()
  WHERE user_id = _owner_id
  RETURNING GREATEST(0, granted_tokens - consumed_tokens) INTO _remaining;

  RETURN COALESCE(_remaining, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_tokens(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_ai_tokens(uuid, bigint) TO service_role;