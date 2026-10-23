import { Vector3 } from "three";
import type { BlackjackHandStatus, BlackjackOutcome, Card, RoomPhase } from "@opencasino/contracts";
import { handValue } from "@opencasino/game-core/blackjack";
import { COMPACT_W } from "../stage/layout";
import type { MyResult, StageControllerBase, StageSounds } from "../stage/core";
import { CARD_W, createCardTable, type Card3D, type TableSlot } from "../stage3d/cardTable3d";
import { DISPLAY_FONT } from "../stage3d/core3d";
import {
  DEALER_CARD_SCALE, DEALER_Y, SEAT_CARD_SCALE, SEAT_COUNT,
  blackjackFit, cascadeSlot, dealOrder, dealerSlot, feltMidY, handAnchor, handBadge, sameCard, scoreLabel, seatSpacing, seatSpot, tableArcY, type BadgeTone,
} from "./logic";
import { seatLayoutStore, type SeatScreen } from "./seatLayout";

/**
 * 블랙잭 게임 화면(three.js): 딜러 손(엎어 둔 두 번째 카드 포함)과 일곱 좌석의 손(스플릿 포함), 점수·
 * 버스트·블랙잭·승패 표시, 보험 순간, 라이트닝 배수. 펠트·슈·카드·카메라는 stage3d/cardTable3d 가 맡는다.
 *
 * 자리 계산은 평면 설계 좌표(logic.ts 의 px)로 하고 월드로 옮긴다(설계 1px = CARD_W / 76) — 좌석 호·스플릿·
 * 카드 겹치기 규칙을 그대로 쓴다. 좌석 버튼·칩 더미·이름표는 캔버스 위 DOM(SeatSpots)이고, 그 자리는 여기서
 * 펠트의 베팅 동그라미를 화면으로 투영해 seatLayoutStore 로 알려 준다.
 *
 * 서버는 좌석 순서대로 카드를 한 장씩(0.55초 간격) 보낸다. 날아온 뒤 따로 뒤집을 시간이 없어서 좌석 카드는
 * 날아오는 도중에 뒤집힌다. 스플릿은 원래 손의 둘째 장이 새 손으로 옮겨 가고 두 손에 한 장씩 새로 온다 —
 * 카드를 "손 번호·몇 번째"로만 보면 둘째 장이 바뀐 것처럼 보이므로, 같은 좌석에서 자리를 잃은 카드는 같은
 * 카드가 필요한 새 자리로 옮겨 쓴다.
 */

export interface BlackjackStageHand {
  handId: string;
  seatNumber: number;
  handIndex: number;
  cards: Card[];
  status: BlackjackHandStatus;
  outcome: BlackjackOutcome | null;
  mine: boolean;
}

export interface BlackjackStageState {
  roundId: string | null;
  phase: RoomPhase;
  phaseEndsAt: string | null;
  phaseDurationMs: number | null;
  paused: boolean;
  dealerCards: Card[];
  dealerHoleHidden: boolean;
  dealerHoleDealt: boolean;
  hands: BlackjackStageHand[];
  occupied: boolean[];
  mySeat: number | null;
  /** 지금 내가 선택해야 하는 손. */
  activeHandId: string | null;
  /** 라이트닝 테이블만: 이번 판에 걸린 배수와 다음 판에 받을 배수. */
  lightning: { active: number | null; next: number | null } | null;
}

export interface BlackjackStageController extends StageControllerBase<BlackjackStageState> {
  /** 이 판 내 손익(승리했습니다 +20코인)을 결과 배너 아래 칸에(폰은 상태 알약 끝에) 붙인다. */
  showMine(result: MyResult): void;
}

interface Entry {
  card: Card | null;
  view: Card3D | null;
  /** 새로 온 카드: 아직 날려 보내지 않았다. */
  pending: boolean;
}
interface HandModel {
  hand: BlackjackStageHand;
  entries: Entry[];
}
interface HandHud {
  bubble: HTMLDivElement;
  badge: HTMLDivElement;
  marker: HTMLDivElement;
  badgeKey: string;
}

/** 설계 좌표의 카드 크기(Pixi 판의 CW·CH). 설계 1px 이 월드에서 얼마인지 여기서 정한다. */
const DESIGN_CW = 76;
const DESIGN_CH = 106;
const K = CARD_W / DESIGN_CW;
const GOLD = "#ffd24a";
const BADGE_COLOR: Record<BadgeTone, string> = { bust: "#e63946", blackjack: "#f0b41c", win: "#169f4a", lose: "#3a3a3a", push: "#4a6a8a", info: "#6b398d" };

export async function createBlackjackStage(host: HTMLElement, sounds: StageSounds = {}, vipRoom = false): Promise<BlackjackStageController> {
  const table = await createCardTable(host, sounds, { name: "blackjack", felt: { inner: "#1a6a4c", mid: "#0e4631", outer: "#052016" }, vipRoom });
  const { setStatus } = table;

  let design = { w: 640, h: 400 };
  let compact = false;
  /** 설계 좌표(px) → 월드. 설계 가운데가 월드 원점. */
  const world = (x: number, y: number, lift = 0) => new Vector3((x - design.w / 2) * K, lift, (y - design.h / 2) * K);
  const toSlot = (p: { x: number; y: number; r: number }, index: number): TableSlot => {
    const w = world(p.x, p.y);
    return { x: w.x, z: w.z, yaw: -p.r, y: index * 0.0025 };
  };

  /* ───────── 모델 ───────── */
  const hands = new Map<string, HandModel>();
  const huds = new Map<string, HandHud>();
  let dealer: Entry[] = [];
  let currentRound: string | null = null;
  let resultShownFor: string | null = null;
  let resultQueuedFor: string | null = null;
  let firstUpdate = true;
  let state: BlackjackStageState | null = null;
  let insuranceGlow = false;
  let printsOn = true;

  const seatHandCount = (seatNumber: number) => [...hands.values()].filter((model) => model.hand.seatNumber === seatNumber).length;
  const handPoint = (model: HandModel, index: number) => {
    const anchor = handAnchor(model.hand.seatNumber, model.hand.handIndex, seatHandCount(model.hand.seatNumber), design.w, design.h);
    return cascadeSlot(anchor, index);
  };
  const handSlot = (model: HandModel, index: number) => toSlot(handPoint(model, index), index);
  const dealerPoint = (index: number) => dealerSlot(index, dealer.length, design.w);
  const dealerTableSlot = (index: number) => toSlot(dealerPoint(index), index);
  const isFaceUp = (c: Card3D) => Boolean(c.card) && c.flipper.rotation.z < 1;

  /* ───────── DOM 글자 ───────── */
  const dealerLabel = document.createElement("div");
  dealerLabel.className = "ct-anchor ct-hand-label";
  dealerLabel.style.setProperty("--l", "#f0c35a");
  dealerLabel.innerHTML = "<span>DEALER</span>";
  table.track(dealerLabel, () => world(design.w / 2, DEALER_Y - (DESIGN_CH * DEALER_CARD_SCALE) / 2 - 17));
  const lightningChip = document.createElement("div");
  lightningChip.className = "ct-chip";
  lightningChip.hidden = true;
  Object.assign(lightningChip.style, { position: "absolute", right: "12px", top: "56px" });
  table.overlay.appendChild(lightningChip);
  let lightningKey = "";

  const makeHud = (): HandHud => {
    const bubble = document.createElement("div");
    bubble.className = "ct-anchor ct-bubble";
    bubble.hidden = true;
    const badge = document.createElement("div");
    badge.className = "ct-anchor ct-badge";
    badge.hidden = true;
    const marker = document.createElement("div");
    marker.className = "ct-anchor ct-marker";
    marker.hidden = true;
    return { bubble, badge, marker, badgeKey: "" };
  };
  const dropHud = (hud: HandHud) => { table.untrack(hud.bubble); table.untrack(hud.badge); table.untrack(hud.marker); };
  const setBadge = (hud: HandHud, badge: { text: string; tone: BadgeTone } | null, animate: boolean) => {
    const key = badge ? `${badge.text}|${badge.tone}` : "";
    if (key === hud.badgeKey) return;
    hud.badgeKey = key;
    hud.badge.hidden = !badge;
    if (!badge) return;
    hud.badge.textContent = badge.text;
    hud.badge.dataset.tone = badge.tone;
    hud.badge.style.setProperty("--c", BADGE_COLOR[badge.tone]);
    if (animate) {
      hud.badge.classList.remove("pop");
      void hud.badge.offsetWidth;
      hud.badge.classList.add("pop");
    }
  };
  const dealerHud = makeHud();
  let dealerAt = { bubble: world(0, 0), badge: world(0, 0) };
  table.track(dealerHud.bubble, () => dealerAt.bubble);
  table.track(dealerHud.badge, () => dealerAt.badge);

  /** 모델의 현재 자리로 이미 놓인 카드들을 옮긴다(스플릿·창 크기 변경). */
  const reflow = (animate: boolean) => {
    for (const model of hands.values()) {
      model.entries.forEach((entry, index) => {
        const c = entry.view;
        if (!c?.settled) return;
        const slot = handSlot(model, index);
        if (animate) void table.moveTo(c, slot);
        else table.placeAt(c, slot, isFaceUp(c));
      });
    }
    dealer.forEach((entry, index) => {
      const c = entry.view;
      if (!c?.settled) return;
      if (animate) void table.moveTo(c, dealerTableSlot(index), 220);
      else table.placeAt(c, dealerTableSlot(index), isFaceUp(c));
    });
  };

  /** 손마다 점수·표시·차례 표시를 지금 화면에 놓인 카드 기준으로 다시 그린다. */
  const syncHuds = (animate: boolean) => {
    const showOutcome = resultShownFor !== null && resultShownFor === currentRound;
    const myTurnPhase = state?.phase === "PLAYER_TURN";
    for (const [handId, model] of hands) {
      let hud = huds.get(handId);
      if (!hud) {
        hud = makeHud();
        // 손 모델은 판을 통째로 다시 그릴 때(snapTo) 새로 만들어지므로, 자리는 매번 id 로 찾는다.
        const at = () => {
          const current = hands.get(handId);
          if (!current) return null;
          return { first: handPoint(current, 0), top: handPoint(current, Math.max(0, current.entries.length - 1)) };
        };
        table.track(hud.bubble, () => { const p = at(); return p && world(p.first.x - 16, p.first.y + 26); });
        table.track(hud.badge, () => { const p = at(); return p && world((p.first.x + p.top.x) / 2, (p.first.y + p.top.y) / 2 + 6); });
        table.track(hud.marker, () => { const p = at(); return p && world(p.top.x, p.top.y - (DESIGN_CH * SEAT_CARD_SCALE) / 2 - 12); });
        huds.set(handId, hud);
      }
      const shown = model.entries.filter((entry) => entry.view && !entry.pending && entry.card).map((entry) => entry.card!);
      hud.bubble.hidden = shown.length === 0;
      hud.bubble.textContent = scoreLabel(shown);
      // 판이 진행 중일 때는 진행 상태를 서버 스냅샷이 아니라 화면에 놓인 카드로 판단해야 버스트 표시가
      // 카드보다 먼저 뜨지 않는다. 그래서 모든 카드가 놓였을 때만 상태를 반영한다.
      const settled = model.entries.every((entry) => !entry.pending);
      const multiplier = model.hand.mine ? state?.lightning?.active ?? 1 : 1;
      setBadge(hud, settled ? handBadge(model.hand, showOutcome, multiplier) : null, animate);
      const playing = myTurnPhase && model.hand.status === "playing" && settled;
      hud.marker.hidden = !playing;
      hud.marker.classList.toggle("other", model.hand.handId !== state?.activeHandId);
      // 결과가 난 뒤 진 손은 흐리게.
      const dim = showOutcome && (model.hand.outcome === "lose" || model.hand.outcome === "surrender");
      for (const entry of model.entries) if (entry.view) table.dimCard(entry.view, dim);
    }
    for (const [handId, hud] of huds) {
      if (!hands.has(handId)) {
        dropHud(hud);
        huds.delete(handId);
      }
    }
    const dealerShown = dealer.filter((entry) => entry.view && !entry.pending && entry.card && isFaceUp(entry.view)).map((entry) => entry.card!);
    dealerHud.bubble.hidden = dealerShown.length === 0;
    dealerHud.bubble.textContent = scoreLabel(dealerShown);
    const d0 = dealerPoint(0);
    const dn = dealerPoint(Math.max(0, dealer.length - 1));
    dealerAt = {
      bubble: world(d0.x - (DESIGN_CW * DEALER_CARD_SCALE) / 2 - 26, DEALER_Y),
      badge: world((d0.x + dn.x) / 2, DEALER_Y + (DESIGN_CH * DEALER_CARD_SCALE) / 2 + 4),
    };
    const dealerTotal = dealerShown.length > 0 ? handValue(dealerShown).total : 0;
    const dealerBadge = dealerShown.length >= 2 && dealerTotal > 21 ? { text: "딜러 버스트", tone: "bust" as const }
      : dealerShown.length === 2 && dealerTotal === 21 && dealer.every((entry) => !entry.pending) && dealer.length === 2 ? { text: "블랙잭", tone: "blackjack" as const } : null;
    setBadge(dealerHud, dealerBadge, animate);
  };

  const drawLightning = (lightning: BlackjackStageState["lightning"]) => {
    const key = lightning ? `${lightning.active ?? ""}|${lightning.next ?? ""}` : "";
    if (key === lightningKey) return;
    const previousNext = lightningKey.split("|")[1] ?? "";
    lightningKey = key;
    const parts = lightning ? [(lightning.active ?? 0) > 1 ? `이번 ×${lightning.active}` : "", lightning.next ? `다음 ×${lightning.next}` : ""].filter(Boolean) : [];
    lightningChip.hidden = parts.length === 0;
    if (parts.length === 0) return;
    lightningChip.textContent = `라이트닝  ${parts.join(" · ")}`;
    // 이번 판 정산에서 다음 판 배수를 막 받았으면 한 번 튀어 오르게 — 라이트닝의 순간.
    if (lightning?.next && String(lightning.next) !== previousNext) {
      lightningChip.classList.remove("pop");
      void lightningChip.offsetWidth;
      lightningChip.classList.add("pop");
    }
  };

  /* ───────── 배치 ───────── */
  /** 펠트 인쇄: 좌석 호를 따라가는 금색 선, 좌석 베팅 동그라미, 배당·보험 규칙 두 줄(보험 순간엔 밝게). */
  const paint = (g: CanvasRenderingContext2D, px: (x: number) => number, pz: (z: number) => number, unit: number) => {
    const at = (x: number, y: number) => { const w = world(x, y); return [px(w.x), pz(w.z)] as const; };
    g.beginPath();
    for (let x = 0; x <= design.w; x += 8) {
      const [cx, cz] = at(x, tableArcY(x, design.w, design.h));
      if (x === 0) g.moveTo(cx, cz); else g.lineTo(cx, cz);
    }
    g.strokeStyle = "rgba(240,180,28,.4)";
    g.lineWidth = 2.5;
    g.stroke();
    for (let seat = 1; seat <= SEAT_COUNT; seat += 1) {
      const p = seatSpot(seat, design.w, design.h);
      const [cx, cz] = at(p.x, p.y);
      const mine = seat === state?.mySeat;
      const taken = state?.occupied[seat - 1];
      g.beginPath();
      g.arc(cx, cz, 22 * K * unit, 0, Math.PI * 2);
      g.lineWidth = mine ? 3 : 2;
      g.strokeStyle = mine ? "rgba(255,210,74,.95)" : `rgba(240,180,28,${taken ? 0.5 : 0.35})`;
      g.stroke();
      g.beginPath();
      g.arc(cx, cz, 18 * K * unit, 0, Math.PI * 2);
      g.lineWidth = 1.2;
      g.strokeStyle = "rgba(240,180,28,.18)";
      g.stroke();
    }
    if (!printsOn) return;
    const insurance = state?.phase === "INSURANCE";
    const [mx, my] = at(design.w / 2, feltMidY(design.h));
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "rgba(240,180,28,.45)";
    g.font = `700 ${12 * K * unit}px ${DISPLAY_FONT}`;
    // 딜러 카드 아랫단(DEALER_Y + 42)에 붙지 않게 가운데보다 조금 아래 — 3장 쌓인 가운데 좌석 패와도 떨어진다.
    g.fillText("BLACKJACK PAYS 3 TO 2", mx, my - 1 * K * unit);
    g.fillStyle = insurance ? "rgba(255,210,74,.95)" : "rgba(240,180,28,.5)";
    g.font = `600 ${10 * K * unit}px ${DISPLAY_FONT}`;
    g.fillText("DEALER STANDS ON ALL 17 · INSURANCE PAYS 2 TO 1", mx, my + 18 * K * unit);
  };

  /** 좌석 버튼(DOM)이 앉을 화면 자리 — 베팅 동그라미를 투영하고, 그 자리의 원근 크기로 지름·이름표 폭을 잰다. */
  const publishSeats = () => {
    const seats: Record<number, SeatScreen> = {};
    const spacing = seatSpacing(design.w);
    for (let seat = 1; seat <= SEAT_COUNT; seat += 1) {
      const p = seatSpot(seat, design.w, design.h);
      const at = table.project(world(p.x, p.y));
      const left = table.project(world(p.x - 23, p.y));
      const right = table.project(world(p.x + 23, p.y));
      const scale = Math.hypot(right.x - left.x, right.y - left.y) / 46;
      seats[seat] = { x: at.x, y: at.y, spot: Math.max(34, 46 * scale), tagWidth: Math.max(48, spacing * scale - 6) };
    }
    seatLayoutStore.set(table, seats);
  };

  const relayout = () => {
    const { w, h } = table.size();
    const fit = blackjackFit(w, h);
    design = { w: fit.designW, h: fit.designH };
    compact = w < COMPACT_W;
    const shoe = world(design.w - 58, 70);
    const tray = world(58, 70);
    const center = world(design.w / 2, design.h / 2);
    const yawTo = (from: Vector3) => Math.atan2(center.x - from.x, center.z - from.z);
    const top = world(0, 44).z;
    table.layout({
      rig: {
        pitch: compact ? 1.24 : 1.08,
        frame: { x0: -design.w / 2 * K, x1: design.w / 2 * K, z0: top, z1: design.h / 2 * K },
        topPx: compact ? 30 : 44,
        bottomPx: 2,
        sidePx: 2,
        // 좌석 줄 아래는 늘 빈 펠트라, 폭에 맞춰 남는 세로는 딜러 쪽(위)에 준다 — 반씩 나누면 아래에 빈 띠가 컸다.
        spareAbove: 0.7,
      },
      feltCenterZ: world(0, feltMidY(design.h)).z,
      paint,
      props: {
        shoe: { x: shoe.x, z: shoe.z, yaw: yawTo(shoe) },
        tray: { x: tray.x, z: tray.z, yaw: yawTo(tray) },
        railZ: compact ? null : world(0, -6).z,
        visible: !compact,
        scale: 0.62,
      },
      bannerAt: () => world(design.w / 2, feltMidY(design.h) + 19),
      compactBanner: compact,
      mineOnly: true,
    });
    reflow(false);
    syncHuds(false);
    publishSeats();
  };

  /* ───────── 연출 ───────── */
  const findEntry = (entry: Entry): { model: HandModel | null; index: number } => {
    if (dealer.includes(entry)) return { model: null, index: dealer.indexOf(entry) };
    for (const model of hands.values()) {
      const index = model.entries.indexOf(entry);
      if (index >= 0) return { model, index };
    }
    return { model: null, index: -1 };
  };

  /** 새 카드 한 장. 연출 차례가 됐을 때 모델에서 지금 자리를 찾는다(그 사이 스플릿으로 옮겨졌을 수 있다). */
  const dealEntry = async (entry: Entry, requested: boolean) => {
    const where = findEntry(entry);
    if (where.index < 0) return;
    const isDealer = where.model === null;
    const c = await table.newCard(entry.card, isDealer ? DEALER_CARD_SCALE : SEAT_CARD_SCALE);
    entry.view = c;
    const slot = isDealer ? dealerTableSlot(where.index) : handSlot(where.model!, where.index);
    if (!table.live(requested)) {
      table.placeAt(c, slot, Boolean(entry.card));
      entry.pending = false;
      return;
    }
    if (isDealer) reflow(true);
    await table.dealTo(c, slot, { faceUp: Boolean(entry.card), ms: 420 });
    entry.pending = false;
    syncHuds(true);
  };

  /** 엎어 둔 딜러 카드가 공개됐다. */
  const revealHole = async (entry: Entry, card: Card, requested: boolean) => {
    entry.card = card;
    if (!entry.view) return;
    await table.setFace(entry.view, card);
    if (table.live(requested)) await table.flip(entry.view, 420);
    else entry.view.flipper.rotation.z = 0;
    syncHuds(table.live(requested));
  };

  const clearInsuranceGlow = () => {
    if (!insuranceGlow) return;
    insuranceGlow = false;
    void table.clearGlows(true);
    table.repaint();
  };

  const setPrints = (on: boolean) => {
    if (printsOn === on) return;
    printsOn = on;
    table.repaint();
  };

  const showResult = async (next: BlackjackStageState, requested: boolean) => {
    const animate = table.live(requested);
    clearInsuranceGlow();
    syncHuds(animate);
    // 딜러 점수·버스트·블랙잭은 딜러 자리(점수 방울·표시)에 있다 — 알약은 "결과"로 물러나고, 배너는 내 결과가
    // 나올 때만 뜬다(showMine). 같은 "딜러 18"이 알약·배너·방울에 세 번 떴다.
    setStatus("결과");
    // 내 손 중 이긴 손마다 빛을 둔다.
    for (const hand of next.hands.filter((h) => h.mine)) {
      if (hand.outcome !== "win" && hand.outcome !== "blackjack") continue;
      const model = hands.get(hand.handId);
      if (!model) continue;
      const mid = () => { const p = handPoint(model, Math.max(0, (model.entries.length - 1) / 2)); return world(p.x, p.y); };
      table.addGlow(mid, 150 * K * 1.6, 150 * K * 1.6, hand.outcome === "blackjack" ? GOLD : "#169f4a");
    }
    // 배너(내 결과)가 뜰 자리의 규칙 인쇄는 걷는다(반쯤 가려진 "DEALER STANDS [배너] NCE PAYS" 가 남았다).
    setPrints(false);
    if (animate) await table.wait(200);
  };

  const allViews = () => [...[...hands.values()].flatMap((model) => model.entries), ...dealer].map((entry) => entry.view).filter((c): c is Card3D => Boolean(c));

  const clearHuds = () => {
    for (const hud of huds.values()) dropHud(hud);
    huds.clear();
    dealerHud.bubble.hidden = true;
    setBadge(dealerHud, null, false);
  };

  const sweep = async (cards: Card3D[]) => {
    await Promise.all([table.clearGlows(true), table.hideBanner(true), table.sweepCards(cards)]);
    setPrints(true);
  };

  /* ───────── 스냅샷 비교 ───────── */
  const dealerTargets = (next: BlackjackStageState): Array<Card | null> => [
    ...next.dealerCards,
    ...(next.dealerHoleHidden && next.dealerHoleDealt ? [null] : []),
  ];

  /** 모델을 스냅샷 그대로 새로 만들고 모든 카드를 제자리에 바로 놓는다(처음 그릴 때·밀려 왔을 때). */
  const snapTo = (next: BlackjackStageState) => {
    // 이미 놓인 카드는 앞선 연출이 다 끝난 뒤(큐 차례)에 치운다. 날아가는 중인 카드를 지금 없애면 그
    // 트윈이 없어진 객체를 건드린다.
    const old = allViews();
    hands.clear();
    for (const hand of next.hands) hands.set(hand.handId, { hand, entries: hand.cards.map((card) => ({ card, view: null, pending: true })) });
    dealer = dealerTargets(next).map((card) => ({ card, view: null, pending: true }));
    const entries = [...[...hands.values()].flatMap((model) => model.entries), ...dealer];
    table.enqueue(async () => {
      for (const c of old) table.disposeCard(c);
      await Promise.all(entries.map((entry) => dealEntry(entry, false)));
      reflow(false);
      syncHuds(false);
    });
  };

  const statusForPhase = (next: BlackjackStageState) => {
    if (next.paused) return setStatus("테이블 일시정지", GOLD);
    if (next.phase === "WAITING") return setStatus(next.mySeat ? "다음 판을 기다리는 중" : "빈 좌석에 앉으면 시작합니다");
    if (next.phase === "LOCKED") return setStatus("베팅 마감", GOLD);
    if (next.phase === "DEALING") return setStatus("카드 배분 중");
    if (next.phase === "DEALER_TURN") return setStatus("딜러 차례");
    if (next.phase === "SETTLING") return setStatus("정산 중");
    return undefined;
  };

  const countdownFor = (next: BlackjackStageState) => {
    if (next.paused) return null;
    if (next.phase === "BETTING") return { endsAt: next.phaseEndsAt, durationMs: next.phaseDurationMs, label: "베팅하세요" };
    if (next.phase === "INSURANCE") return { endsAt: next.phaseEndsAt, durationMs: next.phaseDurationMs, label: "보험 받으시겠습니까" };
    if (next.phase === "PLAYER_TURN") {
      const mine = next.hands.some((hand) => hand.handId === next.activeHandId && hand.status === "playing");
      return { endsAt: next.phaseEndsAt, durationMs: next.phaseDurationMs, label: mine ? "내 차례" : "플레이어 차례" };
    }
    return null;
  };

  table.onResize(relayout);

  return {
    update(next) {
      const previous = state;
      state = next;
      const catchUp = firstUpdate;
      firstUpdate = false;
      table.setCountdown(countdownFor(next));
      drawLightning(next.lightning);
      // 좌석 표시(내 좌석 금색·앉은 좌석)와 보험 줄은 펠트 인쇄라, 바뀐 때만 다시 그린다.
      if (!previous || previous.mySeat !== next.mySeat || previous.occupied.join() !== next.occupied.join() || (previous.phase === "INSURANCE") !== (next.phase === "INSURANCE")) table.repaint();

      // 새 판(또는 판이 끝남): 이전 판 카드를 버림 패로 쓸어 낸다.
      if (next.roundId !== currentRound) {
        const views = allViews();
        currentRound = next.roundId;
        resultShownFor = null;
        resultQueuedFor = null;
        hands.clear();
        dealer = [];
        clearHuds();
        insuranceGlow = false;
        if (views.length > 0) {
          if (catchUp) {
            for (const c of views) table.disposeCard(c);
            void table.clearGlows(false);
            void table.hideBanner(false);
            setPrints(true);
          } else table.enqueue(() => sweep(views));
        }
      }
      if (previous?.phase !== next.phase || previous?.paused !== next.paused) statusForPhase(next);

      // 보험 순간: 딜러의 A 위로 금빛. 끝나면 거둔다.
      if (next.phase === "INSURANCE" && !insuranceGlow) {
        insuranceGlow = true;
        table.enqueue(() => { table.addGlow(() => { const p = dealerPoint(0); return world(p.x, p.y); }, 220 * K * 1.6, 170 * K * 1.6, GOLD); });
      } else if (next.phase !== "INSURANCE" && insuranceGlow) {
        table.enqueue(clearInsuranceGlow);
      }

      if (catchUp) {
        snapTo(next);
      } else {
        // 손마다 카드를 맞춘다. 자리를 잃은 카드(스플릿으로 옮겨 간 둘째 장)는 같은 좌석의 같은 카드가 필요한
        // 자리에서 다시 쓴다.
        const fresh: Array<{ entry: Entry; seatNumber: number | null; handIndex: number; index: number }> = [];
        const orphans = new Map<number, Entry[]>();
        const nextIds = new Set(next.hands.map((hand) => hand.handId));
        const seatsWithHands = new Set([...hands.values()].map((model) => model.hand.seatNumber));
        for (const [handId, model] of hands) {
          const target = next.hands.find((hand) => hand.handId === handId);
          const keep: Entry[] = [];
          model.entries.forEach((entry, index) => {
            if (target && sameCard(entry.card, target.cards[index])) keep[index] = entry;
            else orphans.set(model.hand.seatNumber, [...(orphans.get(model.hand.seatNumber) ?? []), entry]);
          });
          model.entries = keep;
          if (!nextIds.has(handId)) hands.delete(handId);
        }
        let moved = false;
        for (const hand of next.hands) {
          let model = hands.get(hand.handId);
          if (!model) {
            model = { hand, entries: [] };
            hands.set(hand.handId, model);
            // 이미 손이 있던 좌석에 손이 하나 더 생겼다 = 스플릿. 원래 손을 옆으로 비켜 놓는다.
            if (seatsWithHands.has(hand.seatNumber)) moved = true;
          }
          model.hand = hand;
          const entries: Entry[] = [];
          hand.cards.forEach((card, index) => {
            const existing = model!.entries[index];
            if (existing) { entries[index] = existing; return; }
            const pool = orphans.get(hand.seatNumber) ?? [];
            const reuse = pool.findIndex((entry) => sameCard(entry.card, card));
            if (reuse >= 0) {
              entries[index] = pool.splice(reuse, 1)[0]!;
              moved = true;
              return;
            }
            const entry: Entry = { card, view: null, pending: true };
            entries[index] = entry;
            fresh.push({ entry, seatNumber: hand.seatNumber, handIndex: hand.handIndex, index });
          });
          model.entries = entries;
        }
        const leftovers = [...orphans.values()].flat().map((entry) => entry.view).filter((c): c is Card3D => Boolean(c));

        // 딜러: 엎어 둔 카드가 공개되면 뒤집고, 새 카드는 날려 보낸다.
        const targets = dealerTargets(next);
        const reveals: Array<{ entry: Entry; card: Card }> = [];
        targets.forEach((card, index) => {
          const existing = dealer[index];
          if (existing) {
            if (!existing.card && card) reveals.push({ entry: existing, card });
            return;
          }
          const entry: Entry = { card, view: null, pending: true };
          dealer[index] = entry;
          fresh.push({ entry, seatNumber: null, handIndex: 0, index });
        });
        dealer.length = targets.length;

        if (fresh.length > 3) {
          table.enqueue(async () => { for (const c of leftovers) table.disposeCard(c); });
          snapTo(next);
        } else {
          if (leftovers.length) table.enqueue(async () => { for (const c of leftovers) table.disposeCard(c); });
          if (moved) table.enqueue(async () => { reflow(true); syncHuds(true); await table.wait(260); });
          for (const reveal of reveals) table.enqueue(() => revealHole(reveal.entry, reveal.card, true));
          for (const step of dealOrder(fresh)) table.enqueue(() => dealEntry(step.entry, true));
          table.enqueue(() => { syncHuds(true); });
        }
      }

      // 결과: 손마다 결과가 붙은 첫 스냅샷에서, 앞선 카드 연출이 다 끝난 뒤에 보여 준다.
      const settled = next.hands.some((hand) => hand.outcome);
      if (settled && next.roundId && resultQueuedFor !== next.roundId) {
        const roundId = next.roundId;
        resultQueuedFor = roundId;
        const copy = next;
        const requested = !catchUp;
        table.enqueue(async () => {
          resultShownFor = roundId;
          await showResult(copy, requested);
          sounds.resultShown?.(roundId);
        });
      }
    },
    showMine: (result) => table.showMine(result),
    destroy() {
      seatLayoutStore.clear(table);
      table.destroy();
    },
  };
}
