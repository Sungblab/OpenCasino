import { piValue, type GostopCard } from "./deck.js";

export type GostopEvent = "ppeok" | "ppeoksweep" | "jappeok" | "ttadak" | "jjok" | "ssakssul";

export interface TurnInput {
  board: GostopCard[];
  /** 손에서 낸 패. */
  hand: GostopCard;
  /** 더미에서 뒤집은 패. 더미가 비어 뒤집을 패가 없으면 null. */
  flipped: GostopCard | null;
  /** 손패 단계에서 바닥 두 장 중 고른 카드 id. */
  handChoice?: string;
  /** 뒤집기 단계에서 바닥 두 장 중 고른 카드 id. */
  flipChoice?: string;
  /** 이 턴을 두는 좌석. 자뻑 판정에만 쓴다. */
  seat?: string;
  /** 월 → 그 월의 뻑 더미를 만든 좌석. 딜 때 깔린 3장은 여기 없다 — 아무도 만든 게 아니라 피를 뺏지 않는다. */
  ppeokOwners?: Record<number, string>;
}

export interface TurnOutput {
  board: GostopCard[];
  captured: GostopCard[];
  /** 상대에게서 뺏을 피 장수. */
  steal: number;
  events: GostopEvent[];
  /** 바닥에 같은 월이 두 장이라 고를 게 남았으면 채워진다. 이때 board/captured 는 손대지 않는다. */
  needsChoice: { phase: "hand" | "flip"; options: GostopCard[] } | null;
}

const sameMonth = (board: GostopCard[], month: number) => board.filter((c) => c.month === month);
const without = (board: GostopCard[], taken: GostopCard[]) => board.filter((c) => !taken.some((t) => t.id === c.id));

/** 손패 단계가 어떻게 끝났는지. 2단계의 뻑·쪽·따닥 판정이 전부 여기에 달려 있다. */
type HandState = "laid" | "paired" | "pairedOneOfTwo" | "tookPpeokPile";

/**
 * 한 수를 적용한다 — 손패를 내고 더미를 뒤집는 두 단계를 한 번에 계산한다.
 *
 * 두 단계를 쪼개지 않는 이유는 뻑·따닥·쪽이 두 단계의 관계로만 정의되기 때문이다.
 * 바닥에 같은 월이 두 장이라 고를 게 있으면 `needsChoice` 를 채워 돌려주고 아무것도
 * 바꾸지 않는다 — 손패 단계와 뒤집기 단계 각각 한 번씩, 한 턴에 최대 두 번 물어볼 수 있다.
 * 호출자는 `needsChoice` 가 null 이 될 때까지 같은 인자에 고른 값만 얹어 계속 다시 불러야
 * 한다. 한 번만 다시 부르고 끝났다고 가정하면 두 번째 질문을 놓치고, 이미 손에서 뗀 패와
 * 더미에서 뒤집은 패가 어디에도 남지 않고 사라진다. 이 루프를 직접 돌 필요 없이
 * `resolveTurn` 을 쓰면 된다.
 */
export function applyTurn(input: TurnInput): TurnOutput {
  const events: GostopEvent[] = [];
  let board = [...input.board];
  const captured: GostopCard[] = [];
  let steal = 0;

  // --- 1단계: 손패를 낸다 ---
  const handMatches = sameMonth(board, input.hand.month);
  let handState: HandState;

  if (handMatches.length === 0) {
    board.push(input.hand);
    handState = "laid";
  } else if (handMatches.length === 1) {
    board = without(board, handMatches);
    captured.push(input.hand, handMatches[0]!);
    handState = "paired";
  } else if (handMatches.length === 2) {
    // 두 장 중 한 장만 먹는다. 나머지 한 장은 바닥에 남고, 뒤집은 패가 그걸 먹으면 따닥이다.
    const chosen = handMatches.find((c) => c.id === input.handChoice);
    if (input.handChoice !== undefined && !chosen) throw new Error(`Go-Stop hand choice ${input.handChoice} is not on the board`);
    if (!chosen) return { board: input.board, captured: [], steal: 0, events: [], needsChoice: { phase: "hand", options: handMatches } };
    board = without(board, [chosen]);
    captured.push(input.hand, chosen);
    handState = "pairedOneOfTwo";
  } else {
    // 뻑 더미를 통째로 가져간다. 딜 때 깔린 3장은 만든 사람이 없어 피가 붙지 않는다.
    board = without(board, handMatches);
    captured.push(input.hand, ...handMatches);
    handState = "tookPpeokPile";
    const owner = input.ppeokOwners?.[input.hand.month];
    events.push(owner !== undefined && owner === input.seat ? "jappeok" : "ppeoksweep");
    if (owner !== undefined) steal += 1;
  }

  // --- 2단계: 더미를 뒤집는다 ---
  if (input.flipped !== null) {
    const flipped = input.flipped;
    const sameAsPlayed = flipped.month === input.hand.month;

    if (handState === "paired" && sameAsPlayed) {
      // 뻑 — 바닥에 그 월이 한 장뿐이었는데 뒤집은 패까지 같은 월이라 셋이 쌓인다.
      // 방금 먹은 두 장을 도로 내려놓는다.
      board.push(...captured.splice(captured.length - 2, 2), flipped);
      events.push("ppeok");
      return { board, captured, steal, events, needsChoice: null };
    }

    if (handState === "laid" && sameAsPlayed) {
      // 쪽 — 짝이 없어 내려놓은 패를 뒤집은 패로 되먹는다.
      board = without(board, [input.hand]);
      captured.push(input.hand, flipped);
      steal += 1;
      events.push("jjok");
    } else {
      const flipMatches = sameMonth(board, flipped.month);
      if (flipMatches.length === 0) {
        board.push(flipped);
      } else if (flipMatches.length === 1) {
        board = without(board, flipMatches);
        captured.push(flipped, flipMatches[0]!);
        // 따닥 — 손패로 한 장 먹고 뒤집은 패가 같은 월의 나머지까지 먹었다.
        if (handState === "pairedOneOfTwo" && sameAsPlayed) { steal += 1; events.push("ttadak"); }
      } else if (flipMatches.length === 2) {
        const chosen = flipMatches.find((c) => c.id === input.flipChoice);
        if (input.flipChoice !== undefined && !chosen) throw new Error(`Go-Stop flip choice ${input.flipChoice} is not on the board`);
        if (!chosen) return { board: input.board, captured: [], steal: 0, events: [], needsChoice: { phase: "flip", options: flipMatches } };
        board = without(board, [chosen]);
        captured.push(flipped, chosen);
      } else {
        // 뒤집은 패로 뻑 더미를 통째로 가져간다. 딜 때 깔린 3장은 만든 사람이 없어 피가 붙지 않는다.
        board = without(board, flipMatches);
        captured.push(flipped, ...flipMatches);
        const owner = input.ppeokOwners?.[flipped.month];
        events.push(owner !== undefined && owner === input.seat ? "jappeok" : "ppeoksweep");
        if (owner !== undefined) steal += 1;
      }
    }
  }

  if (board.length === 0 && captured.length > 0) { steal += 1; events.push("ssakssul"); }

  return { board, captured, steal, events, needsChoice: null };
}

/**
 * 선택이 필요하면 물어가며 한 수를 끝까지 적용한다.
 *
 * 한 턴에 두 번 물어볼 수 있다 — 손패가 바닥 두 장 중 하나를 고르고, 뒤집은 패도 또 두 장 중
 * 하나를 고르는 경우다. applyTurn 을 직접 부르면 그 두 번째를 놓치기 쉽고, 놓치면 낸 패와
 * 뒤집은 패가 아무 데도 안 남고 사라진다. 액터는 applyTurn 말고 이걸 쓴다.
 */
export function resolveTurn(
  input: TurnInput,
  choose: (phase: "hand" | "flip", options: GostopCard[]) => string,
): TurnOutput {
  let next = input;
  // 물어볼 수 있는 건 손패 한 번, 뒤집기 한 번뿐이다. 그 이상은 뭔가 잘못된 것이다.
  for (let asked = 0; asked <= 2; asked += 1) {
    const out = applyTurn(next);
    if (out.needsChoice === null) return out;
    const picked = choose(out.needsChoice.phase, out.needsChoice.options);
    next = out.needsChoice.phase === "hand" ? { ...next, handChoice: picked } : { ...next, flipChoice: picked };
  }
  throw new Error("Go-Stop turn kept asking for choices");
}

/**
 * 상대 더미에서 피를 뺏는다. 가치가 낮은 것부터 — 쌍피를 먼저 뺏으면 한 장으로 두 장 값을
 * 가져가므로 상대가 부당하게 많이 잃는다. 일반 피가 다 떨어졌을 때만 쌍피를 건드린다.
 * 상대에게 피가 없으면 아무것도 못 뺏는다. 9월 국진을 쌍피로 선언했으면 `kukjinAsPi` 로
 * 알려줘야 한다 — score.ts 의 `scorePile` 에 넘기는 값과 같아야 피박 판정과 어긋나지 않는다.
 */
export function takePi(
  pile: GostopCard[],
  count: number,
  options: { kukjinAsPi?: boolean } = {},
): { taken: GostopCard[]; left: GostopCard[] } {
  if (count <= 0) return { taken: [], left: pile };
  const value = (card: GostopCard) => (options.kukjinAsPi === true && card.tags.includes("kukjin") ? 2 : piValue(card));
  const pi = pile.filter((c) => value(c) > 0).sort((a, b) => value(a) - value(b));
  const taken = pi.slice(0, count);
  return { taken, left: pile.filter((c) => !taken.some((t) => t.id === c.id)) };
}
