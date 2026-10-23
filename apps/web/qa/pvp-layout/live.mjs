// PvP 실전 QA(의존성 없는 CDP 판): 진짜 dev API 방에 앉아 봇을 채우고 준비 → 안전한 수(체크·콜·스톱·추천 패)로
// 정해진 시간 동안 판을 계속 둔다. 3.5초마다·단계가 바뀔 때 찍고 콘솔 오류를 모은다. shot.mjs(목 서버 고정 상태)가
// 못 보는 실제 딜·연출 흐름·봇 응답을 본다. 옛 play.mjs 는 전역 playwright·qauser·v6 이전 선택자라 안 돈다.
// usage (repo root, dev api 5100 + vite 5173):
//   node apps/web/qa/pvp-layout/live.mjs <sutda|sutda3|holdem|gostop|gostop3> <WxH> [seconds=120]
// 폰은 가로로 넘긴다(915x412·740x360, 터치로 흉내). 같은 계정은 한 PvP 방에만 앉는다 — 앞 판을 끝내고 20초 뒤에 다음 게임.
// 고스톱은 판당 최대(1,000코인)를 예치하므로 dev 계정 잔액이 모자라면 관리자 잔액 조정으로 채운다.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [GAME, size, secArg] = process.argv.slice(2);
const [W, H] = size.split("x").map(Number);
// 다른 작업과 서버를 나눠 쓸 때 QA_WEB·QA_API·CHROME_PATH 로 바꾼다(shot.mjs 와 같은 이름).
const ORIGIN = process.env.QA_WEB ?? "http://127.0.0.1:5173", API = process.env.QA_API ?? "http://127.0.0.1:5100";
const SHELL = process.env.CHROME_PATH;
const ROOMS = {
  sutda: ["sutda", "40000000-0000-4000-8000-000000000001", ".sutda-v6", 2],
  sutda3: ["sutda", "40000000-0000-4000-8000-000000000011", ".sutda-v6", 2],
  holdem: ["holdem", "30000000-0000-4000-8000-000000000010", ".holdem-v6", 2],
  gostop: ["gostop", "50000000-0000-4000-8000-000000000001", ".gostop-v2", 1],
  gostop3: ["gostop", "50000000-0000-4000-8000-000000000011", ".gostop-v2", 2],
};
const [kind, roomId, ROOT, wantBots] = ROOMS[GAME];
const OUT = fileURLToPath(new URL("./shots/live/", import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const tag = `${GAME}-${W}x${H}`;
for (const f of fs.readdirSync(OUT)) if (f.startsWith(tag + "-")) fs.rmSync(path.join(OUT, f));

const profile = fileURLToPath(new URL(`./profile-live-${process.pid}/`, import.meta.url));
const chrome = spawn(SHELL, ["--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--lang=ko-KR", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
const wsUrl = await new Promise((resolve, reject) => { let buf = ""; chrome.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (m) resolve(m[1]); }); setTimeout(() => reject(new Error("no devtools")), 15000); });
const targets = await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json/list`)).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1; const pending = new Map(); const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  if (m.method === "Runtime.exceptionThrown") logs.push("EXC " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 400));
  if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) logs.push(m.params.type + " " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; const t = setTimeout(() => { pending.delete(id); reject(new Error("timeout " + method)); }, 30000); pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (sel) => evaluate(`!![...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => { const b = e.getBoundingClientRect(); return b.width > 2 && !e.disabled; })`).catch(() => false);
const click = async (sel, text) => {
  const at = await evaluate(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => { const b = x.getBoundingClientRect(); return b.width > 2 && !x.disabled && (${JSON.stringify(text ?? "")} === "" || x.textContent.includes(${JSON.stringify(text ?? "")})); }); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`).catch(() => null);
  if (!at) return false;
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "left", clickCount: 1 });
  return true;
};
let k = 0;
const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(OUT, `${tag}-${String(k++).padStart(2, "0")}-${name}.png`), Buffer.from(s.data, "base64")); };

const mobile = Math.min(W, H) <= 430;
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile });
await send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
const auth = await (await fetch(`${API}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: process.env.QA_USER ?? "claudedev", password: process.env.QA_PASS ?? "claude-dev-1" }) })).json();
await send("Page.navigate", { url: ORIGIN + "/login" }); await sleep(1200);
await evaluate(`sessionStorage.setItem('opencasino.accessToken', ${JSON.stringify(auth.token)}); sessionStorage.setItem('opencasino.user', ${JSON.stringify(JSON.stringify(auth.user))}); sessionStorage.setItem('opencasino.rotateHint', 'off'); 'ok'`);
await send("Page.navigate", { url: `${ORIGIN}/rooms/${kind}/${roomId}` });
for (let i = 0; i < 60 && !(await has(ROOT)); i++) await sleep(300);
await sleep(1500);
// 판이 막 뜬 직후엔 클릭이 빗나갈 수 있어 몇 번 다시 누른다. 홀덤은 바이인 창이 뜬다 — 찍고 "최대"로 앉는다.
for (let i = 0; i < 5 && !(await has(".pvp-me")); i++) {
  if (await has(".hv6-sheet, .hv6-pad")) { await shot("buyin"); await click(".hv6-sheet .hv6-preset, .hv6-pad .hv6-preset", "최대"); }
  else await click('.holdem-seat-empty[aria-label$="좌석 앉기"]');
  await sleep(1200);
}
for (let i = 0; i < 6; i++) {
  const bots = await evaluate(`document.querySelectorAll('.pvp-seat .seat-avatar.is-bot, .pvp-seat.is-bot').length`).catch(() => 0);
  if (bots >= wantBots) break;
  if (!(await click(".is-bot-slot"))) break;
  await sleep(1200);
}
await shot("seated");
if (await has(".pvp-dock-ready .outline-button")) await click(".pvp-dock-ready .outline-button", "준비 완료");
const t0 = Date.now(); let lastShot = 0; let acts = 0; const seen = new Set();
while (Date.now() - t0 < Number(secArg ?? 120) * 1000) {
  const phase = await evaluate(`(document.querySelector('.sv6-phase, .hv6-phase, .gv2-phase') || {}).textContent || ''`).catch(() => "");
  let acted = null;
  if (kind === "holdem" && await has(".pvp-act")) acted = (await click(".pvp-act", "체크") || await click(".pvp-act", "콜")) ? "act" : null;
  if (kind === "sutda") {
    if (await has(".sv6-sheet-pair")) acted = (await click(".sv6-sheet-pair")) ? "pair" : null;
    else if (await has(".sv6-sheet-card")) acted = (await click(".sv6-sheet-card")) ? "card" : null;
    else if (await has(".pvp-act")) acted = (await click(".pvp-act", "체크") || await click(".pvp-act", "콜") || await click(".pvp-act", "삥") || await click(".pvp-act", "다이")) ? "act" : null;
  }
  if (kind === "gostop") {
    if (await has(".gv2-sheet-choice")) acted = (await click(".gv2-sheet-choice.is-stop") || await click(".gv2-sheet-choice")) ? "declare" : null;
    else if (await has(".gv2-sheet-card")) acted = (await click(".gv2-sheet-card")) ? "choose" : null;
    else if (await has(".gv2-sheet button")) acted = (await click(".gv2-sheet button")) ? "sheet" : null;
    else if (await has(".gv2-hit.is-playable")) acted = (await click(".gv2-hit.is-playable.is-recommended") || await click(".gv2-hit.is-playable")) ? "play" : null;
  }
  if (acted) { acts++; await sleep(500); }
  if (Date.now() - lastShot > 3500 || (acted && !seen.has(phase))) { seen.add(phase); lastShot = Date.now(); await shot((phase || "x").replace(/[^\w가-힣]+/g, "_").slice(0, 20)); }
  await sleep(700);
}
// 판이 끝났으면 일어선다(봇만 남기지 않게) — 뒤로 가기 확인 창은 판 밖이라 안 뜬다.
console.log(tag, "acts", acts, "shots", k, logs.length ? "\n  " + [...new Set(logs)].slice(0, 10).join("\n  ") : "");
ws.close(); chrome.kill();
setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }, 1500);
