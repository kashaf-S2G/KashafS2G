ALTER TABLE public.ads DISABLE TRIGGER ads_sync_pb_statements;
DELETE FROM public.ad_statements WHERE id IS NOT NULL;
DELETE FROM public.pb_statements WHERE id IS NOT NULL;