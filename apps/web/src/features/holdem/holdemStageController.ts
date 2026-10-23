import { Container, Graphics, Sprite, Texture, type Text } from "pixi.js";
import type { Card } from "@opencasino/contracts";
import { chipTier } from "../../lib/betting";
import { chipBreakdown, chipLayerUrl } from "../../lib/chipArt";
import { CardView, NUM_FONT, createStageCore, easeIn, easeInOut, faceTexture, type CardDeps, type StageControllerBase, type StageSounds } from "../stage/core";
import { loadImage } from "../stage/hwatu";
import { CARD, DOCK_INSET, HOLDEM_LAYOUT_EVENT, holdemCompactSize, holdemGeometry, holdemHeight, holdemMode, holeSlot, modeOf, type HoldemFrame, type HoldemGeometry, type Slot } from "./holdemLayout";

/**
 * 홀덤 캔버스 판 — 섯다 v6 와 같은 틀. 그리는 것: 담요, 자리마다 두 장(내 것·쇼다운은 앞면), 보드 다섯 장과
 * 엎어 둔 번 카드 더미, 팟 칩 더미와 금액, 자리마다 이번 스트리트 베팅 칩, 결과 배너·승자 빛, 차례 시계.
 * 이름표·버튼은 DOM 층.
 *
 * 카드는 판(roundId)이 바뀔 때만 새로 돈다. 그 밖엔 자리가 바뀐 카드만 미끄러지고(뛰지 않는다), 앞면을 새로
 * 알게 된 카드만 그 자리에서 뒤집힌다.
 */

export interface HoldemStageSeat {
  seatNumber: number;
  rel: number;
  dealSlot: number;
  dealtIn: boolean;
  /** 앞면을 아는 두 장(내 것, 쇼다운의 공개). */
  cards: Card[] | null;
  dim: "none" | "folded" | "lost";
  /** 이번 스트리트에 낸 돈. */
  bet: number;
}

export interface HoldemStageState {
  roundId: string | null;
  seats: HoldemStageSeat[];
  board: Card[];
  /** 금테를 두를 카드(내 족보를 만드는 카드) — cardKey(rank+suit). */
  highlight: string[];
  pot: number;
  /** 팟이 갈리면 한 줄 더(메인 · 사이드). */
  potSub: string | null;
  timer: { endsAt: string | null; durationMs: number | null } | null;
  result: { key: string; head: string; sub: string; winnerSeats: number[] } | null;
}

export interface HoldemStageController extends StageControllerBase<HoldemStageState> {}

type View = CardView<Card>;
const GOLD = 0xffd24a;
const CHIP = 22;
const CHIP_STEP = 3;
const CHIP_DENOMS = [1000, 500, 100, 50, 10, 5, 1];
/** lib/holdemHandRead 의 cardKey 와 같은 모양(금테 목록이 그 키로 온다). */
const keyOf = (card: Card) => `${card.rank}${card.suit}`;
/** 서버는 스트리트를 열 때마다 한 장을 버린다(holdem-room-manager dealStreet) — 보드 3·4·5장이면 1·2·3장. */
const burnsFor = (boardLength: number) => Math.max(0, Math.min(3, boardLength - 2));
/** 번 카드가 날아가기 시작하고 이만큼 뒤에 보드 카드가 뒤따른다. */
const BURN_LEAD_MS = 260;

const chipTextures = new Map<number, Promise<Texture>>();
function chipTexture(tier: number): Promise<Texture> {
  let promise = chipTextures.get(tier);
  if (!promise) {
    promise = loadImage(chipLayerUrl(tier)).then((image) => (image ? Texture.from(image) : Texture.WHITE));
    chipTextures.set(tier, promise);
  }
  return promise;
}
/** 금액 → 칩들(큰 칩이 아래). 너무 적으면 쪼개서 min 장은 넘긴다. */
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

export async function createHoldemStage(host: HTMLElement, sounds: StageSounds = {}): Promise<HoldemStageController> {
  let coreRef: { compact: () => boolean; designW: () => number; designH: () => number } | null = null;
  const geometryFor = (): HoldemGeometry => (coreRef
    ? holdemGeometry(modeOf(coreRef.compact(), coreRef.designH()), coreRef.designW(), coreRef.designH())
    : holdemGeometry("wide", 640, 460));
  const core = await createStageCore(host, sounds, {
    // 포커 펠트: 짙은 초록. 곡선 인쇄 없이(자리가 판 가장자리에 붙어 있어 호가 이름표를 가로질렀다).
    felt: { inner: "#1f6b45", mid: "#155234", outer: "#07251a", arc: false },
    minW: 640,
    height: (w, h) => holdemHeight(w, h, host.clientHeight),
    compact: holdemCompactSize,
    bannerY: () => geometryFor().banner.y,
    props: false,
    status: false,
    insets: () => ({ top: 0, bottom: DOCK_INSET[holdemMode(host.clientWidth, host.clientHeight)] }),
    timerScale: 0.56,
    name: "holdem",
  });
  coreRef = core;
  const { tween, wait, layers } = core;
  const chipTex = await Promise.all([0, 1, 2, 3, 4].map(chipTexture));
  let geo = geometryFor();

  const deps: CardDeps = {
    tween, wait, sounds, back: core.back,
    pullFromShoe: async () => ({ x: geo.dealer.x, y: geo.dealer.y, r: 0, s: 0.3 }),
  };

  /* 팟: 칩 더미 + 금액 알약 */
  const pile = new Container();
  const potPill = new Container();
  const potPillBg = new Graphics();
  const potText = core.text("", 14, 0xffd28a, NUM_FONT);
  const potSub = core.text("", 11, 0xe8dcc0, NUM_FONT, { fontWeight: "600" });
  potPill.addChild(potPillBg, potText, potSub);
  layers.table.addChild(pile, potPill);
  const drawPotPill = () => {
    // 넓은 화면은 알약이 보드 바로 위라 두 줄(36px)로 자라면 아랫줄이 보드 카드에, 윗줄이 칩 더미에 먹혔다 —
    // 한 줄에 나란히(팟 380코인 · 메인 300 · 사이드 80). 폰 배치는 팟이 보드 옆이라 두 줄 그대로.
    const inline = potSub.visible && geo.mode === "wide";
    const gap = 10;
    const lineW = potText.width + gap + potSub.width;
    const w = (inline ? lineW : Math.max(potText.width, potSub.visible ? potSub.width : 0)) + 24;
    const h = potSub.visible && !inline ? 36 : 22;
    potText.x = inline ? -lineW / 2 + potText.width / 2 : 0;
    potText.y = potSub.visible && !inline ? -7 : 0;
    potSub.x = inline ? lineW / 2 - potSub.width / 2 : 0;
    potSub.y = inline ? 1 : 9;
    potPillBg.clear().roundRect(-w / 2, -11, w, h, 11).fill({ color: 0x0a0806, alpha: 0.72 }).stroke({ width: 1, color: 0xf0b41c, alpha: 0.45 });
  };

  /* 자리마다 베팅 칩 */
  interface BetPile { box: Container; label: Text; amount: number }
  const bets = new Map<number, BetPile>();

  const views = new Map<number, View[]>();
  const boardViews: View[] = [];
  /** 엎어 둔 번 카드 — 앞면은 서버도 내려주지 않는다. */
  const burnViews: View[] = [];
  const outlines = new WeakMap<View, Graphics>();
  let state: HoldemStageState | null = null;
  let first = true;
  let roundId: string | null = null;
  let resultKey: string | null = null;
  let seatsBy = new Map<number, HoldemStageSeat>();

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

  /** 판 위 카드를 전부 딜러 쪽으로 걷는다. */
  const sweep = async (animate: boolean) => {
    const all = [...[...views.values()].flat(), ...boardViews.splice(0), ...burnViews.splice(0)];
    views.clear();
    if (!animate) { all.forEach((view) => view.destroy({ children: true })); return; }
    await Promise.all(all.map((view, i) => wait(i * 25).then(async () => {
      if (view.face.visible) view.showBack();
      const x0 = view.x, y0 = view.y, s0 = view.scale.x;
      await tween(320, (p) => {
        view.x = x0 + (geo.dealer.x - x0) * p;
        view.y = y0 + (geo.dealer.y - y0) * p;
        view.scale.set(s0 + (0.3 - s0) * p);
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
  /** 칩 더미 하나를 그린다(가운데 기준, 줄마다 perRow 더미). */
  const buildPile = (target: Container, amount: number, opts: { min: number; max: number; perStack: number; perRow: number }) => {
    target.removeChildren().forEach((child) => child.destroy({ children: true }));
    if (amount <= 0) return;
    const stacks = chipStacks(chipsFor(amount, opts.min, opts.max), opts.perStack);
    const columns: Container[] = [];
    stacks.forEach((stack, i) => {
      const row = Math.floor(i / opts.perRow);
      const inRow = Math.min(opts.perRow, stacks.length - row * opts.perRow);
      const col = i % opts.perRow;
      const column = new Container();
      column.position.set((col - (inRow - 1) / 2) * (CHIP + 2), (col % 2) * 3 - row * 12);
      stack.forEach((value, j) => { const chip = chipSprite(value); chip.y = -j * CHIP_STEP; column.addChild(chip); });
      columns.push(column);
    });
    target.addChild(...columns.sort((a, b) => a.y - b.y));
  };

  let potKey = "";
  const setPot = (amount: number, sub: string | null) => {
    const key = `${amount}|${sub ?? ""}`;
    if (key === potKey) return;
    potKey = key;
    buildPile(pile, amount, { min: 5, max: 26, perStack: 7, perRow: 5 });
    potText.text = amount > 0 ? `팟 ${amount.toLocaleString()}코인` : "";
    potSub.text = sub ?? "";
    potSub.visible = Boolean(sub);
    potPill.visible = amount > 0;
    drawPotPill();
  };

  const betPile = (seatNumber: number) => {
    let entry = bets.get(seatNumber);
    if (!entry) {
      const box = new Container();
      const label = core.text("", 12, 0xffe9b0, NUM_FONT);
      label.y = 17;
      box.addChild(label);
      layers.table.addChild(box);
      entry = { box, label, amount: 0 };
      bets.set(seatNumber, entry);
    }
    return entry;
  };
  const drawBet = (entry: BetPile, amount: number) => {
    const chips = entry.box.children.filter((child) => child !== entry.label);
    chips.forEach((child) => { entry.box.removeChild(child); child.destroy({ children: true }); });
    entry.amount = amount;
    entry.label.text = amount > 0 ? amount.toLocaleString() : "";
    if (amount <= 0) return;
    const holder = new Container();
    buildPile(holder, amount, { min: 1, max: 8, perStack: 8, perRow: 2 });
    entry.box.addChildAt(holder, 0);
  };

  /** 스트리트가 끝나 베팅이 0 으로 돌아가면 칩이 팟으로 모인다. */
  const collectBets = async (seatNumbers: number[]) => {
    await Promise.all(seatNumbers.map((n, i) => wait(i * 50).then(async () => {
      const entry = bets.get(n);
      if (!entry) return;
      const fly = new Container();
      const holder = entry.box.children.find((child) => child !== entry.label);
      if (!holder) return;
      entry.box.removeChild(holder);
      fly.addChild(holder);
      fly.position.set(entry.box.x, entry.box.y);
      fly.scale.set(entry.box.scale.x);
      entry.label.text = "";
      layers.fx.addChild(fly);
      const x0 = fly.x, y0 = fly.y;
      await tween(380, (p) => {
        fly.x = x0 + (geo.pot.x - x0) * p;
        fly.y = y0 + (geo.pot.y - y0) * p;
        fly.alpha = p > 0.85 ? 1 - (p - 0.85) * 6 : 1;
      }, easeInOut);
      fly.destroy({ children: true });
    })));
  };

  /** 팟이 이긴 자리로(여럿이면 나눠서). */
  const payPot = async (winnerSeats: number[]) => {
    const targets = winnerSeats.map((n) => seatsBy.get(n)).filter((s): s is HoldemStageSeat => Boolean(s)).map((s) => geo.seat(s.rel).plate);
    const columns = [...pile.children] as Container[];
    potKey = "";
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

  const placeStatic = () => {
    const pileScale = geo.mode === "wide" ? 1 : 0.82;
    pile.position.set(geo.pot.x, geo.pot.y);
    pile.scale.set(pileScale);
    potPill.position.set(geo.potLabel.x, geo.potLabel.y);
    potPill.scale.set(geo.mode === "wide" ? 1 : 0.9);
    drawPotPill();
    for (const [seatNumber, entry] of bets) {
      const seat = seatsBy.get(seatNumber);
      if (!seat) { entry.box.visible = false; continue; }
      const at = geo.seat(seat.rel).bet;
      entry.box.visible = true;
      entry.box.position.set(at.x, at.y);
      entry.box.scale.set(geo.mode === "wide" ? 0.9 : 0.72);
    }
    for (const [seatNumber, list] of views) {
      const seat = seatsBy.get(seatNumber);
      if (!seat) continue;
      list.forEach((view, index) => { if (view.settled) place(view, holeSlot(geo.seat(seat.rel), index)); });
    }
    boardViews.forEach((view, index) => { if (view.settled) place(view, geo.board(index)); });
    burnViews.forEach((view, index) => { if (view.settled) place(view, geo.burn(index)); });
  };

  const liveFrame = (): HoldemFrame => ({ mode: geo.mode, designW: geo.w, designH: geo.h, scale: core.root.scale.x, x: core.root.x, y: core.root.y });
  Object.assign(host, { stageFrame: liveFrame });

  core.onLayout(() => {
    geo = geometryFor();
    host.dispatchEvent(new CustomEvent(HOLDEM_LAYOUT_EVENT, { bubbles: true, detail: liveFrame() }));
    if (geo.timer) core.placeBetTimer(geo.timer.x, geo.timer.y);
    try { placeStatic(); } catch (error) { console.error("holdem stage layout", error); }
  });
  core.onTick(() => { core.drawBetTimer(state?.timer && geo.timer ? state.timer : null); });

  const styleCards = (next: HoldemStageState) => {
    const lit = new Set(next.highlight);
    for (const [seatNumber, list] of views) {
      const seat = seatsBy.get(seatNumber);
      list.forEach((view) => {
        view.alpha = seat?.dim === "folded" ? 0.38 : seat?.dim === "lost" ? 0.55 : 1;
        const on = Boolean(view.card && view.face.visible && lit.has(keyOf(view.card)));
        if (on || outlines.has(view)) outlineOf(view).visible = on;
      });
    }
    boardViews.forEach((view) => {
      const on = Boolean(view.card && lit.has(keyOf(view.card)));
      if (on || outlines.has(view)) outlineOf(view).visible = on;
    });
  };

  const apply = async (next: HoldemStageState) => {
    const animate = core.live(!first) && pending === null;
    first = false;
    const nextBy = new Map(next.seats.map((seat) => [seat.seatNumber, seat]));

    // 새 판: 카드를 걷는다.
    if (roundId !== null && next.roundId !== roundId) await sweep(animate);
    roundId = next.roundId;
    seatsBy = nextBy;

    // 자리를 뜬 사람의 카드·칩은 치운다.
    for (const [seatNumber, list] of views) {
      if (nextBy.get(seatNumber)?.dealtIn) continue;
      list.forEach((view) => view.destroy({ children: true }));
      views.delete(seatNumber);
    }

    const known = [...next.seats.flatMap((seat) => seat.cards ?? []), ...next.board];
    const faces = new Map(await Promise.all(known.map(async (card) => [keyOf(card), await faceTexture(card)] as const)));

    // 스트리트가 끝나 베팅이 0 이 된 자리: 칩이 팟으로 날아간 뒤 팟이 는다.
    const cleared = [...bets].filter(([n, entry]) => entry.amount > 0 && (nextBy.get(n)?.bet ?? 0) === 0).map(([n]) => n);
    if (cleared.length > 0 && animate) await collectBets(cleared);
    for (const seat of next.seats) {
      const entry = betPile(seat.seatNumber);
      if (entry.amount !== seat.bet) drawBet(entry, seat.bet);
    }
    for (const [n, entry] of bets) if (!nextBy.has(n)) drawBet(entry, 0);

    // 홀카드: 새 판이면 딜 순서대로 날린다. 앞면을 새로 알게 된 카드(쇼다운)는 제자리에서 뒤집는다.
    const deals: Array<{ view: View; slot: Slot; faceUp: boolean; order: number }> = [];
    const flips: Array<Promise<void>> = [];
    for (const seat of next.seats) {
      if (!seat.dealtIn) continue;
      const spot = geo.seat(seat.rel);
      let list = views.get(seat.seatNumber);
      if (!list) {
        list = [0, 1].map((index) => {
          const card = seat.cards?.[index] ?? null;
          const view = newCard(card, card ? faces.get(keyOf(card)) ?? null : null, spot.s);
          view.visible = false;
          return view;
        });
        views.set(seat.seatNumber, list);
        list.forEach((view, index) => deals.push({ view, slot: holeSlot(spot, index), faceUp: Boolean(seat.cards) && seat.rel === 0, order: seat.dealSlot + index * next.seats.length }));
        continue;
      }
      list.forEach((view, index) => {
        const card = seat.cards?.[index] ?? null;
        if (card && (!view.card || keyOf(view.card) !== keyOf(card))) view.setCard(card, faces.get(keyOf(card))!);
        if (card && !view.face.visible && view.settled) {
          if (animate) flips.push(wait(index * 140).then(() => view.flip()));
          else view.showFace();
        }
        if (view.settled) void (animate ? slide(view, holeSlot(spot, index)) : Promise.resolve(place(view, holeSlot(spot, index))));
      });
    }
    deals.sort((a, b) => a.order - b.order);
    const dealJobs = deals.map(({ view, slot, faceUp }, i) => {
      if (!animate) { view.visible = true; place(view, slot); view.settled = true; if (faceUp) view.showFace(); return Promise.resolve(); }
      return wait(i * 110).then(async () => { await view.dealTo(slot, { faceUp, ms: 360 }); view.settled = true; });
    });

    // 번 카드: 스트리트가 열릴 때 맨 위 한 장이 엎인 채 더미로 먼저 간다. 보드는 그 뒤를 따른다.
    const burns = burnsFor(next.board.length);
    if (burns < burnViews.length) burnViews.splice(burns).forEach((view) => view.destroy({ children: true }));
    const burnJobs: Array<Promise<void>> = [];
    const firstBurn = burnViews.length;
    for (let index = firstBurn; index < burns; index += 1) {
      const view = newCard(null, null, geo.burn(index).s);
      burnViews[index] = view;
      if (!animate) { place(view, geo.burn(index)); view.settled = true; continue; }
      view.visible = false;
      burnJobs.push(wait((index - firstBurn) * BURN_LEAD_MS).then(async () => {
        await view.dealTo(geo.burn(index), { ms: 320 });
        view.settled = true;
      }));
    }
    const boardLead = animate ? (burns - firstBurn) * BURN_LEAD_MS : 0;

    // 보드: 새로 깔린 카드만 딜러 쪽에서 날아와 뒤집힌다.
    if (next.board.length < boardViews.length) boardViews.splice(next.board.length).forEach((view) => view.destroy({ children: true }));
    const boardJobs: Array<Promise<void>> = [];
    const firstNew = boardViews.length;
    next.board.forEach((card, index) => {
      if (boardViews[index]) return;
      const view = newCard(card, faces.get(keyOf(card)) ?? null, geo.board(index).s);
      boardViews[index] = view;
      if (!animate) { place(view, geo.board(index)); view.showFace(); view.settled = true; return; }
      view.visible = false;
      // 플랍은 세 장을 차례로, 턴·리버는 한 장.
      boardJobs.push(wait(boardLead + (index - firstNew) * 130).then(async () => {
        await view.dealTo(geo.board(index), { faceUp: true, ms: 380 });
        view.settled = true;
      }));
    });

    // 결과가 떠 있는 동안엔 팟을 다시 쌓지 않는다 — 승자에게 날아간 뒤 같은 상태가 또 오면 더미가 되살아났다.
    if (!next.result) setPot(next.pot, next.potSub);
    placeStatic();
    styleCards(next);
    state = next;

    // 결과
    const key = next.result?.key ?? null;
    if (key !== resultKey) {
      resultKey = key;
      if (next.result) {
        const result = next.result;
        await Promise.all(flips);
        void core.showBanner(result.head, result.sub, GOLD, animate);
        // 폰은 배너가 보드를 덮는다(보드 아래 틈이 없다) — 잠깐 보여 주고 걷어서 이긴 패와 보드가 보이게.
        if (geo.mode !== "wide") void wait(2400).then(() => { if (resultKey === result.key) void core.hideBanner(true); });
        for (const n of result.winnerSeats) {
          const seat = seatsBy.get(n);
          if (!seat) continue;
          const spot = () => geo.seat(seat.rel);
          core.addGlow(() => ({ x: spot().x, y: spot().y }), 160 * spot().s, 150 * spot().s, GOLD);
        }
        await (animate ? payPot(result.winnerSeats) : Promise.resolve(setPot(0, null)));
        if (roundId) sounds.resultShown?.(roundId);
      } else {
        void core.hideBanner(animate);
        void core.clearGlows(animate);
      }
    }
    await Promise.all([...dealJobs, ...burnJobs, ...boardJobs, ...flips]);
    styleCards(next);
  };

  let pending: HoldemStageState | null = null;
  let running = false;
  const drain = async () => {
    running = true;
    while (pending) {
      const next = pending;
      pending = null;
      try { await apply(next); } catch (error) { console.error("holdem stage", error); }
    }
    running = false;
  };

  core.start();
  return {
    update(next: HoldemStageState) {
      pending = next;
      if (!running) void drain();
    },
    destroy() {
      if ((host as { stageFrame?: unknown }).stageFrame === liveFrame) delete (host as { stageFrame?: unknown }).stageFrame;
      core.destroy();
    },
  };
}

