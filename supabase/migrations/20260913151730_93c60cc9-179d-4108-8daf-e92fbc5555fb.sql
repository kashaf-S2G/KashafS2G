REVOKE SELECT ON public.user_ai_accounts FROM authenticated;

GRANT SELECT (user_id, plan, subscription_status, granted_tokens, consumed_tokens, api_key_updated_at, created_at, updated_at)
  ON public.user_ai_accounts TO authenticated;

GRANT ALL ON public.user_ai_accounts TO service_role;