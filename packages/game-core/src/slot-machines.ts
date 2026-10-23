import type { SlotMachineId, SlotRoundResult } from "@opencasino/contracts";
import type { RandomInt } from "./lightning.js";
import { CHERRY_LINES, CHERRY_REELS, playCherryRound } from "./slot-lucky-cherry.js";
import { DRAGON_REELS, playDragonRound } from "./slot-golden-dragon.js";
import { SLOT_LINES, SLOT_REELS, playSlotRound } from "./slots.js";

/**
 * 슬롯 기계 목록. 방은 game_rooms.code 로 기계를 고른다(슬롯 방 code 가 곧 기계 이름).
 * 서버는 play 만 쓰고, 화면은 릴 스트립·라인으로 릴을 그린다(배당표·그림은 화면 쪽에 기계별로 있다).
 */
export interface SlotMachine {
  id: SlotMachineId;
  /** slot_spins.rules_version 에 적는 값. 규칙을 바꾸면 올린다. */
  rulesVersion: string;
  reels: { readonly base: readonly (readonly string[])[]; readonly free: readonly (readonly string[])[] };
  /** 라인 기계의 페이라인(릴마다 행). 웨이 기계는 null. */
  lines: readonly (readonly number[])[] | null;
  /** 기대감 연출을 거는 스캐터 심볼. 없으면 null. */
  scatter: string | null;
  play(totalBet: number, rng?: RandomInt): SlotRoundResult;
}

export const SLOT_MACHINES: Record<SlotMachineId, SlotMachine> = {
  "golden-seven": { id: "golden-seven", rulesVersion: "golden-seven-v1", reels: SLOT_REELS, lines: SLOT_LINES, scatter: "SC", play: playSlotRound },
  "lucky-cherry": { id: "lucky-cherry", rulesVersion: "lucky-cherry-v1", reels: { base: CHERRY_REELS, free: CHERRY_REELS }, lines: CHERRY_LINES, scatter: null, play: playCherryRound },
  "golden-dragon": { id: "golden-dragon", rulesVersion: "golden-dragon-v1", reels: DRAGON_REELS, lines: null, scatter: "SC", play: playDragonRound },
};

/** 방 code → 기계. 모르는 code(예전에 따로 만든 슬롯 방)는 처음 기계로 돌린다. */
export function slotMachineForCode(code: string): SlotMachine {
  return SLOT_MACHINES[code as SlotMachineId] ?? SLOT_MACHINES["golden-seven"];
}
