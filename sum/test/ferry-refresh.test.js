import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { refreshSnapshots } from "../refresh-tour-data.mjs";
import { createDailySnapshotRefresher } from "../server.js";
import { ferryAvailability, ferryProviderNotice } from "../trip-utils.js";

const now = new Date("2026-10-09T03:00:00Z");
const env = { PUBLIC_DATA_SERVICE_KEY: "test-key" };
const quiet = { log() {}, warn() {} };
const forecastReply = (date) => ({
  header: { resultCode: "SC000" },
  body: { dataList: ["테스트선", "다른선"].map((ygnm) => ({ jbnm: "여수", gicdName: "여수,함구미", ygnm, chtm: "0900", uhgbnm: "정상", ilja: date })) }
});
const statusReply = {
  response: { header: { resultCode: "200" }, body: { totalCount: 1, items: { item: [
    { psnshp_nm: "운항예보에없는선박", portcl_nm: "함구미", sail_tm: "0900", nvg_stts_nm: "완료", nvg_stts_chg_dt: "2026-10-09T10:00:00" }
  ] } } }
};
const noSchedule = { response: { header: { resultCode: "153" } } };
const quotaError = () => Object.assign(new Error("HTTP 429"), { status: 429, code: "22" });

async function withDirectory(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "seomuro-ferry-test-"));
  try { await run(root); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function runRefresh(root, request) {
  return (await refreshSnapshots({ kind: "ferry", root, env, now, request, pause: async () => {}, logger: quiet })).ferry;
}

test("schedule daily limit still publishes current forecasts and independent sailing history", async () => {
  await withDirectory(async (root) => {
    let scheduleCalls = 0;
    const result = await runRefresh(root, async (url) => {
      if (url.pathname.includes("get_tmr_forecastnew")) return forecastReply(url.searchParams.get("ilja"));
      if (url.pathname.includes("get-ferry-route-info-v4")) return statusReply;
      scheduleCalls += 1;
      throw quotaError();
    });
    assert.equal(result.status, "fulfilled");
    assert.equal(scheduleCalls, 1, "do not retry an exhausted provider per date/vessel");
    const payload = JSON.parse(await fs.readFile(path.join(root, "data/ferry-api.json"), "utf8"));
    assert.equal(payload.forecastDate, "20261009");
    assert.equal(payload.partial, true);
    assert.equal(payload.providerStatus.schedule.reason, "daily_limit");
    assert.equal(payload.providerStatus.forecast.available, true);
    assert.equal(payload.providerStatus.status.available, true);
    assert.equal(payload.retryAfter, "2026-10-09T15:00:00.000Z");
    assert.equal(payload.islands.geumodo.forecast.length, 6);
    assert.equal(payload.islands.geumodo.schedule.length, 0);
    assert.equal(payload.islands.geumodo.status[0].ship, "운항예보에없는선박");
    assert.equal(payload.islands.geumodo.status[0].date, "20261009");
    assert.equal(payload.islands.geomundo.status.length, 0, "history must match the island's ports");
  });
});

test("history alone survives quota errors in both other providers", async () => {
  await withDirectory(async (root) => {
    const requests = [];
    const result = await runRefresh(root, async (url) => {
      requests.push(url.pathname);
      if (url.pathname.includes("get-ferry-route-info-v4")) return statusReply;
      throw quotaError();
    });
    assert.equal(result.status, "fulfilled");
    assert.equal(result.value.islands.geumodo.forecast.length, 0);
    assert.equal(result.value.islands.geumodo.status.length, 1);
    assert.equal(requests.filter((pathname) => pathname.includes("get_tmr_forecastnew")).length, 1);
    assert.equal(requests.filter((pathname) => pathname.includes("get-oprt-schd-info-v2")).length, 1);
    assert.equal(result.value.providerStatus.schedule.reason, "daily_limit");
  });
});

test("failed history provider does not discard valid forecasts or schedule responses", async () => {
  await withDirectory(async (root) => {
    const result = await runRefresh(root, async (url) => {
      if (url.pathname.includes("get_tmr_forecastnew")) return forecastReply(url.searchParams.get("ilja"));
      if (url.pathname.includes("get-oprt-schd-info-v2")) return noSchedule;
      throw new Error("history timeout");
    });
    assert.equal(result.status, "fulfilled");
    assert.ok(result.value.islands.geumodo.forecast.length > 0);
    assert.equal(result.value.providerStatus.status.available, false);
    assert.equal(result.value.providerStatus.schedule.available, true);
    assert.equal(result.value.providerStatus.status.reason, "unavailable");
    assert.equal(result.value.retryAfter, "2026-10-09T03:15:00.000Z");
  });
});

test("JSON quota envelopes are recognized even when the provider returns HTTP success", async () => {
  await withDirectory(async (root) => {
    const result = await runRefresh(root, async (url) => {
      if (url.pathname.includes("get_tmr_forecastnew")) return forecastReply(url.searchParams.get("ilja"));
      if (url.pathname.includes("get-ferry-route-info-v4")) return statusReply;
      return { OpenAPI_ServiceResponse: { cmmMsgHeader: { returnReasonCode: 22 } } };
    });
    assert.equal(result.value.providerStatus.schedule.reason, "daily_limit");
  });
});

test("a temporary forecast date failure does not discard other dates", async () => {
  await withDirectory(async (root) => {
    const result = await runRefresh(root, async (url) => {
      if (url.pathname.includes("get-ferry-route-info-v4")) return statusReply;
      if (url.pathname.includes("get-oprt-schd-info-v2")) return noSchedule;
      const date = url.searchParams.get("ilja");
      if (date === "20261010") throw new Error("temporary provider failure");
      return forecastReply(date);
    });
    assert.equal(result.status, "fulfilled");
    assert.deepEqual([...new Set(result.value.islands.geumodo.forecast.map((trip) => trip.date))], ["20261009", "20261011"]);
    assert.equal(result.value.providerStatus.forecast.partial, true);
  });
});

test("failure of all ferry providers preserves the last file", async () => {
  await withDirectory(async (root) => {
    await fs.mkdir(path.join(root, "data"));
    const previous = '{"forecastDate":"20260918","islands":{}}';
    await fs.writeFile(path.join(root, "data/ferry-api.json"), previous);
    const result = await runRefresh(root, async () => { throw quotaError(); });
    assert.equal(result.status, "rejected");
    assert.equal(await fs.readFile(path.join(root, "data/ferry-api.json"), "utf8"), previous);
  });
});

test("partial snapshots do not retry a daily limit until Korea midnight", async () => {
  let time = now.getTime();
  let refreshes = 0;
  const snapshot = { forecastDate: "20261009", partial: true, retryAfter: "2026-10-09T15:00:00.000Z" };
  const ensure = createDailySnapshotRefresher({ readSnapshot: async () => snapshot, clock: () => time, runRefresh: async () => { refreshes += 1; } });
  await ensure("ferry");
  time += 60_000;
  await ensure("ferry");
  assert.equal(refreshes, 0);
  time = Date.parse(snapshot.retryAfter);
  await ensure("ferry");
  assert.equal(refreshes, 1);
});

test("temporary provider failures can be retried during the same day", async () => {
  let time = now.getTime();
  let refreshes = 0;
  const snapshot = { forecastDate: "20261009", partial: true, retryAfter: "2026-10-09T03:15:00.000Z" };
  const ensure = createDailySnapshotRefresher({ readSnapshot: async () => snapshot, clock: () => time, runRefresh: async () => { refreshes += 1; } });
  await ensure("ferry");
  time = Date.parse(snapshot.retryAfter);
  await ensure("ferry");
  assert.equal(refreshes, 1);
});

test("limited provider notices and history-only labels never claim guaranteed operations", () => {
  assert.equal(ferryProviderNotice({ schedule: { partial: true, available: false, reason: "daily_limit" } }), "시간표: 일일 호출 한도 초과로 일시 미제공됩니다.");
  assert.equal(ferryProviderNotice({ schedule: { partial: false, available: true } }), "");
  const record = { forecast: [], status: [{ date: "20261009", state: "완료" }] };
  assert.equal(ferryAvailability(record, "20261009").label, "운항이력 있음");
  assert.equal(ferryAvailability(record, "20261009").potentiallyAvailable, false);
  assert.equal(ferryAvailability(record, "20261010").label, "선사 확인");
});
