// Local test harness: runs the Worker's fetch() under Node 22 with D1, KV
// and R2 shims (node:sqlite, in-memory maps), after applying the
// migrations with tools/split-sql.py. Serves it on http://127.0.0.1:PORT so
// tools (load-seed.py, mcp-smoke.sh) can be exercised before a deploy.
//
//   node site/tools/local-harness.mjs [port]   (ADMIN_TOKEN=... optional)
//
// Scoped tokens for local use: "local-triage", "local-desk", "local-publish".
// Development aid only; nothing here ships to Cloudflare.

import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.dirname(here);
// DB_FILE=/path/to/copy.sqlite runs against a copy of real data (see
// NOTES.md: production dump); migrations already recorded there are skipped.
const db = new DatabaseSync(process.env.DB_FILE || ":memory:");
db.exec("PRAGMA foreign_keys = ON");
const applied = new Set();
try { for (const r of db.prepare("SELECT filename FROM migrations").all()) applied.add(r.filename); } catch { /* fresh db */ }
for (const f of readdirSync(path.join(site, "migrations")).sort()) {
  if (applied.has(f)) continue;
  const stmts = JSON.parse(execFileSync("python3", [path.join(here, "split-sql.py"), path.join(site, "migrations", f)]).toString());
  for (const s of stmts) db.exec(s);
  db.prepare("INSERT INTO migrations (filename, applied_at) VALUES (?, ?)").run(f, new Date().toISOString());
}

function norm(v) {
  if (v === undefined) throw new Error("D1_TYPE_ERROR: undefined bind");
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

class Stmt {
  constructor(sql, args = []) { this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.sql, args.map(norm)); }
  async all() { return { results: db.prepare(this.sql).all(...this.args).map((r) => ({ ...r })), success: true }; }
  async first(col) {
    const r = db.prepare(this.sql).get(...this.args);
    if (!r) return null;
    return col ? r[col] : { ...r };
  }
  async run() {
    const info = db.prepare(this.sql).run(...this.args);
    return { success: true, meta: { last_row_id: Number(info.lastInsertRowid), changes: info.changes } };
  }
}

const DB = {
  prepare: (sql) => new Stmt(sql),
  async batch(stmts) {
    db.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      db.exec("COMMIT");
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  },
};

const kv = new Map();
const KV = {
  async get(k, type) { if (k.startsWith("admin_rl:")) return null; const v = kv.has(k) ? kv.get(k) : null; return v !== null && type === "json" ? JSON.parse(v) : v; },
  async put(k, v) { kv.set(k, String(v)); },
  async delete(k) { kv.delete(k); },
};
const r2 = new Map();
const EXPORTS = {
  async put(k, body) { r2.set(k, body); },
  async get(k) {
    if (r2.has(k)) return { body: r2.get(k) };
    // assets/img and assets/fonts are read from site/assets (tools/upload-assets.sh ships them to R2).
    if (/^assets\/(img|fonts)\/[a-zA-Z0-9-]+\.[a-z0-9]+$/.test(k) && existsSync(path.join(site, k))) return { body: readFileSync(path.join(site, k)) };
    return null;
  },
};

const sha = (s) => createHash("sha256").update(s).digest("hex");
for (const scope of ["triage", "desk", "publish"]) kv.set(`admin-token:${sha(`local-${scope}`)}`, JSON.stringify({ scope, issued_at: "local", label: `local-${scope}` }));
kv.set(`mcp_token:${sha("local-mcp")}`, "local-client");

const env = { DB, KV, EXPORTS, SITE_ORIGIN: "https://thewaronnews.com", ADMIN_TOKEN: process.env.ADMIN_TOKEN || "local-operator", SALT_SECRET: "local", INDEXNOW_KEY: "localkey", DATA_REPO: "https://github.com/thewaronnews/data" };
const worker = (await import(path.join(site, "src", "index.js"))).default;

const port = parseInt(process.argv[2] || "8787", 10);
createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const host = req.headers["x-host"] || "thewaronnews.com";
  const request = new Request(`https://${host}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
  const waits = [];
  try {
    const r = await worker.fetch(request, env, { waitUntil: (p) => waits.push(p) });
    await Promise.allSettled(waits);
    const headers = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(r.status, headers);
    res.end(r.body ? Buffer.from(await r.arrayBuffer()) : undefined);
  } catch (e) {
    res.writeHead(599, { "content-type": "text/plain" });
    res.end(String(e && e.stack || e));
  }
}).listen(port, "127.0.0.1", () => console.log(`harness on http://127.0.0.1:${port}`));
