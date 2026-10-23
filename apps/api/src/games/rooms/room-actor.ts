import type { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  GameRoom,
  GameType,
  RoomPhase,
  ServerToClientEvents,
  SnapshotMeta,
  TableTier,
  WinnerFeedEntry,
} from "@opencasino/contracts";
import type { AuthUser } from "../../auth/auth.js";
import { pool } from "../../database/pool.js";
import { DomainError } from "../../errors/domain-error.js";
import { logger, type Logger } from "../../logging/logger.js";
import { workTracker } from "../../process/work-tracker.js";
import { pushWinnerEntries } from "../winner-feed.js";
import { RoomCycleGuard } from "./room-cycle.js";
import { snapshotMeta } from "./snapshot-meta.js";

/**
 * 여섯 게임의 룸 액터가 똑같이 하던 일 — 참가자 관리, 입장·퇴장, 인원 방송, 스냅샷 방송,
 * 판 반복(RoomCycleGuard) 배선, 스냅샷 공통 정보 — 을 한곳에 모은 기반 클래스.
 *
 * 예전에는 이 코드가 매니저마다 복사되어 있었고, 복사본끼리 조금씩 어긋났다(어떤 방은 실패한
 * 판의 복구 중 예외가 나면 영원히 "판 진행 중" 으로 남았다). 게임 규칙과 판 진행 순서는 각
 * 매니저에 그대로 두고, "방이라면 누구나 하는 일" 만 여기로 올렸다.
 */

export type AppServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: AuthUser }>;
export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: AuthUser }>;

/** game_rooms 한 줄 중 모든 게임이 읽는 부분. 게임별로 컬럼을 더 읽는다(side_bet_max, variant). */
export interface BaseRoomRow {
  id: string;
  game_type: GameType;
  code: string;
  name: string;
  min_bet: number;
  max_bet: number;
  enabled: boolean;
  /** 테이블 등급. 입장 조건(RoomManagerBase.join)이 본다 — 매니저마다 SELECT 에 꼭 넣을 것(없으면 입문으로 친다). */
  tier?: TableTier;
  /** 방을 만든 사람(방 만들기). 시드 방·빠른 시작 시스템 방은 null. PvP 매니저만 읽는다. */
  created_by?: string | null;
  owner_nickname?: string | null;
  /** 비공개 방의 6자리 코드. */
  private_code?: string | null;
}

/**
 * 실행 중에 연 방(방 만들기·빠른 시작)의 code: `<게임 접두사>c-<hex>`. 시드 방 code 와 겹치지 않는 표식이라
 * 재시작 뒤에도 "사람이 없으면 닫는 방" 을 가를 수 있다(시스템 방은 created_by 가 NULL 이라 그것만으로는 모른다).
 */
const CUSTOM_ROOM_CODE = /-c-[0-9a-f]+$/;
export function isCustomRoomCode(code: string): boolean {
  return CUSTOM_ROOM_CODE.test(code);
}

/** PvP 매니저가 기동 때 방을 읽는 SELECT — 등급·개설자·비공개 코드까지. 뒤에 WHERE 를 붙인다(방 별칭 r). */
export const PVP_ROOM_SELECT = `SELECT r.id,r.game_type,r.code,r.name,r.min_bet,r.max_bet,r.enabled,r.variant,r.tier,r.created_by,r.private_code,u.nickname AS owner_nickname
  FROM game_rooms r LEFT JOIN users u ON u.id=r.created_by`;

/** publicRoom 에 붙는 등급·방 만들기 정보. */
export function roomTags(row: BaseRoomRow): Pick<GameRoom, "tier" | "custom" | "ownerNickname" | "private"> {
  return { tier: row.tier ?? "rookie", custom: isCustomRoomCode(row.code), ownerNickname: row.owner_nickname ?? null, private: Boolean(row.private_code) };
}

/** 게임마다 스냅샷을 보내는 이벤트 이름. 페이로드 타입은 contracts 의 이벤트 정의에서 꺼낸다. */
export type SnapshotEventName =
  | "room.snapshot"
  | "dragonTiger.snapshot"
  | "roulette.snapshot"
  | "sicbo.snapshot"
  | "crash.snapshot"
  | "moneyWheel.snapshot"
  | "tableGame.snapshot"
  | "slot.snapshot"
  | "videoPoker.snapshot"
  | "pachinko.snapshot"
  | "blackjack.snapshot"
  | "holdem.snapshot"
  | "sutda.snapshot"
  | "sevenPoker.snapshot"
  | "badugi.snapshot"
  | "gostop.snapshot";
export type SnapshotOf<E extends SnapshotEventName> = Parameters<ServerToClientEvents[E]>[0];

/**
 * 좌석 제한이 없는 방(바카라·용호)의 스냅샷 묶음 간격. 칩이 떨어지는 속도가 테이블 전체를 다시
 * 그리는 데 필요한 속도보다 훨씬 빠르다 — scheduleSnapshots() 주석 참고.
 */
const BROADCAST_COALESCE_MS = 150;

export interface RoomActorOptions<E extends SnapshotEventName> {
  /** 방 채널 접두사(`room`, `dt-room`, ...). 방 채팅이 이 이름으로 방송한다 — 바꾸면 선 위의 동작이 바뀐다. */
  channelPrefix: string;
  snapshotEvent: E;
}

/** 마지막 소켓이 끊긴 뒤 자리를 정리하기까지 기다리는 시간(scheduleLeft). 새로고침·짧은 망 끊김·폰 앱 전환을 넉넉히 덮는다. */
export const LEAVE_GRACE_MS = 20_000;

/**
 * 빈 방에 들어온 사람의 게임 화면 준비를 기다리는 최대 시간(launchWhenReady). 3D 판 코드·카드 이미지를 느린 폰에서 받고
 * 셰이더를 컴파일하는 시간. 화면은 그동안 로딩 화면(GameLoading)으로 덮여 있어, 넉넉히 잡아도 기다림이 보이지 않는다 —
 * 짧으면 느린 폰에서 로딩 화면 뒤로 첫 판 베팅 시간이 흘러가 버린다.
 */
export const ENTRY_MAX_WAIT_MS = 10_000;

export abstract class RoomActor<Row extends BaseRoomRow, E extends SnapshotEventName> {
  protected phase: RoomPhase = "WAITING";
  protected roundId: string | null = null;
  protected phaseEndsAt: string | null = null;
  /** 지금 단계의 전체 길이. 스냅샷의 phaseDurationMs 로 나간다. 채우지 않는 게임은 null 로 둔다. */
  protected phaseDurationMs: number | null = null;
  protected sequence = 0;
  /** userId → 그 사람이 이 방에 연결해 둔 소켓 id 들. 봇은 빈 집합으로 들어온다. */
  protected readonly participants = new Map<string, Set<string>>();
  protected readonly usernames = new Map<string, string>();
  protected recentWinners: WinnerFeedEntry[] = [];
  protected paused = false;
  protected cycleRunning = false;
  /** 이 방만 멈추게 하는 차단기 — 고장난 방이 프로세스 전체를 끌어내리지 못하게 한다. */
  protected readonly guard: RoomCycleGuard;
  protected readonly log: Logger;
  protected readonly snapshotEvent: E;
  private readonly channelPrefix: string;
  /** 마지막 소켓이 나가 자리 정리를 기다리는 사람들(scheduleLeft). */
  private readonly leaving = new Map<string, ReturnType<typeof setTimeout>>();
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private broadcastPending = false;
  /** 입장 대기(launchWhenReady): 화면 준비를 기다리는 소켓들과 최대 대기 타이머. */
  private entryWait: { timer: ReturnType<typeof setTimeout>; sockets: Set<string> } | null = null;
  /** 게임 화면이 준비됐다고 알린 소켓(입장보다 알림이 먼저 올 수 있어 기억해 둔다). */
  private readonly readySockets = new Set<string>();
  /** 마지막 사람이 나간 시각(처음엔 방을 연 시각). idleSince 가 사람이 없을 때만 돌려준다. */
  private emptySince = Date.now();

  constructor(protected readonly io: AppServer, readonly room: Row, options: RoomActorOptions<E>) {
    this.channelPrefix = options.channelPrefix;
    this.snapshotEvent = options.snapshotEvent;
    // 라벨을 함수로 넘기는 이유는 room-cycle.ts 참고 — 여기서는 이미 room 이 있지만 같은 계약을 지킨다.
    this.guard = new RoomCycleGuard(() => this.room.code);
    this.log = logger.child({ room: room.code, game: room.game_type });
  }

  /* ---------------------------------------------------------------------------
     게임이 채워야 하는 부분
     --------------------------------------------------------------------------- */

  abstract publicRoom(): GameRoom;
  /** 한 사람 몫의 스냅샷. 게임마다 미리 읽은 값을 받는 추가 인자가 있다. */
  abstract snapshot(userId: string): Promise<SnapshotOf<E>>;
  /**
   * 방송 한 번에 필요한 값(잔액, 판 전체 베팅 합계)을 한 번만 읽고, 참가자별 스냅샷을 만드는
   * 함수를 돌려준다. 참가자마다 DB 를 왕복하던 것을 없애는 자리다.
   */
  protected abstract snapshotBuilder(): Promise<(userId: string) => Promise<SnapshotOf<E>>>;
  /** 다음 판을 연다(열 수 있으면). 조건 검사는 게임마다 다르다. */
  protected abstract launch(): void;

  /** 마지막 소켓이 나가 참가자에서 빠졌을 때. 좌석 정리 같은 게임별 처리. */
  protected async onParticipantLeft(_userId: string): Promise<void> {}
  /** 소켓이 방 채널에 들어가기 직전(참가자 등록 직후). */
  protected onParticipantJoined(_userId: string): void {}
  /** 입장 처리가 끝나고 스냅샷을 돌려주기 직전. 우승자 피드 전송, 판 시작 등. */
  protected afterJoin(_socket: AppSocket): void {}
  /** 퇴장 처리가 끝난 뒤. 좌석이 있는 게임은 여기서 테이블 전체에 다시 뿌린다. */
  protected async afterLeave(_userId: string): Promise<void> {}
  /** 스냅샷을 다 보낸 뒤. 봇이 있는 게임은 여기서 봇에게 같은 스냅샷을 넘긴다. */
  protected onSnapshotsBuilt(_built: Map<string, SnapshotOf<E>>): void {}

  /* ---------------------------------------------------------------------------
     참가자
     --------------------------------------------------------------------------- */

  get playerCount(): number {
    return this.participants.size;
  }

  get channel(): string {
    return `${this.channelPrefix}:${this.room.id}`;
  }

  hasSocket(socketId: string): boolean {
    for (const sockets of this.participants.values()) if (sockets.has(socketId)) return true;
    return false;
  }

  hasParticipant(userId: string): boolean {
    return this.participants.has(userId);
  }

  participantUserIds(): string[] {
    return [...this.participants.keys()];
  }

  /**
   * 소켓이 붙어 있는 사람 수. 봇은 소켓 없이 참가자에 들어오므로 세지 않는다. 막 나가 자리 정리를 기다리는 사람
   * (LEAVE_GRACE_MS)도 세지 않는다 — 닫힌 방에 남은 자리는 그 정리가 보통 퇴장처럼 치운다.
   */
  humanCount(): number {
    let count = 0;
    for (const sockets of this.participants.values()) if (sockets.size > 0) count += 1;
    return count;
  }

  hasHumans(): boolean {
    return this.humanCount() > 0;
  }

  /** 사람이 하나도 없게 된 시각(ms). 사람이 있으면 null. 빈 사용자 방 닫기(CUSTOM_ROOM_IDLE_MS)가 본다. */
  idleSince(): number | null {
    return this.hasHumans() ? null : this.emptySince;
  }

  /** 지금 참가자이거나, 나간 지 얼마 안 돼 자리 정리를 기다리는 사람 — 입장 조건을 다시 묻지 않는다(새로고침·재접속). */
  isReturning(userId: string): boolean {
    return this.participants.has(userId) || this.leaving.has(userId);
  }

  /** 아무도(봇도) 없고, 자리 정리를 기다리는 사람도, 진행 중인 판도 없다 — 닫힌 방의 액터를 메모리에서 치워도 된다. */
  isIdle(): boolean {
    return this.participants.size === 0 && this.leaving.size === 0 && this.roundId === null && !this.cycleRunning;
  }

  async join(socket: AppSocket): Promise<SnapshotOf<E>> {
    const user = socket.data.user;
    // 나간 지 얼마 안 돼 돌아왔다 — 예약해 둔 자리 정리를 거둔다.
    clearTimeout(this.leaving.get(user.id));
    this.leaving.delete(user.id);
    const sockets = this.participants.get(user.id) ?? new Set<string>();
    sockets.add(socket.id);
    this.participants.set(user.id, sockets);
    this.usernames.set(user.id, user.nickname);
    this.onParticipantJoined(user.id);
    await socket.join(this.channel);
    this.emitPresence();
    this.afterJoin(socket);
    return this.snapshot(user.id);
  }

  async leave(socket: AppSocket): Promise<void> {
    const userId = socket.data.user.id;
    const sockets = this.participants.get(userId);
    sockets?.delete(socket.id);
    // 같은 계정의 다른 탭이 남아 있으면 참가자는 그대로다. 마지막 소켓이 나갈 때만 정리하되, 바로 하지 않는다.
    if (sockets?.size === 0) {
      this.participants.delete(userId);
      this.scheduleLeft(userId);
    }
    if (!this.hasHumans()) this.emptySince = Date.now();
    await socket.leave(this.channel);
    this.emitPresence();
    // 준비를 기다리던 사람이 나갔으면 남은 사람만 기다린다(아무도 없으면 launch 가 알아서 안 연다).
    this.readySockets.delete(socket.id);
    if (this.entryWait?.sockets.delete(socket.id) && this.entryWait.sockets.size === 0) this.releaseEntryWait();
    await this.afterLeave(userId);
  }

  /**
   * 마지막 소켓이 나가도 LEAVE_GRACE_MS 동안은 자리를 그대로 둔다. 그 안에 다시 들어오면(join) 없던 일이 된다.
   * 새로고침·망 끊김·폰에서 다른 앱을 잠깐 본 것만으로 소켓이 끊겼다 붙는데, 판과 판 사이면 그 순간
   * 자리가 비워지고 마지막 사람이면 봇까지 내보내졌다.
   */
  private scheduleLeft(userId: string): void {
    clearTimeout(this.leaving.get(userId));
    const timer = setTimeout(() => {
      this.leaving.delete(userId);
      if (this.participants.has(userId)) return;
      void (async () => {
        await this.onParticipantLeft(userId);
        await this.afterLeave(userId);
      })().catch((error: unknown) => this.log.error("participant leave cleanup failed", { userId, err: error }));
    }, LEAVE_GRACE_MS);
    timer.unref?.();
    this.leaving.set(userId, timer);
  }

  /** 운영자의 일시정지/재개. 다시 열면 차단기도 같이 내린다 — 안 그러면 되살릴 방법이 없다. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) {
      this.guard.reset();
      this.launch();
    }
  }

  /* ---------------------------------------------------------------------------
     입장 대기 — 빈 방의 첫 판
     --------------------------------------------------------------------------- */

  /**
   * 빈 방의 첫 판은 방금 들어온 사람의 게임 화면(판·카드 이미지)이 준비됐다는 알림(markReady)을 받고 연다.
   * 들어오자마자 열면 화면을 받는 동안 첫 판 베팅 시간이 흘러가고 첫 카드 연출도 놓쳤다. 알림이 끝내 안 오면
   * (느린 폰·옛 클라이언트) ENTRY_MAX_WAIT_MS 뒤에 연다. 알림이 입장보다 먼저 와도(재접속) 기억해 둔다.
   */
  protected launchWhenReady(socket: AppSocket): void {
    if (this.readySockets.has(socket.id)) {
      this.launch();
      return;
    }
    if (!this.entryWait) {
      const timer = setTimeout(() => this.releaseEntryWait(), ENTRY_MAX_WAIT_MS);
      timer.unref?.();
      this.entryWait = { timer, sockets: new Set() };
    }
    this.entryWait.sockets.add(socket.id);
  }

  /** 이 소켓의 게임 화면이 준비됐다(table.ready). 기다리던 사람이 다 준비되면 첫 판을 연다. */
  markReady(socket: AppSocket): void {
    this.readySockets.add(socket.id);
    const wait = this.entryWait;
    if (!wait?.sockets.delete(socket.id)) return;
    if (wait.sockets.size === 0) this.releaseEntryWait();
  }

  private releaseEntryWait(): void {
    if (!this.entryWait) return;
    clearTimeout(this.entryWait.timer);
    this.entryWait = null;
    this.launch();
  }

  /** 참가자가 아니면 막는다. 베팅·착석 명령의 첫 줄. */
  protected requireParticipant(userId: string): void {
    if (!this.participants.has(userId)) throw new DomainError("ROOM_JOIN_REQUIRED");
  }

  /** 지금 흐르는 베팅 시간(waitBetting)을 바로 끝내는 함수. 베팅 중이 아니면 null. */
  private endBetting: (() => void) | null = null;
  /** 이번 판에 DEAL 을 누른 사람. */
  private readonly dealVotes = new Set<string>();

  /**
   * 베팅 시간을 기다린다. 이번 판에 건 사람(방에 남아 있는 사람만)이 모두 DEAL 을 누르면 바로 끝난다 —
   * 혼자 하는 판에서 남은 초를 다 기다리지 않게. 아직 안 건 사람은 기다려 주지 않는다.
   */
  protected waitBetting(ms: number): Promise<void> {
    this.dealVotes.clear();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.endBetting = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.endBetting = done;
    });
  }

  /** 이번 판에 건 사람. 기본은 wagers 표 — 따로 적는 게임(블랙잭)은 덮어쓴다. */
  protected async currentBettors(): Promise<string[]> {
    if (!this.roundId) return [];
    const result = await pool.query<{ user_id: string }>("SELECT DISTINCT user_id FROM wagers WHERE round_id=$1 AND status='accepted'", [this.roundId]);
    return result.rows.map((row) => row.user_id);
  }

  /** DEAL. 건 사람이 모두 누르면 베팅을 닫는다. waiting 은 걸었지만 아직 안 누른 사람 수. */
  async requestDeal(userId: string): Promise<{ started: boolean; waiting: number }> {
    this.requireParticipant(userId);
    if (this.phase !== "BETTING" || !this.endBetting) throw new DomainError("BETTING_CLOSED");
    const bettors = (await this.currentBettors()).filter((id) => this.participants.has(id));
    if (!bettors.includes(userId)) throw new DomainError("DEAL_NEEDS_BET");
    this.dealVotes.add(userId);
    const waiting = bettors.filter((id) => !this.dealVotes.has(id)).length;
    if (waiting === 0) this.endBetting?.();
    return { started: waiting === 0, waiting };
  }

  /* ---------------------------------------------------------------------------
     방송
     --------------------------------------------------------------------------- */

  protected emitPresence(): void {
    const payload = { roomId: this.room.id, playerCount: this.playerCount };
    // 비공개 방은 그 방 안에만 — 전체에 뿌리면 코드를 모르는 사람이 방 id 를 알게 된다.
    if (this.room.private_code) this.io.to(this.channel).emit("room.presence", payload);
    else this.io.emit("room.presence", payload);
  }

  /** 모든 스냅샷에 붙는 bootId·serverTime·phaseDurationMs (contracts 의 snapshotMetaShape). */
  protected meta(): Required<SnapshotMeta> {
    return snapshotMeta(this.phaseDurationMs);
  }

  /** 각 참가자에게 보낸 스냅샷을 돌려준다 — 같은 것을 ack 로 다시 만들 필요가 없도록. */
  protected async emitSnapshots(): Promise<Map<string, SnapshotOf<E>>> {
    const build = await this.snapshotBuilder();
    const built = new Map<string, SnapshotOf<E>>();
    for (const [userId, sockets] of this.participants) {
      const snapshot = await build(userId);
      built.set(userId, snapshot);
      for (const socketId of sockets) this.sendSnapshot(socketId, snapshot);
    }
    this.onSnapshotsBuilt(built);
    return built;
  }

  /**
   * 테이블 전체 스냅샷을 BROADCAST_COALESCE_MS 에 한 번만 보낸다.
   *
   * 좌석 제한이 없는 방은 칩 하나마다 전원에게 뿌리면 O(베터²) 가 된다: 40명이 베팅한 한 판에서
   * 스냅샷 6,440개, 47MB 가 나갔고 ack 가 2.4초 밀렸다. 베팅한 사람은 ack 로 자기 스냅샷을 바로
   * 받고, 나머지는 다음 묶음에서 따라잡는다 — 칩 애니메이션 안에 충분히 들어온다.
   */
  protected scheduleSnapshots(): void {
    if (this.broadcastTimer) {
      this.broadcastPending = true;
      return;
    }
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      if (!this.broadcastPending) return;
      this.broadcastPending = false;
      this.scheduleSnapshots();
    }, BROADCAST_COALESCE_MS);
    void this.emitSnapshots().catch((error) => this.log.error("failed to broadcast a snapshot", { err: error }));
  }

  /** 정산 결과 잔액을 그 사람의 소켓들에만 보낸다. */
  protected emitWalletUpdates(balances: Map<string, number>): void {
    for (const [userId, balance] of balances) {
      for (const socketId of this.participants.get(userId) ?? []) this.io.to(socketId).emit("wallet.updated", { balance });
    }
  }

  /** 방에 있는 모든 사람에게 알림 한 줄. 판이 중단되어 환불했을 때 쓴다. */
  protected notifyParticipants(type: "success" | "error" | "info", message: string): void {
    for (const sockets of this.participants.values()) {
      for (const socketId of sockets) this.io.to(socketId).emit("notification", { type, message });
    }
  }

  /** 우승자 피드에 더하고 방 채널에 전체 목록을 보낸다. */
  protected publishWinners(entries: WinnerFeedEntry[]): void {
    this.recentWinners = pushWinnerEntries(this.recentWinners, entries);
    this.io.to(this.channel).emit("room.winners", { entries: this.recentWinners });
  }

  /** 막 들어온 소켓에게 지금까지의 우승자 피드를 준다. */
  protected sendWinnerFeed(socket: AppSocket): void {
    socket.emit("room.winners", { entries: this.recentWinners });
  }

  private sendSnapshot(socketId: string, snapshot: SnapshotOf<E>): void {
    // 이벤트 이름이 제네릭이라 socket.io 의 오버로드가 페이로드를 좁히지 못한다. 짝은
    // SnapshotOf<E> 가 contracts 의 이벤트 정의에서 직접 뽑아 오므로 여기서 어긋날 수 없다.
    const target = this.io.to(socketId) as unknown as { emit(event: E, payload: SnapshotOf<E>): boolean };
    target.emit(this.snapshotEvent, snapshot);
  }

  /* ---------------------------------------------------------------------------
     판 반복
     --------------------------------------------------------------------------- */

  /**
   * 판 하나를 RoomCycleGuard 아래에서 돌린다.
   *
   * - run 이 끝나면 차단기의 실패 수를 지운다. run 의 반환값은 "다음 판을 다시 열어 봐도 되는가".
   * - run 이 던지면 차단기에 알리고(연속 실패면 방을 멈춘다), recover 로 환불·상태 정리를 한다.
   *   recover 자체가 던져도 cycleRunning 은 반드시 풀린다 — 예전 섯다·고스톱은 여기서 걸려
   *   방이 영원히 "판 진행 중" 으로 남을 수 있었다.
   * - 어느 쪽이든 재진입 전에 한 번 쉰다(guard.pace). 이 await 하나가 "한 방의 루프가 서버
   *   전체를 굶기는" 사고를 막는다.
   * - 종료 중(drain)이면 새 판을 아예 열지 않는다. 돌던 판은 끝까지 가거나 기동 복구가 마무리한다.
   */
  protected runGuardedCycle(options: {
    run: () => Promise<boolean>;
    recover: (error: unknown) => Promise<void>;
    next: (relaunch: boolean) => void;
  }): void {
    if (workTracker.isDraining) return;
    this.cycleRunning = true;
    void (async () => {
      let relaunch: boolean;
      try {
        relaunch = await options.run();
        this.guard.noteSuccess();
      } catch (error) {
        relaunch = await this.guard.noteFailure(error);
        if (!relaunch) this.paused = true;
        try {
          await options.recover(error);
        } catch (recoverError) {
          this.log.error("failed to recover from a failed cycle", { err: recoverError });
        }
      }
      this.cycleRunning = false;
      await this.guard.pace();
      options.next(relaunch);
    })();
  }

  /**
   * 정산처럼 중간에 끊기면 곤란한 구간. 종료 신호가 와도 이 구간이 끝날 때까지 정해진 시간만큼
   * 기다려 준다(process/work-tracker.ts). 끊기더라도 기동 복구가 마무리하지만, 이미 결과가 나온
   * 판을 환불로 되돌리지 않는 편이 낫다.
   */
  protected settling<T>(work: () => Promise<T>): Promise<T> {
    return workTracker.track(`settle:${this.room.code}`, work);
  }
}
