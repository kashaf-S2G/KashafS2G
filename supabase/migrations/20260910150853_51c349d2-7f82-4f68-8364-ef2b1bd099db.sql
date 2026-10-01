
REVOKE EXECUTE ON FUNCTION public.pc_resolve_component(text,text,text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pc_log_external_change(text,text,text,text,text,text,text,text,text,text,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pc_scan_supabase_changes(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_resolve_component(text,text,text) TO service_role;
