import type { GameType, HandLogCard, HandLogEvent } from "@opencasino/contracts";

/**
 * 판 기록(리플레이)을 단계별 화면 상태로 접는다. 서버가 이미 보는 사람에 맞춰 가린 사건 목록을 받으므로
 * 여기서는 받은 것만 쌓는다 — 남의 비공개 패는 처음부터 null(뒷면)이다.
 *
 * 단계는 사건 하나가 아니라 "한 번에 보이는 변화" 하나: 같은 차례에 돈 카드(deal 여럿), 스트리트 이름과
 * 그 보드(street + board), 기본금 걷기(ante 여럿)는 한 단계로 묶는다.
 */

type PlayEvent = Extract<HandLogEvent, { t: "play" }>;
type ResultEvent = Extract<HandLogEvent, { t: "result" }>;

export interface ReplaySeat {
  seat: number;
  name: string;
  /** 지금 들고 있는 패. null 은 뒷면(남의 패). */
  cards: Array<HandLogCard | null>;
  /** 쇼다운·총통에서 실제로 깐 패. */
  shown: HandLogCard[] | null;
  /** 족보를 이룬 패(3장 섯다 두 장·7포커 다섯 장·바둑이 묶음)와 공개한 패(섯다 공개·7포커 앞면)의 id — 카드에 표시한다. */
  used: string[];
  openIds: string[];
  /** 바둑이 교체마다 바꾼 장수(0 = 패스) — 판 위 교체 배지와 같다. */
  draws: number[];
  folded: boolean;
  /** 이번 판에 낸 돈(코인). 고스톱은 0. */
  bet: number;
  /** 이 스트리트의 마지막 결정 — 판 위 말풍선과 같다. 스트리트가 바뀌면 지운다. */
  action: { action: string; amount?: number; auto?: boolean } | null;
  label: string | null;
  /** 고스톱 먹은 패. */
  captured: HandLogCard[];
  net: number | null;
  winner: boolean;
}

export interface ReplayFrame {
  seats: ReplaySeat[];
  board: HandLogCard[];
  pot: number | null;
  street: string | null;
  /** 이 단계가 고스톱 한 수면 그 수(낸 패·뒤집은 패·먹은 패 줄). */
  play: PlayEvent | null;
  result: ResultEvent | null;
  /** 이 단계의 주인 자리 — 강조한다. */
  activeSeat: number | null;
}

export interface ReplayStep {
  /** 이 단계에 든 마지막 사건의 위치. 화면은 events[0..last] 를 접은 상태. */
  last: number;
  seat: number | null;
  text: string;
  kind: "deal" | "street" | "action" | "show" | "result" | "info";
}

const ACTION_LABEL: Record<string, string> = {
  fold: "폴드", check: "체크", call: "콜", bet: "벳", raise: "레이즈", allin: "올인", sb: "스몰 블라인드", bb: "빅 블라인드",
  ante: "기본금", die: "다이", bbing: "삥", ddadang: "따당", quarter: "쿼터", half: "하프", cut: "기리", open: "패 공개",
  go: "고", stop: "스톱", shake: "흔들기", kukjin_pi: "국진을 쌍피로", kukjin_yeol: "국진을 열끗으로", sell: "광 팔기", keep: "광 안 팖",
  timeout: "시간 초과 — 자동으로 냄",
};

const STREET_LABEL: Record<string, string> = {
  preflop: "프리플랍", flop: "플랍", turn: "턴", river: "리버",
  choice: "공개할 패 고르기", first: "1차 베팅", final: "2차 베팅", select: "쇼다운 두 장 고르기",
  fourth: "4구", fifth: "5구", sixth: "6구", seventh: "7구 · 히든",
  bet1: "첫 베팅", draw1: "아침 교체", bet2: "아침 뒤 베팅", draw2: "점심 교체", bet3: "점심 뒤 베팅", draw3: "저녁 교체", bet4: "마지막 베팅",
};

/** 스트리트 이름(리플레이 판 위 상태줄·행동 목록이 같이 쓴다). 7포커의 choice 는 버릴 패까지 고르는 초이스다. */
export function streetLabel(street: string | null, game: GameType): string {
  if (!street) return game === "gostop" ? "패 돌리기" : "판 시작";
  if (game === "seven_poker" && street === "choice") return "초이스";
  return STREET_LABEL[street] ?? street;
}

const GOSTOP_EVENT_LABEL: Record<string, string> = { ppeok: "뻑", ppeoksweep: "뻑 쓸이", jappeok: "자뻑", ttadak: "따닥", jjok: "쪽", ssakssul: "싹쓸이" };

/** 돈이 따라붙는 결정만 금액을 적는다(체크·폴드에 0 을 붙이지 않게). */
const MONEY_ACTIONS = new Set(["call", "bet", "raise", "allin", "sb", "bb", "ante", "bbing", "ddadang", "quarter", "half"]);

export function actionText(action: { action: string; amount?: number; auto?: boolean }): string {
  const name = action.action === "shake" && action.amount ? `${action.amount}월 흔들기` : ACTION_LABEL[action.action] ?? action.action;
  const amount = MONEY_ACTIONS.has(action.action) && action.amount ? ` ${action.amount.toLocaleString()}` : (action.action === "go" || action.action === "stop") && action.amount ? ` (${action.amount}점)` : "";
  return `${name}${amount}${action.auto && action.action !== "timeout" ? " · 자동" : ""}`;
}

const isCard = (card: HandLogCard | null): card is HandLogCard => card !== null;
const cardId = (card: HandLogCard): string => ("id" in card ? card.id : `${card.rank}${card.suit}`);
const monthOf = (card: HandLogCard): string => ("month" in card ? `${card.month}월` : `${card.rank}`);
const SUIT_GLYPH: Record<string, string> = { S: "♠", H: "♥", D: "◆", C: "♣" };
const cardName = (card: HandLogCard): string => ("suit" in card ? `${card.rank}${SUIT_GLYPH[card.suit] ?? card.suit}` : monthOf(card));

function names(events: readonly HandLogEvent[]): Map<number, string> {
  const start = events.find((event): event is Extract<HandLogEvent, { t: "start" }> => event.t === "start");
  return new Map(start?.seats.map((seat) => [seat.seat, seat.name]) ?? []);
}

export function replaySteps(events: readonly HandLogEvent[], game: GameType): ReplayStep[] {
  const nameOf = names(events);
  const who = (seat: number) => nameOf.get(seat) ?? `${seat}번`;
  const steps: ReplayStep[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const next = events[index + 1];
    const add = (step: Omit<ReplayStep, "last">, last = index) => { steps.push({ ...step, last }); index = last; };
    switch (event.t) {
      case "start":
        add({ seat: null, kind: "info", text: `판 시작 · ${event.seats.length}명${event.button ? ` · ${game === "holdem" || game === "badugi" ? "버튼" : "선"} ${who(event.button)}` : ""}` });
        break;
      case "deal": {
        let last = index;
        while (events[last + 1]?.t === "deal") last += 1;
        const each = event.cards.length;
        add({ seat: null, kind: "deal", text: game === "gostop" ? "패를 나눴습니다" : game === "holdem" ? "홀카드 두 장씩" : `패 ${each === 1 ? "한" : each}장씩` }, last);
        break;
      }
      case "street": {
        // 스트리트와 그 보드(홀덤), 또는 그 거리에 돈 카드(7포커 4구~7구)는 한 단계.
        let last = next?.t === "board" ? index + 1 : index;
        while (events[last + 1]?.t === "deal") last += 1;
        add({ seat: null, kind: "street", text: streetLabel(event.street, game) }, last);
        break;
      }
      case "draw": {
        // 7포커 초이스: 버린 한 장과 바로 뒤의 공개(open)를 한 단계로.
        const open = next?.t === "action" && next.action === "open" && next.seat === event.seat ? next : null;
        const count = event.discarded.length;
        const text = open ? `${count}장 버리고 ${open.cards?.map(cardName).join("·") ?? "패"} 공개${open.auto ? " · 자동" : ""}` : count === 0 ? "패스" : `${count}장 교체`;
        add({ seat: event.seat, kind: "action", text: `${who(event.seat)} · ${text}` }, open ? index + 1 : index);
        break;
      }
      case "board":
        add({ seat: null, kind: "street", text: game === "gostop" ? "바닥 패" : "보드" });
        break;
      case "action": {
        if (event.action === "ante") {
          let last = index;
          while (events[last + 1]?.t === "action" && (events[last + 1] as { action: string }).action === "ante") last += 1;
          add({ seat: null, kind: "action", text: `기본금 ${event.amount?.toLocaleString() ?? ""}씩` }, last);
          break;
        }
        add({ seat: event.seat, kind: "action", text: `${who(event.seat)} · ${actionText(event)}` });
        break;
      }
      case "pick":
        add({ seat: event.seat, kind: "action", text: `${who(event.seat)} · 쇼다운 두 장 고름` });
        break;
      case "play": {
        const parts = [`${event.played.map(monthOf).join("·")} ${event.bomb ? "폭탄" : "냄"}`];
        if (event.flipped) parts.push(`${monthOf(event.flipped)} 뒤집음`);
        parts.push(event.captured.length > 0 ? `${event.captured.length}장 먹음` : "못 먹음");
        const stolen = event.stolen.reduce((sum, steal) => sum + steal.cards.length, 0);
        if (stolen > 0) parts.push(`피 ${stolen}장 뺏음`);
        const special = event.events.map((name) => GOSTOP_EVENT_LABEL[name] ?? name);
        add({ seat: event.seat, kind: "action", text: `${who(event.seat)} · ${parts.join(", ")}${special.length ? ` · ${special.join(" ")}` : ""}` });
        break;
      }
      case "redeal":
        add({ seat: null, kind: "info", text: "재경기 — 판돈은 그대로 두고 다시 받습니다" });
        break;
      case "show":
        add({ seat: event.seat, kind: "show", text: `${who(event.seat)} 공개${event.label ? ` · ${event.label}` : ""}` });
        break;
      case "result": {
        const winners = event.rows.filter((row) => row.winner).map((row) => who(row.seat));
        add({ seat: null, kind: "result", text: `${event.label}${winners.length ? ` · ${winners.join(", ")} 승` : ""}` });
        break;
      }
    }
  }
  return steps;
}

/** events[0..last] 를 접은 화면 상태. */
export function replayFrame(events: readonly HandLogEvent[], last: number, activeSeat: number | null = null): ReplayFrame {
  const seats = new Map<number, ReplaySeat>();
  let board: HandLogCard[] = [];
  let pot: number | null = null;
  let street: string | null = null;
  let play: PlayEvent | null = null;
  let result: ResultEvent | null = null;
  const seatOf = (n: number) => seats.get(n);

  for (let index = 0; index <= last && index < events.length; index += 1) {
    const event = events[index]!;
    play = null;
    switch (event.t) {
      case "start":
        for (const seat of event.seats) {
          seats.set(seat.seat, { seat: seat.seat, name: seat.name, cards: [], shown: null, used: [], openIds: [], draws: [], folded: false, bet: 0, action: null, label: null, captured: [], net: null, winner: false });
        }
        break;
      case "deal": {
        const seat = seatOf(event.seat);
        if (!seat) break;
        seat.cards = [...seat.cards, ...event.cards];
        if (event.open) seat.openIds = [...seat.openIds, ...event.cards.filter(isCard).map(cardId)];
        break;
      }
      case "draw": {
        const seat = seatOf(event.seat);
        if (!seat) break;
        // 버린 자리에 받은 패가 들어온다(판과 같다). 받은 게 없으면(7포커 초이스) 그 자리를 뺀다. 남의 패는
        // 뒷면끼리라 장수만 맞는다.
        let cards = [...seat.cards];
        event.discarded.forEach((card, i) => {
          const at = card ? cards.findIndex((held) => held !== null && cardId(held) === cardId(card)) : cards.indexOf(null);
          if (at < 0) return;
          const fresh = event.received[i];
          cards = fresh === undefined ? cards.filter((_, j) => j !== at) : cards.map((held, j) => (j === at ? fresh : held));
        });
        seat.cards = cards;
        seat.draws = [...seat.draws, event.discarded.length];
        break;
      }
      case "pick": {
        const seat = seatOf(event.seat);
        if (seat) seat.used = event.cards.filter(isCard).map(cardId);
        break;
      }
      case "board":
        board = event.cards;
        break;
      case "street":
        street = event.street;
        // 새 스트리트 — 판 위처럼 지난 거리의 말풍선을 지운다(접은 표시는 남는다).
        for (const seat of seats.values()) if (!seat.folded) seat.action = null;
        break;
      case "action": {
        const seat = seatOf(event.seat);
        // 낸 돈은 팟 변화로 센다 — 홀덤 벳·레이즈의 amount 는 "이 스트리트 목표 총액"이라 그대로 더할 수 없다.
        if (event.pot !== undefined) {
          if (seat) seat.bet += Math.max(0, event.pot - (pot ?? 0));
          pot = event.pot;
        }
        if (!seat) break;
        if (event.action === "fold" || event.action === "die") seat.folded = true;
        if (event.action === "open" && event.cards) {
          for (const card of event.cards) {
            seat.openIds.push(cardId(card));
            const held = seat.cards.findIndex((own) => own !== null && cardId(own) === cardId(card));
            if (!("suit" in card)) {
              // 섯다: 내 패면 표시만, 남의 패면 그 자리 뒷면 하나를 앞면으로.
              const hidden = seat.cards.indexOf(null);
              if (held < 0 && hidden >= 0) seat.cards = seat.cards.map((own, i) => (i === hidden ? card : own));
            } else {
              // 7포커 초이스: 서버가 공개한 패를 엎은 두 장 뒤(셋째 자리)로 옮긴다 — 판과 같은 순서로.
              const from = held >= 0 ? held : seat.cards.indexOf(null);
              if (from >= 0) seat.cards = [...seat.cards.filter((_, i) => i !== from), card];
            }
          }
        }
        if (event.action !== "cut" && event.action !== "kukjin_pi" && event.action !== "kukjin_yeol") seat.action = { action: event.action, amount: event.amount, auto: event.auto };
        break;
      }
      case "play": {
        const seat = seatOf(event.seat);
        play = event;
        board = event.board;
        if (!seat) break;
        for (const card of event.played) {
          const at = seat.cards.findIndex((held) => held !== null && cardId(held) === cardId(card));
          const drop = at >= 0 ? at : seat.cards.indexOf(null);
          if (drop >= 0) seat.cards = seat.cards.filter((_, i) => i !== drop);
        }
        seat.captured = [...seat.captured, ...event.captured];
        for (const steal of event.stolen) {
          const from = seatOf(steal.from);
          const ids = new Set(steal.cards.map(cardId));
          if (from) from.captured = from.captured.filter((card) => !ids.has(cardId(card)));
          seat.captured = [...seat.captured, ...steal.cards];
        }
        seat.action = null;
        break;
      }
      case "redeal":
        for (const seat of seats.values()) Object.assign(seat, { cards: [], shown: null, used: [], openIds: [], draws: [], folded: false, action: null, label: null });
        break;
      case "show": {
        const seat = seatOf(event.seat);
        if (seat) Object.assign(seat, { shown: event.cards, label: event.label, used: event.used ?? seat.used });
        break;
      }
      case "result":
        result = event;
        if (event.pot !== null) pot = event.pot;
        for (const row of event.rows) {
          const seat = seatOf(row.seat);
          if (seat) Object.assign(seat, { net: row.net, winner: row.winner, label: row.label ?? seat.label });
        }
        break;
    }
  }
  return { seats: [...seats.values()].sort((a, b) => a.seat - b.seat), board, pot, street, play, result, activeSeat };
}
