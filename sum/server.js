import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getTourIslands } from "./tour-island-service.js";
import { createSnapshotReader } from "./snapshot-files.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = toPort(process.env.PORT, 4173);
const HOST = process.env.HOST || "0.0.0.0";
const execFileAsync = promisify(execFile);
let snapshotRefreshPromise = null;
let snapshotRetryAfter = 0;

/**
 * The recommendation catalogue is assembled from TourAPI on the server. Weather
 * and ferry records are read from API-generated JSON snapshots. This
 * server exposes only the exact application files the browser needs. The
 * Kakao Maps JavaScript key configuration is intentionally public because
 * browser map keys must be domain-restricted in Kakao Developers.
 */
export function createServer({ readSnapshot = createSnapshotReader(), refreshSnapshots = true, islandLoader = getTourIslands } = {}) {
  const handleRequest = async (req, res) => {
    setSecurityHeaders(res, req.headers.origin, /^\/map\.html(?:\?|$)/.test(req.url || ""));
    const method = req.method || "GET";

    if (method !== "GET" && method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return sendJson(res, { ok: false, error: "method_not_allowed" }, 405, method);
    }

    let requestUrl;
    try {
      requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    } catch {
      return sendText(res, "Bad request", 400, method);
    }

    if (requestUrl.pathname === "/api/health") {
      const today = koreaDateKey();
      const [ferry, weather] = await Promise.all([readSnapshot("ferry"), readSnapshot("weather")]);
      return sendJson(res, {
        ok: true,
        catalogue: "tour-api",
        tourDelivery: "live-api",
        storage: "json-snapshots",
        authentication: "none",
        today,
        snapshots: {
          ferryDate: ferry?.forecastDate || null,
          weatherDate: weather?.baseDate || null,
          fresh: ferry?.forecastDate === today && weather?.baseDate === today
        },
        message: "로그인·DB 없이 이용합니다. 관광공사 정보는 실시간 API, 배편·날씨는 API 생성 JSON으로 제공합니다."
      }, 200, method);
    }

    if (requestUrl.pathname === "/api/islands") {
      try {
        return sendJson(res, await islandLoader(), 200, method);
      } catch (error) {
        console.error("TourAPI island catalogue failed:", error?.message || error);
        if (error?.status === 429) {
          return sendJson(res, { ok: false, error: "tour_api_rate_limited" }, 429, method);
        }
        return sendJson(res, { ok: false, error: "tour_api_unavailable" }, 503, method);
      }
    }

    if (requestUrl.pathname === "/data/ferry-api.json" || requestUrl.pathname === "/data/weather-api.json") {
      try {
        if (refreshSnapshots) await ensureDailySnapshots(readSnapshot);
      } catch (error) {
        console.error("Daily ferry/weather refresh failed; serving the last snapshot:", error?.message || error);
      }
    }

    const datasetKind = new Map([
      ["/data/ferry-api.json", "ferry"],
      ["/data/weather-api.json", "weather"]
    ]).get(requestUrl.pathname);
    if (datasetKind) {
      const payload = await readSnapshot(datasetKind);
      return sendJson(res, payload || { ok: false, error: "dataset_unavailable" }, payload ? 200 : 503, method);
    }

    const publicFiles = new Map([
      ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
      ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
      ["/map.html", { file: "map.html", type: "text/html; charset=utf-8" }],
      ["/service-info.html", { file: "service-info.html", type: "text/html; charset=utf-8" }],
      ["/public-config.js", { file: "public-config.js", type: "text/javascript; charset=utf-8" }],
      ["/date-utils.js", { file: "date-utils.js", type: "text/javascript; charset=utf-8" }],
      ["/trip-utils.js", { file: "trip-utils.js", type: "text/javascript; charset=utf-8" }],
      ["/kakao-map-config.js", { file: "kakao-map-config.js", type: "text/javascript; charset=utf-8" }]
    ]);
    const publicFile = publicFiles.get(requestUrl.pathname);
    if (!publicFile) {
      return sendText(res, "Not found", 404, method);
    }

    const filePath = path.join(ROOT, publicFile.file);
    fs.stat(filePath, (error, stats) => {
      if (error || !stats.isFile()) return sendText(res, "Not found", 404, method);
      res.writeHead(200, {
        "Content-Type": publicFile.type,
        "Cache-Control": "no-store"
      });
      if (method === "HEAD") return res.end();
      const stream = fs.createReadStream(filePath);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    });
  };
  return http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error("Request failed:", error?.message || error);
      if (res.headersSent) return res.destroy();
      sendJson(res, { ok: false, error: "storage_unavailable" }, 503, req.method);
    });
  });
}

async function ensureDailySnapshots(readSnapshot) {
  const today = koreaDateKey();
  const [ferry, weather] = await Promise.all([readSnapshot("ferry"), readSnapshot("weather")]);
  if (ferry?.forecastDate === today && weather?.baseDate === today) return;
  if (Date.now() < snapshotRetryAfter) return;
  if (!snapshotRefreshPromise) {
    snapshotRefreshPromise = execFileAsync(process.execPath, [path.join(ROOT, "refresh-tour-data.mjs")], {
      cwd: ROOT,
      timeout: 180_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    }).catch(() => {
      snapshotRetryAfter = Date.now() + 60_000;
      throw new Error("Snapshot refresh failed; retry deferred for 60 seconds");
    }).finally(() => { snapshotRefreshPromise = null; });
  }
  await snapshotRefreshPromise;
}

function koreaDateKey(reference = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(reference).replaceAll("-", "");
}

function setSecurityHeaders(res, origin, embeddedMap = false) {
  if (/^http:\/\/(?:127\.0\.0\.1|localhost|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}):\d+$/.test(origin || "")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", embeddedMap ? "SAMEORIGIN" : "DENY");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com https://dapi.kakao.com https://t1.daumcdn.net; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://dapi.kakao.com https://*.daumcdn.net https://*.kakao.com; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors " + (embeddedMap ? "'self'" : "'none'")
  );
}

function sendJson(res, payload, status = 200, method = "GET") {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(method === "HEAD" ? undefined : JSON.stringify(payload));
}

function sendText(res, text, status, method = "GET") {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(method === "HEAD" ? undefined : text);
}

function toPort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const server = createServer();
  server.listen(PORT, HOST, () => console.log(`Seomuro: http://${HOST}:${PORT}`));
}
