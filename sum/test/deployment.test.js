import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "../server.js";

test("Docker image includes every local runtime module and excludes secrets", async () => {
  const docker = await fs.readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  const ignore = await fs.readFile(new URL("../.dockerignore", import.meta.url), "utf8");
  const copied = [...docker.matchAll(/^COPY (.+) \.\/$/gm)].flatMap(match => match[1].split(/\s+/));
  for (const file of copied.filter(name => /\.(?:js|mjs)$/.test(name))) {
    const source = await fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");
    for (const match of source.matchAll(/from\s+["']\.\/([^"']+)["']/g)) {
      assert.ok(copied.includes(match[1]), `${file} dependency missing in Docker: ${match[1]}`);
    }
  }
  assert.ok(ignore.split(/\r?\n/).includes("API-설정.env"));
  assert.ok(!copied.some(name => name.endsWith(".env")));
  assert.doesNotMatch(docker, /^COPY data \.\/data/m);
});

test("provider quota errors remain explicit in HTTP responses", async () => {
  const server = createServer({ refreshSnapshots: false, islandLoader: async () => { throw Object.assign(new Error("rate limited"), { status: 429 }); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/islands`);
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error, "tour_api_rate_limited");
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("map searches reject stale responses and weather requests have a timeout", async () => {
  const map = await fs.readFile(new URL("../map.html", import.meta.url), "utf8");
  const index = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(map, /version !== placeSearchVersion/);
  assert.match(map, /https:\/\/map\.kakao\.com\//);
  assert.match(index, /fetch\(candidate, \{ cache: "no-store", signal: AbortSignal\.timeout/);
  assert.match(index, /els\.weatherMapError\.hidden = true/);
});
