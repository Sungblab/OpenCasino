import type { SocketAck } from "@opencasino/contracts";

/* ===========================================================================
   연습 판(튜토리얼) — 서버 없이 브라우저 안에서만 도는 각본 판.

   진짜 방 페이지(SutdaRoomPage·HoldemRoomPage)를 그대로 그리고, 소켓 자리에 FakeSocket 을 꽂는다.
   각본(TutorialStep 목록)이 서버 노릇을 한다: 단계마다 정해 둔 스냅샷을 내보내고, 그 단계가 기다리는
   명령(콜·하프 …)이 오면 다음 장면으로 넘어간다. 그 밖의 명령은 답하지 않는다(무시).
   =========================================================================== */

type Listener = (...args: never[]) => void;
type Ack = (response: SocketAck<unknown>) => void;
type TimedAck = (error: Error | null, response: SocketAck<unknown>) => void;

/**
 * 방 페이지가 진짜 소켓에서 쓰는 만큼만(on·off·emit·timeout().emit·connected) 흉내 낸다. 명령의 답은
 * handler 가 정하고, 답이 없으면(undefined) 콜백을 아예 부르지 않는다 — 진짜 소켓처럼 "응답이 없어요"
 * 시간 초과를 내지도 않는다. 연습 판에서 그 문구는 군더더기다.
 */
export class FakeSocket {
  connected = true;
  handler: (event: string, payload: unknown) => SocketAck<unknown> | undefined = () => undefined;
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): this {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(event, set);
    return this;
  }

  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, payload?: unknown, ack?: Ack): this {
    const response = this.handler(event, payload);
    // 진짜 답처럼 한 박자 뒤에 — 클릭 핸들러 안에서 바로 부르면 페이지의 setState 순서가 실전과 달라진다.
    if (response && ack) setTimeout(() => ack(response), 0);
    return this;
  }

  timeout(_ms: number): { emit: (event: string, payload?: unknown, ack?: TimedAck) => void } {
    return {
      emit: (event, payload, ack) => {
        const response = this.handler(event, payload);
        if (response && ack) setTimeout(() => ack(null, response), 0);
      },
    };
  }

  /** 서버가 보내는 이벤트 흉내(스냅샷). */
  push(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) (listener as (...values: unknown[]) => void)(...args);
  }
}

/** 코치가 가리킬 화면 요소. text 가 있으면 그 글자로 시작하는 것만(같은 줄의 버튼 중 "콜" 하나). */
export interface TutorialTarget {
  sel: string;
  text?: string;
  /** 요소 대신 계산한 칸(화면 좌표). 캔버스에 그린 보드처럼 DOM 이 없는 것을 짚을 때. */
  rect?: () => { x: number; y: number; w: number; h: number } | null;
}

export interface CoachLine {
  title: string;
  /** 줄바꿈(\n)은 그대로 보인다. */
  body: string;
  target?: TutorialTarget;
  /** 판을 어둡게 덮을지(기본 덮음). 보드·판정처럼 판 전체를 봐야 하는 장면은 끈다. */
  dim?: boolean;
  /** 가리킬 것이 없을 때 말풍선 자리. 기본은 가운데. */
  place?: "top" | "bottom" | "center";
  /** 말풍선을 놓아 볼 순서(기본: 요소가 화면 아래쪽이면 위부터). 판정처럼 요소 위아래에 볼 것이 있을 때 옆을 먼저. */
  prefer?: Array<"above" | "below" | "left" | "right">;
  /** 말풍선을 띄우기 전 기다림(ms) — 딜 비행·결과 연출이 먼저 끝나게. */
  delay?: number;
}

export type TutorialAdvance =
  /** 코치의 "다음". */
  | { kind: "next" }
  /** 사용자의 명령. action(과 amount)이 맞아야 받는다. */
  | { kind: "act"; event: string; action: string; amount?: number }
  /** 봇이 생각하는 시간 — 저절로 넘어간다. */
  | { kind: "auto"; ms: number }
  /** 소켓 없이 화면 안에서 끝나는 동작(레이즈 창 열기·쪼기). 코치가 화면을 보고 uiDone 을 부른다. */
  | { kind: "ui"; until: "appear" | "gone"; sel: string }
  /** 마지막 카드. */
  | { kind: "end" };

export interface TutorialStep<S> {
  id: string;
  /** 이 단계에 들어설 때 내보낼 장면. 없으면 앞 장면 그대로. now 는 phaseEndsAt 을 지금 기준으로 잡는 데 쓴다. */
  scene?: (now: number) => S;
  coach?: CoachLine;
  advance: TutorialAdvance;
}

interface SceneBase { sequence: number; serverTime?: number; roundId: string | null }

export class TutorialRunner<S extends SceneBase> {
  readonly socket = new FakeSocket();
  private index = 0;
  private sequence = 0;
  private scene: S | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly game: "sutda" | "holdem", private readonly steps: TutorialStep<S>[]) {
    if (steps.length === 0 || steps[steps.length - 1]!.advance.kind !== "end") throw new Error("tutorial script must end with an end step");
    this.socket.handler = (event, payload) => this.handle(event, payload);
    this.enter(0);
  }

  get step(): TutorialStep<S> { return this.steps[this.index]!; }
  get stepIndex(): number { return this.index; }
  /** 지금 장면(마지막으로 내보낸 스냅샷). */
  get current(): S | null { return this.scene; }
  /** 말풍선이 있는 단계 중 몇 번째인지 — "3 / 18" 표시용. */
  get progress(): { at: number; total: number } {
    const coached = this.steps.filter((step) => step.coach);
    return { at: coached.indexOf(this.step) + 1, total: coached.length };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** 코치의 "다음". 명령을 기다리는 단계에서는 아무 일도 없다 — 버튼을 직접 눌러야 넘어간다. */
  next(): void {
    if (this.step.advance.kind === "next") this.enter(this.index + 1);
  }

  /** 화면 안 동작이 끝났다(레이즈 창이 떴다·쪼기가 끝났다). 늦게 온 신호가 다음 단계를 건너뛰지 않게 id 로 확인한다. */
  uiDone(stepId: string): void {
    if (this.step.id === stepId && this.step.advance.kind === "ui") this.enter(this.index + 1);
  }

  /** 건너뛰기 — 마지막 카드로. */
  skip(): void {
    if (this.step.advance.kind !== "end") this.enter(this.steps.length - 1);
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private enter(index: number): void {
    this.dispose();
    this.index = index;
    const step = this.steps[index]!;
    if (step.scene) {
      const now = Date.now();
      // 페이지는 sequence 가 줄면 옛 스냅샷으로 보고 버린다 — 늘 하나씩 올린다.
      this.scene = { ...step.scene(now), sequence: ++this.sequence, serverTime: now };
      this.socket.push(`${this.game}.snapshot`, this.scene);
    }
    if (step.advance.kind === "auto") {
      this.timer = setTimeout(() => { this.timer = null; this.enter(index + 1); }, step.advance.ms);
    }
    for (const listener of this.listeners) listener();
  }

  private handle(event: string, payload: unknown): SocketAck<unknown> | undefined {
    if (event === `${this.game}.join`) return this.scene ? { ok: true, data: this.scene } : undefined;
    if (event === `${this.game}.leave`) return { ok: true, data: undefined };
    const advance = this.step.advance;
    if (advance.kind !== "act" || advance.event !== event || !payload || typeof payload !== "object") return undefined;
    const body = payload as { roundId?: unknown; action?: unknown; amount?: unknown };
    // 지난 판에 보낸 명령·다른 버튼·다른 금액은 받지 않는다.
    if (body.roundId !== this.scene?.roundId || body.action !== advance.action) return undefined;
    if (advance.amount !== undefined && body.amount !== advance.amount) return undefined;
    this.enter(this.index + 1);
    return { ok: true, data: this.scene };
  }
}
