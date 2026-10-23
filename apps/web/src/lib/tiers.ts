import {
  CUSTOM_ROOM_GAMES,
  ROOM_CREATE_VIP_MIN,
  TIER_GATES,
  VIP_LABEL,
  checkTierGate,
  vipRank,
  type GameRoom,
  type TableTier,
  type TierGateFailure,
  type VipTier,
} from "@opencasino/contracts";

/** 로비가 잠금을 그릴 때 보는 내 값. 서버(RoomManagerBase.join)가 같은 규칙으로 다시 막는다. */
export interface GateWho {
  balance: number;
  level: number;
  vip: VipTier | null;
  admin: boolean;
}

const coins = (value: number) => value.toLocaleString("ko-KR");

export function isPvpGame(gameType: GameRoom["gameType"]): boolean {
  return CUSTOM_ROOM_GAMES.some((game) => game.gameType === gameType);
}

/** 막힌 이유, 짧게("Lv10 부터", "VIP 골드 전용"). */
export function failureText(failure: TierGateFailure): string {
  switch (failure.code) {
    case "TIER_VIP_REQUIRED": return `VIP ${VIP_LABEL[failure.need]} 전용`;
    case "TIER_LEVEL_REQUIRED": return `Lv${failure.need} 부터`;
    case "TIER_BALANCE_REQUIRED": return `잔액 ${coins(failure.need)} 이상`;
    case "TIER_BALANCE_TOO_HIGH": return `잔액 ${coins(failure.max)} 이하만`;
  }
}

/** 그 등급 방에 못 들어가는 이유. 들어갈 수 있으면(관리자 포함) null. */
export function lockReason(tier: TableTier, pvp: boolean, who: GateWho, feeFirst = 0): string | null {
  if (who.admin) return null;
  const failure = checkTierGate(tier, pvp, { ...who, balance: who.balance - feeFirst });
  return failure ? failureText(failure) : null;
}

/** 방 만들기에서 그 등급을 고를 수 없는 이유 — VIP 등급은 플래티넘부터, 개설비를 내고도 입장 조건을 넘어야 한다. */
export function createLockReason(tier: TableTier, fee: number, who: GateWho): string | null {
  if (who.admin) return null;
  if (tier === "vip" && vipRank(who.vip) < vipRank(ROOM_CREATE_VIP_MIN)) return `VIP ${VIP_LABEL[ROOM_CREATE_VIP_MIN]}부터`;
  return lockReason(tier, true, who, fee);
}

/** 등급 묶음 머리의 조건 한 줄("잔액 5,000 이상 · Lv10"). */
export function gateText(tier: TableTier, pvp: boolean): string {
  const gate = TIER_GATES[tier];
  const parts: string[] = [];
  if (gate.minVip) parts.push(`VIP ${VIP_LABEL[gate.minVip]}`);
  if (gate.minLevel > 1) parts.push(`Lv${gate.minLevel}`);
  if (gate.minBalance > 0) parts.push(`잔액 ${coins(gate.minBalance)} 이상`);
  if (pvp && gate.pvpMaxBalance !== null) parts.push(`잔액 ${coins(gate.pvpMaxBalance)} 이하`);
  return parts.length > 0 ? parts.join(" · ") : "누구나";
}

/** 로비 줄의 "바로 시작": 일시정지·잠금이 아닌 첫 방(서버 순서 — 낮은 판돈부터). */
export function firstOpenRoom(rooms: GameRoom[], pvp: boolean, who: GateWho | null): GameRoom | undefined {
  return rooms.find((room) => !room.paused && !(who && lockReason(room.tier ?? "rookie", pvp, who)));
}
