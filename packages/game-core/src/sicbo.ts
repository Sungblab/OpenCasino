import { secureRandomInt, type RandomInt } from "./lightning.js";

/**
 * 식보: 주사위 세 개. 클래식(애틀랜틱시티 배당 + 홀/짝)과 슈퍼 식보(에볼루션식 라이트닝).
 *
 * 베팅 이름(52칸): small·big·odd·even, 합계 t4~t17, 특정 트리플 tr1~tr6, 애니 트리플 trany,
 * 특정 더블 d1~d6, 두 주사위 조합 c12~c56(작은 수 먼저), 싱글 s1~s6.
 *
 * 배당은 원금 포함 총 반환 배수로 적는다(1:1 → 2). 슈퍼 식보의 번개 배수도 같은 뜻이라, 번개가
 * 떨어진 칸에서 이기면 기본 배당 대신 그 배수를 받는다(에볼루션 규칙: 곱하는 게 아니라 바꾼다).
 * 싱글은 "2개 일치"·"3개 일치"가 따로 번개 자리(s3@2, s3@3)이고, 1개 일치(1:1)엔 배수가 없다.
 *
 * 서버와 브라우저가 같이 불러오므로 node 전용 모듈을 끌어오지 않는다.
 */

export type Dice = readonly [number, number, number];
export type SicBoTable = "classic" | "super";

type BetKind = "small" | "big" | "odd" | "even" | "total" | "triple" | "anyTriple" | "double" | "combo" | "single";
interface BetDef { kind: BetKind; a?: number; b?: number }

function buildBets(): Map<string, BetDef> {
  const bets = new Map<string, BetDef>();
  for (const kind of ["small", "big", "odd", "even"] as const) bets.set(kind, { kind });
  for (let t = 4; t <= 17; t += 1) bets.set(`t${t}`, { kind: "total", a: t });
  for (let v = 1; v <= 6; v += 1) {
    bets.set(`tr${v}`, { kind: "triple", a: v });
    bets.set(`d${v}`, { kind: "double", a: v });
    bets.set(`s${v}`, { kind: "single", a: v });
  }
  bets.set("trany", { kind: "anyTriple" });
  for (let a = 1; a <= 6; a += 1) for (let b = a + 1; b <= 6; b += 1) bets.set(`c${a}${b}`, { kind: "combo", a, b });
  return bets;
}

/** 걸 수 있는 52칸. */
export const SICBO_BETS: ReadonlyMap<string, BetDef> = buildBets();

export function isSicBoBet(choice: string): boolean {
  return SICBO_BETS.has(choice);
}

/** 대·소·홀·짝(1:1)이 아닌 칸. 방의 side_bet_max 로 한 칸씩 묶는다. */
export function isSicBoNarrowBet(choice: string): boolean {
  const kind = SICBO_BETS.get(choice)?.kind;
  return kind !== undefined && kind !== "small" && kind !== "big" && kind !== "odd" && kind !== "even";
}

/** 합계별 총 반환(4~10, 11~17 은 대칭). */
const TOTAL_RETURN: Record<SicBoTable, Record<number, number>> = {
  // 애틀랜틱시티: 4/17 60:1, 5/16 30:1, 6/15 17:1, 7/14 12:1, 8/13 8:1, 9/12 6:1, 10/11 6:1
  classic: { 4: 61, 5: 31, 6: 18, 7: 13, 8: 9, 9: 7, 10: 7 },
  // 슈퍼 식보 기본(번개 재원만큼 깎인 배당): 50:1, 20:1, 15:1, 12:1, 8:1, 6:1, 6:1
  super: { 4: 51, 5: 21, 6: 16, 7: 13, 8: 9, 9: 7, 10: 7 },
};
const FIXED_RETURN: Record<SicBoTable, { triple: number; anyTriple: number; double: number; combo: number }> = {
  classic: { triple: 181, anyTriple: 31, double: 11, combo: 6 },
  super: { triple: 151, anyTriple: 31, double: 9, combo: 6 },
};

const count = (dice: Dice, v: number) => dice.filter((d) => d === v).length;
const isTriple = (dice: Dice) => dice[0] === dice[1] && dice[1] === dice[2];
const totalOf = (dice: Dice) => dice[0] + dice[1] + dice[2];

/** 기본 배당의 총 반환 배수(졌으면 0). */
export function sicBoBaseReturn(choice: string, dice: Dice, table: SicBoTable): number {
  const bet = SICBO_BETS.get(choice);
  if (!bet) throw new Error(`Unknown sic bo bet: ${choice}`);
  const total = totalOf(dice);
  const triple = isTriple(dice);
  switch (bet.kind) {
    case "small": return !triple && total <= 10 ? 2 : 0;
    case "big": return !triple && total >= 11 ? 2 : 0;
    case "odd": return !triple && total % 2 === 1 ? 2 : 0;
    case "even": return !triple && total % 2 === 0 ? 2 : 0;
    case "total": return total === bet.a ? TOTAL_RETURN[table][Math.min(bet.a!, 21 - bet.a!)]! : 0;
    case "triple": return triple && dice[0] === bet.a ? FIXED_RETURN[table].triple : 0;
    case "anyTriple": return triple ? FIXED_RETURN[table].anyTriple : 0;
    case "double": return count(dice, bet.a!) >= 2 ? FIXED_RETURN[table].double : 0;
    case "combo": return dice.includes(bet.a!) && dice.includes(bet.b!) ? FIXED_RETURN[table].combo : 0;
    case "single": {
      const n = count(dice, bet.a!);
      return n === 0 ? 0 : n + 1;
    }
  }
}

/** 이 결과에서 이 베팅의 번개 자리. 이겼는지는 보지 않는다(부르는 쪽이 기본 반환 > 0 을 먼저 본다).
 *  대·소·홀·짝과 싱글 1개 일치는 없다. */
export function sicBoLightningSlot(choice: string, dice: Dice): string | null {
  const bet = SICBO_BETS.get(choice);
  if (!bet || bet.kind === "small" || bet.kind === "big" || bet.kind === "odd" || bet.kind === "even") return null;
  if (bet.kind === "single") {
    const n = count(dice, bet.a!);
    return n >= 2 ? `${choice}@${n}` : null;
  }
  return choice;
}

export interface SicBoLightning {
  slot: string;
  /** 원금 포함 총 반환. 이기면 기본 배당 대신 이것. */
  multiplier: number;
}

/** 이 판 이긴 칸에 붙은 번개 중 가장 큰 배수(기록 줄·결과의 "×N" 딱지). 없으면 null. */
export function sicBoWinningMultiplier(dice: Dice, lightning: ReadonlyArray<SicBoLightning>): number | null {
  let best: number | null = null;
  for (const strike of lightning) {
    const choice = strike.slot.split("@")[0]!;
    if (!SICBO_BETS.has(choice) || sicBoBaseReturn(choice, dice, "super") === 0 || sicBoLightningSlot(choice, dice) !== strike.slot) continue;
    best = Math.max(best ?? 0, strike.multiplier);
  }
  return best;
}

export function payoutForSicBoBet(choice: string, dice: Dice, stake: number, table: SicBoTable, lightning: ReadonlyArray<SicBoLightning> | null, unit = 1): number {
  if (!Number.isInteger(stake) || !Number.isInteger(unit) || unit <= 0 || stake < 0 || stake % unit !== 0) {
    throw new Error("Sic bo stake must be a whole number of settlement units");
  }
  const base = sicBoBaseReturn(choice, dice, table);
  if (base === 0) return 0;
  const slot = lightning ? sicBoLightningSlot(choice, dice) : null;
  const strike = slot ? lightning!.find((item) => item.slot === slot) : undefined;
  return stake * (strike?.multiplier ?? base);
}

/* ---------------------------------------------------------------------------
   슈퍼 식보 번개

   자리 54개(대·소·홀·짝을 뺀 48칸, 싱글은 2개·3개 일치로 나눠 12자리). 판마다 자리마다 따로 q 의
   확률로 번개가 떨어지고(0개인 판도 있다), 값은 그 자리 목록에서 고르게 하나. 값 목록은 에볼루션
   공식 범위 안(docs/research/roulette-sicbo/B-evolution-sicbo.md B1 표).

   q 는 목표 RTP 에서 거꾸로 푼다. 번개는 주사위와 독립이라 식이 닫혀 있다:
     RTP = 기본RTP + q · P(이김) · (E[배수] − 기본 반환)
   → 판당 평균 4.2자리, 이긴 칸에 번개가 붙은 판 27%(실측 25~27.5%), 번개 칸 RTP 95.0%.
   싱글은 추가로 필요한 몫을 2개 일치 60%, 3개 일치 40% 로 나눈다.
   --------------------------------------------------------------------------- */

const TARGET_RTP = 0.95;
const TOTAL_VALUES: Record<number, number[]> = {
  4: [100, 150, 250, 500], 5: [40, 60, 100, 250], 6: [25, 40, 60, 88], 7: [18, 25, 30],
  8: [12, 18, 25], 9: [12, 20, 30, 50], 10: [10, 15, 25],
};
const SLOT_VALUES: ReadonlyMap<string, readonly number[]> = (() => {
  const values = new Map<string, readonly number[]>();
  for (let t = 4; t <= 17; t += 1) values.set(`t${t}`, TOTAL_VALUES[Math.min(t, 21 - t)]!);
  for (let v = 1; v <= 6; v += 1) {
    values.set(`tr${v}`, [300, 500, 888, 1000]);
    values.set(`d${v}`, [15, 25, 50, 88]);
    values.set(`s${v}@2`, [5, 10, 20]);
    values.set(`s${v}@3`, [25, 50, 88]);
  }
  values.set("trany", [50, 60, 88]);
  for (const choice of SICBO_BETS.keys()) if (choice.startsWith("c")) values.set(choice, [10, 15, 25]);
  return values;
})();

const ALL_DICE: Dice[] = [];
for (let a = 1; a <= 6; a += 1) for (let b = 1; b <= 6; b += 1) for (let c = 1; c <= 6; c += 1) ALL_DICE.push([a, b, c]);

/** 자리 → (이길 확률, 기본 반환). 싱글 자리는 그 일치 수가 나올 확률. */
function slotOdds(slot: string): { pWin: number; base: number } {
  const choice = slot.split("@")[0]!;
  let wins = 0;
  let base = 0;
  for (const dice of ALL_DICE) {
    // 자리 이름은 이기든 지든 나온다 — 이긴 굴림만 센다.
    const won = sicBoBaseReturn(choice, dice, "super");
    if (won === 0 || sicBoLightningSlot(choice, dice) !== slot) continue;
    wins += 1;
    base = won;
  }
  return { pWin: wins / 216, base };
}

const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/** 자리마다 번개가 떨어질 확률. */
export const SICBO_LIGHTNING_CHANCE: ReadonlyMap<string, number> = (() => {
  const chance = new Map<string, number>();
  const singleBase = 199 / 216; // 1·2·3개 일치 2x·3x·4x
  for (const [slot, values] of SLOT_VALUES) {
    const { pWin, base } = slotOdds(slot);
    const lift = pWin * (mean(values) - base);
    if (slot.includes("@")) {
      const share = slot.endsWith("@2") ? 0.6 : 0.4;
      chance.set(slot, ((TARGET_RTP - singleBase) * share) / lift);
    } else {
      chance.set(slot, (TARGET_RTP - pWin * base) / lift);
    }
  }
  return chance;
})();

/** 한 판의 번개. 결과와 독립으로, 주사위보다 먼저 뽑는다. 공개 순서가 섞이도록 자리 순서도 섞는다. */
export function generateSicBoLightning(rng: RandomInt = secureRandomInt): SicBoLightning[] {
  const struck: SicBoLightning[] = [];
  for (const [slot, chance] of SICBO_LIGHTNING_CHANCE) {
    if (rng(1_000_000) >= Math.round(chance * 1_000_000)) continue;
    const values = SLOT_VALUES.get(slot)!;
    struck.push({ slot, multiplier: values[rng(values.length)]! });
  }
  for (let i = struck.length - 1; i > 0; i -= 1) {
    const j = rng(i + 1);
    [struck[i], struck[j]] = [struck[j]!, struck[i]!];
  }
  return struck;
}

export function rollDice(rng: RandomInt = secureRandomInt): Dice {
  return [rng(6) + 1, rng(6) + 1, rng(6) + 1];
}

/** 판에 적는 배당("50:1", 싱글은 "1·2·3:1"). 정산과 같은 표에서 읽는다. */
export function sicBoOdds(choice: string, table: SicBoTable): string {
  if (SICBO_BETS.get(choice)?.kind === "single") return "1·2·3 : 1";
  const best = Math.max(...ALL_DICE.map((dice) => sicBoBaseReturn(choice, dice, table)));
  return `${best - 1} : 1`;
}

/** 베팅의 해석적 RTP(검산용). 슈퍼 식보면 번개 몫을 더한다. */
export function sicBoRtp(choice: string, table: SicBoTable): number {
  let rtp = 0;
  for (const dice of ALL_DICE) {
    const base = sicBoBaseReturn(choice, dice, table);
    if (base === 0) continue;
    const slot = table === "super" ? sicBoLightningSlot(choice, dice) : null;
    const q = slot ? SICBO_LIGHTNING_CHANCE.get(slot) ?? 0 : 0;
    const lifted = slot ? mean(SLOT_VALUES.get(slot)!) : base;
    rtp += (q * lifted + (1 - q) * base) / 216;
  }
  return rtp;
}

const KIND_LABEL: Record<BetKind, string> = {
  small: "SMALL", big: "BIG", odd: "ODD", even: "EVEN", total: "합계", triple: "트리플", anyTriple: "애니 트리플", double: "더블", combo: "조합", single: "싱글",
};

/** 당첨 피드·기록에 쓰는 이름. "SMALL", "합계 9", "트리플 3", "조합 1·2". */
export function sicBoBetLabel(choice: string): string {
  const bet = SICBO_BETS.get(choice.split("@")[0]!);
  if (!bet) return choice;
  if (bet.kind === "combo") return `조합 ${bet.a}·${bet.b}`;
  const label = bet.a === undefined ? KIND_LABEL[bet.kind] : `${KIND_LABEL[bet.kind]} ${bet.a}`;
  const matches = choice.split("@")[1];
  return matches ? `${label} (${matches}개)` : label;
}

/**
 * DEALING 한 구간. 서버는 흔들기 시작(shakeAtMs)에 결과 눈을 싣고(3D 주사위가 그 눈으로 멈춰야
 * 하므로), resultAtMs 에 승패를 공개한다. 번개는 DEALING 시작부터 실리고 화면이 흔드는 동안 하나씩 켠다.
 */
export const SICBO_TIMING = {
  leadMs: 300,
  /** 흔들기 시작 → 주사위가 멈추기까지. */
  shakeMs: 5_200,
  /** 번개를 차례로 켜는 구간(흔들기 시작 기준). */
  revealMs: 2_600,
  resultHoldMs: 2_000,
} as const;

/** k 번째 번개가 켜지는 시각(흔들기 시작 기준 ms). 3D 줄기와 판의 배지가 같은 식으로 함께 켜진다. */
export function sicBoRevealAt(index: number, count: number): number {
  return ((index + 1) * SICBO_TIMING.revealMs) / (count + 1);
}

export function sicBoSchedule(): { shakeAtMs: number; resultAtMs: number; totalMs: number } {
  const shakeAtMs = SICBO_TIMING.leadMs;
  const resultAtMs = shakeAtMs + SICBO_TIMING.shakeMs;
  return { shakeAtMs, resultAtMs, totalMs: resultAtMs + SICBO_TIMING.resultHoldMs };
}

/** 결과 한 줄 요약: 대/소·홀/짝(트리플이면 TRIPLE). */
export function sicBoSummary(dice: Dice): { total: number; triple: boolean; size: "small" | "big" | null; parity: "odd" | "even" | null } {
  const total = totalOf(dice);
  const triple = isTriple(dice);
  return { total, triple, size: triple ? null : total <= 10 ? "small" : "big", parity: triple ? null : total % 2 === 1 ? "odd" : "even" };
}
