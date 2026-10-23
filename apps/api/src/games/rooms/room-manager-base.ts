import type { AdminRoomPatch, GameRoom } from "@opencasino/contracts";
import { DomainError } from "../../errors/domain-error.js";
import { assertTierGate, PVP_GAME_TYPES } from "../../rooms/tier-gate.js";
import { isCustomRoomCode, type BaseRoomRow, type AppServer, type AppSocket, type RoomActor, type SnapshotEventName, type SnapshotOf } from "./room-actor.js";

/**
 * 한 게임 종류의 방들을 들고 있는 매니저가 레지스트리에 보여 주는 얼굴. main.ts 가 여섯 매니저를
 * `||`/`??` 로 이어 붙이던 자리(일시정지, 방 공지, 채팅 참가 확인, 연결 끊김)는 전부 이것만 본다.
 */
export interface GameRoomManager {
  /** 로그에 찍는 이름. */
  readonly game: string;
  /** 이 게임의 방 채널 접두사. 방 채팅이 모든 게임의 채널로 한 번에 보낸다. */
  readonly channelPrefix: string;
  initialize(): Promise<void>;
  owns(roomId: string): boolean;
  listRooms(): GameRoom[];
  leave(socket: AppSocket, roomId: string): Promise<void>;
  disconnect(socket: AppSocket): Promise<void>;
  isParticipant(userId: string, roomId: string): boolean;
  participantUserIds(roomId: string): string[] | null;
  setPaused(roomId: string, paused: boolean): boolean;
  /** 이 소켓의 게임 화면이 준비됐다(table.ready). 이 매니저의 방이 아니면 false. */
  markReady(socket: AppSocket, roomId: string): boolean;
  /** DEAL — 이번 판에 건 사람이 모두 누르면 베팅을 일찍 닫는다(RoomActor.requestDeal). */
  requestDeal(userId: string, roomId: string): Promise<{ started: boolean; waiting: number }>;
  /** 새로 들어오지 못하게 닫는다(빈 사용자 방 닫기). 이 매니저의 방이 아니면 false. */
  closeRoom(roomId: string): boolean;
  /** 관리자 편집(이름·한도·등급·열림)을 메모리의 방 줄에 반영한다. 이 매니저의 방이 아니면 false. */
  applyRoomEdit(roomId: string, patch: AdminRoomPatch): boolean;
  reopenRoom(roomId: string): boolean;
  /** 소켓이 붙어 있는 사람 수. 봇은 세지 않는다. 이 매니저의 방이 아니면 0. */
  humanCount(roomId: string): number;
  /** 사람이 없게 된 시각(ms). 사람이 있거나 이 매니저의 방이 아니면 null. */
  idleSince(roomId: string): number | null;
  reapClosedRooms(): number;
}

export abstract class RoomManagerBase<E extends SnapshotEventName, A extends RoomActor<BaseRoomRow, E>> implements GameRoomManager {
  protected readonly actors = new Map<string, A>();

  abstract readonly game: string;
  abstract readonly channelPrefix: string;

  constructor(protected readonly io: AppServer) {}

  /** 기동 시 복구(중단된 판 환불·정산)를 하고 방들을 만든다. 순서는 RoomRegistry.initialize 가 정한다. */
  abstract initialize(): Promise<void>;

  owns(roomId: string): boolean {
    return this.actors.has(roomId);
  }

  listRooms(): GameRoom[] {
    return [...this.actors.values()].map((actor) => actor.publicRoom());
  }

  async join(socket: AppSocket, roomId: string): Promise<SnapshotOf<E>> {
    const actor = this.actors.get(roomId);
    if (!actor?.room.enabled) throw new DomainError("ROOM_NOT_FOUND");
    // 테이블 등급의 입장 조건. 다른 명령(착석·베팅·채팅)은 전부 "참가자인가" 를 먼저 보므로 입구 한 곳만 막으면 된다.
    // 이미 안에 있거나 막 나가 자리 정리를 기다리는 사람은 다시 묻지 않는다 — 판 도중 잔액이 바뀌었다고 새로고침한
    // 사람이 자기 자리로 못 돌아오면 안 된다. 관리자는 건너뛴다.
    const user = socket.data.user;
    // 게스트(가입 없이 체험)는 하우스 게임만 — 사람끼리 판은 가입 후(게스트 여럿으로 한 계정에 코인을 몰아주지 못하게).
    if (user.guest && PVP_GAME_TYPES.has(actor.room.game_type)) throw new DomainError("GUEST_SIGNUP_REQUIRED");
    if (user.role !== "admin" && !actor.isReturning(user.id)) {
      await assertTierGate(user.id, actor.room.tier ?? "rookie", PVP_GAME_TYPES.has(actor.room.game_type));
      // 확인을 기다리는 사이에 방이 닫혔을 수 있다.
      if (!actor.room.enabled) throw new DomainError("ROOM_NOT_FOUND");
    }
    return actor.join(socket);
  }

  async leave(socket: AppSocket, roomId: string): Promise<void> {
    await this.actors.get(roomId)?.leave(socket);
  }

  async disconnect(socket: AppSocket): Promise<void> {
    for (const actor of this.actors.values()) if (actor.hasSocket(socket.id)) await actor.leave(socket);
  }

  isParticipant(userId: string, roomId: string): boolean {
    return this.actors.get(roomId)?.hasParticipant(userId) ?? false;
  }

  /** null 이면 이 매니저의 방이 아니다 — 레지스트리가 다음 매니저를 본다. */
  participantUserIds(roomId: string): string[] | null {
    return this.actors.get(roomId)?.participantUserIds() ?? null;
  }

  setPaused(roomId: string, paused: boolean): boolean {
    const actor = this.actors.get(roomId);
    if (!actor) return false;
    actor.setPaused(paused);
    return true;
  }

  markReady(socket: AppSocket, roomId: string): boolean {
    const actor = this.actors.get(roomId);
    if (!actor) return false;
    actor.markReady(socket);
    return true;
  }

  requestDeal(userId: string, roomId: string): Promise<{ started: boolean; waiting: number }> {
    return this.actorFor(roomId).requestDeal(userId);
  }

  /** 명령을 받을 액터. 없는 방이면 ROOM_NOT_FOUND. */
  protected actorFor(roomId: string): A {
    const actor = this.actors.get(roomId);
    if (!actor) throw new DomainError("ROOM_NOT_FOUND");
    return actor;
  }

  /** 기동 시 방 한 줄을 액터로 등록한다. */
  protected register(row: BaseRoomRow, actor: A): void {
    this.actors.set(row.id, actor);
  }

  /** 방 한 줄로 액터를 만든다. 실행 중에 방을 열 수 있는 게임(방 만들기를 받는 PvP)만 채운다. */
  protected spawn(row: A["room"]): A {
    throw new Error(`${this.game} rooms cannot be opened at runtime (${row.code})`);
  }

  /** 실행 중에 방 하나를 연다(방 만들기·빠른 시작). 이미 있으면 그 방을 그대로 돌려준다. */
  addRoom(row: A["room"]): GameRoom {
    const existing = this.actors.get(row.id);
    if (existing) return existing.publicRoom();
    const actor = this.spawn(row);
    this.register(row, actor);
    return actor.publicRoom();
  }

  /**
   * 더 들어오지 못하게 닫는다. 안에 남은 사람은 쫓아내지 않는다 — 진행 중인 판은 원래 규칙대로 끝나고,
   * 나가면 다시 못 들어온다. 액터는 프로세스가 다시 뜰 때(closed_at) 사라진다.
   */
  closeRoom(roomId: string): boolean {
    const actor = this.actors.get(roomId);
    if (!actor) return false;
    actor.room.enabled = false;
    return true;
  }

  applyRoomEdit(roomId: string, patch: AdminRoomPatch): boolean {
    const actor = this.actors.get(roomId);
    if (!actor) return false;
    const row = actor.room;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.minBet !== undefined) row.min_bet = patch.minBet;
    if (patch.maxBet !== undefined) row.max_bet = patch.maxBet;
    if (patch.tier !== undefined) row.tier = patch.tier;
    if (patch.enabled !== undefined) row.enabled = patch.enabled;
    return true;
  }

  /** closeRoom 을 되돌린다(DB 에 닫기를 적다가 실패했을 때). */
  reopenRoom(roomId: string): boolean {
    const actor = this.actors.get(roomId);
    if (!actor) return false;
    actor.room.enabled = true;
    return true;
  }

  /**
   * 닫힌 사용자 방 중 비어 있는(isIdle) 액터를 메모리에서 치운다. 치운 수를 돌려준다. 닫힌 방도 안에 남은 판이
   * 끝날 때까지는 살아 있어야 하므로 닫는 순간이 아니라 여기서 — 방을 열 때와 빈 방 닫기 때마다 한 번 쓴다.
   */
  reapClosedRooms(): number {
    let reaped = 0;
    for (const [roomId, actor] of this.actors) {
      if (!isCustomRoomCode(actor.room.code) || actor.room.enabled || !actor.isIdle()) continue;
      this.actors.delete(roomId);
      reaped += 1;
    }
    return reaped;
  }

  humanCount(roomId: string): number {
    return this.actors.get(roomId)?.humanCount() ?? 0;
  }

  idleSince(roomId: string): number | null {
    return this.actors.get(roomId)?.idleSince() ?? null;
  }
}
