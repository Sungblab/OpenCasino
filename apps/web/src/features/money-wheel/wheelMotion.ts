import type { MoneyWheelSpin } from "@opencasino/contracts";
import { MONEY_WHEEL_SEGMENTS, moneyWheelSegmentMultiplier } from "@opencasino/game-core/money-wheel";

/**
 * 휠 각도는 시각의 순수 함수다: (판 시작 때 서 있던 자리, 시작된 회전들, 지금) → 각도.
 * 가려진 탭·재접속·늦게 들어온 사람도 같은 시각엔 같은 각도를 본다 — 화면이 자기 각도를 들고 있다가
 * 이어 그리지 않는다. 휠은 시계 방향으로 돌고, 칸 i 는 그려질 때 맨 위에서 시계 방향 i×STEP 자리다.
 */
export const SEGMENT_COUNT = MONEY_WHEEL_SEGMENTS.length;
export const STEP = 360 / SEGMENT_COUNT;

/** 칸 안 어디에 서는지(칸 폭의 ±0.3). 같은 칸이라도 매번 가운데에 딱 서지 않게. */
export function landingOffset(seed: number): number {
  return ((seed % 997) / 996 - 0.5) * 0.6;
}

/** 칸 segment 가 맨 위 포인터 아래 오는 휠 회전각(도). */
export function restAngle(segment: number, seed: number): number {
  return -(segment + landingOffset(seed)) * STEP;
}

/** 첫 회전 3~4바퀴, 재회전 2~3바퀴(목표 칸까지 남은 거리는 따로 더한다). */
function turns(seed: number, first: boolean): number {
  return (first ? 3 : 2) + (Math.floor(seed / 997) % 2);
}

/** 감속: 처음이 가장 빠르고 목표 칸에 정확히 서며 멈춘다(끝 속도 0). */
export function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

export interface WheelPose {
  angle: number;
  /** 다 멈춘 회전 수. */
  landed: number;
  /** 지금 도는 회전의 번호. 없으면 -1. */
  spinning: number;
}

export function wheelPose(rest: { segment: number; seed: number }, spins: readonly MoneyWheelSpin[], now: number): WheelPose {
  let angle = restAngle(rest.segment, rest.seed);
  for (const [k, spin] of spins.entries()) {
    const start = Date.parse(spin.startedAt);
    if (now < start) return { angle, landed: k, spinning: -1 };
    const target = restAngle(spin.segment, spin.seed);
    const delta = (((target - angle) % 360) + 360) % 360 + 360 * turns(spin.seed, k === 0);
    const t = (now - start) / spin.durationMs;
    if (t < 1) return { angle: angle + delta * easeOut(t), landed: k, spinning: k };
    angle = (angle + delta) % 360;
  }
  return { angle, landed: spins.length, spinning: -1 };
}

/** 멈춘 회전들의 배수 칸을 곱한 값(아직 배수 칸이 없으면 1). */
export function landedMultiplier(spins: readonly MoneyWheelSpin[], landed: number): number {
  return spins.slice(0, landed).reduce((product, spin) => product * (moneyWheelSegmentMultiplier(MONEY_WHEEL_SEGMENTS[spin.segment]!) ?? 1), 1);
}

/* ── 3D 무대(moneyWheelStageController)가 쓰는 순수 계산 — 칸 바깥 반지름이 1 인 단위 ─────────── */

/** 고정 틀(전구 링) 바깥 반지름, 화면 맨 위(포인터 머리 위 여유), 허브 반지름. */
export const WHEEL_FRAME_R = 1.24;
export const WHEEL_TOP = 1.3;
export const HUB_R = 0.56;
/** 허브의 GC 메달 높이 — 배너·결과 카드가 이 위에 겹쳐 뜬다(넓은 화면에서도 허브 윗부분이라 보인다). */
export const MEDAL_Y = 0.27;

export interface WheelFraming {
  /** 휠 면(z=0)에서 화면 세로가 담는 길이. */
  viewH: number;
  /** 화면 가운데의 휠 면 높이(휠 중심 = 0). */
  centerY: number;
  /** 허브 위에 띄우는 글(배수 배너·결과) 가운데의 화면 y(px, 위에서) — 보통 메달 자리. */
  hubPx: number;
}

/**
 * 화면 크기 → 휠 면의 어디를 얼마나 보일지. 포인터는 늘 맨 위. 넓고 낮은 화면(PC)은 큰 휠의 윗부분만, 세로 폰은
 * 휠 대부분: 보이는 맨 아래에서 휠 폭이 화면 폭의 80% 가 되는 높이를 고르고, 칸 숫자가 읽히게 1 단위가 200px 아래로
 * 내려가지 않게(넓은 화면에선 700px 위로 커지지 않게) 묶는다. 예전 SVG 휠의 배치 규칙 그대로다.
 */
export function wheelFraming(width: number, height: number): WheelFraming {
  const aspect = width / height;
  const r = WHEEL_FRAME_R;
  const gap = (viewH: number) => 2 * Math.sqrt(Math.max(0, r * r - (WHEEL_TOP - viewH) ** 2)) - 0.8 * aspect * viewH;
  // gap 은 이 구간에서 오목하다 — 양 끝 부호가 다르면 근이 하나라 이분법으로 찾는다.
  let lo = WHEEL_TOP - r * 0.5;
  let hi = WHEEL_TOP + r;
  if (gap(lo) <= 0) hi = lo;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (gap(mid) > 0) lo = mid;
    else hi = mid;
  }
  const viewH = Math.min(WHEEL_TOP + r + 0.05, Math.max(height / 700, Math.min(hi, height / 200)));
  const centerY = WHEEL_TOP - viewH / 2;
  const perUnit = height / viewH;
  // 메달 위. 화면이 아주 낮아 메달이 아래로 잘리면 보이는 맨 아래에서 60px 위로, 허브 꼭대기에서 40px 은 내려온다.
  const hubY = Math.min(HUB_R - 40 / perUnit, Math.max(MEDAL_Y, WHEEL_TOP - viewH + 60 / perUnit));
  return { viewH, centerY, hubPx: (WHEEL_TOP - hubY) * perUnit };
}

/** 포인터에 가장 가까운 못(칸 경계)의 위치, 칸 단위 [-0.5, 0.5). 0 이면 바로 아래, 음수면 다가오는 중(휠은 시계 방향). */
export function pegOffset(angle: number): number {
  const y = angle / STEP - 0.5;
  return y - Math.round(y);
}

/**
 * 플래퍼: 다가오는 못이 contact 에서 닿아 slip 까지 밀고 빠져나가면, 감쇠 진동하며 제자리로 돌아온다.
 * 멈춘 휠은 칸 가운데 ±0.3 칸에 서므로(landingOffset) 못이 0.2 칸 넘게 떨어져 있다 — contact·slip 을 그보다 작게 둬야
 * 멈춘 뒤 플래퍼가 못에 걸린 채로 남지 않는다.
 */
export const FLAPPER = { contact: 0.16, slip: 0.12, max: 0.34, settleMs: 70, periodMs: 140 } as const;

/**
 * 플래퍼 기울기(라디안, + 는 시계 방향으로 밀린 쪽). 휠 각도와 각속도(도/ms)만의 함수라 화면이 상태를 들고 있지 않는다.
 * 풀린 뒤 지난 시간은 "풀린 뒤 지나간 칸 ÷ 지금 속도"로 어림한다 — 한 칸 사이에서는 속도가 거의 그대로다.
 */
export function flapperAngle(angle: number, degPerMs: number): number {
  const { contact, slip, max, settleMs, periodMs } = FLAPPER;
  const x = pegOffset(angle);
  const pushed = x >= -contact && x <= slip ? (max * (x + contact)) / (contact + slip) : 0;
  const since = x > slip ? x - slip : x + 1 - slip;
  const ms = degPerMs > 1e-5 ? (since * STEP) / degPerMs : Infinity;
  const free = Number.isFinite(ms) ? max * Math.exp(-ms / settleMs) * Math.cos((2 * Math.PI * ms) / periodMs) : 0;
  return pushed > 0 ? Math.max(pushed, free) : free;
}

/**
 * 전구 i(n 개, 맨 위에서 시계 방향)의 밝기 0~1.
 * idle: 전구마다 다른 박자로 은은하게 숨쉰다. spin: 꼬리 달린 불빛 넷이 휠의 두 배로 돈다(휠이 느려지면 같이 느려진다).
 * win: 한 칸 건너 번갈아 깜빡인다.
 */
export function bulbLevel(mode: "idle" | "spin" | "win", i: number, n: number, ms: number, angle: number): number {
  if (mode === "win") return (Math.floor(ms / 240) + i) % 2 === 0 ? 1 : 0.2;
  if (mode === "spin") {
    const period = n / 4;
    const head = ((angle * 2) / 360) * n;
    const behind = (((head - i) % period) + period) % period;
    return 0.18 + 0.82 * Math.exp(-behind / 2.2);
  }
  return 0.55 + 0.45 * Math.sin(ms / 900 + i * 2.39996) ** 2;
}
