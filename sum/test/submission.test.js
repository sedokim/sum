import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createServer } from "../server.js";

test("optional warning banner and duplicate photo source action are removed", async () => {
  const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /출발 전 반드시 운항 여부를 확인하세요|이 서비스는 실시간 결항·좌석·시간표를 보장하지 않습니다|photoLink/);
  assert.match(html, /출처: ⓒ한국관광공사/);
  assert.match(html, /island\.credit/);
  assert.match(html, /island\.license/);
});

test("status guidance distinguishes actual API success from partial detail failure", async () => {
  const guide = await fs.readFile(new URL("../service-info.html", import.meta.url), "utf8");
  assert.match(guide, /actualTourCheck/);
  assert.match(guide, /catalogue\.partial/);
  assert.match(guide, /한국관광공사가 개발·운영하는 서비스가 아닙니다/);
  const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /island\.detailAvailable === false/);
});

test("all browser modules parse and tourist snapshot fallbacks are absent", async () => {
  for (const filename of ["index.html", "map.html", "service-info.html"]) {
    const html = await fs.readFile(new URL(`../${filename}`, import.meta.url), "utf8");
    assert.match(html, /출처: ⓒ한국관광공사/);
    assert.doesNotMatch(html, /endpoints\.islandSnapshot/);
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
      if (!match[1].trim()) continue;
      const result = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: match[1], encoding: "utf8", windowsHide: true });
      assert.equal(result.status, 0, `${filename}: ${result.stderr}`);
    }
  }
});

test("service guidance is public but failed live tourism is not replaced with a snapshot", async () => {
  const server = createServer({ refreshSnapshots: false, islandLoader: async () => { throw new Error("test upstream failure"); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const guide = await fetch(base + "/service-info.html");
    assert.equal(guide.status, 200);
    assert.match(await guide.text(), /로그인 없이/);
    const response = await fetch(base + "/api/islands");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: "tour_api_unavailable" });
    assert.equal((await fetch(base + "/data/islands-api.json")).status, 404);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
