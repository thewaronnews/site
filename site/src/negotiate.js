// Content-negotiation: works out which of html/md/json a request wants,
// from a path suffix (.md / .json) first, then the Accept header, defaulting
// to html. Most fetchers send no useful Accept header, hence the suffix path.

export function resolveFormat(request, pathname) {
  if (pathname.endsWith(".json")) {
    let base = pathname.slice(0, -".json".length);
    if (base === "") base = "/";
    return { format: "json", basePath: base };
  }
  if (pathname.endsWith(".md")) {
    let base = pathname.slice(0, -".md".length);
    if (base === "") base = "/";
    return { format: "md", basePath: base };
  }
  const accept = (request.headers.get("Accept") || "").toLowerCase();
  let format = "html";
  if (accept.includes("text/markdown")) format = "md";
  else if (accept.includes("application/json") && !accept.includes("text/html")) format = "json";
  return { format, basePath: pathname };
}

export function contentTypeFor(format) {
  if (format === "json") return "application/json; charset=utf-8";
  if (format === "md") return "text/markdown; charset=utf-8";
  return "text/html; charset=utf-8";
}
