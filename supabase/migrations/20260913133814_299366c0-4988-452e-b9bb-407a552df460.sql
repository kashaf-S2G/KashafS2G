CREATE TABLE public.user_ai_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'paid')),
  subscription_status text,
  granted_tokens bigint NOT NULL DEFAULT 0 CHECK (granted_tokens >= 0),
  consumed_tokens bigint NOT NULL DEFAULT 0 CHECK (consumed_tokens >= 0),
  encrypted_api_key text,
  api_key_iv text,
  api_key_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.user_ai_accounts TO authenticated;
GRANT ALL ON public.user_ai_accounts TO service_role;

ALTER TABLE public.user_ai_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_ai_accounts_select_own"
ON public.user_ai_accounts
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_user_ai_account_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_ai_accounts_touch_updated_at
BEFORE UPDATE ON public.user_ai_accounts
FOR EACH ROW EXECUTE FUNCTION public.touch_user_ai_account_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user_ai_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_ai_accounts (user_id, plan, granted_tokens, consumed_tokens)
  VALUES (NEW.id, 'free', 0, 0)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_ai_account
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_ai_account();

INSERT INTO public.user_ai_accounts (user_id, plan, granted_tokens, consumed_tokens)
SELECT id, 'free', 0, 0
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;