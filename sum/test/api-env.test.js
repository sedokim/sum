import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadApiEnv, parseApiEnv } from "../api-env.js";
import { buildApiUrl } from "../api-config.js";
import { createServer } from "../server.js";

test("central API settings override legacy keys without breaking blank defaults", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "seom-api-test-"));
  try {
    await fs.writeFile(path.join(directory, ".env"), "TOUR_API_KEY=old-key\n");
    await fs.writeFile(path.join(directory, "API-설정.env"), "PUBLIC_DATA_SERVICE_KEY=new-key\nTOUR_API_KEY=\nFERRY_SCHEDULE_API_KEY=ship-key\n");
    const env = await loadApiEnv({ directory: pathToFileURL(directory + path.sep), environment: {} });
    assert.equal(buildApiUrl("tourApi", "areaBased", {}, env).searchParams.get("serviceKey"), "new-key");
    assert.equal(buildApiUrl("ferrySchedule", "schedules", {}, env).searchParams.get("serviceKey"), "ship-key");
    assert.equal(buildApiUrl("weatherForecast", "villageForecast", {}, env).searchParams.get("serviceKey"), "new-key");
    await fs.writeFile(path.join(directory, "API-설정.env"), "TOUR_API_KEY=new-tour\n");
    const separate = await loadApiEnv({ directory: pathToFileURL(directory + path.sep), environment: {} });
    assert.equal(buildApiUrl("tourApi", "areaBased", {}, separate).searchParams.get("serviceKey"), "new-tour");
    assert.equal(buildApiUrl("weatherForecast", "villageForecast", {}, separate).searchParams.get("serviceKey"), "old-key");
  } finally {
    await fs.unlink(path.join(directory, ".env"));
    await fs.unlink(path.join(directory, "API-설정.env"));
    await fs.rmdir(directory);
  }
});

test("blank and quoted configuration values are parsed safely", () => {
  assert.deepEqual(parseApiEnv('# comment\nA=\nB="test"\nC=abc%2B\n'), { B: "test", C: "abc%2B" });
});

test("Node server never serves central secret settings", async () => {
  const server = createServer({ refreshSnapshots: false });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/${encodeURIComponent("API-설정.env")}`);
    assert.equal(response.status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
