import { COMPACT_W, fitStage, type StageFit } from "../stage/layout";

/**
 * 맞고(고스톱) 판의 순수 배치 계산 — 섯다 v6 와 같은 구조: 캔버스(gostopStageController)가 이걸로 화투를
 * 놓고, 그 결과(배율·원점·설계)를 이벤트로 DOM 층(OverlayStage)에 넘긴다. DOM 은 WebGL 이 없을 때만 직접 계산한다.
 *
 * 한게임 신맞고 배치를 따른다: 상대는 위(먹은 패 · 남은 손패 · 프로필), 가운데 바닥과 더미, 나는 아래(먹은 패
 * 한 줄 위에 손패). 바닥은 월마다 자리가 정해져 있다 — 패가 오고 가도 다른 월의 패가 자리를 옮기지 않는다.
 * 설계는 섯다와 같은 세 가지: 넓은 화면(PC), 낮은 가로 폰(바닥 한 줄), 폭이 좁은 창(세로).
 */

export type GostopMode = "wide" | "short" | "tall";

/** 화투 한 장(설계, 배율 1). 섯다와 같은 크기. */
export const HWATU = { w: 50, h: 82 } as const;

/** 판 전체 높이(독 포함)가 이보다 낮으면 가로 폰 배치 — 섯다와 같은 기준(배치 ↔ 독 높이가 물고 돌지 않게). */
const SHORT_H = 500;
/** 판 안 아래 독이 차지하는 높이(독 + 아래 여백 + 틈). table-gostop-v2.css 의 .gv2-dock-slot 높이와 짝. */
export const DOCK_INSET: Record<GostopMode, number> = { wide: 54 + 10 + 8, short: 50 + 6 + 6, tall: 80 + 6 + 12 };
const WIDE_H = 480;
const WIDE_MAX_SCALE = 1.35;

export function gostopMode(width: number, full: number): GostopMode {
  if (width < COMPACT_W) return "tall";
  return full < SHORT_H ? "short" : "wide";
}

export function gostopHeight(width: number, height: number, full = height): number {
  if (gostopMode(width, full) === "short") return 300;
  return Math.max(WIDE_H, Math.round(height / WIDE_MAX_SCALE));
}

export function gostopCompactSize(width: number, height: number): { w: number; h: number } {
  return { w: 360, h: Math.round(Math.min(820, Math.max(440, (360 * height) / Math.max(1, width)))) };
}

export function gostopFit(width: number, full: number): StageFit & { designH: number; mode: GostopMode } {
  const mode = gostopMode(width, full);
  const height = Math.max(1, full - DOCK_INSET[mode]);
  const size = mode === "tall" ? gostopCompactSize(width, height) : { w: 640, h: gostopHeight(width, height, full) };
  return { ...fitStage(width, height, size.w, size.h), designH: size.h, mode };
}

export function modeOf(compact: boolean, designH: number): GostopMode {
  if (compact) return "tall";
  return designH === 300 ? "short" : "wide";
}

export const GOSTOP_LAYOUT_EVENT = "gostop-layout";
export interface GostopFrame {
  mode: GostopMode;
  designW: number;
  designH: number;
  players: number;
  scale: number;
  x: number;
  y: number;
}

export interface Point { x: number; y: number }
export interface Slot { x: number; y: number; r: number; s: number }
export type CapturedKind = "gwang" | "yeol" | "tti" | "pi";
export const CAPTURED_KINDS: CapturedKind[] = ["gwang", "yeol", "tti", "pi"];

/** 한 자리: 이름표, 먹은 패 줄(시작점·방향·최대 폭), 손패(나: 앞면 줄 / 상대: 뒷면 묶음), 점수 알약, 말풍선. */
export interface GostopSpot {
  plate: Point & { side: "left" | "right" };
  /** below: 종류별 장수를 패 아래에(위쪽 상대 — 위는 머리줄이 붙어 있다). */
  captured: { x: number; y: number; dir: 1 | -1; maxW: number; s: number; below?: boolean };
  hand: { x0: number; x1: number; y: number; s: number };
  bubble: Point & { side: "above" | "below" };
}

export interface GostopGeometry {
  mode: GostopMode;
  w: number;
  h: number;
  top: number;
  stock: Point & { s: number };
  board: { s: number; slot: (month: number, index: number) => Slot; center: (month: number) => Point };
  banner: Point;
  timer: Point | null;
  seat: (rel: number) => GostopSpot;
}

/** 먹은 패 한 줄: 광 · 열끗 · 띠 · 피 순서로, 같은 종류는 겹쳐 놓는다. 폭이 모자라면 겹침을 늘린다. */
/**
 * 3인 위 줄은 두 상대의 먹은 패 줄이 가운데로 자란다 — 줄 끝의 점수 알약 자리(약 40 + 틈)를 남겨 두지 않으면
 * 두 줄이 다 찼을 때 알약이 가운데를 넘어가 서로 겹쳤다.
 */
const PILL_ROOM = 56;

export function capturedSlots(spot: GostopSpot, counts: Record<CapturedKind, number>): { slot: (kind: CapturedKind, index: number) => Slot; end: number; label: (kind: CapturedKind) => Point } {
  const { x, y, dir, maxW, s } = spot.captured;
  const cw = HWATU.w * s;
  const gap = 8 * s;
  const groups = CAPTURED_KINDS.filter((kind) => counts[kind] > 0);
  const extra = groups.reduce((sum, kind) => sum + counts[kind] - 1, 0);
  const fixed = groups.length * cw + Math.max(0, groups.length - 1) * gap;
  const step = extra > 0 ? Math.max(cw * 0.12, Math.min(cw * 0.42, (maxW - fixed) / extra)) : 0;
  const starts = new Map<CapturedKind, number>();
  let cursor = 0;
  for (const kind of groups) {
    starts.set(kind, cursor);
    cursor += cw + (counts[kind] - 1) * step + gap;
  }
  const width = Math.max(0, cursor - gap);
  const at = (offset: number) => (dir === 1 ? x + offset : x - offset);
  return {
    slot: (kind, index) => {
      const start = starts.get(kind) ?? 0;
      return { x: at(start + cw / 2 + index * step), y, r: 0, s };
    },
    end: at(width),
    label: (kind) => ({ x: at((starts.get(kind) ?? 0) + cw / 2), y: spot.captured.below ? y + (HWATU.h * s) / 2 : y - (HWATU.h * s) / 2 }),
  };
}

/** 손패 한 줄: 영역 안에서 가운데 맞춤, 칸이 모자라면 겹친다. */
export function handSlot(spot: GostopSpot, index: number, count: number): Slot {
  const { x0, x1, y, s } = spot.hand;
  const cw = HWATU.w * s;
  const pitch = count > 1 ? Math.min(cw + 4 * s, (x1 - x0 - cw) / (count - 1)) : 0;
  const width = cw + pitch * Math.max(0, count - 1);
  const left = (x0 + x1) / 2 - width / 2;
  return { x: left + cw / 2 + index * pitch, y, r: 0, s };
}

/** 상대 손패(뒷면) 묶음: 이름표 옆에 촘촘히. */
export function backSlot(spot: GostopSpot, index: number, count: number): Slot {
  const { x0, x1, y, s } = spot.hand;
  const step = Math.min(HWATU.w * s * 0.34, (x1 - x0 - HWATU.w * s) / Math.max(1, count - 1));
  const width = HWATU.w * s + step * Math.max(0, count - 1);
  const left = (x0 + x1) / 2 - width / 2;
  return { x: left + (HWATU.w * s) / 2 + index * step, y, r: (index - (count - 1) / 2) * 0.03, s };
}

/**
 * @param players 2(맞고) 또는 3(고스톱). rel 은 나로부터 몇 번째 자리인지 — 0 이 나(아래), 1·2 가 상대.
 */
export function gostopGeometry(mode: GostopMode, w: number, h: number, players: number): GostopGeometry {
  const cx = w / 2;
  const opponents = Math.max(1, players - 1);

  if (mode === "short") {
    // 가로 폰: 위 상대 줄 · 바닥 한 줄(가운데 더미) · 내 먹은 패 · 손패. 독은 이 아래.
    const top = 34;
    const capS = 0.44;
    const boardS = 0.6;
    const handS = 0.8;
    const oppY = top + 32;
    // 상대 이름표(와 옆 손패 뒷면)만 조금 내린다 — 이름표 위에 뜨는 배지(WIN·자동 진행)가 윗줄 버튼(⋯·채팅)을 덮었다.
    const plateY = oppY + 11;
    const boardY = 128;
    const myCapY = 190;
    const handY = 254;
    const pitch = 42;
    const gap = 36;
    const boardX = (month: number) => {
      const side = month <= 6 ? -1 : 1;
      const k = month <= 6 ? 6 - month : month - 7;
      return cx + side * (gap + k * pitch);
    };
    const mine: GostopSpot = {
      plate: { x: 8, y: handY, side: "right" },
      captured: { x: 104, y: myCapY, dir: 1, maxW: w - 104 - 96, s: capS },
      hand: { x0: 104, x1: w - 8, y: handY, s: handS },
      bubble: { x: 54, y: handY - 28, side: "above" },
    };
    const opp = (k: number): GostopSpot => {
      if (opponents === 1) {
        return {
          plate: { x: w - 8, y: plateY, side: "left" },
          captured: { x: 8, y: oppY, dir: 1, maxW: w - 8 - 230, s: capS, below: true },
          hand: { x0: w - 8 - 96 - 118, x1: w - 8 - 96 - 8, y: plateY, s: 0.34 },
          bubble: { x: w - 60, y: plateY + 26, side: "below" },
        };
      }
      // 3인: 왼쪽 상대는 이름표를 왼쪽 끝에, 오른쪽 상대는 오른쪽 끝에 두고 먹은 패는 가운데 쪽으로.
      const left = k === 0;
      const half = w / 2;
      return left
        ? { plate: { x: 8, y: plateY, side: "right" }, captured: { x: 8 + 96 + 52, y: oppY, dir: 1, maxW: half - 8 - 96 - 60 - PILL_ROOM, s: capS * 0.9, below: true }, hand: { x0: 8 + 96 + 2, x1: 8 + 96 + 50, y: plateY, s: 0.3 }, bubble: { x: 56, y: plateY + 26, side: "below" } }
        : { plate: { x: w - 8, y: plateY, side: "left" }, captured: { x: w - 8 - 96 - 52, y: oppY, dir: -1, maxW: half - 8 - 96 - 60 - PILL_ROOM, s: capS * 0.9, below: true }, hand: { x0: w - 8 - 96 - 50, x1: w - 8 - 96 - 2, y: plateY, s: 0.3 }, bubble: { x: w - 56, y: plateY + 26, side: "below" } };
    };
    // 3인: 내 다음 차례(rel 1)가 오른쪽 위, 그다음(rel 2)이 왼쪽 위 — 화투는 오른쪽으로 돈다.
    const spots = [mine, ...(opponents === 1 ? [opp(0)] : [opp(1), opp(0)])];
    return {
      mode, w, h, top,
      stock: { x: cx, y: boardY, s: 0.5 },
      board: {
        s: boardS,
        slot: (month, index) => ({ x: boardX(month) + index * 4, y: boardY - 4 + index * 6, r: 0, s: boardS }),
        center: (month) => ({ x: boardX(month), y: boardY }),
      },
      banner: { x: cx, y: boardY },
      timer: null,
      seat: (rel) => spots[rel] ?? mine,
    };
  }

  if (mode === "tall") {
    // 좁은 창(세로): 상대 · 바닥 세 줄(가운데 위 더미) · 내 먹은 패 · 손패.
    const top = 44;
    const capS = 0.4;
    const boardS = 0.56;
    const oppY = top + 40;
    // 3인은 상대 둘을 한 줄에 두면 한쪽 먹은 패 줄이 다른 쪽 이름표 위로 지나갔다(이 줄은 상대 한 명 기준) —
    // 두 줄로 쌓는다. 바닥 줄 간격은 내 먹은 패 줄 위까지 남는 높이에 맞춘다(작은 폰에서 부딪히지 않게).
    const oppStep = opponents === 2 ? 58 : 0;
    const handY = h - 54;
    const myCapY = handY - 64;
    // 짧은 폰(360×640 등)에선 더미 위아래 틈부터 줄인다.
    const tight = Math.max(0, Math.min(1, (oppY + oppStep + 64 + 58 + 120 - (myCapY - 44)) / 60));
    const stockY = oppY + oppStep + 64 - 12 * tight;
    const boardTop = stockY + 58 - 8 * tight;
    const pitch = Math.max(48, Math.min(60, (myCapY - 44 - boardTop) / 2));
    const rowY = (row: number) => boardTop + row * pitch;
    const colX = (col: number) => cx + (col - 1.5) * 76;
    const mine: GostopSpot = {
      plate: { x: 8, y: myCapY, side: "right" },
      captured: { x: 104, y: myCapY, dir: 1, maxW: w - 112 - PILL_ROOM, s: capS },
      hand: { x0: 8, x1: w - 8, y: handY, s: 0.7 },
      bubble: { x: 54, y: myCapY - 26, side: "above" },
    };
    const opp = (k: number): GostopSpot => {
      const y = k === 0 ? oppY + oppStep : oppY;
      return {
        plate: { x: k === 0 ? w - 8 : 8, y, side: k === 0 ? "left" : "right" },
        captured: { x: k === 0 ? 8 : w - 8, y, dir: k === 0 ? 1 : -1, maxW: w - 190 - PILL_ROOM, s: capS * 0.9, below: true },
        hand: k === 0 ? { x0: w - 8 - 96 - 60, x1: w - 8 - 96 - 4, y, s: 0.3 } : { x0: 8 + 96 + 4, x1: 8 + 96 + 60, y, s: 0.3 },
        bubble: { x: k === 0 ? w - 56 : 56, y: y + 26, side: "below" },
      };
    };
    // 3인: 내 다음 차례(rel 1)가 오른쪽(이름표 오른쪽, 아랫줄), 그다음(rel 2)이 왼쪽 윗줄 — 화투는 오른쪽으로 돈다.
    const spots = [mine, ...(opponents === 1 ? [opp(0)] : [opp(0), opp(1)])];
    return {
      mode, w, h, top,
      stock: { x: cx, y: stockY, s: 0.5 },
      board: {
        s: boardS,
        slot: (month, index) => ({ x: colX((month - 1) % 4) + index * 5, y: rowY(Math.floor((month - 1) / 4)) - 4 + index * 6, r: 0, s: boardS }),
        center: (month) => ({ x: colX((month - 1) % 4), y: rowY(Math.floor((month - 1) / 4)) }),
      },
      banner: { x: cx, y: rowY(1) },
      timer: null,
      seat: (rel) => spots[rel] ?? mine,
    };
  }

  // 넓은 화면(PC): 위 상대 · 바닥 두 줄(가운데 더미) · 내 먹은 패 · 손패.
  const top = 46;
  const capS = 0.62;
  const boardS = 0.8;
  const handS = 1;
  const oppY = top + 58;
  const handY = h - 64;
  const myCapY = handY - 94;
  const boardMid = Math.round((oppY + (HWATU.h * capS) / 2 + myCapY - (HWATU.h * capS) / 2) / 2);
  const rowGap = 40;
  // 넓은 화면일수록 바닥을 넓게 편다(가운데에 몰려 양옆이 비었다). 칸은 뻑 더미가 비껴 쌓일 자리까지.
  const pitch = Math.round(Math.max(66, Math.min(96, (w / 2 - 64 - 150) / 2.5)));
  const gap = 64;
  const boardX = (month: number) => {
    const col = (month - 1) % 6;
    return col < 3 ? cx - gap - (2 - col) * pitch : cx + gap + (col - 3) * pitch;
  };
  const boardRowY = (month: number) => (month <= 6 ? boardMid - rowGap : boardMid + rowGap);
  const plateW = 140;
  const mine: GostopSpot = {
    plate: { x: 14, y: handY, side: "right" },
    captured: { x: 16, y: myCapY, dir: 1, maxW: Math.min(w - 32 - 110, 760), s: capS },
    hand: { x0: 14 + plateW + 14, x1: w - 14, y: handY, s: handS },
    bubble: { x: 14 + plateW / 2, y: handY - 44, side: "above" },
  };
  const opp = (k: number): GostopSpot => {
    if (opponents === 1) {
      return {
        plate: { x: w - 14, y: oppY, side: "left" },
        captured: { x: 16, y: oppY, dir: 1, maxW: w - 16 - plateW - 14 - 190, s: capS, below: true },
        hand: { x0: w - 14 - plateW - 176, x1: w - 14 - plateW - 12, y: oppY, s: 0.46 },
        bubble: { x: w - 14 - plateW / 2, y: oppY + 40, side: "below" },
      };
    }
    const left = k === 0;
    const half = w / 2;
    return left
      ? { plate: { x: 14, y: oppY, side: "right" }, captured: { x: 14 + plateW + 84, y: oppY, dir: 1, maxW: half - plateW - 110 - PILL_ROOM, s: capS * 0.86, below: true }, hand: { x0: 14 + plateW + 6, x1: 14 + plateW + 78, y: oppY, s: 0.4 }, bubble: { x: 14 + plateW / 2, y: oppY + 40, side: "below" } }
      : { plate: { x: w - 14, y: oppY, side: "left" }, captured: { x: w - 14 - plateW - 84, y: oppY, dir: -1, maxW: half - plateW - 110 - PILL_ROOM, s: capS * 0.86, below: true }, hand: { x0: w - 14 - plateW - 78, x1: w - 14 - plateW - 6, y: oppY, s: 0.4 }, bubble: { x: w - 14 - plateW / 2, y: oppY + 40, side: "below" } };
  };
  // 3인: 내 다음 차례(rel 1)가 오른쪽 위, 그다음(rel 2)이 왼쪽 위 — 화투는 오른쪽으로 돈다.
    const spots = [mine, ...(opponents === 1 ? [opp(0)] : [opp(1), opp(0)])];
  return {
    mode, w, h, top,
    stock: { x: cx, y: boardMid, s: 0.74 },
    board: {
      s: boardS,
      slot: (month, index) => ({ x: boardX(month) + index * 7, y: boardRowY(month) - 4 + index * 7, r: 0, s: boardS }),
      center: (month) => ({ x: boardX(month), y: boardRowY(month) }),
    },
    banner: { x: cx, y: boardMid },
    timer: { x: cx + gap + 2 * pitch + 78, y: boardMid },
    seat: (rel) => spots[rel] ?? mine,
  };
}
