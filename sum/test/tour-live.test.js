import assert from "node:assert/strict";
import test from "node:test";
import { getTourIslands } from "../tour-island-service.js";

const areaItems = ["금오도", "안도"].map((title, i) => ({ contentid: String(i + 1), contenttypeid: "12", title, addr1: "전라남도 여수시 남면", mapx: "127.75", mapy: "34.51" }));
const reply = (items) => ({ ok: true, json: async () => ({ response: { header: { resultCode: "0000" }, body: { totalCount: items.length, items: { item: items } } } }) });

test("detail rate limit preserves live islands and stops further detail calls", async () => {
  let details = 0;
  const result = await getTourIslands({ fetchImpl: async (url) => {
    if (String(url).includes("areaBasedList2")) return reply(areaItems);
    details++;
    return { ok: false, status: 429 };
  } });
  assert.equal(details, 1);
  assert.equal(result.islands.length, 2);
  assert.equal(result.partial, true);
  assert.equal(result.detailsUnavailable, 2);
  assert.equal(result.warning, "tour_detail_rate_limited");
  assert.equal(result.delivery, "live-api");
});

test("area rate limit is not retried or replaced with stored data", async () => {
  let calls = 0;
  await assert.rejects(getTourIslands({ fetchImpl: async () => {
    calls++;
    return { ok: false, status: 429 };
  } }), (error) => error.status === 429);
  assert.equal(calls, 1);
});

test("overlapping requests share only the active fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return reply([areaItems[0]]); };
  const [a, b] = await Promise.all([getTourIslands({ fetchImpl }), getTourIslands({ fetchImpl })]);
  assert.equal(a, b);
  assert.equal(calls, 2);
  await getTourIslands({ fetchImpl });
  assert.equal(calls, 4);
});

test("each catalogue request calls TourAPI without a database", async () => {
  let calls = 0;
  const item = { contentid: "123", contenttypeid: "12", title: "금오도", addr1: "전라남도 여수시 남면", mapx: "127.75", mapy: "34.51", overview: "금오도 섬길을 걷습니다." };
  const fetchImpl = async () => {
    calls++;
    return { ok: true, json: async () => ({ response: { header: { resultCode: "0000" }, body: { totalCount: 1, items: { item: [item] } } } }) };
  };
    const first = await getTourIslands({ fetchImpl });
    await getTourIslands({ fetchImpl });
    assert.equal(calls, 4);
    assert.equal(first.delivery, "live-api");
    assert.equal(first.attribution, "출처: ⓒ한국관광공사");
});
