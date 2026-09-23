#!/usr/bin/env python3
"""Voice lint for The War On News copy, driven by editorial/lint-rules.json.

Checks the site's own words only: text inside double quotation marks (straight
or curly) and Markdown blockquote lines is skipped, as are HTML comments and
link targets. Reports banned phrases, quotation-only words, em dashes (U+2014),
horizontal bars (U+2015), en dashes, double hyphens and spaced hyphens.

Usage: python3 lint.py [files...]   (defaults to every deliverable in this folder)
JSON files: only the prose fields listed in JSON_FIELDS are checked; claims,
quotations, URLs and source titles are data and are not linted.
"""
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
RULES = json.loads((HERE.parent / "editorial" / "lint-rules.json").read_text())

JSON_FIELDS = {
    "title", "summary", "what_happened", "stated_justification", "effect_on_reporting",
    "status", "what_we_dont_know", "outcome_note", "issue_of_the_day", "holding",
    "term", "gloss", "definition", "role_or_office", "name",
}


def strip_non_own_words(text: str) -> str:
    text = re.sub(r"<!--.*?-->", " ", text, flags=re.S)
    text = "\n".join("" if line.lstrip().startswith(">") else line for line in text.split("\n"))
    text = re.sub(r"\]\([^)]*\)", "]", text)          # link targets
    text = re.sub(r"https?://\S+", " ", text)          # bare URLs
    text = re.sub(r"\S+@\S+\.\w+", " ", text)          # email addresses
    text = re.sub(r"“[^”]*”", " “” ", text)  # curly quotes
    text = re.sub(r'"[^"\n]*"', ' "" ', text)          # straight quotes
    for ex in RULES.get("exempt", []):
        text = text.replace(ex, " ")
    return text


def lint_text(text: str, where: str):
    problems = []
    raw = text
    for ch, name in (("—", "em dash"), ("―", "horizontal bar")):
        if ch in raw:
            problems.append(f"{where}: {name}")
    own = strip_non_own_words(text)
    if "–" in own:
        problems.append(f"{where}: en dash in prose")
    if re.search(r"\s--\s", own):
        problems.append(f"{where}: double hyphen used as a dash")
    if re.search(r"\S - \S", own):
        problems.append(f"{where}: spaced hyphen used as a dash")
    low = own.lower()
    banned_hits = []
    for b in RULES["banned"]:
        p = b["phrase"].lower()
        if re.search(r"(?<![\w-])" + re.escape(p) + r"(?![\w-])", low):
            banned_hits.append(p)
            problems.append(f"{where}: banned phrase '{p}' (use: {b['replacement'] or 'cut'})")
    for w in RULES["quotation_only"]:
        wl = w.lower()
        if any(wl in bh for bh in banned_hits):
            continue
        if re.search(r"(?<![\w-])" + re.escape(wl) + r"(?![\w-])", low):
            problems.append(f"{where}: quotation-only word '{w}' outside quotation marks")
    return problems


def walk_json(node, path, out):
    if isinstance(node, dict):
        for k, v in node.items():
            if k in ("claims", "sources", "evidence_quote", "url", "title_of_source"):
                continue
            if isinstance(v, str) and k in JSON_FIELDS:
                out.extend(lint_text(v, f"{path}.{k}"))
            elif k == "editor_notes" and isinstance(v, list):
                for j, note in enumerate(v):
                    out.extend(lint_text(note, f"{path}.{k}[{j}]"))
            else:
                walk_json(v, f"{path}.{k}", out)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            walk_json(v, f"{path}[{i}]", out)


def lint_file(p: pathlib.Path):
    if p.suffix == ".json":
        data = json.loads(p.read_text())
        out = []
        if p.name == "glossary.json":           # only the entries appended in v2
            bak = p.with_name("glossary.json.bak")
            old = {e["slug"] for e in json.loads(bak.read_text())} if bak.exists() else set()
            data = [e for e in data if e["slug"] not in old]
        if p.name == "sources-add.json":        # source titles are the sources' own words
            return []
        walk_json(data, p.name, out)
        return out
    return lint_text(p.read_text(), p.name)


def main():
    files = [pathlib.Path(a) for a in sys.argv[1:]] or sorted(
        [f for f in HERE.iterdir() if f.suffix in (".md", ".json")]
        + [HERE.parent / "seed" / "glossary.json"]
    )
    total = 0
    for f in files:
        probs = lint_file(f)
        total += len(probs)
        print(f"{f.name}: {'clean' if not probs else str(len(probs)) + ' problem(s)'}")
        for pr in probs:
            print("   ", pr)
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
