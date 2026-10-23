// PvP 화면 QA 러너: 헤드리스 크롬(CDP)으로 상태 × 뷰포트를 돌며 스크린샷을 찍고,
// 페이지 안에서 겹침·판 밖 이탈·글자 넘침을 좌표로 검사해 보고서를 낸다.
// usage (repo root):
//   1) VITE_API_URL=http://127.0.0.1:5199 npx vite --port 5174 --strictPort --host 127.0.0.1   (apps/web 에서)
//      포트는 QA_API_PORT(server.mjs)·QA_WEB(이 파일)로 바꿀 수 있다 — 다른 작업과 포트를 나눠 쓸 때.
//   2) node apps/web/qa/pvp-layout/server.mjs
//   3) node apps/web/qa/pvp-layout/shot.mjs <sutda|holdem|gostop> [stateRegex] [viewportList=pc,land,small]
// CHROME_PATH 로 헤드리스 크롬 실행 파일을 바꿀 수 있다(리눅스라면 playwright 의 chromium 도 된다).
// 결과는 ./shots/<game>/*.png + report.json. 검사: 겹침·판 밖 이탈·글자 넘침·12px 미만 글자(SMALL)·
// 폰에서 44px 미만인 누르는 영역(TOUCH, elementFromPoint 로 실제로 잡히는 길이를 잰다).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GAME = process.argv[2] ?? "sutda";
if (!["sutda", "holdem", "gostop"].includes(GAME)) throw new Error("game must be sutda, holdem or gostop");
const { STATES, ME } = await import(`./fixtures-${GAME}.mjs`);
const ORIGIN = process.env.QA_WEB ?? "http://127.0.0.1:5174";
const OUT = fileURLToPath(new URL(`./shots/${GAME}/`, import.meta.url));
const SHELL = process.env.CHROME_PATH;
// 폰은 가로로만 한다(홀덤·섯다·고스톱은 폰에서 가로 전용 — 세로로 들면 OrientationGate 가 덮는다).
// 가로 폰 두 크기: 큰 폰(915×412)과 작은 폰(740×360). 폰은 터치 기기로 흉내 내야 실제 폰 화면(위 띠 대신
// 왼쪽 레일 등, (pointer: coarse) 로 켜지는 규칙)이 찍힌다.
const VIEWPORTS = { pc: [1366, 768], land: [915, 412], small: [740, 360] };
const isPhone = (w, h) => Math.min(w, h) < 500;
const filter = process.argv[3] ? new RegExp(process.argv[3]) : null;
const wanted = (process.argv[4] ?? "pc,land,small").split(",");
fs.mkdirSync(OUT, { recursive: true });

// 검사 대상: 라벨 → 셀렉터. 공통 조각 + 게임별 조각.
const SELECTORS = {
  steps: ".pvp-topline .step-bar", tools: ".pvp-tools", seat: ".pvp-seat", empty: ".holdem-seat-empty",
  dock: ".pvp-dock", tag: ".pvp-hand-tag", bubble: ".table-bubble", timer: ".holdem-timer", shout: ".pvp-turn-shout",
  prompt: ".felt-prompt", notice: ".round-result-notice",
  // 섯다 v6: 판·패·팟·산은 캔버스(sutdaStageController)가 그린다. 여기서 재는 건 그 위에 얹은 DOM 뿐 —
  // 단계 글자, 좌석 배지·말풍선(좌석 이름표 밖 형제), 내 패 위의 "공개" 표시, 독 자리의 고르는 창(3장 섯다),
  // 따로 뜨는 쪼기 창, 산 옆 기리 띠, 초이스 상자.
  ...(GAME === "sutda"
    ? { phase: ".sv6-topline .sv6-phase", badge: ".sv6-badge", seatbubble: ".sv6-bubble", opentag: ".sv6-open-tag", sheet: ".sv6-sheet", squeeze: ".sv6-squeeze-float", cutter: ".sv6-cutter", cutflash: ".sv6-cut-flash", choice: ".sutda-choice", assist: ".assist-line", range: ".assist-range", reason: ".assist-reason" }
    : GAME === "holdem"
    // 홀덤 v6·맞고 v2 도 섯다처럼 판은 캔버스, 재는 건 그 위 DOM(단계·배지·말풍선·레이즈 창·외침·기록).
    ? { phase: ".hv6-phase", badge: ".hv6-badge", seatbubble: ".hv6-bubble", sheet: ".hv6-sheet", pad: ".hv6-pad", clock: ".hv6-clock", history: ".hv6-history", feed: ".winner-feed" }
    : { phase: ".gv2-phase", badge: ".gv2-badge", points: ".gv2-points", seatbubble: ".gv2-bubble", cnt: ".gv2-cnt", backs: ".gv2-backs", sheet: ".gv2-sheet", declare: ".gv2-declare", goal: ".gv2-goal", verdict: ".gv2-verdict" }),
};
const ROOT = GAME === "sutda" ? ".sutda-v6" : GAME === "holdem" ? ".holdem-v6" : ".gostop-v2";
const TEXT_SELECTORS = ".holdem-seat-nick, .holdem-seat-stack, .pvp-dock-status p, .pvp-dock-results li span, .pvp-dock-results li small, .pvp-dock-live > span, .pvp-act strong, .pvp-act small, .pvp-hand-tag strong, .pvp-tool, .pvp-badge, .table-bubble, .sv6-phase, .hv6-phase, .gv2-phase, .hv6-badge, .gv2-badge, .gv2-points, .holdem-pot span, .holdem-winner-pill, .holdem-preset span, .holdem-preset b, .holdem-step-value strong, .gostop-callout small, .gostop-callout strong, .gostop-callout em, .gostop-info, .gostop-captured .gc-brief, .gostop-captured .gc-head, .gostop-prompt header strong, .gostop-prompt header small, .assist-line, .assist-range, .assist-reason";

const REPORT = `(() => {
  const SEL = ${JSON.stringify(SELECTORS)};
  const q = (s) => [...document.querySelectorAll(s)];
  const box = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const visible = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false; const b = el.getBoundingClientRect(); return b.width > 2 && b.height > 2; };
  const mat = document.querySelector(${JSON.stringify(ROOT)}); if (!mat) return { error: 'no root', text: document.body.innerText.slice(0, 200) };
  const M = box(mat);
  const items = [];
  for (const [label, sel] of Object.entries(SEL)) { const els = q(sel).filter(visible); els.forEach((el, i) => items.push({ label: label + (els.length > 1 ? '#' + (i + 1) : ''), el, b: box(el) })); }
  const issues = [];
  const inter = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.y, b.y));
  const kind = (it) => it.label.replace(/#\\d+$/, '');
  const allowed = (A, B) => {
    if (A.el.contains(B.el) || B.el.contains(A.el)) return true;
    const pair = [kind(A), kind(B)].sort().join('+');
    const sameSeat = (A.el.closest('.pvp-seat') && A.el.closest('.pvp-seat') === B.el.closest('.pvp-seat'));
    if (pair === 'bubble+seat' && sameSeat) return true;
    // board+timer/board+shout는 일부러 안 넣는다 — 한 번 넣었더니 타이머가 바닥의 실제
    // 슬롯(먹을 패 선택으로 빛나는 칸)을 덮는 진짜 문제를 계속 조용히 통과시켰다. 겹치면
    // 안 되는 건 자리를 옮겨서 고친다.
    if (['callout+cash', 'callout+pot', 'callout+street', 'cash+pot', 'pot+street', 'cash+street', 'board+callout', 'boardzone+callout'].includes(pair)) return true;
    if (kind(A) === 'flight' || kind(B) === 'flight') return true;
    return false;
  };
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const A = items[i], B = items[j]; const ov = inter(A.b, B.b); if (ov < 6) continue; if (allowed(A, B)) continue;
    issues.push({ kind: 'overlap', a: A.label, b: B.label, px: Math.round(ov) });
  }
  for (const it of items) { const by = Math.max(M.x - it.b.x, it.b.r - M.r, M.y - it.b.y, it.b.b - M.b); if (by > 1) issues.push({ kind: 'outside', a: it.label, by: Math.round(by) }); }
  for (const el of q(${JSON.stringify(TEXT_SELECTORS)})) {
    if (!visible(el)) continue;
    if (el.scrollWidth > el.clientWidth + 1) { const cs = getComputedStyle(el); const clipped = cs.overflow === 'hidden' && cs.textOverflow === 'ellipsis'; if (!clipped) issues.push({ kind: 'text-overflow', a: (el.className || el.tagName).toString().slice(0, 40), text: el.textContent.slice(0, 24), over: el.scrollWidth - el.clientWidth }); }
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) issues.push({ kind: 'page-hscroll', by: document.documentElement.scrollWidth - innerWidth });
  if (document.documentElement.scrollHeight > innerHeight + 1) issues.push({ kind: 'page-vscroll', by: document.documentElement.scrollHeight - innerHeight });
  // 글자 크기 하한: 판 안의 보이는 글자는 12px 아래로 내려가지 않는다.
  for (const el of mat.querySelectorAll('*')) {
    if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (!visible(el)) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 11.95) issues.push({ kind: 'small-text', a: (el.className || el.tagName).toString().slice(0, 40), text: el.textContent.trim().slice(0, 16), px: size });
  }
  // 누를 수 있는 크기(폰에서만): 대상의 가운데를 지나는 가로·세로 선을 1px 씩 짚어(elementFromPoint)
  // 그 대상(또는 그 안)이 잡히는 길이를 잰다. 보이는 크기가 아니라 손가락이 실제로 닿는 크기다.
  if (innerWidth <= 900 || innerHeight <= 560) {
    const TARGETS = '.pvp-act:not(:disabled), .pvp-tool, .pvp-tools .room-chat-toggle, .holdem-preset, .holdem-step-btn:not(:disabled), .gostop-hand-card.is-playable, .gostop-pick, .gostop-choice-card, .sv6-sheet-card, .sv6-sheet-pair, .sv6-sheet-open, .sv6-cut-skip, .pvp-dock-ready .outline-button, .holdem-seat-empty, .hv6-preset, .hv6-step, .gv2-hit.is-playable, .gv2-sheet-card, .gv2-sheet-choice';
    const span = (el, cx, cy, dx, dy) => { let n = 0; for (let s = 1; s <= 40; s++) { const h = document.elementFromPoint(cx + dx * s, cy + dy * s); if (!h || !el.contains(h)) break; n++; } return n; };
    for (const el of mat.querySelectorAll(TARGETS)) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || !el.contains(hit)) { issues.push({ kind: 'touch', a: (el.className || el.tagName).toString().slice(0, 40), covered: true }); continue; }
      const l = span(el, cx, cy, -1, 0), rr = span(el, cx, cy, 1, 0), u = span(el, cx, cy, 0, -1), d = span(el, cx, cy, 0, 1);
      const w = 1 + l + rr, h = 1 + u + d;
      // 짧은 쪽 양끝에서 누르는 영역을 끊은 것(왼|오른, 위|아래) — 무엇을 비켜야 하는지 바로 보이게.
      const cut = (x, y) => { const e = document.elementFromPoint(x, y); return e ? (e.className || e.tagName).toString().split(' ')[0].slice(0, 24) : '밖'; };
      const by = w <= h ? cut(cx - l - 1, cy) + '|' + cut(cx + rr + 1, cy) : cut(cx, cy - u - 1) + '|' + cut(cx, cy + d + 1);
      if (Math.min(w, h) < 44) issues.push({ kind: 'touch', a: (el.className || el.tagName).toString().slice(0, 40), w, h, by });
    }
  }
  const boxes = items.map((it) => [it.label, Math.round(it.b.x - M.x), Math.round(it.b.y - M.y), Math.round(it.b.w), Math.round(it.b.h)]);
  // 카드 실측 — PC 에서 과하지 않은지 / 폰에서 너무 작지 않은지 판단용. 내 패와 남의 패를 나눠 본다.
  const size = (sel) => { const e = [...document.querySelectorAll(sel)].filter(visible)[0]; if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
  const cards = {
    mine: size('.holdem-seat.is-mine .holdem-seat-cards .playing-card, .pvp-seat.is-mine .playing-card, .pvp-seat.is-mine .gostop-cards .hwatu-card'),
    board: size('.holdem-board-cards .playing-card, .gostop-board .hwatu-card'),
    seat: size('.holdem-seat:not(.is-mine) .holdem-seat-cards .playing-card, .pvp-seat:not(.is-mine) .gostop-seat-back .hwatu-card'),
  };
  return { mat: [Math.round(M.x), Math.round(M.y), Math.round(M.w), Math.round(M.h)], n: items.length, issues, boxes, cards };
})()`;

// ── CDP 최소 클라이언트 ─────────────────────────────────────────────────────
const profile = path.join(OUT, "..", "..", "profile-" + GAME);
fs.rmSync(profile, { recursive: true, force: true });
// 리눅스 컨테이너(root)에서는 샌드박스 없이, 전체 크롬이면 헤드리스로 띄운다.
const extraArgs = [...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), ...(/headless-shell/.test(SHELL) ? [] : ["--headless=new"])];
const chrome = spawn(SHELL, [...extraArgs, "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "--disable-gpu", "--window-size=1366,800", "--lang=ko-KR", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
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
ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); } };
// 응답이 안 오면(페이지가 멈추면) 영원히 기다리지 않는다 — 그 상태를 ERROR 로 적고 다음으로 간다.
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
  pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception?.description ?? "")); return r.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (expr, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await evaluate(expr)) return true; await sleep(100); } return false; };

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: ORIGIN + "/login" });
await waitFor("!!document.querySelector('#root') && document.readyState === 'complete'");
await evaluate(`sessionStorage.setItem('opencasino.accessToken', 'qa-token'); sessionStorage.setItem('opencasino.user', ${JSON.stringify(JSON.stringify(ME))}); 'ok'`);

const summary = [];
for (const [vp, [w, h]] of Object.entries(VIEWPORTS)) {
  if (!wanted.includes(vp)) continue;
  const phone = isPhone(w, h);
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: phone });
  await send("Emulation.setTouchEmulationEnabled", { enabled: phone, maxTouchPoints: phone ? 5 : 1 });
  for (const [id, [after]] of Object.entries(STATES)) {
    if (filter && !filter.test(id)) continue;
    await send("Page.navigate", { url: `${ORIGIN}/rooms/${GAME}/${id}` });
    let ok = await waitFor(`!!document.querySelector(${JSON.stringify(ROOT)})`, 10000);
    if (!ok) { await send("Page.reload"); ok = await waitFor(`!!document.querySelector(${JSON.stringify(ROOT)})`, 10000); }
    if (!ok) { summary.push({ vp, id, error: "root never rendered: " + (await evaluate("document.body.innerText.slice(0,120)")) }); continue; }
    await sleep(after);
    let report;
    try { report = await evaluate(REPORT); } catch (e) { report = { error: String(e.message) }; }
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
  const line = s.error ? `ERROR ${s.error}` : list.length === 0 ? "ok" : list.map((i) => i.kind === "overlap" ? `${i.a}×${i.b}(${i.px})` : i.kind === "outside" ? `OUT ${i.a}(+${i.by})` : i.kind === "text-overflow" ? `TEXT ${i.a}:"${i.text}"(+${i.over})` : i.kind === "touch" ? `TOUCH ${i.a}(${i.covered ? "가려짐" : `${i.w}×${i.h} ←${i.by}`})` : i.kind === "small-text" ? `SMALL ${i.a}:"${i.text}"(${i.px}px)` : `${i.kind}(+${i.by})`).join("  ");
  const cs = s.cards ? `[mine ${(s.cards.mine||["-","-"]).join("x")} board ${(s.cards.board||["-","-"]).join("x")} seat ${(s.cards.seat||["-","-"]).join("x")}]` : "";
  console.log(`${s.vp.padEnd(4)} ${s.id.padEnd(14)} ${(process.env.QA_CARDS ? cs.padEnd(44) : "")}${line}`);
  // QA_BOXES=1 이면 문제가 있는 컷의 요소 좌표(판 기준 x,y,w,h)도 찍는다 — 어디를 얼마나 옮길지 계산용.
  if (process.env.QA_BOXES && list.length > 0 && s.boxes) console.log("     " + s.boxes.map((b) => `${b[0]}[${b[1]},${b[2]} ${b[3]}×${b[4]}]`).join(" "));
}
console.log(`\n${GAME}: ${summary.length} shots, ${total} issues → ${OUT}`);
