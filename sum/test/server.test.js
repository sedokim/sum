import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { koreaInputDate } from "../date-utils.js";
import { createServer } from "../server.js";
import { extractIslandName } from "../tour-island-service.js";
import { ferryAvailability, suggestFerryTimes, recommendationScore } from "../trip-utils.js";
import { publicConfig } from "../public-config.js";

async function withServer(run) {
  const server = createServer({ refreshSnapshots: false });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("health reports the server-side TourAPI catalogue", { concurrency: false }, async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`, { headers: { Origin: "http://192.168.219.159:5500" } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.catalogue, "tour-api");
    assert.equal(body.storage, "json-snapshots");
    assert.equal(body.authentication, "none");
    assert.equal(body.database, undefined);
    assert.equal(body.tourDelivery, "live-api");
    assert.equal(response.headers.get("access-control-allow-origin"), "http://192.168.219.159:5500");
  });
});

test("Korea date advances exactly at midnight and supports future travel days", () => {
  assert.equal(koreaInputDate(0, new Date("2026-08-20T14:59:59Z")), "2026-08-20");
  assert.equal(koreaInputDate(0, new Date("2026-08-20T15:00:00Z")), "2026-08-21");
  assert.equal(koreaInputDate(1, new Date("2026-08-20T15:00:00Z")), "2026-08-22");
});

test("TourAPI attraction titles reveal additional Yeosu island names", () => {
  assert.equal(extractIslandName("여수 안도어촌체험마을"), "안도");
  assert.equal(extractIslandName("백야도 등대"), "백야도");
  assert.equal(extractIslandName("초도(여수)"), "초도");
  assert.equal(extractIslandName("일반 관광지"), "");
});

test("ferry utilities classify operations and propose endpoint times", () => {
  const record = {
    forecast: [{ date: "20260826", state: "정상운항" }, { date: "20260826", state: "기상통제" }],
    schedule: [
      { date: "20260826", relation: "endpoint", origin: "여수", destination: "금오도", targetStop: "금오도", time: "07:30" },
      { date: "20260826", relation: "endpoint", origin: "금오도", destination: "여수", targetStop: "금오도", time: "17:20" }
    ]
  };
  assert.equal(ferryAvailability(record, "20260826").level, "partial");
  assert.deepEqual(suggestFerryTimes(record, "20260826"), { inbound: "07:30", outbound: "17:20", source: "schedule", exact: false });
  assert.equal(ferryAvailability({ ferryRequired: false }, "20260826").level, "road");
  assert.ok(recommendationScore({ audiences: ["family"], difficultyLevel: "easy", facilities: ["음식점"] }, "family", "easy") > 40);
});

test("ferry reservations use the current KSA booking site", () => {
  assert.equal(publicConfig.publicSites.ferryReservation, "https://island.theksa.co.kr/page/booking?lang=");
});

test("application shell includes the proposal features and security headers", { concurrency: false }, async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl);
    const html = await response.text();
    assert.equal(response.status, 200);
    const contentSecurityPolicy = response.headers.get("content-security-policy") || "";
    assert.match(contentSecurityPolicy, /default-src 'self'/);
    assert.match(contentSecurityPolicy, /img-src 'self' https: data:/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(html, /let ISLANDS = \[\]/);
    assert.match(html, /publicConfig\.endpoints\.islands/);
    assert.doesNotMatch(html, /publicConfig\.endpoints\.islandSnapshot/);
    assert.doesNotMatch(html, /const ISLANDS = \[/);
    assert.match(html, /id="planner"/);
    assert.match(html, /id="travelDate"/);
    assert.match(html, /id="stayResult"/);
    assert.match(html, /id="seasonList"/);
    assert.match(html, /id="stampGrid"/);
    assert.doesNotMatch(html, /downloadPlan|printPlan|beforeprint|window\.print|printSummary/);
    assert.match(html, /id="nearbyMap"/);
    assert.match(html, /localStorage\.setItem\("seomuro-stamps"/);
    assert.match(html, /checkKoreaDateRollover/);
    assert.match(html, /visibilitychange/);
    assert.match(html, /snapshotsMatchToday/);
    assert.match(html, /hasNoDerivativesLicense/);
    assert.match(await (await fetch(`${baseUrl}/service-info.html`)).text(), /제1·제3유형만 표시/);
    assert.match(html, /id="menuToggle"/);
    assert.match(html, /id="featureMenu"/);
    assert.match(html, /data-view="weather"/);
    assert.match(html, /id="menuMapFrame"/);
    assert.doesNotMatch(html, /<section class="hero"/);
    assert.doesNotMatch(html, /<section class="source-panel"/);
    assert.doesNotMatch(html, /scrollIntoView/);
    assert.match(html, /photo-placeholder/);
    assert.match(html, /data-mobile-collapse/);
    assert.match(html, /syncResponsiveDetails/);
    assert.match(html, /시간대별 상세예보 펼치기/);
    assert.match(html, /예매·전화 방법 보기/);
    assert.match(html, /publicConfig\.publicSites\.ferryReservation/);
    assert.match(html, /id="reservationDialog"/);
    assert.match(html, /FERRY_CONTACTS/);
    assert.match(html, /grid-template-columns: 108px minmax\(0, 1fr\)/);
  });
});

test("saved TourAPI catalogue excludes non-tourism island matches and unsafe image licenses", async () => {
  const payload = JSON.parse(await fs.readFile(new URL("../data/islands-api.json", import.meta.url), "utf8"));
  assert.equal(payload.islands.some((island) => island.name === "경도" && island.relatedItems.every((item) => item.contentTypeId === "39")), false);
  for (const island of payload.islands) {
    assert.match(island.license, /공식 사진 미제공|공공누리 제[13]유형/);
    assert.equal(island.noDerivatives, island.imageRightsCode === "Type3");
  }
});

test("browser runtime dependencies and the nearby map are public", { concurrency: false }, async () => {
  await withServer(async (baseUrl) => {
    for (const [pathname, contentType] of [
      ["/public-config.js", /text\/javascript/],
      ["/date-utils.js", /text\/javascript/],
      ["/trip-utils.js", /text\/javascript/],
      ["/data/ferry-api.json", /application\/json/],
      ["/data/weather-api.json", /application\/json/]
    ]) {
      const response = await fetch(`${baseUrl}${pathname}`);
      assert.equal(response.status, 200, pathname);
      assert.match(response.headers.get("content-type") || "", contentType, pathname);
    }

    const mapResponse = await fetch(`${baseUrl}/map.html?island=jangdo`);
    const mapHtml = await mapResponse.text();
    assert.equal(mapResponse.status, 200);
    assert.equal(mapResponse.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.match(mapResponse.headers.get("content-security-policy"), /frame-ancestors 'self'/);
    assert.match(mapHtml, /섬 주변에서/);
    assert.match(mapHtml, /data-category="lodging"/);
    assert.match(mapHtml, /data-category="store"/);
    assert.match(mapHtml, /data-category="toilet"/);
    assert.match(mapHtml, /kakao\.maps\.services\.Places/);
    assert.match(mapHtml, /KAKAO_JAVASCRIPT_KEY/);

    const configResponse = await fetch(`${baseUrl}/kakao-map-config.js`);
    const config = await configResponse.text();
    assert.equal(configResponse.status, 200);
    assert.match(configResponse.headers.get("content-type") || "", /text\/javascript/);
    assert.match(config, /window\.SEOMURO_MAP_CONFIG/);
    assert.match(config, /KAKAO_JAVASCRIPT_KEY/);
  });
});

test("non-public local data and unsupported methods are rejected", { concurrency: false }, async () => {
  await withServer(async (baseUrl) => {
    for (const pathname of ["/.env", "/apikey", "/server.js", "/api-config.js", "/tour-island-service.js", "/data/tour-api.json", "/data/islands.js", "/assets/island-geumodo.png"]) {
      const response = await fetch(`${baseUrl}${pathname}`);
      assert.equal(response.status, 404, pathname);
    }
    const post = await fetch(`${baseUrl}/`, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");
  });
});
