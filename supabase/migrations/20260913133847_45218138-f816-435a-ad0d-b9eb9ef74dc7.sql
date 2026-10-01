REVOKE ALL ON FUNCTION public.handle_new_user_ai_account() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user_ai_account() TO service_role;