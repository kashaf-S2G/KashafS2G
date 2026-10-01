GRANT SELECT ON public.user_ai_accounts TO authenticated;
GRANT ALL ON public.user_ai_accounts TO service_role;

INSERT INTO public.user_ai_accounts (user_id)
SELECT u.id FROM auth.users u
LEFT JOIN public.user_ai_accounts a ON a.user_id = u.id
WHERE a.user_id IS NULL;