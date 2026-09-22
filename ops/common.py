"""
common.py -- shared library for The War On News ops scripts.

Provides:
  - AdminClient: bearer-token client for the site's admin API (section 8 of
    twon-data-and-record-spec.md), with retries and 429 backoff.
  - JevClient: client for simple-jev.featherless.ai (demo endpoint by
    default; a paid api.featherless.ai key when JEV_API_KEY is set), with
    the spec's 1,800-character demo-mode truncation.
  - Lint: loads editorial/lint-rules.json and flags banned phrases and
    quotation-only words used outside quotation marks, and any em/en dash
    (or dash-substitute) outside quotation marks.
  - log(): appends a JSON line to ops/logs/<script>-YYYY-MM-DD.jsonl.

Python 3 standard library only. No third-party imports.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Paths

OPS_DIR = Path(__file__).resolve().parent
LOG_DIR = OPS_DIR / "logs"
CRANK3_DIR = OPS_DIR.parent.parent  # /home/claude/crank3
LINT_RULES_PATH = CRANK3_DIR / "editorial" / "lint-rules.json"

CHROME_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

# ---------------------------------------------------------------------------
# Logging


def log(script: str, event: str, **fields: Any) -> None:
    """Append one JSON line to ops/logs/<script>-YYYY-MM-DD.jsonl.

    Never raises: a logging failure must not take down an ops run. Also
    echoes a short line to stderr so cron/launchd captures it in stdout
    logs too.
    """
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        path = LOG_DIR / f"{script}-{day}.jsonl"
        record = {
            "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "script": script,
            "event": event,
        }
        record.update(fields)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
    except Exception as exc:  # noqa: BLE001 - logging must never crash the caller
        print(f"[log-failed] {script} {event}: {exc}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Token / env helpers


def read_token(env_var: str) -> str:
    """Read a bearer token from the file named by env_var.

    TWON_TOKEN_FILE_* env vars point at files on disk (never inline the
    token itself in an env var, so it doesn't leak into `ps` or crontab
    dumps). Strips surrounding whitespace/newline.
    """
    path = os.environ.get(env_var)
    if not path:
        raise RuntimeError(f"{env_var} is not set (see ops/README.md)")
    p = Path(path).expanduser()
    if not p.is_file():
        raise RuntimeError(f"{env_var} points at {p}, which does not exist")
    token = p.read_text(encoding="utf-8").strip()
    if not token:
        raise RuntimeError(f"{env_var} ({p}) is empty")
    return token


# ---------------------------------------------------------------------------
# Admin API client


class AdminAPIError(RuntimeError):
    def __init__(self, status: int, body: str, method: str, path: str):
        super().__init__(f"{method} {path} -> HTTP {status}: {body[:500]}")
        self.status = status
        self.body = body
        self.method = method
        self.path = path


class AdminClient:
    """Bearer-token client for the site's admin API.

    Base URL from TWON_BASE (default https://thewaronnews.com). Token is
    read once from the file at token_env (e.g. TWON_TOKEN_FILE_DESK).
    Retries transient failures (connection errors, 5xx, 429) with
    exponential backoff honouring Retry-After when present. Scopes and
    endpoints are section 8 of twon-data-and-record-spec.md.
    """

    def __init__(
        self,
        token_env: str,
        base_url: Optional[str] = None,
        max_retries: int = 4,
        timeout: float = 30.0,
        user_agent: str = "twon-ops/1.0",
    ):
        self.base_url = (base_url or os.environ.get("TWON_BASE") or "https://thewaronnews.com").rstrip("/")
        self.token = read_token(token_env)
        self.max_retries = max_retries
        self.timeout = timeout
        self.user_agent = user_agent

    def _request(self, method: str, path: str, body: Optional[dict] = None) -> Any:
        url = self.base_url + path
        data = None
        headers = {
            "Authorization": f"Bearer {self.token}",
            "User-Agent": self.user_agent,
            "Accept": "application/json",
        }
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        attempt = 0
        while True:
            attempt += 1
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw = resp.read()
                    if not raw:
                        return None
                    return json.loads(raw.decode("utf-8"))
            except urllib.error.HTTPError as exc:
                raw = exc.read().decode("utf-8", "replace")
                retryable = exc.code == 429 or exc.code >= 500
                if retryable and attempt <= self.max_retries:
                    wait = self._backoff_seconds(exc, attempt)
                    log("common", "admin_retry", method=method, path=path, status=exc.code, attempt=attempt, wait=wait)
                    time.sleep(wait)
                    continue
                raise AdminAPIError(exc.code, raw, method, path) from None
            except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
                if attempt <= self.max_retries:
                    wait = 2 ** attempt
                    log("common", "admin_retry_network", method=method, path=path, error=str(exc), attempt=attempt, wait=wait)
                    time.sleep(wait)
                    continue
                raise

    @staticmethod
    def _backoff_seconds(exc: urllib.error.HTTPError, attempt: int) -> float:
        retry_after = exc.headers.get("Retry-After") if exc.headers else None
        if retry_after:
            try:
                return max(float(retry_after), 1.0)
            except ValueError:
                pass
        return min(2 ** attempt, 60)

    def get(self, path: str) -> Any:
        return self._request("GET", path)

    def post(self, path: str, body: dict) -> Any:
        return self._request("POST", path, body)

    def put(self, path: str, body: dict) -> Any:
        return self._request("PUT", path, body)


# ---------------------------------------------------------------------------
# Jev client


class JevError(RuntimeError):
    pass


class JevClient:
    """Client for simple-jev.featherless.ai.

    Demo endpoint (https://simple-jev-demo-api.featherless.ai/v1/classifier)
    is used unless JEV_API_KEY is set, in which case the paid endpoint
    (https://api.featherless.ai/v1/classifier) is used with
    `Authorization: Bearer <JEV_API_KEY>`. Per the spec, demo mode truncates
    `state` to 1,800 characters and is throttled to 3 requests/second (the
    demo's own ceiling is 4 rps; this client stays under it); the paid
    endpoint is not throttled beyond the admin client's own retry policy.
    """

    DEMO_BASE = "https://simple-jev-demo-api.featherless.ai"
    PAID_BASE = "https://api.featherless.ai"
    DEMO_STATE_LIMIT = 1800
    DEMO_MIN_INTERVAL = 1.0 / 3.0  # 3 requests/second in demo mode
    DEFAULT_MODEL = "featherless-ai/Qwen3.6-35B-A3B-classifier"

    def __init__(self, model: Optional[str] = None, timeout: float = 30.0):
        self.api_key = os.environ.get("JEV_API_KEY", "").strip() or None
        self.model = model or self.DEFAULT_MODEL
        self.timeout = timeout
        self._last_call = 0.0

    @property
    def is_demo(self) -> bool:
        return not self.api_key

    def classify(self, state: str, questions: Dict[str, dict]) -> Dict[str, Any]:
        """POST /v1/classifier. Returns the parsed `answers` dict.

        `questions` follows the simple-jev schema, e.g.
        {"in_scope": {"type": "noul", "instructions": "...",
                       "criteria": {"true": "...", "false": "..."}}}
        """
        if self.is_demo:
            base = self.DEMO_BASE
            headers = {"Content-Type": "application/json"}
            if len(state) > self.DEMO_STATE_LIMIT:
                state = state[: self.DEMO_STATE_LIMIT]
            self._throttle()
        else:
            base = self.PAID_BASE
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            }

        body = {"model": self.model, "state": state, "questions": questions}
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{base}/v1/classifier", data=data, method="POST", headers=headers
        )
        attempt = 0
        while True:
            attempt += 1
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    parsed = json.loads(resp.read().decode("utf-8"))
                    return parsed.get("answers", {})
            except urllib.error.HTTPError as exc:
                raw = exc.read().decode("utf-8", "replace")
                if exc.code == 429 and attempt <= 3:
                    time.sleep(2 ** attempt)
                    continue
                raise JevError(f"jev classify -> HTTP {exc.code}: {raw[:400]}") from None
            except (urllib.error.URLError, TimeoutError) as exc:
                if attempt <= 3:
                    time.sleep(2 ** attempt)
                    continue
                raise JevError(f"jev classify: {exc}") from None

    def _throttle(self) -> None:
        if not self.is_demo:
            return
        elapsed = time.monotonic() - self._last_call
        if elapsed < self.DEMO_MIN_INTERVAL:
            time.sleep(self.DEMO_MIN_INTERVAL - elapsed)
        self._last_call = time.monotonic()


# ---------------------------------------------------------------------------
# Lint (voice-guide.md / editorial/lint-rules.json)

_DASH_CHARS = {
    "—": "em dash (U+2014)",
    "―": "horizontal bar (U+2015)",
    "–": "en dash (U+2013)",
}
_DASH_SUBSTITUTES = [
    (re.compile(r" -- "), "double hyphen used as a dash"),
    (re.compile(r" - "), "spaced hyphen used as a dash"),
]

_QUOTE_SPAN_RE = re.compile(r'"[^"\n]*"|“[^”\n]*”')
_WORD_CHARS = re.compile(r"\w", re.UNICODE)


class Lint:
    """Loads editorial/lint-rules.json and checks the site's own prose.

    Text inside straight or curly double quotes ("...", "..."), inside a
    Markdown blockquote line (starts with '>'), or that is (exactly) an
    exempt string, is never linted -- it is treated as verbatim quotation,
    per lint-rules.json's `applies_to`.
    """

    def __init__(self, rules_path: Optional[Path] = None):
        self.path = rules_path or LINT_RULES_PATH
        with self.path.open(encoding="utf-8") as fh:
            self.rules = json.load(fh)
        self.banned: List[dict] = self.rules.get("banned", [])
        self.quotation_only: List[str] = self.rules.get("quotation_only", [])
        self.exempt: List[str] = self.rules.get("exempt", [])
        self._banned_re = [
            (entry, self._phrase_re(entry["phrase"])) for entry in self.banned
        ]
        self._quotation_only_re = [
            (word, self._phrase_re(word)) for word in self.quotation_only
        ]

    @staticmethod
    def _phrase_re(phrase: str) -> re.Pattern:
        # whole-word, case-insensitive; internal whitespace matches any run
        # of whitespace so "war on" also catches "war  on" across a wrap.
        parts = [re.escape(tok) for tok in phrase.split(" ")]
        pattern = r"\b" + r"\s+".join(parts) + r"\b"
        return re.compile(pattern, re.IGNORECASE)

    # -- masking -----------------------------------------------------

    def _quoted_mask(self, text: str) -> List[bool]:
        """Return a per-character mask, True where text is exempt (inside
        quotes, inside a blockquote line, or inside an exempt string)."""
        mask = [False] * len(text)

        # Markdown blockquote lines
        offset = 0
        for line in text.splitlines(keepends=True):
            if line.lstrip().startswith(">"):
                for i in range(offset, offset + len(line)):
                    mask[i] = True
            offset += len(line)

        # Quoted spans (straight or curly double quotes)
        for m in _QUOTE_SPAN_RE.finditer(text):
            for i in range(m.start(), m.end()):
                mask[i] = True

        # Exempt exact strings (e.g. "The War On News")
        for exempt in self.exempt:
            start = 0
            while True:
                idx = text.find(exempt, start)
                if idx == -1:
                    break
                for i in range(idx, idx + len(exempt)):
                    mask[i] = True
                start = idx + len(exempt)

        return mask

    @staticmethod
    def _span_is_masked(mask: List[bool], start: int, end: int) -> bool:
        return any(mask[start:end]) if end > start else False

    # -- public API ----------------------------------------------------

    def check(self, text: str) -> List[Dict[str, Any]]:
        """Return a list of violations: each is
        {kind, text, replacement?, offset, line}.
        kind is one of banned_phrase, quotation_only, dash.
        """
        if not text:
            return []
        mask = self._quoted_mask(text)
        violations: List[Dict[str, Any]] = []
        banned_spans: List[Tuple[int, int]] = []

        for entry, pattern in self._banned_re:
            for m in pattern.finditer(text):
                if self._span_is_masked(mask, m.start(), m.end()):
                    continue
                violations.append(
                    {
                        "kind": "banned_phrase",
                        "text": m.group(0),
                        "replacement": entry.get("replacement", ""),
                        "offset": m.start(),
                        "line": text.count("\n", 0, m.start()) + 1,
                    }
                )
                banned_spans.append((m.start(), m.end()))

        for word, pattern in self._quotation_only_re:
            for m in pattern.finditer(text):
                if self._span_is_masked(mask, m.start(), m.end()):
                    continue
                if any(s <= m.start() < e for s, e in banned_spans):
                    continue  # already reported as part of a banned phrase
                violations.append(
                    {
                        "kind": "quotation_only",
                        "text": m.group(0),
                        "replacement": None,
                        "offset": m.start(),
                        "line": text.count("\n", 0, m.start()) + 1,
                    }
                )

        for i, ch in enumerate(text):
            if mask[i]:
                continue
            if ch in _DASH_CHARS:
                violations.append(
                    {
                        "kind": "dash",
                        "text": ch,
                        "replacement": _DASH_CHARS[ch],
                        "offset": i,
                        "line": text.count("\n", 0, i) + 1,
                    }
                )

        for pattern, label in _DASH_SUBSTITUTES:
            for m in pattern.finditer(text):
                if self._span_is_masked(mask, m.start(), m.end()):
                    continue
                violations.append(
                    {
                        "kind": "dash",
                        "text": m.group(0).strip() or m.group(0),
                        "replacement": label,
                        "offset": m.start(),
                        "line": text.count("\n", 0, m.start()) + 1,
                    }
                )

        violations.sort(key=lambda v: v["offset"])
        return violations

    def is_clean(self, text: str) -> bool:
        return len(self.check(text)) == 0


# ---------------------------------------------------------------------------
# Small shared utilities


def word_count(text: str) -> int:
    """Whitespace word count, matching news_desk_notes.word_count (60-120)."""
    return len(text.split())


def title_token_overlap(a: str, b: str) -> float:
    """Jaccard overlap of lowercase word tokens, for dedupe / redirect checks."""
    ta = set(re.findall(r"[a-z0-9]+", a.lower()))
    tb = set(re.findall(r"[a-z0-9]+", b.lower()))
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json(path: Path) -> Any:
    with Path(path).open(encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, obj: Any) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with Path(path).open("w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2, sort_keys=False)
        fh.write("\n")
