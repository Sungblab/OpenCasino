// 하우스 게임(바카라·보너스/라이트닝 바카라·용호·블랙잭) 화면 QA 러너.
// pvp-layout 은 목 서버 + 고정 상태, 이쪽은 실제 dev API(5100)의 살아 있는 방에 그대로 붙는다.
// 방 × 뷰포트를 돌며 스크린샷을 찍고, 겹침·판 밖 이탈·글자 넘침·세로 스크롤을 좌표로 검사하고
// 카드 실측 크기를 함께 찍는다 — "PC 에서 너무 크지 않은지 / 폰에서 너무 작지 않은지" 판단용.
//
// usage (repo root, dev api+web 가 이미 떠 있을 때):
//   node apps/web/qa/game-layout/shot.mjs [roomRegex] [viewportList]
// 결과: ./shots/*.png + report.json
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORIGIN = process.env.QA_ORIGIN ?? "http://127.0.0.1:5173";
const API = process.env.QA_API ?? "http://127.0.0.1:5100";
const OUT = fileURLToPath(new URL("./shots/", import.meta.url));
const SHELL = process.env.CHROME_PATH;

const VIEWPORTS = {
  pc: [1440, 900],
  laptop: [1280, 800],
  tablet: [820, 1180],
  port: [390, 844],
  land: [844, 390],
  small: [360, 740],
  landsm: [740, 360],
};
// [id, 방 URL 경로]
const ROOMS = [
  ["baccarat", "/rooms/10000000-0000-4000-8000-000000000001"],
  ["bonus-bacc", "/rooms/10500000-0000-4000-8000-000000000001"],
  ["lightning-bacc", "/rooms/11000000-0000-4000-8000-000000000001"],
  ["dragontiger", "/rooms/dragon-tiger/12000000-0000-4000-8000-000000000002"],
  ["blackjack", "/rooms/blackjack/20000000-0000-4000-8000-000000000001"],
  ["lightning-bj", "/rooms/blackjack/21000000-0000-4000-8000-000000000001"],
  ["roulette", "/rooms/roulette/13000000-0000-4000-8000-000000000001"],
  ["lightning-rlt", "/rooms/roulette/13100000-0000-4000-8000-000000000001"],
  ["sicbo", "/rooms/sicbo/14000000-0000-4000-8000-000000000001"],
  ["super-sicbo", "/rooms/sicbo/14100000-0000-4000-8000-000000000001"],
  ["money-wheel", "/rooms/money-wheel/17000000-0000-4000-8000-000000000001"],
  ["slot", "/rooms/slot/15000000-0000-4000-8000-000000000001"],
  ["crash", "/rooms/crash/18000000-0000-4000-8000-000000000001"],
  ["video-poker", "/rooms/video-poker/16000000-0000-4000-8000-000000000001"],
  ["hilo", "/rooms/table/1b000000-0000-4000-8000-000000000001"],
  ["bac-bo", "/rooms/table/1c000000-0000-4000-8000-000000000001"],
  ["mega-ball", "/rooms/table/1d000000-0000-4000-8000-000000000001"],
  ["top-card", "/rooms/table/1e000000-0000-4000-8000-000000000001"],
];

const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const wanted = (process.argv[3] ?? Object.keys(VIEWPORTS).join(",")).split(",");
fs.mkdirSync(OUT, { recursive: true });

// 겹침 검사 대상: 라벨 → 셀렉터. ot-* 는 하우스 게임 공통 조각.
const SELECTORS = {
  bar: ".game-bar", title: ".game-bar-title", phase: ".game-bar-phase", actions: ".game-bar-actions",
  stage: ".ot-stage", rail: ".ot-rail", hands: ".ot-hands", cards: ".ot-cards", acts: ".ot-acts",
  feed: ".ot-feed", road: ".ot-road", tray: ".ot-tray", timer: ".ot-timer-ring", banner: ".ot-banner",
  money: ".ot-money", print: ".ot-print", score: ".ot-score", msg: ".ot-message",
  lightning: ".lightning-panel", paytable: ".bonus-paytable", chipmenu: ".chip-picker-menu",
  notice: ".round-result-notice", guide: ".game-guide-sheet",
  // 블랙잭(bjt-*): 판·패·딜러는 캔버스가 그리고, 그 위에 좌석 자리(.bjt-spot)·자리 이름표만 DOM 으로 얹는다.
  // 오른쪽(가로 폰) / 아래(PC) 조작 기둥은 상태 줄 + 돈·가운데(칩·버튼)·도구 세 칸.
  bjstage: ".bjt-stage", bjspot: ".bjt-spot", bjtag: ".bjt-spot-tag", winners: ".winner-feed",
  bjcorner: ".bjt-corner", bjstatus: ".bjt-status", bjbar: ".bjt-bar", bjmoney: ".bjt-money", bjcenter: ".bjt-center", bjtools: ".bjt-tools",
  // 바카라·용호(bac-*): 판은 캔버스, 그 아래 띠(.bac-band) = 양옆 위젯 칸(.bac-side > .bac-widget) + 가운데 베팅 칸,
  // 맨 아래 레일 = 돈·칩·버튼. 폰 세로의 위젯 자리는 .bac-mobile-slot.
  bacstage: ".bac-stage", bacband: ".bac-band", bacside: ".bac-side", bacwidget: ".bac-widget", bacgrid: ".bac-grid", baczone: ".bac-zone",
  // 룰렛(rlt-*)·식보(sb-*)·슬롯(slot-*): 위 3D 판 + 아래 베팅판/조작 줄.
  rltstage: ".rlt-stage", rltstatus: ".rlt-status", rltresult: ".rlt-result", rltrecent: ".rlt-recent", rltboard: ".rlt-board-wrap", rltrail: ".rlt-rail", rltmsg: ".rlt-message", rltstats: ".rlt-stats",
  sbstage: ".sb-stage", sbresult: ".sb-result", sbrecent: ".sb-recent", sbboard: ".sb-board-wrap", sbrail: ".sb-rail", sbmsg: ".sb-message", sbstats: ".sb-stats",
  slotstage: ".slot-stage", slotstatus: ".slot-status", slotmsg: ".slot-message", slotcontrols: ".slot-controls", slotrecent: ".slot-recent", slotside: ".slot-side", slotpay: ".slot-inline-pay",
  bacrail: ".bac-rail", bacmoney: ".bac-money", baccenter: ".bac-center", bacacts: ".bac-acts", bacmsg: ".bac-message", bacmobile: ".bac-mobile-slot",
};
const TEXT_SELECTORS = ".ot-hand-head, .ot-score, .ot-money, .ot-message, .bac-zone-name, .bac-zone-odds, .bac-zone-mine, .bac-message, .bac-money, .bac-act, .bac-widget-head, .winner-feed-name, .bjt-status, .bjt-spot-tag, .bjt-money, .bjt-btn, .rlt-message, .rlt-money, .rlt-act, .sb-message, .sb-money, .sb-act, .slot-message, .slot-status, .slot-bet, .game-bar-title strong, .game-bar-title span, .game-bar-phase span, .balance-display strong, .ot-print, .ot-feed li, .bet-zone-label, .chip";

const REPORT = String.raw`(() => {
  const SEL = __SELECTORS__;
  const q = (s) => [...document.querySelectorAll(s)];
  const box = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const b = el.getBoundingClientRect();
    return b.width > 2 && b.height > 2;
  };
  const shell = document.querySelector('.game-shell');
  if (!shell) return { error: 'no .game-shell', text: document.body.innerText.slice(0, 160) };
  const S = box(shell);
  const issues = [];
  const items = [];
  for (const [label, sel] of Object.entries(SEL)) {
    const els = q(sel).filter(visible);
    els.forEach((el, i) => items.push({ label: label + (els.length > 1 ? '#' + (i + 1) : ''), el, b: box(el) }));
  }
  const kind = (it) => it.label.replace(/#\d+$/, '');
  const inter = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.y, b.y));
  const OK_PAIRS = new Set(['bar+title', 'actions+bar', 'bar+phase', 'cards+hands', 'cards+stage', 'hands+stage',
    'rail+stage', 'acts+rail', 'money+rail', 'stage+timer', 'banner+stage', 'msg+stage', 'score+hands', 'score+cards',
    'print+rail', 'road+stage', 'feed+stage', 'tray+rail', 'acts+tray', 'chipmenu+tray', 'chipmenu+rail', 'chipmenu+acts',
    'lightning+stage', 'paytable+stage',
    'guide+stage', 'guide+rail', 'guide+bar', 'notice+stage',
    'banner+hands', 'banner+cards', 'banner+score',
    // 멀티플라이어 스트립은 두 패 사이 빈 칸에 얹는 오버레이다 — 카드와 겹치면 cards+lightning 으로 잡힌다.
    'hands+lightning', 'hands+paytable']);
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const A = items[i], B = items[j];
    if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
    const ov = inter(A.b, B.b); if (ov < 40) continue;
    if (OK_PAIRS.has([kind(A), kind(B)].sort().join('+'))) continue;
    issues.push({ kind: 'overlap', a: A.label, b: B.label, px: Math.round(ov) });
  }
  for (const it of items) {
    const by = Math.max(S.x - it.b.x, it.b.r - S.r, S.y - it.b.y, it.b.b - S.b);
    if (by > 2) issues.push({ kind: 'outside', a: it.label, by: Math.round(by) });
  }
  for (const el of q(__TEXT__)) {
    if (!visible(el)) continue;
    if (el.scrollWidth > el.clientWidth + 1) {
      const cs = getComputedStyle(el);
      if (cs.overflow === 'hidden' && cs.textOverflow === 'ellipsis') continue;
      issues.push({ kind: 'text-overflow', a: (el.className || el.tagName).toString().slice(0, 34), text: (el.textContent || '').trim().slice(0, 18), over: el.scrollWidth - el.clientWidth });
    }
  }
  // 테이블 화면은 스크롤 없이 한 화면에 들어와야 한다.
  if (document.documentElement.scrollWidth > innerWidth + 1) issues.push({ kind: 'page-hscroll', by: document.documentElement.scrollWidth - innerWidth });
  if (document.documentElement.scrollHeight > innerHeight + 1) issues.push({ kind: 'page-vscroll', by: document.documentElement.scrollHeight - innerHeight });

  // 카드 실측 — 판단은 사람이 한다. 뷰포트 대비 비율까지 같이 낸다.
  const cards = q('.playing-card, .hwatu-card').filter(visible).map((el) => el.getBoundingClientRect());
  const card = cards.length ? { w: Math.round(cards[0].width), h: Math.round(cards[0].height), n: cards.length, pctW: +(cards[0].width / innerWidth * 100).toFixed(1) } : null;
  const chip = (() => { const c = q('.chip').filter(visible)[0]; return c ? Math.round(c.getBoundingClientRect().width) : null; })();
  const stage = (() => { const s = document.querySelector('.ot-stage'); return s ? [Math.round(s.getBoundingClientRect().width), Math.round(s.getBoundingClientRect().height)] : null; })();
  // QA_BOXES=1 이면 조각별 좌표(판 기준 x,y,w,h)도 낸다 — 무엇을 얼마나 옮길지 계산용.
  const boxes = items.map((it) => [it.label, Math.round(it.b.x - S.x), Math.round(it.b.y - S.y), Math.round(it.b.w), Math.round(it.b.h)]);
  return { issues, card, chip, stage, boxes, size: [innerWidth, innerHeight] };
})()`
  .replace("__SELECTORS__", JSON.stringify(SELECTORS))
  .replace("__TEXT__", JSON.stringify(TEXT_SELECTORS));

const profile = path.join(OUT, "..", "profile");
fs.rmSync(profile, { recursive: true, force: true });
const chrome = spawn(SHELL, ["--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--lang=ko-KR", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  chrome.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (m) resolve(m[1]); });
  chrome.on("exit", (code) => reject(new Error("chrome exited " + code + "\n" + buf)));
  setTimeout(() => reject(new Error("no devtools url\n" + buf)), 15000);
});
const port = new URL(wsUrl).port;
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
// CDP 응답이 안 오면(크롬이 죽거나 페이지가 멈추면) 위에서 await 가 영원히 걸린다 — 반드시 타임아웃.
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
  pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "")); return r.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (expr, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await evaluate(expr)) return true; } catch { /* navigating */ } await sleep(120); } return false; };

const auth = await (await fetch(`${API}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: process.env.QA_USER ?? "claudedev", password: process.env.QA_PASS ?? "claude-dev-1" }) })).json();
if (!auth.token) throw new Error("login failed: " + JSON.stringify(auth));

await send("Page.enable");
await send("Page.navigate", { url: ORIGIN + "/login" });
await waitFor("document.readyState === 'complete'");
await evaluate(`sessionStorage.setItem('opencasino.accessToken', ${JSON.stringify(auth.token)}); sessionStorage.setItem('opencasino.user', ${JSON.stringify(JSON.stringify(auth.user))}); sessionStorage.setItem('opencasino.rotateHint', 'off'); 'ok'`);

const summary = [];
for (const [vp, [w, h]] of Object.entries(VIEWPORTS)) {
  if (!wanted.includes(vp)) continue;
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: Math.min(w, h) <= 430 });
  for (const [id, route] of ROOMS) {
    if (filter && !filter.test(id)) continue;
    await send("Page.navigate", { url: ORIGIN + route });
    const ok = await waitFor(`!!document.querySelector('.game-shell')`);
    // 카드가 실제로 깔릴 때까지 한 라운드 정도 기다린다.
    // 캔버스 판(블랙잭)은 DOM 카드가 없다 — 캔버스가 뜨면 된다.
    await waitFor(`document.querySelectorAll('.playing-card, .hwatu-card').length > 0 || !!document.querySelector('.bjt-stage canvas, .bac-stage canvas, .rlt-stage canvas, .sb-stage canvas, .slot-stage canvas')`, 22000);
    await sleep(1200);
    let report;
    try { report = await evaluate(REPORT); } catch (e) { report = { error: String(e.message) }; }
    if (!ok) report.error = ".game-shell never rendered: " + (await evaluate("document.body.innerText.slice(0,120)"));
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, `${vp}-${id}.png`), Buffer.from(shot.data, "base64"));
    summary.push({ vp, id, ...report });
  }
}
ws.close(); chrome.kill();
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(summary, null, 2));
let total = 0;
for (const s of summary) {
  const list = s.issues ?? [];
  total += list.length;
  const metrics = s.card ? `card ${s.card.w}x${s.card.h} (${s.card.pctW}%vw, n=${s.card.n})` : "card —";
  const line = s.error ? `ERROR ${s.error}`
    : list.length === 0 ? "ok"
    : list.map((i) => i.kind === "overlap" ? `${i.a}x${i.b}(${i.px})`
      : i.kind === "outside" ? `OUT ${i.a}(+${i.by})`
      : i.kind === "text-overflow" ? `TEXT ${i.a}:"${i.text}"+${i.over}`
      : `${i.kind}+${i.by}`).join("  ");
  console.log(`${s.vp.padEnd(6)} ${s.id.padEnd(15)} ${metrics.padEnd(34)} ${line}`);
  if (process.env.QA_BOXES && s.boxes) console.log("     " + s.boxes.map((b) => `${b[0]}[${b[1]},${b[2]} ${b[3]}x${b[4]}]`).join(" "));
}
console.log(`\n${summary.length} shots, ${total} issues -> ${OUT}`);
