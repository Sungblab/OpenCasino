import { COMPACT_W, fitStage, type StageFit } from "../stage/layout";

/**
 * 바둑이 판의 순수 배치 계산 — 섯다 v6·홀덤 v6 와 같은 틀(캔버스가 이걸로 카드·칩을 놓고, 그 frame 을 DOM 층이
 * 받아 이름표·배지·버튼을 얹는다). 다섯 자리: 나는 아래 가운데, 상대 넷은 양옆과 위 둘. 가운데는 팟과 그 양옆의
 * 덱(새 카드가 나오는 곳)·버림 더미(교체한 카드가 가는 곳). 자리마다 4장을 부채꼴로 겹쳐 놓는다.
 */

export type BadugiMode = "wide" | "short" | "tall";

/** 트럼프 한 장(설계, 배율 1) — stage/core 의 CW×CH 와 같다. */
export const CARD = { w: 76, h: 106 } as const;
const SHORT_H = 500;
/** 판 안 아래 독 높이(독 + 여백 + 틈). table-badugi.css 의 .bd-dock-slot 과 짝. */
export const DOCK_INSET: Record<BadugiMode, number> = { wide: 54 + 10 + 8, short: 50 + 6 + 6, tall: 98 + 6 + 12 };
const WIDE_H = 460;
const WIDE_MAX_SCALE = 1.35;

export function badugiMode(width: number, full: number): BadugiMode {
  if (width < COMPACT_W) return "tall";
  return full < SHORT_H ? "short" : "wide";
}
export function badugiHeight(width: number, height: number, full = height): number {
  if (badugiMode(width, full) === "short") return 300;
  return Math.max(WIDE_H, Math.round(height / WIDE_MAX_SCALE));
}
export function badugiCompactSize(width: number, height: number): { w: number; h: number } {
  return { w: 360, h: Math.round(Math.min(820, Math.max(440, (360 * height) / Math.max(1, width)))) };
}
export function badugiFit(width: number, full: number): StageFit & { designH: number; mode: BadugiMode } {
  const mode = badugiMode(width, full);
  const height = Math.max(1, full - DOCK_INSET[mode]);
  const size = mode === "tall" ? badugiCompactSize(width, height) : { w: 640, h: badugiHeight(width, height, full) };
  return { ...fitStage(width, height, size.w, size.h), designH: size.h, mode };
}
export function modeOf(compact: boolean, designH: number): BadugiMode {
  if (compact) return "tall";
  return designH === 300 ? "short" : "wide";
}

export const BADUGI_LAYOUT_EVENT = "badugi-layout";
export interface BadugiFrame { mode: BadugiMode; designW: number; designH: number; scale: number; x: number; y: number }

export interface Point { x: number; y: number }
export interface Slot { x: number; y: number; r: number; s: number }

export interface BadugiSpot {
  /** 네 장 가운데. */
  x: number;
  y: number;
  s: number;
  /** 카드끼리 겹치는 간격(카드 폭 비율). 상대 뒷면은 촘촘히, 내 패는 넉넉히. */
  fan: number;
  plate: Point & { side: "below" | "left" | "right" };
  bubble: Point & { side: "above" | "right" | "left" | "center" };
  /** 교체 장수 배지 — 카드 뭉치 오른쪽 위 모서리 안쪽(corner: 판 위 머리줄에 닿지 않게 카드 위에 얹는다), 가로 폰 위 줄은 오른쪽 옆(right). */
  draw: Point & { side: "corner" | "right" };
}

export interface BadugiGeometry {
  mode: BadugiMode;
  w: number;
  h: number;
  top: number;
  pot: Point;
  potLabel: Point;
  /** 새 카드가 나오는 덱(엎은 더미). 딜·교체 카드가 여기서 날아온다. */
  deck: Point;
  /** 교체한 카드가 엎어져 쌓이는 곳. */
  muck: Point;
  banner: Point;
  timer: Point | null;
  tag: Point & { side: "right" | "below" };
  seat: (rel: number) => BadugiSpot;
}

export const fanWidth = (spot: Pick<BadugiSpot, "s" | "fan">) => CARD.w * spot.s * (1 + 3 * spot.fan);

export function cardSlot(spot: BadugiSpot, index: number): Slot {
  const step = CARD.w * spot.s * spot.fan;
  return { x: spot.x + (index - 1.5) * step, y: spot.y, r: (index - 1.5) * 0.05, s: spot.s };
}

function spotAt(x: number, y: number, s: number, fan: number, plate: BadugiSpot["plate"]["side"], bubble?: BadugiSpot["bubble"], drawSide: "corner" | "right" = "corner"): BadugiSpot {
  const half = fanWidth({ s, fan }) / 2;
  const cardH = CARD.h * s;
  return {
    x, y, s, fan,
    plate: plate === "below" ? { x, y: y + cardH / 2 + 3, side: "below" } : plate === "left" ? { x: x - half - 10, y, side: "left" } : { x: x + half + 10, y, side: "right" },
    bubble: bubble ?? { x, y: y - cardH / 2 - 2, side: "above" },
    draw: drawSide === "corner" ? { x: x + half - 14, y: y - cardH / 2 + 9, side: "corner" } : { x: x + half + 3, y, side: "right" },
  };
}

export function badugiGeometry(mode: BadugiMode, w: number, h: number): BadugiGeometry {
  const cx = w / 2;

  if (mode === "short") {
    // 가로 폰: 위 상대 한 줄(넷) · 가운데 팟 · 아래 나. 독은 이 아래.
    const top = 40;
    const opp = 0.42;
    const oppFan = 0.42;
    const mine = 0.66;
    const rowY = top + 24;
    const meY = h - 40;
    const potY = 160;
    const myHalf = fanWidth({ s: mine, fan: 0.62 }) / 2;
    const me = spotAt(cx, meY, mine, 0.62, "left");
    const spots: BadugiSpot[] = [
      // 내 말풍선은 이름표 위 — 카드 바로 위는 팟이다.
      { ...me, bubble: { x: me.plate.x - 47, y: meY - 18, side: "above" } },
      // 말풍선은 그 자리 카드 뒷면 위 가운데 — 옆으로 내면 붙은 줄에서 옆자리 카드를 덮는다(홀덤 가로 폰과 같다).
      ...[0.13, 0.37, 0.63, 0.87].map((f) => spotAt(w * f, rowY, opp, oppFan, "below", { x: w * f, y: rowY - 9, side: "center" }, "right")),
    ];
    return {
      mode, w, h, top,
      pot: { x: cx, y: potY - 6 },
      potLabel: { x: cx, y: potY + 22 },
      deck: { x: cx - 92, y: potY },
      muck: { x: cx + 92, y: potY },
      banner: { x: cx, y: potY },
      timer: null,
      tag: { x: cx + myHalf + 12, y: meY + 6, side: "right" },
      seat: (rel) => spots[rel] ?? spots[0]!,
    };
  }

  if (mode === "tall") {
    // 세로 폰: 위 둘 · 양옆 둘 · 가운데 팟 · 아래 나(이름표는 카드 아래, 족보 칸은 그 아래). 족보 칸을 카드 위에 두면
    // 폭이 넓어 양옆 자리 이름표에 걸렸다.
    // 키 큰 폰(설계 높이 560 이상)은 카드를 한 치수 크게 — 작게 두면 팟과 내 패 사이가 휑하게 빈다.
    const roomy = h >= 560;
    const top = 42;
    const opp = roomy ? 0.56 : 0.5;
    const oppFan = 0.42;
    const mine = roomy ? 0.92 : 0.8;
    const rowY = top + (roomy ? 46 : 40);
    const sideY = rowY + (roomy ? 124 : 108);
    // 아래는 카드 · 이름표(36) · 한 줄 족보 칸(약 30)이 독 위에 들어가야 한다.
    const meY = Math.max(sideY + (roomy ? 150 : 134), h - (CARD.h * mine) / 2 - 3 - 36 - 4 - 34);
    const cardTop = meY - (CARD.h * mine) / 2;
    const potY = Math.round((rowY + (CARD.h * opp) / 2 + 36 + cardTop) / 2);
    // 말풍선은 전부 그 자리 카드 위 가운데 — 폭 360 에선 옆으로 낼 자리가 없다(옆으로 내면 화면 밖이나 팟에 걸린다).
    // 내 것도 카드 위: 카드 위쪽은 족보 칸, 아래는 이름표라서. 3초뿐이고 내가 방금 한 행동이다.
    const center = (x: number, y: number) => ({ x, y: y - 9, side: "center" as const });
    const spots: BadugiSpot[] = [
      spotAt(cx, meY, mine, 0.62, "below", center(cx, meY)),
      spotAt(50, sideY, opp, oppFan, "below", center(50, sideY)),
      spotAt(cx - 78, rowY, opp, oppFan, "below", center(cx - 78, rowY)),
      spotAt(cx + 78, rowY, opp, oppFan, "below", center(cx + 78, rowY)),
      spotAt(w - 50, sideY, opp, oppFan, "below", center(w - 50, sideY)),
    ];
    return {
      mode, w, h, top,
      pot: { x: cx, y: potY - 6 },
      potLabel: { x: cx, y: potY + 20 },
      deck: { x: cx - 64, y: potY },
      muck: { x: cx + 64, y: potY },
      banner: { x: cx, y: potY },
      timer: null,
      tag: { x: cx, y: meY + (CARD.h * mine) / 2 + 3 + 36 + 4, side: "below" },
      seat: (rel) => spots[rel] ?? spots[0]!,
    };
  }

  // 넓은 화면(PC): 양옆 하나씩 + 위 둘, 가운데 팟과 덱·버림 더미, 나는 아래 가운데.
  const top = 44;
  const opp = 0.56;
  const oppFan = 0.46;
  const mine = 0.86;
  const oppHalf = fanWidth({ s: opp, fan: oppFan }) / 2;
  const myHalf = fanWidth({ s: mine, fan: 0.62 }) / 2;
  const colX = 12 + 124 + 10 + oppHalf;
  const meY = h - 64;
  const at = (f: number) => Math.round(top + (h - top) * f);
  const lowY = at(0.5);
  const topY = top + 48;
  const topDX = Math.min(180, w * 0.22);
  const potY = Math.round((topY + (CARD.h * opp) / 2 + 48 + meY - (CARD.h * mine) / 2) / 2);
  const spots: BadugiSpot[] = [
    spotAt(cx, meY, mine, 0.62, "left"),
    spotAt(colX, lowY, opp, oppFan, "left"),
    // 위 두 자리의 말풍선은 바깥쪽 옆으로 — 위로 내면 머리줄(도구)에 걸리고, 안쪽으로 내면 둘이 가운데서 부딪힌다.
    spotAt(cx - topDX, topY, opp, oppFan, "below", { x: cx - topDX - oppHalf - 2, y: topY, side: "left" }),
    spotAt(cx + topDX, topY, opp, oppFan, "below", { x: cx + topDX + oppHalf + 2, y: topY, side: "right" }),
    spotAt(w - colX, lowY, opp, oppFan, "right"),
  ];
  // 판이 좁으면(설계 폭 640 — 세로로 세운 태블릿) 양옆 자리와 팟 사이에 덱이 들어갈 틈이 없다 — 덱·버림 더미를 팟 위로.
  const roomy = cx - (colX + oppHalf) >= 120;
  return {
    mode, w, h, top,
    pot: { x: cx, y: potY - 8 },
    potLabel: { x: cx, y: potY + 24 },
    deck: roomy ? { x: cx - 100, y: potY } : { x: cx - 44, y: potY - 58 },
    muck: roomy ? { x: cx + 100, y: potY } : { x: cx + 44, y: potY - 58 },
    banner: { x: cx, y: potY },
    timer: roomy ? { x: cx - 190, y: potY } : null,
    tag: { x: cx + myHalf + 12, y: meY, side: "right" },
    seat: (rel) => spots[rel] ?? spots[0]!,
  };
}

/** 좌석 번호 → rel(나로부터 시계 방향 몇 번째). 관전 중에는 1번이 아래. */
export function relOf(seatNumber: number, mySeatNumber: number | null, seatCount: number): number {
  const base = mySeatNumber ?? 1;
  return (seatNumber - base + seatCount) % seatCount;
}
