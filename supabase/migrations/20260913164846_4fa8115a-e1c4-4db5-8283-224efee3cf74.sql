GRANT SELECT ON public.user_ai_accounts TO authenticated;
REVOKE ALL ON public.user_ai_accounts FROM anon;
REVOKE ALL ON public.user_roles FROM anon;
REVOKE ALL ON public.payment_requests FROM anon;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT, INSERT ON public.payment_requests TO authenticated;
GRANT ALL ON public.user_ai_accounts TO service_role;
GRANT ALL ON public.user_roles TO service_role;
GRANT ALL ON public.payment_requests TO service_role;