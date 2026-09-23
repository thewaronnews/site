# Webmaster Registration — thewaronnews.com — 2026-09-22

Performed via Chrome (account betty@benesthemenace.com) and Cloudflare API (via device_bash). No secret values are printed in this file.

## Google Search Console

- **Property added:** Domain property `thewaronnews.com` (sc-domain:thewaronnews.com)
- **Verification method:** DNS TXT record ("Domain name provider" / generic DNS method)
  - GSC issued a `google-site-verification=...` TXT value for host `thewaronnews.com`.
  - Added via Cloudflare API (`POST /client/v4/zones/{zone_id}/dns_records`, type TXT, name `thewaronnews.com`, ttl 1). API response: `success: true`, record id `9c92d0178f9b5246501bcd2baf27844e`.
  - Confirmed via a follow-up GET that all 3 TXT records coexist on the apex: the new GSC verification token, the existing SPF record, and the pre-existing Google Workspace `google-site-verification=...` token (left untouched, per instructions).
  - Waited ~60s, clicked **Verify** in GSC — succeeded on the first attempt (no retries needed).
- **Sitemap submission:** Submitted `https://thewaronnews.com/sitemap.xml` (full absolute URL) via the Sitemaps page.
  - Immediately after submission it showed "Couldn't fetch" (expected — Google hadn't crawled it yet). Independently confirmed the sitemap was live via `curl -o /dev/null -w "%{http_code}"` → **HTTP 200**.
  - Re-checked later in the session: status is now **Success**, type "Sitemap index", last read 9/22/2026.
  - GSC Overview panel also already shows organic indexing activity: 5 indexed pages / 11 not-indexed pages (crawl in progress).
- **Note:** GSC's own Recommendations panel flagged "1 unused verification token found on your property" — expected, since the pre-existing Workspace TXT token is a second valid verification method; not an error, no action taken (instructed not to remove the old record).
- **Errors:** None blocking. Two minor Chrome-UI mishaps along the way, both self-recovered with no data loss: (1) a stray click outside the "Verify domain ownership" modal closed it before verification — reopened via the property switcher and the same pending dialog resumed since the property already existed server-side; (2) the TXT value was visually truncated in the GSC modal — recovered the full untruncated string via the `find` (accessibility-tree) tool rather than `get_page_text` or a screenshot zoom, both of which returned the truncated ellipsis.

## Bing Webmaster Tools

- **Site added:** `https://thewaronnews.com/`
- **Verification method:** **Import from Google Search Console** (OAuth), per the Crank playbook preference over manual DNS verification. Account chooser required explicit selection of `betty@benesthemenace.com` (an alternate "Peter Benes" Google session was also listed and was not selected). Import succeeded; site now shows in Bing Webmaster Tools with **Administrator** role.
- **Sitemap submission:** The GSC import did not carry the sitemap over automatically (GSC had not yet successfully fetched it at import time), so it was submitted manually: `https://thewaronnews.com/sitemap.xml` via Bing's Submit Sitemap flow. Confirmed with an on-page "Success" message and initial "Processing" status.
  - Re-checked later in the session: status is now **Success**, type "Sitemap Index", 5 URLs discovered from the sitemap index; the account-wide Sitemaps dashboard shows 473 total URLs discovered, 0 sitemaps with errors, 0 with warnings.
- **IndexNow:** Task required confirming Bing shows the key (key file already live at the site root; key value is `INDEXNOW_KEY` in secrets.env — not printed here).
  - Independently verified the key file is live: `curl` to `https://thewaronnews.com/<INDEXNOW_KEY>.txt` (constructed from the secret, not shown) returned **HTTP 200**.
  - However, Bing Webmaster Tools' IndexNow page (`/webmasters/indexnow`) rendered only a generic onboarding/marketing splash ("Take control of your SEO game with real-time indexing... Get Started") for this site, not a per-site "key detected" status or table of submitted URLs. Clicking "Get Started" opened Bing's generic `indexnow/getstarted` documentation page (key-generation instructions, plugin list, API docs) — also not site-specific status. No explicit "key found/detected" indicator was surfaced in the UI this session.
  - **Status: key file's live presence confirmed via curl (HTTP 200); Bing UI did not surface an explicit per-site detection confirmation.** Per the task's "if a Chrome step fails 3 times, note it and move on" allowance, this is noted rather than retried further — it does not block indexing, since the key file being live and correctly formatted is what IndexNow actually checks server-side when a URL is submitted.
- **Errors:** One misclick reaching "Add a site" (landed on "Backlinks" for a different property, travelpec.com, due to shifted dropdown coordinates) — corrected by reopening the dropdown and re-screenshotting before clicking the right item. No lasting impact.

## Summary

| Item | Status |
|---|---|
| GSC domain property | Added, verified (DNS TXT) |
| GSC sitemap | Submitted, Success |
| Bing site | Added, verified (Import from GSC), Administrator role |
| Bing sitemap | Submitted, Success |
| IndexNow key file | Live at site root (HTTP 200, confirmed via curl); not confirmed as "detected" in Bing UI (no per-site status surfaced) |
