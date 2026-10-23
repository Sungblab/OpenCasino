import { secureRandomInt, type RandomInt } from "./lightning.js";

/**
 * 파친코(공 하나 = 한 판, 1인용). 12줄 못판 맨 위에서 구슬이 떨어져 줄마다 왼쪽·오른쪽 50:50 으로 튀고, 닿은 칸(13개)의
 * 배수를 받는다. 칸 확률은 이항분포(C(12,k)/4096)라 가운데가 가장 잘 맞고 가장자리는 드물다 — 그래서 가운데 칸은 베팅보다
 * 적게 돌려주고 가장자리가 크게 준다. 위험도(안정·보통·도전)는 같은 못판에 배당표만 바꾼 것이다.
 *
 * 환수율은 세 표 모두 약 96%(하우스 4%) — 칸 확률이 정확한 분수라 추정이 아니라 계산한 값이고, pachinko.test.ts 가 박아 둔다.
 * 배수는 천분율(permille)이고 돈은 최소 단위(1코인 = 100)다. 지급은 베팅 × 배수 / 1000 을 내림한다(0.01코인 미만만 버린다).
 * 결과(path)는 서버가 한 번만 뽑아 DB 에 적고, 화면은 그 경로를 그대로 따라 굴린다 — 화면이 결과를 정하지 않는다.
 *
 * 서버(결과·정산)와 브라우저(배당표·경로 애니메이션)가 같이 불러온다.
 */

export const PACHINKO_ROWS = 12;
export const PACHINKO_POCKETS = PACHINKO_ROWS + 1;

export type PachinkoRisk = "low" | "mid" | "high";
export const PACHINKO_RISKS: readonly PachinkoRisk[] = ["low", "mid", "high"];
export const PACHINKO_RISK_LABEL: Record<PachinkoRisk, string> = { low: "안정", mid: "보통", high: "도전" };

/** 칸마다 돌려받는 전체(원금 포함)의 천분율. 왼쪽 끝 → 오른쪽 끝, 좌우 대칭. */
export const PACHINKO_PAY_PERMILLE: Record<PachinkoRisk, readonly number[]> = {
  low: [9000, 3000, 1600, 1300, 1100, 940, 520, 940, 1100, 1300, 1600, 3000, 9000],
  mid: [26000, 9000, 3800, 1900, 1100, 630, 260, 630, 1100, 1900, 3800, 9000, 26000],
  high: [110000, 18000, 5000, 1800, 500, 620, 380, 620, 500, 1800, 5000, 18000, 110000],
};

/** 총베팅 단계(최소 단위): 0.2 · 0.5 · 1 · 2 · 5 · 10 · 20 · 50 · 100 · 200 코인. 방의 최소·최대 안에서만 고른다. */
export const PACHINKO_BET_STEPS = [20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000] as const;

/** 한 칸에 떨어질 경우의 수(전체 4096). */
export const PACHINKO_POCKET_WEIGHTS: readonly number[] = (() => {
  const row = [1];
  for (let i = 0; i < PACHINKO_ROWS; i += 1) {
    for (let k = row.length; k > 0; k -= 1) row[k] = (row[k] ?? 0) + row[k - 1]!;
  }
  return row;
})();
export const PACHINKO_TOTAL_PATHS = 2 ** PACHINKO_ROWS;

/** 이론 환수율(0~1). 정확한 분수 계산. */
export function pachinkoRtp(risk: PachinkoRisk): number {
  const weighted = PACHINKO_PAY_PERMILLE[risk].reduce((sum, pay, pocket) => sum + pay * PACHINKO_POCKET_WEIGHTS[pocket]!, 0);
  return weighted / (PACHINKO_TOTAL_PATHS * 1000);
}

/** 화면 표기용 환수율(%), 소수 둘째 자리. */
export function pachinkoRtpPercent(risk: PachinkoRisk): number {
  return Math.round(pachinkoRtp(risk) * 10_000) / 100;
}

/** 칸에 닿을 확률(0~1). */
export function pachinkoPocketChance(pocket: number): number {
  return (PACHINKO_POCKET_WEIGHTS[pocket] ?? 0) / PACHINKO_TOTAL_PATHS;
}

export interface PachinkoDrop {
  /** 줄마다 0 = 왼쪽, 1 = 오른쪽. */
  path: number[];
  /** 닿은 칸(0 = 맨 왼쪽). path 의 1 의 개수와 같다. */
  pocket: number;
}

/** 구슬 하나를 떨어뜨린다. 한 줄씩 동전 던지기 — 서버가 부르고, 결과를 적은 뒤에야 화면에 간다. */
export function dropPachinkoBall(rng: RandomInt = secureRandomInt): PachinkoDrop {
  const path: number[] = [];
  for (let row = 0; row < PACHINKO_ROWS; row += 1) path.push(rng(2));
  return { path, pocket: path.reduce((sum, bit) => sum + bit, 0) };
}

/** 경로 → 칸. 화면이 서버가 준 경로를 믿고 따라갈 때, 잘못된 경로를 걸러 내는 데도 쓴다. */
export function pachinkoPocketOf(path: readonly number[]): number | null {
  if (path.length !== PACHINKO_ROWS || path.some((bit) => bit !== 0 && bit !== 1)) return null;
  return path.reduce((sum, bit) => sum + bit, 0);
}

export function pachinkoMultiplierPermille(risk: PachinkoRisk, pocket: number): number {
  const pay = PACHINKO_PAY_PERMILLE[risk][pocket];
  if (pay === undefined) throw new RangeError(`pachinko pocket out of range: ${pocket}`);
  return pay;
}

/** 지급(최소 단위, 원금 포함). 내림. */
export function pachinkoPayout(bet: number, risk: PachinkoRisk, pocket: number): number {
  return Math.floor((bet * pachinkoMultiplierPermille(risk, pocket)) / 1000);
}

/** 배수 표시("9", "0.94", "110"). 천분율 → 사람이 읽는 글자. */
export function pachinkoMultiplierText(permille: number): string {
  const value = permille / 1000;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/** 칸의 색 이름: 베팅보다 많이(win)·본전 근처(even)·잃는(lose). 로비 구슬과 화면 칸이 같은 말을 쓴다. */
export function pachinkoTone(permille: number): "big" | "win" | "even" | "lose" {
  if (permille >= 5000) return "big";
  if (permille > 1000) return "win";
  if (permille === 1000) return "even";
  return "lose";
}
