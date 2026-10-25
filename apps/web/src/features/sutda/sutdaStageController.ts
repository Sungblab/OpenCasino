import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { HwatuCard } from "@opencasino/contracts";
import { chipTier } from "../../lib/betting";
import { chipBreakdown, chipLayerUrl } from "../../lib/chipArt";
import { CardView, KR_FONT, NUM_FONT, createStageCore, easeIn, easeInOut, type CardDeps, type StageControllerBase, type StageSounds } from "../stage/core";
import { HWATU_RADIUS, TEX_H, TEX_W, backTexture, deckTexture, faceTexture, loadImage } from "../stage/hwatu";
import { DOCK_INSET, HWATU, SUTDA_LAYOUT_EVENT, fanOffset, modeOf, sutdaCompactSize, sutdaGeometry, sutdaHeight, sutdaMode, type SutdaGeometry, type SutdaLayoutDetail } from "./stageLayout";

/**
 * 섯다 캔버스 판. 그리는 것: 담요, 패 더미, 모든 자리의 화투(돌리기·뒤집기·걷기), 판돈 칩 더미, 결과
 * 배너와 승자 빛, 차례 시계. 이름표·버튼·말풍선·족보 태그는 캔버스 위 DOM(SutdaOverlay)이 같은
 * 좌표 계산(stageLayout)으로 올라탄다.
 *
 * 서버는 패를 한 장씩 보낸다. 새로 생긴 패만 더미에서 날리고, 판 중간에 들어왔거나 가려진 탭이면
 * 제자리에 바로 놓는다. 한 자리의 장수가 줄면(새 판·구사 재경기) 판 위의 패를 전부 걷는다.
 */

export interface SutdaStageSeat {
  seatNumber: number;
  rel: number;
  /** 배분 순서(선 다음 자리가 0). */
  dealSlot: number;
  cardCount: number;
  /** 앞면을 아는 패(내 패·쇼다운의 모두). 상대는 공개 패가 앞에 오도록 정렬해서 준다. */
  cards: HwatuCard[] | null;
  /** 모두에게 공개된 패(3장 섯다). cards 가 없는 상대는 이 패를 앞면으로 앞에, 나머지는 뒷면. */
  openCards: HwatuCard[];
  /** 앞면을 알아도 엎어 둘 패(내 쪼기 전 패). */
  hiddenIds: string[];
  /** 지금 DOM 이 대신 그리는 패(쪼는 중인 내 패). 캔버스는 그 자리를 비워 두고, 다 쪼면 뒤집기 없이 앞면으로 돌아온다. */
  ghostIds: string[];
  /** 쇼다운에서 안 쓴 패(흐리게). */
  spareIds: string[];
  /** 고르는 중이라 들어 올린 패. */
  liftedIds: string[];
  dim: "none" | "folded" | "lost";
}

export interface SutdaStageState {
  roundId: string | null;
  maxCards: number;
  seats: SutdaStageSeat[];
  pot: number;
  /** 다음 판 기리가 들어와 있다(판과 판 사이). 꺼져 있다 켜지는 순간 더미를 자르는 모습을 보여 준다. */
  cutArmed: boolean;
  caption: string | null;
  timer: { endsAt: string | null; durationMs: number | null } | null;
  /** head = "OO 승리"/"무승부 · 팟 분할"/"구사 재경기", hand = 이긴 족보, sub = 금액 줄. 넓은 화면은 head · hand 를
   *  한 줄로, 세로 폰은 옆자리 사이에 들어가게 head 만 윗줄에 두고 족보를 아랫줄로 내린다. */
  result: { key: string; head: string; hand: string | null; sub: string; winnerSeats: number[]; redeal: boolean } | null;
}

export interface SutdaStageController extends StageControllerBase<SutdaStageState> {}


type Hwatu = CardView<HwatuCard>;

const GOLD = 0xffd24a;
/** 판돈 칩(설계): 지름과 한 겹 두께. 하우스 게임과 같은 칩 그림(lib/chipArt)을 쓴다. */
const CHIP = 24;
const CHIP_STEP = 3.2;
const CHIP_DENOMS = [1000, 500, 100, 50, 10, 5, 1];
const chipTextures = new Map<number, Promise<Texture>>();
function chipTexture(tier: number): Promise<Texture> {
  let promise = chipTextures.get(tier);
  if (!promise) {
    promise = loadImage(chipLayerUrl(tier)).then((image) => (image ? Texture.from(image) : Texture.WHITE));
    chipTextures.set(tier, promise);
  }
  return promise;
}

/** 판돈 → 칩들(큰 칩이 아래). 칩이 너무 적으면 판에 아무것도 없어 보여서 큰 칩을 쪼개 여섯 장은 넘긴다. */
function potChips(amount: number): number[] {
  const chips = chipBreakdown(amount, CHIP_DENOMS, 40);
  const smaller = (value: number) => CHIP_DENOMS.find((d) => d < value && value % d === 0);
  while (chips.length < 6) {
    const index = chips.findIndex((value) => smaller(value) !== undefined);
    if (index < 0) break;
    const value = chips[index]!;
    const d = smaller(value)!;
    chips.splice(index, 1, ...Array.from({ length: value / d }, () => d));
  }
  return chips.slice(0, 28);
}

/** 같은 칩끼리 한 줄에 여덟 장까지. */
function chipStacks(chips: number[]): number[][] {
  const stacks: number[][] = [];
  for (const value of chips) {
    const last = stacks[stacks.length - 1];
    if (last && last[0] === value && last.length < 8) last.push(value);
    else stacks.push([value]);
  }
  return stacks;
}

export async function createSutdaStage(host: HTMLElement, sounds: StageSounds = {}): Promise<SutdaStageController> {
  // 배치는 캔버스가 실제로 고른 설계(core)에서 읽는다. core 가 만들어지기 전(첫 배치)엔 넓은 화면 기본값.
  let coreRef: { compact: () => boolean; designW: () => number; designH: () => number } | null = null;
  const geometryFor = (): SutdaGeometry => (coreRef
    ? sutdaGeometry(modeOf(coreRef.compact(), coreRef.designH()), coreRef.designW(), coreRef.designH(), maxCards)
    : sutdaGeometry("wide", 640, 400, maxCards));
  let maxCards = 2;
  const core = await createStageCore(host, sounds, {
    // 군용 담요: 짙은 올리브. 카지노 테이블이 아니라 곡선 인쇄도 없다.
    felt: { inner: "#5d6a36", mid: "#434d24", outer: "#1d2210", arc: false },
    minW: 640,
    height: (w, h) => sutdaHeight(w, h, host.clientHeight),
    compact: sutdaCompactSize,
    bannerY: () => geometryFor().banner.y,
    props: false,
    status: false,
    // 독 자리. 배치는 판 전체 크기로 고른다(독을 뺀 높이로 고르면 배치 ↔ 독 높이가 서로 물고 돈다).
    insets: () => ({ top: 0, bottom: DOCK_INSET[sutdaMode(host.clientWidth, host.clientHeight)] }),
    // 가운데 시계는 판돈 옆에 작게(기본 크기는 하우스 게임의 판 한가운데용이라 섯다엔 너무 컸다).
    timerScale: 0.56,
    name: "sutda",
  });
  coreRef = core;
  const { tween, wait, layers } = core;
  const [back, deckArt, chipTex] = await Promise.all([backTexture(), deckTexture(), Promise.all([0, 1, 2, 3, 4].map(chipTexture))]);
  let geo = geometryFor();

  /* 패 더미 */
  const deck = new Container();
  const DECK_SCALE = () => (geo.mode === "tall" ? 0.56 : 0.62);
  /** 두께가 보이는 더미 한 장. 맨 위 패의 가운데가 원점, 크기는 화투 한 장 기준. */
  const deckSprite = () => {
    const sprite = new Sprite(deckArt.texture);
    sprite.anchor.set(deckArt.anchor.x, deckArt.anchor.y);
    sprite.scale.set(HWATU.w / TEX_W);
    return sprite;
  };
  deck.addChild(deckSprite());
  layers.table.addChild(deck);

  const deps: CardDeps = {
    tween,
    wait,
    sounds,
    back,
    size: { w: HWATU.w, h: HWATU.h, texW: TEX_W, texH: TEX_H },
    radius: HWATU.w * HWATU_RADIUS,
    thickness: 2,
    pullFromShoe: async () => {
      return { x: deck.x, y: deck.y, r: 0, s: DECK_SCALE() };
    },
  };

  /* 판돈: 칩 더미 + 금액 알약 */
  const pile = new Container();
  layers.table.addChild(pile);
  const potPill = new Container();
  const potPillBg = new Graphics();
  const potText = core.text("", 14, 0xffd28a, NUM_FONT);
  potPill.addChild(potPillBg, potText);
  layers.table.addChild(potPill);
  const drawPotPill = () => {
    const w = potText.width + 22;
    potPillBg.clear().roundRect(-w / 2, -11, w, 22, 11).fill({ color: 0x0a0806, alpha: 0.72 }).stroke({ width: 1, color: 0xf0b41c, alpha: 0.45 });
  };
  const caption = core.text("", 12, 0xe8dcc0, KR_FONT, { fontWeight: "500" });
  caption.alpha = 0.72;
  layers.table.addChild(caption);

  /* 자리 */
  const views = new Map<number, Hwatu[]>();
  const outlines = new WeakMap<Hwatu, Graphics>();
  let seatsBySeat = new Map<number, SutdaStageSeat>();
  let state: SutdaStageState | null = null;
  let first = true;
  let roundId: string | null = null;
  let resultKey: string | null = null;
  let cutArmed = false;

  const slotFor = (seat: SutdaStageSeat, index: number, count: number, lifted: boolean) => {
    const spot = geo.seat(seat.rel);
    return {
      x: spot.x + fanOffset(index, count, spot.scale),
      y: spot.y - (lifted ? 14 * spot.scale : 0),
      r: (index - (count - 1) / 2) * 0.07,
      s: spot.scale,
    };
  };

  const outlineOf = (view: Hwatu) => {
    let g = outlines.get(view);
    if (!g) {
      g = new Graphics().roundRect(-HWATU.w / 2 - 2, -HWATU.h / 2 - 2, HWATU.w + 4, HWATU.h + 4, HWATU.w * HWATU_RADIUS + 2).stroke({ width: 2.5, color: GOLD });
      g.visible = false;
      view.addChild(g);
      outlines.set(view, g);
    }
    return g;
  };

  /** 자리 옮기기: 뛰지 않고 미끄러진다(core 의 moveTo 는 살짝 떠오르는 호를 그려서, 갱신마다 패가 폴짝거렸다).
   *  이미 그 자리면 아무것도 안 한다. */
  const slide = (view: Hwatu, slot: { x: number; y: number; r: number }, animate: boolean) => {
    if (Math.abs(view.x - slot.x) < 0.5 && Math.abs(view.y - slot.y) < 0.5 && Math.abs(view.rotation - slot.r) < 0.01) return;
    if (!animate) { view.place(slot); return; }
    const x0 = view.x;
    const y0 = view.y;
    const r0 = view.rotation;
    void tween(200, (p) => {
      if (view.destroyed) return; // 새 판이 걷어 간 패 — 미끄러지던 중이었을 수 있다.
      view.x = x0 + (slot.x - x0) * p;
      view.y = y0 + (slot.y - y0) * p;
      view.rotation = r0 + (slot.r - r0) * p;
    }, easeInOut);
  };

  /** 한 자리의 패 목록: [패, 앞면인가]. */
  const wanted = (seat: SutdaStageSeat): Array<{ card: HwatuCard | null; face: boolean }> => {
    const list: Array<{ card: HwatuCard | null; face: boolean }> = seat.cards
      ? seat.cards.map((card) => ({ card, face: !seat.hiddenIds.includes(card.id) }))
      : seat.openCards.map((card) => ({ card, face: true }));
    while (list.length < seat.cardCount) list.push({ card: null, face: false });
    return list;
  };

  const styleView = (seat: SutdaStageSeat, view: Hwatu) => {
    const id = view.card?.id;
    if (view.settled) view.visible = !(id && seat.ghostIds.includes(id));
    const spare = Boolean(id && seat.spareIds.includes(id));
    // 안 쓴 셋째 장은 진 패보다 한 톤 더 어둡게 — 둘이 같은 0.5 였을 땐 진 자리에서 어느 두 장으로 겨뤘는지 안 보였다.
    view.alpha = seat.dim === "folded" ? 0.38 : spare ? 0.3 : seat.dim === "lost" ? 0.55 : 1;
    const lifted = Boolean(id && seat.liftedIds.includes(id));
    if (lifted || outlines.has(view)) outlineOf(view).visible = lifted;
  };

  const placeAll = () => {
    for (const [seatNumber, list] of views) {
      const seat = seatsBySeat.get(seatNumber);
      if (!seat) continue;
      list.forEach((view, index) => {
        if (!view.settled) return;
        const slot = slotFor(seat, index, list.length, Boolean(view.card && seat.liftedIds.includes(view.card.id)));
        view.place(slot);
        view.scale.set(slot.s);
      });
    }
  };

  /** 판 위의 패를 전부 걷는다: 더미(없으면 위쪽 밖)로 모이며 사라진다. */
  const sweep = async (animate: boolean) => {
    const all = [...views.values()].flat();
    views.clear();
    if (!animate) { for (const view of all) view.destroy({ children: true }); return; }
    const to = geo.deck;
    await Promise.all(all.map((view, i) => wait(i * 35).then(async () => {
      const x0 = view.x;
      const y0 = view.y;
      const r0 = view.rotation;
      const s0 = view.scale.x;
      if (view.face.visible) view.showBack();
      await tween(360, (p) => {
        view.x = x0 + (to.x - x0) * p;
        view.y = y0 + (to.y - y0) * p;
        view.rotation = r0 * (1 - p);
        view.scale.set(s0 + (DECK_SCALE() - s0) * p);
        view.alpha = 1 - p * 0.6;
      }, easeIn);
      view.destroy({ children: true });
    })));
  };

  /* 판돈 칩 더미 */
  let pileKey = "";
  const setPile = (amount: number, animate: boolean) => {
    const stacks = amount > 0 ? chipStacks(potChips(amount)) : [];
    const key = stacks.map((stack) => `${stack[0]}x${stack.length}`).join(",");
    if (key === pileKey) return;
    const before = new Map((pileKey ? pileKey.split(",") : []).map((part, i) => [i, part]));
    pileKey = key;
    pile.removeChildren().forEach((child) => child.destroy({ children: true }));
    const n = stacks.length;
    // 한 줄에 다섯 더미까지, 넘치면 뒤쪽 줄. 가운데를 기준으로 지그재그로 살짝 어긋나게.
    const columns: Container[] = [];
    stacks.forEach((stack, i) => {
      const row = Math.floor(i / 5);
      const inRow = Math.min(5, n - row * 5);
      const col = i % 5;
      const column = new Container();
      column.position.set((col - (inRow - 1) / 2) * (CHIP + 3), (col % 2) * 4 - row * 14);
      const had = before.get(i);
      const hadCount = had && had.startsWith(`${stack[0]}x`) ? Number(had.split("x")[1]) : 0;
      stack.forEach((value, j) => {
        const chip = new Sprite(chipTex[chipTier(value)] ?? Texture.WHITE);
        chip.anchor.set(0.5);
        chip.width = CHIP;
        chip.height = CHIP;
        const y = -j * CHIP_STEP;
        column.addChild(chip);
        if (animate && j >= hadCount) {
          chip.y = y - 26;
          chip.alpha = 0;
          void wait((j - hadCount) * 40).then(() => tween(240, (p) => { if (chip.destroyed) return; chip.y = y - 26 * (1 - p); chip.alpha = Math.min(1, p * 2); }));
        } else chip.y = y;
      });
      columns.push(column);
    });
    // 뒤쪽(위쪽) 더미부터 그려야 앞 더미가 그 위에 온다.
    if (columns.length > 0) pile.addChild(...columns.sort((a, b) => a.y - b.y));
  };

  /**
   * 기리: 윗뭉치를 떼어 옆에 놓고, 남은 아랫뭉치를 들어 그 위에 포갠 뒤 제자리로. 실제 화투판처럼
   * 한 번만 깔끔하게 자른다. 뭉치를 드는 순간에만 살짝 떠오른다.
   */
  const cutDeck = async () => {
    const k = DECK_SCALE();
    const step = { x: -1.4 * k, y: -1.8 * k };
    const packet = (_n: number) => {
      const c = new Container();
      c.addChild(deckSprite());
      c.scale.set(k);
      return c;
    };
    const home = { x: deck.x, y: deck.y };
    const aside = { x: home.x + 46, y: home.y - 4 };
    const bottom = packet(3);
    const top = packet(3);
    bottom.position.set(home.x, home.y);
    top.position.set(home.x + step.x * 3, home.y + step.y * 3);
    deck.visible = false;
    layers.fx.addChild(bottom, top);
    const move = (c: Container, to: { x: number; y: number }, ms: number, lift: number) => {
      const x0 = c.x;
      const y0 = c.y;
      return tween(ms, (p) => {
        c.x = x0 + (to.x - x0) * p;
        c.y = y0 + (to.y - y0) * p - Math.sin(p * Math.PI) * lift;
      }, easeInOut);
    };
    sounds.deal?.();
    await move(top, aside, 320, 10);
    await wait(90);
    layers.fx.addChild(bottom);
    sounds.deal?.();
    await move(bottom, { x: aside.x + step.x * 3, y: aside.y + step.y * 3 }, 340, 12);
    await wait(90);
    await Promise.all([move(top, home, 260, 0), move(bottom, { x: home.x + step.x * 3, y: home.y + step.y * 3 }, 260, 0)]);
    bottom.destroy({ children: true });
    top.destroy({ children: true });
    deck.visible = true;
  };

  /** 판돈 칩 더미가 이긴 자리로 간다(여럿이면 더미를 나눠서). */
  const payPile = async (winnerSeats: number[]) => {
    const targets = winnerSeats.map((n) => seatsBySeat.get(n)).filter((seat): seat is SutdaStageSeat => Boolean(seat)).map((seat) => geo.seat(seat.rel).plate);
    const columns = [...pile.children] as Container[];
    pileKey = "";
    if (targets.length === 0 || columns.length === 0) { pile.removeChildren().forEach((child) => child.destroy({ children: true })); return; }
    await Promise.all(columns.map((column, i) => wait(i * 70).then(async () => {
      const to = targets[i % targets.length]!;
      const x0 = pile.x + column.x * pile.scale.x;
      const y0 = pile.y + column.y * pile.scale.y;
      layers.fx.addChild(column);
      column.scale.set(pile.scale.x);
      column.position.set(x0, y0);
      await tween(640, (p) => {
        column.x = x0 + (to.x - x0) * p;
        column.y = y0 + (to.y - y0) * p - Math.sin(p * Math.PI) * 36;
        column.alpha = p > 0.8 ? 1 - (p - 0.8) * 5 : 1;
      }, easeInOut);
      column.destroy({ children: true });
    })));
  };

  /** 지금 캔버스의 실제 배치. DOM 층이 상태가 바뀔 때마다 직접 물어본다(이벤트를 놓쳐도 어긋나지 않게). */
  const liveLayout = (): SutdaLayoutDetail => ({ mode: geo.mode, designW: geo.w, designH: geo.h, maxCards, scale: core.root.scale.x, x: core.root.x, y: core.root.y });
  Object.assign(host, { sutdaLayout: liveLayout });

  core.onLayout(() => {
    geo = geometryFor();
    // DOM 층에 먼저 알린다 — 아래에서 패를 다시 놓다가 멈춰도 이름표·버튼 자리는 새 배치를 따른다.
    host.dispatchEvent(new CustomEvent(SUTDA_LAYOUT_EVENT, { bubbles: true, detail: liveLayout() }));
    deck.position.set(geo.deck.x, geo.deck.y);
    deck.scale.set(DECK_SCALE());
    pile.position.set(geo.pot.x, geo.pot.y + 2);
    pile.scale.set(geo.mode === "short" ? 0.86 : 1);
    potPill.position.set(geo.pot.x, geo.pot.y + 30);
    potPill.scale.set(geo.mode === "short" ? 0.9 : 1);
    caption.position.set(geo.caption.x, geo.caption.y);
    caption.visible = geo.mode === "tall";
    if (geo.timer) core.placeBetTimer(geo.timer.x, geo.timer.y);
    try { placeAll(); } catch (error) { console.error("sutda stage layout", error); }
  });

  core.onTick(() => {
    core.drawBetTimer(state?.timer && geo.timer ? state.timer : null);
  });

  const apply = async (next: SutdaStageState) => {
    // 더 새 상태가 이미 와 있으면 이 상태는 연출 없이 지나간다 — 밀린 판을 다 그리느라 화면이 뒤처지지 않게.
    const animate = core.live(!first) && pending === null;
    first = false;
    if (next.maxCards !== maxCards) {
      maxCards = next.maxCards;
      core.relayout();
    }
    const nextBySeat = new Map(next.seats.map((seat) => [seat.seatNumber, seat]));

    // 자리를 뜬 사람의 패는 그 자리만 치운다.
    for (const [seatNumber, list] of views) {
      if (nextBySeat.has(seatNumber)) continue;
      for (const view of list) view.destroy({ children: true });
      views.delete(seatNumber);
    }
    // 새 판이거나 누군가의 장수가 줄었으면(재경기·대기로 넘어감) 판을 걷는다.
    const shrank = [...views].some(([seatNumber, list]) => (nextBySeat.get(seatNumber)?.cardCount ?? 0) < list.length);
    if ((roundId !== null && next.roundId !== roundId) || shrank) await sweep(animate);
    roundId = next.roundId;
    seatsBySeat = nextBySeat;
    if (next.cutArmed && !cutArmed && animate) await cutDeck();
    cutArmed = next.cutArmed;

    // 텍스처를 먼저 다 받아 둔다(처음 보는 패만 실제로 기다린다).
    const known = next.seats.flatMap((seat) => [...(seat.cards ?? []), ...seat.openCards]);
    const faces = new Map(await Promise.all(known.map(async (card) => [card.id, await faceTexture(card)] as const)));

    const deals: Array<{ seat: SutdaStageSeat; index: number; view: Hwatu; face: boolean }> = [];
    const flips: Array<Promise<void>> = [];
    for (const seat of next.seats) {
      const want = wanted(seat);
      const list = views.get(seat.seatNumber) ?? [];
      views.set(seat.seatNumber, list);
      want.forEach((entry, index) => {
        let view = list[index];
        if (!view) {
          view = core.layers.card.addChild(new CardView<HwatuCard>(deps, entry.card, entry.card ? faces.get(entry.card.id) ?? null : null, 1)) as Hwatu;
          // 날아오기 전까지는 (0,0) 에 한 프레임도 보이면 안 된다.
          view.visible = false;
          list[index] = view;
          deals.push({ seat, index, view, face: entry.face });
          return;
        }
        if (entry.card && view.card?.id !== entry.card.id) view.setCard(entry.card, faces.get(entry.card.id)!);
        if (entry.face && !view.face.visible && view.card) {
          // DOM 이 쪼아서 이미 앞면을 보여 준 패는 다시 뒤집지 않는다.
          const wasGhost = view.settled && !view.visible;
          if (animate && view.settled && !wasGhost) flips.push(view.flip(420));
          else view.showFace();
        } else if (!entry.face && view.face.visible) view.showBack();
      });
    }
    for (const seat of next.seats) for (const view of views.get(seat.seatNumber) ?? []) styleView(seat, view);

    // 새 패: 한 바퀴씩(장 번호 → 선 다음 자리부터) 더미에서 날린다.
    deals.sort((a, b) => a.index - b.index || a.seat.dealSlot - b.seat.dealSlot);
    if (animate && deals.length > 0) {
      const flights = deals.map((deal, i) => wait(i * 120).then(async () => {
        const list = views.get(deal.seat.seatNumber) ?? [];
        const slot = slotFor(deal.seat, deal.index, Math.max(list.length, deal.index + 1), false);
        await deal.view.dealTo({ x: slot.x, y: slot.y, r: slot.r }, { faceUp: deal.face, ms: 420 });
        deal.view.scale.set(slot.s);
        deal.view.settled = true;
        styleView(deal.seat, deal.view);
      }));
      // 셋째 장이 오면 앞의 두 장이 자리를 비켜 준다.
      for (const seat of next.seats) {
        const list = views.get(seat.seatNumber) ?? [];
        list.forEach((view, index) => {
          if (!view.settled) return;
          const slot = slotFor(seat, index, list.length, Boolean(view.card && seat.liftedIds.includes(view.card.id)));
          slide(view, slot, true);
        });
      }
      await Promise.all([...flights, ...flips]);
    } else {
      for (const deal of deals) {
        if (deal.face) deal.view.showFace();
        deal.view.visible = true;
        deal.view.settled = true;
      }
      for (const seat of next.seats) {
        const list = views.get(seat.seatNumber) ?? [];
        list.forEach((view, index) => {
          if (!view.settled) return;
          const slot = slotFor(seat, index, list.length, Boolean(view.card && seat.liftedIds.includes(view.card.id)));
          slide(view, slot, animate);
          view.scale.set(slot.s);
        });
      }
      await Promise.all(flips);
    }

    // 판돈
    const showPot = next.pot > 0 && !next.result;
    potText.text = showPot ? `팟 ${next.pot.toLocaleString()}코인` : "";
    potPill.visible = showPot;
    if (showPot) drawPotPill();
    // 넓은 화면·가로 폰은 위쪽 진행 막대가 같은 말을 한다(겹치면 쪼기 안내와도 부딪힌다). 세로 폰만.
    caption.text = next.caption ?? "";
    caption.visible = geo.mode === "tall";
    if (!next.result) setPile(next.pot, animate);

    // 결과
    const key = next.result?.key ?? null;
    if (key !== resultKey) {
      resultKey = key;
      if (next.result) {
        const result = next.result;
        const narrow = geo.mode === "tall";
        const title = result.hand && !narrow ? `${result.head} · ${result.hand}` : result.head;
        const sub = [narrow ? result.hand : null, result.sub].filter(Boolean).join(" · ");
        void core.showBanner(title, sub, result.redeal ? 0x9aa7ff : GOLD, animate);
        for (const n of result.winnerSeats) {
          const seat = seatsBySeat.get(n);
          if (!seat) continue;
          const spot = () => geo.seat(seat.rel);
          core.addGlow(() => ({ x: spot().x, y: spot().y }), 170 * spot().scale, 150 * spot().scale, GOLD);
        }
        if (!result.redeal) await (animate ? payPile(result.winnerSeats) : Promise.resolve(setPile(0, false)));
        if (roundId) sounds.resultShown?.(roundId);
      } else {
        void core.hideBanner(animate);
        void core.clearGlows(animate);
      }
    }
  };

  // 늘 최신 상태만 그린다: 그리는 중에 새 상태가 여럿 오면 마지막 것 하나만 남긴다(중간 상태는 버린다).
  // 예전엔 상태마다 연출을 끝까지 기다려서, 봇이 빨리 치면 화면이 몇 초씩 지난 판에 머물렀다.
  let pending: SutdaStageState | null = null;
  let running = false;
  const drain = async () => {
    running = true;
    while (pending) {
      const next = pending;
      pending = null;
      try { await apply(next); } catch (error) { console.error("sutda stage", error); }
    }
    running = false;
  };

  core.start();
  return {
    update(next: SutdaStageState) {
      state = next;
      pending = next;
      if (!running) void drain();
    },
    destroy() {
      // 다시 뜬 판(StrictMode·WebGL 복구)이 같은 host 를 쓴다 — 죽은 판의 배치를 묻게 두면 던진다.
      if ((host as { sutdaLayout?: unknown }).sutdaLayout === liveLayout) delete (host as { sutdaLayout?: unknown }).sutdaLayout;
      core.destroy();
    },
  };
}

