import { z } from "zod";
import { TABLE_TIERS } from "./economy.js";

/**
 * PvP 방 만들기·빠른 시작(스펙 §3.2·§3.3). 개설비·등급 조건 숫자는 economy.ts 에 있다.
 *
 * 판돈은 고르지 않는다 — 같은 게임·같은 등급의 시드 방과 같은 값으로 연다. 게임 코드가 시험한 조합 밖의 숫자를
 * 사용자가 넣게 하지 않으려는 것이고, 그래서 시드 방이 없는 등급(고스톱 고액 등)은 만들 수 없다.
 *
 * 이 파일은 index.ts 를 import 하지 않는다(index 가 이 파일을 다시 내보내므로 순환이 된다).
 */

export const tableTierSchema = z.enum(TABLE_TIERS);

export type CustomRoomGameType = "holdem" | "sutda" | "seven_poker" | "badugi" | "gostop";
export type RoomVariant = "two" | "three";

export interface CustomRoomGame {
  /** 웹 로비의 게임 키(lib/lobbyGames.ts)와 같다. */
  key: "holdem" | "sutda" | "sutda3" | "seven_poker" | "badugi" | "gostop2" | "gostop3";
  label: string;
  gameType: CustomRoomGameType;
  variant: RoomVariant;
  /** 방 code 의 앞부분. 웹이 code 접두사로 2장/3장 섯다, 맞고/3인 고스톱을 가른다. */
  codePrefix: string;
}

export const CUSTOM_ROOM_GAMES: readonly CustomRoomGame[] = [
  { key: "holdem", label: "홀덤", gameType: "holdem", variant: "two", codePrefix: "holdem-" },
  { key: "sutda", label: "섯다", gameType: "sutda", variant: "two", codePrefix: "sutda-" },
  { key: "sutda3", label: "3장 섯다", gameType: "sutda", variant: "three", codePrefix: "sutda3-" },
  { key: "seven_poker", label: "7포커", gameType: "seven_poker", variant: "two", codePrefix: "seven-poker-" },
  { key: "badugi", label: "바둑이", gameType: "badugi", variant: "two", codePrefix: "badugi-" },
  { key: "gostop2", label: "맞고", gameType: "gostop", variant: "two", codePrefix: "gostop-2p-" },
  { key: "gostop3", label: "고스톱 3인", gameType: "gostop", variant: "three", codePrefix: "gostop-3p-" },
];

export function customRoomGame(gameType: string, variant: RoomVariant = "two"): CustomRoomGame | undefined {
  return CUSTOM_ROOM_GAMES.find((game) => game.gameType === gameType && game.variant === variant);
}

export const CUSTOM_ROOM_NAME_MIN = 2;
export const CUSTOM_ROOM_NAME_MAX = 20;
/** 비공개 방 코드 길이(/r/:code). 헷갈리는 글자(0/O, 1/I/L)는 뺀다. */
export const PRIVATE_CODE_LENGTH = 6;
export const PRIVATE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function normalizePrivateCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, PRIVATE_CODE_LENGTH);
}

const gameTarget = {
  gameType: z.enum(["holdem", "sutda", "seven_poker", "badugi", "gostop"]),
  variant: z.enum(["two", "three"]).optional(),
  tier: tableTierSchema,
};

export const customRoomCreateSchema = z.object({
  ...gameTarget,
  /** 비우면 "닉네임의 방". */
  name: z.string().trim().max(CUSTOM_ROOM_NAME_MAX).refine((name) => name.length === 0 || name.length >= CUSTOM_ROOM_NAME_MIN).optional(),
  private: z.boolean().optional(),
});
export type CustomRoomCreate = z.infer<typeof customRoomCreateSchema>;

export const quickMatchSchema = z.object(gameTarget);
export type QuickMatchRequest = z.infer<typeof quickMatchSchema>;
