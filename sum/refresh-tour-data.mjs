import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiConfig, buildApiUrl } from "./api-config.js";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const env = parseEnv(await fs.readFile(path.join(projectRoot, ".env"), "utf8"));
env.PUBLIC_DATA_SERVICE_KEY ||= env.TOUR_API_KEY;
const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: apiConfig.providers.tourApi.label,
  sourceUrl: apiConfig.providers.tourApi.docsUrl,
  islands: {}
};

for (const [id, island] of Object.entries(apiConfig.islands)) {
  console.log(`TourAPI: ${id}`);
  const url = buildApiUrl("tourApi", "keywordSearch", {
    keyword: island.keyword,
    numOfRows: 20,
    pageNo: 1
  }, env);
  const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`TourAPI HTTP ${response.status}: ${id}`);
  const payload = await response.json();
  if (payload?.response?.header?.resultCode !== "0000") {
    throw new Error(`TourAPI ${payload?.response?.header?.resultMsg || "unknown error"}: ${id}`);
  }
  const rawItems = payload?.response?.body?.items?.item;
  const items = (Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [])
    .slice(0, 6)
    .map((item) => ({
      contentId: String(item.contentid || ""),
      contentTypeId: String(item.contenttypeid || ""),
      title: String(item.title || ""),
      address: `${item.addr1 || ""} ${item.addr2 || ""}`.trim(),
      image: String(item.firstimage || ""),
      mapX: String(item.mapx || ""),
      mapY: String(item.mapy || "")
    }));
  result.islands[id] = { keyword: island.keyword, items };
  await new Promise((resolve) => setTimeout(resolve, 150));
}

const outputPath = path.resolve(projectRoot, apiConfig.localData.tourSnapshot);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`Done: ${outputPath}`);

const today = toKoreaDate(new Date());
const yesterday = toKoreaDate(new Date(Date.now() - 86_400_000));
const travelDates = koreaDateRange(3);
const allForecasts = [];
for (const date of travelDates) {
  console.log(`Ferry forecast: ${date}`);
  const forecastPayload = await fetchJson(buildApiUrl("ferryForecast", "tomorrow", { ilja: date }, env));
  if (forecastPayload?.header?.resultCode === "SC000") {
    allForecasts.push(...asArray(forecastPayload?.body?.dataList).map((item) => ({ ...item, _date: date })));
  } else {
    console.warn(`Ferry forecast unavailable: ${date} · ${forecastPayload?.header?.resultMsg || "no data"}`);
  }
  await wait(120);
}
const relevantForecasts = allForecasts.filter((item) => item.jbnm === "여수" && matchesAnyIsland(item));
const shipNames = [...new Set(relevantForecasts.map((item) => item.ygnm).filter(Boolean))];

const allSchedules = [];
for (const date of travelDates) {
  for (const shipName of shipNames) {
    console.log(`Ferry schedule: ${date} · ${shipName}`);
    const payload = await fetchJson(buildApiUrl("ferrySchedule", "schedules", {
      rlvtYmd: date,
      psnshpNm: shipName
    }, env));
    if (payload?.response?.header?.resultCode === "200") {
      allSchedules.push(...asArray(payload.response.body?.items?.item).map((item) => ({ ...item, _date: date })));
    } else if (payload?.response?.header?.resultCode !== "153") {
      throw new Error(`Ferry schedule error: ${payload?.response?.header?.resultMsg || shipName}`);
    }
    await wait(120);
  }
}

let statusDate = today;
let allStatuses = await fetchStatusPages(today);
if (!allStatuses.length) {
  statusDate = yesterday;
  allStatuses = await fetchStatusPages(yesterday);
}
const latestStatuses = latestStatusPerStop(allStatuses.filter((item) => shipNames.includes(item.psnshp_nm)));

const ferryResult = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  forecastDate: today,
  availableDates: travelDates,
  statusDate,
  sources: {
    forecast: apiConfig.providers.ferryForecast.docsUrl,
    schedule: apiConfig.providers.ferrySchedule.docsUrl,
    status: apiConfig.providers.ferryStatus.docsUrl
  },
  islands: {}
};

for (const [id, island] of Object.entries(apiConfig.islands)) {
  ferryResult.islands[id] = {
    ferryRequired: island.ferryRequired,
    forecast: island.ferryRequired ? limitPerDate(relevantForecasts.filter((item) => matchesForecastStops(item, island.ferryStops)).map((item) => normalizeForecast(item, island.ferryStops)), 12) : [],
    schedule: island.ferryRequired ? limitPerDate(allSchedules.filter((item) => matchesScheduleIsland(item, island.ferryStops)).map((item) => normalizeSchedule(item, island.ferryStops)), 12) : [],
    status: island.ferryRequired ? latestStatuses.filter((item) => matchesStatusIsland(item, island.ferryStops)).map(normalizeStatus).slice(0, 8) : []
  };
}

const ferryOutputPath = path.resolve(projectRoot, apiConfig.localData.ferrySnapshot);
await fs.writeFile(ferryOutputPath, `${JSON.stringify(ferryResult, null, 2)}\n`, "utf8");
console.log(`Done: ${ferryOutputPath}`);

const weatherBase = latestKmaBase();
const currentForecastStamp = koreaDateTimeStamp();
const weatherResult = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  baseDate: weatherBase.baseDate,
  baseTime: weatherBase.baseTime,
  source: apiConfig.providers.weatherForecast.label,
  sourceUrl: apiConfig.providers.weatherForecast.docsUrl,
  islands: {}
};
const weatherByGrid = new Map();

for (const [id, island] of Object.entries(apiConfig.islands)) {
  const grid = toKmaGrid(island.location.lat, island.location.lon);
  const gridKey = `${grid.nx},${grid.ny}`;
  let hourly = weatherByGrid.get(gridKey);
  if (!hourly) {
    console.log(`KMA forecast: grid ${gridKey}`);
    const payload = await fetchJson(buildApiUrl("weatherForecast", "villageForecast", {
      base_date: weatherBase.baseDate,
      base_time: weatherBase.baseTime,
      nx: grid.nx,
      ny: grid.ny,
      numOfRows: 2000
    }, env));
    if (payload?.response?.header?.resultCode !== "00") {
      throw new Error(`KMA forecast error: ${payload?.response?.header?.resultMsg || gridKey}`);
    }
    hourly = normalizeWeather(payload?.response?.body?.items?.item, currentForecastStamp);
    weatherByGrid.set(gridKey, hourly);
    await wait(120);
  }
  weatherResult.islands[id] = {
    location: island.location,
    grid,
    current: hourly[0] || null,
    hourly
  };
}

const weatherOutputPath = path.resolve(projectRoot, apiConfig.localData.weatherSnapshot);
await fs.writeFile(weatherOutputPath, `${JSON.stringify(weatherResult, null, 2)}\n`, "utf8");
console.log(`Done: ${weatherOutputPath}`);

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    return match ? [[match[1], match[2]]] : [];
  }));
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url.hostname}`);
  return response.json();
}

async function fetchStatusPages(date) {
  const first = await fetchJson(buildApiUrl("ferryStatus", "statuses", { rlvtYmd: date, pageNo: 1 }, env));
  const code = first?.response?.header?.resultCode;
  if (code === "153") return [];
  if (code !== "200") throw new Error(`Ferry status error: ${first?.response?.header?.resultMsg || "unknown"}`);
  const items = [...asArray(first.response.body?.items?.item)];
  const total = Number(first.response.body?.totalCount || items.length);
  const pages = Math.ceil(total / 1000);
  for (let pageNo = 2; pageNo <= pages; pageNo += 1) {
    console.log(`Ferry status: ${date} page ${pageNo}/${pages}`);
    const payload = await fetchJson(buildApiUrl("ferryStatus", "statuses", { rlvtYmd: date, pageNo }, env));
    if (payload?.response?.header?.resultCode === "200") items.push(...asArray(payload.response.body?.items?.item));
    await wait(120);
  }
  return items;
}

function matchesAnyIsland(item) {
  return Object.values(apiConfig.islands).some((island) => island.ferryRequired && matchesForecastStops(item, island.ferryStops));
}

function matchesForecastStops(item, stops) {
  const ports = splitPorts(item.gicdName);
  return stops.some((stop) => ports.some((port) => portMatchesStop(port, stop)));
}

function matchesScheduleIsland(item, stops) {
  const endpoints = [item.oport_nm, item.dest_nm].filter(Boolean);
  if (stops.some((stop) => endpoints.some((port) => portMatchesStop(port, stop)))) return true;
  // The secondary route name can describe the vessel's whole licensed route,
  // including stops that are not visited by this particular sailing.
  const route = item.nvg_seawy_nm || item.lcns_seawy_nm || "";
  return stops.some((stop) => routeMentionsStop(route, stop));
}

function matchesStatusIsland(item, stops) {
  if (stops.some((stop) => portMatchesStop(item.portcl_nm, stop))) return true;
  // A blank port is a route-wide underway event; a named different port is
  // an event for that other island and must not appear in this island's card.
  if (String(item.portcl_nm || "").trim()) return false;
  const route = item.nvg_seawy_nm || item.lcns_seawy_nm || "";
  return stops.some((stop) => routeMentionsStop(route, stop));
}

function splitPorts(value) {
  return String(value || "").split(/[,>→]/).map((port) => port.trim()).filter(Boolean);
}

function portMatchesStop(port, stop) {
  const portName = normalizePort(port);
  const stopName = normalizePort(stop);
  return portName === stopName || portName.startsWith(`${stopName}(`);
}

function routeMentionsStop(route, stop) {
  let routeName = normalizePort(route);
  const stopName = normalizePort(stop).replace(/\(.+\)$/, "");
  if (stopName === "거문") routeName = routeName.replaceAll("소거문", "");
  return Boolean(stopName && routeName.includes(stopName));
}

function normalizePort(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function latestStatusPerStop(items) {
  const latest = new Map();
  for (const item of items) {
    const key = [item.psnshp_nm, item.sail_tm, item.portcl_nm].join(":");
    const previous = latest.get(key);
    if (!previous || String(item.nvg_stts_chg_dt || "") > String(previous.nvg_stts_chg_dt || "")) latest.set(key, item);
  }
  return [...latest.values()].sort((a, b) => String(b.nvg_stts_chg_dt || "").localeCompare(String(a.nvg_stts_chg_dt || "")));
}

function normalizeForecast(item, stops) {
  const routePorts = splitPorts(item.gicdName);
  const targetIndices = routePorts
    .map((port, index) => stops.some((stop) => portMatchesStop(port, stop)) ? index : -1)
    .filter((index) => index >= 0);
  const endpointIndex = targetIndices.find((index) => index === 0 || index === routePorts.length - 1);
  const targetIndex = endpointIndex ?? targetIndices[0] ?? -1;
  const targetStop = targetIndex >= 0 ? routePorts[targetIndex] : "";
  const relation = targetIndex === 0 || targetIndex === routePorts.length - 1 ? "endpoint" : "via";
  return { date: item._date || item.ilja || "", time: formatTime(item.chtm), ship: item.ygnm || "", departure: item.chjcnm || "", route: item.uhcdnm || item.mhcdnm || "", stops: item.gicdName || "", targetStop, relation, state: item.uhgbnm || "", note: item.bigo || "" };
}

function normalizeSchedule(item, stops) {
  const endpoints = [item.oport_nm, item.dest_nm].filter(Boolean);
  const directStop = endpoints.find((port) => stops.some((stop) => portMatchesStop(port, stop))) || "";
  const route = item.nvg_seawy_nm || item.lcns_seawy_nm || "";
  const routeStop = stops.find((stop) => routeMentionsStop(route, stop)) || "";
  return { date: item._date || item.rlvt_ymd || "", time: formatTime(item.sail_tm), ship: item.psnshp_nm || "", origin: item.oport_nm || "", destination: item.dest_nm || "", route, targetStop: directStop || routeStop, relation: directStop ? "endpoint" : "via", state: item.nvg_stts_nm || item.nvg_se_nm || "", reason: item.cntrl_rsn_nm || item.nnavi_rsn_nm || item.cnls_etc_rsn || "" };
}

function normalizeStatus(item) {
  return { time: formatTime(item.sail_tm), ship: item.psnshp_nm || "", port: item.portcl_nm || "", route: item.nvg_seawy_nm || item.lcns_seawy_nm || "", state: item.nvg_stts_nm || "", changedAt: item.nvg_stts_chg_dt || "" };
}

function asArray(value) { return Array.isArray(value) ? value : value ? [value] : []; }
function limitPerDate(items, limit) {
  const counts = new Map();
  return items.filter((item) => {
    const count = counts.get(item.date) || 0;
    if (count >= limit) return false;
    counts.set(item.date, count + 1);
    return true;
  });
}
function formatTime(value) { const text = String(value || "").padStart(4, "0"); return `${text.slice(0, 2)}:${text.slice(2, 4)}`; }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function toKoreaDate(date) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date).replaceAll("-", ""); }
function koreaDateRange(days) { return Array.from({ length: days }, (_, index) => toKoreaDate(new Date(Date.now() + index * 86_400_000))); }

function latestKmaBase(now = new Date()) {
  const safeTime = new Date(now.getTime() - 20 * 60_000);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hourCycle: "h23" }).format(safeTime));
  const cycles = [2, 5, 8, 11, 14, 17, 20, 23];
  const cycle = cycles.filter((value) => value <= hour).at(-1);
  if (cycle === undefined) {
    return { baseDate: toKoreaDate(new Date(safeTime.getTime() - 86_400_000)), baseTime: "2300" };
  }
  return { baseDate: toKoreaDate(safeTime), baseTime: `${String(cycle).padStart(2, "0")}00` };
}

function koreaDateTimeStamp(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}${value.hour}00`;
}

function normalizeWeather(items, currentStamp) {
  const timeline = new Map();
  for (const item of asArray(items)) {
    const key = `${item.fcstDate || ""}${String(item.fcstTime || "").padStart(4, "0")}`;
    if (key < currentStamp) continue;
    const point = timeline.get(key) || { date: item.fcstDate || "", time: formatTime(item.fcstTime) };
    point[item.category] = item.fcstValue;
    timeline.set(key, point);
  }
  return [...timeline.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 120).map(([, point]) => {
    const precipitationType = Number(point.PTY || 0);
    const sky = Number(point.SKY || 1);
    const wind = finiteNumber(point.WSD);
    const rainChance = finiteNumber(point.POP);
    const wave = finiteNumber(point.WAV);
    return {
      date: point.date,
      time: point.time,
      temperature: finiteNumber(point.TMP),
      rainChance,
      precipitationType,
      precipitation: String(point.PCP || "강수없음"),
      sky,
      humidity: finiteNumber(point.REH),
      wind,
      wave,
      icon: weatherIcon(precipitationType, sky),
      condition: weatherCondition(precipitationType, sky),
      travel: weatherTravelLevel({ precipitationType, rainChance, wind, wave })
    };
  });
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function weatherIcon(pty, sky) {
  if ([1, 4, 5].includes(pty)) return "🌧️";
  if ([2, 6].includes(pty)) return "🌨️";
  if ([3, 7].includes(pty)) return "❄️";
  if (sky === 4) return "☁️";
  if (sky === 3) return "⛅";
  return "☀️";
}

function weatherCondition(pty, sky) {
  if ([1, 4, 5].includes(pty)) return "비";
  if ([2, 6].includes(pty)) return "비·눈";
  if ([3, 7].includes(pty)) return "눈";
  return sky === 4 ? "흐림" : sky === 3 ? "구름많음" : "맑음";
}

function weatherTravelLevel({ precipitationType, rainChance, wind, wave }) {
  if ((wind ?? 0) >= 10 || (wave ?? 0) >= 2) return { level: "alert", label: "강풍·해상 주의" };
  if (precipitationType > 0 || (rainChance ?? 0) >= 60 || (wind ?? 0) >= 7 || (wave ?? 0) >= 1.5) return { level: "caution", label: "이동 주의" };
  return { level: "good", label: "이동 양호" };
}

function toKmaGrid(lat, lon) {
  const RE = 6371.00877;
  const GRID = 5.0;
  const SLAT1 = 30.0;
  const SLAT2 = 60.0;
  const OLON = 126.0;
  const OLAT = 38.0;
  const XO = 43;
  const YO = 136;
  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = Math.pow(sf, sn) * Math.cos(slat1) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = re * sf / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = re * sf / Math.pow(ra, sn);
  let theta = lon * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;
  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5)
  };
}
