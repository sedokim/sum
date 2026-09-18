const target = process.argv[2] || "http://localhost:4173";
let base;
try { base = new URL(target); } catch { console.error("접속 가능한 서비스 URL을 입력하세요."); process.exit(1); }
if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("HTTP(S) URL without credentials required");
const checks = [];
async function check(label, run) {
  try { checks.push({ label, pass: Boolean(await run()) }); }
  catch { checks.push({ label, pass: false }); }
}
const get = (route) => fetch(new URL(route, base), { signal: AbortSignal.timeout(55000), cache: "no-store" });
await check("공개 HTTPS 주소 (로컬/LAN 주소 제외)", async () => base.protocol === "https:" && !/^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[|.*\.local$)/i.test(base.hostname));
await check("로그인·DB 없는 실시간 관광 API 방식", async () => {
  const response = await get("/api/health"); const body = await response.json();
  return response.ok && body.authentication === "none" && body.tourDelivery === "live-api" && body.storage === "json-snapshots" && !body.database;
});
await check("실제 관광공사 API 조회 성공", async () => {
  const response = await get("/api/islands"); const body = await response.json();
  return response.ok && body.delivery === "live-api" && body.islands?.length > 0 && !body.partial && body.attribution === "출처: ⓒ한국관광공사";
});
await check("배편·날씨 오늘 기준", async () => (await (await get("/api/health")).json()).snapshots?.fresh);
await check("모바일 설정 및 출처 안내", async () => {
  const response = await get("/"); const html = await response.text();
  return response.ok && html.includes('name="viewport"') && html.includes("출처: ⓒ한국관광공사") && html.includes("service-info.html");
});
await check("서비스·개인정보 안내 접근", async () => (await get("/service-info.html")).ok);
await check("비밀 파일과 과거 관광 JSON 비공개", async () => {
  for (const route of ["/.env", "/" + encodeURIComponent("API-설정.env"), "/api-env.js", "/api-config.js", "/database.js", "/seomuro.sqlite", "/data/islands-api.json"]) {
    if ((await get(route)).status !== 404) return false;
  }
  return true;
});
for (const { label, pass } of checks) console.log(`${pass ? "PASS" : "CHECK"} ${label}`);
console.log("별도 확인: 공식 양식 PDF, 대표 이미지 1장·상세 이미지 3~5장, 최종 팀원, 인증키 제출, 외부 휴대폰 접속, 제출 완료. 이 검사는 심사 적격 판정이 아닙니다.");
if (checks.some((item) => !item.pass)) process.exitCode = 1;
