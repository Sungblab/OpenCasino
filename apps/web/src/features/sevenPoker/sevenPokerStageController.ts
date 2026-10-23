import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { Card } from "@opencasino/contracts";
import { chipTier } from "../../lib/betting";
import { chipBreakdown, chipLayerUrl } from "../../lib/chipArt";
import { CardView, NUM_FONT, createStageCore, easeIn, easeInOut, faceTexture, type CardDeps, type StageControllerBase, type StageSounds } from "../stage/core";
import { loadImage } from "../stage/hwatu";
import { CARD, DOCK_INSET, SEVEN_LAYOUT_EVENT, cardSlot, modeOf, sevenCompactSize, sevenGeometry, sevenHeight, sevenMode, type SevenFrame, type SevenGeometry, type Slot } from "./sevenPokerLayout";

/**
 * 7포커 캔버스 판 — 홀덤 v6 와 같은 틀. 그리는 것: 담요, 자리마다 최대 7장(엎은 패·앞면), 팟 칩 더미와 금액,
 * 결과 배너·승자 빛, 차례 시계. 이름표·버튼은 DOM 층.
 *
 * 카드는 판(roundId)이 바뀔 때만 걷는다. 그 밖엔 같은 카드(같은 key)는 그 자리에 머물고 자리가 바뀐 것만
 * 미끄러진다. 엎어 둔 카드의 앞면을 새로 알게 되면(초이스 공개·쇼다운) 새로 날리지 않고 그 자리에서 뒤집는다.
 * 초이스에서 버린 한 장은 딜러 쪽으로 걷힌다.
 */

export interface SevenStageCard {
  /** 같은 카드면 같은 값 — 앞면을 알면 rank+suit, 모르는 엎은 패는 자리 번호(h0, h1, h6). */
  key: string;
  card: Card | null;
  /** 모두에게 보이는 앞면 패(내 자리에선 살짝 올려 엎은 패와 가른다). */
  up: boolean;
}

export interface SevenStageSeat {
  seatNumber: number;
  rel: number;
  dealSlot: number;
  cards: SevenStageCard[];
  dim: "none" | "folded" | "lost";
  mine: boolean;
}

export interface SevenStageState {
  roundId: string | null;
  seats: SevenStageSeat[];
  /** 금테를 두를 카드 key(내 족보·쇼다운에서 이긴 다섯 장). */
  highlight: string[];
  pot: number;
  timer: { endsAt: string | null; durationMs: number | null } | null;
  result: { key: string; head: string; sub: string; winnerSeats: number[] } | null;
}

export interface SevenStageController extends StageControllerBase<SevenStageState> {}

type View = CardView<Card>;
const GOLD = 0xffd24a;
const CHIP = 22;
const CHIP_STEP = 3;
const CHIP_DENOMS = [1000, 500, 100, 50, 10, 5, 1];
/** 나만 보는 엎은 패 — 앞면을 보여 주되 살짝 어둡게. */
const HIDDEN_TINT = 0xc9d2e4;
const BACK_SCALE = 0.84;

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

export async function createSevenPokerStage(host: HTMLElement, sounds: StageSounds = {}): Promise<SevenStageController> {
  let coreRef: { compact: () => boolean; designW: () => number; designH: () => number } | null = null;
  const geometryFor = (): SevenGeometry => (coreRef
    ? sevenGeometry(modeOf(coreRef.compact(), coreRef.designH()), coreRef.designW(), coreRef.designH())
    : sevenGeometry("wide", 640, 460));
  const core = await createStageCore(host, sounds, {
    // 짙은 청록 담요 — 홀덤(초록)과 한눈에 갈리게.
    felt: { inner: "#1d5c62", mid: "#124247", outer: "#051b1e", arc: false },
    minW: 640,
    height: (w, h) => sevenHeight(w, h, host.clientHeight),
    compact: sevenCompactSize,
    bannerY: () => geometryFor().banner.y,
    props: false,
    status: false,
    insets: () => ({ top: 0, bottom: DOCK_INSET[sevenMode(host.clientWidth, host.clientHeight)] }),
    timerScale: 0.56,
    name: "seven-poker",
  });
  coreRef = core;
  const { tween, wait, layers } = core;
  layers.card.sortableChildren = true;
  const chipTex = await Promise.all([0, 1, 2, 3, 4].map(chipTexture));
  let geo = geometryFor();

  const deps: CardDeps = {
    tween, wait, sounds, back: core.back,
    pullFromShoe: async () => ({ x: geo.dealer.x, y: geo.dealer.y, r: 0, s: 0.3 }),
  };

  /* 팟 */
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

  /** 자리마다 그 자리 카드(화면 순서 그대로). */
  const views = new Map<number, Array<{ key: string; up: boolean; view: View }>>();
  const outlines = new WeakMap<View, Graphics>();
  let state: SevenStageState | null = null;
  let first = true;
  let roundId: string | null = null;
  let resultKey: string | null = null;
  let seatsBy = new Map<number, SevenStageSeat>();

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

  const place = (view: View, slot: Slot) => { view.place(slot); view.scale.set(slot.s); };
  const slide = (view: View, slot: Slot, ms = 240) => {
    if (Math.abs(view.x - slot.x) < 0.5 && Math.abs(view.y - slot.y) < 0.5 && Math.abs(view.scale.x - slot.s) < 0.005) return Promise.resolve();
    const x0 = view.x, y0 = view.y, s0 = view.scale.x;
    return tween(ms, (p) => {
      view.x = x0 + (slot.x - x0) * p;
      view.y = y0 + (slot.y - y0) * p;
      view.scale.set(s0 + (slot.s - s0) * p);
    }, easeInOut);
  };
  const newCard = (card: Card | null, tex: Texture | null, s: number) => {
    const view = new CardView<Card>(deps, card, tex, s);
    layers.card.addChild(view);
    return view;
  };
  /** 판 밖으로(딜러 쪽) 걷는다 — 새 판, 초이스에서 버린 패. */
  const muck = (list: View[], animate: boolean) => {
    if (!animate) { list.forEach((view) => view.destroy({ children: true })); return Promise.resolve(); }
    return Promise.all(list.map((view, i) => wait(i * 25).then(async () => {
      if (view.face.visible) view.showBack();
      const x0 = view.x, y0 = view.y, s0 = view.scale.x;
      await tween(320, (p) => {
        view.x = x0 + (geo.dealer.x - x0) * p;
        view.y = y0 + (geo.dealer.y - y0) * p;
        view.scale.set(s0 + (0.3 - s0) * p);
        view.alpha = 1 - p * 0.6;
      }, easeIn);
      view.destroy({ children: true });
    }))).then(() => undefined);
  };

  /* 칩 */
  const chipSprite = (value: number) => {
    const chip = new Sprite(chipTex[chipTier(value)] ?? Texture.WHITE);
    chip.anchor.set(0.5);
    chip.width = CHIP;
    chip.height = CHIP;
    return chip;
  };
  const buildPile = (amount: number) => {
    pile.removeChildren().forEach((child) => child.destroy({ children: true }));
    if (amount <= 0) return;
    const stacks = chipStacks(chipsFor(amount, 5, 26), 7);
    const columns: Container[] = [];
    stacks.forEach((stack, i) => {
      const row = Math.floor(i / 5);
      const inRow = Math.min(5, stacks.length - row * 5);
      const col = i % 5;
      const column = new Container();
      column.position.set((col - (inRow - 1) / 2) * (CHIP + 2), (col % 2) * 3 - row * 12);
      stack.forEach((value, j) => { const chip = chipSprite(value); chip.y = -j * CHIP_STEP; column.addChild(chip); });
      columns.push(column);
    });
    pile.addChild(...columns.sort((a, b) => a.y - b.y));
  };
  let potKey = -1;
  const setPot = (amount: number) => {
    if (amount === potKey) return;
    potKey = amount;
    buildPile(amount);
    potText.text = amount > 0 ? `팟 ${amount.toLocaleString()}코인` : "";
    potPill.visible = amount > 0;
    drawPotPill();
  };
  /** 팟이 이긴 자리로(여럿이면 나눠서). */
  const payPot = async (winnerSeats: number[]) => {
    const targets = winnerSeats.map((n) => seatsBy.get(n)).filter((s): s is SevenStageSeat => Boolean(s)).map((s) => geo.seat(s.rel).plate);
    const columns = [...pile.children] as Container[];
    potKey = -1;
    potPill.visible = false;
    if (targets.length === 0 || columns.length === 0) { pile.removeChildren().forEach((child) => child.destroy({ children: true })); return; }
    await Promise.all(columns.map((column, i) => wait(i * 60).then(async () => {
      const to = targets[i % targets.length]!;
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

  /** 남의 엎은 패는 한 치수 작게(아랫단을 맞춰) — 판단거리인 앞면이 먼저 눈에 들어오게. */
  const slotOf = (seat: SevenStageSeat, index: number, count: number, up: boolean, known = true) => {
    const slot = cardSlot(geo.seat(seat.rel), index, count, seat.mine && up);
    if (seat.mine || known) return slot;
    const s = slot.s * BACK_SCALE;
    return { ...slot, s, y: slot.y + (CARD.h * (slot.s - s)) / 2 };
  };

  const placeStatic = () => {
    pile.position.set(geo.pot.x, geo.pot.y);
    pile.scale.set(geo.mode === "wide" ? 1 : 0.82);
    potPill.position.set(geo.potLabel.x, geo.potLabel.y);
    potPill.scale.set(geo.mode === "wide" ? 1 : 0.9);
    drawPotPill();
    for (const [seatNumber, list] of views) {
      const seat = seatsBy.get(seatNumber);
      if (!seat) continue;
      list.forEach((entry, index) => { if (entry.view.settled) place(entry.view, slotOf(seat, index, list.length, entry.up, Boolean(entry.view.card))); });
    }
  };

  const liveFrame = (): SevenFrame => ({ mode: geo.mode, designW: geo.w, designH: geo.h, scale: core.root.scale.x, x: core.root.x, y: core.root.y });
  Object.assign(host, { stageFrame: liveFrame });

  core.onLayout(() => {
    geo = geometryFor();
    host.dispatchEvent(new CustomEvent(SEVEN_LAYOUT_EVENT, { bubbles: true, detail: liveFrame() }));
    if (geo.timer) core.placeBetTimer(geo.timer.x, geo.timer.y);
    try { placeStatic(); } catch (error) { console.error("seven-poker stage layout", error); }
  });
  core.onTick(() => { core.drawBetTimer(state?.timer && geo.timer ? state.timer : null); });

  const styleCards = (next: SevenStageState) => {
    const lit = new Set(next.highlight);
    for (const [seatNumber, list] of views) {
      const seat = seatsBy.get(seatNumber);
      list.forEach((entry, index) => {
        const view = entry.view;
        view.alpha = seat?.dim === "folded" ? 0.38 : seat?.dim === "lost" ? 0.6 : 1;
        // 겹친 카드는 오른쪽이 위 — 왼쪽 위 숫자 귀퉁이가 늘 보이게. 초이스로 순서가 바뀌어도 다시 맞춘다.
        view.zIndex = seatNumber * 10 + index;
        view.face.tint = seat?.mine && !entry.up && view.face.visible ? HIDDEN_TINT : 0xffffff;
        const on = Boolean(view.card && view.face.visible && lit.has(entry.key));
        if (on || outlines.has(view)) outlineOf(view).visible = on;
      });
    }
  };

  const apply = async (next: SevenStageState) => {
    const animate = core.live(!first) && pending === null;
    first = false;
    const nextBy = new Map(next.seats.map((seat) => [seat.seatNumber, seat]));

    // 새 판(또는 판이 끝나 대기로): 카드를 걷는다.
    if (roundId !== null && next.roundId !== roundId) {
      const all = [...views.values()].flat().map((entry) => entry.view);
      views.clear();
      await muck(all, animate);
    }
    roundId = next.roundId;
    seatsBy = nextBy;

    const known = next.seats.flatMap((seat) => seat.cards.flatMap((entry) => (entry.card ? [entry.card] : [])));
    const faces = new Map(await Promise.all(known.map(async (card) => [`${card.rank}${card.suit}`, await faceTexture(card)] as const)));
    const faceOf = (card: Card) => faces.get(`${card.rank}${card.suit}`) ?? null;

    const deals: Array<{ view: View; slot: Slot; faceUp: boolean; order: number }> = [];
    const moves: Array<Promise<void>> = [];
    const mucked: View[] = [];
    for (const [seatNumber, list] of views) {
      if (nextBy.has(seatNumber)) continue;
      mucked.push(...list.map((entry) => entry.view));
      views.delete(seatNumber);
    }
    for (const seat of next.seats) {
      const before = views.get(seat.seatNumber) ?? [];
      const free = [...before];
      const take = (match: (entry: (typeof before)[number]) => boolean) => {
        const index = free.findIndex(match);
        return index < 0 ? null : free.splice(index, 1)[0]!;
      };
      // 1) 같은 key 는 그대로. 2) 앞면을 새로 알게 된 카드는 남은 엎은 패를 그 순서대로 뒤집어 쓴다. 3) 나머지는 새로 딜.
      const matched = seat.cards.map((entry) => take((old) => old.key === entry.key));
      seat.cards.forEach((entry, index) => {
        if (matched[index] || !entry.card) return;
        matched[index] = take((old) => !old.view.card);
      });
      const count = seat.cards.length;
      const list = seat.cards.map((entry, index) => {
        const slot = slotOf(seat, index, count, entry.up, Boolean(entry.card));
        const old = matched[index];
        if (old) {
          const view = old.view;
          if (entry.card && (!view.card || `${view.card.rank}${view.card.suit}` !== entry.key)) view.setCard(entry.card, faceOf(entry.card)!);
          if (entry.card && !view.face.visible && view.settled) moves.push(animate ? wait(index * 90).then(() => view.flip()) : Promise.resolve(view.showFace()));
          if (view.settled) moves.push(animate ? slide(view, slot) : Promise.resolve(place(view, slot)));
          return { key: entry.key, up: entry.up, view };
        }
        const view = newCard(entry.card, entry.card ? faceOf(entry.card) : null, slot.s);
        view.visible = false;
        // 앞면으로 날아오는 것: 공개 패, 그리고 내 패 전부(나는 내 패를 안다).
        deals.push({ view, slot, faceUp: Boolean(entry.card) && (entry.up || seat.mine), order: seat.dealSlot + index * next.seats.length });
        return { key: entry.key, up: entry.up, view };
      });
      mucked.push(...free.map((entry) => entry.view));
      if (list.length > 0) views.set(seat.seatNumber, list);
      else views.delete(seat.seatNumber);
    }
    const muckJob = muck(mucked, animate);

    deals.sort((a, b) => a.order - b.order);
    const dealJobs = deals.map(({ view, slot, faceUp }, i) => {
      if (!animate) { view.visible = true; place(view, slot); view.settled = true; if (faceUp) view.showFace(); return Promise.resolve(); }
      return wait(i * 95).then(async () => { await view.dealTo(slot, { faceUp, ms: 340 }); view.settled = true; styleCards(next); });
    });

    // 결과가 떠 있는 동안엔 팟을 다시 쌓지 않는다 — 승자에게 날아간 뒤 같은 상태가 또 오면 더미가 되살아났다.
    if (!next.result) setPot(next.pot);
    placeStatic();
    styleCards(next);
    state = next;

    const key = next.result?.key ?? null;
    if (key !== resultKey) {
      resultKey = key;
      if (next.result) {
        const result = next.result;
        await Promise.all(moves);
        styleCards(next);
        void core.showBanner(result.head, result.sub, GOLD, animate);
        // 폰은 배너가 판 가운데를 덮는다 — 잠깐 보여 주고 걷어서 이긴 패가 보이게.
        if (geo.mode !== "wide") void wait(2600).then(() => { if (resultKey === result.key) void core.hideBanner(true); });
        for (const n of result.winnerSeats) {
          const seat = seatsBy.get(n);
          if (!seat) continue;
          const at = () => {
            const spot = geo.seat(seat.rel);
            const count = views.get(n)?.length ?? 1;
            const a = cardSlot(spot, 0, count);
            const b = cardSlot(spot, count - 1, count);
            return { x: (a.x + b.x) / 2, y: spot.y };
          };
          core.addGlow(at, (CARD.w * 4.2) * geo.seat(seat.rel).s, 160 * geo.seat(seat.rel).s, GOLD);
        }
        await (animate ? payPot(result.winnerSeats) : Promise.resolve(setPot(0)));
        if (roundId) sounds.resultShown?.(roundId);
      } else {
        void core.hideBanner(animate);
        void core.clearGlows(animate);
      }
    }
    await Promise.all([...dealJobs, ...moves, muckJob]);
    styleCards(next);
  };

  let pending: SevenStageState | null = null;
  let running = false;
  const drain = async () => {
    running = true;
    while (pending) {
      const next = pending;
      pending = null;
      try { await apply(next); } catch (error) { console.error("seven-poker stage", error); }
    }
    running = false;
  };

  core.start();
  return {
    update(next: SevenStageState) {
      pending = next;
      if (!running) void drain();
    },
    destroy() {
      if ((host as { stageFrame?: unknown }).stageFrame === liveFrame) delete (host as { stageFrame?: unknown }).stageFrame;
      core.destroy();
    },
  };
}
