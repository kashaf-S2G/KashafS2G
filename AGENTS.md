<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Resolve background worker URLs from the current project's build identity, not a copied project UUID; otherwise crawls may execute on another deployment.
- Finalize product crawl stop/cancel commands in the authenticated request itself; worker wake-up is only a continuation mechanism.
- Treat empty or partly failed competitor crawls as visible failures and persist per-batch counts; silent success obscures upstream Facebook and AI errors.
- Competitor collector: per-competitor lock + heartbeat in DB, next hop via call_app_at, backstop cron armed only while jobs are open; why: no lost jobs or stuck runs.
- Raw ad analysis: ads status follows competitor_raw_ads via DB trigger (sync_ad_status_from_raw); why: reactivation reflects without re-running AI or touching crawler.
- AI pricing: dynamic provider cost (series __provider_actual__) refreshed every 12h; margin + exchange rate read from ai_pricing_settings at each new operation (applyCurrentSettings); why: settings changes apply immediately, history keeps charged values.
- Client cache: TanStack Query persisted to IndexedDB per user (src/lib/query-persist.ts), restored in _authenticated beforeLoad, detached before clear on sign-out, 24h per-query expiry, denylist for sensitive/in-progress keys; why: instant render + silent sync without cross-user leaks.
- Large lists (products/ads/competitors) render via useProgressiveList (batches of 30 on scroll) + cv-auto cards; why: rendering 1000+ cards at once crashed mobile, data/cache stay complete.
- Last Position: all list pages persist page/search/filters/sort/scroll via src/lib/last-position.ts (localStorage key per user+page), pager scrolls to top; why: one central system, no per-page storage.
