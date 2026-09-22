// IndexNow (P0.7): tells Bing, Yandex and every other participating
// search engine that a URL changed, via the shared api.indexnow.org
// gateway, instead of waiting for those engines to recrawl on their own.
// The key is a plain Worker var (env.INDEXNOW_KEY, not a secret): IndexNow
// requires it to be published, readable, at https://<host>/<key>.txt, which
// index.js serves directly.

import { isoNow } from "./util.js";

const DEFAULT_INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const INDEXNOW_HOST = "rattlesnakesbymail.com";

// Posts up to 10,000 URLs in one call and records the outcome in KV under
// indexnow:last, always, whether the ping succeeded, failed, or was
// skipped for lack of a key or a URL list. Returns that same record so a
// synchronous caller (the admin route) can report it back; a caller that
// does not need the result (the nightly export) wraps this call in
// ctx.waitUntil instead of awaiting it inline.
export async function pingIndexNow(env, urls) {
  const key = env.INDEXNOW_KEY;
  const list = Array.from(new Set((urls || []).filter(Boolean))).slice(0, 10000);
  let record;
  if (!key) {
    record = { at: isoNow(), count: list.length, status: null, skipped: "no_indexnow_key" };
  } else if (!list.length) {
    record = { at: isoNow(), count: 0, status: null, skipped: "no_urls" };
  } else {
    const keyLocation = `https://${INDEXNOW_HOST}/${key}.txt`;
    let status = null;
    let error;
    try {
      const endpoint = env.INDEXNOW_ENDPOINT || DEFAULT_INDEXNOW_ENDPOINT;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ host: INDEXNOW_HOST, key, keyLocation, urlList: list }),
      });
      status = res.status;
    } catch (err) {
      error = String((err && err.message) || err);
    }
    record = { at: isoNow(), count: list.length, status };
    if (error) record.error = error;
  }
  if (env.KV) {
    try {
      await env.KV.put("indexnow:last", JSON.stringify(record));
    } catch {
      // a KV outage never blocks IndexNow from having been attempted; only the log is lost
    }
  }
  return record;
}
