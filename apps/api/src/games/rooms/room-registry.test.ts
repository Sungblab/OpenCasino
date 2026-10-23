import { describe, expect, it } from "vitest";
import type { AppServer } from "./room-actor.js";
import { RoomRegistry } from "./room-registry.js";

describe("RoomRegistry", () => {
  it("broadcasts room chat to exactly the fourteen game channels (one per room manager)", () => {
    const registry = new RoomRegistry({} as AppServer);
    // 선 위의 이름이다 — 바꾸면 해당 게임의 방 채팅이 조용히 끊긴다.
    expect(registry.chatChannels("r1")).toEqual(["room:r1", "dt-room:r1", "roulette-room:r1", "sicbo-room:r1", "mw-room:r1", "tg-room:r1", "crash-room:r1", "slot-room:r1", "video-poker-room:r1", "pachinko-room:r1", "bj-room:r1", "holdem-room:r1", "sutda-room:r1", "seven_poker-room:r1", "badugi-room:r1", "gostop-room:r1"]);
  });

  it("answers 'not mine' for an unknown room everywhere the old || / ?? chains did", async () => {
    const registry = new RoomRegistry({} as AppServer);
    expect(registry.ownerOf("nope")).toBeNull();
    expect(registry.setPaused("nope", true)).toBe(false);
    expect(registry.participantUserIds("nope")).toBeNull();
    expect(registry.isParticipant("u1", "nope")).toBe(false);
    expect(await registry.resetRoad("nope")).toBe(false);
    expect(registry.listRooms()).toEqual([]);
  });

  it("finds the seated-game manager for emotes", () => {
    const registry = new RoomRegistry({} as AppServer);
    expect(registry.seated("holdem")).toBe(registry.holdem);
    expect(registry.seated("sutda")).toBe(registry.sutda);
    expect(registry.seated("gostop")).toBe(registry.gostop);
    expect(registry.seated("badugi")).toBe(registry.badugi);
    expect(registry.seated("seven_poker")).toBe(registry.sevenPoker);
  });
});
