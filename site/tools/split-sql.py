#!/usr/bin/env python3
"""Split a SQL migration file into single statements for the D1 HTTP API.

Respects single-quoted strings ('' escapes), double-quoted identifiers,
-- line comments and /* */ block comments (both stripped), and keeps
CREATE TRIGGER ... BEGIN ... END; as one statement: inside a trigger a ';'
only ends the statement when the last word before it is END (spec 2.1).

Usage: split-sql.py FILE  -> JSON array of statements on stdout.
"""
import json
import re
import sys


def split_sql(content):
    stmts, buf = [], []
    i, n = 0, len(content)
    while i < n:
        c = content[i]
        if c == "'" or c == '"':
            q = c
            j = i + 1
            while j < n:
                if content[j] == q:
                    if j + 1 < n and content[j + 1] == q:
                        j += 2
                        continue
                    break
                j += 1
            buf.append(content[i:j + 1])
            i = j + 1
            continue
        if c == "-" and content[i:i + 2] == "--":
            j = content.find("\n", i)
            i = n if j == -1 else j
            continue
        if c == "/" and content[i:i + 2] == "/*":
            j = content.find("*/", i + 2)
            i = n if j == -1 else j + 2
            continue
        if c == ";":
            stmt = "".join(buf).strip()
            is_trigger = re.match(r"(?is)^CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b", stmt)
            if is_trigger and not re.search(r"(?i)\bEND\s*$", stmt):
                buf.append(";")
                i += 1
                continue
            if stmt:
                stmts.append(re.sub(r"\s+", " ", stmt) if not is_trigger else " ".join(stmt.split()))
            buf = []
            i += 1
            continue
        buf.append(c)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        stmts.append(" ".join(tail.split()))
    return stmts


if __name__ == "__main__":
    with open(sys.argv[1]) as f:
        print(json.dumps(split_sql(f.read())))
