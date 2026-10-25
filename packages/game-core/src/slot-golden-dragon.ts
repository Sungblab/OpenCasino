import type { SlotRoundResult, SlotSpinOutcome } from "@opencasino/contracts";
import { secureRandomInt, type RandomInt } from "./lightning.js";

/**
 * 5릴 × 3줄 243웨이 "황금 드래곤". 수학은 packages/game-core 의 테스트가 고정한다.
 *
 * 웨이: 왼쪽 릴부터 이웃한 릴마다 같은 심볼(또는 WILD)이 창 어디에든 있으면 이어진다. 당첨 = 배당 × 단위 ×
 * (릴마다 맞는 칸 수의 곱). WILD 는 릴 2~4 에만 있어 첫 릴은 늘 진짜 심볼이다(WILD 만의 배당이 없다).
 * 여의주(SC) 3·4·5개 = 총베팅 2·10·50배 + 프리스핀 10·15·25회(다시 걸리면 같은 만큼 더, 최대 100회).
 * 프리스핀 릴의 배수 WILD(W2·W3)는 그 칸을 지나는 웨이를 ×2·×3 하고, 한 웨이에 여럿이면 곱한다.
 *
 * 돈은 최소 단위. 단위 = 총베팅/20 이고 총베팅은 20의 배수라 배당·배수 곱이 모두 정수다.
 */

export type DragonSymbol = "DR" | "TG" | "KO" | "IN" | "LA" | "A" | "K" | "Q" | "J" | "W" | "W2" | "W3" | "SC";
export type DragonPaying = "DR" | "TG" | "KO" | "IN" | "LA" | "A" | "K" | "Q" | "J";

/** 총베팅을 나누는 단위 수. 배당표는 이 단위의 배수다. */
export const DRAGON_BET_UNITS = 20;
/** 웨이 하나의 배당(단위 배수, 3·4·5개). */
export const DRAGON_PAYS: Record<DragonPaying, readonly [number, number, number]> = {
  DR: [25, 100, 400],
  TG: [15, 60, 250],
  KO: [10, 40, 150],
  IN: [8, 30, 100],
  LA: [5, 20, 70],
  A: [4, 10, 40],
  K: [3, 8, 30],
  Q: [2, 6, 25],
  J: [2, 5, 20],
};
const PAYING = Object.keys(DRAGON_PAYS) as DragonPaying[];
/** WILD 가 웨이에 보태는 배수. 일반 WILD 는 ×1(대신하기만). */
export const DRAGON_WILDS: Partial<Record<DragonSymbol, number>> = { W: 1, W2: 2, W3: 3 };
/** 총베팅 배수(아무 자리 3·4·5개). 프리스핀 중에도 같다. */
export const DRAGON_SCATTER_PAYS: Record<number, number> = { 3: 2, 4: 10, 5: 50 };
export const DRAGON_FREE_SPINS: Record<number, number> = { 3: 10, 4: 15, 5: 25 };
export const DRAGON_FREE_SPIN_LIMIT = 100;
/** 기본 스핀과 그 프리스핀을 합친 한 사이클의 최대 당첨(총베팅 배수). */
export const DRAGON_MAX_WIN = 1_000;

const strip = (text: string): DragonSymbol[] => text.trim().split(/\s+/) as DragonSymbol[];

/** 스톱 0부터, 창 = 스톱(위)·+1·+2. 기본 릴은 용·호랑이를 2칸까지 겹치고, 프리스핀 릴은 겹치지 않는다(배수 WILD 와 곱해지는 꼬리를 줄인다). */
export const DRAGON_REELS: { readonly base: readonly (readonly DragonSymbol[])[]; readonly free: readonly (readonly DragonSymbol[])[] } = {
  base: [
    strip("J IN J TG KO KO K Q LA A IN J J Q IN K K LA A A LA K DR DR IN DR Q J KO Q TG TG Q Q A SC J A LA K"),
    strip("LA Q Q Q KO Q LA J K A K W TG A TG TG J J A DR Q KO SC J J LA IN LA K W IN DR DR A KO IN K K LA A"),
    strip("DR DR Q K K KO J W LA A K K LA Q J IN Q W J IN A LA A LA A KO SC IN TG DR J SC TG TG A Q Q LA KO K"),
    strip("A K KO TG LA Q J LA J J K A LA K IN K Q KO A A A IN KO IN Q LA W LA J Q W DR DR J SC K TG TG Q DR"),
    strip("A DR K LA A KO Q J Q K LA IN K K TG IN IN K LA J Q IN Q A J J KO DR DR A Q LA KO TG TG Q A J SC J"),
  ],
  free: [
    strip("J DR J K LA KO K DR A IN A J Q Q K KO J DR Q IN J TG A SC LA J A KO TG IN LA Q TG A K Q K J Q LA"),
    strip("K Q DR J KO W2 DR KO J DR W3 A IN W2 A TG LA K A Q Q IN K LA K TG J K IN SC KO LA A W2 J J A Q Q TG LA"),
    strip("Q LA J Q DR LA A Q Q A J K K TG IN W2 A DR IN K K KO W2 J TG K Q W3 J TG DR LA A IN KO SC J KO W2 A LA"),
    strip("LA W2 KO Q IN K LA IN TG Q J DR K TG J J A A A DR Q IN A W3 J K K W2 J Q LA A KO TG SC Q KO DR LA W2 K"),
    strip("LA K Q TG A LA Q IN A SC A IN Q KO KO J DR Q K A K Q TG K J J A KO DR J J LA J J IN DR K LA Q TG"),
  ],
};

export function dragonGrid(reels: readonly (readonly DragonSymbol[])[], stops: readonly number[]): DragonSymbol[][] {
  return reels.map((reel, r) => [0, 1, 2].map((row) => reel[(stops[r]! + row) % reel.length]!));
}

export function evaluateDragonSpin(reels: readonly (readonly DragonSymbol[])[], stops: readonly number[], totalBet: number): SlotSpinOutcome {
  if (!Number.isInteger(totalBet) || totalBet <= 0 || totalBet % DRAGON_BET_UNITS !== 0) {
    throw new Error("Slot bet must be a positive multiple of the bet units");
  }
  const unit = totalBet / DRAGON_BET_UNITS;
  const grid = dragonGrid(reels, stops);
  const waysWins: NonNullable<SlotSpinOutcome["waysWins"]> = [];
  for (const symbol of PAYING) {
    let ways = 1;
    let weight = 1;
    let count = 0;
    for (; count < grid.length; count += 1) {
      let cells = 0;
      let mult = 0;
      for (const cell of grid[count]!) {
        const wild = DRAGON_WILDS[cell];
        if (cell === symbol || wild) { cells += 1; mult += cell === symbol ? 1 : wild!; }
      }
      if (cells === 0) break;
      ways *= cells;
      weight *= mult;
    }
    if (count >= 3) waysWins.push({ symbol, count, ways, weight, win: DRAGON_PAYS[symbol][count - 3]! * unit * weight });
  }
  const scatterCount = grid.flat().filter((cell) => cell === "SC").length;
  const scatterWin = (DRAGON_SCATTER_PAYS[scatterCount] ?? 0) * totalBet;
  const win = waysWins.reduce((sum, item) => sum + item.win, 0) + scatterWin;
  return { stops: [...stops], grid, lineWins: [], waysWins, scatterCount, scatterWin, win, freeSpinsAwarded: DRAGON_FREE_SPINS[scatterCount] ?? 0 };
}

/** 한 사이클: 기본 스핀과, 걸렸으면 그 프리스핀 전부. 캡에 닿으면 남은 프리스핀은 버린다. */
export function playDragonRound(totalBet: number, rng: RandomInt = secureRandomInt): SlotRoundResult {
  const cap = totalBet * DRAGON_MAX_WIN;
  const draw = (reels: readonly (readonly DragonSymbol[])[]) => reels.map((reel) => rng(reel.length));
  const base = evaluateDragonSpin(DRAGON_REELS.base, draw(DRAGON_REELS.base), totalBet);
  const free: SlotSpinOutcome[] = [];
  let paid = base.win;
  let left = base.freeSpinsAwarded;
  let granted = left;
  while (left > 0 && paid < cap) {
    const spin = evaluateDragonSpin(DRAGON_REELS.free, draw(DRAGON_REELS.free), totalBet);
    free.push(spin);
    paid += spin.win;
    left -= 1;
    const extra = Math.min(spin.freeSpinsAwarded, DRAGON_FREE_SPIN_LIMIT - granted);
    left += extra;
    granted += extra;
  }
  return { totalBet, base, free, totalWin: Math.min(paid, cap), capped: paid >= cap };
}

/* ---------------------------------------------------------------------------
   정확한 RTP. 릴끼리 독립이고 웨이 당첨은 릴마다의 "맞는 칸 배수 합" m_r 의 곱이라,
   심볼 s 의 기대 당첨 = Σ_k pay(s,k) · ∏_{r≤k} E[m_r] · P(릴 k+1 에 s 없음). (m_r > 0 ⇔ 맞는 칸이 있음)
   --------------------------------------------------------------------------- */

const windowAt = (reel: readonly DragonSymbol[], stop: number) => [0, 1, 2].map((row) => reel[(stop + row) % reel.length]!);

/** 웨이 당첨의 기댓값(총베팅 배수). 시험에서 짧은 릴의 전수 열거와 맞춰 보려고 내보낸다. */
export function dragonWaysRtp(reels: readonly (readonly DragonSymbol[])[]): number {
  let total = 0;
  for (const symbol of PAYING) {
    const perReel = reels.map((reel) => {
      let mean = 0;
      let none = 0;
      for (let stop = 0; stop < reel.length; stop += 1) {
        const m = windowAt(reel, stop).reduce((sum, cell) => sum + (cell === symbol ? 1 : DRAGON_WILDS[cell] ?? 0), 0);
        mean += m / reel.length;
        if (m === 0) none += 1 / reel.length;
      }
      return { mean, none };
    });
    let product = 1;
    perReel.forEach(({ mean }, r) => {
      product *= mean;
      const k = r + 1;
      if (k >= 3) total += DRAGON_PAYS[symbol][k - 3]! * product * (k < reels.length ? perReel[k]!.none : 1);
    });
  }
  return total / DRAGON_BET_UNITS;
}

/** 창 전체 여의주 수의 분포(릴마다 창 3칸의 개수 분포를 합성곱). */
function scatterDistribution(reels: readonly (readonly DragonSymbol[])[]): number[] {
  let dist = [1];
  for (const reel of reels) {
    const perReel = [0, 0, 0, 0];
    for (let stop = 0; stop < reel.length; stop += 1) perReel[windowAt(reel, stop).filter((cell) => cell === "SC").length]! += 1 / reel.length;
    const next = new Array(dist.length + 3).fill(0) as number[];
    dist.forEach((p, a) => perReel.forEach((q, b) => { next[a + b]! += p * q; }));
    dist = next;
  }
  return dist;
}

export function dragonRtp(): { ways: number; scatter: number; bonus: number; total: number; triggerChance: number; averageFreeSpins: number; freeSpinValue: number } {
  const base = scatterDistribution(DRAGON_REELS.base);
  const free = scatterDistribution(DRAGON_REELS.free);
  const expect = (dist: number[], value: (k: number) => number) => dist.reduce((sum, p, k) => sum + p * value(k), 0);
  const scatterPay = (k: number) => DRAGON_SCATTER_PAYS[k] ?? 0;
  const award = (k: number) => DRAGON_FREE_SPINS[k] ?? 0;
  const triggerChance = expect(base, (k) => (k >= 3 ? 1 : 0));
  // 프리스핀 한 번이 평균 a 회를 더 준다 → 처음 n 회가 낳는 전체 회수의 기댓값 n/(1 − a). (100회 상한은 닿을 확률이 0 에 가깝다)
  const a = expect(free, award);
  const freeSpinValue = dragonWaysRtp(DRAGON_REELS.free) + expect(free, scatterPay);
  const bonus = (expect(base, award) / (1 - a)) * freeSpinValue;
  const ways = dragonWaysRtp(DRAGON_REELS.base);
  const scatter = expect(base, scatterPay);
  return { ways, scatter, bonus, total: ways + scatter + bonus, triggerChance, averageFreeSpins: expect(base, award) / triggerChance / (1 - a), freeSpinValue };
}

/** 기본 스핀 적중률(정확): 웨이 당첨은 릴 1~3 만 보면 정해지므로 그 스톱을 전부 돌고, 아니면 릴 4·5 의 여의주로 3개가 찰 확률을 더한다. */
export function dragonHitRate(): number {
  const [r1, r2, r3, r4, r5] = DRAGON_REELS.base as [readonly DragonSymbol[], readonly DragonSymbol[], readonly DragonSymbol[], readonly DragonSymbol[], readonly DragonSymbol[]];
  const tail = scatterDistribution([r4, r5]);
  const atLeast = (need: number) => tail.reduce((sum, p, k) => sum + (k >= need ? p : 0), 0);
  const matches = (window: DragonSymbol[], symbol: DragonSymbol) => window.some((cell) => cell === symbol || DRAGON_WILDS[cell]);
  let hit = 0;
  for (let i = 0; i < r1.length; i += 1) {
    const w1 = windowAt(r1, i);
    for (let j = 0; j < r2.length; j += 1) {
      const w2 = windowAt(r2, j);
      for (let k = 0; k < r3.length; k += 1) {
        const w3 = windowAt(r3, k);
        if (PAYING.some((symbol) => w1.includes(symbol) && matches(w2, symbol) && matches(w3, symbol))) hit += 1;
        else hit += atLeast(3 - [...w1, ...w2, ...w3].filter((cell) => cell === "SC").length);
      }
    }
  }
  return hit / (r1.length * r2.length * r3.length);
}
