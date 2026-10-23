import { describe, expect, it } from "vitest";
import { MEGA_BALL_DRAWN, MEGA_BALL_PAYOUT, MEGA_BALL_POOL, MEGA_BALL_REVEALED, megaBallGame, megaBallRange } from "./mega-ball.js";

const def = megaBallGame;
const setup = def.newSetup();
const payout = (choice: string, balls: number[]) => def.payoutPermille(choice, setup, { balls });
const nums = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** C(n, k) 를 정수로(BigInt). */
function choose(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  let result = 1n;
  for (let i = 1; i <= k; i += 1) result = (result * BigInt(n - k + i)) / BigInt(i);
  return result;
}
const TOTAL = choose(MEGA_BALL_POOL, MEGA_BALL_DRAWN); // 5 586 853 480 가지 12개 조합

/** 기대 반환율(%)을 분수로 정확히 비교하려고 permille 합을 BigInt 로 모은다: 반환율 = sum / (TOTAL × 1000). */
const rtp = (sum: bigint, total: bigint) => Number((sum * 100_000n) / (total * 1000n)) / 1000;

/** k 개가 "표시된 쪽"인 12개짜리 대표 조합(홀수·큰 수 개수만 보는 칸용). marked 는 표시된 쪽 숫자 20개, other 는 반대쪽 20개. */
const pick = (marked: number[], other: number[], k: number) => [...marked.slice(0, k), ...other.slice(0, MEGA_BALL_DRAWN - k)];
const ODD = nums(1, 40).filter((n) => n % 2 === 1);
const EVEN = nums(1, 40).filter((n) => n % 2 === 0);
const BIG = nums(21, 40);
const SMALL = nums(1, 20);

describe("메가볼 — 정확한 반환율", () => {
  it("조합 수: C(40,12) = 5 586 853 480, 20개씩 갈린 모집단에서 k개를 뽑는 경우를 다 더하면 전체(Vandermonde)", () => {
    expect(TOTAL).toBe(5_586_853_480n);
    let sum = 0n;
    for (let k = 0; k <= MEGA_BALL_DRAWN; k += 1) sum += choose(20, k) * choose(20, MEGA_BALL_DRAWN - k);
    expect(sum).toBe(TOTAL); // 반 반으로 나눈 모집단에서 12개를 뽑는 모든 경우(Vandermonde)
  });

  it("번호 칸: 그 번호가 12개 안에 있을 확률 12/40 (C(39,11)/C(40,12)) 로 정확히 센다", () => {
    expect(choose(39, 11) * 40n).toBe(TOTAL * 12n);
    // 대표 조합: 있는 경우 C(39,11) 가지, 없는 경우 C(39,12) 가지. 정의의 지급을 각각에 물려 합친다.
    for (let n = 1; n <= 40; n += 1) {
      const rest = nums(1, 40).filter((x) => x !== n);
      const within = payout(`mball:n${n}`, [...rest.slice(0, 11), n]);
      const without = payout(`mball:n${n}`, rest.slice(0, 12));
      expect(without).toBe(0);
      const value = rtp(choose(39, 11) * BigInt(within), TOTAL); // 질 때는 0 이라 이긴 조합만 더한다
      expect(value).toBeGreaterThanOrEqual(94);
      expect(value).toBeLessThanOrEqual(96.5);
    }
    expect(rtp(choose(39, 11) * BigInt(MEGA_BALL_PAYOUT.num), TOTAL)).toBe(94.5);
  });

  it("메가 구간 칸: 12번째 공은 40개 어느 숫자든 같은 확률이라 구간마다 정확히 1/4", () => {
    for (let range = 0; range < 4; range += 1) {
      let sum = 0n; // 12번째 공이 m 인 모든 순서 조합은 서로 같은 개수라 m 마다 가중치 1 로 센다(40 가지).
      for (let m = 1; m <= 40; m += 1) {
        const others = nums(1, 40).filter((x) => x !== m).slice(0, 11);
        sum += BigInt(payout(`mball:m${range + 1}`, [...others, m]));
      }
      expect(sum).toBe(10n * BigInt(MEGA_BALL_PAYOUT.mega)); // 10 개 숫자가 이긴다
      const value = rtp(sum, 40n);
      expect(value).toBeGreaterThanOrEqual(94);
      expect(value).toBeLessThanOrEqual(96.5);
      expect(value).toBe(95);
    }
  });

  it("홀짝·대소 칸: 한쪽이 7개 이상일 확률을 초기하 공식으로 센 값과 정의의 지급이 맞는다", () => {
    const cases: Array<[string, number[], number[]]> = [["odd", ODD, EVEN], ["even", EVEN, ODD], ["big", BIG, SMALL], ["small", SMALL, BIG]];
    const winWays = [7, 8, 9, 10, 11, 12].reduce((sum, k) => sum + choose(20, k) * choose(20, MEGA_BALL_DRAWN - k), 0n);
    expect(winWays).toBe(2_042_257_940n);
    const tieWays = choose(20, 6) * choose(20, 6);
    expect(tieWays).toBe(1_502_337_600n);
    expect(winWays * 2n + tieWays).toBe(TOTAL); // 이김 + 짐 + 6대6 = 전부
    for (const [name, marked, other] of cases) {
      // 표시된 쪽이 k 개인 조합은 C(20,k)·C(20,12−k) 가지. 정의의 지급을 k 마다 대표 조합으로 물려 합친다.
      let sum = 0n;
      for (let k = 0; k <= MEGA_BALL_DRAWN; k += 1) sum += choose(20, k) * choose(20, MEGA_BALL_DRAWN - k) * BigInt(payout(`mball:${name}`, pick(marked, other, k)));
      expect(sum).toBe(winWays * BigInt(MEGA_BALL_PAYOUT.side));
      const value = rtp(sum, TOTAL);
      expect(value).toBeGreaterThanOrEqual(94);
      expect(value).toBeLessThanOrEqual(96.5);
    }
    expect(rtp(winWays * BigInt(MEGA_BALL_PAYOUT.side), TOTAL)).toBe(95.042);
  });

  it("번호 칸의 하우스 몫(HOUSE_EDGE.mega_ball 에 넣은 값) = 1 − 0.3 × 3.15 = 5.5%", () => {
    expect(Math.round((1 - 0.3 * (MEGA_BALL_PAYOUT.num / 1000)) * 1000) / 1000).toBe(0.055);
  });
});

describe("메가볼 — 칸·지급", () => {
  it("칸은 48개(홀짝대소 4 · 메가 4 · 번호 40), 이름은 규칙에 맞고 중복 없이 전부 열려 있다", () => {
    const spots = def.spots(setup);
    expect(spots).toHaveLength(48);
    expect(new Set(spots.map((s) => s.choice)).size).toBe(48);
    for (const spot of spots) {
      expect(spot.choice).toMatch(/^mball:[a-z0-9_-]{1,16}$/);
      expect(spot.winPermille).toBeGreaterThan(1000);
    }
    expect(spots.filter((s) => s.group === "num")).toHaveLength(40);
    expect(spots.filter((s) => s.group === "mega").every((s) => s.narrow && s.tone === "gold")).toBe(true);
    expect(spots.filter((s) => s.group === "num").every((s) => !s.narrow && s.tone === "plain")).toBe(true);
    expect(spots.filter((s) => s.group === "side").map((s) => s.choice)).toEqual(["mball:odd", "mball:even", "mball:big", "mball:small"]);
    for (const spot of spots) expect(def.isNarrow(spot.choice)).toBe(Boolean(spot.narrow));
  });

  it("지급 경계: 6대6은 양쪽 다 지고 7대5는 많은 쪽만 이긴다", () => {
    // 홀수 6 · 짝수 6, 큰 수 6 · 작은 수 6
    const tie = [1, 3, 5, 21, 23, 25, 2, 4, 6, 22, 24, 26];
    for (const token of ["odd", "even", "big", "small"]) expect(payout(`mball:${token}`, tie)).toBe(0);
    // 홀수 7(1·3·5·7·21·23·25) 짝수 5, 큰 수 5(21·23·25·22·24) 작은 수 7
    const sevenOdd = [1, 3, 5, 7, 21, 23, 25, 2, 4, 22, 24, 6];
    expect(sevenOdd.filter((n) => n % 2 === 1)).toHaveLength(7);
    expect(payout("mball:odd", sevenOdd)).toBe(MEGA_BALL_PAYOUT.side);
    expect(payout("mball:even", sevenOdd)).toBe(0);
    expect(sevenOdd.filter((n) => n >= 21)).toHaveLength(5);
    expect(payout("mball:big", sevenOdd)).toBe(0);
    expect(payout("mball:small", sevenOdd)).toBe(MEGA_BALL_PAYOUT.side);
    expect(payout("mball:odd", nums(1, 12).map((n) => n * 2 - 1))).toBe(MEGA_BALL_PAYOUT.side); // 12개 전부 홀수
    expect(payout("mball:big", nums(29, 40))).toBe(MEGA_BALL_PAYOUT.side);
  });

  it("번호 칸은 12개 어디에 있든(메가볼 자리 포함) 이긴다", () => {
    const balls = [5, 17, 33, 2, 40, 11, 24, 8, 30, 19, 1, 36];
    expect(payout("mball:n17", balls)).toBe(MEGA_BALL_PAYOUT.num);
    expect(payout("mball:n36", balls)).toBe(MEGA_BALL_PAYOUT.num);
    expect(payout("mball:n3", balls)).toBe(0);
    expect(payout("mball:n39", balls)).toBe(0);
  });

  it("메가 구간 경계: 10→1–10 · 11→11–20 · 20→11–20 · 21→21–30 · 30→21–30 · 31→31–40 · 40→31–40, 메가볼(12번째)만 본다", () => {
    const base = [2, 3, 4, 5, 6, 7, 8, 9, 12, 25, 35];
    const expectRange = (mega: number, range: number) => {
      for (let r = 1; r <= 4; r += 1) expect(payout(`mball:m${r}`, [...base, mega])).toBe(r === range ? MEGA_BALL_PAYOUT.mega : 0);
      expect(megaBallRange(mega)).toBe(range - 1);
    };
    expectRange(1, 1); expectRange(10, 1); expectRange(11, 2); expectRange(20, 2);
    expectRange(21, 3); expectRange(30, 3); expectRange(31, 4); expectRange(40, 4);
    // 같은 숫자가 앞쪽 공이면 메가볼이 아니다
    expect(payout("mball:m1", [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21])).toBe(0);
    expect(payout("mball:m3", [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21])).toBe(MEGA_BALL_PAYOUT.mega);
  });

  it("다른 게임의 이름·모르는 이름은 0", () => {
    const balls = nums(1, 12);
    expect(payout("hilo:higher", balls)).toBe(0);
    expect(payout("mball:n41", balls)).toBe(0);
    expect(payout("mball:n0", balls)).toBe(0);
    expect(payout("mball:x", balls)).toBe(0);
    expect(payout("mball:m5", balls)).toBe(0);
  });

  it("이름표", () => {
    expect(def.betLabel("mball:n7")).toBe("번호 7");
    expect(def.betLabel("mball:m3")).toBe("메가 21–30");
    expect(def.betLabel("mball:odd")).toBe("홀수 많음");
    expect(def.betLabel("mball:small")).toBe("작은 수 많음");
  });
});

describe("메가볼 — 추첨과 공개", () => {
  it("draw 는 1~40 에서 겹치지 않는 12개를 뽑는다", () => {
    for (let i = 0; i < 500; i += 1) {
      const { balls } = def.draw(setup);
      expect(balls).toHaveLength(MEGA_BALL_DRAWN);
      expect(new Set(balls).size).toBe(MEGA_BALL_DRAWN);
      for (const ball of balls) { expect(Number.isInteger(ball)).toBe(true); expect(ball).toBeGreaterThanOrEqual(1); expect(ball).toBeLessThanOrEqual(MEGA_BALL_POOL); }
    }
  });

  it("5단계: 3 · 6 · 9 · 11개가 열리고 마지막 단계에서야 12번째(메가볼)가 열린다", () => {
    const outcome = def.draw(setup);
    const mega = outcome.balls[11]!;
    expect(def.steps(outcome)).toBe(5);
    expect(MEGA_BALL_REVEALED).toEqual([3, 6, 9, 11, 12]);
    expect(def.view(setup, null, 0)).toEqual({ balls: [], mega: null });
    expect(def.view(setup, outcome, 0)).toEqual({ balls: [], mega: null });
    [3, 6, 9, 11].forEach((count, index) => {
      const view = def.view(setup, outcome, index + 1) as { balls: number[]; mega: number | null };
      expect(view.balls).toEqual(outcome.balls.slice(0, count));
      expect(view.mega).toBeNull();
      expect(view.balls).not.toContain(mega); // 메가볼 번호는 공개 전 view 어디에도 없다
      expect(JSON.stringify(view)).not.toContain(`"mega":${mega}`);
    });
    expect(def.view(setup, outcome, 5)).toEqual({ balls: outcome.balls, mega });
  });

  it("history: 메가볼 번호가 글자, 구간이 색", () => {
    const at = (mega: number) => def.history(setup, { balls: [...nums(1, 40).filter((n) => n !== mega).slice(0, 11), mega] });
    expect(at(1)).toEqual({ label: "1", tone: "gold" });
    expect(at(10)).toEqual({ label: "10", tone: "gold" });
    expect(at(17)).toEqual({ label: "17", tone: "player" });
    expect(at(21)).toEqual({ label: "21", tone: "banker" });
    expect(at(40)).toEqual({ label: "40", tone: "tie" });
  });
});
