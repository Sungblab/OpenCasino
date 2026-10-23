import { secureRandomInt } from "../lightning.js";
import type { Json, TableGameDef, TableHistoryEntry, TableSpot } from "./types.js";

/**
 * 메가볼 — 추첨기에서 공 12개가 순서대로 나온다(1~40 중 겹치지 않게). 마지막 12번째 공이 메가볼이다.
 *
 * 베팅은 네 가지다. 번호(그 숫자가 12개 안에 있나) · 메가 구간(메가볼이 1–10/11–20/21–30/31–40 중 어디인가) ·
 * 홀짝(12개 중 홀수가 더 많나) · 대소(21 이상이 더 많나). 홀짝·대소는 6대6이면 양쪽 다 진다.
 *
 * 공개는 5단계다. 공 3 · 6 · 9 · 11개까지 차례로 열리고, 마지막 단계에서 12번째(메가볼)가 혼자 열린다.
 * 메가볼 번호는 마지막 단계 전의 view 어디에도 없다. 서버는 view 를 그대로 모든 사람에게 보낸다.
 *
 * 배당은 상수다(판마다 안 변한다). 확률은 초기하분포라 계산으로 딱 떨어진다 — 메가볼은 12번째 공이지만 40개 어느 숫자든
 * 같은 확률이라 구간마다 1/4, 번호는 12/40, 홀짝·대소는 20개씩 갈린 모집단에서 12개를 뽑은 결과다(mega-ball.test.ts 가 정확히 센다).
 */

export const MEGA_BALL_POOL = 40;
export const MEGA_BALL_DRAWN = 12;
/** 단계(1~5)마다 열려 있는 공의 누적 개수. 마지막 단계에서 12번째, 메가볼이 혼자 열린다. */
export const MEGA_BALL_REVEALED = [3, 6, 9, 11, 12] as const;

/**
 * 이겼을 때 돌려받는 몫(permille, 원금 포함). 이론 반환율:
 *   번호  12/40 × 3.15 = 94.50%
 *   메가  1/4 × 3.8 = 95.00%
 *   홀짝·대소  P(한쪽이 7개 이상) = 2 042 257 940 / 5 586 853 480 = 36.5547% × 2.6 = 95.04%
 */
export const MEGA_BALL_PAYOUT = { num: 3150, mega: 3800, side: 2600 } as const;

export interface MegaBallSetup { [key: string]: Json }
export interface MegaBallOutcome { [key: string]: Json; balls: number[] }

/** 숫자가 속한 구간 0~3 (1–10 / 11–20 / 21–30 / 31–40). */
export const megaBallRange = (n: number): number => Math.floor((n - 1) / 10);

const RANGE_LABEL = ["1–10", "11–20", "21–30", "31–40"] as const;
const RANGE_TONE = ["gold", "player", "banker", "tie"] as const;
/** 기록(betLabel)은 한국어, 베팅 칸에 찍히는 이름은 영어. */
const SIDE_LABEL: Record<string, string> = { odd: "홀수 많음", even: "짝수 많음", big: "큰 수 많음", small: "작은 수 많음" };
const SIDE_ZONE: Record<string, string> = { odd: "MORE ODD", even: "MORE EVEN", big: "MORE BIG", small: "MORE SMALL" };
const SIDE_TONE: Record<string, string> = { odd: "purple", even: "orange", big: "black", small: "plain" };

const SPOTS: readonly TableSpot[] = [
  ...(["odd", "even", "big", "small"] as const).map((token): TableSpot => ({
    choice: `mball:${token}`, label: SIDE_ZONE[token]!, winPermille: MEGA_BALL_PAYOUT.side, group: "side", tone: SIDE_TONE[token],
  })),
  ...RANGE_LABEL.map((range, index): TableSpot => ({
    choice: `mball:m${index + 1}`, label: `MEGA ${range}`, winPermille: MEGA_BALL_PAYOUT.mega, group: "mega", narrow: true, tone: "gold",
  })),
  ...Array.from({ length: MEGA_BALL_POOL }, (_, index): TableSpot => ({
    choice: `mball:n${index + 1}`, label: String(index + 1), winPermille: MEGA_BALL_PAYOUT.num, group: "num", tone: "plain",
  })),
];

/** 홀수·큰 수(21 이상) 개수. 홀짝·대소 판정이 같이 쓴다. */
function tallies(balls: readonly number[]): { odd: number; big: number } {
  let odd = 0;
  let big = 0;
  for (const ball of balls) {
    if (ball % 2 === 1) odd += 1;
    if (ball >= 21) big += 1;
  }
  return { odd, big };
}

function won(token: string, balls: readonly number[]): boolean {
  const mega = balls[balls.length - 1]!;
  const number = /^n(\d{1,2})$/.exec(token);
  if (number) return balls.includes(Number(number[1]));
  const range = /^m([1-4])$/.exec(token);
  if (range) return megaBallRange(mega) === Number(range[1]) - 1;
  // 6대6(같은 수)은 양쪽 다 진다.
  const { odd, big } = tallies(balls);
  const half = balls.length / 2;
  switch (token) {
    case "odd": return odd > half;
    case "even": return odd < half;
    case "big": return big > half;
    case "small": return big < half;
    default: return false;
  }
}

export const megaBallGame: TableGameDef<MegaBallSetup, MegaBallOutcome> = {
  type: "mega_ball",
  prefix: "mball",
  rulesVersion: "megaball-v1",
  label: "메가볼",
  bettingMs: 15_000,
  stepMs: 1_500,

  newSetup: () => ({}),

  draw() {
    // 부분 피셔–예이츠: 앞에서부터 12개만 확정한다. 순서가 곧 추첨 순서라 편향 없이 균등하다.
    const pool = Array.from({ length: MEGA_BALL_POOL }, (_, index) => index + 1);
    for (let index = 0; index < MEGA_BALL_DRAWN; index += 1) {
      const pick = index + secureRandomInt(MEGA_BALL_POOL - index);
      [pool[index], pool[pick]] = [pool[pick]!, pool[index]!];
    }
    return { balls: pool.slice(0, MEGA_BALL_DRAWN) };
  },

  steps: () => MEGA_BALL_REVEALED.length,

  spots: () => SPOTS.slice(),

  isNarrow: (choice) => /^mball:m[1-4]$/.test(choice),

  betLabel(choice) {
    const token = choice.slice(6);
    if (/^n\d{1,2}$/.test(token)) return `번호 ${token.slice(1)}`;
    if (/^m[1-4]$/.test(token)) return `메가 ${RANGE_LABEL[Number(token.slice(1)) - 1]}`;
    return SIDE_LABEL[token] ?? choice;
  },

  payoutPermille(choice, _setup, outcome) {
    const token = choice.slice(6);
    if (!choice.startsWith("mball:") || !won(token, outcome.balls)) return 0;
    return SPOTS.find((spot) => spot.choice === choice)?.winPermille ?? 0;
  },

  view(_setup, outcome, step) {
    if (!outcome || step <= 0) return { balls: [], mega: null };
    const shown = MEGA_BALL_REVEALED[Math.min(step, MEGA_BALL_REVEALED.length) - 1]!;
    // 메가볼은 마지막 단계에서 12번째 공이 열릴 때만 실린다.
    return { balls: outcome.balls.slice(0, shown), mega: shown === MEGA_BALL_DRAWN ? outcome.balls[MEGA_BALL_DRAWN - 1]! : null };
  },

  history(_setup, outcome): TableHistoryEntry {
    const mega = outcome.balls[MEGA_BALL_DRAWN - 1]!;
    return { label: String(mega), tone: RANGE_TONE[megaBallRange(mega)]! };
  },
};
