import type { BotSkill } from "@opencasino/contracts";
import { createRng, seedFrom } from "@opencasino/game-core/bots";
import { logger } from "../../logging/logger.js";

/**
 * 봇이 "언제" 움직이는지를 맡는 부분. "무엇을" 할지는 game-core 의 두뇌가, "어떻게"
 * 반영할지는 룸 매니저의 public 메서드가 맡는다.
 *
 * 룸 매니저는 이미 상태가 바뀔 때마다 유저별 스냅샷을 만들어 뿌린다. 그 결과를 여기에
 * 그대로 넘기면, 봇 좌석의 스냅샷만 보고 지금 답해야 할 것이 있는지 판단한다. 봇이 보는
 * 것은 사람에게 가는 스냅샷과 완전히 같은 객체다 — 숨은 패는 이미 null 로 지워져 있어서,
 * 두뇌가 아무리 잘못 짜여도 남의 패를 볼 길이 구조적으로 없다.
 */

/**
 * 결정의 무게. 매니저는 이것만 고르고, 몇 초를 쓸지는 `thinkMs` 가 정한다.
 *
 * 공개 정보(베팅 크기·스트리트·무엇을 묻는가)로만 고른다. 패 세기나 기댓값 차이로 고르면
 * 고민 시간이 텔이 된다 — 사람이 봇의 시간만 보고 패를 읽어 하우스 돈을 따 간다.
 */
export type ThinkLevel = "quick" | "normal" | "hard";

/** 지금 이 봇이 답해야 할 일. `key` 가 같으면 같은 일이고, 두 번 실행하지 않는다. */
export interface BotJob {
  /** 보통 `${roundId}:${sequence}:${무엇}` — 상태가 바뀌면 달라져야 한다. */
  key: string;
  level: ThinkLevel;
}

export interface BotSchedulerOptions<S> {
  /** 로그에 찍히는 이름. 보통 방 코드. */
  label: () => string;
  /** 이 게임의 액션 제한. 고민 시간이 이 값의 절반 가까이를 넘지 않게 자른다. */
  actionMs: number;
  /** 이 스냅샷을 받은 봇이 지금 답해야 할 일이 있는가. */
  pending: (snapshot: S) => BotJob | null;
  /** 결정하고 실행한다. 예외는 스케줄러가 삼킨다 — 기존 타임아웃 경로가 판을 이어받는다. */
  run: (userId: string, snapshot: S) => Promise<void>;
}

export class BotScheduler<S> {
  /** 이 방에 앉아 있는 봇들 → 각자의 강도. 부른 뒤에는 바뀌지 않는다. */
  private readonly bots = new Map<string, BotSkill>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** 봇별로 마지막에 착수한 일의 key. 같은 key 를 다시 받으면 무시한다. */
  private readonly started = new Map<string, string>();

  constructor(private readonly options: BotSchedulerOptions<S>) {}

  get size(): number { return this.bots.size; }
  has(userId: string): boolean { return this.bots.has(userId); }
  userIds(): string[] { return [...this.bots.keys()]; }
  /** 그 봇의 강도. 봇이 아니면 null — 스냅샷의 botSkill 이 그대로 이 값이다. */
  skillOf(userId: string): BotSkill | null { return this.bots.get(userId) ?? null; }

  add(userId: string, skill: BotSkill): void { this.bots.set(userId, skill); }

  remove(userId: string): void {
    this.bots.delete(userId);
    const timer = this.timers.get(userId);
    if (timer) { clearTimeout(timer); this.timers.delete(userId); }
    this.started.delete(userId);
  }

  clear(): void {
    for (const userId of this.userIds()) this.remove(userId);
  }

  /**
   * 룸 매니저가 `emit()` 끝에서 부른다. 봇 좌석의 스냅샷을 훑어 할 일이 있으면 예약한다.
   *
   * 비동기를 기다리지 않는다 — emit 은 사람 화면을 갱신하는 경로이고, 봇 계산이 그걸
   * 막으면 봇을 부른 순간 테이블 전체가 느려진다.
   */
  onSnapshots(snapshots: Map<string, S>): void {
    for (const userId of this.bots.keys()) {
      const snapshot = snapshots.get(userId);
      if (!snapshot) continue;
      let job: BotJob | null;
      try {
        job = this.options.pending(snapshot);
      } catch (error) {
        logger.error("bot pending check failed", { room: this.options.label(), err: error });
        continue;
      }
      if (!job) continue;
      if (this.started.get(userId) === job.key) continue;
      // 착수 표시를 예약 시점에 찍는다. 실행 시점에 찍으면 지연 중에 도착한 스냅샷이
      // 같은 일을 한 번 더 예약한다.
      this.started.set(userId, job.key);
      const existing = this.timers.get(userId);
      if (existing) clearTimeout(existing);
      const delayMs = thinkMs(job.level, tempoOf(userId), this.options.actionMs);
      this.timers.set(userId, setTimeout(() => {
        this.timers.delete(userId);
        if (!this.bots.has(userId)) return;
        void this.options.run(userId, snapshot).catch((error) => {
          // 여기서 삼키는 게 핵심이다. 봇이 못 움직이면 매니저의 시간초과 경로가 기본
          // 행동으로 판을 이어간다 — 봇 버그로 방이 멈추지 않는다.
          logger.error("bot action failed", { room: this.options.label(), err: error });
        });
      }, delayMs));
    }
  }
}

/* ---------------------------------------------------------------------------
   고민 시간
   --------------------------------------------------------------------------- */

const THINK_RANGE: Record<ThinkLevel, [number, number]> = {
  quick: [1_000, 3_000],
  normal: [2_000, 5_000],
  hard: [5_000, 10_000],
};
/** 범위 안에서 짧은 쪽으로 몰리는 정도. 사람 반응 시간은 대개 빠르고 가끔 길다(오른쪽 꼬리). */
const SKEW = 1.6;
/** 무거운 결정에서 한참 더 고민하는 확률과 그 길이. */
const TANK_CHANCE = 0.15;
const TANK_RANGE: [number, number] = [2_000, 5_000];
/** 액션 제한 중 봇이 쓸 수 있는 몫. 시간초과 근처까지 가면 고민이 아니라 고장으로 보인다. */
const ACTION_SHARE = 0.45;
/** 봇마다 고정된 템포. 늘 빨리 두는 봇과 늘 느긋한 봇이 섞여야 테이블이 기계처럼 안 보인다. */
const TEMPOS = [0.85, 1, 1.15, 1.3];

export function thinkMs(level: ThinkLevel, tempo: number, actionMs: number, random: () => number = Math.random): number {
  const [low, high] = THINK_RANGE[level];
  let ms = low + (high - low) * Math.pow(random(), SKEW);
  if (level === "hard" && random() < TANK_CHANCE) ms += TANK_RANGE[0] + (TANK_RANGE[1] - TANK_RANGE[0]) * random();
  return Math.round(Math.min(ms * tempo, actionMs * ACTION_SHARE));
}

export function tempoOf(userId: string): number {
  return createRng(seedFrom(userId, "tempo")).pick(TEMPOS);
}

/**
 * 베팅 결정의 무게. 판돈만큼 이상 받아야 하거나 콜이 곧 올인이면 무겁다. 하프(판돈의 절반)는
 * 섯다에서 가장 흔한 베팅이라 보통으로 둔다 — 거기까지 무겁게 보면 봇이 매번 장고한다.
 * `pot` 은 받아야 할 베팅까지 들어간 지금 판돈이다.
 */
export function bettingLevel(input: { toCall: number; pot: number; stack: number }): ThinkLevel {
  const { toCall, pot, stack } = input;
  if (toCall === 0) return "normal";
  if (toCall >= stack || toCall >= Math.max(1, pot - toCall)) return "hard";
  return "normal";
}
