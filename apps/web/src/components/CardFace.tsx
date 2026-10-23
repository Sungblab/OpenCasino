import { DEFAULT_EQUIPMENT, shopItem, type Card } from "@opencasino/contracts";

const SUIT_GLYPH: Record<Card["suit"], string> = { H: "♥", D: "♦", C: "♣", S: "♠" };
/**
 * 그림 카드(J·Q·K)와 뒷면은 WebP 로 쓴다. 원본 SVG 는 그림이 세밀한 벡터 경로라 한 장이 300~700KB
 * 였고(덱 전체 6.4MB 중 그림 카드 12장이 5.8MB), 화면에 보이는 크기는 폭 100px 안팎이라 그 정밀도가
 * 필요 없었다. 330×462 로 래스터화하면 장당 40KB 대다. 숫자 카드는 SVG 도 작아서 그대로 둔다.
 * 뒷면은 상점에서 고른 것(cardBackUrl)이다.
 */
const RASTER_RANKS = new Set<Card["rank"]>(["J", "Q", "K"]);

/**
 * 상점에서 장착한 카드 뒷면·펠트. 로그인 뒤 진행도(/me/progress)를 받을 때와 상점에서 장착할 때 localStorage 에
 * 적어 두고, DOM 카드·3D 테이블·Pixi 무대가 만들 때 한 번 읽는다(이미 그려진 테이블은 다음에 들어올 때 바뀐다).
 * 저장소를 못 쓰거나 비었으면 기본 아이템.
 */
const EQUIPPED_KEY = "opencasino.equipped";
const DEFAULT_CARD_BACK = shopItem(DEFAULT_EQUIPMENT.card_back!)!.value;
const DEFAULT_FELT = shopItem(DEFAULT_EQUIPMENT.felt!)!.value;

function readEquipped(): { cardBack?: unknown; felt?: unknown } {
  try {
    return JSON.parse(localStorage.getItem(EQUIPPED_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

export function cardBackUrl(): string {
  const url = readEquipped().cardBack;
  return typeof url === "string" && url.startsWith("/cards/") ? url : DEFAULT_CARD_BACK;
}

/** 장착한 펠트 값("classic"·"burgundy"…). 3D 테이블 색은 D 단계에서 이 값을 읽는다. */
export function equippedFelt(): string {
  const felt = readEquipped().felt;
  return typeof felt === "string" ? felt : DEFAULT_FELT;
}

export function rememberEquipment(equipped: { cardBack: string; felt: string }): void {
  try {
    localStorage.setItem(EQUIPPED_KEY, JSON.stringify({ cardBack: equipped.cardBack, felt: equipped.felt }));
  } catch {
    // 저장소를 못 쓰는 창 — 기본 뒷면으로 그린다.
  }
}

const RANKS: Card["rank"][] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS: Card["suit"][] = ["H", "D", "C", "S"];

const imageLoads = new Map<string, Promise<void>>();
const imageReady = new Set<string>();

export function cardFaceUrl(card: Pick<Card, "rank" | "suit">): string {
  return `/cards/opendecks/${card.rank}${card.suit}.${RASTER_RANKS.has(card.rank) ? "webp" : "svg"}`;
}

/** High-density face-card art for 3D tables; regular DOM cards keep the smaller download. */
export function cardStageFaceUrl(card: Pick<Card, "rank" | "suit">): string {
  return RASTER_RANKS.has(card.rank)
    ? `/cards/opendecks/hires/${card.rank}${card.suit}.webp`
    : cardFaceUrl(card);
}

/** True once the asset is decoded, so a card can render its face without a wait tick. */
export function isCardImageReady(src: string): boolean {
  return imageReady.has(src);
}

export function preloadCardImage(src: string): Promise<void> {
  const existing = imageLoads.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    const done = () => { imageReady.add(src); resolve(); };
    image.onload = done;
    image.onerror = done;
    image.src = src;
  });
  imageLoads.set(src, promise);
  return promise;
}

let deckWarmed = false;
/**
 * Warm the whole 52-card deck (plus the back and 3D face-card art) once per
 * session, off the critical path. Without this the first appearance of any rank
 * waits on its own network round trip, so an opening deal reveals its cards in
 * load order rather than in dealing order. Room pages call this on mount.
 */
export function preloadDeck(): void {
  if (deckWarmed || typeof window === "undefined") return;
  deckWarmed = true;
  const warm = () => {
    void preloadCardImage(cardBackUrl());
    for (const rank of RANKS) for (const suit of SUITS) void preloadCardImage(cardFaceUrl({ rank, suit }));
    for (const rank of RASTER_RANKS) for (const suit of SUITS) void preloadCardImage(cardStageFaceUrl({ rank, suit }));
  };
  const idle = (window as typeof window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (idle) idle(warm);
  else window.setTimeout(warm, 300);
}

/** CC0 OpenDecks artwork, served locally so every rank stays crisp at any size. */
export function CardFace({ card }: { card: Card }) {
  return (
    <img
      className="card-face-svg card-face-image"
      src={cardFaceUrl(card)}
      alt={`${card.rank} ${SUIT_GLYPH[card.suit]}`}
      draggable={false}
    />
  );
}

/** Matching OpenDecks card back used for deal flips and the blackjack hole card. */
export function CardBackFace() {
  return <img className="card-face-svg card-face-image" src={cardBackUrl()} alt="" aria-hidden="true" draggable={false} />;
}
