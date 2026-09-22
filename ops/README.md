# The War On News -- ops scripts

Operations scripts for thewaronnews.com (Crank #3), run on Peter's Mac
Studio or in this sandbox. They talk to the site's admin API (spec section
8) and to third-party services (Wayback Machine, IndexNow, simple-jev).
Python 3 standard library only, plus an optional `playwright` import in
`linkcheck.py` that is guarded and skipped if not installed.

Read alongside `/home/claude/crank3/twon-data-and-record-spec.md` (sections
4, 6, 7, 8 especially), `editorial/lint-rules.json`, `editorial/voice-guide.md`
and `decisions-2026-09-22.md`. Where this README and the spec differ, the
spec governs.

## Files

| File | Purpose |
|---|---|
| `common.py` | Shared library: `AdminClient`, `JevClient`, `Lint`, `log()`. Not run directly. |
| `linkcheck.py` | Nightly link-integrity pass (spec section 6). |
| `wayback.py` | Save Page Now archiving, batch or single-URL. |
| `indexnow.py` | IndexNow pings, from a URL list or the changes feed. |
| `newsdesk.py` | The daily News Desk run (spec section 7). |
| `seed-check.py` | Validates `seed/*.json` against the spec's field rules. Report-only. |
| `send-digest.md` | Instructions for the orchestrator to email the digest (not code). |
| `desk/feeds.yaml` | Tracker RSS feeds `newsdesk.py` sweeps. |
| `desk/jev_questions.json` | The static part of the News Desk Jev question set. |
| `desk/state.json` | `newsdesk.py`'s own run state (published counts, recent notes for dedupe). Created on first run. |
| `tests/` | `python3 -m unittest` suite for `common.Lint` and `linkcheck.classify_tier1`. |
| `logs/` | JSON-lines logs, one file per script per UTC day. Created on first run. |
| `candidates/`, `drafts/`, `drafts/done/`, `digests/`, `inbox/` | Working directories `newsdesk.py` reads and writes -- see its docstring. |

## Environment variables

| Var | Used by | Notes |
|---|---|---|
| `TWON_BASE` | all admin-API scripts | Default `https://thewaronnews.com`. Override for a staging Worker. |
| `TWON_TOKEN_FILE_TRIAGE` | `linkcheck.py`, `wayback.py` | Path to a file holding a `triage`-scope token (spec section 8). Never put the token itself in the env var. |
| `TWON_TOKEN_FILE_DESK` | `newsdesk.py` | Path to a file holding a `desk`-scope token. |
| `TWON_TOKEN_FILE_PUBLISH` | `indexnow.py` (`--since`) | Path to a file holding a `publish`-scope token, for `GET /admin/changed-urls`. |
| `INDEXNOW_KEY` | `indexnow.py` | The site's IndexNow key. Must match the key file served at `https://thewaronnews.com/<key>.txt`. |
| `JEV_API_KEY` | `common.JevClient` (via `linkcheck.py`, `newsdesk.py`) | Optional. Unset uses the free demo endpoint (2k context, throttled here to 3 req/s, `state` truncated to 1,800 characters). Set to switch to the paid `api.featherless.ai` endpoint with no truncation. |
| `WAYBACK_ACCESS_KEY`, `WAYBACK_SECRET_KEY` | `wayback.py` | Optional. Both set switches from the simple `GET /save/<url>` call to SPN2 (POST + job polling), which is more reliable under load. |

Token files should be `chmod 600`, owned by the account the cron/launchd
job runs as, e.g. `~/.twon/token-desk.txt`.

## Running each script

```bash
# Nightly link check (reports to the Worker; the Worker applies the
# 3-failures-over-48h dead rule, not this script)
python3 linkcheck.py --dry-run          # fetch + classify, print summary, no POST
python3 linkcheck.py                    # full run

# Archive every source without a snapshot
python3 wayback.py --dry-run
python3 wayback.py

# Archive one URL at publish time
python3 wayback.py --url https://example.com/story --source-id 481

# IndexNow: everything changed in the last 24 hours
python3 indexnow.py --since-hours 24

# IndexNow: an explicit list (e.g. right after a News Desk publish)
python3 indexnow.py https://thewaronnews.com/news/some-note https://thewaronnews.com/news

# News Desk, morning or evening run
python3 newsdesk.py --dry-run
python3 newsdesk.py

# News Desk, apply commands from a digest reply only
python3 newsdesk.py --apply-commands

# News Desk, one stage at a time for debugging
python3 newsdesk.py --stage gather
python3 newsdesk.py --stage dedupe
python3 newsdesk.py --stage jev
python3 newsdesk.py --stage draft

# Validate the seed content (report-only, fixes nothing)
python3 seed-check.py
python3 seed-check.py --json

# Unit tests
python3 -m unittest discover -s tests -v
```

## Kill switches (newsdesk.py)

- **Local**: create `~/twon/DESK_PAUSED` (any content, even empty). The
  script checks this before any write and stops the run, still writing a
  digest that says `Paused: yes`.
- **Server**: `POST /admin/desk/pause {"paused": true}` sets the KV flag
  `desk:paused`; the Worker then answers `423` to `POST /admin/desk/notes`.
  A `desk`-scope token can only pause (`{"paused": true}`), not resume --
  resuming needs a `publish`-scope token or the `resume` digest-reply
  command run by a human via `--apply-commands`.

## Cron / launchd schedule suggestions

All times America/Toronto, matching the spec. On the Mac Studio, prefer
`launchd` (survives reboots, logs to a fixed path); `cron` lines are given
too since they're what most people reach for first.

| Job | Time | launchd `StartCalendarInterval` | cron |
|---|---|---|---|
| `linkcheck.py` | 02:30 daily | `{Hour=2; Minute=30}` | `30 2 * * *` |
| `wayback.py` (batch backfill) | 03:15 daily, after linkcheck | `{Hour=3; Minute=15}` | `15 3 * * *` |
| `newsdesk.py` | 06:30 and 16:30 daily | two `StartCalendarInterval` dicts | `30 6,16 * * *` |
| `indexnow.py --since-hours 24` | 07:00 daily (catches anything a per-publish ping missed) | `{Hour=7; Minute=0}` | `0 7 * * *` |

Example launchd plist body (adjust `ProgramArguments` paths and env):

```xml
<key>ProgramArguments</key>
<array>
  <string>/usr/bin/python3</string>
  <string>/Users/peter/twon/ops/linkcheck.py</string>
</array>
<key>EnvironmentVariables</key>
<dict>
  <key>TWON_TOKEN_FILE_TRIAGE</key><string>/Users/peter/.twon/token-triage.txt</string>
</dict>
<key>StartCalendarInterval</key>
<dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>30</integer></dict>
<key>StandardOutPath</key><string>/Users/peter/twon/ops/logs/linkcheck-launchd.log</string>
<key>StandardErrorPath</key><string>/Users/peter/twon/ops/logs/linkcheck-launchd.err</string>
```

`newsdesk.py`'s evening run should be chained to the digest-send step
(`send-digest.md`) by whatever orchestrates the Mac Studio's agent runs --
that hand-off is not itself a launchd job, since it needs the Gmail
connector, not a cron-callable script (see `send-digest.md` for why).

## Failure modes

**linkcheck.py**
- `TWON_TOKEN_FILE_TRIAGE` missing/unreadable: exits 1 immediately, logs
  `fatal`, nothing POSTed. Fix the token file and rerun; nothing to undo.
- A single source's fetch throwing (DNS, TLS, timeout) is caught per-source
  and classified `dead`; it does not stop the run. The Worker's 3-in-48h
  hysteresis means one bad night never kills a source.
- Tier 2 needed but Playwright not installed: logged as
  `tier2_unavailable`, the check is posted as `error` (keeps the source's
  prior state, per spec section 6 step 5's below-threshold behaviour).
  Install `playwright` and run `playwright install chromium` to enable it.
- Jev demo endpoint over its 4 req/s ceiling or unreachable: `jev_error` is
  logged, that one page is posted as `error`; the run continues at the
  throttled 3 req/s for the rest.
- `/admin/sources/checks` POST failing (5xx/429) retries with backoff up to
  `AdminClient`'s `max_retries`; beyond that the batch raises and the run
  stops with whatever was already POSTed (batches are independent, so
  earlier batches are not rolled back).

**wayback.py**
- Save Page Now itself down or rate-limiting: `--max-failures` (default 8)
  stops the batch after that many consecutive failures rather than burning
  through the whole queue on a bad night; rerun later to pick up where it
  left off (each source is independently retried next run via
  `archive_attempts`, tracked server-side).
- `--url` single-URL mode failing: exits 1, prints to stderr, nothing
  POSTed -- safe to retry immediately (no local state to reconcile).
- SPN2 configured but the job never reaches `success` within 2 minutes:
  logged as `spn2_timeout`, treated as a failure for that URL (counts
  toward `--max-failures`).

**indexnow.py**
- `INDEXNOW_KEY` unset: exits 1 before any network call.
- IndexNow API down or rejecting (4xx/5xx): script exits 1 but has already
  logged the attempt; safe to rerun, IndexNow submissions are idempotent
  (re-pinging an already-known URL is a no-op on their end).
- `/admin/changed-urls` unreachable when using `--since`/`--since-hours`:
  logged, and the run still pings any URLs passed explicitly/via
  `--urls-file`; if there were none, exits 1.

**newsdesk.py**
- Any stage's exception is caught at the top level, logged as `fatal`,
  script exits 1. Because state (`desk/state.json`) is only saved after a
  successful publish loop, a mid-run crash does not corrupt the day's
  published-count bookkeeping -- rerunning re-reads the same drafts and
  skips anything already in `drafts/done/` that was already published
  (the admin API's own dedupe/idempotency on `run_id` is the final guard,
  not this script).
- A feed in `desk/feeds.yaml` that 404s or times out is logged
  (`feed_error`) and skipped; the run continues with the other feeds and
  whatever's in `candidates/YYYY-MM-DD.json`.
- No completed drafts on disk yet (drafting model hasn't run): the run
  still gathers, dedupes, Jev-scores and writes draft *requests*; the
  digest shows 0 published, 0 held, and the drafts are waiting in
  `drafts/`. This is the expected shape of the first run of a day.
- `~/twon/DESK_PAUSED` present: stops before any write, writes a
  `Paused: yes` digest, exits 0 (not an error -- pausing is a deliberate
  state).
- Publishing a note succeeds but the follow-up `wayback.py`/`indexnow.py`
  calls fail: logged (`archive_error`/`indexnow_error`) but does not roll
  back the publish -- the note is live either way; a missing snapshot or a
  missed IndexNow ping is caught by the next `linkcheck.py`/`wayback.py`
  batch run and the next `indexnow.py --since-hours` sweep.
- Daily/run caps (8/day, 6/run) reached mid-loop: remaining eligible drafts
  are left untouched in `drafts/done/` for the next run, not dropped.

**seed-check.py**
- Read-only and always exits 0 (see its docstring): it is a report, not a
  gate, today. A missing seed file is treated as zero records for that
  file, not a crash.

## Last run

### Unit tests

```
$ python3 -m unittest discover -s tests -v
```

38 tests, `common.Lint` (banned phrases, quotation-only words, em/en
dashes and dash-substitutes, quote/blockquote exemption, the site-name
exemption) and `linkcheck.classify_tier1` (every status-code/marker branch
in spec section 6 step 3, plus `common.title_token_overlap`). Result:

```
Ran 38 tests in 0.009s

OK
```

### seed-check.py

```
$ python3 seed-check.py
```

```
Seed check -- /home/claude/crank3/seed/*.json

Counts:
  incidents.json: 23
  actors.json: 35
  outlets.json: 18
  journalists.json: 7
  cases.json: 4
  sources.json: 99
  glossary.json: 27

Violations: 102 error(s), 83 warning(s)
  enum_shape_mismatch: 107
  lint_quotation_only: 30
  slug_convention: 23
  date_format: 11
  lint_banned_phrase: 10
  em_dash_in_prose: 4
```

No `broken_reference`, `field_missing`, `slug_format`, `slug_length` or
`claim_quote_length` violations -- every cross-reference in the seed
resolves, every claim's `evidence_quote` is under 300 characters, and every
slug is well-formed. The 102 errors and 83 warnings break down as:

- **`enum_shape_mismatch` (107, error)**: the seed is pre-admin-API research
  output, not D1 rows, and its enums don't match section 2.3's CHECK lists
  yet. `sources.kind` (86 of 99 rows: `outlet_report`/`org_report`/`other`
  vs. the schema's `reporting`/`primary_document`/`court_record`/
  `official_statement`/`dataset`/`reference`), `actors.kind` (20 of 35:
  `agency`/`court`/`legislature`/`office`/`other` vs. the schema's flat
  `person`/`body` -- these need to become `body_type` instead), and
  `outlets.kind` (1 of 18: `wire` should be `wire_service`). This is exactly
  the itemizer/verification work the build plan (spec section 11, P1b step
  1) already schedules ahead of `publish-records.py`; nothing here needs a
  seed-file fix, it needs the field-mapping pass.
- **`lint_quotation_only` / `lint_banned_phrase` (30 + 10, warning)**: words
  from `editorial/lint-rules.json` (`crackdown`, `censorship`, `targeted`,
  `chilling`, `harassment`, `biased`, `retaliation`, `regime`, `claimed`,
  etc.) used outside quotation marks in the site's own composed prose
  (`what_happened`, `summary`, `effect_on_reporting`, `stated_justification`,
  claim `statement`s). Concentrated in a handful of incidents (`turkiye-
  crackdown-on-journalists-covering-protests` alone accounts for 7). Source
  titles/publishers are intentionally excluded from this check (they're the
  external outlet's own headline, not the site's voice -- see
  `seed-check.py`'s `PROSE_FIELDS` comment).
- **`slug_convention` (23, warning)**: every incident slug is missing the
  leading 4-digit year the spec's naming convention calls for (section 2.1:
  "Incidents start with the year", e.g. `2026-white-house-bars-...`); all 23
  seed incident slugs omit it (`white-house-bans-cnn-msnow-politico`, not
  `2026-white-house-bans-cnn-msnow-politico`).
- **`date_format` (11, error)**: 11 `sources.published_on` values are
  month- or year-only (`"2026-09"`, `"2026"`) rather than `YYYY-MM-DD`; the
  schema's `*_on` columns need a full date plus a separate `*_precision`
  column for partial dates, which `sources` doesn't carry.
- **`em_dash_in_prose` (4, error)**: two incidents (`pentagon-press-corps-
  forfeits-badges`, `federal-judge-blocks-louisiana-buffer-law`) use `" -- "`
  as a dash in `what_happened`, two occurrences each, outside any quotation.
  `seed-notes.md` separately flags 2 `evidence_quote` fields with a literal
  em dash as intentional (verbatim source text); those are correctly not
  flagged here, since quoted/evidence text is exempt from this check.

Nothing in the seed was changed to produce this report.
