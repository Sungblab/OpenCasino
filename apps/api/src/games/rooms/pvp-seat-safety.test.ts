import { describe, expect, it, vi } from "vitest";

/**
 * PvP 좌석 규칙 — 판 도중 비운 홀덤 자리에 앉기, 판 도중 봇 내보내기, 동시에 들어온 착석 요청.
 * DB·지갑은 가짜다. 여기서 보는 것은 방 액터의 메모리 상태(좌석 배열)가 어떻게 바뀌는지뿐이다.
 */
vi.mock("../../database/pool.js", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() } }));
vi.mock("../../wallet/wallet-service.js", () => ({
  walletService: {
    getUserBalance: vi.fn(async () => 1_000_000),
    getUserBalances: vi.fn(async () => new Map<string, number>()),
  },
}));

const { HoldemRoomActor } = await import("./holdem-room-manager.js");
const { SutdaRoomActor } = await import("./sutda-room-manager.js");
const { GostopRoomActor } = await import("./gostop-room-manager.js");

const fakeIo = { emit: vi.fn(), to: vi.fn(() => ({ emit: vi.fn() })) } as never;
const base = { game_type: "holdem" as const, code: "t", name: "t", min_bet: 10, max_bet: 100, enabled: true };

function holdem() {
  const actor = new HoldemRoomActor(fakeIo, { ...base, id: "holdem-room" }, { channelPrefix: "holdem-room", snapshotEvent: "holdem.snapshot" });
  return prepare(actor);
}
function sutda() {
  const actor = new SutdaRoomActor(fakeIo, { ...base, id: "sutda-room", game_type: "sutda", variant: "two" }, { channelPrefix: "sutda-room", snapshotEvent: "sutda.snapshot" });
  return prepare(actor);
}
function gostop() {
  const actor = new GostopRoomActor(fakeIo, { ...base, id: "gostop-room", game_type: "gostop", variant: "two" });
  return prepare(actor);
}

/** 브로드캐스트는 이 테스트의 관심사가 아니다 — 스냅샷을 만들지 않게 막아 둔다. */
function prepare<T extends object>(actor: T) {
  const any = actor as any;
  any.emitSnapshots = async () => new Map();
  any.snapshot = async () => ({});
  const join = (...userIds: string[]) => { for (const id of userIds) any.participants.set(id, new Set()); };
  return { actor, any, join };
}

const seatsOf = (any: any) => (any.seats as Array<{ userId: string } | null>).map((seat) => seat?.userId ?? null);
const seatCommand = (roomId: string, seatNumber: number) => ({ requestId: "00000000-0000-4000-8000-000000000000", roomId, seatNumber });

describe("Hold'em: a seat dealt into the hand in flight stays closed until it ends", () => {
  it("refuses a newcomer — and the player who just left it — while the hand runs", async () => {
    const { actor, any, join } = holdem();
    join("alice", "bob", "carol");
    await actor.sit("alice", seatCommand("holdem-room", 1));
    await actor.sit("bob", seatCommand("holdem-room", 2));
    // A hand is in flight with seats 1 and 2 dealt in; bob folds and stands up, freeing seat 2.
    any.roundId = "round-1";
    any.handSeats = new Set([1, 2]);
    any.seats[1] = null;

    await expect(actor.sit("carol", seatCommand("holdem-room", 2))).rejects.toThrow("SEAT_TAKEN");
    await expect(actor.sit("bob", seatCommand("holdem-room", 2))).rejects.toThrow("SEAT_TAKEN");
    // A seat nobody was dealt into is fine — it simply sits out this hand.
    await actor.sit("carol", seatCommand("holdem-room", 3));
    expect(seatsOf(any)).toEqual(["alice", null, "carol", null, null, null]);

    // Once the hand resets the freed seat opens again.
    any.resetHandState();
    await actor.sit("bob", seatCommand("holdem-room", 2));
    expect(seatsOf(any)[1]).toBe("bob");
  });

  it("never hands the turn to a seat without hole cards", () => {
    const { any } = holdem();
    const seat = (userId: string, holeCards: unknown[]) => ({ userId, username: userId, stackMinor: 10_000, folded: false, allIn: false, streetContributed: 0, totalContributed: 0, holeCards, lastAction: null, timeBankMs: 0, handsDealt: 0 });
    const card = { rank: "A", suit: "S" };
    any.seats = [seat("alice", [card, card]), seat("cardless", []), seat("carol", [card, card]), null, null, null];
    expect(any.nextActiveSeat(1, [1, 2, 3])).toBe(3);
    any.actedSinceLastRaise = new Set([0, 2]);
    any.currentBet = 0;
    expect(any.bettingRoundClosed([1, 2, 3])).toBe(true);
  });
});

describe("bots leave between hands only", () => {
  for (const [name, make, roomId] of [["Hold'em", holdem, "holdem-room"], ["Sutda", sutda, "sutda-room"], ["Go-Stop", gostop, "gostop-room"]] as const) {
    it(`${name}: refuses removeBot while a hand runs, allows it after`, async () => {
      const { actor, any, join } = make();
      join("alice", "bot-1");
      await (actor as any).sit("alice", seatCommand(roomId, 1));
      await (actor as any).sit("bot-1", seatCommand(roomId, 2));
      any.bots.add("bot-1", "normal");
      any.roundId = "round-1";
      await expect((actor as any).removeBot("alice", 2)).rejects.toThrow("BOT_IN_HAND");
      expect(seatsOf(any)[1]).toBe("bot-1");
      expect(any.bots.has("bot-1")).toBe(true);

      any.roundId = null;
      await (actor as any).removeBot("alice", 2);
      expect(seatsOf(any)[1]).toBeNull();
      expect(any.bots.has("bot-1")).toBe(false);
    });
  }
});

describe("two sit requests racing through the balance check", () => {
  for (const [name, make, roomId] of [["Hold'em", holdem, "holdem-room"], ["Sutda", sutda, "sutda-room"], ["Go-Stop", gostop, "gostop-room"]] as const) {
    it(`${name}: one account never ends up in two seats, and one seat never gets two accounts`, async () => {
      const { actor, any, join } = make();
      join("alice", "bob", "carol");
      const sit = (userId: string, seatNumber: number) => (actor as any).sit(userId, seatCommand(roomId, seatNumber)) as Promise<unknown>;

      const sameUser = await Promise.allSettled([sit("alice", 1), sit("alice", 2)]);
      expect(sameUser.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
      expect((sameUser[1] as PromiseRejectedResult).reason.message).toBe("ALREADY_SEATED");
      expect(seatsOf(any).filter((id) => id === "alice")).toHaveLength(1);

      const sameSeat = await Promise.allSettled([sit("bob", 2), sit("carol", 2)]);
      expect(sameSeat.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
      expect((sameSeat[1] as PromiseRejectedResult).reason.message).toBe("SEAT_TAKEN");
      expect(seatsOf(any)[1]).toBe("bob");
      expect(seatsOf(any)).not.toContain("carol");
    });
  }
});
