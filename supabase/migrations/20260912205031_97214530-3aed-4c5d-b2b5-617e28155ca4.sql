DROP TABLE IF EXISTS public.pcrawl_evidence CASCADE;
DROP TABLE IF EXISTS public.pcrawl_keys CASCADE;
DROP TABLE IF EXISTS public.pcrawl_profiles CASCADE;
DROP TABLE IF EXISTS public.pcrawl_product_cursor CASCADE;
DROP TABLE IF EXISTS public.pcrawl_state CASCADE;
DROP TABLE IF EXISTS public.pcrawl_runs CASCADE;
DROP FUNCTION IF EXISTS public.acquire_pcrawl_run(uuid, text, text);