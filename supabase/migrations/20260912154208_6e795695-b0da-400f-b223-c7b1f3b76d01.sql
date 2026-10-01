SELECT cron.schedule(
  'product-discovery-every-3h',
  '30 */3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--04d477df-7d2c-4e52-9219-78620e77aa8b.lovable.app/api/public/product-discovery/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-discovery-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'discovery_cron_token' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);