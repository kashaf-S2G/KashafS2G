SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ai-pricing-sync-every-12h';

SELECT cron.schedule(
  'ai-pricing-sync-every-12h',
  '15 */12 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://project--6dfa02f6-b38c-4d18-b1fe-c59162880383.lovable.app/api/public/pricing/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-discovery-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'discovery_cron_token' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);