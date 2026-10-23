import { Vector3 } from "three";
import type { Card, DragonTigerResult, RoomPhase } from "@opencasino/contracts";
import { dragonTigerCardValue as dragonTigerValue } from "@opencasino/game-core/dragon-tiger";
import { COMPACT_W } from "../stage/layout";
import type { MyResult, StageControllerBase, StageSounds } from "../stage/core";
import { CARD_H, CARD_W, createCardTable, type Card3D, type TableSlot } from "../stage3d/cardTable3d";
import { DISPLAY_FONT } from "../stage3d/core3d";

/**
 * 용호 게임 화면(three.js). 드래곤·타이거에 카드 한 장씩, 큼직하게. 펠트·슈·카드·카메라는
 * stage3d/cardTable3d 가 맡는다.
 *
 * 서버 시간표(DRAGON_TIGER_REVEAL): 드래곤 카드 → 1.1초 뒤 타이거 카드 → 1.1초 뒤 승패. 스피드 게임이라 두
 * 장 다 날아와 바로 뒤집는다(쪼기는 바카라 세 번째 카드만). 화면(DOM)의 결과 표시는 이 판이 승패를 다
 * 보여 줬다는 신호(resultShown)를 기다린다.
 */

export interface DragonTigerStageState {
  roundId: string | null;
  phase: RoomPhase;
  phaseEndsAt: string | null;
  phaseDurationMs: number | null;
  dragonCard: Card | null;
  tigerCard: Card | null;
  result: DragonTigerResult | null;
  suitedTie: boolean;
  paused: boolean;
  /** 슈에 남은 장수. 버림 패 두께와 새 슈를 알아보는 데 쓴다. */
  shoeRemaining: number;
}

/** 8덱 슈. 서버(dragon-tiger-room-manager)가 52장 아래로 내려가면 새로 섞는다. */
const SHOE_CARDS = 416;

export interface DragonTigerStageController extends StageControllerBase<DragonTigerStageState> {
  /** 이 판 내 손익(승리했습니다 +20코인)을 결과 배너 아래 칸에(폰은 상태 알약 끝에) 붙인다. */
  showMine(result: MyResult): void;
}

type Side = "dragon" | "tiger";

const COLOR: Record<DragonTigerResult, string> = { dragon: "#2b7fff", tiger: "#e63946", tie: "#169f4a" };
const COLOR_LIGHT: Record<DragonTigerResult, string> = { dragon: "#6ba6ff", tiger: "#ff7078", tie: "#4ee79a" };
const WIN_LABEL: Record<DragonTigerResult, string> = { dragon: "DRAGON WIN", tiger: "TIGER WIN", tie: "TIE" };
const GOLD = "#ffd24a";
const SHOE: TableSlot = { x: 3.0, z: -1.5, yaw: Math.atan2(-1, 0.45) };
const TRAY: TableSlot = { x: -3.0, z: -1.5, yaw: -Math.atan2(-1, 0.45) };

function layoutFor(compact: boolean) {
  return compact
    ? { compact, pitch: 1.2, gap: 1.05, scale: 1.2, labelZ: -0.86, bannerZ: 1.0, frame: { x0: -1.75, x1: 1.75, z0: -1.08, z1: 0.72 }, topPx: 32, bottomPx: 4, arc: [3.4, 3.35] as const }
    : { compact, pitch: 0.98, gap: 1.45, scale: 1.25, labelZ: -0.98, bannerZ: 1.1, frame: { x0: -3.0, x1: 3.0, z0: -1.3, z1: 1.45 }, topPx: 46, bottomPx: 8, arc: [5.9, 3.62] as const };
}

export async function createDragonTigerStage(host: HTMLElement, sounds: StageSounds = {}, vipRoom = false): Promise<DragonTigerStageController> {
  // 예전 용호 테이블(#6e1620 계열)의 검붉은 펠트.
  const table = await createCardTable(host, sounds, { name: "dragon tiger", felt: { inner: "#8e2533", mid: "#6e1620", outer: "#2a060b" }, vipRoom });
  const { wait, setStatus } = table;
  let layout = layoutFor(false);

  const slotPos = (side: Side): TableSlot => ({ x: side === "dragon" ? -layout.gap : layout.gap, z: 0, yaw: 0 });
  const centerOf = (result: DragonTigerResult) => (result === "tie" ? new Vector3(0, 0, 0) : new Vector3(slotPos(result).x, 0, 0));

  const labels = {} as Record<Side, HTMLDivElement>;
  for (const side of ["dragon", "tiger"] as Side[]) {
    const el = document.createElement("div");
    el.className = "ct-anchor ct-hand-label";
    el.style.setProperty("--l", COLOR_LIGHT[side]);
    el.style.setProperty("--c", COLOR[side]);
    el.innerHTML = `<span>${side.toUpperCase()}</span><span class="num">0</span>`;
    table.track(el, () => new Vector3(slotPos(side).x, 0, layout.labelZ));
    labels[side] = el;
  }

  const views: Partial<Record<Side, Card3D>> = {};
  let state: DragonTigerStageState | null = null;

  const relayout = () => {
    layout = layoutFor(table.size().w < COMPACT_W);
    table.layout({
      rig: { pitch: layout.pitch, frame: layout.frame, topPx: layout.topPx, bottomPx: layout.bottomPx },
      paint: (g, px, pz, unit) => {
        g.strokeStyle = "rgba(233,196,106,.5)";
        const [rx, rz] = layout.arc;
        for (const [grow, width] of [[0, 3], [0.22, 1.5]] as const) {
          g.beginPath();
          g.ellipse(px(0), pz(-2.3), (rx + grow) * unit, (rz + grow * 0.62) * unit, 0, 0.1 * Math.PI, 0.9 * Math.PI);
          g.lineWidth = width;
          g.stroke();
        }
        // 카드 자리와 가운데 VS(배당은 베팅 칸에 있다).
        g.setLineDash([0.07 * unit, 0.05 * unit]);
        g.lineWidth = 2.5;
        g.strokeStyle = "rgba(233,196,106,.34)";
        for (const side of ["dragon", "tiger"] as Side[]) {
          const s = slotPos(side);
          const w = CARD_W * layout.scale + 0.08, d = CARD_H * layout.scale + 0.08;
          g.beginPath();
          g.roundRect(px(s.x - w / 2), pz(s.z - d / 2), w * unit, d * unit, 0.06 * unit);
          g.stroke();
        }
        g.setLineDash([]);
        g.fillStyle = "rgba(240,180,28,.32)";
        g.font = `700 ${0.38 * unit}px ${DISPLAY_FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("VS", px(0), pz(0));
      },
      props: { shoe: SHOE, tray: TRAY, railZ: layout.compact ? null : -2.3, visible: !layout.compact, chipTray: { x: 0, z: -1.78, yaw: 0 } },
      bannerAt: () => new Vector3(0, 0, layout.bannerZ),
      compactBanner: layout.compact,
      rim: layout.compact ? null : { cz: -2.3, rx: layout.arc[0] + 0.55, rz: layout.arc[1] + 0.34 },
    });
    for (const side of ["dragon", "tiger"] as Side[]) {
      const c = views[side];
      if (c?.settled) table.placeAt(c, slotPos(side), c.flipper.rotation.z < 1);
    }
  };

  const showScore = (side: Side, card: Card, animate: boolean) => {
    const el = labels[side];
    el.querySelector(".num")!.textContent = String(dragonTigerValue(card));
    el.classList.add("has");
    if (animate) {
      el.classList.remove("bump");
      void el.offsetWidth;
      el.classList.add("bump");
    }
  };

  const placeCard = async (side: Side, card: Card, requested: boolean) => {
    const c = await table.newCard(card, layout.scale);
    views[side] = c;
    const slot = slotPos(side);
    if (!table.live(requested)) {
      table.placeAt(c, slot, true);
      showScore(side, card, false);
      return;
    }
    setStatus(side === "tiger" ? "TIGER 카드" : "DRAGON 카드");
    await table.dealTo(c, slot);
    await wait(60);
    await table.flip(c, 360);
    showScore(side, card, true);
  };

  const showResult = async (next: DragonTigerStageState, requested: boolean) => {
    const result = next.result!;
    const animate = table.live(requested);
    const suited = result === "tie" && next.suitedTie;
    if (animate) void table.flashLamps(suited ? GOLD : COLOR_LIGHT[result]);
    if (suited) {
      // SUITED TIE는 50배라 판 전체에 알린다: 두 카드를 금빛으로 들어 올린다.
      for (const side of ["dragon", "tiger"] as Side[]) {
        table.addGlow(() => centerOf(side), 2.2, 2.6, GOLD);
        const c = views[side];
        if (c) void table.liftCard(c, 0.08);
      }
    } else {
      table.addGlow(() => centerOf(result), result === "tie" ? 5.6 : 3.0, 2.6, COLOR[result]);
      const c = result === "tie" ? undefined : views[result];
      if (c) void table.liftCard(c, 0.06);
    }
    // 점수는 카드 옆 방울에 있으니 제목엔 승패만.
    const title = suited ? "SUITED TIE!" : WIN_LABEL[result];
    const sub = suited ? "같은 숫자 · 같은 무늬 — 50 : 1" : result === "tie" ? "DRAGON·TIGER 베팅은 절반 반환" : "";
    await table.showBanner(title, sub, suited ? GOLD : COLOR[result], animate, suited ? GOLD : COLOR_LIGHT[result]);
  };

  const sweep = async () => {
    const list = (["dragon", "tiger"] as Side[]).map((side) => views[side]).filter((c): c is Card3D => Boolean(c));
    delete views.dragon;
    delete views.tiger;
    for (const side of ["dragon", "tiger"] as Side[]) labels[side].classList.remove("has");
    await Promise.all([table.focusOn(null, 420), table.clearGlows(true), table.hideBanner(true), table.sweepCards(list)]);
  };

  const resetInstant = () => {
    for (const side of ["dragon", "tiger"] as Side[]) {
      const c = views[side];
      if (c) table.disposeCard(c);
      delete views[side];
      labels[side].classList.remove("has");
    }
    void table.focusOn(null, 0);
    void table.clearGlows(false);
    void table.hideBanner(false);
  };

  table.onResize(relayout);

  const statusForPhase = (next: DragonTigerStageState) => {
    // 단계와 남은 시간은 게임 화면 위 이 알약 한 곳에만 — 베팅 중엔 "베팅하세요 · 8"과 링(헤더 알약·가운데 시계는 없앴다).
    table.setCountdown(!next.paused && next.phase === "BETTING" ? { endsAt: next.phaseEndsAt, durationMs: next.phaseDurationMs, label: "베팅하세요" } : null);
    if (next.paused) return setStatus("테이블 일시정지", GOLD);
    if (next.phase === "BETTING") return undefined;
    if (next.phase === "WAITING") return setStatus("대기 중");
    if (next.phase === "LOCKED") return setStatus("베팅 마감", GOLD);
    if (next.phase === "DEALING" && !next.dragonCard) return setStatus("카드 배분 중");
    return undefined;
  };

  let currentRound: string | null = null;
  let resultShownFor: string | null = null;
  let firstUpdate = true;

  return {
    update(next) {
      const previous = state;
      state = next;
      const catchUp = firstUpdate;
      firstUpdate = false;

      if (next.roundId !== currentRound) {
        const hadCards = Boolean(views.dragon || views.tiger);
        currentRound = next.roundId;
        resultShownFor = null;
        if (hadCards) {
          if (catchUp) resetInstant();
          else table.enqueue(sweep);
        }
      }
      if (previous?.phase !== next.phase || previous?.paused !== next.paused) statusForPhase(next);

      // 슈·버림 패: 처음 그릴 때는 지금까지 버린 장수(= 슈 전체 − 남은 장수 − 테이블 위 카드)로 맞추고,
      // 그 뒤로는 쓸어 낸 만큼 쌓인다. 남은 장수가 크게 늘면 새 슈라서, 앞선 쓸기가 끝난 뒤에 비운다.
      table.setShoeLevel(next.shoeRemaining / SHOE_CARDS);
      const onTable = (next.dragonCard ? 1 : 0) + (next.tigerCard ? 1 : 0);
      if (catchUp) table.setDiscarded(SHOE_CARDS - next.shoeRemaining - onTable);
      else if (previous && next.shoeRemaining > previous.shoeRemaining + 100) table.enqueue(() => table.clearDiscard(table.live(true)));

      // 새로 공개된 카드. 두 장이 한꺼번에 왔으면(재접속 등) 애니메이션 없이 놓는다.
      const sameRound = previous?.roundId === next.roundId;
      const fresh: Array<[Side, Card]> = [];
      if (next.dragonCard && !(sameRound && previous?.dragonCard)) fresh.push(["dragon", next.dragonCard]);
      if (next.tigerCard && !(sameRound && previous?.tigerCard)) fresh.push(["tiger", next.tigerCard]);
      const snap = catchUp || fresh.length > 1;
      for (const [side, card] of fresh) table.enqueue(() => placeCard(side, card, !snap));

      if (next.result && next.roundId && resultShownFor !== next.roundId) {
        resultShownFor = next.roundId;
        const copy = next;
        const roundId = next.roundId;
        table.enqueue(async () => {
          await showResult(copy, !snap);
          sounds.resultShown?.(roundId);
        });
      }
    },
    showMine: (result) => table.showMine(result),
    destroy() {
      table.destroy();
    },
  };
}
