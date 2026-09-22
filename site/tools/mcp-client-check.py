#!/usr/bin/env python3
"""
P0.4 minimal MCP client check for rattlesnakesbymail.com/mcp.

No SDK: only urllib. Exercises the exact sequence a real Streamable HTTP
MCP client sends: initialize, notifications/initialized, tools/list, one
tools/call. Prints each step's status and a short summary. Exit code 0
only if every step looks right.
"""
import json
import sys
import urllib.request
import urllib.error

BASE = "https://rattlesnakesbymail.com/mcp"
ok = True


def post(body, session_id=None, expect_json=True):
    data = json.dumps(body).encode()
    headers = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "rsbm-smoke/1.0"}
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    req = urllib.request.Request(BASE, data=data, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
            sid = resp.headers.get("Mcp-Session-Id")
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read()
        sid = e.headers.get("Mcp-Session-Id") if e.headers else None
        status = e.code
    parsed = None
    if expect_json and raw:
        try:
            parsed = json.loads(raw)
        except ValueError:
            parsed = None
    return status, sid, parsed


def check(label, cond, detail=""):
    global ok
    mark = "PASS" if cond else "FAIL"
    if not cond:
        ok = False
    print(f"{mark}: {label} {detail}".rstrip())


# 1. initialize
status, session_id, parsed = post({
    "jsonrpc": "2.0", "id": 1, "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "smoke-test", "version": "0.1"},
    },
})
server_name = (parsed or {}).get("result", {}).get("serverInfo", {}).get("name")
check("initialize", status == 200 and server_name == "Rattlesnakes By Mail" and bool(session_id),
      f"(status={status} serverInfo.name={server_name!r} session={'yes' if session_id else 'no'})")

# 2. notifications/initialized (a notification: no "id")
status2, _, _ = post({"jsonrpc": "2.0", "method": "notifications/initialized"}, session_id=session_id, expect_json=False)
check("notifications/initialized", status2 == 202, f"(status={status2})")

# 3. tools/list
status3, _, parsed3 = post({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, session_id=session_id)
tools = (parsed3 or {}).get("result", {}).get("tools", [])
tool_names = sorted(t.get("name") for t in tools)
check("tools/list", status3 == 200 and len(tools) == 5, f"(status={status3} tools={tool_names})")

# 4. one tools/call
status4, _, parsed4 = post({
    "jsonrpc": "2.0", "id": 3, "method": "tools/call",
    "params": {"name": "lookup_crawler", "arguments": {"name_or_ua": "GPTBot"}},
}, session_id=session_id)
result4 = (parsed4 or {}).get("result", {})
content_text = ""
if result4.get("content"):
    content_text = result4["content"][0].get("text", "")[:60]
check("tools/call lookup_crawler", status4 == 200 and result4.get("isError") is False and "GPTBot" in content_text,
      f"(status={status4} isError={result4.get('isError')} text_starts={content_text!r})")

print("")
print("RESULT:", "ALL PASS" if ok else "SOME FAILED")
sys.exit(0 if ok else 1)
