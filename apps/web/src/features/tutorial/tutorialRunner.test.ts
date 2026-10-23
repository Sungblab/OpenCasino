import { describe, expect, it, vi } from "vitest";
import { holdemRoomSnapshotSchema, sutdaRoomSnapshotSchema, type HoldemRoomSnapshot, type SutdaRoomSnapshot } from "@opencasino/contracts";
import { TutorialRunner, type FakeSocket, type TutorialStep } from "./tutorialRunner";
import { SUTDA_HAND1, SUTDA_HAND2, sutdaTutorial } from "./sutdaScript";
import { HOLDEM_HAND1, HOLDEM_HAND2, holdemTutorial } from "./holdemScript";

// 각본 걷기(describe 본문)도 봇 단계의 타이머를 쓰므로 파일 전체를 가짜 시계로 돌린다.
vi.useFakeTimers();

interface Mini { sequence: number; roundId: string | null; label: string }
const ROUND = "71000000-0000-4000-8000-000000000099";
const mini = (label: string) => () => ({ sequence: 0, roundId: ROUND, label });
const MINI: TutorialStep<Mini>[] = [
  { id: "a", scene: mini("a"), advance: { kind: "next" }, coach: { title: "A", body: "" } },
  { id: "b", advance: { kind: "act", event: "sutda.act", action: "call" }, coach: { title: "B", body: "" } },
  { id: "c", scene: mini("c"), advance: { kind: "auto", ms: 1000 } },
  { id: "d", scene: mini("d"), advance: { kind: "ui", until: "gone", sel: ".x" }, coach: { title: "D", body: "" } },
  { id: "e", advance: { kind: "end" }, coach: { title: "E", body: "" } },
];

/** 진짜 페이지처럼 소켓에 붙어 스냅샷을 모은다. */
function attach(runner: TutorialRunner<Mini>, game: string) {
  const seen: Mini[] = [];
  runner.socket.on(`${game}.snapshot`, ((snapshot: Mini) => { seen.push(snapshot); }) as never);
  return seen;
}

/** 명령을 보내고 ack 를 기다린다(가짜 소켓은 한 박자 뒤에 답한다). 답이 없으면 undefined. */
function send(runner: { socket: FakeSocket }, event: string, payload: unknown) {
  let response: unknown;
  runner.socket.timeout(8000).emit(event, payload, (_error, ack) => { response = ack; });
  vi.advanceTimersByTime(1);
  return response as { ok: boolean; data?: unknown } | undefined;
}

describe("TutorialRunner", () => {
  it("join 은 지금 장면으로 답하고, 장면마다 sequence 를 올린다", () => {
    const runner = new TutorialRunner<Mini>("sutda", MINI);
    const join = send(runner, "sutda.join", { roomId: "x" });
    expect(join?.ok).toBe(true);
    expect((join?.data as Mini).label).toBe("a");
    expect(runner.current?.sequence).toBe(1);
  });

  it("다음은 설명 단계에서만 넘어가고, 명령 단계는 버튼을 직접 눌러야 한다", () => {
    const runner = new TutorialRunner<Mini>("sutda", MINI);
    runner.next();
    expect(runner.step.id).toBe("b");
    runner.next();
    expect(runner.step.id).toBe("b");
  });

  it("기다리는 명령만 받고 다른 버튼·지난 판·다른 이벤트는 답 없이 무시한다", () => {
    const runner = new TutorialRunner<Mini>("sutda", MINI);
    const seen = attach(runner, "sutda");
    runner.next();
    expect(send(runner, "sutda.act", { roundId: ROUND, action: "die" })).toBeUndefined();
    expect(send(runner, "sutda.act", { roundId: "71000000-0000-4000-8000-000000000001", action: "call" })).toBeUndefined();
    expect(send(runner, "holdem.act", { roundId: ROUND, action: "call" })).toBeUndefined();
    expect(send(runner, "sutda.ready", { roomId: "x", ready: true })).toBeUndefined();
    expect(runner.step.id).toBe("b");
    expect(seen).toHaveLength(0);

    const ack = send(runner, "sutda.act", { roundId: ROUND, action: "call" });
    expect(ack?.ok).toBe(true);
    expect((ack?.data as Mini).label).toBe("c");
    expect(seen.map((s) => s.label)).toEqual(["c"]);
    expect(seen[0]!.sequence).toBe(2);
  });

  it("봇 단계는 시간이 지나면 저절로, 화면 동작은 그 단계의 uiDone 으로만 넘어간다", () => {
    const runner = new TutorialRunner<Mini>("sutda", MINI);
    runner.next();
    send(runner, "sutda.act", { roundId: ROUND, action: "call" });
    expect(runner.step.id).toBe("c");
    vi.advanceTimersByTime(998); // send 가 ack 를 기다리며 1ms 를 이미 썼다

    expect(runner.step.id).toBe("c");
    vi.advanceTimersByTime(1);
    expect(runner.step.id).toBe("d");
    runner.uiDone("c");
    runner.next();
    expect(runner.step.id).toBe("d");
    runner.uiDone("d");
    expect(runner.step.id).toBe("e");
  });

  it("건너뛰기는 마지막 카드로, 진행 표시는 말풍선 단계만 센다", () => {
    const runner = new TutorialRunner<Mini>("sutda", MINI);
    expect(runner.progress).toEqual({ at: 1, total: 4 });
    runner.skip();
    expect(runner.step.advance.kind).toBe("end");
    expect(runner.progress).toEqual({ at: 4, total: 4 });
  });
});

/** 각본을 끝까지 몬다 — 명령 단계는 그 단계가 기다리는 명령을, 설명·화면 단계는 다음을. */
function walk<S extends { sequence: number; roundId: string | null }>(game: "sutda" | "holdem", steps: TutorialStep<S>[]) {
  const runner = new TutorialRunner<S>(game, steps);
  const scenes: S[] = [runner.current!];
  runner.socket.on(`${game}.snapshot`, ((snapshot: S) => { scenes.push(snapshot); }) as never);
  const acted: Array<{ action: string; scene: S }> = [];
  for (let guard = 0; guard < 100 && runner.step.advance.kind !== "end"; guard += 1) {
    const advance = runner.step.advance;
    if (advance.kind === "next") runner.next();
    else if (advance.kind === "ui") runner.uiDone(runner.step.id);
    else if (advance.kind === "auto") vi.advanceTimersByTime(advance.ms);
    else if (advance.kind === "act") {
      const before = runner.current!;
      acted.push({ action: advance.action, scene: before });
      const ack = send(runner, advance.event, { requestId: "r", roomId: "x", roundId: before.roundId, action: advance.action, amount: advance.amount });
      expect(ack?.ok, `${runner.step.id} 의 명령이 받아져야 한다`).toBe(true);
    }
  }
  expect(runner.step.advance.kind).toBe("end");
  return { scenes, acted };
}

describe("섯다 각본", () => {
  const { scenes, acted } = walk<SutdaRoomSnapshot>("sutda", sutdaTutorial("나"));

  it("모든 장면이 실제 계약(sutdaRoomSnapshotSchema) 모양이고 판돈은 좌석 기여의 합이다", () => {
    for (const scene of scenes) {
      expect(() => sutdaRoomSnapshotSchema.parse(scene)).not.toThrow();
      expect(scene.pot.amount).toBe(scene.seats.reduce((sum, seat) => sum + seat.totalContributed, 0));
    }
    expect(scenes.map((s) => s.sequence)).toEqual(scenes.map((_, i) => i + 1));
  });

  it("누르라는 버튼은 그 장면에서 실제로 눌린다(서버 사이징 그대로)", () => {
    expect(acted.map((a) => a.action)).toEqual(["call", "half", "check", "die"]);
    for (const { action, scene } of acted) {
      expect(scene.actingSeat).toBe(scene.mySeatNumber);
      expect(scene.betOptions.find((o) => o.action === action)?.enabled, action).toBe(true);
    }
    // 1차: 하늘 하프 10 → 콜 10. 2차: 하늘 하프 20 → 내 하프 = 콜 20 + 팟 60 의 ½ = 50, 따당 40.
    expect(acted[0]!.scene.betOptions.find((o) => o.action === "call")?.amount).toBe(10);
    expect(acted[1]!.scene.betOptions.find((o) => o.action === "half")?.amount).toBe(50);
    expect(acted[1]!.scene.betOptions.find((o) => o.action === "ddadang")?.amount).toBe(40);
    // 2판 첫 베팅은 하프-콜 룰로 삥·쿼터·올인이 잠긴다.
    const opening = acted[2]!.scene.betOptions;
    expect(opening.filter((o) => !o.enabled).map((o) => o.action)).toEqual(["bbing", "quarter", "allin"]);
  });

  it("정산 숫자는 손 검산값 — 딜러비 7, 땡값 7, 손익 +70/−77, 다이 승은 딜러비 없음", () => {
    const hand1 = scenes.find((s) => s.room.phase === "RESULT" && s.lastWinners[0]?.handLabel === "7땡")!;
    expect(hand1.lastRake).toBe(SUTDA_HAND1.rake);
    expect(SUTDA_HAND1).toEqual({ pot: 140, rake: 7, ddaeng: 7, myNet: 70, botNet: -77 });
    expect(hand1.pot.amount).toBe(140);
    // 돈은 새지 않는다: 손익의 합 + 딜러비 = 0.
    expect(hand1.lastResults.reduce((sum, row) => sum + row.net, 0) + hand1.lastRake).toBe(0);
    expect(hand1.seats.find((s) => s.seatNumber === 4)?.handLabel).toBe("갑오");

    const hand2 = scenes[scenes.length - 1]!;
    expect(hand2.lastRake).toBe(0);
    expect(hand2.lastResults.reduce((sum, row) => sum + row.net, 0)).toBe(0);
    expect(SUTDA_HAND2).toEqual({ pot: 30, myNet: -10, botNet: 10 });
    expect(hand2.seats.find((s) => s.seatNumber === 4)?.cards).toBeNull();
  });
});

describe("홀덤 각본", () => {
  const { scenes, acted } = walk<HoldemRoomSnapshot>("holdem", holdemTutorial("나"));

  it("모든 장면이 실제 계약(holdemRoomSnapshotSchema) 모양이고 팟은 좌석 기여의 합이다", () => {
    for (const scene of scenes) {
      expect(() => holdemRoomSnapshotSchema.parse(scene)).not.toThrow();
      expect(scene.pots.reduce((sum, pot) => sum + pot.amount, 0)).toBe(scene.seats.reduce((sum, seat) => sum + seat.totalContributed, 0));
    }
  });

  it("누르라는 명령은 내 차례에, 금액은 프리셋 값(3x = 30, ½ 팟 = 60)이다", () => {
    expect(acted.map((a) => a.action)).toEqual(["raise", "check", "call", "bet", "call"]);
    for (const { scene } of acted) expect(scene.actingSeat).toBe(1);
    const river = acted[3]!.scene;
    expect(river.toCall).toBe(0);
    expect(river.pots.reduce((sum, pot) => sum + pot.amount, 0) / 2).toBe(60);
  });

  it("쇼다운은 플러시가 트리플을 이기고, 레이크 12 를 뗀 228 이 내 몫이다", () => {
    const showdown = scenes.find((s) => s.street === "showdown")!;
    expect(showdown.seats.find((s) => s.seatNumber === 1)?.handCategory).toBe("flush");
    expect(showdown.seats.find((s) => s.seatNumber === 4)?.handCategory).toBe("three_of_a_kind");
    expect(showdown.lastWinners[0]).toMatchObject({ seatNumber: 1, amount: HOLDEM_HAND1.won });
    expect(HOLDEM_HAND1.pot - HOLDEM_HAND1.rake).toBe(HOLDEM_HAND1.won);
    // 칩은 새지 않는다: (608 − 500) + (380 − 500) + 레이크 12 = 0.
    expect(HOLDEM_HAND1.myStack - 500 + (HOLDEM_HAND1.skyStack - 500) + HOLDEM_HAND1.rake).toBe(0);
  });

  it("올인 장면은 메인 120(셋)·사이드 60(나·하늘)으로 갈린다", () => {
    const last = scenes[scenes.length - 1]!;
    expect(last.pots).toEqual([{ amount: HOLDEM_HAND2.main, eligibleSeats: [1, 2, 4] }, { amount: HOLDEM_HAND2.side, eligibleSeats: [1, 4] }]);
    expect(last.seats.find((s) => s.seatNumber === 2)).toMatchObject({ allIn: true, stack: 0, totalContributed: 40 });
  });
});
