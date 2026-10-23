import type { BadugiAction, BadugiRoomSnapshot, BadugiStreet, Card } from "@opencasino/contracts";
import { evaluateBadugiHand, suggestBadugiDiscard, type BadugiHand } from "../badugi.js";
import type { BotProfile } from "./profile.js";
import type { Rng } from "./rng.js";

/* ===========================================================================
   바둑이 봇 두뇌. 섯다 봇처럼 사람과 같은 스냅샷만 본다 — 남의 패는 null 이고, 보이는 건 각 자리가 교체마다
   몇 장 바꿨는지(draws)와 이번 베팅의 행동뿐이다.

   승률을 몬테카를로로 재지 않는다. 교체가 남은 판은 "상대가 무엇을 버리고 무엇을 받을지"까지 표본으로 뽑아야
   해서 비싸고, 그 정확도가 베팅을 뒤집을 일은 드물다. 대신 바둑이 사람들이 실제로 쓰는 어림을 쓴다:
   지금 묶음 장수와 가장 높은 카드, 남은 교체 횟수, 그리고 상대가 마지막 교체에서 몇 장 바꿨는지.
   ponytail: 어림 상수는 실측 없이 정했다. 봇 손익 통계가 쌓이면 거기서 맞춘다(섯다 봇의 시뮬 하네스처럼).
   =========================================================================== */

export type BadugiDecision = { kind: "draw"; cards: Card[] } | { kind: "act"; action: BadugiAction };

/** 이 단계에서 남은 교체 횟수(교체 창이면 지금 것 포함). */
export function badugiDrawsLeft(street: BadugiStreet | null): number {
  switch (street) {
    case "bet1": case "draw1": return 3;
    case "bet2": case "draw2": return 2;
    case "bet3": case "draw3": return 1;
    default: return 0;
  }
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * 0~1 의 패 힘. 메이드는 높은 카드로만(골프 .97 · 7탑 .87 · K탑 .66), 메이드가 아니면 남은 교체가 많을수록
 * 메이드를 만들 기회가 있어 오른다(A-2-3 베이스는 교체 3번이면 .63, 마지막 베팅이면 .30).
 */
export function badugiStrength(hand: BadugiHand, drawsLeft: number): number {
  const top = hand.values[0] ?? 13;
  if (hand.size === 4) return clamp(0.97 - (top - 4) * 0.035);
  if (hand.size === 3) return clamp(0.3 + drawsLeft * 0.11 - (top - 3) * 0.02);
  if (hand.size === 2) return clamp(0.12 + drawsLeft * 0.07 - (top - 2) * 0.01);
  return clamp(0.04 + drawsLeft * 0.04);
}

const RAISES = new Set<BadugiAction>(["bbing", "ddadang", "half", "allin"]);

/**
 * 상대 정보로 힘을 고친다. 마지막 교체에서 패스한 상대는 메이드일 가능성이 높고(내가 메이드가 아니면 크게
 * 깎는다), 한 장 바꾼 상대는 메이드를 노리는 베이스, 두 장 이상 바꾼 상대는 약하다. 이번 베팅에서 올린
 * 상대가 있으면 조금 더 깎는다.
 */
export function badugiReadStrength(snapshot: BadugiRoomSnapshot, hand: BadugiHand): number {
  let strength = badugiStrength(hand, badugiDrawsLeft(snapshot.street));
  const made = hand.size === 4;
  for (const seat of snapshot.seats) {
    if (!seat.userId || seat.seatNumber === snapshot.mySeatNumber || seat.folded || seat.cardCount === 0) continue;
    const last = seat.draws[seat.draws.length - 1];
    if (last === 0) strength -= made ? 0.06 : 0.15;
    else if (last === 1) strength -= made ? 0 : 0.04;
    // 두 장 이상 바꾼 상대는 베이스도 장담 못 한다 — 내 베이스가 그만큼 값이 오른다.
    else if (last !== undefined) strength += made ? 0.03 : 0.12;
    if (seat.lastAction && RAISES.has(seat.lastAction.action)) strength -= 0.04;
  }
  return clamp(strength);
}

/** 베팅 한 수 — 서버가 내려준 betOptions 중 켜진 것만 고른다(금액 규칙을 두뇌가 다시 구현하지 않는다). */
export function decideBadugiAction(snapshot: BadugiRoomSnapshot, profile: BotProfile, rng: Rng): BadugiAction {
  const seat = snapshot.seats.find((s) => s.seatNumber === snapshot.mySeatNumber);
  const options = snapshot.betOptions.filter((option) => option.enabled);
  if (!seat?.cards || options.length === 0) return "die";
  const can = (action: BadugiAction) => options.some((option) => option.action === action);
  const first = (...actions: BadugiAction[]) => actions.find(can) ?? null;
  const strength = badugiReadStrength(snapshot, evaluateBadugiHand(seat.cards));
  const iRaised = seat.lastAction !== null && RAISES.has(seat.lastAction.action);
  const pot = snapshot.pot.amount;
  const toCall = snapshot.toCall;
  // 공격성 0.5 가 표준. 높으면 같은 힘으로도 먼저 건다.
  const lean = (profile.aggression - 0.5) * 0.1;

  let intended: BadugiAction;
  if (toCall > 0) {
    // 팟 오즈에 타이트함만큼 마진을 얹은 문턱. 베팅이 팟에 비해 클수록 문턱이 오른다.
    const needed = Math.min(0.9, (toCall / (pot + toCall)) * 1.2 + profile.tightness * 0.1);
    // 콜할 돈이 모자라면 콜 버튼은 꺼져 있고 올인이 숏 콜이다.
    const follow = first("call") ?? (can("allin") ? "allin" : "die");
    if (strength < needed) intended = "die";
    // 되올리기는 이번 스트리트에 아직 안 올렸고 확실히 앞설 때만 — 맞받아 올리는 싸움에 끌려가지 않게.
    else if (!iRaised && strength >= 0.8 - lean) intended = first(strength >= 0.88 ? "half" : "ddadang", "ddadang", "half") ?? follow;
    else intended = follow;
  } else if (strength >= 0.7 - lean) {
    intended = first(strength >= 0.82 ? "half" : "bbing", "bbing", "check") ?? "check";
  } else if (badugiDrawsLeft(snapshot.street) > 0 && rng.next() < profile.bluffFrequency && can("bbing")) {
    // 블러프는 교체가 남았을 때만 — 마지막 베팅의 블러프는 패스한 상대에게 그대로 잡힌다.
    intended = "bbing";
  } else {
    intended = "check";
  }
  if (!can(intended)) intended = can("check") ? "check" : "die";
  // 약한 봇이 틀리는 방향은 사람과 같다 — 접어야 할 자리에서 못 접고 따라간다.
  if (intended === "die" && profile.mistakeRate > 0 && rng.next() < profile.mistakeRate) return first("call", "check") ?? "die";
  return intended;
}

/** 지금 이 스냅샷에서 봇이 해야 할 한 가지. 없으면 null. */
export function decideBadugi(snapshot: BadugiRoomSnapshot, profile: BotProfile, rng: Rng): BadugiDecision | null {
  if (snapshot.mySeatNumber === null) return null;
  const seat = snapshot.seats.find((s) => s.seatNumber === snapshot.mySeatNumber);
  if (!seat?.cards || seat.folded) return null;
  if (snapshot.street?.startsWith("draw") && snapshot.room.phase === "BETTING" && snapshot.myDiscard === null && seat.cards.length === 4) {
    return { kind: "draw", cards: suggestBadugiDiscard(seat.cards, badugiDrawsLeft(snapshot.street)) };
  }
  if (snapshot.actingSeat === snapshot.mySeatNumber && snapshot.betOptions.length > 0) {
    return { kind: "act", action: decideBadugiAction(snapshot, profile, rng) };
  }
  return null;
}
