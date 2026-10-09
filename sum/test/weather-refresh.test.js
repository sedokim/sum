import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { refreshSnapshots } from "../refresh-tour-data.mjs";
import { createDailySnapshotRefresher, createServer } from "../server.js";

const now = new Date("2026-10-09T00:00:00Z");
const env = { PUBLIC_DATA_SERVICE_KEY: "test-key" };
const quiet = { log() {}, warn() {} };
const weatherPayload = {
  response: {
    header: { resultCode: "00" },
    body: { items: { item: [
      ["TMP", "22"], ["POP", "10"], ["WSD", "3.5"], ["SKY", "1"], ["PTY", "0"]
    ].map(([category, fcstValue]) => ({ category, fcstValue, fcstDate: "20261009", fcstTime: "0900" })) } }
  }
};

async function withDirectory(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "seomuro-weather-test-"));
  try { await run(root); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

function options(root, extra = {}) {
  return { root, env, now, pause: async () => {}, logger: quiet, islandLoader: async () => ({ islands: [] }), ...extra };
}

test("failure of every ferry provider cannot prevent a successful weather snapshot", async () => {
  await withDirectory(async (root) => {
    await fs.mkdir(path.join(root, "data"));
    const previousFerry = '{"forecastDate":"20260918","islands":{}}';
    await fs.writeFile(path.join(root, "data/ferry-api.json"), previousFerry);
    const results = await refreshSnapshots(options(root, {
      request: async (url) => {
        if (url.pathname.includes("getVilageFcst")) return weatherPayload;
        throw new Error("HTTP 429: apis.data.go.kr");
      }
    }));
    assert.equal(results.ferry.status, "rejected");
    assert.equal(results.weather.status, "fulfilled");
    assert.equal(await fs.readFile(path.join(root, "data/ferry-api.json"), "utf8"), previousFerry);
    const weather = JSON.parse(await fs.readFile(path.join(root, "data/weather-api.json"), "utf8"));
    assert.equal(weather.forecastDate, "20261009");
    assert.equal(weather.islands.geumodo.current.temperature, 22);
    assert.equal(weather.partial, false);
    assert.equal((await fs.readdir(path.join(root, "data"))).some((file) => file.endsWith(".tmp")), false);
  });
});

test("weather-only refresh survives TourAPI failure and never calls ferry APIs", async () => {
  await withDirectory(async (root) => {
    const grids = [];
    const results = await refreshSnapshots(options(root, {
      kind: "weather",
      islandLoader: async () => { throw new Error("TourAPI unavailable"); },
      request: async (url) => {
        assert.ok(url.pathname.includes("getVilageFcst"));
        grids.push(`${url.searchParams.get("nx")},${url.searchParams.get("ny")}`);
        return weatherPayload;
      }
    }));
    assert.deepEqual(Object.keys(results), ["weather"]);
    assert.equal(results.weather.status, "fulfilled");
    assert.equal(Object.keys(results.weather.value.islands).length, 11);
    assert.equal(grids.length, new Set(grids).size);
  });
});

test("one failed KMA grid leaves other islands available and marks the snapshot partial", async () => {
  await withDirectory(async (root) => {
    let calls = 0;
    let active = 0;
    let peak = 0;
    const results = await refreshSnapshots(options(root, {
      kind: "weather",
      request: async () => {
        active += 1;
        peak = Math.max(peak, active);
        const fail = calls++ === 0;
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        if (fail) throw new Error("temporary failure");
        return weatherPayload;
      }
    }));
    assert.equal(results.weather.status, "fulfilled");
    assert.equal(results.weather.value.partial, true);
    assert.ok(results.weather.value.unavailableIslands.length > 0);
    assert.ok(Object.keys(results.weather.value.islands).length > 0);
    assert.ok(peak <= 3);
  });
});

test("failed weather refresh preserves the previous snapshot without publishing empty data", async () => {
  await withDirectory(async (root) => {
    await fs.mkdir(path.join(root, "data"));
    const previous = '{"baseDate":"20260918","islands":{}}';
    await fs.writeFile(path.join(root, "data/weather-api.json"), previous);
    const results = await refreshSnapshots(options(root, {
      kind: "weather",
      request: async () => ({ response: { header: { resultCode: "03" } } })
    }));
    assert.equal(results.weather.status, "rejected");
    assert.equal(await fs.readFile(path.join(root, "data/weather-api.json"), "utf8"), previous);
  });
});

test("midnight refresh uses yesterday's valid KMA issuance without repeated daily refresh", async () => {
  await withDirectory(async (root) => {
    let snapshot;
    const midnight = new Date("2026-10-08T15:01:00Z");
    const results = await refreshSnapshots(options(root, {
      kind: "weather", now: midnight,
      request: async (url) => {
        assert.equal(url.searchParams.get("base_date"), "20261008");
        assert.equal(url.searchParams.get("base_time"), "2300");
        return weatherPayload;
      }
    }));
    snapshot = results.weather.value;
    assert.equal(snapshot.forecastDate, "20261009");
    let refreshes = 0;
    const ensure = createDailySnapshotRefresher({
      readSnapshot: async () => snapshot,
      clock: () => midnight.getTime(),
      runRefresh: async () => { refreshes += 1; }
    });
    await ensure("weather");
    assert.equal(refreshes, 0);
  });
});

test("refresh locks and failure cooldowns are independent for weather and ferry", async () => {
  const calls = [];
  let weather;
  let release;
  const ensure = createDailySnapshotRefresher({
    readSnapshot: async (kind) => kind === "weather" ? weather : null,
    clock: () => now.getTime(),
    runRefresh: async (kind) => {
      calls.push(kind);
      if (kind === "ferry") throw new Error("rate limited");
      await new Promise((resolve) => { release = resolve; });
      weather = { forecastDate: "20261009" };
    }
  });
  await assert.rejects(ensure("ferry"));
  await ensure("ferry");
  const pending = [ensure("weather"), ensure("weather")];
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all(pending);
  await ensure("weather");
  assert.deepEqual(calls, ["ferry", "weather"]);
});

test("HTTP weather endpoint does not wait for a pending ferry refresh", async () => {
  const snapshots = {};
  let releaseFerry;
  let ferryStarted;
  const started = new Promise((resolve) => { ferryStarted = resolve; });
  const server = createServer({
    readSnapshot: async (kind) => snapshots[kind],
    runSnapshotRefresh: async (kind) => {
      if (kind === "ferry") {
        ferryStarted();
        await new Promise((resolve) => { releaseFerry = resolve; });
      }
      snapshots[kind] = { forecastDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()).replaceAll("-", ""), islands: {} };
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ferryRequest = fetch(`${base}/data/ferry-api.json`);
    await started;
    const weatherResponse = await fetch(`${base}/data/weather-api.json`, { signal: AbortSignal.timeout(2000) });
    assert.equal(weatherResponse.status, 200);
    assert.ok((await weatherResponse.json()).forecastDate);
    releaseFerry();
    assert.equal((await ferryRequest).status, 200);
  } finally {
    releaseFerry?.();
    await new Promise((resolve) => server.close(resolve));
  }
});
