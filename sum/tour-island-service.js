import { loadApiEnv } from "./api-env.js";
import { apiConfig, buildApiUrl } from "./api-config.js";

const DISCOVERABLE_CONTENT_TYPES = new Set(["12", "14", "25", "28"]);
const COMMERCIALLY_USABLE_IMAGE_TYPES = new Set(["Type1", "Type3"]);
const pendingRequests = new WeakMap();
export async function getTourIslands({ fetchImpl = fetch } = {}) {
  // Competition FAQ: serve TourAPI live, never substitute a stored catalogue.
  // Share only an in-flight request; completed tourism data is not cached.
  if (pendingRequests.has(fetchImpl)) return pendingRequests.get(fetchImpl);
  const pending = loadTourIslands(fetchImpl);
  pendingRequests.set(fetchImpl, pending);
  try { return await pending; }
  finally { pendingRequests.delete(fetchImpl); }
}

async function loadTourIslands(fetchImpl) {
  const env = await loadApiEnv();
  const request = (url) => fetchJson(url, fetchImpl);
  const areaItems = [];
  for (let pageNo = 1; ; pageNo += 1) {
    const areaPayload = await request(buildApiUrl("tourApi", "areaBased", { numOfRows: 300, pageNo }, env));
    const body = areaPayload.response.body;
    areaItems.push(...asArray(body?.items?.item));
    if (areaItems.length >= Number(body?.totalCount || 0) || !asArray(body?.items?.item).length) break;
    if (pageNo >= 30) throw new Error("TourAPI pagination limit exceeded");
  }
  const seededMatches = Object.entries(apiConfig.islands).flatMap(([id, seed]) => {
    const related = areaItems.filter((item) => seed.aliases.some((alias) => includesText(item.title, alias) || includesText(item.addr1, alias)));
    const primary = [...related].sort((left, right) => scoreItem(right, seed) - scoreItem(left, seed))[0];
    return primary && validLocation(primary) ? [{ id, seed, primary, related }] : [];
  });
  const configuredNames = new Set(Object.values(apiConfig.islands).map((seed) => normalizeName(seed.keyword)));
  const discoveredGroups = new Map();
  for (const item of areaItems) {
    const name = extractIslandName(item.title);
    if (!name || configuredNames.has(normalizeName(name)) || !validLocation(item) || !DISCOVERABLE_CONTENT_TYPES.has(String(item.contenttypeid))) continue;
    const group = discoveredGroups.get(name) || [];
    group.push(item);
    discoveredGroups.set(name, group);
  }
  const discoveredMatches = [...discoveredGroups.entries()].map(([name, related]) => {
    const seed = { keyword: name, aliases: [name] };
    const primary = [...related].sort((left, right) => scoreItem(right, seed) - scoreItem(left, seed))[0];
    return { id: `tour-${primary.contentid}`, seed, primary, related };
  });
  const matches = [...seededMatches, ...discoveredMatches];
  const islands = [];
  let detailsUnavailable = 0;
  let rateLimited = false;
  const detailDeadline = Date.now() + 20_000;
  // Detail enrichment must not discard a successfully fetched live area list.
  // Sequential requests avoid the previous burst of one request per island.
  for (const { id, seed, primary, related } of matches) {
    let detail = {};
    let detailAvailable = false;
    if (!rateLimited && Date.now() < detailDeadline) {
      try {
        detail = await fetchTourDetail(primary.contentid, env, request);
        detailAvailable = Object.keys(detail).length > 0;
      } catch (error) {
        rateLimited = error.status === 429;
      }
    }
    if (!detailAvailable) detailsUnavailable += 1;
    islands.push({ ...normalizeIsland(id, seed, { ...primary, ...detail }, related), detailAvailable });
  }
  if (!islands.length) throw new Error("TourAPI returned no matching islands");
  return {
    ok: true,
    delivery: "live-api",
    partial: detailsUnavailable > 0,
    detailsUnavailable,
    warning: detailsUnavailable ? (rateLimited ? "tour_detail_rate_limited" : "tour_detail_unavailable") : null,
    attribution: "출처: ⓒ한국관광공사",
    generatedAt: new Date().toISOString(),
    source: apiConfig.providers.tourApi.label,
    sourceUrl: apiConfig.providers.tourApi.docsUrl,
    islands
  };
}

async function fetchTourDetail(contentId, env, request) {
  const payload = await request(buildApiUrl("tourApi", "detailCommon", {
    contentId,
    arrange: null,
    areaCode: null,
    sigunguCode: null,
    numOfRows: null,
    pageNo: null
  }, env));
  return asArray(payload?.response?.body?.items?.item)[0] || {};
}

function normalizeIsland(id, seed, item, related) {
  const name = seed.keyword;
  const overview = stripHtml(item.overview || "");
  const address = `${item.addr1 || ""} ${item.addr2 || ""}`.trim();
  const tags = extractTags(`${name} ${overview}`);
  const themes = extractThemes(`${name} ${overview}`);
  const searchUrl = `${apiConfig.publicSites.visitKoreaSearch}?keyword=${encodeURIComponent(name)}`;
  const highlights = sentenceSummary(overview);
  const profileText = `${name} ${overview} ${related.map((record) => record.title || "").join(" ")}`;
  const difficulty = difficultyProfile(profileText, seed.ferryRequired === false);
  const season = seasonProfile(profileText);
  const facilities = facilityProfile(related, seed.ferryRequired === false);
  const audiences = audienceProfile(difficulty.level, seed.ferryRequired === false);
  const imageSource = [item, ...related].find((record) => record.firstimage && COMMERCIALLY_USABLE_IMAGE_TYPES.has(record.cpyrhtDivCd));
  const imageRightsCode = imageSource?.cpyrhtDivCd || "";
  if (highlights.length < 2) highlights.push("운항·교통·입도 가능 여부는 방문 전 공식 채널에서 확인하세요.");
  return {
    id,
    contentId: String(item.contentid || ""),
    name,
    type: themes.includes("walk") ? "섬길 걷기" : themes.includes("nature") ? "자연 여행" : "섬 휴식",
    themes,
    season: season.label,
    seasonNote: season.note,
    summary: overview ? truncate(overview, 105) : `${address || "여수"}에서 만나는 섬 여행지입니다.`,
    access: address.match(/여수시\s+([^\s]+)/)?.[1] || "교통편 확인",
    duration: difficulty.level === "easy" ? "2~4시간" : difficulty.level === "challenge" ? "반나절 이상" : "3~5시간",
    best: tags[0] || "다도해 풍경",
    tags,
    highlights: highlights.slice(0, 2),
    officialUrl: searchUrl,
    image: toHttps(imageSource?.firstimage || ""),
    photoUrl: searchUrl,
    credit: imageSource ? "한국관광공사" : "공식 사진 미제공",
    license: copyrightLabel(imageRightsCode),
    imageRightsCode,
    noDerivatives: imageRightsCode === "Type3",
    location: { lat: Number(item.mapy), lon: Number(item.mapx) },
    note: tags.slice(0, 2).join("·") || "공식 관광정보",
    difficultyLevel: difficulty.level,
    difficultyLabel: difficulty.label,
    audiences,
    facilities,
    relatedItems: related.slice(0, 8).map(normalizeRelatedItem)
  };
}

function difficultyProfile(text, roadAccess) {
  if (roadAccess || /근린공원|산책|진섬다리|대교|차량/.test(text)) return { level: "easy", label: "가벼움" };
  if (/비렁길|트레킹|등산|산행|절벽|가파른|둘레길/.test(text)) return { level: "challenge", label: "활동적" };
  return { level: "normal", label: "보통" };
}

function seasonProfile(text) {
  if (/동백|유채|진달래|꽃섬|꽃길|봄꽃/.test(text)) return { label: "봄", note: "TourAPI 꽃·경관 콘텐츠 기반 추천 · 개화 시기 공식 확인" };
  if (/해수욕장|물놀이|피서/.test(text)) return { label: "여름", note: "TourAPI 해변 콘텐츠 기반 추천 · 개장 여부 공식 확인" };
  if (/공룡|화석|트레킹|비렁길|둘레길/.test(text)) return { label: "봄·가을", note: "야외 탐방에 비교적 좋은 계절 · 당일 기상 확인" };
  if (/일출|등대|동백/.test(text)) return { label: "가을·겨울", note: "해안 경관 콘텐츠 기반 추천 · 강풍·운항 확인" };
  return { label: "사계절", note: "공식 관광정보와 당일 날씨 확인" };
}

function facilityProfile(items, roadAccess) {
  const types = new Set(items.map((item) => String(item.contenttypeid || "")));
  const facilities = [];
  if (types.has("32")) facilities.push("숙박정보");
  if (types.has("39")) facilities.push("식당정보");
  if (types.has("38")) facilities.push("쇼핑·매점정보");
  if (roadAccess) facilities.push("육로접근");
  facilities.push("주변지도 확인");
  return [...new Set(facilities)];
}

function audienceProfile(difficulty, roadAccess) {
  if (difficulty === "easy" || roadAccess) return ["family", "senior", "relaxed"];
  if (difficulty === "challenge") return ["active"];
  return ["family", "active"];
}

function normalizeRelatedItem(item) {
  return {
    contentTypeId: String(item.contenttypeid || ""),
    title: String(item.title || ""),
    address: `${item.addr1 || ""} ${item.addr2 || ""}`.trim()
  };
}

function scoreItem(item, seed) {
  const title = String(item.title || "").replace(/\s+/g, "");
  const keyword = seed.keyword.replace(/\s+/g, "");
  return (title === keyword ? 100 : title.includes(keyword) ? 45 : 0)
    + (String(item.contenttypeid) === "12" ? 15 : 0)
    + (item.firstimage ? 8 : 0)
    + (validLocation(item) ? 5 : 0);
}

function extractTags(text) {
  const candidates = ["비렁길", "등대", "해수욕장", "공룡", "화석", "꽃", "산책", "트레킹", "항구", "일출", "낚시", "자연"];
  const found = candidates.filter((tag) => text.includes(tag)).slice(0, 3);
  return found.length ? found : ["섬여행", "다도해", "공식정보"];
}

function extractThemes(text) {
  const themes = [];
  if (/길|산책|트레킹|등산/.test(text)) themes.push("walk");
  if (/자연|해안|바다|등대|해수욕장|공룡|화석|숲/.test(text)) themes.push("nature");
  themes.push("rest");
  return [...new Set(themes)];
}

function sentenceSummary(text) {
  return text.split(/(?<=[.!?])\s+/).map((value) => value.trim()).filter(Boolean).slice(0, 2).map((value) => truncate(value, 130));
}

function copyrightLabel(code) {
  return ({
    Type1: "공공누리 제1유형(출처표시)",
    Type2: "공공누리 제2유형(출처표시·상업적 이용금지)",
    Type3: "공공누리 제3유형(출처표시·변경금지)",
    Type4: "공공누리 제4유형(출처표시·상업적 이용금지·변경금지)"
  })[code] || "공식 사진 미제공";
}

function stripHtml(value) {
  return String(value).replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function truncate(value, length) {
  return value.length > length ? `${value.slice(0, length - 1).trim()}…` : value;
}

function includesText(value, target) {
  return String(value || "").replace(/\s+/g, "").includes(String(target || "").replace(/\s+/g, ""));
}

export function extractIslandName(value) {
  const title = String(value || "").replace(/^여수\s+/, "").replace(/\s+/g, "");
  const match = title.match(/^([가-힣]{1,7}?도)(?:$|\(|리|등대|해수욕장|어촌|항|대교|근린공원|유람선|보금자리|꽃섬길|회관)/);
  if (!match) return "";
  const name = match[1];
  const excluded = new Set(["전라도", "무인도", "국도", "철도", "지도", "정도", "용도", "별도", "속도", "한도"]);
  return excluded.has(name) ? "" : name;
}

function normalizeName(value) {
  return String(value || "").replace(/\s|·백도|\(여수\)/g, "");
}

function toHttps(value) {
  return String(value || "").replace(/^http:\/\//i, "https://");
}

function validLocation(item) {
  return Number.isFinite(Number(item.mapx)) && Number(item.mapx) > 0 && Number.isFinite(Number(item.mapy)) && Number(item.mapy) > 0;
}

function asArray(value) { return Array.isArray(value) ? value : value ? [value] : []; }
function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    return match ? [[match[1], match[2]]] : [];
  }));
}
async function fetchJson(url, fetchImpl, attempts = 2) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw Object.assign(new Error(`TourAPI HTTP ${response.status}`), { status: response.status });
      const payload = await response.json();
      const code = payload?.response?.header?.resultCode;
      if (code !== "0000") throw Object.assign(new Error("TourAPI application response failed"), { status: String(code) === "22" ? 429 : 502 });
      return payload;
    } catch (error) {
      if (attempt === attempts || (error.status >= 400 && error.status < 500)) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
}
