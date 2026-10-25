import { randomBytes, randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import {
  COIN_SCALE,
  CUSTOM_ROOM_IDLE_MS,
  PRIVATE_CODE_ALPHABET,
  PRIVATE_CODE_LENGTH,
  ROOM_CREATE_FEE,
  ROOM_CREATE_VIP_MIN,
  TABLE_TIER_LABEL,
  checkTierGate,
  customRoomGame,
  normalizePrivateCode,
  vipRank,
  type CustomRoomCreate,
  type CustomRoomGame,
  type GameRoom,
  type QuickMatchRequest,
  type TableTier,
} from "@opencasino/contracts";
import type { AuthUser } from "../auth/auth.js";
import { config } from "../config.js";
import { inTransaction } from "../database/audit-log.js";
import { pool } from "../database/pool.js";
import { DomainError } from "../errors/domain-error.js";
import type { CustomRoomRow, RoomRegistry } from "../games/rooms/room-registry.js";
import { walletService } from "../wallet/wallet-service.js";
import { gateError, gateProfile } from "./tier-gate.js";

/**
 * PvP 방 만들기·빠른 시작(스펙 §3.2·§3.3). 방 줄·방 예치 계정·개설비 원장을 한 트랜잭션에 적고, 커밋한 뒤
 * RoomRegistry.addRoom 으로 액터를 띄운다. 사람이 없는 채로 CUSTOM_ROOM_IDLE_MS 가 지나면 reapIdleCustomRooms 가 닫는다.
 *
 * 판돈은 같은 게임·같은 등급의 시드 방 값을 그대로 쓴다(contracts rooms.ts 주석). 개설자 권한(강퇴·설정 변경)은 없다.
 */

function gameOf(gameType: string, variant: CustomRoomGame["variant"] | undefined): CustomRoomGame {
  const game = customRoomGame(gameType, variant ?? "two");
  if (!game) throw new DomainError("CUSTOM_ROOM_UNAVAILABLE");
  return game;
}

function isGame(room: GameRoom, game: CustomRoomGame): boolean {
  return room.gameType === game.gameType && room.code.startsWith(game.codePrefix);
}

/** 같은 게임·같은 등급의 시드 방. 판돈을 여기서 빌린다. 없으면 그 등급은 열 수 없다. */
function templateRoom(rooms: RoomRegistry, game: CustomRoomGame, tier: TableTier): GameRoom {
  const template = rooms.listRooms().find((room) => !room.custom && isGame(room, game) && (room.tier ?? "rookie") === tier);
  if (!template) throw new DomainError("CUSTOM_ROOM_UNAVAILABLE");
  return template;
}

function newPrivateCode(): string {
  let code = "";
  for (let index = 0; index < PRIVATE_CODE_LENGTH; index += 1) code += PRIVATE_CODE_ALPHABET[randomInt(PRIVATE_CODE_ALPHABET.length)];
  return code;
}

/** 방 줄과 방 예치 계정. 액터는 커밋 뒤에 부르는 쪽이 띄운다. */
async function insertRoom(
  client: PoolClient,
  room: { game: CustomRoomGame; tier: TableTier; template: GameRoom; name: string; owner: AuthUser | null; privateCode: string | null },
): Promise<CustomRoomRow> {
  const code = `${room.game.codePrefix}c-${randomBytes(6).toString("hex")}`;
  // ponytail: 비공개 코드는 31^6(약 8.9억) 중 하나라 겹침 확인을 하지 않는다 — 열린 방끼리 겹치면 유일 인덱스가 막고 그 요청만 실패한다.
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO game_rooms (game_type,code,name,min_bet,max_bet,side_bet_max,enabled,variant,tier,created_by,private_code)
     VALUES ($1,$2,$3,$4,$5,NULL,true,$6,$7,$8,$9) RETURNING id`,
    [room.game.gameType, code, room.name, room.template.minBet, room.template.maxBet, room.game.variant, room.tier, room.owner?.id ?? null, room.privateCode],
  );
  const id = inserted.rows[0]!.id;
  await client.query("INSERT INTO wallet_accounts (kind,room_id) VALUES ('room',$1)", [id]);
  return {
    id,
    game_type: room.game.gameType,
    code,
    name: room.name,
    min_bet: room.template.minBet,
    max_bet: room.template.maxBet,
    enabled: true,
    variant: room.game.variant,
    tier: room.tier,
    created_by: room.owner?.id ?? null,
    owner_nickname: room.owner?.nickname ?? null,
    private_code: room.privateCode,
  };
}

function assertCapacity(rooms: RoomRegistry): void {
  if (rooms.residentCustomRooms() >= config.customRoomCapacity) throw new DomainError("CUSTOM_ROOM_CAPACITY");
}

/** 방 만들기. 개설비(ROOM_CREATE_FEE)는 사용자 → 카지노 은행으로 소각한다. */
export async function createCustomRoom(user: AuthUser, input: CustomRoomCreate, rooms: RoomRegistry): Promise<{ room: GameRoom; privateCode: string | null }> {
  const game = gameOf(input.gameType, input.variant);
  const template = templateRoom(rooms, game, input.tier);
  assertCapacity(rooms);
  const fee = ROOM_CREATE_FEE[input.tier];
  const row = await inTransaction(async (client) => {
    // 같은 사람이 동시에 두 번 눌러 한 사람 한 방을 넘기지 않게 사람 단위로 줄 세운다.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`custom-room:${user.id}`]);
    if (user.role !== "admin") {
      const profile = await gateProfile(user.id, client);
      if (input.tier === "vip" && vipRank(profile.vip) < vipRank(ROOM_CREATE_VIP_MIN)) throw new DomainError("CUSTOM_ROOM_VIP_REQUIRED");
      // 개설비를 내고도 그 등급에 들어갈 수 있어야 한다 — 내고 나서 자기 방에 못 들어가는 일이 없게.
      const failure = checkTierGate(input.tier, true, { ...profile, balance: profile.balance - fee });
      if (failure) throw gateError(failure);
    }
    const mine = await client.query("SELECT 1 FROM game_rooms WHERE created_by=$1 AND closed_at IS NULL LIMIT 1", [user.id]);
    if (mine.rows[0]) throw new DomainError("CUSTOM_ROOM_LIMIT");
    const row = await insertRoom(client, {
      game,
      tier: input.tier,
      template,
      name: input.name?.trim() || `${user.nickname}의 방`,
      owner: user,
      privateCode: input.private ? newPrivateCode() : null,
    });
    const accounts = await client.query<{ id: string; kind: string }>("SELECT id,kind FROM wallet_accounts WHERE kind='house' OR (kind='user' AND user_id=$1)", [user.id]);
    const house = accounts.rows.find((account) => account.kind === "house");
    const wallet = accounts.rows.find((account) => account.kind === "user");
    if (!house || !wallet) throw new Error("Wallet account configuration is incomplete");
    // 모자라면 postTransaction 이 INSUFFICIENT_BALANCE 로 던지고 방 줄까지 함께 되돌린다.
    await walletService.postTransaction(client, {
      type: "ROOM_FEE",
      idempotencyKey: `room-fee:${row.id}`,
      referenceType: "game_room",
      referenceId: row.id,
      entries: [{ accountId: wallet.id, amountMinor: -fee * COIN_SCALE }, { accountId: house.id, amountMinor: fee * COIN_SCALE }],
      metadata: { tier: input.tier, gameType: game.gameType, variant: game.variant, code: row.code },
    });
    return row;
  });
  return { room: rooms.addRoom(row), privateCode: row.private_code ?? null };
}

/**
 * 빠른 시작: ① 그 게임·등급의 공개 방 중 사람이 기다리는 방(사람 많은 순) ② 빈자리 있는 시드 방(과 이미 연 시스템 방)
 * ③ 없으면 시스템 공개 방을 새로 연다(created_by NULL, 개설비 없음, 빈 방 닫기 대상).
 */
export async function quickMatch(user: AuthUser, input: QuickMatchRequest, rooms: RoomRegistry): Promise<GameRoom> {
  const game = gameOf(input.gameType, input.variant);
  const template = templateRoom(rooms, game, input.tier);
  if (user.role !== "admin") {
    const failure = checkTierGate(input.tier, true, await gateProfile(user.id));
    if (failure) throw gateError(failure);
  }
  const open = rooms.publicRooms().filter((room) =>
    room.enabled && !room.paused && isGame(room, game) && (room.tier ?? "rookie") === input.tier && (room.seatsTaken ?? 0) < (room.seatCount ?? 0));
  const waiting = open
    .map((room) => ({ room, humans: rooms.humanCount(room.id) }))
    .filter((entry) => entry.humans > 0)
    .sort((a, b) => b.humans - a.humans);
  if (waiting[0]) return waiting[0].room;
  // 빈 방이 여럿이면(등급마다 시드 방이 여러 개) 늘 같은 방부터 — 시드 방이 먼저, 그다음 code 순. 그래야 혼자 온 사람들이
  // 빈 방 여기저기로 흩어지지 않고 먼저 온 사람이 있는 방(위 ①)으로 모인다.
  const unowned = open
    .filter((room) => !room.ownerNickname)
    .sort((a, b) => Number(Boolean(a.custom)) - Number(Boolean(b.custom)) || a.code.localeCompare(b.code))[0];
  if (unowned) return unowned;
  assertCapacity(rooms);
  const row = await inTransaction((client) => insertRoom(client, {
    game,
    tier: input.tier,
    template,
    name: `${game.label} ${TABLE_TIER_LABEL[input.tier]} 빠른 방`,
    owner: null,
    privateCode: null,
  }));
  return rooms.addRoom(row);
}

/** 비공개 방 코드(/r/:code) → 방. 닫힌 방이면 없다. */
export async function roomForCode(rawCode: string, rooms: RoomRegistry): Promise<GameRoom> {
  const code = normalizePrivateCode(rawCode);
  if (code.length !== PRIVATE_CODE_LENGTH) throw new DomainError("CUSTOM_ROOM_NOT_FOUND");
  const result = await pool.query<{ id: string }>("SELECT id FROM game_rooms WHERE private_code=$1 AND closed_at IS NULL", [code]);
  const id = result.rows[0]?.id;
  const room = id ? rooms.listRooms().find((entry) => entry.id === id && entry.enabled) : undefined;
  if (!room) throw new DomainError("CUSTOM_ROOM_NOT_FOUND");
  return room;
}

/**
 * 사람(봇 제외) 없이 CUSTOM_ROOM_IDLE_MS 가 지난 사용자 방을 닫는다. 닫은 수를 돌려준다. 문(메모리)부터 닫고 DB 에
 * 적는다 — 적는 사이에 누가 들어와 닫힌 방에 남지 않게. 빈 닫힌 액터는 마지막에 치운다(남은 봇 판이 끝난 뒤 다음 번에).
 */
export async function reapIdleCustomRooms(rooms: RoomRegistry, nowMs = Date.now()): Promise<number> {
  const idle = rooms.idleCustomRooms(nowMs, CUSTOM_ROOM_IDLE_MS);
  for (const roomId of idle) rooms.closeRoom(roomId);
  if (idle.length > 0) {
    try {
      await pool.query("UPDATE game_rooms SET enabled=false, closed_at=now() WHERE id=ANY($1::uuid[]) AND closed_at IS NULL", [idle]);
    } catch (error) {
      for (const roomId of idle) rooms.reopenRoom(roomId);
      throw error;
    }
  }
  rooms.residentCustomRooms();
  return idle.length;
}
