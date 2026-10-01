-- 1) رصيد مالي على الحساب
ALTER TABLE public.user_ai_accounts
  ADD COLUMN IF NOT EXISTS balance_egp numeric(14,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS held_egp numeric(14,6) NOT NULL DEFAULT 0;

-- 2) إعدادات التسعير (سجل واحد)
CREATE TABLE IF NOT EXISTS public.ai_pricing_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  margin_percent numeric(6,2) NOT NULL DEFAULT 100,
  usd_to_egp numeric(10,4) NOT NULL DEFAULT 50,
  min_deposit_egp numeric(10,2) NOT NULL DEFAULT 200,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_pricing_settings TO authenticated;
GRANT ALL ON public.ai_pricing_settings TO service_role;
ALTER TABLE public.ai_pricing_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_pricing_settings_select ON public.ai_pricing_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY ai_pricing_settings_admin_update ON public.ai_pricing_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER ai_pricing_settings_touch BEFORE UPDATE ON public.ai_pricing_settings
  FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();
INSERT INTO public.ai_pricing_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 3) المزوّدون
CREATE TABLE IF NOT EXISTS public.ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  supports_cost_api boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_providers TO authenticated;
GRANT ALL ON public.ai_providers TO service_role;
ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_providers_select ON public.ai_providers FOR SELECT TO authenticated USING (true);
CREATE TRIGGER ai_providers_touch BEFORE UPDATE ON public.ai_providers
  FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

-- 4) النماذج
CREATE TABLE IF NOT EXISTS public.ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.ai_providers(id) ON DELETE CASCADE,
  model_code text NOT NULL,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, model_code)
);
GRANT SELECT ON public.ai_models TO authenticated;
GRANT ALL ON public.ai_models TO service_role;
ALTER TABLE public.ai_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_models_select ON public.ai_models FOR SELECT TO authenticated USING (true);
CREATE TRIGGER ai_models_touch BEFORE UPDATE ON public.ai_models
  FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

-- 5) أسعار النماذج بتاريخ صلاحية
CREATE TABLE IF NOT EXISTS public.ai_model_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL REFERENCES public.ai_models(id) ON DELETE CASCADE,
  cost_input_usd_per_million numeric(14,6) NOT NULL DEFAULT 0,
  cost_output_usd_per_million numeric(14,6) NOT NULL DEFAULT 0,
  margin_percent numeric(6,2) NOT NULL DEFAULT 100,
  usd_to_egp numeric(10,4) NOT NULL DEFAULT 50,
  sell_input_egp_per_million numeric(14,6) NOT NULL DEFAULT 0,
  sell_output_egp_per_million numeric(14,6) NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_model_prices_current_idx
  ON public.ai_model_prices (model_id) WHERE effective_to IS NULL;
GRANT SELECT ON public.ai_model_prices TO authenticated;
GRANT ALL ON public.ai_model_prices TO service_role;
ALTER TABLE public.ai_model_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_model_prices_select ON public.ai_model_prices FOR SELECT TO authenticated USING (true);

-- 6) سجل مزامنة أسعار المزوّدين (محاسبة كشاف مع المزوّد)
CREATE TABLE IF NOT EXISTS public.ai_provider_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code text NOT NULL,
  status text NOT NULL,
  models_updated integer NOT NULL DEFAULT 0,
  message text,
  provider_cost_usd numeric(14,6),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_provider_sync_runs TO authenticated;
GRANT ALL ON public.ai_provider_sync_runs TO service_role;
ALTER TABLE public.ai_provider_sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_provider_sync_runs_admin_select ON public.ai_provider_sync_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 7) السجل المالي
CREATE TABLE IF NOT EXISTS public.wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('deposit','ai_charge','admin_adjust','refund')),
  amount_egp numeric(14,6) NOT NULL,
  balance_after_egp numeric(14,6) NOT NULL,
  ref_type text,
  ref_id uuid,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_ledger_owner_idx ON public.wallet_ledger (owner_id, created_at DESC);
GRANT SELECT ON public.wallet_ledger TO authenticated;
GRANT ALL ON public.wallet_ledger TO service_role;
ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_ledger_select_own ON public.wallet_ledger FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- 8) حجوزات الرصيد (خادم فقط)
CREATE TABLE IF NOT EXISTS public.ai_balance_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  amount_egp numeric(14,6) NOT NULL,
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held','settled','released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_balance_holds_owner_idx ON public.ai_balance_holds (owner_id, status);
GRANT ALL ON public.ai_balance_holds TO service_role;
ALTER TABLE public.ai_balance_holds ENABLE ROW LEVEL SECURITY;

-- 9) أعمدة التسعير في سجل الاستخدام
ALTER TABLE public.ai_usage_events
  ADD COLUMN IF NOT EXISTS provider_code text,
  ADD COLUMN IF NOT EXISTS model_price_id uuid,
  ADD COLUMN IF NOT EXISTS sell_input_egp_per_million numeric(14,6),
  ADD COLUMN IF NOT EXISTS sell_output_egp_per_million numeric(14,6),
  ADD COLUMN IF NOT EXISTS provider_cost_usd numeric(14,8),
  ADD COLUMN IF NOT EXISTS charged_egp numeric(14,6),
  ADD COLUMN IF NOT EXISTS balance_after_egp numeric(14,6);

-- 10) دوال الرصيد
CREATE OR REPLACE FUNCTION public.hold_ai_balance(_owner_id uuid, _amount numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE acc public.user_ai_accounts; hold_id uuid; amt numeric := GREATEST(0, COALESCE(_amount,0));
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO acc FROM public.user_ai_accounts WHERE user_id = _owner_id FOR UPDATE;
  IF acc IS NULL THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND'; END IF;
  IF (acc.balance_egp - acc.held_egp) < amt THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  UPDATE public.user_ai_accounts SET held_egp = held_egp + amt WHERE user_id = _owner_id;
  INSERT INTO public.ai_balance_holds(owner_id, amount_egp) VALUES (_owner_id, amt) RETURNING id INTO hold_id;
  RETURN hold_id;
END; $$;

CREATE OR REPLACE FUNCTION public.settle_ai_hold(_hold_id uuid, _actual numeric, _usage_id uuid DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE h public.ai_balance_holds; acc public.user_ai_accounts; charge numeric; new_balance numeric;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO h FROM public.ai_balance_holds WHERE id = _hold_id FOR UPDATE;
  IF h IS NULL OR h.status <> 'held' THEN RAISE EXCEPTION 'HOLD_NOT_OPEN'; END IF;
  SELECT * INTO acc FROM public.user_ai_accounts WHERE user_id = h.owner_id FOR UPDATE;
  charge := LEAST(GREATEST(0, COALESCE(_actual,0)), acc.balance_egp);
  UPDATE public.user_ai_accounts
     SET held_egp = GREATEST(0, held_egp - h.amount_egp),
         balance_egp = balance_egp - charge
   WHERE user_id = h.owner_id
  RETURNING balance_egp INTO new_balance;
  UPDATE public.ai_balance_holds SET status = 'settled', closed_at = now() WHERE id = _hold_id;
  IF charge > 0 THEN
    INSERT INTO public.wallet_ledger(owner_id, kind, amount_egp, balance_after_egp, ref_type, ref_id, note)
    VALUES (h.owner_id, 'ai_charge', -charge, new_balance, 'ai_usage_event', _usage_id, 'خصم تكلفة عملية ذكاء اصطناعي');
  END IF;
  RETURN new_balance;
END; $$;

CREATE OR REPLACE FUNCTION public.release_ai_hold(_hold_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE h public.ai_balance_holds;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO h FROM public.ai_balance_holds WHERE id = _hold_id FOR UPDATE;
  IF h IS NULL OR h.status <> 'held' THEN RETURN; END IF;
  UPDATE public.user_ai_accounts SET held_egp = GREATEST(0, held_egp - h.amount_egp) WHERE user_id = h.owner_id;
  UPDATE public.ai_balance_holds SET status = 'released', closed_at = now() WHERE id = _hold_id;
END; $$;

CREATE OR REPLACE FUNCTION public.credit_wallet(_owner_id uuid, _amount numeric, _kind text, _note text DEFAULT NULL, _ref_type text DEFAULT NULL, _ref_id uuid DEFAULT NULL, _created_by uuid DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE new_balance numeric;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _kind NOT IN ('deposit','admin_adjust','refund') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;
  PERFORM 1 FROM public.user_ai_accounts WHERE user_id = _owner_id FOR UPDATE;
  UPDATE public.user_ai_accounts SET balance_egp = balance_egp + _amount WHERE user_id = _owner_id
  RETURNING balance_egp INTO new_balance;
  IF new_balance IS NULL THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND'; END IF;
  IF new_balance < 0 THEN RAISE EXCEPTION 'NEGATIVE_BALANCE'; END IF;
  INSERT INTO public.wallet_ledger(owner_id, kind, amount_egp, balance_after_egp, ref_type, ref_id, note, created_by)
  VALUES (_owner_id, _kind, _amount, new_balance, _ref_type, _ref_id, _note, COALESCE(_created_by, auth.uid()));
  RETURN new_balance;
END; $$;

-- 11) قبول الدفع يضيف رصيدًا ماليًا
CREATE OR REPLACE FUNCTION public.approve_payment_request(_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); req public.payment_requests;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE public.payment_requests
     SET status = 'approved', reviewed_by = uid, reviewed_at = now()
   WHERE id = _request_id AND status = 'pending'
  RETURNING * INTO req;
  IF req IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_PENDING'; END IF;
  PERFORM public.credit_wallet(req.owner_id, req.amount, 'deposit', 'إيداع رصيد بعد مراجعة تحويل مالي', 'payment_request', req.id, uid);
END; $$;

-- 12) سياسة طلبات الدفع: مبلغ حر بحد أدنى 200
DROP POLICY IF EXISTS payment_requests_insert_own ON public.payment_requests;
CREATE POLICY payment_requests_insert_own ON public.payment_requests FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = owner_id AND status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL
    AND amount >= 200 AND method = 'vodafone_cash'
  );

-- 13) إزالة منطق الخطط الشهرية
DROP FUNCTION IF EXISTS public.activate_trial_plan();
DROP FUNCTION IF EXISTS public.ensure_paid_cycle(uuid);
DROP FUNCTION IF EXISTS public.consume_ai_tokens(uuid, bigint);

-- 14) بيانات المزوّدين والنموذج الافتراضي
INSERT INTO public.ai_providers (code, name, is_active, supports_cost_api) VALUES
  ('openai','OpenAI', true, true),
  ('anthropic','Anthropic', false, false),
  ('google','Google Gemini', false, false),
  ('deepseek','DeepSeek', false, false),
  ('xai','xAI', false, false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ai_models (provider_id, model_code, display_name, is_active, is_default)
SELECT p.id, 'gpt-5-nano', 'GPT-5 nano', true, true FROM public.ai_providers p WHERE p.code = 'openai'
ON CONFLICT (provider_id, model_code) DO NOTHING;

INSERT INTO public.ai_model_prices (
  model_id, cost_input_usd_per_million, cost_output_usd_per_million,
  margin_percent, usd_to_egp, sell_input_egp_per_million, sell_output_egp_per_million, source)
SELECT m.id, 0.05, 0.40, 100, 50, 0.05*50*2, 0.40*50*2, 'manual'
FROM public.ai_models m
JOIN public.ai_providers p ON p.id = m.provider_id
WHERE p.code = 'openai' AND m.model_code = 'gpt-5-nano'
  AND NOT EXISTS (SELECT 1 FROM public.ai_model_prices x WHERE x.model_id = m.id AND x.effective_to IS NULL);