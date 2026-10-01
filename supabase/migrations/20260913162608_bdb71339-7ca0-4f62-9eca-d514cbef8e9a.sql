CREATE POLICY "payment_proofs_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "payment_proofs_select_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "payment_proofs_admin_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'payment-proofs' AND public.has_role(auth.uid(), 'admin'));

REVOKE ALL ON FUNCTION public.activate_trial_plan() FROM anon, public;
REVOKE ALL ON FUNCTION public.approve_payment_request(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.reject_payment_request(uuid, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.ensure_paid_cycle(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.activate_trial_plan() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_payment_request(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_payment_request(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_paid_cycle(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;