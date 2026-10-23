// 하우스 게임 실전 QA: 실제 dev API 방에 들어가 칸 하나에 걸고(블랙잭은 앉아서 걸고 스탠드) 판이 끝날 때까지
// 2.6초마다 찍는다. shot.mjs 는 빈 방·대기 화면만 보므로 딜·쪼기·결과 배너·당첨 칸 같은 판 중 화면은 이걸로 본다.
// 헤드리스 크롬 + SwiftShader WebGL(3D 판). 진짜 코인이 오간다(dev 계정 claudedev, 최소 칩).
// usage (repo root, dev api 5100 + vite 5173):
//   node apps/web/qa/game-layout/play.mjs [roomRegex=.] [vpList=pc,port,land]
// 결과: ./shots/play/<vp>-<room>-<n>.png, 콘솔 오류는 방마다 출력. 0 issues 가 아니라 사진을 직접 열어볼 것.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 다른 작업과 서버를 나눠 쓸 때 QA_WEB·QA_API·CHROME_PATH 로 바꾼다(pvp-layout 러너와 같은 이름).
const ORIGIN = process.env.QA_WEB ?? "http://127.0.0.1:5173";
const API = process.env.QA_API ?? "http://127.0.0.1:5100";
const SHELL = process.env.CHROME_PATH;
const OUT = fileURLToPath(new URL("./shots/play/", import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORTS = { pc: [1440, 900], laptop: [1280, 720], port: [390, 844], land: [844, 390], small: [360, 640], landsm: [740, 360], land915: [915, 412] };

// [id, route, open(=베팅 가능 식), click 셀렉터들, 판 끝 식]
const ROOMS = [
  ["baccarat", "/rooms/10000000-0000-4000-8000-000000000001", "!!document.querySelector('.bac-grid:not(.is-locked)')", [".bac-zone.zone-banker"]],
  ["bonus", "/rooms/10500000-0000-4000-8000-000000000001", "!!document.querySelector('.bac-grid:not(.is-locked)')", [".bac-zone.zone-player"]],
  ["lightning", "/rooms/11000000-0000-4000-8000-000000000001", "!!document.querySelector('.bac-grid:not(.is-locked)')", [".bac-zone.zone-player"]],
  ["dragontiger", "/rooms/dragon-tiger/12000000-0000-4000-8000-000000000002", "!!document.querySelector('.bac-grid:not(.is-locked)')", [".bac-zone.zone-dragon"]],
  ["roulette", "/rooms/roulette/13000000-0000-4000-8000-000000000001", "!!document.querySelector('.rlt-board:not(.is-locked)')", [".rlt-cell.cell-red", ".rlt-cell.cell-straight-17"]],
  ["lroulette", "/rooms/roulette/13100000-0000-4000-8000-000000000001", "!!document.querySelector('.rlt-board:not(.is-locked)')", [".rlt-cell.cell-black"]],
  ["sicbo", "/rooms/sicbo/14000000-0000-4000-8000-000000000001", "!!document.querySelector('.sb-board:not(.is-locked)')", [".sb-cell.kind-small", ".sb-cell.kind-total"]],
  ["supersicbo", "/rooms/sicbo/14100000-0000-4000-8000-000000000001", "!!document.querySelector('.sb-board:not(.is-locked)')", [".sb-cell.kind-big"]],
  ["moneywheel", "/rooms/money-wheel/17000000-0000-4000-8000-000000000001", "!!document.querySelector('.mw-board:not(.is-locked)')", [".mw-spot.tone-1", ".mw-spot.tone-10"]],
  ["blackjack", "/rooms/blackjack/20000000-0000-4000-8000-000000000001", "true", ["BJ"]],
  ["slot", "/rooms/slot/15000000-0000-4000-8000-000000000001", "!!document.querySelector('.slot-spin:not(:disabled)')", [".slot-spin"]],
];

const filter = new RegExp(process.argv[2] ?? ".");
const wanted = (process.argv[3] ?? "pc,port,land").split(",");
const profile = fileURLToPath(new URL("./profile-play/", import.meta.url));
fs.rmSync(profile, { recursive: true, force: true });
const chrome = spawn(SHELL, ["--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "--lang=ko-KR", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  chrome.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error("no devtools url\n" + buf)), 15000);
});
const port = new URL(wsUrl).port;
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1; const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  if (m.method === "Runtime.exceptionThrown") logs.push("EXC " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300));
  if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) logs.push(m.params.type + " " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
  pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (expr, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await evaluate(expr)) return true; } catch { } await sleep(150); } return false; };
const center = async (sel) => evaluate(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getBoundingClientRect().width > 4); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`);
const click = async (sel) => {
  const at = await center(sel); if (!at) return false;
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "left", clickCount: 1 });
  return true;
};
const clickText = async (sel, text) => {
  const at = await evaluate(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => !x.disabled && x.textContent.includes(${JSON.stringify(text)})); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`);
  if (!at) return false;
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "left", clickCount: 1 });
  return true;
};
const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(s.data, "base64")); };
const status = () => evaluate(`(() => { const s = document.querySelector('.ot-status, .bac-status, .rlt-status, .sb-status, .slot-status, .bjt-status, [class*=status]'); return s ? s.textContent.trim().slice(0, 40) : '' })()`);

const auth = await (await fetch(`${API}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: process.env.QA_USER ?? "claudedev", password: process.env.QA_PASS ?? "claude-dev-1" }) })).json();
await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: ORIGIN + "/login" });
await waitFor("document.readyState === 'complete'");
await evaluate(`sessionStorage.setItem('opencasino.accessToken', ${JSON.stringify(auth.token)}); sessionStorage.setItem('opencasino.user', ${JSON.stringify(JSON.stringify(auth.user))}); sessionStorage.setItem('opencasino.rotateHint', 'off'); 'ok'`);

for (const [vp, [w, h]] of Object.entries(VIEWPORTS)) {
  if (!wanted.includes(vp)) continue;
  const mobile = Math.min(w, h) <= 430;
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  for (const [id, route, open, clicks] of ROOMS) {
    if (!filter.test(id)) continue;
    logs.length = 0;
    await send("Page.navigate", { url: ORIGIN + route });
    await waitFor(`!!document.querySelector('.game-shell')`);
    await sleep(1500);
    const tag = `${vp}-${id}`;
    if (!(await waitFor(open, 40000))) { console.log(tag, "never opened", await status()); await shot(`${tag}-0stuck`); continue; }
    await sleep(600);
    if (clicks[0] === "BJ") {
      if (!(await evaluate("!!document.querySelector('.bjt-spot.mine')"))) { await click(".bjt-spot.empty.can-claim"); await sleep(1200); }
      await waitFor("!!document.querySelector('.bjt-btn.bet:not(:disabled)')", 30000);
      await click(".bjt-btn.bet"); await sleep(600);
      // 사이드 베팅(PP·21+3)도 한 칩씩 — 첫 딜 직후 결판이 나는 걸 찍는다.
      for (const kind of ["PP", "21+3"]) { await clickText(".bjt-side", kind); await sleep(350); }
    } else {
      for (const sel of clicks) { await click(sel); await sleep(250); }
    }
    await shot(`${tag}-1bet`);
    const t0 = Date.now(); let k = 2; let last = "";
    while (Date.now() - t0 < (id === "slot" ? 9000 : 32000)) {
      if (id === "blackjack" && await evaluate("!!document.querySelector('.bjt-btn.stand')")) { await shot(`${tag}-${k++}turn`); await click(".bjt-btn.stand"); }
      const st = await status();
      if (st !== last) { last = st; }
      await sleep(id === "slot" ? 1400 : 2600);
      await shot(`${tag}-${k++}`);
      if (id !== "slot" && k > 4 && await evaluate(open)) break;
    }
    console.log(tag, "shots", k, "last", last, logs.length ? "\n  " + [...new Set(logs)].slice(0, 6).join("\n  ") : "");
  }
}
ws.close(); chrome.kill();
