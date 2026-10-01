-- 1) تنظيف النظام القديم من حسابات الذكاء الاصطناعي
DROP FUNCTION IF EXISTS public.consume_ai_tokens(uuid, integer);
DROP FUNCTION IF EXISTS public.consume_ai_tokens(uuid, bigint);
DROP FUNCTION IF EXISTS public.activate_trial_plan();
DROP FUNCTION IF EXISTS public.activate_trial_plan(uuid);
DROP FUNCTION IF EXISTS public.ensure_paid_cycle(uuid);

ALTER TABLE public.user_ai_accounts
  DROP COLUMN IF EXISTS plan,
  DROP COLUMN IF EXISTS subscription_status,
  DROP COLUMN IF EXISTS granted_tokens,
  DROP COLUMN IF EXISTS consumed_tokens,
  DROP COLUMN IF EXISTS trial_activated_at,
  DROP COLUMN IF EXISTS cycle_started_at,
  DROP COLUMN IF EXISTS cycle_ends_at,
  DROP COLUMN IF EXISTS encrypted_api_key,
  DROP COLUMN IF EXISTS api_key_iv,
  DROP COLUMN IF EXISTS api_key_updated_at;

-- 2) رصيد التجربة الداخلي: 20,000 وحدة مرة واحدة لكل حساب (صف واحد لكل مستخدم)
ALTER TABLE public.user_ai_accounts
  ADD COLUMN IF NOT EXISTS trial_tokens_remaining integer NOT NULL DEFAULT 20000;

ALTER TABLE public.user_ai_accounts
  DROP CONSTRAINT IF EXISTS user_ai_accounts_trial_tokens_remaining_check;
ALTER TABLE public.user_ai_accounts
  ADD CONSTRAINT user_ai_accounts_trial_tokens_remaining_check CHECK (trial_tokens_remaining >= 0);

CREATE OR REPLACE FUNCTION public.handle_new_user_ai_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.user_ai_accounts (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_trial_tokens(_owner_id uuid, _tokens integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE remaining integer;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE public.user_ai_accounts
     SET trial_tokens_remaining = GREATEST(0, trial_tokens_remaining - GREATEST(0, COALESCE(_tokens, 0)))
   WHERE user_id = _owner_id
  RETURNING trial_tokens_remaining INTO remaining;
  IF remaining IS NULL THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND'; END IF;
  RETURN remaining;
END;
$$;

-- 3) مصدر التنفيذ في سجل الاستخدام: رصيد التجربة أو الرصيد المالي فقط
UPDATE public.ai_usage_events SET source = 'kashaf_tokens' WHERE source = 'user_api_key';
ALTER TABLE public.ai_usage_events DROP CONSTRAINT IF EXISTS ai_usage_events_source_check;
ALTER TABLE public.ai_usage_events
  ADD CONSTRAINT ai_usage_events_source_check CHECK (source = ANY (ARRAY['kashaf_tokens'::text, 'trial_tokens'::text]));

-- 4) منع بقاء المبالغ المحجوزة عالقة للأبد
ALTER TABLE public.ai_balance_holds
  ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '15 minutes');

CREATE INDEX IF NOT EXISTS ai_balance_holds_open_idx
  ON public.ai_balance_holds (status, expires_at);

CREATE OR REPLACE FUNCTION public.release_stale_ai_holds(_owner_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE h record; released integer := 0;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  FOR h IN
    SELECT id, owner_id, amount_egp
      FROM public.ai_balance_holds
     WHERE status = 'held'
       AND expires_at < now()
       AND (_owner_id IS NULL OR owner_id = _owner_id)
     ORDER BY created_at
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.user_ai_accounts
       SET held_egp = GREATEST(0, held_egp - h.amount_egp)
     WHERE user_id = h.owner_id;
    UPDATE public.ai_balance_holds
       SET status = 'released', closed_at = now()
     WHERE id = h.id AND status = 'held';
    released := released + 1;
  END LOOP;
  RETURN released;
END;
$$;

-- تحرير أي حجز عالق قبل إنشاء حجز جديد لنفس المستخدم
CREATE OR REPLACE FUNCTION public.hold_ai_balance(_owner_id uuid, _amount numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE acc public.user_ai_accounts; hold_id uuid; amt numeric := GREATEST(0, COALESCE(_amount,0));
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
  PERFORM public.release_stale_ai_holds(_owner_id);
  SELECT * INTO acc FROM public.user_ai_accounts WHERE user_id = _owner_id FOR UPDATE;
  IF acc IS NULL THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND'; END IF;
  IF (acc.balance_egp - acc.held_egp) < amt THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  UPDATE public.user_ai_accounts SET held_egp = held_egp + amt WHERE user_id = _owner_id;
  INSERT INTO public.ai_balance_holds(owner_id, amount_egp) VALUES (_owner_id, amt) RETURNING id INTO hold_id;
  RETURN hold_id;
END;
$$;
