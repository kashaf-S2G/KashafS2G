REVOKE ALL ON FUNCTION public.acquire_crawl_run_for(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acquire_crawl_run_for(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.acquire_crawl_run_for(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_crawl_run_for(uuid, text) TO service_role;