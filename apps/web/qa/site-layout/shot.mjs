// 게임 외 화면(로비·지갑·프로필·기록·고객센터·로그인) QA 러너.
// pvp-layout/shot.mjs 와 같은 CDP 방식이지만, 목 서버가 아니라 실제 dev API(5100)+vite(5173)에 붙는다.
// 라우트 × 뷰포트를 돌며 스크린샷을 찍고, 가로 넘침·글자 잘림·작은 탭타겟·헤더 겹침을 좌표로 검사한다.
//
// usage (repo root, dev api+web 가 이미 떠 있을 때):
//   node apps/web/qa/site-layout/shot.mjs [routeRegex] [viewportList]
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
  phone: [390, 844],
  small: [360, 740],
  land: [844, 390],
  landsm: [740, 360],
};
// [id, path, {anon?: 로그아웃 상태로, wait?: 이 셀렉터를 기다림}]
const ROUTES = [
  ["login", "/login", { anon: true, wait: "form" }],
  ["signup", "/signup", { anon: true, wait: "form" }],
  ["lobby", "/lobby", { wait: ".game-row .room-tile:not(.is-skeleton)" }],
  ["rooms-baccarat", "/lobby/baccarat", { wait: ".room-list" }],
  ["rooms-holdem", "/lobby/holdem", { wait: ".room-list" }],
  ["rooms-sutda", "/lobby/sutda", { wait: ".room-list" }],
  ["wallet", "/wallet", { wait: ".wallet-summary" }],
  ["profile", "/profile", { wait: ".app-shell" }],
  ["history", "/game-history", { wait: ".app-shell" }],
  ["support", "/support", { wait: ".app-shell" }],
  // 메타 페이지 — 2026-10-23 경매 카드가 360px 에서 잘렸는데 여기 없어서 못 잡았다.
  ["public-lobby", "/", { anon: true, wait: ".game-row .room-tile:not(.is-skeleton)" }],
  ["auction", "/auction", { wait: ".auction-lot, .auction-recent" }],
  ["missions", "/missions", { wait: ".app-shell h1" }],
  ["shop", "/shop", { wait: ".shop-grid" }],
  ["leaderboard", "/leaderboard", { wait: ".app-shell h1" }],
  ["vip", "/vip", { wait: ".vip-ladder" }],
  ["friends", "/friends", { wait: ".app-shell h1" }],
  ["not-found", "/no-such-page", { wait: ".not-found-card" }],
];

const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const wanted = (process.argv[3] ?? Object.keys(VIEWPORTS).join(",")).split(",");
fs.mkdirSync(OUT, { recursive: true });

// 페이지 안에서 도는 검사기. 좌표는 모두 뷰포트 기준.
const REPORT = String.raw`(() => {
  const issues = [];
  const de = document.documentElement;
  const VW = innerWidth, VH = innerHeight;
  const q = (s) => [...document.querySelectorAll(s)];
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const b = el.getBoundingClientRect();
    return b.width > 1 && b.height > 1;
  };
  const name = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');

  // 1) 페이지 가로 스크롤 — 모바일에서 제일 흔한 결함.
  if (de.scrollWidth > VW + 1) issues.push({ kind: 'page-hscroll', by: de.scrollWidth - VW });

  // 2) 뷰포트 밖으로 삐져나간 요소. 가장 바깥쪽 범인만 보고한다(자식은 부모를 따라가므로).
  const spill = [];
  for (const el of q('body *')) {
    if (!visible(el)) continue;
    if (getComputedStyle(el).position === 'fixed') continue;
    const b = el.getBoundingClientRect();
    const over = Math.max(b.right - VW, -b.left);
    if (over > 2) spill.push({ el, over: Math.round(over) });
  }
  // 박스 안에서 잘리도록 둔 것(방 목록 결과표 열 등)은 화면에 안 나온다. 가장 가까운 잘라내는
  // 조상이 화면 안에 있으면 넘침이 아니다. .app-shell 의 overflow-x 는 안전망이라 치지 않는다.
  const clippedInside = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (p.classList.contains('app-shell')) return false;
      if (getComputedStyle(p).overflowX === 'visible') continue;
      const pb = p.getBoundingClientRect();
      return pb.right <= VW + 2 && pb.left >= -2;
    }
    return false;
  };
  for (const s of spill) {
    if (spill.some((o) => o !== s && o.el.contains(s.el))) continue;
    if (clippedInside(s.el)) continue;
    issues.push({ kind: 'spill-x', a: name(s.el), by: s.over });
  }

  // 3) 글자 잘림 — ellipsis 처리 없이 넘치는 것만.
  for (const el of q('body *')) {
    if (!visible(el) || el.children.length > 0) continue;
    if (el.scrollWidth > el.clientWidth + 1) {
      const cs = getComputedStyle(el);
      if (cs.overflow === 'hidden' && cs.textOverflow === 'ellipsis') continue;
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
      issues.push({ kind: 'text-overflow', a: name(el), text: (el.textContent || '').trim().slice(0, 20), over: el.scrollWidth - el.clientWidth });
    }
  }

  // 카드 전체를 덮는 ::after 오버레이(.game-card-open 등)를 쓰면 실제 탭 영역은 요소 자신이
  // 아니라 그 오버레이다. 그 경우 위치 지정된 조상의 박스를 탭 영역으로 본다.
  const hitBox = (el) => {
    const own = el.getBoundingClientRect();
    const af = getComputedStyle(el, '::after');
    if (af.content === 'none' || af.position !== 'absolute') return own;
    if ([af.top, af.right, af.bottom, af.left].some((v) => v !== '0px')) return own;
    let p = el.parentElement;
    while (p && getComputedStyle(p).position === 'static') p = p.parentElement;
    return p ? p.getBoundingClientRect() : own;
  };

  // 4) 탭타겟 — 좁은 화면에서 40px 미만 인터랙티브 요소.
  // 가로 폰(844×390)도 폰이다 — 너비만 보면 탭 검사를 건너뛴다.
  if (VW <= 820 || VH <= 540) {
    const seen = new Set();
    for (const el of q('button, a[href], input:not([type=hidden]), select, [role=button]')) {
      if (!visible(el)) continue;
      const b = hitBox(el);
      const min = Math.min(b.width, b.height);
      if (min >= 40) continue;
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue;
      const key = name(el) + '|' + Math.round(min);
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({ kind: 'tap-small', a: name(el), text: (el.textContent || '').trim().slice(0, 14), size: Math.round(b.width) + 'x' + Math.round(b.height) });
    }
  }

  // 5) 고정 헤더가 첫 콘텐츠를 덮는지.
  const bar = document.querySelector('.topbar');
  const shell = document.querySelector('.app-shell');
  if (bar && shell) {
    const pos = getComputedStyle(bar).position;
    if (pos === 'fixed' || pos === 'sticky') {
      const bb = bar.getBoundingClientRect(), sb = shell.getBoundingClientRect();
      if (sb.top < bb.bottom - 1) issues.push({ kind: 'header-overlap', by: Math.round(bb.bottom - sb.top) });
    }
  }

  // 6) 너무 작은 글씨(모바일에서 11px 미만은 읽기 힘들다).
  if (VW <= 430) {
    const tiny = new Map();
    for (const el of q('body *')) {
      if (!visible(el) || el.children.length > 0) continue;
      if (!(el.textContent || '').trim()) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 11) tiny.set(name(el), { size, text: (el.textContent || '').trim().slice(0, 16) });
    }
    for (const [k, v] of tiny) issues.push({ kind: 'tiny-text', a: k, size: v.size, text: v.text });
  }

  return { issues, doc: [de.scrollWidth, de.scrollHeight] };
})()`;

const profile = path.join(OUT, "..", "profile");
fs.rmSync(profile, { recursive: true, force: true });
const chrome = spawn(SHELL, ["--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "--disable-gpu", "--lang=ko-KR", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
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
const waitFor = async (expr, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await evaluate(expr)) return true; } catch { /* navigating */ } await sleep(100); } return false; };

const auth = await (await fetch(`${API}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: process.env.QA_USER ?? "claudedev", password: process.env.QA_PASS ?? "claude-dev-1" }) })).json();
if (!auth.token) throw new Error("login failed: " + JSON.stringify(auth));

await send("Page.enable");
await send("Page.navigate", { url: ORIGIN + "/login" });
await waitFor("document.readyState === 'complete'");

const summary = [];
for (const [vp, [w, h]] of Object.entries(VIEWPORTS)) {
  if (!wanted.includes(vp)) continue;
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: Math.min(w, h) <= 430 });
  // 폰·태블릿은 손가락 기기다. 이게 없으면 (pointer: coarse) 규칙(44px 버튼 등)이 안 걸려 오탐이 난다.
  await send("Emulation.setTouchEmulationEnabled", { enabled: Math.min(w, h) <= 820, maxTouchPoints: 5 });
  for (const [id, route, opts = {}] of ROUTES) {
    if (filter && !filter.test(id)) continue;
    await evaluate(opts.anon
      ? `sessionStorage.clear(); 'ok'`
      : `sessionStorage.setItem('opencasino.accessToken', ${JSON.stringify(auth.token)}); sessionStorage.setItem('opencasino.user', ${JSON.stringify(JSON.stringify(auth.user))}); 'ok'`);
    await send("Page.navigate", { url: ORIGIN + route });
    const ok = await waitFor(`!!document.querySelector(${JSON.stringify(opts.wait ?? "body")})`, 10000);
    await sleep(700);
    let report;
    try { report = await evaluate(REPORT); } catch (e) { report = { error: String(e.message) }; }
    if (!ok) report.error = "wait selector never appeared: " + (await evaluate("document.body.innerText.slice(0,100)"));
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
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
  const line = s.error ? `ERROR ${s.error}`
    : list.length === 0 ? "ok"
    : list.map((i) => i.kind === "page-hscroll" ? `HSCROLL+${i.by}`
      : i.kind === "spill-x" ? `SPILL ${i.a}+${i.by}`
      : i.kind === "text-overflow" ? `TEXT ${i.a}:"${i.text}"+${i.over}`
      : i.kind === "tap-small" ? `TAP ${i.a}"${i.text}"${i.size}`
      : i.kind === "header-overlap" ? `HEADER+${i.by}`
      : `TINY ${i.a}:${i.size}px`).join("  ");
  console.log(`${s.vp.padEnd(7)} ${s.id.padEnd(16)} ${line}`);
}
console.log(`\n${summary.length} shots, ${total} issues -> ${OUT}`);
