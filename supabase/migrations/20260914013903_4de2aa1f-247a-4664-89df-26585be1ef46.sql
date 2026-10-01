-- lovable-cron-fallback-reviewed: 24 runs/day; hourly reconciliation backstop only — stale holds are already released event-driven inside hold_ai_balance on every new AI operation, so this job exists solely to guarantee no hold can remain stuck if a user stops using AI entirely.

-- 1) نسخة احتياطية كاملة قبل أي تنظيف (قابلة للاسترجاع بنسخ الصفوف مرة أخرى)
CREATE SCHEMA IF NOT EXISTS backup_20260914;
REVOKE ALL ON SCHEMA backup_20260914 FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS backup_20260914.user_ai_accounts AS SELECT * FROM public.user_ai_accounts;
CREATE TABLE IF NOT EXISTS backup_20260914.ai_usage_events AS SELECT * FROM public.ai_usage_events;
CREATE TABLE IF NOT EXISTS backup_20260914.wallet_ledger AS SELECT * FROM public.wallet_ledger;
CREATE TABLE IF NOT EXISTS backup_20260914.ai_balance_holds AS SELECT * FROM public.ai_balance_holds;
CREATE TABLE IF NOT EXISTS backup_20260914.payment_requests AS SELECT * FROM public.payment_requests;
CREATE TABLE IF NOT EXISTS backup_20260914.ai_providers AS SELECT * FROM public.ai_providers;
CREATE TABLE IF NOT EXISTS backup_20260914.ai_models AS SELECT * FROM public.ai_models;
CREATE TABLE IF NOT EXISTS backup_20260914.ai_model_prices AS SELECT * FROM public.ai_model_prices;

REVOKE ALL ON ALL TABLES IN SCHEMA backup_20260914 FROM anon, authenticated;

-- 2) رصيد التجربة: 20,000 توكن مرة واحدة للحساب الجديد فقط
ALTER TABLE public.user_ai_accounts
  ALTER COLUMN trial_tokens_remaining SET DEFAULT 20000;

-- 3) تحرير الحجوزات المنتهية: يعمل أيضًا من المهمة المجدولة (postgres) وليس service_role فقط
CREATE OR REPLACE FUNCTION public.release_stale_ai_holds(_owner_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE h record; released integer := 0;
BEGIN
  IF NOT (
    auth.role() = 'service_role'
    OR current_user IN ('postgres', 'supabase_admin')
    OR public.has_role(auth.uid(), 'admin')
  ) THEN
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
    UPDATE public.ai_balance_holds
       SET status = 'released', closed_at = now()
     WHERE id = h.id AND status = 'held';

    IF FOUND THEN
      UPDATE public.user_ai_accounts
         SET held_egp = GREATEST(0, held_egp - h.amount_egp)
       WHERE user_id = h.owner_id;
      released := released + 1;
    END IF;
  END LOOP;

  RETURN released;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_stale_ai_holds(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.release_stale_ai_holds(uuid) TO service_role, authenticated;

-- 4) منع التحرير المكرر: التحديث يتم بشرط الحالة داخل نفس العبارة
CREATE OR REPLACE FUNCTION public.release_ai_hold(_hold_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE h public.ai_balance_holds;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT * INTO h FROM public.ai_balance_holds WHERE id = _hold_id FOR UPDATE;
  IF h IS NULL THEN RAISE EXCEPTION 'HOLD_NOT_FOUND'; END IF;
  IF h.status <> 'held' THEN RETURN; END IF;

  UPDATE public.ai_balance_holds SET status = 'released', closed_at = now()
   WHERE id = _hold_id AND status = 'held';

  IF FOUND THEN
    UPDATE public.user_ai_accounts
       SET held_egp = GREATEST(0, held_egp - h.amount_egp)
     WHERE user_id = h.owner_id;
  END IF;
END;
$function$;

-- 5) منع التسوية المكررة بشكل صريح
CREATE OR REPLACE FUNCTION public.settle_ai_hold(_hold_id uuid, _actual numeric, _usage_id uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE h public.ai_balance_holds; acc public.user_ai_accounts; charge numeric; new_balance numeric;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT * INTO h FROM public.ai_balance_holds WHERE id = _hold_id FOR UPDATE;
  IF h IS NULL THEN RAISE EXCEPTION 'HOLD_NOT_FOUND'; END IF;
  IF h.status <> 'held' THEN RAISE EXCEPTION 'HOLD_ALREADY_CLOSED'; END IF;

  SELECT * INTO acc FROM public.user_ai_accounts WHERE user_id = h.owner_id FOR UPDATE;
  IF acc IS NULL THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND'; END IF;

  charge := LEAST(GREATEST(0, COALESCE(_actual, 0)), acc.balance_egp);

  UPDATE public.ai_balance_holds SET status = 'settled', closed_at = now()
   WHERE id = _hold_id AND status = 'held';
  IF NOT FOUND THEN RAISE EXCEPTION 'HOLD_ALREADY_CLOSED'; END IF;

  UPDATE public.user_ai_accounts
     SET held_egp = GREATEST(0, held_egp - h.amount_egp),
         balance_egp = balance_egp - charge
   WHERE user_id = h.owner_id
  RETURNING balance_egp INTO new_balance;

  IF charge > 0 THEN
    INSERT INTO public.wallet_ledger(owner_id, kind, amount_egp, balance_after_egp, ref_type, ref_id, note)
    VALUES (h.owner_id, 'ai_charge', -charge, new_balance, 'ai_usage_event', _usage_id, 'خصم تكلفة عملية ذكاء اصطناعي');
  END IF;

  RETURN new_balance;
END;
$function$;

-- 6) شبكة أمان مجدولة كل ساعة لتحرير أي حجز منتهٍ
SELECT cron.unschedule('release-stale-ai-holds')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'release-stale-ai-holds');

SELECT cron.schedule(
  'release-stale-ai-holds',
  '7 * * * *',
  $$SELECT public.release_stale_ai_holds();$$
);