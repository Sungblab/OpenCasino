import { COMPACT_W, fitStage, type StageFit } from "../stage/layout";

/**
 * 섯다 판의 순수 배치 계산. 캔버스(sutdaStageController.ts)가 이걸로 자리를 잡고, 그 결과(배율·원점·자리)를
 * 이벤트로 DOM 층(SutdaStage.tsx)에 넘긴다 — DOM 이 따로 계산하면 경계값 근처에서 둘이 다른 배치를 골라
 * 패와 이름표가 따로 놀았다. DOM 은 WebGL 이 없을 때만 이 함수들로 직접 계산한다.
 *
 * 판은 게임 영역 전체를 덮고, 베팅 독은 판 안 아래에 올라탄다. 그래서 설계는 "독을 뺀 높이"에 맞춘다.
 * 설계는 세 가지다: 넓은 화면(PC·태블릿) 높이 400, 낮은 가로 폰 높이 300(상대는 위쪽 한 줄),
 * 폭이 좁은 세로 폰은 폭 360 에 높이를 화면 비율대로. 자리는 나로부터 시계 방향으로 몇 번째인지(rel)로
 * 정한다 — 내가 늘 아래다.
 */

export type SutdaMode = "wide" | "short" | "tall";

/** 화투 한 장(설계, 배율 1). 그림 250×408 과 같은 비율. */
export const HWATU = { w: 50, h: 82 } as const;
/** 한 자리 안에서 화투가 겹쳐 놓이는 간격(카드 폭의 비율). */
const FAN = 0.62;
/** 이보다 낮은 판(독을 포함한 판 전체 높이, px)은 가로 폰 배치. 가로 폰은 헤더가 옆 막대로 바뀌어 판이 430 을
 *  넘기도 해서 그런 폰에 PC 배치가 걸리지 않을 만큼 높게 잡는다. 독을 뺀 높이로 고르면 안 된다 — 독 높이가
 *  배치마다 달라(PC 54 · 가로 폰 50) 경계 근처 높이에서 배치 → 독 → 남는 높이 → 배치가 번갈아 뒤집혔다. */
const SHORT_H = 500;

/** width 는 판 폭, full 은 독까지 포함한 판 전체 높이(px). */
export function sutdaMode(width: number, full: number): SutdaMode {
  if (width < COMPACT_W) return "tall";
  return full < SHORT_H ? "short" : "wide";
}

/** 판 안 아래에 올라탄 베팅 독이 차지하는 높이(px): 독 + 아래 여백 + 판과 독 사이 틈. 설계는 그 위에 짠다.
 *  독 높이는 배치마다 고정이라(table-sutda-v6.css 의 .sv6-dock-slot — 넓은 54 · 가로 폰 50 · 세로 폰 80) 재지 않고
 *  여기서 정한다. 재면 배치가 바뀐 뒤 한 번 더 그려야 해서 첫 화면에서 이름표가 독에 걸렸다. CSS 를 바꾸면 같이 바꾼다. */
export const DOCK_INSET: Record<SutdaMode, number> = { wide: 54 + 10 + 8, short: 50 + 6 + 6, tall: 80 + 6 + 12 };

/** 넓은 화면 설계 높이. 400 이면 PC 에서 배율이 1.5 까지 올라 패가 75×123px 로 커졌다. */
const WIDE_H = 460;
/** 넓은 화면 배율 상한 — 큰 모니터에서도 패가 이 이상 커지지 않게, 남는 높이는 설계를 늘려 자리를 벌린다. */
const WIDE_MAX_SCALE = 1.35;

/** height 는 독을 뺀 높이, full 은 판 전체 높이(배치 고르기용). */
export function sutdaHeight(width: number, height: number, full = height): number {
  if (sutdaMode(width, full) === "short") return 300;
  return Math.max(WIDE_H, Math.round(height / WIDE_MAX_SCALE));
}

export function sutdaCompactSize(width: number, height: number): { w: number; h: number } {
  return { w: 360, h: Math.round(Math.min(820, Math.max(400, (360 * height) / Math.max(1, width)))) };
}

/** 캔버스(core)와 같은 규칙으로 고른 배치. WebGL 이 없을 때 DOM 층이 직접 쓴다. width·full 은 판 전체 크기. */
export function sutdaFit(width: number, full: number): StageFit & { designH: number; mode: SutdaMode } {
  const mode = sutdaMode(width, full);
  const height = Math.max(1, full - DOCK_INSET[mode]);
  const size = mode === "tall" ? sutdaCompactSize(width, height) : { w: 640, h: sutdaHeight(width, height, full) };
  return { ...fitStage(width, height, size.w, size.h), designH: size.h, mode };
}

/** 캔버스가 고른 설계 크기에서 배치 종류를 되읽는다. */
export function modeOf(compact: boolean, designH: number): SutdaMode {
  if (compact) return "tall";
  return designH === 300 ? "short" : "wide";
}

/** 캔버스가 배치를 정할 때마다 host 에서 올려 보내는 이벤트. DOM 층은 이것만 보고 자리를 잡는다. */
export const SUTDA_LAYOUT_EVENT = "sutda-layout";
export interface SutdaLayoutDetail {
  mode: SutdaMode;
  designW: number;
  designH: number;
  maxCards: number;
  /** 설계 좌표 1 의 px, 설계 원점의 px 위치(host 기준). */
  scale: number;
  x: number;
  y: number;
}

export interface Point { x: number; y: number }

export interface SeatSpot {
  /** 패 가운데. */
  x: number;
  y: number;
  /** 화투 배율. */
  scale: number;
  /** 이름표 자리와 붙는 방향: below = 패 아래 가운데, left = 패 왼쪽(오른쪽 끝을 여기에), right = 패 오른쪽(왼쪽 끝을 여기에). */
  plate: Point & { side: "below" | "left" | "right" };
  /** 말풍선 꼬리가 가리킬 곳과 방향. */
  bubble: Point & { side: "above" | "right" | "left" | "center" };
}

export interface SutdaGeometry {
  mode: SutdaMode;
  w: number;
  h: number;
  /** 위쪽 도구 줄(DOM)이 쓰는 띠. 이 아래에만 자리를 놓는다. */
  top: number;
  pot: Point;
  caption: Point;
  /** 결과 배너 가운데. */
  banner: Point;
  /** 차례 시계. 폰에선 머리줄·독이 초를 보여 주므로 없다. */
  timer: Point | null;
  deck: Point;
  /** 족보 태그(내 패 옆)의 기준점과 붙는 방향. */
  tag: Point & { side: "right" | "below" };
  seat(rel: number): SeatSpot;
}

/** 한 자리의 패 묶음 폭(설계). */
export function fanWidth(count: number, scale: number): number {
  const w = HWATU.w * scale;
  return w + Math.max(0, count - 1) * w * FAN;
}

/** 자리 안에서 index 번째 패의 가운데(묶음 가운데 기준 x 오프셋). */
export function fanOffset(index: number, count: number, scale: number): number {
  const step = HWATU.w * scale * FAN;
  return (index - (count - 1) / 2) * step;
}

const below = (x: number, y: number, scale: number): SeatSpot => ({
  x, y, scale,
  plate: { x, y: y + (HWATU.h * scale) / 2 + 3, side: "below" },
  bubble: { x, y: y - (HWATU.h * scale) / 2 - 2, side: "above" },
});

const mineAt = (x: number, y: number, scale: number, maxCards: number): SeatSpot => ({
  x, y, scale,
  plate: { x: x - fanWidth(maxCards, scale) / 2 - 10, y, side: "left" },
  bubble: { x, y: y - (HWATU.h * scale) / 2 - 2, side: "above" },
});

/** 이름표를 패 오른쪽에(판 오른쪽 줄 자리 — 패가 판 안쪽을 향한다). */
const plateRight = (x: number, y: number, scale: number, maxCards: number): SeatSpot => ({
  x, y, scale,
  plate: { x: x + fanWidth(maxCards, scale) / 2 + 10, y, side: "right" },
  bubble: { x, y: y - (HWATU.h * scale) / 2 - 2, side: "above" },
});

/** 위쪽 줄 자리의 말풍선은 도구 줄과 겹치므로 패 옆으로 — 판 오른쪽 절반 자리는 왼쪽으로(판 밖으로 잘리지 않게). */
const bubbleSide = (spot: SeatSpot, w: number): SeatSpot => {
  const half = fanWidth(2, spot.scale) / 2 + 2;
  return spot.x > w * 0.6
    ? { ...spot, bubble: { x: spot.x - half, y: spot.y, side: "left" } }
    : { ...spot, bubble: { x: spot.x + half, y: spot.y, side: "right" } };
};

/**
 * @param maxCards 이 방에서 한 자리가 가질 수 있는 최대 장수(2 또는 3) — 내 패 옆 이름표·족보 태그는
 *   최대 장수 기준으로 자리를 잡아 셋째 장이 와도 움직이지 않는다.
 */
export function sutdaGeometry(mode: SutdaMode, w: number, h: number, maxCards: number): SutdaGeometry {
  const cx = w / 2;
  if (mode === "tall") {
    // 세로 폰: 위쪽에 셋, 양옆에 둘, 가운데 판돈, 아래 나(족보 태그는 내 패 밑).
    const top = 42;
    const opp = 0.72;
    const mine = 1.16;
    // 줄마다 필요한 높이만큼 위에서부터 쌓는다(패 59 + 이름표 약 40). 화면 비율로 나누면 작은 폰에서
    // 줄끼리 부딪혔다. 남는 높이는 옆줄과 내 줄 사이(판돈 쪽)로 간다.
    // 한 줄 = 패(59) + 이름표(약 42) + 틈. 위쪽 줄 → 옆줄 → 내 줄 순서.
    const rowY = top + 34;
    const sideY = rowY + 110;
    // 족보 태그(최대 네 줄)가 내 패 밑에 붙으므로 그만큼 위로 — 아래는 독이다. 그래도 옆줄 이름표 밑이어야 한다.
    const meY = Math.max(sideY + 100, h - 142);
    // 판돈: 화면이 길면 옆줄 아래와 내 패 위 사이 한가운데(빈 띠를 채운다), 짧으면 옆자리 둘 사이.
    const potY = meY - sideY >= 190 ? Math.round((sideY + 82 + meY - 55) / 2) : sideY - 8;
    const spots: SeatSpot[] = [
      mineAt(cx + 14, meY, mine, maxCards),
      below(54, sideY, opp),
      bubbleSide(below(62, rowY, opp), w),
      bubbleSide(below(cx, rowY, opp), w),
      bubbleSide(below(w - 62, rowY, opp), w),
      below(w - 54, sideY, opp),
    ];
    return {
      mode, w, h, top,
      pot: { x: cx, y: potY },
      // 판돈 알약(pot.y + 30 가운데, 높이 약 20) 밑.
      caption: { x: cx, y: potY + 56 },
      banner: { x: cx, y: potY + 4 },
      timer: null,
      deck: { x: cx + 76, y: potY + 4 },
      tag: { x: cx, y: meY + (HWATU.h * mine) / 2 + 8, side: "below" },
      seat: (rel) => spots[rel] ?? spots[0]!,
    };
  }
  if (mode === "short") {
    // 가로 폰: 위쪽에 상대 한 줄, 가운데 판돈·더미, 아래 내 줄(이름표 · 패 · 족보 태그). 독은 이 아래.
    // 폰 전용 촘촘한 배치: 도구 줄 약 30px, 이름표 약 32px(폰 CSS).
    const top = 42;
    const opp = 0.6;
    const mine = 0.92;
    const rowY = top + 27;
    const meY = h - 40;
    // 가운데 띠: 위쪽 줄 이름표 밑과 내 패 위 사이 한가운데.
    const midY = Math.round((rowY + (HWATU.h * opp) / 2 + 38 + meY - (HWATU.h * mine) / 2) / 2);
    const xs = [0.1, 0.3, 0.5, 0.7, 0.9];
    const me = mineAt(cx, meY, mine, maxCards);
    const spots: SeatSpot[] = [
      // 내 말풍선은 패 위가 아니라 이름표(패 왼쪽, 폭 약 94) 위 — 패 바로 위는 판돈 칩과 "팟 N코인"이다.
      { ...me, bubble: { x: me.plate.x - 47, y: meY - 18, side: "above" } },
      // 위 줄 말풍선은 그 자리 이름표 위 가운데. 패 옆으로 내면 다섯 자리가 붙은 이 줄에선 가운데 두 자리가 같은
      // 틈으로 말풍선을 내 서로 덮었다. 패 위는 안 된다 — 3장 섯다의 공개 패는 베팅 판단거리다.
      ...xs.map((f) => {
        const spot = below(w * f, rowY, opp);
        return { ...spot, bubble: { x: spot.plate.x, y: spot.plate.y + 22, side: "center" as const } };
      }),
    ];
    return {
      mode, w, h, top,
      pot: { x: cx, y: midY },
      caption: { x: cx, y: midY + 30 },
      banner: { x: cx, y: midY },
      timer: null,
      deck: { x: cx + 96, y: midY + 4 },
      tag: { x: cx + fanWidth(maxCards, mine) / 2 + 12, y: meY, side: "right" },
      seat: (rel) => spots[rel] ?? spots[0]!,
    };
  }
  // 넓은 화면(국내 섯다 앱들의 배치): 상대는 양옆 가장자리에 둘씩, 맨 위 가운데 하나 — 이름표와 패를
  // 가로로 붙이고 패는 판 안쪽을 향한다. 판돈·시계·더미는 가운데, 나는 아래 가운데.
  const top = 44;
  const opp = 0.8;
  const mine = 1.1;
  const half = fanWidth(maxCards, opp) / 2;
  // 이름표(약 118) + 틈 + 패 반 폭. 판 가장자리에서 12 띄운다.
  const colX = 12 + 118 + 10 + half;
  const meY = h - 72;
  // 세로 자리는 설계 높이의 비율로(460 기준: 위 150 · 아래 272 · 판돈 196). 큰 모니터는 설계가 길어지므로
  // 그만큼 벌어진다.
  const at = (f: number) => Math.round(top + (h - top) * f);
  const upY = at(0.255);
  const lowY = at(0.548);
  const potY = at(0.365);
  const spots: SeatSpot[] = [
    mineAt(cx, meY, mine, maxCards),
    mineAt(colX, lowY, opp, maxCards),
    mineAt(colX, upY, opp, maxCards),
    bubbleSide(mineAt(cx + 40, 88, opp, maxCards), w),
    plateRight(w - colX, upY, opp, maxCards),
    plateRight(w - colX, lowY, opp, maxCards),
  ];
  return {
    mode, w, h, top,
    pot: { x: cx, y: potY },
    caption: { x: cx, y: potY + 40 },
    banner: { x: cx, y: potY + 4 },
    timer: { x: cx - 72, y: potY },
    deck: { x: cx + 72, y: potY - 4 },
    tag: { x: cx + fanWidth(maxCards, mine) / 2 + 12, y: meY, side: "right" },
    seat: (rel) => spots[rel] ?? spots[0]!,
  };
}

/** 좌석 번호 → rel(나로부터 시계 방향 몇 번째). 관전 중에는 1번이 아래. */
export function relOf(seatNumber: number, mySeatNumber: number | null, seatCount: number): number {
  const base = mySeatNumber ?? 1;
  return (seatNumber - base + seatCount) % seatCount;
}
