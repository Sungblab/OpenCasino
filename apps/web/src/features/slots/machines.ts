import type { SlotMachineId } from "@opencasino/contracts";
import { SLOT_MACHINES, type SlotMachine } from "@opencasino/game-core/slot-machines";
import { slotSymbolName } from "@opencasino/game-core/slots";
import { CHERRY_ART, drawCherryMarquee } from "./cherryArt";
import { DRAGON_ART, DRAGON_FONTS, DRAGON_FONT_TEXT, drawDragonMarquee } from "./dragonArt";
import { GOLDEN_SEVEN_ART, SYMBOL_ORDER, drawMarquee, type SymbolArt } from "./symbolArt";

/**
 * 기계마다 다른 화면 쪽 설정: 심볼 그림·이름, 첫 화면 스톱, 3D 캐비닛(릴 폭·테·유리·간판).
 * 규칙·릴 스트립은 game-core 의 SLOT_MACHINES 그대로 쓴다.
 */

/** 창을 두르는 테 한 겹(바깥 → 안 순서로 쌓는다). pad = 창 가장자리에서 바깥으로 나온 폭. */
export interface RimSpec { pad: number; color: number; metalness: number; roughness: number }

export interface SlotCabinet {
  reelW: number;
  reelGap: number;
  rims: readonly RimSpec[];
  divider: { width: number; color: number };
  /** 창 앞 유리 반사(클래식 기계식 릴). */
  glass: boolean;
  /** 드럼 뒤 가림판 색. 없으면 무대(CSS) 배경이 드럼 둘레 틈으로 비친다. */
  backing?: number;
  marquee(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  /** 아틀라스·간판을 그리기 전에 받아 둘 글꼴. */
  fonts?: { specs: readonly string[]; text: string };
}

export interface SlotView {
  machine: SlotMachine;
  /** 화면 머리글 아래 한 줄. */
  subtitle: string;
  art: SymbolArt;
  names: Record<string, string>;
  /** 돌지 않을 때 창에 보일 위 줄 스톱. */
  restStops: readonly number[];
  cabinet: SlotCabinet;
}

const GOLD = 0xd9a441;

export const SLOT_VIEWS: Record<SlotMachineId, SlotView> = {
  "golden-seven": {
    machine: SLOT_MACHINES["golden-seven"],
    subtitle: "5릴 · 20라인 · 환수율 96.09%",
    art: GOLDEN_SEVEN_ART,
    names: Object.fromEntries(SYMBOL_ORDER.map((symbol) => [symbol, slotSymbolName(symbol)])),
    restStops: [3, 11, 20, 6, 28],
    cabinet: {
      reelW: 1.02,
      reelGap: 0.1,
      rims: [{ pad: 0.08, color: GOLD, metalness: 1, roughness: 0.28 }],
      divider: { width: 0.03, color: 0xb8872e },
      glass: false,
      marquee: drawMarquee,
    },
  },
  "lucky-cherry": {
    machine: SLOT_MACHINES["lucky-cherry"],
    subtitle: "클래식 3릴 · 5라인 · 환수율 96.24%",
    art: CHERRY_ART,
    names: { W: "WILD ×2", R7: "레드 7", B7: "블루 7", A7: "아무 7", B3: "트리플 BAR", B2: "더블 BAR", B1: "BAR", AB: "아무 BAR", CH: "체리", BL: "빈칸" },
    // 가운데 줄에 레드 7 · 블루 7 · 체리(당첨 아님).
    restStops: [5, 21, 27],
    cabinet: {
      reelW: 1.12,
      reelGap: 0.26,
      // 두꺼운 크롬 테 + 안쪽 검은 고무 테 — 옛 기계식 릴 창.
      rims: [
        { pad: 0.2, color: 0xf4f6f9, metalness: 1, roughness: 0.24 },
        { pad: 0.06, color: 0x1b1d22, metalness: 0.2, roughness: 0.6 },
      ],
      // 칸막이가 릴 사이 틈을 다 덮는 굵은 크롬 기둥.
      divider: { width: 0.26, color: 0xc9ced6 },
      glass: true,
      // 빨간 무대가 드럼 둘레로 비치면 커튼처럼 보여 — 캐비닛 안쪽은 어둡게.
      backing: 0x120806,
      marquee: drawCherryMarquee,
    },
  },
  "golden-dragon": {
    machine: SLOT_MACHINES["golden-dragon"],
    subtitle: "5릴 · 243웨이 · 환수율 96.32%",
    art: DRAGON_ART,
    names: { DR: "용", TG: "호랑이", KO: "잉어", IN: "금원보", LA: "등롱", A: "A", K: "K", Q: "Q", J: "J", W: "WILD", W2: "WILD ×2", W3: "WILD ×3", SC: "福 보너스" },
    // 높은 심볼·WILD·福 이 고루 보이고 당첨은 없는 칸.
    restStops: [23, 21, 7, 14, 31],
    cabinet: {
      reelW: 1.02,
      reelGap: 0.1,
      // 붉은 옻칠 테 + 안쪽 금테.
      rims: [
        { pad: 0.18, color: 0x8e140c, metalness: 0.3, roughness: 0.32 },
        { pad: 0.07, color: GOLD, metalness: 1, roughness: 0.25 },
      ],
      divider: { width: 0.03, color: 0xc99a3a },
      glass: false,
      marquee: drawDragonMarquee,
      fonts: { specs: DRAGON_FONTS, text: DRAGON_FONT_TEXT },
    },
  },
};

export function loadCabinetFonts(cabinet: SlotCabinet): Promise<unknown> {
  if (!cabinet.fonts || typeof document === "undefined" || !document.fonts) return Promise.resolve();
  // 한자 획이 없으면 기본 글꼴로 그려 아틀라스에 굳는다 — 받을 때까지 기다리되 끝없이 막지는 않는다.
  const load = Promise.all(cabinet.fonts.specs.map((spec) => document.fonts.load(spec, cabinet.fonts!.text))).catch(() => undefined);
  return Promise.race([load, new Promise((resolve) => window.setTimeout(resolve, 2_500))]);
}
