import { Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, CanvasTexture, SRGBColorSpace } from "three";
import type { Card, LightningCardSnapshot as LightningCard, RoomPhase, RoundResult } from "@opencasino/contracts";
import { baccaratPartialScore } from "@opencasino/game-core/reveal";
import { cardFaceUrl } from "../../components/CardFace";
import { COMPACT_W } from "../stage/layout";
import type { MyResult, StageControllerBase, StageSounds } from "../stage/core";
import { CARD_H, CARD_W, createCardTable, paintEmblem, type Card3D, type TableSlot } from "../stage3d/cardTable3d";

/**
 * 바카라 게임 화면(three.js). 펠트·슈·카드·카메라는 stage3d/cardTable3d 가 맡고, 여기서는 두 손을
 * 어디에 놓는지, 스냅샷에서 어떤 카드가 새로 왔는지, 점수·라이트닝 띠, 세 번째 카드의 쪼기만 다룬다.
 * 베팅판·칩·로드·잔액은 전부 React DOM 이다.
 *
 * 서버 시간표(BACCARAT_REVEAL): 보통 카드는 1초 간격, 세 번째 카드는 squeezeMs 간격. 세 번째 카드는
 * 엎어 둔 채 잠시 기다렸다가 한 번에 뒤집는다(예전엔 앞쪽 끝을 들었다 내렸다 해서 뒤집힐 듯 말 듯 보였다) —
 * 그 연출이 squeezeMs 안에 끝나야 다음 장이 연출보다 먼저 오지 않는다.
 */

export type { StageSounds };

export interface StageState {
  roundId: string | null;
  phase: RoomPhase;
  phaseEndsAt: string | null;
  phaseDurationMs: number | null;
  playerCards: Card[];
  bankerCards: Card[];
  result: RoundResult | null;
  playerPair: boolean;
  bankerPair: boolean;
  lightningCards: LightningCard[];
  /** 라이트닝 방인가. 폰 배치는 라이트닝 배수 띠 자리를 이 방에서만 비워 둔다. */
  lightningRoom: boolean;
  paused: boolean;
  /** 슈에 남은 장수(아직 뒤집지 않은 카드 포함). 버림 패 두께와 새 슈를 알아보는 데 쓴다. */
  shoeRemaining: number;
}

/** 8덱 슈. 서버(baccarat-room-manager)가 60장 아래로 내려가면 새로 섞는다. */
const SHOE_CARDS = 416;

export interface StageController extends StageControllerBase<StageState> {
  /** 이 판 내 손익(승리했습니다 +20코인)을 결과 배너 아래 칸에(폰은 상태 알약 끝에) 붙인다. */
  showMine(result: MyResult): void;
}

type Side = "player" | "banker";

const COLOR: Record<RoundResult, string> = { player: "#2b7fff", banker: "#e63946", tie: "#169f4a" };
const COLOR_LIGHT: Record<RoundResult, string> = { player: "#6ba6ff", banker: "#ff7078", tie: "#4ee79a" };
const WIN_LABEL: Record<RoundResult, string> = { player: "PLAYER WIN", banker: "BANKER WIN", tie: "TIE" };
const REVEAL_ORDER: Array<[Side, number]> = [["player", 0], ["banker", 0], ["player", 1], ["banker", 1], ["player", 2], ["banker", 2]];
const GOLD = "#ffd24a";

/** 슈는 오른쪽 위(딜러 쪽)에서 가운데 앞을 보고, 버림 패 통은 거울 자리. */
const SHOE: TableSlot = { x: 3.0, z: -1.5, yaw: Math.atan2(-1, 0.45) };
const TRAY: TableSlot = { x: -3.0, z: -1.5, yaw: -Math.atan2(-1, 0.45) };
/** 딜러 앞 칩 트레이(라이트닝 방은 그 자리에 배수 띠가 와서 뺀다). */
const CHIP_TRAY: TableSlot = { x: 0, z: -1.78, yaw: 0 };

interface Layout {
  compact: boolean;
  pitch: number;
  handGap: number;
  pair: number;
  labelZ: number;
  bannerZ: number;
  lightningZ: number;
  frame: { x0: number; x1: number; z0: number; z1: number };
  topPx: number;
  bottomPx: number;
  arc: [number, number];
}

/** 넓은 화면: 세 번째 카드를 바깥에 눕힌다. 폰: 두 장 아래에 걸쳐 눕히고, 더 위에서 내려다본다. */
function layoutFor(compact: boolean, lightning: boolean): Layout {
  if (compact) {
    return {
      compact, pitch: 1.2, handGap: 1.0, pair: 0.33, labelZ: -0.74, bannerZ: 1.1, lightningZ: 1.45,
      frame: { x0: -1.72, x1: 1.72, z0: -0.98, z1: lightning ? 1.8 : 0.98 }, topPx: 32, bottomPx: 4, arc: [3.4, 3.55],
    };
  }
  return {
    compact, pitch: 0.98, handGap: 1.35, pair: 0.34, labelZ: -0.8, bannerZ: 1.02, lightningZ: -1.42,
    frame: { x0: -3.0, x1: 3.0, z0: lightning ? -1.75 : -1.15, z1: 1.42 }, topPx: 46, bottomPx: 8, arc: [5.9, 3.62],
  };
}

export async function createBaccaratStage(host: HTMLElement, sounds: StageSounds = {}, vipRoom = false): Promise<StageController> {
  const table = await createCardTable(host, sounds, { name: "baccarat", felt: { inner: "#1c7050", mid: "#0f4a33", outer: "#062418" }, vipRoom });
  const { wait, setStatus } = table;

  let layout = layoutFor(false, false);
  let lightningRoom = false;

  const slotPos = (side: Side, index: number): TableSlot => {
    const center = side === "player" ? -layout.handGap : layout.handGap;
    if (index === 2) {
      const yaw = side === "player" ? Math.PI / 2 : -Math.PI / 2;
      if (layout.compact) return { x: center, z: 0.6, yaw, y: 0.003 };
      return { x: side === "player" ? center - 1.13 : center + 1.13, z: 0, yaw };
    }
    // 플레이어는 첫 장이 바깥, 둘째 장이 안쪽. 뱅커는 거울처럼 반대.
    const offset = index === 0 ? -layout.pair : layout.pair;
    return { x: center + (side === "player" ? offset : -offset), z: 0, yaw: 0 };
  };
  const handCenter = (side: RoundResult) => {
    const z = layout.compact ? 0.25 : 0;
    if (side === "tie") return new Vector3(0, 0, z);
    const lean = layout.compact ? 0 : 0.25;
    return new Vector3(side === "player" ? -layout.handGap - lean : layout.handGap + lean, 0, z);
  };

  /* ───────── DOM 글자 ───────── */
  const labels = {} as Record<Side, HTMLDivElement>;
  for (const side of ["player", "banker"] as Side[]) {
    const el = document.createElement("div");
    el.className = "ct-anchor ct-hand-label";
    el.style.setProperty("--l", COLOR_LIGHT[side]);
    el.style.setProperty("--c", COLOR[side]);
    el.innerHTML = `<span>${side.toUpperCase()}</span><span class="num">0</span>`;
    table.track(el, () => new Vector3(side === "player" ? -layout.handGap : layout.handGap, 0, layout.labelZ));
    labels[side] = el;
  }
  const lightningEl = document.createElement("div");
  lightningEl.className = "ct-anchor ct-lightning";
  table.track(lightningEl, () => new Vector3(0, 0, layout.lightningZ));

  const relayout = () => {
    const compact = table.size().w < COMPACT_W;
    layout = layoutFor(compact, lightningRoom);
    table.layout({
      rig: { pitch: layout.pitch, frame: layout.frame, topPx: layout.topPx, bottomPx: layout.bottomPx },
      feltCenterZ: 0.1,
      paint: (g, px, pz, unit) => {
        // 카지노 테이블의 금색 곡선 두 줄 — 카드 아래를 감싼다.
        g.strokeStyle = "rgba(233,196,106,.5)";
        const [rx, rz] = layout.arc;
        for (const [grow, width] of [[0, 3], [0.22, 1.5]] as const) {
          g.beginPath();
          g.ellipse(px(0), pz(-2.3), (rx + grow) * unit, (rz + grow * 0.62) * unit, 0, 0.1 * Math.PI, 0.9 * Math.PI);
          g.lineWidth = width;
          g.stroke();
        }
        // 카드 자리: 가는 실선(점선은 화면 UI 테두리처럼 보였다 — 실제 테이블 인쇄는 실선이다)
        g.lineWidth = 2;
        g.strokeStyle = "rgba(233,196,106,.3)";
        for (const side of ["player", "banker"] as Side[]) {
          for (let index = 0; index < 3; index += 1) {
            const s = slotPos(side, index);
            const across = s.yaw !== 0;
            const w = (across ? CARD_H : CARD_W) + 0.06, d = (across ? CARD_W : CARD_H) + 0.06;
            g.beginPath();
            g.roundRect(px(s.x - w / 2), pz(s.z - d / 2), w * unit, d * unit, 0.05 * unit);
            g.stroke();
          }
        }
        // 두 손 사이 가운데 엠블럼(폰은 세 번째 카드가 가운데 아래로 눕고 자리가 좁아 뺀다).
        if (!layout.compact) paintEmblem(g, px, pz, unit, 0, -0.02, 0.44);
      },
      props: { shoe: SHOE, tray: TRAY, railZ: layout.compact ? null : -2.3, visible: !layout.compact, chipTray: lightningRoom ? null : CHIP_TRAY },
      bannerAt: () => new Vector3(0, 0, layout.bannerZ),
      compactBanner: layout.compact,
      // 테이블 끝: 금색 곡선 인쇄 바깥으로 가죽 팔걸이(폰은 화면이 좁아 펠트만).
      rim: layout.compact ? null : { cz: -2.3, rx: layout.arc[0] + 0.55, rz: layout.arc[1] + 0.34 },
    });
    for (const side of ["player", "banker"] as Side[]) {
      hands[side].forEach((c, index) => {
        if (c?.settled) table.placeAt(c, slotPos(side, index), c.flipper.rotation.z < 1);
      });
    }
  };

  /* ───────── 상태 ───────── */
  const hands: Record<Side, Card3D[]> = { player: [], banker: [] };
  const revealed: Record<Side, Card[]> = { player: [], banker: [] };
  let lightningMap = new Map<string, number>();
  let state: StageState | null = null;

  const updateScore = (side: Side, animate: boolean) => {
    const score = baccaratPartialScore(revealed[side]);
    const el = labels[side];
    el.querySelector(".num")!.textContent = String(score ?? 0);
    el.classList.toggle("has", score !== null);
    if (animate && score !== null) {
      el.classList.remove("bump");
      void el.offsetWidth;
      el.classList.add("bump");
    }
  };

  // 라이트닝 배수 딱지: 카드 앞면 오른쪽 위 모서리에 붙어 같이 뒤집힌다.
  const badgeTextures = new Map<number, CanvasTexture>();
  const badgeGeo = new PlaneGeometry(0.3, 0.17).rotateX(-Math.PI / 2);
  const addLightningBadge = (c: Card3D) => {
    const multiplier = c.card && lightningMap.get(`${c.card.rank}${c.card.suit}`);
    if (!multiplier) return;
    let tex = badgeTextures.get(multiplier);
    if (!tex) {
      const canvas = document.createElement("canvas");
      canvas.width = 150;
      canvas.height = 86;
      const g = canvas.getContext("2d")!;
      g.fillStyle = GOLD;
      g.strokeStyle = "#1c1300";
      g.lineWidth = 4;
      g.beginPath();
      g.roundRect(3, 3, 144, 80, 18);
      g.fill();
      g.stroke();
      g.fillStyle = "#1c1300";
      g.font = "800 50px Poppins, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(`×${multiplier}`, 75, 46);
      tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      badgeTextures.set(multiplier, tex);
    }
    const badge = new Mesh(badgeGeo, new MeshBasicMaterial({ map: tex, transparent: true }));
    badge.position.set(CARD_W / 2 - 0.13, 0.002, -CARD_H / 2 + 0.08);
    c.face.add(badge);
  };
  const showLightning = (cards: LightningCard[]) => {
    lightningMap = new Map(cards.map((item) => [`${item.card.rank}${item.card.suit}`, item.multiplier]));
    lightningEl.innerHTML = cards.map((item, i) => `<figure style="--i:${i}"><img src="${cardFaceUrl(item.card)}" alt=""><figcaption>×${item.multiplier}</figcaption></figure>`).join("");
  };

  const placeCard = async (side: Side, index: number, card: Card, requested: boolean) => {
    const c = await table.newCard(card);
    hands[side][index] = c;
    const slot = slotPos(side, index);
    if (!table.live(requested)) {
      table.placeAt(c, slot, true);
      addLightningBadge(c);
      revealed[side][index] = card;
      updateScore(side, false);
      return;
    }
    const third = index === 2;
    if (!third) {
      setStatus("카드 배분 중");
      await table.dealTo(c, slot);
      await wait(70);
      await table.flip(c, 360);
    } else {
      // 세 번째 카드: 엎어 둔 채 기다렸다가 뒤집는다. 들썩이며 쪼던 연출은 뺐다(뒤집힐 듯 말 듯해서 어색했다).
      setStatus(`${side === "player" ? "PLAYER" : "BANKER"} 세 번째 카드`, GOLD);
      await table.dealTo(c, slot);
      await wait(950);
      await table.flip(c, 420);
    }
    addLightningBadge(c);
    revealed[side][index] = card;
    updateScore(side, true);
  };

  const showResult = async (result: RoundResult, next: StageState, requested: boolean) => {
    const animate = table.live(requested);
    table.addGlow(() => handCenter(result), result === "tie" ? 5.2 : 3.2, result === "tie" ? 2.4 : 2.2, COLOR[result]);
    if (animate) void table.flashLamps(COLOR_LIGHT[result]);
    if (result !== "tie") for (const c of hands[result]) if (c) void table.liftCard(c, 0.05);
    const player = baccaratPartialScore(next.playerCards) ?? 0;
    const banker = baccaratPartialScore(next.bankerCards) ?? 0;
    const natural = next.playerCards.length === 2 && next.bankerCards.length === 2 && (player >= 8 || banker >= 8);
    const sub = [natural && "NATURAL", next.playerPair && "PLAYER PAIR", next.bankerPair && "BANKER PAIR"].filter(Boolean).join(" · ");
    await table.showBanner(WIN_LABEL[result], sub, COLOR[result], animate, COLOR_LIGHT[result]);
  };

  const clearHands = () => {
    hands.player = [];
    hands.banker = [];
    revealed.player = [];
    revealed.banker = [];
    lightningMap = new Map();
  };

  const sweep = async () => {
    const cards = [...hands.player, ...hands.banker].filter(Boolean);
    for (const side of ["player", "banker"] as Side[]) labels[side].classList.remove("has");
    lightningEl.classList.add("hide");
    await Promise.all([
      table.focusOn(null, 420),
      table.clearGlows(true),
      table.hideBanner(true),
      table.sweepCards(cards),
      wait(220).then(() => { lightningEl.innerHTML = ""; lightningEl.classList.remove("hide"); }),
    ]);
    clearHands();
  };

  const resetInstant = () => {
    for (const c of [...hands.player, ...hands.banker]) if (c) table.disposeCard(c);
    clearHands();
    void table.focusOn(null, 0);
    void table.clearGlows(false);
    void table.hideBanner(false);
    labels.player.classList.remove("has");
    labels.banker.classList.remove("has");
    lightningEl.innerHTML = "";
  };

  const statusForPhase = (next: StageState) => {
    // 단계와 남은 시간은 게임 화면 위 이 알약 한 곳에만 — 베팅 중엔 "베팅하세요 · 8"과 링(헤더 알약·가운데 시계는 없앴다).
    table.setCountdown(!next.paused && next.phase === "BETTING" ? { endsAt: next.phaseEndsAt, durationMs: next.phaseDurationMs, label: "베팅하세요" } : null);
    if (next.paused) return setStatus("테이블 일시정지", GOLD);
    if (next.phase === "BETTING") return undefined;
    if (next.phase === "WAITING") return setStatus("대기 중");
    if (next.phase === "LOCKED") return setStatus("베팅 마감", GOLD);
    if (next.phase === "DEALING" && !next.result && next.playerCards.length === 0) return setStatus("카드 배분 중");
    return undefined;
  };

  table.onResize(relayout);

  let currentRound: string | null = null;
  let resultShownFor: string | null = null;
  let lightningShownFor: string | null = null;
  let firstUpdate = true;

  return {
    update(next) {
      const previous = state;
      state = next;
      if (next.lightningRoom !== lightningRoom) {
        lightningRoom = next.lightningRoom;
        relayout();
      }
      const catchUp = firstUpdate;
      firstUpdate = false;
      // 새 판(또는 판이 끝남): 이전 판 카드를 버림 패로 쓸어 낸다.
      if (next.roundId !== currentRound) {
        const hadCards = hands.player.length + hands.banker.length > 0;
        currentRound = next.roundId;
        resultShownFor = null;
        lightningShownFor = null;
        if (hadCards) {
          if (catchUp) resetInstant();
          else table.enqueue(sweep);
        }
      }
      if (previous?.phase !== next.phase || previous?.paused !== next.paused) statusForPhase(next);

      // 버림 패: 처음 그릴 때는 지금까지 버린 장수(= 슈 전체 − 남은 장수 − 테이블 위 카드)로 맞추고, 그 뒤로는
      // 쓸어 낸 만큼 쌓인다. 남은 장수가 크게 늘면 새 슈라서, 앞선 쓸기가 끝난 뒤에 비운다.
      table.setShoeLevel(next.shoeRemaining / SHOE_CARDS);
      if (catchUp) table.setDiscarded(SHOE_CARDS - next.shoeRemaining - next.playerCards.length - next.bankerCards.length);
      else if (previous && next.shoeRemaining > previous.shoeRemaining + 100) table.enqueue(() => table.clearDiscard(table.live(true)));

      if (next.roundId && next.lightningCards.length > 0 && lightningShownFor !== next.roundId) {
        lightningShownFor = next.roundId;
        const cards = next.lightningCards;
        // 중간에 들어와 따라잡는 중이면 번개는 이미 친 뒤라 그림만 놓는다.
        const strike = !catchUp;
        table.enqueue(async () => {
          showLightning(cards);
          if (strike && table.live(true)) sounds.lightning?.();
        });
      }

      // 새로 공개된 카드. 한 번에 두 장 넘게 밀려 왔거나 처음 그리는 것이면 애니메이션 없이 놓는다.
      const known = new Set<string>();
      for (const side of ["player", "banker"] as Side[]) {
        const shown = side === "player" ? previous?.playerCards.length ?? 0 : previous?.bankerCards.length ?? 0;
        for (let i = 0; i < (previous?.roundId === next.roundId ? shown : 0); i += 1) known.add(`${side}:${i}`);
      }
      const fresh = REVEAL_ORDER.filter(([side, index]) => {
        const cards = side === "player" ? next.playerCards : next.bankerCards;
        return index < cards.length && !known.has(`${side}:${index}`);
      });
      const snap = catchUp || fresh.length > 2;
      for (const [side, index] of fresh) {
        const card = (side === "player" ? next.playerCards : next.bankerCards)[index]!;
        table.enqueue(() => placeCard(side, index, card, !snap));
      }

      if (next.result && next.roundId && resultShownFor !== next.roundId) {
        resultShownFor = next.roundId;
        const result = next.result;
        const copy = next;
        const roundId = next.roundId;
        table.enqueue(async () => {
          await showResult(result, copy, !snap);
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
