import type { GameRoom } from "@opencasino/contracts";
import { DomainError } from "../../errors/domain-error.js";
import { logger } from "../../logging/logger.js";
import { BaccaratRoomManager } from "./baccarat-room-manager.js";
import { BadugiRoomManager } from "./badugi-room-manager.js";
import { BlackjackRoomManager } from "./blackjack-room-manager.js";
import { CrashRoomManager } from "./crash-room-manager.js";
import { DragonTigerRoomManager } from "./dragon-tiger-room-manager.js";
import { GostopRoomManager } from "./gostop-room-manager.js";
import { HoldemRoomManager } from "./holdem-room-manager.js";
import { RouletteRoomManager } from "./roulette-room-manager.js";
import { SicBoRoomManager } from "./sicbo-room-manager.js";
import { MoneyWheelRoomManager } from "./money-wheel-room-manager.js";
import { TableGameRoomManager } from "./table-game-room-manager.js";
import { SlotRoomManager } from "./slot-room-manager.js";
import type { BaseRoomRow, AppServer, AppSocket } from "./room-actor.js";
import type { GameRoomManager } from "./room-manager-base.js";
import { SevenPokerRoomManager } from "./seven-poker-room-manager.js";
import { SutdaRoomManager } from "./sutda-room-manager.js";
import { VideoPokerRoomManager } from "./video-poker-room-manager.js";
import { PachinkoRoomManager } from "./pachinko-room-manager.js";

/** 좌석과 표정이 있는 게임. room.emote.send 가 좌석 번호를 여기서 찾는다. */
export type SeatedGame = "holdem" | "sutda" | "gostop" | "seven_poker" | "badugi";

/** 실행 중에 새로 여는 방 한 줄(방 만들기·빠른 시작). PvP 게임만 연다(contracts CUSTOM_ROOM_GAMES). */
export interface CustomRoomRow extends BaseRoomRow {
  game_type: SeatedGame;
  variant: "two" | "three";
}

/**
 * 여섯 게임 매니저를 한곳에 모은다. 예전 main.ts 는 "이 방이 누구 것인가" 를 물을 때마다
 * 여섯 매니저를 `||`/`??` 로 이어 붙였고, 게임이 하나 늘 때마다 그 체인 네 곳 중 하나를 빠뜨렸다
 * (관리자 통계에서 섯다가 통째로 빠진 것과 같은 종류의 누락). 이제 한 목록만 고치면 된다.
 */
export class RoomRegistry {
  readonly baccarat: BaccaratRoomManager;
  readonly dragonTiger: DragonTigerRoomManager;
  readonly roulette: RouletteRoomManager;
  readonly sicbo: SicBoRoomManager;
  readonly moneyWheel: MoneyWheelRoomManager;
  readonly tableGames: TableGameRoomManager;
  readonly crash: CrashRoomManager;
  readonly slot: SlotRoomManager;
  readonly videoPoker: VideoPokerRoomManager;
  readonly pachinko: PachinkoRoomManager;
  readonly blackjack: BlackjackRoomManager;
  readonly holdem: HoldemRoomManager;
  readonly sutda: SutdaRoomManager;
  readonly sevenPoker: SevenPokerRoomManager;
  readonly badugi: BadugiRoomManager;
  readonly gostop: GostopRoomManager;
  /** 로비에 보이는 순서이기도 하다. */
  readonly managers: readonly GameRoomManager[];
  private detached = false;

  constructor(io: AppServer) {
    this.baccarat = new BaccaratRoomManager(io);
    this.dragonTiger = new DragonTigerRoomManager(io);
    this.roulette = new RouletteRoomManager(io);
    this.sicbo = new SicBoRoomManager(io);
    this.moneyWheel = new MoneyWheelRoomManager(io);
    this.tableGames = new TableGameRoomManager(io);
    this.crash = new CrashRoomManager(io);
    this.slot = new SlotRoomManager(io);
    this.videoPoker = new VideoPokerRoomManager(io);
    this.pachinko = new PachinkoRoomManager(io);
    this.blackjack = new BlackjackRoomManager(io);
    this.holdem = new HoldemRoomManager(io);
    this.sutda = new SutdaRoomManager(io);
    this.sevenPoker = new SevenPokerRoomManager(io);
    this.badugi = new BadugiRoomManager(io);
    this.gostop = new GostopRoomManager(io);
    this.managers = [this.baccarat, this.dragonTiger, this.roulette, this.sicbo, this.moneyWheel, this.tableGames, this.crash, this.slot, this.videoPoker, this.pachinko, this.blackjack, this.holdem, this.sutda, this.sevenPoker, this.badugi, this.gostop];
  }

  /**
   * 기동 복구 순서가 중요하다. 바카라 매니저의 복구는 끝나지 않은 game_rounds 를 게임 구분 없이
   * 전부 쓸어 `wagers` 기준으로만 환불할 줄 안다. 그래서 자기 에스크로 테이블이 따로 있는
   * 홀덤·섯다·고스톱이 먼저 자기 판을 정리해야 한다 — 안 그러면 바카라 쪽이 그 판을 환불 없이
   * ABORTED 로 닫아 버린다.
   */
  async initialize(): Promise<void> {
    await this.holdem.initialize();
    await this.sutda.initialize();
    await this.sevenPoker.initialize();
    await this.badugi.initialize();
    await this.gostop.initialize();
    await this.baccarat.initialize();
    await this.dragonTiger.initialize();
    await this.roulette.initialize();
    await this.sicbo.initialize();
    await this.moneyWheel.initialize();
    await this.tableGames.initialize();
    await this.crash.initialize();
    await this.slot.initialize();
    await this.videoPoker.initialize();
    await this.pachinko.initialize();
    await this.blackjack.initialize();
  }

  listRooms(): GameRoom[] {
    return this.managers.flatMap((manager) => manager.listRooms());
  }

  /** 로비에 보이는 방 — 비공개 방은 코드(/r/:code)로만 들어오고, 닫힌 사용자 방은 안에 사람이 남아 있어도 뺀다. */
  publicRooms(): GameRoom[] {
    return this.listRooms().filter((room) => !room.private && (room.enabled || !room.custom));
  }

  /** 방을 실행 중에 연다. DB 에 줄(과 방 예치 계정)이 먼저 있어야 한다. */
  addRoom(row: CustomRoomRow): GameRoom {
    switch (row.game_type) {
      case "holdem": return this.holdem.addRoom(row);
      case "sutda": return this.sutda.addRoom(row);
      case "seven_poker": return this.sevenPoker.addRoom(row);
      case "badugi": return this.badugi.addRoom(row);
      case "gostop": return this.gostop.addRoom(row);
    }
  }

  closeRoom(roomId: string): boolean {
    return this.ownerOf(roomId)?.closeRoom(roomId) ?? false;
  }

  reopenRoom(roomId: string): boolean {
    return this.ownerOf(roomId)?.reopenRoom(roomId) ?? false;
  }

  /**
   * 메모리에 떠 있는 사용자 방 액터 수(닫혔지만 아직 안 치운 것 포함). 먼저 빈 닫힌 방을 치운다. 서버 상한은
   * DB 의 열린 방이 아니라 이 수로도 센다 — 열고 닫기를 되풀이해 액터만 쌓는 길을 막는다.
   */
  residentCustomRooms(): number {
    for (const manager of this.managers) manager.reapClosedRooms();
    return this.listRooms().filter((room) => room.custom).length;
  }

  humanCount(roomId: string): number {
    return this.ownerOf(roomId)?.humanCount(roomId) ?? 0;
  }

  /** 사람 없이 idleMs 이상 지난 열린 사용자 방 id. */
  idleCustomRooms(nowMs: number, idleMs: number): string[] {
    return this.listRooms()
      .filter((room) => room.custom && room.enabled)
      .filter((room) => {
        const since = this.ownerOf(room.id)?.idleSince(room.id) ?? null;
        return since !== null && nowMs - since >= idleMs;
      })
      .map((room) => room.id);
  }

  /** 이 방을 가진 매니저. 없으면 null. */
  ownerOf(roomId: string): GameRoomManager | null {
    return this.managers.find((manager) => manager.owns(roomId)) ?? null;
  }

  setPaused(roomId: string, paused: boolean): boolean {
    return this.ownerOf(roomId)?.setPaused(roomId, paused) ?? false;
  }

  /** 게임 화면 준비 알림(table.ready) — 그 방의 매니저에게 넘긴다. */
  markReady(socket: AppSocket, roomId: string): boolean {
    return this.ownerOf(roomId)?.markReady(socket, roomId) ?? false;
  }

  requestDeal(userId: string, roomId: string): Promise<{ started: boolean; waiting: number }> {
    const owner = this.ownerOf(roomId);
    if (!owner) throw new DomainError("ROOM_NOT_FOUND");
    return owner.requestDeal(userId, roomId);
  }

  /** null 이면 그런 방이 없다. */
  participantUserIds(roomId: string): string[] | null {
    return this.ownerOf(roomId)?.participantUserIds(roomId) ?? null;
  }

  isParticipant(userId: string, roomId: string): boolean {
    return this.ownerOf(roomId)?.isParticipant(userId, roomId) ?? false;
  }

  /** 바카라·용호만 로드(통계판)가 있다. 다른 게임의 방이면 false. */
  async resetRoad(roomId: string): Promise<boolean> {
    return (await this.baccarat.resetRoad(roomId)) || (await this.dragonTiger.resetRoad(roomId));
  }

  seated(game: SeatedGame): HoldemRoomManager | SutdaRoomManager | GostopRoomManager | SevenPokerRoomManager | BadugiRoomManager {
    if (game === "seven_poker") return this.sevenPoker;
    if (game === "badugi") return this.badugi;
    return game === "sutda" ? this.sutda : game === "holdem" ? this.holdem : this.gostop;
  }

  /** 방 채팅이 보내는 채널들 — 어느 게임의 방인지 몰라도 한 번에 보낸다(socket.io 가 중복을 걸러 준다). */
  chatChannels(roomId: string): string[] {
    return this.managers.map((manager) => `${manager.channelPrefix}:${roomId}`);
  }

  /**
   * 프로세스를 닫기 직전에 부른다. 소켓 서버를 닫으면 모든 소켓의 disconnect 가 한꺼번에 오는데,
   * 그때 방마다 퇴장 처리(스냅샷 방송, DB 조회)를 하면 막 닫히는 풀에 쿼리를 던지며 오류만 쌓는다.
   */
  detach(): void {
    this.detached = true;
  }

  /**
   * 소켓이 끊기면 모든 게임에서 내보낸다. 한 게임에서 실패해도 나머지는 계속한다 — 예전에는 이
   * 거부가 프로세스 그물로 사라져, 이미 떠난 사람이 홀덤 좌석에 남아 핸드가 다시 시작되지 않았다.
   */
  disconnect(socket: AppSocket): void {
    if (this.detached) return;
    for (const manager of this.managers) {
      void manager.disconnect(socket).catch((error) =>
        logger.error("failed to release a socket on disconnect", { game: manager.game, socketId: socket.id, userId: socket.data.user.id, err: error }),
      );
    }
  }
}
