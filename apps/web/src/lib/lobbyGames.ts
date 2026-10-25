import type { GameRoom } from "@opencasino/contracts";

/**
 * The lobby's two levels both need the same answer to "which rooms belong to this game", so the
 * mapping lives here rather than being re-derived from `gameType` on each page. A game is a
 * family, not a single `gameType`: Bonus and Lightning Baccarat are baccarat to a player
 * choosing what to play, even though the server treats them as separate types.
 */
export type LobbyGameKey = "baccarat" | "dragon_tiger" | "roulette" | "sicbo" | "money_wheel" | "crash" | "slot" | "video_poker" | "pachinko" | "blackjack" | "hilo" | "bac_bo" | "mega_ball" | "top_card" | "holdem" | "sutda" | "sutda3" | "seven_poker" | "badugi" | "gostop2" | "gostop3";

export type LobbyGameMeta = {
  key: LobbyGameKey;
  /** 한글 이름(보조 글씨·접근성). */
  label: string;
  /** 줄 머리에 크게 쓰는 영어 이름. */
  en: string;
  types: ReadonlyArray<GameRoom["gameType"]>;
  /**
   * Two- and three-card Sutda share a `gameType`, so the picker would lump them together even
   * though they are different games to play. `code` is a stable seeded identifier and already
   * on the lobby payload, which splits them without a contract change.
   */
  codePrefix?: string;
  /** Baccarat and Dragon Tiger carry a bead-road history strip; it needs a wider tile. */
  road: boolean;
  /** 로비 위 칩으로 거르는 묶음. */
  category: LobbyCategory;
};

export type LobbyCategory = "table" | "quick" | "machine" | "pvp";
export const LOBBY_CATEGORIES: ReadonlyArray<{ key: LobbyCategory | "all"; label: string }> = [
  { key: "all", label: "전체" },
  { key: "table", label: "테이블" },
  { key: "quick", label: "빠른 게임" },
  { key: "machine", label: "머신" },
  { key: "pvp", label: "PvP" },
];

export const LOBBY_GAMES: ReadonlyArray<LobbyGameMeta> = [
  {
    key: "baccarat", category: "table",
    label: "바카라", en: "BACCARAT",
    types: ["baccarat", "bonus_baccarat", "lightning_baccarat"],
    road: true,
  },
  {
    key: "dragon_tiger", category: "table",
    label: "용호", en: "DRAGON TIGER",
    types: ["dragon_tiger"],
    road: true,
  },
  {
    key: "roulette", category: "table",
    label: "룰렛", en: "ROULETTE",
    types: ["roulette", "lightning_roulette"],
    road: false,
  },
  {
    key: "sicbo", category: "table",
    label: "식보", en: "SIC BO",
    types: ["sic_bo", "super_sic_bo"],
    road: false,
  },
  {
    key: "money_wheel", category: "table",
    label: "머니 휠", en: "MONEY WHEEL",
    types: ["money_wheel"],
    road: false,
  },
  {
    key: "crash", category: "quick",
    label: "크래시", en: "CRASH",
    types: ["crash"],
    road: false,
  },
  {
    key: "slot", category: "machine",
    label: "슬롯", en: "SLOTS",
    types: ["slot"],
    road: false,
  },
  {
    key: "video_poker", category: "machine",
    label: "비디오 포커", en: "VIDEO POKER",
    types: ["video_poker"],
    road: false,
  },
  {
    key: "pachinko", category: "machine",
    label: "파친코", en: "PACHINKO",
    types: ["pachinko"],
    road: false,
  },
  {
    key: "blackjack", category: "table",
    label: "블랙잭", en: "BLACKJACK",
    types: ["blackjack", "lightning_blackjack"],
    road: false,
  },
  // 하이로우(1인용 연속 도전, HiLoRoomPage).
  { key: "hilo", category: "quick", label: "하이로우", en: "HI-LO", types: ["hilo"], road: false },
  // 표 게임(game-core table-games): 판 전체가 같은 결과에 거는 하우스 게임. 방 화면은 모두 TableGameRoomPage.
  { key: "bac_bo", category: "quick", label: "박 보", en: "BAC BO", types: ["bac_bo"], road: false },
  { key: "mega_ball", category: "quick", label: "메가볼", en: "MEGA BALL", types: ["mega_ball"], road: false },
  { key: "top_card", category: "quick", label: "탑 카드", en: "TOP CARD", types: ["top_card"], road: false },
  {
    key: "holdem", category: "pvp",
    label: "홀덤", en: "HOLD’EM",
    types: ["holdem"],
    road: false,
  },
  {
    key: "sutda", category: "pvp",
    label: "섯다", en: "SUTDA",
    types: ["sutda"],
    codePrefix: "sutda-",
    road: false,
  },
  {
    key: "sutda3", category: "pvp",
    label: "3장 섯다", en: "3-CARD SUTDA",
    types: ["sutda"],
    codePrefix: "sutda3-",
    road: false,
  },
  {
    key: "seven_poker", category: "pvp",
    label: "7포커", en: "7-CARD STUD",
    types: ["seven_poker"],
    road: false,
  },
  {
    key: "badugi", category: "pvp",
    label: "바둑이", en: "BADUGI",
    types: ["badugi"],
    road: false,
  },
  {
    key: "gostop2", category: "pvp",
    label: "맞고", en: "MATGO",
    types: ["gostop"],
    codePrefix: "gostop-2p-",
    road: false,
  },
  {
    key: "gostop3", category: "pvp",
    label: "고스톱", en: "GO-STOP",
    types: ["gostop"],
    codePrefix: "gostop-3p-",
    road: false,
  },
];

export function findGame(key: string | undefined): LobbyGameMeta | undefined {
  return LOBBY_GAMES.find((game) => game.key === key);
}

/** Which lobby tab a room belongs to, e.g. so a room's back button returns to its own game list. */
export function lobbyKeyForRoom(room: Pick<GameRoom, "gameType" | "code">): LobbyGameKey {
  const match = LOBBY_GAMES.find((game) => game.types.includes(room.gameType)
    && (!game.codePrefix || room.code.startsWith(game.codePrefix)));
  return match?.key ?? "baccarat";
}

/** 방 화면의 뒤로 가기: PvP 는 그 게임의 방 목록, 하우스 게임은 로비의 그 게임 줄(방 목록 화면이 없다). */
export function roomBackHref(room: Pick<GameRoom, "gameType" | "code">): string {
  const key = lobbyKeyForRoom(room);
  return findGame(key)?.category === "pvp" ? `/lobby/${key}` : `/lobby#${key}`;
}

export function roomsForGame(game: LobbyGameMeta, rooms: GameRoom[]): GameRoom[] {
  return rooms.filter((room) => game.types.includes(room.gameType)
    && (!game.codePrefix || room.code.startsWith(game.codePrefix)));
}

/** Paused rooms can't be entered, so they sink. Everything else keeps the server's order. */
export function joinableFirst(rooms: GameRoom[]): GameRoom[] {
  return [...rooms].sort((a, b) => Number(a.paused) - Number(b.paused));
}

export function roomHref(room: Pick<GameRoom, "id" | "gameType">): string {
  switch (room.gameType) {
    case "blackjack":
    case "lightning_blackjack": return `/rooms/blackjack/${room.id}`;
    case "dragon_tiger": return `/rooms/dragon-tiger/${room.id}`;
    case "roulette":
    case "lightning_roulette": return `/rooms/roulette/${room.id}`;
    case "sic_bo":
    case "super_sic_bo": return `/rooms/sicbo/${room.id}`;
    case "money_wheel": return `/rooms/money-wheel/${room.id}`;
    case "bac_bo":
    case "mega_ball":
    case "top_card": return `/rooms/table/${room.id}`;
    case "crash": return `/rooms/crash/${room.id}`;
    case "slot": return `/rooms/slot/${room.id}`;
    case "video_poker": return `/rooms/video-poker/${room.id}`;
    case "pachinko": return `/rooms/pachinko/${room.id}`;
    case "hilo": return `/rooms/hilo/${room.id}`;
    case "holdem": return `/rooms/holdem/${room.id}`;
    case "sutda": return `/rooms/sutda/${room.id}`;
    case "seven_poker": return `/rooms/seven-poker/${room.id}`;
    case "badugi": return `/rooms/badugi/${room.id}`;
    case "gostop": return `/rooms/gostop/${room.id}`;
    default: return `/rooms/${room.id}`;
  }
}

/**
 * Screen-reader text for a room's state. Every phase needs an entry: the lobby used to print
 * `room.phase` for anything that wasn't WAITING, so a busy table announced itself as "BETTING"
 * in an otherwise Korean UI.
 */
export const PHASE_LABEL: Record<GameRoom["phase"], string> = {
  WAITING: "대기 중",
  BETTING: "베팅 중",
  LOCKED: "베팅 마감",
  DEALING: "카드 분배 중",
  INSURANCE: "인슈어런스",
  PLAYER_TURN: "플레이어 차례",
  DEALER_TURN: "딜러 차례",
  SETTLING: "정산 중",
  RESULT: "결과",
};

/** Only the road games carry a history strip; the rest simply render one element fewer. */
export function roadLabels(room: GameRoom): { player: string; banker: string } | null {
  if (room.gameType === "dragon_tiger") return { player: "D", banker: "T" };
  if (room.gameType === "baccarat" || room.gameType === "bonus_baccarat" || room.gameType === "lightning_baccarat") {
    return { player: "P", banker: "B" };
  }
  return null;
}
