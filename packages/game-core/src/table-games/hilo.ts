import type { Card } from "@opencasino/contracts";
import { secureRandomInt } from "../lightning.js";
import { fairPermille, type Json, type TableGameDef, type TableHistoryEntry, type TableSpot } from "./types.js";

/**
 * 하이로우 — 카드 한 장(기준)이 먼저 보이고, 다음 카드가 그보다 높을지 낮을지 같을지(또는 빨강·검정일지)에 건다.
 *
 * 52장 한 벌에서 기준 카드를 뽑고, 다음 카드는 남은 51장에서 뽑는다. 에이스가 가장 낮고 K 가 가장 높다.
 * 칸마다 이길 장수가 달라서 배당이 판마다 다르다 — 지급 몫 = 51 ÷ 장수 × (1 − 3%) (내림). 이길 수 없는 칸(K 위로 등)은
 * 이번 판엔 걸 수 없다. 같은 숫자가 나오면 높음·낮음은 진다.
 */

export const HILO_EDGE = 0.03;
export const HILO_RANKS: readonly Card["rank"][] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const HILO_SUITS: readonly Card["suit"][] = ["S", "H", "D", "C"];

export interface HiLoSetup { [key: string]: Json; base: Card }
export interface HiLoOutcome { [key: string]: Json; next: Card }

export const hiloRank = (card: Card): number => HILO_RANKS.indexOf(card.rank) + 1;
const isRed = (card: Card): boolean => card.suit === "H" || card.suit === "D";

/** 기준 카드를 뺀 51장 중 칸마다 이기는 장수. */
export function hiloCounts(base: Card): Record<"higher" | "lower" | "same" | "red" | "black", number> {
  const rank = hiloRank(base);
  const redLeft = 26 - (isRed(base) ? 1 : 0);
  return { higher: 4 * (13 - rank), lower: 4 * (rank - 1), same: 3, red: redLeft, black: 51 - redLeft };
}

function won(token: string, base: Card, next: Card): boolean {
  const a = hiloRank(base);
  const b = hiloRank(next);
  switch (token) {
    case "higher": return b > a;
    case "lower": return b < a;
    case "same": return b === a;
    case "red": return isRed(next);
    case "black": return !isRed(next);
    default: return false;
  }
}

/** 기록(betLabel)은 한국어, 베팅 칸에 찍히는 이름은 영어(다른 테이블 게임 칸과 같게). */
const LABEL: Record<string, string> = { higher: "하이", lower: "로우", same: "같음", red: "레드", black: "블랙" };
const ZONE: Record<string, string> = { higher: "HIGHER", lower: "LOWER", same: "SAME", red: "RED", black: "BLACK" };
const TONE: Record<string, string> = { higher: "high", lower: "low", same: "same", red: "red", black: "black" };

function drawCard(): Card {
  return { rank: HILO_RANKS[secureRandomInt(13)]!, suit: HILO_SUITS[secureRandomInt(4)]! };
}

export const hiloGame: TableGameDef<HiLoSetup, HiLoOutcome> = {
  type: "hilo",
  prefix: "hilo",
  rulesVersion: "hilo-v1",
  label: "하이로우",
  bettingMs: 15_000,
  stepMs: 1_600,

  newSetup() {
    return { base: drawCard() };
  },

  draw(setup) {
    // 기준 카드를 뺀 51장 중 균등하게.
    const left: Card[] = [];
    for (const rank of HILO_RANKS) for (const suit of HILO_SUITS) if (rank !== setup.base.rank || suit !== setup.base.suit) left.push({ rank, suit });
    return { next: left[secureRandomInt(left.length)]! };
  },

  steps: () => 1,

  spots(setup) {
    const counts = hiloCounts(setup.base);
    const mk = (token: keyof typeof counts, group: string): TableSpot => ({
      choice: `hilo:${token}`,
      label: ZONE[token]!,
      winPermille: fairPermille(counts[token], 51, HILO_EDGE),
      group,
      narrow: token === "same",
      tone: TONE[token],
    });
    return [mk("higher", "main"), mk("same", "main"), mk("lower", "main"), mk("red", "color"), mk("black", "color")];
  },

  isNarrow: (choice) => choice === "hilo:same",
  betLabel: (choice) => LABEL[choice.slice(5)] ?? choice,

  payoutPermille(choice, setup, outcome) {
    const token = choice.slice(5);
    if (!won(token, setup.base, outcome.next)) return 0;
    const spot = hiloGame.spots(setup).find((s) => s.choice === choice);
    return spot?.winPermille ?? 0;
  },

  view(setup, outcome, step) {
    return { base: setup.base, next: outcome && step >= 1 ? outcome.next : null };
  },

  history(setup, outcome): TableHistoryEntry {
    const a = hiloRank(setup.base);
    const b = hiloRank(outcome.next);
    const tone = b > a ? "high" : b < a ? "low" : "same";
    return { label: b > a ? "▲" : b < a ? "▼" : "＝", tone };
  },
};
