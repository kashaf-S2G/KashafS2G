REVOKE ALL ON FUNCTION public.clear_demo_data() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_demo_data() FROM anon;
GRANT EXECUTE ON FUNCTION public.clear_demo_data() TO authenticated;