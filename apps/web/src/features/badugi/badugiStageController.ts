import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { Card } from "@opencasino/contracts";
import { chipTier } from "../../lib/betting";
import { chipBreakdown, chipLayerUrl } from "../../lib/chipArt";
import { CardView, NUM_FONT, createStageCore, easeIn, easeInOut, faceTexture, type CardDeps, type StageControllerBase, type StageSounds } from "../stage/core";
import { loadImage } from "../stage/hwatu";
import { BADUGI_LAYOUT_EVENT, CARD, DOCK_INSET, badugiCompactSize, badugiGeometry, badugiHeight, badugiMode, cardSlot, modeOf, type BadugiFrame, type BadugiGeometry, type Point, type Slot } from "./badugiLayout";

/**
 * 바둑이 캔버스 판 — 홀덤 v6 와 같은 틀. 그리는 것: 담요, 자리마다 4장(내 것·쇼다운은 앞면), 가운데 팟 칩 더미와
 * 금액, 그 양옆의 덱(엎은 더미)과 버림 더미, 결과 배너·승자 빛, 차례 시계. 이름표·배지·버튼은 DOM 층.
 *
 * 카드는 판(roundId)이 바뀔 때만 새로 돈다. 교체가 끝나면(draws 가 늘면) 바꾼 자리의 카드만 버림 더미로 날아가고
 * 그 자리에 새 카드가 덱에서 날아온다 — 내 패는 바뀐 카드를 정확히 알고, 상대는 장수만 알아서 뒤쪽 자리부터.
 * 쇼다운에 앞면을 새로 알게 된 카드는 그 자리에서 뒤집힌다.
 */

export interface BadugiStageSeat {
  seatNumber: number;
  rel: number;
  dealSlot: number;
  /** 들고 있는 장수(0 이면 이번 판에 없다). */
  cardCount: number;
  /** 앞면을 아는 카드(내 것, 쇼다운의 공개). */
  cards: Card[] | null;
  /** 이번 판에 끝난 교체마다 바꾼 장수. 늘어나면 교체 연출을 한다. */
  draws: number[];
  dim: "none" | "folded" | "lost";
  /** 묶음에서 빠진 죽은 패(rank+suit) — 어둡게. */
  dead: string[];
}

export interface BadugiStageState {
  roundId: string | null;
  seats: BadugiStageSeat[];
  pot: number;
  timer: { endsAt: string | null; durationMs: number | null } | null;
  result: { key: string; head: string; sub: string; winnerSeats: number[] } | null;
}

export interface BadugiStageController extends StageControllerBase<BadugiStageState> {}

type View = CardView<Card>;
const GOLD = 0xffd24a;
const CHIP = 22;
const CHIP_STEP = 3;
const CHIP_DENOMS = [1000, 500, 100, 50, 10, 5, 1];
const DEAD_TINT = 0x6a6a6a;
const keyOf = (card: Card) => `${card.rank}${card.suit}`;

const chipTextures = new Map<number, Promise<Texture>>();
function chipTexture(tier: number): Promise<Texture> {
  let promise = chipTextures.get(tier);
  if (!promise) {
    promise = loadImage(chipLayerUrl(tier)).then((image) => (image ? Texture.from(image) : Texture.WHITE));
    chipTextures.set(tier, promise);
  }
  return promise;
}
function chipsFor(amount: number, min: number, max: number): number[] {
  const chips = chipBreakdown(amount, CHIP_DENOMS, max);
  const smaller = (value: number) => CHIP_DENOMS.find((d) => d < value && value % d === 0);
  while (chips.length < min) {
    const index = chips.findIndex((value) => smaller(value) !== undefined);
    if (index < 0) break;
    const value = chips[index]!;
    const d = smaller(value)!;
    chips.splice(index, 1, ...Array.from({ length: value / d }, () => d));
  }
  return chips.slice(0, max);
}
function chipStacks(chips: number[], perStack: number): number[][] {
  const stacks: number[][] = [];
  for (const value of chips) {
    const last = stacks[stacks.length - 1];
    if (last && last[0] === value && last.length < perStack) last.push(value);
    else stacks.push([value]);
  }
  return stacks;
}

export async function createBadugiStage(host: HTMLElement, sounds: StageSounds = {}): Promise<BadugiStageController> {
  let coreRef: { compact: () => boolean; designW: () => number; designH: () => number } | null = null;
  const geometryFor = (): BadugiGeometry => (coreRef
    ? badugiGeometry(modeOf(coreRef.compact(), coreRef.designH()), coreRef.designW(), coreRef.designH())
    : badugiGeometry("wide", 640, 460));
  const core = await createStageCore(host, sounds, {
    // 바둑이 담요: 짙은 남청색 — 초록 홀덤판·올리브 섯다 담요와 한눈에 갈린다.
    felt: { inner: "#1f4a63", mid: "#143548", outer: "#06141d", arc: false },
    minW: 640,
    height: (w, h) => badugiHeight(w, h, host.clientHeight),
    compact: badugiCompactSize,
    bannerY: () => geometryFor().banner.y,
    props: false,
    status: false,
    insets: () => ({ top: 0, bottom: DOCK_INSET[badugiMode(host.clientWidth, host.clientHeight)] }),
    timerScale: 0.56,
    name: "badugi",
  });
  coreRef = core;
  const { tween, wait, layers } = core;
  const chipTex = await Promise.all([0, 1, 2, 3, 4].map(chipTexture));
  let geo = geometryFor();
  const pileScale = () => (geo.mode === "wide" ? 0.4 : 0.34);

  const deps: CardDeps = {
    tween, wait, sounds, back: core.back,
    pullFromShoe: async () => ({ x: geo.deck.x, y: geo.deck.y, r: 0, s: pileScale() }),
  };

  /* 덱(엎은 더미)과 버림 더미 — 판 위의 소품. 버림 더미는 이번 판에 버린 장수만큼 겹이 는다. */
  const pileCard = () => {
    const card = new Sprite(core.back);
    card.anchor.set(0.5);
    card.width = CARD.w;
    card.height = CARD.h;
    return card;
  };
  const deck = new Container();
  for (let i = 0; i < 4; i += 1) {
    const layer = new Container();
    layer.addChild(new Graphics().roundRect(-CARD.w / 2 + 2, -CARD.h / 2 + 3, CARD.w, CARD.h, 6).fill({ color: 0x000000, alpha: 0.35 }), pileCard());
    layer.position.set(-i * 1.5, -i * 2.5);
    deck.addChild(layer);
  }
  const muck = new Container();
  layers.table.addChild(deck, muck);
  let mucked = 0;
  const MUCK_TILT = [0.18, -0.12, 0.3, -0.26, 0.08, -0.04, 0.22];
  const renderMuck = () => {
    const want = Math.min(7, Math.ceil(mucked / 2));
    while (muck.children.length > want) muck.removeChildAt(muck.children.length - 1).destroy({ children: true });
    while (muck.children.length < want) {
      const i = muck.children.length;
      const card = pileCard();
      card.rotation = MUCK_TILT[i % MUCK_TILT.length]!;
      card.position.set((i % 3) * 3 - 3, -i * 1.5);
      muck.addChild(card);
    }
  };

  /* 팟: 칩 더미 + 금액 알약 */
  const pile = new Container();
  const potPill = new Container();
  const potPillBg = new Graphics();
  const potText = core.text("", 14, 0xffd28a, NUM_FONT);
  potPill.addChild(potPillBg, potText);
  layers.table.addChild(pile, potPill);
  const drawPotPill = () => {
    const w = potText.width + 24;
    potPillBg.clear().roundRect(-w / 2, -11, w, 22, 11).fill({ color: 0x0a0806, alpha: 0.72 }).stroke({ width: 1, color: 0xf0b41c, alpha: 0.45 });
  };

  const views = new Map<number, View[]>();
  /** 자리마다 지금까지 연출한 교체 수 — 이보다 draws 가 길어지면 그만큼 교체 연출을 한다. */
  const drawsSeen = new Map<number, number>();
  const outlines = new WeakMap<View, Graphics>();
  let state: BadugiStageState | null = null;
  let first = true;
  let roundId: string | null = null;
  let resultKey: string | null = null;
  let seatsBy = new Map<number, BadugiStageSeat>();

  const place = (view: View, slot: Slot) => { view.place(slot); view.scale.set(slot.s); };
  const slide = (view: View, slot: Slot, ms = 220) => {
    if (Math.abs(view.x - slot.x) < 0.5 && Math.abs(view.y - slot.y) < 0.5 && Math.abs(view.scale.x - slot.s) < 0.005) return Promise.resolve();
    const x0 = view.x, y0 = view.y, r0 = view.rotation, s0 = view.scale.x;
    return tween(ms, (p) => {
      view.x = x0 + (slot.x - x0) * p;
      view.y = y0 + (slot.y - y0) * p;
      view.rotation = r0 + (slot.r - r0) * p;
      view.scale.set(s0 + (slot.s - s0) * p);
    }, easeInOut);
  };
  const newCard = (card: Card | null, tex: Texture | null, s: number) => {
    const view = new CardView<Card>(deps, card, tex, s);
    layers.card.addChild(view);
    return view;
  };
  const outlineOf = (view: View) => {
    let g = outlines.get(view);
    if (!g) {
      g = new Graphics().roundRect(-CARD.w / 2 - 3, -CARD.h / 2 - 3, CARD.w + 6, CARD.h + 6, 8).stroke({ width: 3.5, color: GOLD });
      g.visible = false;
      view.addChild(g);
      outlines.set(view, g);
    }
    return g;
  };

  /** 카드 한 장을 엎은 채 버림 더미로 날린다. */
  const toMuck = async (view: View, animate: boolean) => {
    if (!animate) { view.destroy({ children: true }); mucked += 1; renderMuck(); return; }
    const x0 = view.x, y0 = view.y, s0 = view.scale.x, r0 = view.rotation;
    let turned = false;
    await tween(300, (p) => {
      view.x = x0 + (geo.muck.x - x0) * p;
      view.y = y0 + (geo.muck.y - y0) * p - Math.sin(p * Math.PI) * 18;
      view.scale.set(s0 + (pileScale() - s0) * p);
      view.rotation = r0 + 0.4 * p;
      if (!turned && p > 0.35) { turned = true; view.showBack(); }
    }, easeIn);
    view.destroy({ children: true });
    mucked += 1;
    renderMuck();
  };

  /** 판 위 카드를 전부 덱 쪽으로 걷는다(새 판). */
  const sweep = async (animate: boolean) => {
    const all = [...views.values()].flat();
    views.clear();
    drawsSeen.clear();
    mucked = 0;
    renderMuck();
    if (!animate) { all.forEach((view) => view.destroy({ children: true })); return; }
    await Promise.all(all.map((view, i) => wait(i * 20).then(async () => {
      if (view.face.visible) view.showBack();
      const x0 = view.x, y0 = view.y, s0 = view.scale.x;
      await tween(300, (p) => {
        view.x = x0 + (geo.deck.x - x0) * p;
        view.y = y0 + (geo.deck.y - y0) * p;
        view.scale.set(s0 + (pileScale() - s0) * p);
        view.alpha = 1 - p * 0.6;
      }, easeIn);
      view.destroy({ children: true });
    })));
  };

  /* 칩 */
  const chipSprite = (value: number) => {
    const chip = new Sprite(chipTex[chipTier(value)] ?? Texture.WHITE);
    chip.anchor.set(0.5);
    chip.width = CHIP;
    chip.height = CHIP;
    return chip;
  };
  const buildPile = (target: Container, amount: number) => {
    target.removeChildren().forEach((child) => child.destroy({ children: true }));
    if (amount <= 0) return;
    const perRow = 5;
    const stacks = chipStacks(chipsFor(amount, 5, 26), 7);
    const columns: Container[] = [];
    stacks.forEach((stack, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, stacks.length - row * perRow);
      const col = i % perRow;
      const column = new Container();
      column.position.set((col - (inRow - 1) / 2) * (CHIP + 2), (col % 2) * 3 - row * 12);
      stack.forEach((value, j) => { const chip = chipSprite(value); chip.y = -j * CHIP_STEP; column.addChild(chip); });
      columns.push(column);
    });
    target.addChild(...columns.sort((a, b) => a.y - b.y));
  };
  let potKey = -1;
  const setPot = (amount: number) => {
    if (amount === potKey) return;
    potKey = amount;
    buildPile(pile, amount);
    potText.text = amount > 0 ? `팟 ${amount.toLocaleString()}코인` : "";
    potPill.visible = amount > 0;
    drawPotPill();
  };
  /** 팟이 이긴 자리로(여럿이면 나눠서). */
  const payPot = async (winnerSeats: number[]) => {
    const targets = winnerSeats.map((n) => seatsBy.get(n)).filter((s): s is BadugiStageSeat => Boolean(s)).map((s) => geo.seat(s.rel).plate);
    const columns = [...pile.children] as Container[];
    potKey = -1;
    potPill.visible = false;
    if (targets.length === 0 || columns.length === 0) { pile.removeChildren().forEach((child) => child.destroy({ children: true })); return; }
    await Promise.all(columns.map((column, i) => wait(i * 60).then(async () => {
      const to: Point = targets[i % targets.length]!;
      const x0 = pile.x + column.x * pile.scale.x;
      const y0 = pile.y + column.y * pile.scale.y;
      layers.fx.addChild(column);
      column.scale.set(pile.scale.x);
      column.position.set(x0, y0);
      await tween(620, (p) => {
        column.x = x0 + (to.x - x0) * p;
        column.y = y0 + (to.y - y0) * p - Math.sin(p * Math.PI) * 34;
        column.alpha = p > 0.8 ? 1 - (p - 0.8) * 5 : 1;
      }, easeInOut);
      column.destroy({ children: true });
    })));
  };

  const placeStatic = () => {
    const wide = geo.mode === "wide";
    pile.position.set(geo.pot.x, geo.pot.y);
    pile.scale.set(wide ? 1 : 0.82);
    potPill.position.set(geo.potLabel.x, geo.potLabel.y);
    potPill.scale.set(wide ? 1 : 0.9);
    drawPotPill();
    deck.position.set(geo.deck.x, geo.deck.y);
    deck.scale.set(pileScale());
    muck.position.set(geo.muck.x, geo.muck.y);
    muck.scale.set(pileScale());
    for (const [seatNumber, list] of views) {
      const seat = seatsBy.get(seatNumber);
      if (!seat) continue;
      list.forEach((view, index) => { if (view.settled) place(view, cardSlot(geo.seat(seat.rel), index)); });
    }
  };

  const liveFrame = (): BadugiFrame => ({ mode: geo.mode, designW: geo.w, designH: geo.h, scale: core.root.scale.x, x: core.root.x, y: core.root.y });
  Object.assign(host, { stageFrame: liveFrame });

  core.onLayout(() => {
    geo = geometryFor();
    host.dispatchEvent(new CustomEvent(BADUGI_LAYOUT_EVENT, { bubbles: true, detail: liveFrame() }));
    if (geo.timer) core.placeBetTimer(geo.timer.x, geo.timer.y);
    try { placeStatic(); } catch (error) { console.error("badugi stage layout", error); }
  });
  core.onTick(() => { core.drawBetTimer(state?.timer && geo.timer ? state.timer : null); });

  /** 접은 자리·진 자리는 흐리게, 죽은 패는 어둡게, 내 묶음(메이드면)은 금테. */
  const styleCards = (next: BadugiStageState) => {
    for (const [seatNumber, list] of views) {
      const seat = seatsBy.get(seatNumber);
      const dead = new Set(seat?.dead ?? []);
      list.forEach((view) => {
        view.alpha = seat?.dim === "folded" ? 0.38 : seat?.dim === "lost" ? 0.6 : 1;
        const isDead = Boolean(view.card && view.face.visible && dead.has(keyOf(view.card)));
        view.face.tint = isDead ? DEAD_TINT : 0xffffff;
        const lit = Boolean(seat && seat.rel === 0 && seat.dead.length === 0 && view.card && view.face.visible && seat.dim === "none" && next.result === null);
        if (lit || outlines.has(view)) outlineOf(view).visible = lit;
      });
    }
  };

  const apply = async (next: BadugiStageState) => {
    const animate = core.live(!first) && pending === null;
    first = false;
    const nextBy = new Map(next.seats.map((seat) => [seat.seatNumber, seat]));

    if (roundId !== null && next.roundId !== roundId) await sweep(animate);
    roundId = next.roundId;
    seatsBy = nextBy;

    // 이번 판에 없는 자리(일어섰거나 판 사이)의 카드는 치운다.
    for (const [seatNumber, list] of views) {
      if ((nextBy.get(seatNumber)?.cardCount ?? 0) > 0) continue;
      list.forEach((view) => view.destroy({ children: true }));
      views.delete(seatNumber);
      drawsSeen.delete(seatNumber);
    }

    const known = next.seats.flatMap((seat) => seat.cards ?? []);
    const faces = new Map(await Promise.all(known.map(async (card) => [keyOf(card), await faceTexture(card)] as const)));

    const deals: Array<{ view: View; slot: Slot; faceUp: boolean; order: number }> = [];
    const flips: Array<Promise<void>> = [];
    const swaps: Array<Promise<void>> = [];
    for (const seat of next.seats) {
      if (seat.cardCount === 0) continue;
      const spot = geo.seat(seat.rel);
      const faceUp = Boolean(seat.cards) && seat.rel === 0;
      let list = views.get(seat.seatNumber);
      if (!list) {
        list = Array.from({ length: 4 }, (_, index) => {
          const card = seat.cards?.[index] ?? null;
          const view = newCard(card, card ? faces.get(keyOf(card)) ?? null : null, spot.s);
          view.visible = false;
          return view;
        });
        views.set(seat.seatNumber, list);
        drawsSeen.set(seat.seatNumber, seat.draws.length);
        list.forEach((view, index) => deals.push({ view, slot: cardSlot(spot, index), faceUp: faceUp || Boolean(seat.cards && next.result), order: seat.dealSlot + index * next.seats.length }));
        continue;
      }
      // 교체가 끝났다: 바꾼 자리의 카드를 버림 더미로 보내고 새 카드를 받는다. 내 패는 바뀐 자리를 정확히 알고,
      // 상대는 장수만 알아서 뒤쪽 자리부터 바꾼 것처럼 보인다(어느 자리였는지는 원래 아무도 모른다).
      const seen = drawsSeen.get(seat.seatNumber) ?? 0;
      if (seat.draws.length > seen) {
        drawsSeen.set(seat.seatNumber, seat.draws.length);
        const count = seat.draws[seat.draws.length - 1] ?? 0;
        const replaced = seat.cards && list.every((view) => view.card)
          ? list.map((view, index) => (seat.cards![index] && keyOf(view.card!) !== keyOf(seat.cards![index]!) ? index : -1)).filter((index) => index >= 0)
          : Array.from({ length: count }, (_, k) => 4 - count + k);
        replaced.forEach((index, k) => {
          const old = list![index]!;
          const card = seat.cards?.[index] ?? null;
          const fresh = newCard(card, card ? faces.get(keyOf(card)) ?? null : null, spot.s);
          list![index] = fresh;
          const slot = cardSlot(spot, index);
          if (!animate) {
            void toMuck(old, false);
            place(fresh, slot);
            fresh.settled = true;
            if (card && faceUp) fresh.showFace();
            return;
          }
          fresh.visible = false;
          swaps.push(wait(k * 70).then(() => toMuck(old, true)).then(() => wait(120 + k * 40)).then(async () => {
            await fresh.dealTo(slot, { faceUp: Boolean(card) && faceUp, ms: 340 });
            fresh.settled = true;
          }));
        });
      }
      list.forEach((view, index) => {
        const card = seat.cards?.[index] ?? null;
        if (!view.settled) return;
        if (card && (!view.card || keyOf(view.card) !== keyOf(card))) view.setCard(card, faces.get(keyOf(card))!);
        if (card && !view.face.visible) {
          if (animate) flips.push(wait(index * 120).then(() => view.flip()));
          else view.showFace();
        }
        void (animate ? slide(view, cardSlot(spot, index)) : Promise.resolve(place(view, cardSlot(spot, index))));
      });
    }
    deals.sort((a, b) => a.order - b.order);
    const dealJobs = deals.map(({ view, slot, faceUp }, i) => {
      if (!animate) { view.visible = true; place(view, slot); view.settled = true; if (faceUp) view.showFace(); return Promise.resolve(); }
      return wait(i * 90).then(async () => { await view.dealTo(slot, { faceUp, ms: 340 }); view.settled = true; });
    });

    // 결과가 떠 있는 동안엔 팟을 다시 쌓지 않는다 — 승자에게 날아간 뒤 같은 상태가 또 오면 더미가 되살아났다(홀덤).
    if (!next.result) setPot(next.pot);
    placeStatic();
    styleCards(next);
    state = next;

    const key = next.result?.key ?? null;
    if (key !== resultKey) {
      resultKey = key;
      if (next.result) {
        const result = next.result;
        await Promise.all(flips);
        void core.showBanner(result.head, result.sub, GOLD, animate);
        // 폰은 배너가 판 가운데를 덮는다 — 잠깐 보여 주고 걷어서 이긴 패가 보이게.
        if (geo.mode !== "wide") void wait(2400).then(() => { if (resultKey === result.key) void core.hideBanner(true); });
        for (const n of result.winnerSeats) {
          const seat = seatsBy.get(n);
          if (!seat) continue;
          const spot = () => geo.seat(seat.rel);
          core.addGlow(() => ({ x: spot().x, y: spot().y }), 190 * spot().s, 150 * spot().s, GOLD);
        }
        await (animate ? payPot(result.winnerSeats) : Promise.resolve(setPot(0)));
        if (roundId) sounds.resultShown?.(roundId);
      } else {
        void core.hideBanner(animate);
        void core.clearGlows(animate);
      }
    }
    await Promise.all([...dealJobs, ...swaps, ...flips]);
    styleCards(next);
  };

  // 연출 큐는 최신 상태만 남긴다 — 봇이 빠르면 중간 상태를 다 그리느라 지난 판에 머물렀다(함정 7).
  let pending: BadugiStageState | null = null;
  let running = false;
  const drain = async () => {
    running = true;
    while (pending) {
      const next = pending;
      pending = null;
      try { await apply(next); } catch (error) { console.error("badugi stage", error); }
    }
    running = false;
  };

  core.start();
  return {
    update(next: BadugiStageState) {
      pending = next;
      if (!running) void drain();
    },
    destroy() {
      if ((host as { stageFrame?: unknown }).stageFrame === liveFrame) delete (host as { stageFrame?: unknown }).stageFrame;
      core.destroy();
    },
  };
}
