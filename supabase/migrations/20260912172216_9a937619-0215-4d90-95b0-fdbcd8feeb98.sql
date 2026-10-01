SELECT cron.alter_job(2, command := $cmd$
  SELECT net.http_post(
    url := 'https://project--c91e58df-5901-49fc-8236-72b7beb77fba.lovable.app/api/public/discovery/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-discovery-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'discovery_cron_token' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$cmd$);

SELECT cron.alter_job(3, command := $cmd$
  SELECT net.http_post(
    url := 'https://project--c91e58df-5901-49fc-8236-72b7beb77fba.lovable.app/api/public/product-discovery/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-discovery-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'discovery_cron_token' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$cmd$);