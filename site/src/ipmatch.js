// Dependency-free CIDR matching for IPv4 and IPv6, used to check a
// request IP against a vendor's published crawler IP ranges.

function ipv4ToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function ipv4InCidr(ip, cidr) {
  const [range, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function ipv6ToBigInt(ip) {
  // Expand :: and parse to a 128-bit BigInt.
  if (ip.includes(".")) return null; // skip v4-mapped forms, not needed here
  let [head, tail] = ip.split("::");
  let headParts = head ? head.split(":").filter((x) => x !== "") : [];
  let tailParts = tail ? tail.split(":").filter((x) => x !== "") : [];
  if (ip.indexOf("::") === -1) {
    headParts = ip.split(":");
    tailParts = [];
  }
  const missing = 8 - (headParts.length + tailParts.length);
  if (missing < 0) return null;
  const full = [...headParts, ...Array(missing).fill("0"), ...tailParts];
  if (full.length !== 8) return null;
  let n = 0n;
  for (const part of full) {
    const v = BigInt(parseInt(part || "0", 16));
    n = (n << 16n) | v;
  }
  return n;
}

function ipv6InCidr(ip, cidr) {
  const [range, bitsStr] = cidr.split("/");
  const bits = BigInt(Number(bitsStr));
  const ipInt = ipv6ToBigInt(ip);
  const rangeInt = ipv6ToBigInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits === 0n) return true;
  const shift = 128n - bits;
  const mask = shift === 0n ? (2n ** 128n - 1n) : ~((2n ** shift) - 1n) & (2n ** 128n - 1n);
  return (ipInt & mask) === (rangeInt & mask);
}

export function ipInCidr(ip, cidr) {
  if (!ip || !cidr) return false;
  try {
    if (ip.includes(":") || cidr.includes(":")) return ipv6InCidr(ip, cidr);
    return ipv4InCidr(ip, cidr);
  } catch {
    return false;
  }
}

export function ipInAnyCidr(ip, cidrList) {
  return cidrList.some((c) => ipInCidr(ip, c));
}

// Parse a vendor IP-range JSON document (OpenAI/Anthropic/Perplexity/Google/
// Apple/Bing all publish some variant of { prefixes: [{ipv4Prefix|ipv6Prefix}] }
// or { prefixes: [{ipv4Prefix}] } / bing's { prefixes: [{ipv4Prefix}] }).
// Returns a flat array of CIDR strings.
export function parseIpListJson(json) {
  const out = [];
  const prefixes = json && json.prefixes;
  if (Array.isArray(prefixes)) {
    for (const p of prefixes) {
      if (!p) continue;
      if (p.ipv4Prefix) out.push(p.ipv4Prefix);
      if (p.ipv6Prefix) out.push(p.ipv6Prefix);
    }
  }
  return out;
}
