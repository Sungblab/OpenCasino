/**
 * 봇 연기 테스트 — 사람 하나가 방에 앉아 봇을 부르고, 실제로 판이 돌아가는지 본다.
 *
 * 두뇌 단위 테스트는 "이 상황에서 이 답"만 검증한다. 여기서 보는 것은 그것이 서버의 검증을
 * 통과해 실제로 반영되는가다 — 사이징이 최소 레이즈에 걸리거나, 차례가 아닐 때 눌러 거절
 * 당하거나, 스케줄러가 같은 수를 두 번 내면 여기서만 드러난다.
 *
 * 이 스크립트의 사람은 자기 차례에 가장 싼 선택(공짜면 체크, 아니면 다이·폴드)을 즉시 낸다.
 * 사람이 시간초과를 기다리면 한 판에 20초 넘게 걸려 관찰할 판이 몇 개 안 나온다. 봇을 둘
 * 이상 부르면 봇끼리의 베팅까지 이 경로로 검증된다.
 *
 * 서버를 먼저 띄운다: apps/api 에서 `API_PORT=5198 npx tsx src/main.ts`.
 * 5199 는 pvp-layout 목 서버가 쓰므로 피한다.
 *
 *   node apps/api/qa/bot-smoke.mjs sutda
 *   SKILL=easy node apps/api/qa/bot-smoke.mjs holdem
 *   API=http://127.0.0.1:5198 node apps/api/qa/bot-smoke.mjs holdem 3 180
 *
 * 인자: 게임(sutda|holdem|gostop), 부를 봇 수(기본 1), 관찰 시간 초(기본 120).
 */
import { io } from "socket.io-client";

const API = process.env.API ?? "http://127.0.0.1:5198";
const USER = process.env.QA_USER ?? "claudedev";
const PASS = process.env.QA_PASS ?? "claude-dev-1";
const game = process.argv[2] ?? "sutda";
const botCountArg = process.argv[3] ? Number(process.argv[3]) : null;
const watchSeconds = Number(process.argv[4] ?? 120);
/** 부를 봇의 강도. easy|normal|hard, 기본 normal. */
const skills = (process.env.SKILL ?? "normal").split(",");
/** 봇 지갑 변화를 끝에 재려고 처음 잔고를 기억해 둔다. */
const botStart = new Map();

const uuid = () => crypto.randomUUID();
const ask = (socket, event, payload) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} 응답 없음`)), 15_000);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      if (ack?.ok) resolve(ack.data);
      else reject(new Error(`${event} 거절: ${ack?.code ?? "?"} ${ack?.error ?? ""}`));
    });
  });

const login = await fetch(`${API}/api/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: USER, password: PASS }),
});
if (!login.ok) throw new Error(`로그인 실패 ${login.status}: ${await login.text()}`);
const { token } = await login.json();

const lobby = await (await fetch(`${API}/api/v1/lobby`, { headers: { Authorization: `Bearer ${token}` } })).json();
const room = lobby.rooms.find((r) => r.gameType === game && r.enabled);
if (!room) throw new Error(`${game} 방을 못 찾았습니다`);
console.log(`방: ${room.name} (${room.code})  좌석 ${room.seatCount}  판돈 ${room.minBet}~${room.maxBet}`);

const socket = io(API, { auth: { token }, transports: ["websocket"] });
await new Promise((resolve, reject) => {
  socket.on("connect", resolve);
  socket.on("connect_error", reject);
});

const seen = new Set();
const actions = [];
const rounds = new Set();
const rejections = [];
let myBalance = 0;
/** 이미 답한 자리 — 같은 (판, 순번)에 두 번 보내지 않는다. */
const answered = new Set();

/** 사람 차례에 가장 싼 선택을 즉시 낸다. 판이 시간초과를 기다리지 않고 돌아간다. */
async function answerAsHuman(snap) {
  const key = `${snap.roundId}:${snap.sequence}`;
  if (answered.has(key)) return;
  const mine = snap.seats.find((s) => s.seatNumber === snap.mySeatNumber);
  if (!mine) return;
  try {
    if (game === "sutda") {
      if (snap.cut.cutterSeat === snap.mySeatNumber && !snap.cut.armed) {
        answered.add(key);
        await ask(socket, "sutda.cut", { requestId: uuid(), roomId: room.id, at: 7 });
        return;
      }
      if (snap.street === "choice" && mine.openCards.length === 0 && (mine.cards?.length ?? 0) >= 2) {
        answered.add(key);
        await ask(socket, "sutda.choose", { requestId: uuid(), roomId: room.id, roundId: snap.roundId, cardId: mine.cards[0].id });
        return;
      }
      if (snap.actingSeat === snap.mySeatNumber && snap.betOptions.length > 0) {
        answered.add(key);
        const free = snap.betOptions.find((o) => o.action === "check" && o.enabled);
        const call = snap.betOptions.find((o) => o.action === "call" && o.enabled && o.amount <= room.maxBet * 0.3);
        await ask(socket, "sutda.act", { requestId: uuid(), roomId: room.id, roundId: snap.roundId, action: free ? "check" : call ? "call" : "die" });
      }
      return;
    }
    if (game === "holdem") {
      if (snap.actingSeat === snap.mySeatNumber && !mine.folded) {
        answered.add(key);
        // 싼 값이면 따라간다 — 전부 접으면 모든 판이 프리플랍에서 끝나 포스트플랍 경로가 아예 안 돌아간다.
        const cheap = snap.toCall > 0 && snap.toCall <= Math.max(mine.stack * 0.08, room.minBet * 4);
        const action = snap.toCall === 0 ? "check" : cheap ? "call" : "fold";
        await ask(socket, "holdem.act", { requestId: uuid(), roomId: room.id, roundId: snap.roundId, action });
      }
      return;
    }
    if (snap.pendingChoice) {
      answered.add(key);
      await ask(socket, "gostop.choose", { requestId: uuid(), roomId: room.id, cardId: snap.pendingChoice.options[0].id });
      return;
    }
    if (snap.pendingKukjin) {
      answered.add(key);
      await ask(socket, "gostop.kukjin", { requestId: uuid(), roomId: room.id, asPi: false });
      return;
    }
    if (snap.goStopPrompt && mine.isTurn) {
      answered.add(key);
      await ask(socket, "gostop.declare", { requestId: uuid(), roomId: room.id, decision: "stop" });
      return;
    }
    if (snap.stage === "play" && mine.isTurn && mine.hand?.length) {
      answered.add(key);
      await ask(socket, "gostop.play", { requestId: uuid(), roomId: room.id, cardId: mine.hand[0].id });
    }
  } catch (error) {
    // 낡은 스냅샷에 답했을 뿐일 수도 있으니 기록만 하고 계속한다.
    rejections.push(error.message);
  }
}

/** 봇 차례가 시작된 때. 차례가 넘어가면 그 간격이 봇이 쓴 시간이다(고스톱은 actingSeat 가 없어 안 잰다). */
let turn = null;
const thinkTimes = [];

let latest = null;
socket.on(`${game}.snapshot`, (snap) => {
  latest = snap;
  const acting = snap.actingSeat ?? null;
  if (turn?.seat !== acting || turn?.round !== snap.roundId) {
    if (turn?.bot) thinkTimes.push(Date.now() - turn.at);
    const bot = snap.seats.find((s) => s.seatNumber === acting)?.isBot;
    turn = acting === null ? null : { seat: acting, round: snap.roundId, at: Date.now(), bot };
  }
  if (snap.roundId) rounds.add(snap.roundId);
  myBalance = snap.walletBalance;
  for (const seat of snap.seats) {
    if (!seat.userId) continue;
    const act = seat.lastAction
      ? `${seat.lastAction.action}${seat.lastAction.amount ? ` ${seat.lastAction.amount}` : ""}`
      : seat.lastEvents?.length ? seat.lastEvents.join("+") : null;
    if (!act) continue;
    const key = `${snap.roundId}:${seat.seatNumber}:${snap.street ?? snap.stage}:${act}`;
    if (seen.has(key)) continue;
    seen.add(key);
    actions.push({ seat: seat.seatNumber, who: seat.username, bot: Boolean(seat.isBot), act });
  }
  void answerAsHuman(snap);
});
socket.on("notification", (n) => console.log(`[알림] ${n.type}: ${n.message}`));

await ask(socket, `${game}.join`, { roomId: room.id });
const seated = await ask(socket, `${game}.sit`, { requestId: uuid(), roomId: room.id, seatNumber: 1 });
console.log(`앉음: ${seated.mySeatNumber}번, 잔고 ${seated.walletBalance}`);
const startBalance = seated.walletBalance;

// 인자를 안 주면 테이블을 채운다. 고스톱 3인방은 좁석이 꽉 차야 판이 열려서,
// 봇 하나만 부르면 아무 일도 안 일어난다.
const botCount = botCountArg ?? room.seatCount - 1;
for (let i = 0; i < botCount; i += 1) {
  const after = await ask(socket, `${game}.addBot`, { requestId: uuid(), roomId: room.id, skill: skills[i % skills.length] });
  for (const seat of after.seats) if (seat.isBot && !botStart.has(seat.seatNumber)) botStart.set(seat.seatNumber, seat.stack);
  const bots = after.seats.filter((s) => s.isBot).map((s) => `${s.seatNumber}번 ${s.username}[${s.botSkill}](${s.stack})`);
  console.log(`봇 추가 → ${bots.join(", ")}`);
}

await ask(socket, `${game}.ready`, { roomId: room.id, ready: true });
console.log(`준비 완료. ${watchSeconds}초 관찰합니다…`);
await new Promise((resolve) => setTimeout(resolve, watchSeconds * 1000));

const byBot = actions.filter((a) => a.bot);
console.log(`\n=== 결과 ===`);
console.log(`판 수: ${rounds.size}`);
console.log(`전체 행동 ${actions.length}건, 그중 봇 ${byBot.length}건`);
const kinds = new Map();
for (const a of byBot) {
  const verb = a.act.split(" ")[0];
  kinds.set(verb, (kinds.get(verb) ?? 0) + 1);
}
console.log(`봇 행동 종류: ${[...kinds].map(([k, n]) => `${k}×${n}`).join(", ") || "없음"}`);
if (thinkTimes.length) {
  const sorted = [...thinkTimes].sort((a, b) => a - b);
  const at = (q) => (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] / 1000).toFixed(1);
  console.log(`봇 고민 시간 ${sorted.length}회: 최소 ${at(0)}초 · 중앙 ${at(0.5)}초 · 90% ${at(0.9)}초 · 최대 ${at(1)}초`);
}
if (rejections.length) console.log(`사람 쪽 거절 ${rejections.length}건 (낡은 스냅샷이면 정상): ${[...new Set(rejections)].slice(0, 3).join(" | ")}`);
console.log(`\n최근 행동:`);
for (const a of actions.slice(-30)) console.log(` ${a.bot ? "[봇]" : "     "} ${a.seat}번 ${a.who}: ${a.act}`);
console.log(`\n내 잔고 ${startBalance} → ${myBalance}`);

// 봇별 손익. 봇이 잃은 돈은 하우스가 넣어 준 돈이므로, 합계가 곧 하우스 손익이다.
// 충전이 중간에 끼면 수치가 망가지므로 "갑자기 늘었으면 충전" 으로 읽어야 한다.
if (latest) {
  console.log(`\n봇 손익 (판 ${rounds.size}회):`);
  let total = 0;
  for (const seat of latest.seats) {
    if (!seat.isBot) continue;
    const from = botStart.get(seat.seatNumber);
    if (from === undefined) continue;
    const delta = seat.stack - from;
    total += delta;
    console.log(`  ${seat.seatNumber}번 ${seat.username}[${seat.botSkill}] ${from} → ${seat.stack} (${delta >= 0 ? "+" : ""}${delta})`);
  }
  const perRound = rounds.size > 0 ? (total / rounds.size).toFixed(1) : "-";
  console.log(`  합계 ${total >= 0 ? "+" : ""}${total} 코인, 판당 ${perRound} 코인`);
}

// 이 기능 전체에서 유일하게 자동인 규칙 — 사람이 다 나가면 봇도 나간다. 이게 안 돌면
// 빈 방에서 봇끼리 하우스 돈으로 판을 계속 돌다. 판이 도는 중이면 다음 판 전에 정리된다.
let sweep = "건너뜀(판이 진행 중)";
try {
  const after = await ask(socket, `${game}.standUp`, { roomId: room.id });
  if (after.roundId === null) {
    const left = after.seats.filter((s) => s.isBot).length;
    sweep = left === 0 ? "OK — 봇 전원 퇴장" : `실패 — 봇 ${left}명이 빈 방에 남았다`;
  }
} catch (error) {
  sweep = `standUp 실패: ${error.message}`;
}
console.log(`사람 퇴장 후 봇 정리: ${sweep}`);

socket.close();
process.exit(byBot.length > 0 && rounds.size > 0 && !sweep.startsWith("실패") ? 0 : 1);
