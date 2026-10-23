import type { ClientToServerEvents, SocketAck } from "@opencasino/contracts";
import { pool } from "../database/pool.js";
import { DomainError, wireCode } from "../errors/domain-error.js";
import { messageFor } from "../errors/messages.js";
import type { AppSocket } from "../games/rooms/room-actor.js";
import { workTracker } from "../process/work-tracker.js";
import { createSocketCommandBudget, userCommandAllowed } from "../rate-limit/limits.js";
import { createSerialQueue } from "./serial-queue.js";

type EventName = keyof ClientToServerEvents;
type Payload<E extends EventName> = Parameters<ClientToServerEvents[E]>[0];
type AckOf<E extends EventName> = Parameters<ClientToServerEvents[E]>[1];
type AckData<E extends EventName> = AckOf<E> extends (response: SocketAck<infer T>) => void ? T : never;

/** 요청 형식이 틀렸을 때 던지지 않고 돌려주는 값. 예외가 아니라 정해진 코드·문장으로 답한다. */
export class Rejected {
  constructor(readonly code: string, readonly error: string) {}
}

export function reject(code: string, error: string): Rejected {
  return new Rejected(code, error);
}

export interface CommandOptions {
  /** 어떤 오류든 이 코드로 답한다(방 입장·퇴장은 예전부터 ROOM_JOIN_FAILED/ROOM_LEAVE_FAILED 하나였다). */
  failureCode?: string;
  /** 규칙 위반(DomainError)이 아닌 오류일 때 쓸 코드. 규칙 위반이면 그 코드가 그대로 나간다. */
  fallbackCode?: string;
  /** 이 소켓의 다른 serial 명령과 들어온 순서대로 하나씩 실행한다(방 입장·퇴장). */
  serial?: boolean;
}

export interface CommandContext {
  readonly socket: AppSocket;
  readonly userId: string;
  readonly isAdmin: boolean;
  on<E extends EventName>(event: E, options: CommandOptions, run: (payload: Payload<E>) => Promise<AckData<E> | Rejected>): void;
}

/** How long a socket may trust its last `approved` read before checking again. */
const APPROVAL_CACHE_MS = 3_000;

/**
 * 소켓 하나의 명령 처리 틀. 모든 명령이 같은 순서를 밟는다:
 *   ack 가 함수인지 확인 → 권한·속도 확인 → 실행 → { ok, data } 또는 { ok:false, code, error }.
 * 예전에는 이 열 줄이 명령 50여 개마다 복사되어 있었다.
 */
export function createCommandContext(socket: AppSocket): CommandContext {
  const socketBudget = createSocketCommandBudget();
  const membership = createSerialQueue();
  let approvedUntil = 0;

  const authorize = async (): Promise<void> => {
    // 종료 중에는 새 명령을 받지 않는다. 돌던 정산은 process/work-tracker.ts 가 기다려 준다.
    if (workTracker.isDraining) throw new DomainError("SERVER_RESTARTING");
    const now = Date.now();
    if (!socketBudget(now)) throw new DomainError("RATE_LIMITED");
    // The per-socket budget above only limits one connection; the same token can open as many as
    // it likes, so the account carries its own budget across all of them.
    if (!userCommandAllowed(socket.data.user.id, now)) throw new DomainError("RATE_LIMITED");
    if (!socket.data.user.exp || socket.data.user.exp * 1_000 <= now) throw new DomainError("UNAUTHORIZED");
    // A DB round trip per command just to re-read one boolean. Cached briefly instead: a
    // suspension still lands within APPROVAL_CACHE_MS, and the admin action that causes it
    // already revokes the refresh chain.
    if (now >= approvedUntil) {
      const status = await pool.query<{ approved: boolean; role: string }>(
        "SELECT (approved AND deleted_at IS NULL) AS approved,role FROM users WHERE id=$1",
        [socket.data.user.id],
      );
      if (!status.rows[0]?.approved) throw new DomainError("UNAUTHORIZED");
      // 관리자 전용 명령(admin.support.send 등)이 보는 역할도 같이 새로 읽는다 — 토큰의 role 은 발급 시점 값이다.
      socket.data.user.role = status.rows[0].role === "admin" ? "admin" : "user";
      approvedUntil = now + APPROVAL_CACHE_MS;
    }
  };

  return {
    socket,
    userId: socket.data.user.id,
    get isAdmin() {
      return socket.data.user.role === "admin";
    },
    on(event, options, run) {
      const handle = async (payload: unknown, ack: unknown): Promise<void> => {
        if (typeof ack !== "function") return;
        const reply = ack as (response: SocketAck<unknown>) => void;
        try {
          await authorize();
          // 명령 하나가 도는 동안은 종료가 기다려 준다 — 베팅이 원장에 적히는 도중에 풀이 닫히지 않게.
          const result = await workTracker.track(`socket:${event}`, () => run(payload as Payload<typeof event>));
          if (result instanceof Rejected) reply({ ok: false, code: result.code, error: result.error });
          else reply({ ok: true, data: result });
        } catch (error) {
          reply({ ok: false, code: options.failureCode ?? wireCode(error, options.fallbackCode ?? "COMMAND_FAILED"), error: messageFor(error) });
        }
      };
      const listener = options.serial
        ? (payload: unknown, ack: unknown) => membership(() => handle(payload, ack))
        : handle;
      // 이벤트 이름이 제네릭이라 socket.io 의 타입이 리스너 인자를 좁히지 못한다. 인자 타입은
      // 위의 Payload<E>/AckData<E> 가 contracts 의 이벤트 정의에서 직접 뽑으므로 여기서 어긋나지 않는다.
      (socket as unknown as { on(event: string, listener: (payload: unknown, ack: unknown) => unknown): void }).on(event, listener);
    },
  };
}
