// Local stand-in for Supabase's API gateway, for tests only (started by scripts/local-db/start.sh).
// Serves <url>/rest/v1/* from PostgREST with the /rest/v1 prefix stripped, which is what
// supabase-js calls (RPC: /rest/v1/rpc/<fn>). Like Supabase: an API key is required (the
// "apikey" header, or ?apikey=) and must be one of this database's two keys; it is removed
// before forwarding, and when there is no Authorization header the key becomes the Bearer token.
// The Authorization header is passed through as is. No dependencies.
// Logs carry the method, the path and the status only: never query strings, headers or bodies.
//
// Usage: node scripts/local-db/proxy.mjs <path to .local-db/env> [PostgREST port, default 3001]
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";

const [envFile, upstreamPort = "3001"] = process.argv.slice(2);
if (!envFile) {
  console.error("usage: node scripts/local-db/proxy.mjs <path to .local-db/env> [PostgREST port]");
  process.exit(2);
}

function readEnv(file) {
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = readEnv(envFile);
const digest = (s) => createHash("sha256").update(s).digest();
const KEYS = [env.SUPABASE_ANON_KEY, env.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean).map(digest);
if (KEYS.length !== 2) {
  console.error("proxy: the env file has no SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const listen = new URL(env.SUPABASE_URL || "http://127.0.0.1:54321");
const UPSTREAM = { host: "127.0.0.1", port: Number(upstreamPort) };
const PREFIX = "/rest/v1";

// Headers that belong to one connection, not to the request (RFC 9110 section 7.6.1).
const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade", "host"]);

function knownKey(key) {
  const d = digest(key);
  let ok = false;
  for (const k of KEYS) ok = timingSafeEqual(d, k) || ok;
  return ok;
}

function decode(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function log(method, path, status, started) {
  console.log(`${new Date().toISOString()} ${method} ${path} ${status} ${Date.now() - started}ms`);
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  const raw = req.url || "/";
  const q = raw.indexOf("?");
  const pathname = q === -1 ? raw : raw.slice(0, q);
  const query = q === -1 ? "" : raw.slice(q + 1);
  const method = req.method || "GET";

  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) {
    sendJson(res, 404, { message: "no Route matched with those values" });
    return log(method, pathname, 404, started);
  }
  if (pathname.split("/").some((seg) => seg === ".." || seg === "." || decode(seg) === "..")) {
    sendJson(res, 400, { message: "Bad path" });
    return log(method, pathname, 400, started);
  }

  // The API key: the header first, else ?apikey= (taken out of the query, like the gateway does).
  let apikey = typeof req.headers.apikey === "string" ? req.headers.apikey : "";
  const kept = [];
  for (const part of query ? query.split("&") : []) {
    const eq = part.indexOf("=");
    const name = decode(eq === -1 ? part : part.slice(0, eq));
    if (name === "apikey") {
      if (!apikey && eq !== -1) apikey = decode(part.slice(eq + 1));
      continue;
    }
    kept.push(part);
  }
  if (!apikey) {
    sendJson(res, 401, { message: "No API key found in request" });
    return log(method, pathname, 401, started);
  }
  if (!knownKey(apikey)) {
    sendJson(res, 401, { message: "Invalid API key" });
    return log(method, pathname, 401, started);
  }

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined && !HOP.has(k) && k !== "apikey") headers[k] = v;
  }
  if (!headers.authorization) headers.authorization = `Bearer ${apikey}`;
  const path = (pathname.slice(PREFIX.length) || "/") + (kept.length ? `?${kept.join("&")}` : "");

  const upstream = http.request({ ...UPSTREAM, method, path, headers }, (up) => {
    const out = {};
    for (const [k, v] of Object.entries(up.headers)) {
      if (v !== undefined && !HOP.has(k)) out[k] = v;
    }
    const status = up.statusCode || 502;
    res.writeHead(status, out);
    up.pipe(res);
    up.on("end", () => log(method, pathname, status, started));
  });
  upstream.on("error", () => {
    if (!res.headersSent) sendJson(res, 502, { message: "PostgREST is not reachable (is the local database running?)" });
    else res.destroy();
    log(method, pathname, 502, started);
  });
  req.on("aborted", () => upstream.destroy());
  req.pipe(upstream);
});

server.listen(Number(listen.port || 54321), listen.hostname, () => {
  console.log(`${new Date().toISOString()} proxy listening on http://${listen.hostname}:${listen.port}${PREFIX} -> PostgREST on 127.0.0.1:${UPSTREAM.port}`);
});
server.on("error", (err) => {
  console.error(`proxy: ${err.code || err.message}`);
  process.exit(1);
});
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
