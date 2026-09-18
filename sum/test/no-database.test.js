import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { createServer } from "../server.js";
import { createSnapshotReader } from "../snapshot-files.js";

test("ferry and weather JSON remain readable without a database", async () => {
  const read = createSnapshotReader();
  for (const kind of ["ferry", "weather"]) {
    const expected = JSON.parse(await fs.readFile(new URL(`../data/${kind}-api.json`, import.meta.url), "utf8"));
    assert.deepEqual(await read(kind), expected);
  }
  assert.equal(await read("islands"), null);
  assert.equal(await read("../.env"), null);
  assert.equal(await createSnapshotReader("missing-snapshot-test-dir")("weather"), null);
});

test("anonymous users can use service APIs and account endpoints do not exist", async () => {
  const payload = { ok: true, delivery: "live-api", islands: [{ id: "test" }] };
  const server = createServer({ refreshSnapshots: false, islandLoader: async () => payload });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const route of ["/", "/map.html", "/api/islands", "/data/ferry-api.json", "/data/weather-api.json"]) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("set-cookie"), null);
    }
    assert.deepEqual(await (await fetch(base + "/api/islands")).json(), payload);
    for (const route of ["/api/auth/me", "/login.html", "/auth.js", "/auth-store.js", "/database.js", "/view_database.py", "/data/islands-api.json"]) {
      assert.equal((await fetch(base + route)).status, 404);
    }
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
