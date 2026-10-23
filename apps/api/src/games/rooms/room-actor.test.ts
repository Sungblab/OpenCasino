import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameRoom, RoomSnapshot } from "@opencasino/contracts";
import { workTracker } from "../../process/work-tracker.js";
import { ENTRY_MAX_WAIT_MS, LEAVE_GRACE_MS, RoomActor, type BaseRoomRow, type AppServer, type AppSocket } from "./room-actor.js";
import { BOOT_ID } from "./snapshot-meta.js";

/**
 * 기반 클래스가 여섯 게임에 공통으로 해 주는 일(참가자, 입장·퇴장, 인원·스냅샷 방송, 판 반복의
 * 차단기 배선)만 본다. 게임 규칙은 각 매니저의 테스트가 본다.
 */
interface Sent { to: string | null; event: string; payload: unknown }

function fakeIo() {
  const sent: Sent[] = [];
  const io = {
    emit: vi.fn((event: string, payload: unknown) => { sent.push({ to: null, event, payload }); return true; }),
    to: vi.fn((to: string) => ({ emit: (event: string, payload: unknown) => { sent.push({ to, event, payload }); return true; } })),
  };
  return { io: io as unknown as AppServer, sent };
}

function fakeSocket(id: string, userId: string) {
  return {
    id,
    data: { user: { id: userId, username: userId, nickname: `nick-${userId}`, role: "user" as const } },
    join: vi.fn(async () => undefined),
    leave: vi.fn(async () => undefined),
    emit: vi.fn(),
  } as unknown as AppSocket & { join: ReturnType<typeof vi.fn>; leave: ReturnType<typeof vi.fn> };
}

const ROW: BaseRoomRow = { id: "room-1", game_type: "baccarat", code: "BAC-T", name: "테스트", min_bet: 1, max_bet: 100, enabled: true };

class TestActor extends RoomActor<BaseRoomRow, "room.snapshot"> {
  launches = 0;
  left: string[] = [];
  built: Array<Map<string, RoomSnapshot>> = [];
  publicRoom(): GameRoom {
    return { id: this.room.id, gameType: this.room.game_type, code: this.room.code, name: this.room.name, minBet: 1, maxBet: 100, playerCount: this.playerCount, phase: this.phase, enabled: true, paused: this.paused };
  }
  async snapshot(userId: string): Promise<RoomSnapshot> {
    return { room: this.publicRoom(), roundId: null, sequence: this.sequence, ...this.meta(), phaseEndsAt: null, myBets: { player: 0 }, userId } as unknown as RoomSnapshot;
  }
  protected async snapshotBuilder() { return (userId: string) => this.snapshot(userId); }
  protected launch(): void { this.launches += 1; }
  protected override async onParticipantLeft(userId: string): Promise<void> { this.left.push(userId); }
  protected override onSnapshotsBuilt(built: Map<string, RoomSnapshot>): void { this.built.push(built); }
  // 하우스 방처럼 입장하면 첫 판을 연다 — 화면 준비를 기다려서.
  protected override afterJoin(socket: AppSocket): void { this.launchWhenReady(socket); }
  // 테스트에서 보호된 도구를 부르기 위한 통로.
  broadcast() { return this.emitSnapshots(); }
  schedule() { this.scheduleSnapshots(); }
  cycle(options: Parameters<RoomActor<BaseRoomRow, "room.snapshot">["runGuardedCycle"]>[0]) { this.runGuardedCycle(options); }
  get running() { return this.cycleRunning; }
  get isPaused() { return this.paused; }
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("RoomActor participants", () => {
  it("tracks several sockets per account and only releases the user when the last one leaves", async () => {
    vi.useFakeTimers();
    const { io, sent } = fakeIo();
    const actor = new TestActor(io, ROW, { channelPrefix: "room", snapshotEvent: "room.snapshot" });
    const tab1 = fakeSocket("s1", "u1");
    const tab2 = fakeSocket("s2", "u1");

    await actor.join(tab1);
    await actor.join(tab2);
    expect(tab1.join).toHaveBeenCalledWith("room:room-1");
    expect(actor.playerCount).toBe(1);
    expect(actor.hasSocket("s2")).toBe(true);
    expect(actor.participantUserIds()).toEqual(["u1"]);
    expect(sent.filter((s) => s.event === "room.presence").at(-1)?.payload).toEqual({ roomId: "room-1", playerCount: 1 });

    await actor.leave(tab1);
    expect(actor.hasParticipant("u1")).toBe(true);
    expect(actor.left).toEqual([]);
    await actor.leave(tab2);
    expect(actor.hasParticipant("u1")).toBe(false);
    // 자리 정리는 유예 뒤에 — 새로고침·짧은 끊김이면 그 사이 돌아온다.
    expect(actor.left).toEqual([]);
    await vi.advanceTimersByTimeAsync(LEAVE_GRACE_MS);
    expect(actor.left).toEqual(["u1"]);
    expect(tab2.leave).toHaveBeenCalledWith("room:room-1");
    expect(sent.filter((s) => s.event === "room.presence").at(-1)?.payload).toEqual({ roomId: "room-1", playerCount: 0 });
  });

  it("keeps the seat when the last socket comes back within the grace period (refresh, network blip)", async () => {
    vi.useFakeTimers();
    const { io } = fakeIo();
    const actor = new TestActor(io, ROW, { channelPrefix: "room", snapshotEvent: "room.snapshot" });
    await actor.join(fakeSocket("s1", "u1"));
    await actor.leave(fakeSocket("s1", "u1"));
    await vi.advanceTimersByTimeAsync(LEAVE_GRACE_MS - 1_000);
    await actor.join(fakeSocket("s2", "u1"));
    await vi.advanceTimersByTimeAsync(LEAVE_GRACE_MS * 2);
    expect(actor.left).toEqual([]);
    expect(actor.hasParticipant("u1")).toBe(true);
  });

  it("idleSince: 사람이 있으면 null, 마지막 사람이 나간 시각부터 센다(빈 사용자 방 닫기)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { io } = fakeIo();
    const actor = new TestActor(io, ROW, { channelPrefix: "room", snapshotEvent: "room.snapshot" });
    expect(actor.idleSince()).toBe(1_000);
    const socket = fakeSocket("s1", "u1");
    await actor.join(socket);
    expect(actor.idleSince()).toBeNull();
    vi.setSystemTime(50_000);
    await actor.leave(socket);
    // 자리 정리를 기다리는 중이라도 사람으로 치지 않는다.
    expect(actor.idleSince()).toBe(50_000);
    expect(actor.isReturning("u1")).toBe(true);
  });

  it("clears the circuit breaker and relaunches when an operator resumes the room", () => {
    const { io } = fakeIo();
    const actor = new TestActor(io, ROW, { channelPrefix: "room", snapshotEvent: "room.snapshot" });
    actor.setPaused(true);
    expect(actor.launches).toBe(0);
    actor.setPaused(false);
    expect(actor.launches).toBe(1);
  });
});

describe("RoomActor entry wait (첫 판은 화면이 준비된 뒤)", () => {
  const make = () => new TestActor(fakeIo().io, ROW, { channelPrefix: "room", snapshotEvent: "room.snapshot" });

  it("opens the first round only when the joining client says its table is ready", async () => {
    vi.useFakeTimers();
    const actor = make();
    const socket = fakeSocket("s1", "u1");
    await actor.join(socket);
    expect(actor.launches).toBe(0);
    actor.markReady(socket);
    expect(actor.launches).toBe(1);
    actor.markReady(socket);
    expect(actor.launches).toBe(1);
  });

  it("opens right away when the ready signal came before the join (reconnect order)", async () => {
    const actor = make();
    const socket = fakeSocket("s1", "u1");
    actor.markReady(socket);
    await actor.join(socket);
    expect(actor.launches).toBe(1);
  });

  it("gives up waiting after ENTRY_MAX_WAIT_MS for clients that never signal", async () => {
    vi.useFakeTimers();
    const actor = make();
    await actor.join(fakeSocket("s1", "u1"));
    vi.advanceTimersByTime(ENTRY_MAX_WAIT_MS - 1);
    expect(actor.launches).toBe(0);
    vi.advanceTimersByTime(1);
    expect(actor.launches).toBe(1);
  });

  it("waits for everyone who joined during the wait, and stops waiting for someone who left", async () => {
    vi.useFakeTimers();
    const actor = make();
    const a = fakeSocket("s1", "u1");
    const b = fakeSocket("s2", "u2");
    await actor.join(a);
    await actor.join(b);
    actor.markReady(a);
    expect(actor.launches).toBe(0);
    await actor.leave(b);
    expect(actor.launches).toBe(1);
    vi.advanceTimersByTime(ENTRY_MAX_WAIT_MS);
    expect(actor.launches).toBe(1);
  });
});

describe("RoomActor broadcasting", () => {
  it("sends each participant its own snapshot on the game's event, with the shared meta attached", async () => {
    const { io, sent } = fakeIo();
    const actor = new TestActor(io, ROW, { channelPrefix: "room", snapshotEvent: "room.snapshot" });
    await actor.join(fakeSocket("s1", "u1"));
    await actor.join(fakeSocket("s2", "u2"));
    sent.length = 0;
    const built = await actor.broadcast();
    const snapshots = sent.filter((s) => s.event === "room.snapshot");
    expect(snapshots.map((s) => s.to).sort()).toEqual(["s1", "s2"]);
    expect((snapshots[0]!.payload as { bootId: string }).bootId).toBe(BOOT_ID);
    expect(built.size).toBe(2);
    expect(actor.built.at(-1)).toBe(built);
  });

  it("coalesces a burst of chip broadcasts into a leading and a trailing flush", async () => {
    vi.useFakeTimers();
    const { io, sent } = fakeIo();
    const actor = new TestActor(io, ROW, { channelPrefix: "room", snapshotEvent: "room.snapshot" });
    await actor.join(fakeSocket("s1", "u1"));
    sent.length = 0;
    for (let i = 0; i < 10; i += 1) actor.schedule();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.filter((s) => s.event === "room.snapshot")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(sent.filter((s) => s.event === "room.snapshot")).toHaveLength(2);
  });
});

describe("RoomActor guarded cycle", () => {
  it("frees the cycle even when recovery itself throws, then asks whether to relaunch", async () => {
    vi.useFakeTimers();
    const { io } = fakeIo();
    const actor = new TestActor(io, ROW, { channelPrefix: "room", snapshotEvent: "room.snapshot" });
    const next = vi.fn();
    actor.cycle({
      run: async () => { throw new Error("round failed"); },
      recover: async () => { throw new Error("refund failed too"); },
      next,
    });
    expect(actor.running).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(actor.running).toBe(false);
    // 첫 실패라 차단기는 "계속해도 된다" 고 답한다.
    expect(next).toHaveBeenCalledWith(true);
    expect(actor.isPaused).toBe(false);
  });

  it("pauses the room after three consecutive failures", async () => {
    vi.useFakeTimers();
    const { io } = fakeIo();
    const actor = new TestActor(io, ROW, { channelPrefix: "room", snapshotEvent: "room.snapshot" });
    const outcomes: boolean[] = [];
    const attempt = () => actor.cycle({ run: async () => { throw new Error("again"); }, recover: async () => undefined, next: (relaunch) => { outcomes.push(relaunch); if (relaunch) attempt(); } });
    attempt();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(outcomes).toEqual([true, true, false]);
    expect(actor.isPaused).toBe(true);
  });

  it("does not open a new round once the process has started draining", () => {
    vi.spyOn(workTracker, "isDraining", "get").mockReturnValue(true);
    const { io } = fakeIo();
    const actor = new TestActor(io, ROW, { channelPrefix: "room", snapshotEvent: "room.snapshot" });
    const run = vi.fn(async () => true);
    actor.cycle({ run, recover: async () => undefined, next: () => undefined });
    expect(run).not.toHaveBeenCalled();
    expect(actor.running).toBe(false);
  });
});
