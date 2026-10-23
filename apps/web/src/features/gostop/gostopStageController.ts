import { Container, Graphics, Sprite } from "pixi.js";
import { CardView, createStageCore, easeBack, easeIn, easeInOut, type CardDeps, type StageControllerBase, type StageSounds } from "../stage/core";
import { TEX_H, TEX_W, backTexture, deckTexture, faceTexture } from "../stage/hwatu";
import {
  CAPTURED_KINDS, DOCK_INSET, GOSTOP_LAYOUT_EVENT, HWATU, backSlot, capturedSlots, gostopCompactSize, gostopGeometry, gostopHeight, gostopMode, handSlot, modeOf,
  type CapturedKind, type GostopFrame, type GostopGeometry, type Slot,
} from "./gostopLayout";

/**
 * 맞고(고스톱) 캔버스 판 — 섯다 v6 와 같은 틀. 그리는 것: 담요, 더미, 바닥(월마다 정해진 자리), 내 손패(앞면),
 * 상대 손패(뒷면 묶음), 먹은 패(자리마다 광·열끗·띠·피 한 줄), 결과 배너, 차례 시계. 이름표·점수·버튼·
 * 고르는 창은 DOM 층이 같은 배치 계산으로 올라탄다.
 *
 * 패는 id 로 따라간다. 자리가 바뀐 패만 미끄러지고(뛰지 않는다), 한 수(lastMove)는 순서대로 보여 준다:
 * 낸 패가 바닥 그 월 자리로 → 더미에서 뒤집은 패가 → 먹은 패가 먹은 사람 줄로.
 */

export interface GostopCard { id: string; month: number; kind: CapturedKind; tags: string[] }

export interface GostopStageSeat {
  seatNumber: number;
  rel: number;
  handCount: number;
  /** 내 손패만(앞면). 상대는 null. */
  hand: GostopCard[] | null;
  captured: Record<CapturedKind, GostopCard[]>;
  /** 광을 판 자리(3인) — 흐리게. */
  dim: boolean;
}

export interface GostopStageState {
  roundId: string | null;
  players: number;
  seats: GostopStageSeat[];
  board: GostopCard[];
  stockCount: number;
  /** 방금 한 수. key 가 바뀌면 새 수다. pending 이면 고르는 중이라 낸 패·뒤집은 패가 바닥 위에 떠 있다. */
  move: { key: string; seatNumber: number; played: GostopCard[]; flipped: GostopCard | null; pending: boolean } | null;
  /** 내가 고를 바닥 패(금테). */
  choiceIds: string[];
  timer: { endsAt: string | null; durationMs: number | null } | null;
  result: { key: string; head: string; sub: string; winnerSeats: number[]; nagari: boolean } | null;
  /** 판 가운데 크게 터지는 사건 외침(뻑!·따닥!·싹쓸이!). key 가 바뀔 때 한 번. */
  cutIn: { key: string; text: string } | null;
}

export interface GostopStageController extends StageControllerBase<GostopStageState> {}

type Hwatu = CardView<GostopCard>;
const GOLD = 0xffd24a;
const TAG: Array<[string, string]> = [["kukjin", "국"], ["ssangpi", "쌍"], ["bi", "비"]];
const tagOf = (card: GostopCard) => TAG.find(([tag]) => card.tags.includes(tag))?.[1] ?? null;
const faceOf = (card: GostopCard) => faceTexture(card, tagOf(card));

type Zone = "hand" | "board" | "cap" | "float";
interface Target { slot: Slot; zone: Zone; owner: number; face: boolean }

/**
 * @param initialPlayers 방 인원(2·3). 방마다 고정이라 처음부터 받는다 — 2 로 시작해 첫 스냅샷에서 바꾸면, 개발 모드
 *   StrictMode 가 버린 판이 늦게 뜨며 쏜 2인 배치 이벤트가 마지막으로 남아 3인 판의 세 번째 자리가 내 자리에 겹쳤다.
 */
export async function createGostopStage(host: HTMLElement, sounds: StageSounds = {}, initialPlayers = 2): Promise<GostopStageController> {
  let players = initialPlayers;
  let coreRef: { compact: () => boolean; designW: () => number; designH: () => number } | null = null;
  const geometryFor = (): GostopGeometry => (coreRef
    ? gostopGeometry(modeOf(coreRef.compact(), coreRef.designH()), coreRef.designW(), coreRef.designH(), players)
    : gostopGeometry("wide", 640, 480, players));
  const core = await createStageCore(host, sounds, {
    // 화투판은 섯다와 같은 군용 담요(짙은 올리브) — 같은 화투 게임끼리 판 색이 달랐다. 인쇄·곡선 없음.
    felt: { inner: "#5d6a36", mid: "#434d24", outer: "#1d2210", arc: false },
    minW: 640,
    height: (w, h) => gostopHeight(w, h, host.clientHeight),
    compact: gostopCompactSize,
    bannerY: () => geometryFor().banner.y,
    props: false,
    status: false,
    insets: () => ({ top: 0, bottom: DOCK_INSET[gostopMode(host.clientWidth, host.clientHeight)] }),
    timerScale: 0.56,
    name: "gostop",
  });
  coreRef = core;
  const { tween, wait, layers } = core;
  const [back, deckArt] = await Promise.all([backTexture(), deckTexture()]);
  let geo = geometryFor();

  /* 더미 */
  const stock = new Container();
  const stockArt = new Sprite(deckArt.texture);
  stockArt.anchor.set(deckArt.anchor.x, deckArt.anchor.y);
  stockArt.scale.set(HWATU.w / TEX_W);
  const stockCount = core.text("", 13, 0xffe9b0);
  stockCount.anchor.set(0.5);
  stock.addChild(stockArt);
  layers.table.addChild(stock);
  layers.table.addChild(stockCount);

  const deps: CardDeps = {
    tween, wait, sounds, back,
    size: { w: HWATU.w, h: HWATU.h, texW: TEX_W, texH: TEX_H },
    thickness: 2,
    pullFromShoe: async () => ({ x: geo.stock.x, y: geo.stock.y, r: 0, s: geo.stock.s }),
  };

  /** 앞면 패: id → 그림. */
  const views = new Map<string, Hwatu>();
  /** 상대 손패 뒷면 묶음: 자리 → 뒷면들. */
  const backs = new Map<number, Hwatu[]>();
  const outlines = new WeakMap<Hwatu, Graphics>();
  let state: GostopStageState | null = null;
  let first = true;
  let roundId: string | null = null;
  let moveKey: string | null = null;
  let resultKey: string | null = null;
  let targets = new Map<string, Target>();

  const outlineOf = (view: Hwatu) => {
    let g = outlines.get(view);
    if (!g) {
      g = new Graphics().roundRect(-HWATU.w / 2 - 3, -HWATU.h / 2 - 3, HWATU.w + 6, HWATU.h + 6, 7).stroke({ width: 3.5, color: GOLD });
      g.visible = false;
      view.addChild(g);
      outlines.set(view, g);
    }
    return g;
  };

  /** 이 상태에서 앞면 패마다 있어야 할 자리. */
  const computeTargets = (next: GostopStageState): Map<string, Target> => {
    const out = new Map<string, Target>();
    const byMonth = new Map<number, number>();
    for (const card of next.board) {
      const index = byMonth.get(card.month) ?? 0;
      byMonth.set(card.month, index + 1);
      out.set(card.id, { slot: geo.board.slot(card.month, index), zone: "board", owner: 0, face: true });
    }
    for (const seat of next.seats) {
      const spot = geo.seat(seat.rel);
      if (seat.hand) seat.hand.forEach((card, index, list) => out.set(card.id, { slot: handSlot(spot, index, list.length), zone: "hand", owner: seat.seatNumber, face: true }));
      const counts = Object.fromEntries(CAPTURED_KINDS.map((kind) => [kind, seat.captured[kind].length])) as Record<CapturedKind, number>;
      const layout = capturedSlots(spot, counts);
      for (const kind of CAPTURED_KINDS) seat.captured[kind].forEach((card, index) => out.set(card.id, { slot: layout.slot(kind, index), zone: "cap", owner: seat.seatNumber, face: true }));
    }
    // 고르는 중: 낸 패·뒤집은 패는 아직 어디에도 없다 — 그 월 자리 위에 살짝 들려 떠 있게.
    if (next.move?.pending) {
      for (const card of [...next.move.played, ...(next.move.flipped ? [next.move.flipped] : [])]) {
        if (out.has(card.id)) continue;
        const index = byMonth.get(card.month) ?? 0;
        byMonth.set(card.month, index + 1);
        const slot = geo.board.slot(card.month, index);
        out.set(card.id, { slot: { ...slot, y: slot.y - 10 * slot.s }, zone: "float", owner: next.move.seatNumber, face: true });
      }
    }
    return out;
  };

  const place = (view: Hwatu, slot: Slot) => {
    view.place(slot);
    view.scale.set(slot.s);
  };

  /** 미끄러지기: 떠오르지 않는다(섯다에서 배운 것 — 갱신마다 폴짝거리면 산만하다). 이미 그 자리면 그대로. */
  const slide = (view: Hwatu, slot: Slot, ms = 260) => {
    if (Math.abs(view.x - slot.x) < 0.5 && Math.abs(view.y - slot.y) < 0.5 && Math.abs(view.scale.x - slot.s) < 0.005) return Promise.resolve();
    const x0 = view.x;
    const y0 = view.y;
    const r0 = view.rotation;
    const s0 = view.scale.x;
    return tween(ms, (p) => {
      view.x = x0 + (slot.x - x0) * p;
      view.y = y0 + (slot.y - y0) * p;
      view.rotation = r0 + (slot.r - r0) * p;
      view.scale.set(s0 + (slot.s - s0) * p);
    }, easeInOut);
  };

  /** 한 장을 어디서(더미·상대 손) 뒤집으며 날려 온다. */
  const flyIn = async (view: Hwatu, from: Slot, to: Slot, faceUp: boolean, ms = 380) => {
    view.visible = true;
    view.showBack();
    place(view, from);
    let flipped = false;
    await tween(ms, (p) => {
      view.x = from.x + (to.x - from.x) * p;
      view.y = from.y + (to.y - from.y) * p - Math.sin(p * Math.PI) * 18;
      view.rotation = from.r + (to.r - from.r) * p;
      view.scale.set(from.s + (to.s - from.s) * p);
      if (faceUp) {
        const f = Math.max(0, Math.min(1, (p - 0.25) / 0.6));
        if (f >= 0.5 && !flipped) { flipped = true; view.showFace(); sounds.flip?.(); }
        view.turn(f);
        view.glint(f < 0.5 ? -1 : (f - 0.5) * 1.6);
        view.apply();
      }
    }, easeInOut);
    if (faceUp && !flipped) view.showFace();
    view.turn(0);
    view.glint(-1);
    view.apply();
    place(view, to);
  };

  /**
   * 바닥에 "딱" 내려치기: 한 치수 크게 떠 있던 패가 판에 눌려 붙고(그림자가 조여 든다), 그 자리에 둥근 파동이
   * 한 번 번진다. 낸 패·뒤집은 패가 바닥 월 자리에 닿을 때만.
   */
  const slam = async (view: Hwatu) => {
    const s = view.scale.x;
    const ring = new Graphics();
    ring.position.set(view.x, view.y);
    layers.table.addChildAt(ring, 0);
    void tween(360, (p) => {
      ring.clear();
      ring.ellipse(0, 0, HWATU.w * s * (0.5 + p * 0.9), HWATU.h * s * (0.42 + p * 0.55)).stroke({ color: 0xfff1cf, width: 3 * (1 - p) + 0.5, alpha: 0.55 * (1 - p) });
    }).then(() => ring.destroy());
    await tween(110, (p) => {
      view.scale.set(s * (1.08 - 0.08 * p));
      view.lift = 8 * (1 - p);
      view.apply();
    }, easeIn);
    view.lift = 0;
    view.apply();
  };

  /** 사건 외침: 더미 위로 굵은 금빛 글자가 튀어 올랐다가(살짝 넘치게 커졌다 자리 잡고) 위로 빠지며 사라진다. */
  const showCutIn = async (text: string) => {
    const label = core.text(text, 58, 0xffe08a, '"Noto Sans KR", sans-serif', {
      fontWeight: "900",
      stroke: { color: 0x3b1d00, width: 9, join: "round" },
      dropShadow: { color: 0x000000, alpha: 0.55, blur: 8, distance: 4, angle: Math.PI / 2 },
    });
    label.position.set(geo.stock.x, geo.stock.y - HWATU.h * geo.stock.s * 0.2);
    layers.fx.addChild(label);
    await tween(260, (p) => { label.alpha = Math.min(1, p * 2); label.scale.set(0.4 + 0.6 * p); }, easeBack);
    await wait(620);
    const y0 = label.y;
    await tween(300, (p) => { label.alpha = 1 - p; label.y = y0 - 18 * p; });
    label.destroy();
  };
  let cutInKey: string | null = null;

  const newView = async (card: GostopCard) => {
    const view = new CardView<GostopCard>(deps, card, await faceOf(card), 1);
    view.settled = true;
    layers.table.addChild(view);
    views.set(card.id, view);
    return view;
  };

  const drop = (view: Hwatu) => { view.destroy({ children: true }); };

  /** 판 위 모든 패를 더미로 걷는다(새 판). */
  const sweep = async (animate: boolean) => {
    const all = [...views.values(), ...[...backs.values()].flat()];
    views.clear();
    backs.clear();
    if (!animate) { all.forEach(drop); return; }
    const to: Slot = { x: geo.stock.x, y: geo.stock.y, r: 0, s: geo.stock.s };
    await Promise.all(all.map((view, i) => wait(Math.min(i, 30) * 14).then(async () => {
      if (view.face.visible) view.showBack();
      await slide(view, to, 320);
      drop(view);
    })));
  };

  /** 상대 뒷면 묶음을 장수에 맞춘다. 줄어든 장은 돌려준다(그 자리에서 낸 패가 출발한다). */
  const syncBacks = (next: GostopStageState, animate: boolean): Map<number, Slot> => {
    const origins = new Map<number, Slot>();
    for (const seat of next.seats) {
      if (seat.hand) continue;
      const list = backs.get(seat.seatNumber) ?? [];
      backs.set(seat.seatNumber, list);
      const spot = geo.seat(seat.rel);
      const count = Math.min(seat.handCount, 10);
      while (list.length > count) {
        const gone = list.pop()!;
        origins.set(seat.seatNumber, { x: gone.x, y: gone.y, r: gone.rotation, s: gone.scale.x });
        drop(gone);
      }
      while (list.length < count) {
        const view = new CardView<GostopCard>(deps, null, null, 1);
        view.settled = true;
        layers.table.addChild(view);
        const slot = backSlot(spot, list.length, count);
        if (animate) { place(view, { x: geo.stock.x, y: geo.stock.y, r: 0, s: geo.stock.s }); }
        else place(view, slot);
        list.push(view);
      }
      list.forEach((view, index) => { if (!animate) place(view, backSlot(spot, index, list.length)); else void slide(view, backSlot(spot, index, list.length), 320); });
      if (!origins.has(seat.seatNumber) && list.length > 0) {
        const last = list[list.length - 1]!;
        origins.set(seat.seatNumber, { x: last.x, y: last.y, r: 0, s: last.scale.x });
      }
    }
    for (const [seatNumber, list] of backs) {
      if (next.seats.some((seat) => seat.seatNumber === seatNumber && !seat.hand)) continue;
      list.forEach(drop);
      backs.delete(seatNumber);
    }
    return origins;
  };

  const styleAll = (next: GostopStageState) => {
    const dimSeats = new Set(next.seats.filter((seat) => seat.dim).map((seat) => seat.seatNumber));
    for (const [id, view] of views) {
      const target = targets.get(id);
      const chosen = next.choiceIds.includes(id);
      if (chosen || outlines.has(view)) outlineOf(view).visible = chosen;
      view.alpha = target && target.zone === "cap" && dimSeats.has(target.owner) ? 0.45 : 1;
    }
    stockCount.text = next.stockCount > 0 ? String(next.stockCount) : "";
    stock.visible = next.stockCount > 0;
  };

  const placeAll = () => {
    if (!state) return;
    targets = computeTargets(state);
    for (const [id, view] of views) {
      const target = targets.get(id);
      if (target) place(view, target.slot);
    }
    for (const seat of state.seats) {
      const list = backs.get(seat.seatNumber);
      if (!list) continue;
      const spot = geo.seat(seat.rel);
      list.forEach((view, index) => place(view, backSlot(spot, index, list.length)));
    }
  };

  const liveFrame = (): GostopFrame => ({ mode: geo.mode, designW: geo.w, designH: geo.h, players, scale: core.root.scale.x, x: core.root.x, y: core.root.y });
  Object.assign(host, { stageFrame: liveFrame });

  core.onLayout(() => {
    geo = geometryFor();
    host.dispatchEvent(new CustomEvent(GOSTOP_LAYOUT_EVENT, { bubbles: true, detail: liveFrame() }));
    stock.position.set(geo.stock.x, geo.stock.y);
    stock.scale.set(geo.stock.s);
    stockCount.position.set(geo.stock.x, geo.stock.y + (HWATU.h * geo.stock.s) / 2 + 12);
    if (geo.timer) core.placeBetTimer(geo.timer.x, geo.timer.y);
    try { placeAll(); } catch (error) { console.error("gostop stage layout", error); }
  });

  core.onTick(() => {
    core.drawBetTimer(state?.timer && geo.timer ? state.timer : null);
  });

  const apply = async (next: GostopStageState) => {
    const animate = core.live(!first) && pending === null;
    const wasFirst = first;
    first = false;
    if (next.players !== players) { players = next.players; core.relayout(); }

    // 새 판(또는 판이 끝나 비워짐): 걷고 다시 돌린다.
    const emptied = next.board.length === 0 && next.seats.every((seat) => seat.handCount === 0 && CAPTURED_KINDS.every((kind) => seat.captured[kind].length === 0));
    if ((roundId !== null && next.roundId !== roundId) || (emptied && views.size > 0)) await sweep(animate);
    const dealing = roundId !== next.roundId && next.roundId !== null && animate && !wasFirst;
    roundId = next.roundId;
    state = next;

    const prevTargets = targets;
    targets = computeTargets(next);
    const newMove = next.move && next.move.key !== moveKey ? next.move : null;
    moveKey = next.move?.key ?? null;

    // 그림 먼저(처음 보는 패만 실제로 기다린다).
    const known = [...targets.keys()].filter((id) => !views.has(id));
    const cardById = new Map<string, GostopCard>();
    for (const card of next.board) cardById.set(card.id, card);
    for (const seat of next.seats) {
      for (const card of seat.hand ?? []) cardById.set(card.id, card);
      for (const kind of CAPTURED_KINDS) for (const card of seat.captured[kind]) cardById.set(card.id, card);
    }
    for (const card of [...(next.move?.played ?? []), ...(next.move?.flipped ? [next.move.flipped] : [])]) cardById.set(card.id, card);
    await Promise.all(known.map((id) => { const card = cardById.get(id); return card ? faceOf(card) : null; }));

    const backOrigins = syncBacks(next, animate);

    // 사라진 패(판 밖으로 — 보통 새 판 전 비울 때): 조용히 치운다.
    for (const [id, view] of views) {
      if (targets.has(id)) continue;
      views.delete(id);
      if (animate) void slide(view, { x: geo.stock.x, y: geo.stock.y, r: 0, s: geo.stock.s }, 300).then(() => drop(view));
      else drop(view);
    }

    const jobs: Array<Promise<void>> = [];
    if (dealing) {
      // 처음 돌리기: 바닥 → 손패 순으로 더미에서 한 장씩(앞면을 아는 패는 뒤집으며).
      const order = [...next.board.map((card) => card.id), ...next.seats.flatMap((seat) => (seat.hand ?? []).map((card) => card.id))];
      let i = 0;
      for (const id of order) {
        const target = targets.get(id);
        const card = cardById.get(id);
        if (!target || !card) continue;
        const view = await newView(card);
        view.visible = false;
        const delay = i * 55;
        i += 1;
        jobs.push(wait(delay).then(() => flyIn(view, { x: geo.stock.x, y: geo.stock.y, r: 0, s: geo.stock.s }, target.slot, true, 340)));
      }
    } else {
      const moved = new Set([...(newMove?.played ?? []), ...(newMove?.flipped ? [newMove.flipped] : [])].map((card) => card.id));
      /** 한 수의 무대: 0 낸 패 · 1 뒤집은 패 · 2 먹은 패가 줄로 · 3 뺏은 피. */
      const STAGE_MS = [0, 380, 820, 1150];
      for (const [id, target] of targets) {
        const card = cardById.get(id);
        if (!card) continue;
        const before = prevTargets.get(id);
        let view = views.get(id);
        const isPlayed = Boolean(newMove?.played.some((c) => c.id === id));
        const isFlipped = newMove?.flipped?.id === id;
        // 바닥에 내려앉을 자리: 끝내 먹힌 패도 먼저 그 월 자리 위에 내려앉았다가 줄로 간다.
        const landing = (): Slot => {
          if (target.zone === "board" || target.zone === "float") return target.slot;
          const center = geo.board.center(card.month);
          return { x: center.x + 6, y: center.y - 6, r: 0, s: geo.board.s };
        };
        if (!view) {
          view = await newView(card);
          if (!animate) { place(view, target.slot); view.showFace(); continue; }
          if (isPlayed || isFlipped) {
            const from: Slot = isFlipped
              ? { x: geo.stock.x, y: geo.stock.y, r: 0, s: geo.stock.s }
              : backOrigins.get(newMove!.seatNumber) ?? { x: geo.stock.x, y: geo.stock.y, r: 0, s: geo.stock.s };
            const land = landing();
            const v = view;
            v.visible = false;
            jobs.push(wait(isFlipped ? STAGE_MS[1]! : STAGE_MS[0]!).then(async () => {
              await flyIn(v, from, land, true, 380);
              await slam(v);
              if (target.zone === "cap") { await wait(Math.max(0, STAGE_MS[2]! - (isFlipped ? STAGE_MS[1]! : 0) - 490)); await slide(v, target.slot, 340); }
            }));
          } else {
            // 판 중간에 들어왔거나 처음 보는 패: 제자리에.
            place(view, target.slot);
            view.showFace();
          }
          continue;
        }
        view.showFace();
        if (!animate) { place(view, target.slot); continue; }
        if (before && before.zone === target.zone && before.owner === target.owner) {
          // 같은 곳 안에서 줄이 바뀜: 손패는 낸 자리를 바로 메우고, 먹은 패 줄은 먹은 패가 도착할 때 같이 넓힌다.
          jobs.push(wait(newMove && target.zone === "cap" ? STAGE_MS[2]! : 0).then(() => slide(view!, target.slot)));
          continue;
        }
        const v = view;
        if (isPlayed && before?.zone === "hand") {
          // 내 손에서 낸 패: 바닥 그 월 자리로, 먹혔으면 이어서 줄로.
          const land = landing();
          jobs.push((async () => {
            await slide(v, land, 300);
            await slam(v);
            if (target.zone === "cap") { await wait(STAGE_MS[2]! - 410); await slide(v, target.slot, 340); }
          })());
        } else if (target.zone === "cap" && before?.zone === "cap") {
          jobs.push(wait(STAGE_MS[3]!).then(() => slide(v, target.slot, 360)));
        } else if (target.zone === "cap") {
          jobs.push(wait(moved.size > 0 ? STAGE_MS[2]! : 0).then(() => slide(v, target.slot, 340)));
        } else {
          jobs.push(slide(v, target.slot));
        }
      }
    }
    styleAll(next);

    // 사건 외침: 먹은 패가 줄로 들어가는 무렵(한 수의 셋째 무대)에 터뜨린다. 처음 그리는 스냅샷은 지난 일이라 조용히.
    if (next.cutIn?.key !== cutInKey) {
      cutInKey = next.cutIn?.key ?? null;
      if (next.cutIn && animate) void wait(newMove ? 820 : 0).then(() => showCutIn(next.cutIn!.text));
    }

    // 결과
    const key = next.result?.key ?? null;
    if (key !== resultKey) {
      resultKey = key;
      if (next.result) {
        void core.showBanner(next.result.head, next.result.sub, next.result.nagari ? 0x9aa7ff : GOLD, animate);
        if (roundId) sounds.resultShown?.(roundId);
      } else {
        void core.hideBanner(animate);
      }
    }
    await Promise.all(jobs);
  };

  let pending: GostopStageState | null = null;
  let running = false;
  const drain = async () => {
    running = true;
    while (pending) {
      const next = pending;
      pending = null;
      try { await apply(next); } catch (error) { console.error("gostop stage", error); }
    }
    running = false;
  };

  core.start();
  return {
    update(next: GostopStageState) {
      pending = next;
      if (!running) void drain();
    },
    destroy() {
      if ((host as { stageFrame?: unknown }).stageFrame === liveFrame) delete (host as { stageFrame?: unknown }).stageFrame;
      core.destroy();
    },
  };
}
