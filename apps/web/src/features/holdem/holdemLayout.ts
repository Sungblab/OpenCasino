import { COMPACT_W, fitStage, type StageFit } from "../stage/layout";

/**
 * 홀덤 판의 순수 배치 계산 — 섯다 v6·맞고 v2 와 같은 틀(캔버스가 이걸로 카드·칩을 놓고, 그 frame 을 DOM
 * 층이 받아 이름표·버튼을 얹는다). 자리는 섯다 A안과 같다: 나는 아래 가운데, 상대는 양옆 가장자리에 둘씩 +
 * 맨 위 가운데 하나. 가운데 보드 다섯 장과 그 위 팟, 자리마다 이번 스트리트 베팅 칩은 판 안쪽으로.
 */

export type HoldemMode = "wide" | "short" | "tall";

/** 트럼프 한 장(설계, 배율 1) — stage/core 의 CW×CH 와 같다. */
export const CARD = { w: 76, h: 106 } as const;
const FAN = 0.62;
const SHORT_H = 500;
/** 판 안 아래 독 높이(독 + 여백 + 틈). table-holdem-v6.css 의 .hv6-dock-slot 과 짝. */
export const DOCK_INSET: Record<HoldemMode, number> = { wide: 54 + 10 + 8, short: 50 + 6 + 6, tall: 80 + 6 + 12 };
const WIDE_H = 460;
const WIDE_MAX_SCALE = 1.35;

export function holdemMode(width: number, full: number): HoldemMode {
  if (width < COMPACT_W) return "tall";
  return full < SHORT_H ? "short" : "wide";
}
export function holdemHeight(width: number, height: number, full = height): number {
  if (holdemMode(width, full) === "short") return 300;
  return Math.max(WIDE_H, Math.round(height / WIDE_MAX_SCALE));
}
export function holdemCompactSize(width: number, height: number): { w: number; h: number } {
  return { w: 360, h: Math.round(Math.min(820, Math.max(420, (360 * height) / Math.max(1, width)))) };
}
export function holdemFit(width: number, full: number): StageFit & { designH: number; mode: HoldemMode } {
  const mode = holdemMode(width, full);
  const height = Math.max(1, full - DOCK_INSET[mode]);
  const size = mode === "tall" ? holdemCompactSize(width, height) : { w: 640, h: holdemHeight(width, height, full) };
  return { ...fitStage(width, height, size.w, size.h), designH: size.h, mode };
}
export function modeOf(compact: boolean, designH: number): HoldemMode {
  if (compact) return "tall";
  return designH === 300 ? "short" : "wide";
}

export const HOLDEM_LAYOUT_EVENT = "holdem-layout";
export interface HoldemFrame { mode: HoldemMode; designW: number; designH: number; scale: number; x: number; y: number }

export interface Point { x: number; y: number }
export interface Slot { x: number; y: number; r: number; s: number }

export interface HoldemSpot {
  /** 두 장 가운데. */
  x: number;
  y: number;
  s: number;
  plate: Point & { side: "below" | "left" | "right" };
  bubble: Point & { side: "above" | "right" | "left" | "center" };
  /** 이번 스트리트 베팅 칩(판 안쪽). */
  bet: Point;
}

export interface HoldemGeometry {
  mode: HoldemMode;
  w: number;
  h: number;
  top: number;
  board: (index: number) => Slot;
  /** 번 카드 더미 — 스트리트마다 버린 한 장(0 플랍 · 1 턴 · 2 리버)을 엎어 쌓는 자리. */
  burn: (index: number) => Slot;
  pot: Point;
  /** 팟 금액 알약. */
  potLabel: Point;
  banner: Point;
  timer: Point | null;
  /** 카드가 날아오는 곳(딜러 자리). */
  dealer: Point;
  tag: Point & { side: "right" | "below" };
  seat: (rel: number) => HoldemSpot;
}

export const fanWidth = (s: number) => CARD.w * s * (1 + FAN);
/** 번 카드는 가지런히 놓지 않고 조금씩 어긋나게 겹친다(손으로 던져 둔 더미처럼). */
const BURN_TILT = [0.16, -0.06, 0.1];
const burnPile = (x: number, y: number, s: number) => (index: number): Slot => ({ x: x + index * 2, y: y - index * 2, r: BURN_TILT[index % BURN_TILT.length]!, s });
export function holeSlot(spot: HoldemSpot, index: number): Slot {
  const step = CARD.w * spot.s * FAN;
  return { x: spot.x + (index - 0.5) * step, y: spot.y, r: (index - 0.5) * 0.07, s: spot.s };
}

const below = (x: number, y: number, s: number, bet: Point): HoldemSpot => ({
  x, y, s, bet,
  plate: { x, y: y + (CARD.h * s) / 2 + 3, side: "below" },
  bubble: { x, y: y - (CARD.h * s) / 2 - 2, side: "above" },
});
/** 이름표를 카드 왼쪽에(오른쪽 끝을 여기에). */
const plateLeft = (x: number, y: number, s: number, bet: Point): HoldemSpot => ({
  x, y, s, bet,
  plate: { x: x - fanWidth(s) / 2 - 10, y, side: "left" },
  bubble: { x, y: y - (CARD.h * s) / 2 - 2, side: "above" },
});
/** 이름표를 카드 오른쪽에(왼쪽 끝을 여기에). */
const plateRight = (x: number, y: number, s: number, bet: Point): HoldemSpot => ({
  x, y, s, bet,
  plate: { x: x + fanWidth(s) / 2 + 10, y, side: "right" },
  bubble: { x, y: y - (CARD.h * s) / 2 - 2, side: "above" },
});
const bubbleSide = (spot: HoldemSpot, w: number): HoldemSpot => {
  const half = fanWidth(spot.s) / 2 + 2;
  return spot.x > w * 0.6
    ? { ...spot, bubble: { x: spot.x - half, y: spot.y, side: "left" } }
    : { ...spot, bubble: { x: spot.x + half, y: spot.y, side: "right" } };
};

export function holdemGeometry(mode: HoldemMode, w: number, h: number): HoldemGeometry {
  const cx = w / 2;

  if (mode === "short") {
    // 가로 폰: 위 상대 한 줄 · 가운데 보드(팟은 보드 왼쪽) · 아래 나. 독은 이 아래.
    const top = 40;
    const opp = 0.44;
    const mine = 0.7;
    const boardS = 0.54;
    const rowY = top + 26;
    const meY = h - 40;
    const boardY = 170;
    const pitch = CARD.w * boardS + 5;
    const xs = [0.1, 0.3, 0.5, 0.7, 0.9];
    const me = plateLeft(cx, meY, mine, { x: cx + fanWidth(mine) / 2 + 40, y: meY - 44 });
    const spots: HoldemSpot[] = [
      // 내 말풍선은 이름표 위 — 카드 바로 위는 보드다.
      { ...me, bubble: { x: me.plate.x - 47, y: meY - 18, side: "above" } },
      // 베팅 칩은 카드 옆 — 이름표 아래에 두면 이름표 모서리와 보드 윗변에 걸렸다. 말풍선은 그 자리 카드 뒷면 위
      // 가운데: 옆으로 내면 다섯 자리가 붙은 이 줄에선 옆자리 칩·카드·말풍선을 덮었다(뒷면은 가려도 잃는 게 없다).
      ...xs.map((f) => {
        const spot = below(w * f, rowY, opp, { x: w * f + (f > 0.6 ? 1 : -1) * (fanWidth(opp) / 2 + 28), y: rowY + 6 });
        // 조금 위로 — 카드 아랫단엔 폴드 배지가 걸린다(접는 순간 말풍선과 같이 뜬다).
        return { ...spot, bubble: { x: spot.x, y: spot.y - 9, side: "center" as const } };
      }),
    ];
    return {
      mode, w, h, top,
      board: (index) => ({ x: cx + (index - 2) * pitch, y: boardY, r: 0, s: boardS }),
      // 보드 오른쪽 — 왼쪽은 팟이다.
      burn: burnPile(cx + 2.5 * pitch + 36, boardY, 0.38),
      pot: { x: cx - 2.5 * pitch - 60, y: boardY - 8 },
      potLabel: { x: cx - 2.5 * pitch - 60, y: boardY + 20 },
      banner: { x: cx, y: boardY },
      timer: null,
      dealer: { x: cx, y: boardY - 60 },
      tag: { x: cx + fanWidth(mine) / 2 + 12, y: meY + 8, side: "right" },
      seat: (rel) => spots[rel] ?? spots[0]!,
    };
  }

  if (mode === "tall") {
    // 좁은 창(세로): 위쪽 셋, 양옆 둘, 가운데 보드와 팟, 아래 나.
    const top = 42;
    const opp = 0.5;
    const mine = 0.9;
    const boardS = 0.44;
    const rowY = top + 36;
    const sideY = rowY + 116;
    const meY = Math.max(sideY + 120, h - 140);
    const boardY = Math.round((sideY + meY) / 2) - 6;
    const pitch = CARD.w * boardS + 4;
    const spots: HoldemSpot[] = [
      plateLeft(cx + 14, meY, mine, { x: cx + 14, y: meY - 72 }),
      below(54, sideY, opp, { x: 54 + 42, y: sideY + 64 }),
      bubbleSide(below(62, rowY, opp, { x: 62 + 42, y: rowY + 70 }), w),
      bubbleSide(below(cx, rowY, opp, { x: cx + 44, y: rowY + 64 }), w),
      bubbleSide(below(w - 62, rowY, opp, { x: w - 62 - 42, y: rowY + 70 }), w),
      below(w - 54, sideY, opp, { x: w - 54 - 42, y: sideY + 64 }),
    ];
    return {
      mode, w, h, top,
      board: (index) => ({ x: cx + (index - 2) * pitch, y: boardY, r: 0, s: boardS }),
      // 딜러(팟) 오른쪽, 팟 알약보다 위 — 보드 오른쪽은 판이 낮으면 오른쪽 옆자리 이름표에 걸린다.
      burn: burnPile(cx + 78, boardY - 64, 0.32),
      pot: { x: cx, y: boardY - 52 },
      potLabel: { x: cx, y: boardY - 34 },
      banner: { x: cx, y: boardY },
      timer: null,
      dealer: { x: cx, y: boardY - 50 },
      tag: { x: cx, y: meY + (CARD.h * mine) / 2 + 8, side: "below" },
      seat: (rel) => spots[rel] ?? spots[0]!,
    };
  }

  // 넓은 화면(PC): 섯다 A안 — 양옆 둘씩 + 위 가운데, 가운데 팟 · 보드, 나는 아래 가운데.
  const top = 44;
  const opp = 0.56;
  const mine = 0.82;
  const boardS = 0.74;
  const half = fanWidth(opp) / 2;
  const colX = 12 + 118 + 10 + half;
  const meY = h - 64;
  const at = (f: number) => Math.round(top + (h - top) * f);
  const upY = at(0.25);
  const lowY = at(0.56);
  const topY = top + 44;
  const boardY = at(0.43);
  const pitch = CARD.w * boardS + 6;
  const spots: HoldemSpot[] = [
    plateLeft(cx, meY, mine, { x: cx, y: meY - (CARD.h * mine) / 2 - 26 }),
    plateLeft(colX, lowY, opp, { x: colX + half + 46, y: lowY }),
    plateLeft(colX, upY, opp, { x: colX + half + 46, y: upY }),
    // 위 가운데 자리: 말풍선이 카드 오른쪽이라 칩은 그 아래로(팟과는 떨어지게).
    bubbleSide(plateLeft(cx + 40, topY, opp, { x: cx + 40 + half + 30, y: topY + 40 }), w),
    plateRight(w - colX, upY, opp, { x: w - colX - half - 46, y: upY }),
    plateRight(w - colX, lowY, opp, { x: w - colX - half - 46, y: lowY }),
  ];
  return {
    mode, w, h, top,
    board: (index) => ({ x: cx + (index - 2) * pitch, y: boardY, r: 0, s: boardS }),
    // 보드 오른쪽, 왼쪽 시계와 마주 보게. 조금 올려 아래 오른쪽 자리 카드 윗단에 닿지 않게.
    burn: burnPile(cx + 2.5 * pitch + 48, boardY - 6, 0.46),
    pot: { x: cx, y: boardY - (CARD.h * boardS) / 2 - 38 },
    potLabel: { x: cx, y: boardY - (CARD.h * boardS) / 2 - 14 },
    // 결과 배너는 보드와 내 카드 사이 — 보드 위에 띄우면 쇼다운에 이긴 보드를 가렸다.
    banner: { x: cx, y: Math.round((boardY + (CARD.h * boardS) / 2 + meY - (CARD.h * mine) / 2) / 2) },
    timer: { x: cx - 2.5 * pitch - 44, y: boardY },
    dealer: { x: cx, y: boardY - (CARD.h * boardS) / 2 - 38 },
    tag: { x: cx + fanWidth(mine) / 2 + 12, y: meY, side: "right" },
    seat: (rel) => spots[rel] ?? spots[0]!,
  };
}

/** 좌석 번호 → rel(나로부터 시계 방향 몇 번째). 관전 중에는 1번이 아래. */
export function relOf(seatNumber: number, mySeatNumber: number | null, seatCount: number): number {
  const base = mySeatNumber ?? 1;
  return (seatNumber - base + seatCount) % seatCount;
}
