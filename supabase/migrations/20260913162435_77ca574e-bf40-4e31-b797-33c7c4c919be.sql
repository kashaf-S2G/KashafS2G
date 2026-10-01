-- 1) الأدوار
CREATE TYPE public.app_role AS ENUM ('user', 'admin');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "user_roles_select_own" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "user_roles_admin_select_all" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 2) حقول دورة الاشتراك على حساب الذكاء الاصطناعي الحالي
ALTER TABLE public.user_ai_accounts
  ADD COLUMN IF NOT EXISTS trial_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS cycle_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS cycle_ends_at timestamptz;

-- 3) طلبات الدفع
CREATE TABLE public.payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  amount numeric NOT NULL DEFAULT 500,
  method text NOT NULL DEFAULT 'vodafone_cash',
  proof_path text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE UNIQUE INDEX payment_requests_one_pending
  ON public.payment_requests (owner_id) WHERE status = 'pending';
CREATE INDEX payment_requests_status_idx ON public.payment_requests (status, created_at DESC);

GRANT SELECT, INSERT ON public.payment_requests TO authenticated;
GRANT ALL ON public.payment_requests TO service_role;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_requests_select_own" ON public.payment_requests
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);

CREATE POLICY "payment_requests_admin_select_all" ON public.payment_requests
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- المستخدم ينشئ طلبه فقط وبحالة قيد المراجعة فقط، ولا يملك أي صلاحية تعديل أو حذف
CREATE POLICY "payment_requests_insert_own" ON public.payment_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = owner_id
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND amount = 500
    AND method = 'vodafone_cash'
  );

CREATE TRIGGER payment_requests_touch
  BEFORE UPDATE ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();

-- 4) تفعيل خطة التجربة (مرة واحدة فقط)
CREATE OR REPLACE FUNCTION public.activate_trial_plan()
RETURNS public.user_ai_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  acc public.user_ai_accounts;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO acc FROM public.user_ai_accounts WHERE user_id = uid FOR UPDATE;
  IF acc IS NULL THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND'; END IF;

  IF acc.plan = 'paid' THEN
    RAISE EXCEPTION 'ALREADY_PAID';
  END IF;

  IF acc.trial_activated_at IS NOT NULL THEN
    RETURN acc; -- التفعيل تم مسبقًا: لا يُمنح رصيد إضافي مهما تكرر الضغط
  END IF;

  UPDATE public.user_ai_accounts
     SET plan = 'free',
         subscription_status = 'trial',
         granted_tokens = 20000,
         consumed_tokens = 0,
         trial_activated_at = now(),
         cycle_started_at = now(),
         cycle_ends_at = NULL
   WHERE user_id = uid
  RETURNING * INTO acc;

  RETURN acc;
END;
$$;

-- 5) التجديد الشهري: استبدال الرصيد بالكامل بدون ترحيل
CREATE OR REPLACE FUNCTION public.ensure_paid_cycle(_owner_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acc public.user_ai_accounts;
BEGIN
  IF NOT (auth.role() = 'service_role' OR auth.uid() = _owner_id) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO acc FROM public.user_ai_accounts WHERE user_id = _owner_id FOR UPDATE;
  IF acc IS NULL OR acc.plan <> 'paid' OR acc.cycle_ends_at IS NULL THEN
    RETURN;
  END IF;

  IF acc.cycle_ends_at > now() THEN
    RETURN;
  END IF;

  UPDATE public.user_ai_accounts
     SET granted_tokens = 200000,
         consumed_tokens = 0,
         cycle_started_at = acc.cycle_ends_at,
         cycle_ends_at = acc.cycle_ends_at + interval '1 month'
   WHERE user_id = _owner_id;

  -- إذا مرّت أكثر من دورة، اقفز إلى الدورة الحالية
  UPDATE public.user_ai_accounts
     SET cycle_started_at = c.started,
         cycle_ends_at = c.started + interval '1 month'
    FROM (
      SELECT (SELECT cycle_started_at FROM public.user_ai_accounts WHERE user_id = _owner_id) AS started
    ) c
   WHERE user_id = _owner_id
     AND c.started + interval '1 month' <= now();
END;
$$;

-- 6) قبول ورفض طلب الدفع (أدمن فقط، ومرة واحدة لكل طلب)
CREATE OR REPLACE FUNCTION public.approve_payment_request(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  req public.payment_requests;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- الشرط status = 'pending' يمنع اعتماد نفس الطلب مرتين
  UPDATE public.payment_requests
     SET status = 'approved', reviewed_by = uid, reviewed_at = now()
   WHERE id = _request_id AND status = 'pending'
  RETURNING * INTO req;

  IF req IS NULL THEN
    RAISE EXCEPTION 'REQUEST_NOT_PENDING';
  END IF;

  UPDATE public.user_ai_accounts
     SET plan = 'paid',
         subscription_status = 'active',
         granted_tokens = 200000,
         consumed_tokens = 0,
         cycle_started_at = now(),
         cycle_ends_at = now() + interval '1 month'
   WHERE user_id = req.owner_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_payment_request(_request_id uuid, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  req public.payment_requests;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.payment_requests
     SET status = 'rejected', reviewed_by = uid, reviewed_at = now(), note = _note
   WHERE id = _request_id AND status = 'pending'
  RETURNING * INTO req;

  IF req IS NULL THEN
    RAISE EXCEPTION 'REQUEST_NOT_PENDING';
  END IF;
END;
$$;