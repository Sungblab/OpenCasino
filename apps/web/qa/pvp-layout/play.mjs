// PvP 실전 QA: 진짜 API 에 로그인해 섯다·홀덤·고스톱 방에 앉고, 봇을 채워 한 판을 끝까지 둔다.
// 픽스처 러너(shot.mjs)가 못 보는 것 — 실제 딜 비행, 소켓 흐름, 콘솔 에러, 1초마다 몇 개의
// 컴포넌트가 다시 그려지는지 — 를 본다.
//
// usage (repo root, API 와 vite 가 떠 있어야 한다):
//   node apps/web/qa/pvp-layout/play.mjs <sutda|holdem|gostop> <width> <height> [label]
//   폰은 가로로 넘긴다(예: 915 412, 740 360) — PvP 는 폰에서 가로 전용이라 세로로 넘기면 방향 안내만 찍힌다.
// 환경변수: QA_API(기본 http://127.0.0.1:5201), QA_WEB(기본 http://127.0.0.1:5301),
//           QA_USER(기본 qauser), QA_OUT(스크린샷 폴더, 기본 ./shots/play), QA_ROOM(방 id 덮어쓰기).
//
// 렌더 횟수는 React DevTools 가 쓰는 전역 훅 자리에 작은 가짜 훅을 끼워 센다: 커밋마다 트리를
// 돌며 이번에 실제로 함수가 실행된(PerformedWork 플래그) 컴포넌트를 이름별로 더한다. 상대 차례가
// 도는 동안 몇 초를 재서 "초당 좌석 렌더 수"를 낸다 — 초시계 때문에 판 전체가 매초 다시 그려지는지
// 숫자로 확인하려는 것이다.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(execSync("npm root -g").toString().trim() + "/");
const { chromium } = require("playwright");

const [, , GAME = "holdem", W = "1280", H = "800", LABEL] = process.argv;
const API = process.env.QA_API ?? "http://127.0.0.1:5201";
const WEB = process.env.QA_WEB ?? "http://127.0.0.1:5301";
const USER = process.env.QA_USER ?? "qauser";
const ROOMS = {
  sutda: "40000000-0000-4000-8000-000000000002",
  holdem: "30000000-0000-4000-8000-000000000011",
  gostop: "50000000-0000-4000-8000-000000000002",
};
const ROOM = process.env.QA_ROOM ?? ROOMS[GAME];
const label = LABEL ?? `${GAME}-${W}x${H}`;
const OUT = path.resolve(process.env.QA_OUT ?? "shots/play");
fs.mkdirSync(OUT, { recursive: true });

const login = await fetch(`${API}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: USER, password: "testpass123" }) }).then((r) => r.json());
if (!login.token) throw new Error("login failed " + JSON.stringify(login));

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// 짧은 변이 500px 아래면 폰(터치). 가로 폰(915×412)도 폰으로 본다.
const phone = Math.min(Number(W), Number(H)) < 500;
const ctx = await browser.newContext({ viewport: { width: Number(W), height: Number(H) }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone, reducedMotion: process.env.QA_REDUCED ? "reduce" : "no-preference" });
await ctx.route("**fonts.g*/**", (r) => r.abort());
await ctx.addInitScript(([token, user]) => {
  sessionStorage.setItem("opencasino.accessToken", token);
  sessionStorage.setItem("opencasino.user", JSON.stringify(user));
  // 렌더 카운터 — React 가 로드되기 전에 훅 자리를 차지한다.
  const counts = new Map();
  window.__qaRenders = { counts, reset() { counts.clear(); }, commits: 0 };
  const nameOf = (fiber) => {
    const t = fiber.type;
    if (!t) return null;
    if (typeof t === "function") return t.displayName || t.name || null;
    if (typeof t === "object") return (t.displayName || t.type?.displayName || t.type?.name || t.render?.name) ?? null;
    return null;
  };
  const walk = (fiber) => {
    while (fiber) {
      // 0 함수, 11 forwardRef, 14 memo, 15 simple memo — PerformedWork(1) 이면 이번 커밋에 실행됐다.
      if ((fiber.tag === 0 || fiber.tag === 11 || fiber.tag === 15) && (fiber.flags & 1) === 1) {
        const name = nameOf(fiber);
        if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      // 건너뛴(bail-out) 하위 트리는 지난 커밋의 fiber 가 그대로 남아 플래그도 그대로다 — 세고 나서
      // 지워 둬야 다음 커밋에서 "이번에 실제로 다시 그려진 것"만 센다. PerformedWork 는 개발 도구용이다.
      fiber.flags &= ~1;
      if (fiber.alternate) fiber.alternate.flags &= ~1;
      if (fiber.child) walk(fiber.child);
      fiber = fiber.sibling;
    }
  };
  // 움직임 카운터 — 칩·팟 토큰(.pvp-flight-token)이 몇 개 날았는지, 고스톱 카드가 몇 장 "옮겨 왔는지"(FLIP).
  window.__qaMotion = { tokens: 0, moved: 0, dealt: 0 };
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && record.target.classList?.contains("is-moved")) window.__qaMotion.moved += 1;
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.classList.contains("pvp-flight-token")) window.__qaMotion.tokens += 1;
        if (node.classList.contains("pvp-fly") || node.classList.contains("playing-card")) window.__qaMotion.dealt += 1;
      }
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, isDisabled: false, renderers: new Map(),
    inject() { return 1; },
    onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) { window.__qaRenders.commits += 1; try { walk(root.current.child); } catch { /* 측정 실패는 무시 */ } },
    checkDCE() {},
  };
}, [login.token, login.user]);

const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() !== "error" && m.type() !== "warning") return;
  // 웹폰트 요청은 이 러너가 일부러 끊는다(네트워크 없이 돌리려고) — 그 실패는 앱의 에러가 아니다.
  if (/fonts\.g/.test(m.location()?.url ?? "")) return;
  errors.push(`${m.type()}: ${m.text()} @ ${m.location()?.url ?? ""}`);
});
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

const sleep = (ms) => page.waitForTimeout(ms);
const shot = async (name) => { const file = path.join(OUT, `${label}-${name}.png`); await page.screenshot({ path: file }); return file; };
const visible = async (sel) => { const el = await page.$(sel); return el ? el.isVisible() : false; };
const clickIf = async (sel) => { const el = await page.$(sel); if (el && (await el.isVisible()) && (await el.isEnabled())) { await el.click({ timeout: 2000 }).catch(() => undefined); return true; } return false; };
const clickText = async (sel, texts) => {
  for (const text of texts) {
    const el = page.locator(sel, { hasText: text }).first();
    if ((await el.count()) > 0 && (await el.isVisible()) && (await el.isEnabled())) { await el.click({ timeout: 2000 }).catch(() => undefined); return text; }
  }
  return null;
};
const root = GAME === "sutda" ? ".sutda-mat" : GAME === "holdem" ? ".holdem-table" : ".gostop-mat";

await page.goto(`${WEB}/rooms/${GAME}/${ROOM}`);
await page.waitForSelector(root, { timeout: 20000 });
await sleep(800);

// 지난 실행에서 앉은 채로 남았으면 그대로 쓴다. 아니면 첫 빈 자리에 앉는다.
if (!(await visible(".pvp-me"))) {
  await clickIf('.holdem-seat-empty[aria-label$="좌석 앉기"]');
  await page.waitForSelector(".pvp-me", { timeout: 8000 });
}
await sleep(400);
const wantBots = GAME === "gostop" ? 1 : 2;
for (let i = 0; i < 6; i++) {
  const bots = await page.$$eval(".pvp-seat .seat-avatar.is-bot", (els) => els.length);
  const people = await page.$$eval(".pvp-seat", (els) => els.length);
  if (bots >= wantBots || (GAME === "gostop" && people >= 2)) break;
  if (!(await clickIf(".is-bot-slot:not(:disabled)"))) break;
  await sleep(700);
}
await shot("1-seated");
if (await visible(".pvp-dock-ready")) {
  const readyText = await page.textContent(".pvp-dock-ready .outline-button").catch(() => "");
  if (readyText?.includes("준비 완료")) await clickIf(".pvp-dock-ready .outline-button");
}

// 한 판을 끝까지. 내 차례면 안전한 수를 둔다.
const t0 = Date.now();
let sawTurn = false; let sawResult = false; let measured = null; let measuredMine = null; let confirmCheck = null; let actions = 0; let dealtShot = false;
while (Date.now() - t0 < 150_000) {
  const phase = await page.textContent(".game-bar-phase span").catch(() => "");
  if (!dealtShot && (await page.$$(".pvp-seat .playing-card, .pvp-seat .hwatu-card")).length > 1) { await sleep(900); await shot("2-dealt"); dealtShot = true; }
  // 상대 차례 동안 3초간 렌더 수를 잰다(한 번만).
  if (!measured && dealtShot && !(await visible(".pvp-dock.is-turn")) && (await visible(".pvp-seat.is-turn"))) {
    await shot("2b-opp-turn");
    await page.evaluate(() => window.__qaRenders.reset());
    const start = Date.now();
    await sleep(3000);
    const counts = await page.evaluate(() => Object.fromEntries(window.__qaRenders.counts));
    measured = { ms: Date.now() - start, counts };
  }
  let acted = null;
  // 내 차례 동안은 스냅샷이 안 온다(내가 생각 중이다) — 초시계만 도는 3초를 재면 "매초 무엇이 다시
  // 그려지나"가 가장 깨끗하게 보인다.
  if (!measuredMine && ((await visible(".pvp-dock.is-turn .pvp-act-row")) || (await visible(".gostop-hand-card.is-playable")))) {
    await page.evaluate(() => window.__qaRenders.reset());
    const start = Date.now();
    await sleep(3000);
    measuredMine = { ms: Date.now() - start, counts: await page.evaluate(() => Object.fromEntries(window.__qaRenders.counts)) };
  }
  // 판 안의 확인 창: 판이 도는 중에 "자리 비우기"를 누르면 브라우저 confirm 이 아니라 <dialog> 가 뜨고,
  // "계속 두기"로 닫히며 자리는 그대로여야 한다. 한 번만 확인한다.
  if (confirmCheck === null && (await visible(".pvp-dock.is-turn"))) {
    const leave = page.locator(".pvp-tools .pvp-tool", { hasText: "자리 비우기" }).first();
    if ((await leave.count()) > 0) {
      await leave.click().catch(() => undefined);
      await sleep(300);
      const opened = await page.$("dialog.pvp-confirm[open]");
      if (opened) {
        await shot("3a-confirm");
        await page.locator("dialog.pvp-confirm[open] .pvp-confirm-cancel").click();
        await sleep(200);
        confirmCheck = { opened: true, closed: !(await page.$("dialog.pvp-confirm[open]")), stillSeated: await visible(".pvp-me") };
      } else confirmCheck = { opened: false, note: "confirm not required in this state" };
    }
  }
  if (GAME === "holdem" && (await visible(".pvp-act-row"))) {
    if (!sawTurn) { await shot("3-my-turn"); sawTurn = true; }
    acted = await clickText(".pvp-act", ["체크", "콜"]);
  } else if (GAME === "sutda") {
    if (await visible(".pvp-act-row")) {
      if (!sawTurn) { await shot("3-my-turn"); sawTurn = true; }
      acted = await clickText(".pvp-act:not(:disabled)", ["체크", "콜", "삥", "하프", "다이"]);
    } else if (await clickIf(".sutda-choice-best")) acted = "best";
    else if (await visible(".sutda-choice:not(.is-done)")) acted = (await clickIf(".sutda-choice-card")) || (await clickIf(".sutda-pick")) ? "pick" : null;
  } else if (GAME === "gostop") {
    if (await visible(".gostop-prompt")) {
      if (!sawTurn) { await shot("3-my-turn"); sawTurn = true; }
      acted = await clickText(".gostop-prompt .pvp-act, .gostop-prompt button", ["스톱", "안 팔고", "열끗"]);
      if (!acted && (await clickIf(".gostop-choice-card, .gostop-pick"))) acted = "choose";
    } else if (await visible(".gostop-hand-card.is-playable")) {
      if (!sawTurn) { await shot("3-my-turn"); sawTurn = true; }
      acted = (await clickIf(".gostop-hand-card.is-recommended.is-playable")) || (await clickIf(".gostop-hand-card.is-playable")) ? "play" : null;
    }
  }
  if (acted) { actions += 1; await sleep(700); }
  if (/결과|종료|정산/.test(phase ?? "") || (await visible(".pvp-dock-results"))) {
    await sleep(1200);
    await shot("4-result");
    sawResult = true;
    break;
  }
  await sleep(250);
}
await sleep(1500);
await shot("5-after");
const phaseNow = await page.textContent(".game-bar-phase span").catch(() => "");
const motion = await page.evaluate(() => window.__qaMotion);
console.log(JSON.stringify({ label, sawTurn, sawResult, actions, phase: phaseNow, confirmCheck, motion, measuredMine, measured, errors }, null, 1));
await browser.close();
