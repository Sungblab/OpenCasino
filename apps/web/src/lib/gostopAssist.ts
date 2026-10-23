import type { GostopCardSnapshot, GostopRoomSnapshot } from "@opencasino/contracts";
import type { GostopCard } from "@opencasino/game-core/gostop";
import {
  gostopCombos,
  gostopGoAdvice,
  gostopPlayAdvice,
  gostopPointPlan,
  type GostopAssistInput,
  type GostopCombo,
  type GostopGoAdvice,
  type GostopPlayAdvice,
  type GostopPointPlan,
} from "@opencasino/game-core/gostop-assist";

/** 도우미가 읽는 스냅샷 조각. 상대 좌석의 `hand` 는 서버가 항상 null 로 보낸다. */
export type GostopAssistSnapshot = Pick<GostopRoomSnapshot, "variant" | "stage" | "board" | "seats" | "mySeatNumber" | "goStopPrompt">;

export interface GostopAssistRead {
  /** 지금 내가 가까운 조합들. 가까운 순. */
  combos: GostopCombo[];
  plan: GostopPointPlan;
  /** 내 차례가 아니면 null — 남의 차례에 낼 패를 권하면 헷갈리기만 한다. */
  play: GostopPlayAdvice | null;
  /** 고/스톱을 물어보는 중에만 채워진다. */
  go: GostopGoAdvice | null;
}

/** 계약의 카드 스냅샷과 엔진의 카드가 같은 모양이라 그대로 넘긴다(태그 문자열까지 같다). */
const coreCards = (cards: GostopCardSnapshot[]): GostopCard[] => cards as unknown as GostopCard[];

/** 조합 한 줄 — "홍단 2/3 · 3월 띠" 처럼 뭘 더 먹어야 하는지까지. */
export function comboLine(combo: GostopCombo): string {
  const want = combo.wantMonths.length > 0 ? ` · ${combo.wantMonths.map((m) => `${m}월`).join("·")}` : ` · ${combo.need}장 더`;
  const points = combo.points > 0 ? ` (+${combo.points}점)` : "";
  return `${combo.label} ${combo.have}/${combo.have + combo.need}${want}${points}`;
}

export function readGostopAssist(snapshot: GostopAssistSnapshot): GostopAssistRead | null {
  const me = snapshot.seats.find((s) => s.seatNumber === snapshot.mySeatNumber);
  if (!me || me.sittingOut) return null;
  // 딜 전·판이 끝난 뒤에는 조언할 게 없다. 먹은 패가 하나도 없고 손패도 없으면 아직 판이 아니다.
  if (snapshot.stage === null || snapshot.stage === "showdown") return null;

  const mine = coreCards([...me.captured.gwang, ...me.captured.yeol, ...me.captured.tti, ...me.captured.pi]);
  const opponents = snapshot.seats
    .filter((s) => s.userId && s.seatNumber !== me.seatNumber && !s.sittingOut)
    .map((s) => ({
      seatNumber: s.seatNumber,
      captured: coreCards([...s.captured.gwang, ...s.captured.yeol, ...s.captured.tti, ...s.captured.pi]),
      points: s.points,
      goCount: s.goCount,
    }));

  const input: GostopAssistInput = {
    variant: snapshot.variant,
    hand: coreCards(me.hand ?? []),
    board: coreCards(snapshot.board),
    mine,
    opponents,
    // 서버가 내 점수를 셀 때 쓰는 값과 같아야 한다 — 안 맞으면 먹은 패 옆 "N점"과 도우미가
    // 말하는 "목표까지 몇 점"이 서로 다른 숫자를 가리킨다.
    kukjinAsPi: me.kukjinAsPi,
  };

  // 낼 패 추천은 실제로 낼 수 있을 때만 — 고를 패가 걸려 있거나 광 파는 중이면 조용히 있는다.
  const canPlay = me.isTurn && snapshot.stage === "play" && input.hand.length > 0;

  return {
    combos: gostopCombos(input).slice(0, 3),
    plan: gostopPointPlan(input),
    play: canPlay ? gostopPlayAdvice(input) : null,
    go: snapshot.goStopPrompt ? gostopGoAdvice({ ...input, goCount: snapshot.goStopPrompt.goCount }) : null,
  };
}
