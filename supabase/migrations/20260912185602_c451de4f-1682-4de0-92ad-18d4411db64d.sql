SELECT cron.unschedule('product-discovery-every-3h');

DELETE FROM public.discovered_competitors WHERE discovery_source = 'products';

DROP FUNCTION IF EXISTS public.acquire_product_discovery_run(uuid, text);

DROP TABLE IF EXISTS public.product_term_links;
DROP TABLE IF EXISTS public.product_discovery_runs;
DROP TABLE IF EXISTS public.product_discovery_state;

ALTER TABLE public.products DROP COLUMN IF EXISTS discovery_last_searched_at;
ALTER TABLE public.discovery_terms DROP COLUMN IF EXISTS product_discovery_last_searched_at;