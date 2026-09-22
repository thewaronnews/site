# send-digest.md -- instructions for the orchestrator

`newsdesk.py` only **writes** `ops/digests/YYYY-MM-DD.md` and prints it to
stdout. It does not send email itself (it has no mail credentials and
should not need any). Sending is the orchestrator's job, after the evening
(16:30 America/Toronto) run.

## What to do

1. After `newsdesk.py` finishes its evening run, read
   `ops/digests/<today>.md`.
2. Send it through the Gmail connector, **from the betty@benesthemenace.com
   mailbox, to peter@benesthemenace.com** (decision 5 / decisions-2026-09-22.md;
   spec section 7.1 step 7), with:
   - Subject: `TWON desk YYYY-MM-DD: N published, M held` -- read N and M off
     the digest's first line (`Published: N. Held: M. Paused: ...`).
   - Body: the digest file's contents verbatim (it is already Markdown-safe
     plain text; do not summarize or rewrite it).
3. Keep the thread. The next morning's `newsdesk.py` run reads replies to
   *that* digest thread (spec section 7.1 step 0: sender
   `peter@benesthemenace.com` and thread id must both match) for commands
   (`revert <id> <reason>`, `publish <id>`, `pause`, `resume`), written to
   `ops/inbox/commands.txt` one per line before the next run, or applied
   directly with `python3 newsdesk.py --apply-commands` once transcribed.
4. If `newsdesk.py` exited non-zero or produced no digest file for today,
   do not fabricate one -- tell Peter the run failed and paste the tail of
   `ops/logs/newsdesk-<today>.jsonl` instead.

## Why this script doesn't send mail itself

Section 7.1 step 0 requires matching the reply against "digest threads the
agent sent" from the betty@ mailbox, which means the send has to happen
through the same Gmail identity and be a real thread the orchestrator (which
holds the Gmail connector) controls end to end, not a side-channel SMTP call
from a cron job with no visibility into replies.
