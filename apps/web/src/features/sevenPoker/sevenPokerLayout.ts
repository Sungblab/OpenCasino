import { COMPACT_W, fitStage, type StageFit } from "../stage/layout";

/**
 * 7포커 판의 순수 배치 계산 — 홀덤 v6 와 같은 틀(캔버스가 이걸로 카드·칩을 놓고, 같은 frame 을 DOM 층이 받아
 * 이름표·버튼을 얹는다). 다른 점은 한 자리에 카드가 최대 7장이라는 것: 자리마다 7장 칸을 미리 잡아 두고
 * 카드가 그 칸을 채운다 — 카드가 올 때마다 패가 흔들리지 않게. 옆줄 자리는 이름표 쪽에 붙여 채우고(오른쪽
 * 줄은 오른쪽 끝에 붙어 새 카드가 오면 앞 카드가 한 칸씩 밀린다), 위 줄과 세로 화면의 나는 가운데 정렬.
 *
 * 남의 공개 패가 판단거리라 상대 카드도 숫자 귀퉁이가 보이게 겹친다(간격 ≥ 카드 폭의 0.42).
 */

export type SevenMode = "wide" | "short" | "tall";

/** 트럼프 한 장(설계, 배율 1) — stage/core 의 CW×CH. */
export const CARD = { w: 76, h: 106 } as const;
const SHORT_H = 500;
/** 판 안 아래 독 높이(독 + 여백 + 틈). 홀덤 v6 의 .hv6-dock-slot 과 같고, 세로 폰만 버튼 두 줄(44px×2)이라 한 줄 높다
 *  — table-seven-poker.css 의 tall 독 높이(98)와 짝. */
export const DOCK_INSET: Record<SevenMode, number> = { wide: 54 + 10 + 8, short: 50 + 6 + 6, tall: 98 + 6 + 12 };
const WIDE_H = 460;
const WIDE_MAX_SCALE = 1.35;
/** 내 공개 패는 이만큼 위로 — 엎은(나만 보는) 패와 한눈에 갈린다. */
export const UP_LIFT = 9;

export function sevenMode(width: number, full: number): SevenMode {
  if (width < COMPACT_W) return "tall";
  return full < SHORT_H ? "short" : "wide";
}
export function sevenHeight(width: number, height: number, full = height): number {
  if (sevenMode(width, full) === "short") return 300;
  return Math.max(WIDE_H, Math.round(height / WIDE_MAX_SCALE));
}
export function sevenCompactSize(width: number, height: number): { w: number; h: number } {
  return { w: 360, h: Math.round(Math.min(820, Math.max(440, (360 * height) / Math.max(1, width)))) };
}
export function sevenFit(width: number, full: number): StageFit & { designH: number; mode: SevenMode } {
  const mode = sevenMode(width, full);
  const height = Math.max(1, full - DOCK_INSET[mode]);
  const size = mode === "tall" ? sevenCompactSize(width, height) : { w: 640, h: sevenHeight(width, height, full) };
  return { ...fitStage(width, height, size.w, size.h), designH: size.h, mode };
}
export function modeOf(compact: boolean, designH: number): SevenMode {
  if (compact) return "tall";
  return designH === 300 ? "short" : "wide";
}

export const SEVEN_LAYOUT_EVENT = "seven-poker-layout";
export interface SevenFrame { mode: SevenMode; designW: number; designH: number; scale: number; x: number; y: number }

export interface Point { x: number; y: number }
export interface Slot { x: number; y: number; r: number; s: number }

export interface SevenSpot {
  /** 7장 칸의 가운데. */
  x: number;
  y: number;
  s: number;
  /** 카드 사이 간격(설계). */
  step: number;
  /** start: 왼쪽 끝부터, end: 오른쪽 끝에 붙여, center: 장수대로 가운데. */
  align: "start" | "end" | "center";
  plate: Point & { side: "below" | "left" | "right" };
  bubble: Point & { side: "above" | "center" };
}

export interface SevenGeometry {
  mode: SevenMode;
  w: number;
  h: number;
  pot: Point;
  potLabel: Point;
  banner: Point;
  timer: Point | null;
  /** 카드가 날아오는 곳(딜러 자리)이자 버린 패가 돌아가는 곳. */
  dealer: Point;
  tag: Point & { side: "right" | "below" | "above" };
  seat: (rel: number) => SevenSpot;
}

const cardW = (s: number) => CARD.w * s;
/** 7장을 다 받았을 때의 폭. */
export const fullWidth = (spot: Pick<SevenSpot, "s" | "step">) => cardW(spot.s) + 6 * spot.step;

/** 이 자리의 index 번째 카드(지금 count 장). */
export function cardSlot(spot: SevenSpot, index: number, count: number, lifted = false): Slot {
  const left = spot.x - fullWidth(spot) / 2 + cardW(spot.s) / 2;
  const right = spot.x + fullWidth(spot) / 2 - cardW(spot.s) / 2;
  const x = spot.align === "start" ? left + index * spot.step
    : spot.align === "end" ? right - (count - 1 - index) * spot.step
      : spot.x + (index - (count - 1) / 2) * spot.step;
  return { x, y: spot.y - (lifted ? UP_LIFT * spot.s : 0), r: 0, s: spot.s };
}

/** 지금 장수의 패 가운데(배지·외침 자리). */
export function handCenter(spot: SevenSpot, count: number): Point {
  if (count <= 0) return { x: spot.x, y: spot.y };
  const first = cardSlot(spot, 0, count);
  const last = cardSlot(spot, count - 1, count);
  return { x: (first.x + last.x) / 2, y: spot.y };
}

const spotOf = (x: number, y: number, s: number, gap: number, align: SevenSpot["align"], plate: SevenSpot["plate"]["side"], bubble: SevenSpot["bubble"]["side"]): SevenSpot => {
  const step = cardW(s) * gap;
  const half = (cardW(s) + 6 * step) / 2;
  const h = CARD.h * s;
  return {
    x, y, s, step, align,
    plate: plate === "below" ? { x, y: y + h / 2 + 3, side: "below" } : plate === "left" ? { x: x - half - 10, y, side: "left" } : { x: x + half + 10, y, side: "right" },
    bubble: bubble === "center" ? { x, y: y - 6, side: "center" } : { x, y: y - h / 2 - 2, side: "above" },
  };
};

export function sevenGeometry(mode: SevenMode, w: number, h: number): SevenGeometry {
  const cx = w / 2;

  if (mode === "short") {
    // 가로 폰: 위에 상대 넷 한 줄(이름표는 카드 아래) · 가운데 팟 · 아래 나(이름표 왼쪽, 족보 오른쪽).
    const opp = 0.5;
    const mine = 0.64;
    const rowY = 72;
    const meY = h - 40;
    const xs = [0.125, 0.375, 0.625, 0.875];
    const me = spotOf(cx, meY, mine, 0.62, "start", "left", "above");
    const spots: SevenSpot[] = [
      { ...me, bubble: { x: me.plate.x - 47, y: meY - 20, side: "above" } },
      ...xs.map((f) => spotOf(w * f, rowY, opp, 0.44, "center", "below", "center")),
    ];
    const potY = Math.round((rowY + CARD.h * opp / 2 + 34 + meY - CARD.h * mine / 2) / 2) - 8;
    const half = fullWidth(me) / 2;
    const roomRight = w - (cx + half + 12) - 8;
    return {
      mode, w, h,
      pot: { x: cx, y: potY },
      potLabel: { x: cx, y: potY + 26 },
      banner: { x: cx, y: potY + 8 },
      timer: null,
      dealer: { x: cx, y: potY - 20 },
      tag: roomRight >= 200 ? { x: cx + half + 12, y: meY + 4, side: "right" } : { x: cx + half - 60, y: meY - (CARD.h * mine) / 2 - UP_LIFT - 4, side: "above" },
      seat: (rel) => spots[rel] ?? spots[0]!,
    };
  }

  if (mode === "tall") {
    // 세로 폰: 위 두 줄에 상대 둘씩(이름표는 카드 아래) · 가운데 팟 · 아래 나(이름표·족보는 카드 아래).
    // 낮은 세로 화면(360×640)은 한 치수 작게 — 그대로 두면 팟 글자가 내 카드에 덮였다.
    const low = h < 540;
    const opp = low ? 0.46 : 0.52;
    const mine = low ? 0.74 : 0.8;
    const row1 = low ? 76 : 86;
    const meY = h - (low ? 126 : 132);
    const myTop = meY - (CARD.h * mine) / 2 - UP_LIFT * mine;
    const oppBlock = (CARD.h * opp) / 2 + 3 + 32;
    // 둘째 줄은 내 카드 위에 팟 자리(약 50)를 남기고 내려온다(첫 줄 이름표와는 붙지 않게).
    const row2 = Math.round(Math.max(row1 + oppBlock + (CARD.h * opp) / 2 + 4, Math.min(row1 + 132, myTop - 50 - oppBlock)));
    const spots: SevenSpot[] = [
      spotOf(cx, meY, mine, 0.48, "center", "below", "above"),
      spotOf(92, row2, opp, 0.42, "center", "below", "center"),
      spotOf(92, row1, opp, 0.42, "center", "below", "center"),
      spotOf(w - 92, row1, opp, 0.42, "center", "below", "center"),
      spotOf(w - 92, row2, opp, 0.42, "center", "below", "center"),
    ];
    const potY = Math.round((row2 + oppBlock + myTop) / 2);
    return {
      mode, w, h,
      pot: { x: cx, y: potY - 12 },
      potLabel: { x: cx, y: potY + 12 },
      banner: { x: cx, y: potY },
      timer: null,
      dealer: { x: cx, y: potY - 30 },
      tag: { x: cx, y: meY + (CARD.h * mine) / 2 + 38, side: "below" },
      seat: (rel) => spots[rel] ?? spots[0]!,
    };
  }

  // 넓은 화면(PC): 양옆에 둘씩(이름표는 바깥쪽, 카드는 이름표 쪽부터), 가운데 팟, 나는 아래 가운데.
  const top = 44;
  const opp = 0.56;
  const mine = 0.84;
  const at = (f: number) => Math.round(top + (h - top) * f);
  const oppHalf = (cardW(opp) + 6 * cardW(opp) * 0.44) / 2;
  const colX = 12 + 124 + 10 + oppHalf;
  const upY = at(0.24);
  const lowY = at(0.56);
  const meY = h - 66;
  const me = spotOf(cx, meY, mine, 0.6, "start", "left", "above");
  const spots: SevenSpot[] = [
    me,
    spotOf(colX, lowY, opp, 0.44, "start", "left", "above"),
    spotOf(colX, upY, opp, 0.44, "start", "left", "above"),
    spotOf(w - colX, upY, opp, 0.44, "end", "right", "above"),
    spotOf(w - colX, lowY, opp, 0.44, "end", "right", "above"),
  ];
  const potY = at(0.38);
  const half = fullWidth(me) / 2;
  const roomRight = w - (cx + half + 12) - 8;
  return {
    mode, w, h,
    pot: { x: cx, y: potY },
    potLabel: { x: cx, y: potY + 30 },
    // 결과 배너는 팟과 내 카드 사이.
    banner: { x: cx, y: Math.round((potY + 40 + meY - (CARD.h * mine) / 2 - UP_LIFT) / 2) },
    timer: { x: cx - 96, y: potY + 6 },
    dealer: { x: cx, y: potY - 30 },
    tag: roomRight >= 220 ? { x: cx + half + 12, y: meY, side: "right" } : { x: cx + half - 60, y: meY - (CARD.h * mine) / 2 - UP_LIFT - 6, side: "above" },
    seat: (rel) => spots[rel] ?? spots[0]!,
  };
}

/** 좌석 번호 → rel(나로부터 시계 방향 몇 번째). 관전 중에는 1번이 아래. */
export function relOf(seatNumber: number, mySeatNumber: number | null, seatCount: number): number {
  const base = mySeatNumber ?? 1;
  return (seatNumber - base + seatCount) % seatCount;
}
