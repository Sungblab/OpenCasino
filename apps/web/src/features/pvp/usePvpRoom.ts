import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { BotSkill, SocketAck } from "@opencasino/contracts";
import { useBotSkill } from "../../components/PvpBits";
import { useRoomPresence, type GameSocket } from "../../lib/gameSocket";
import { PVP_TIMEOUT_TEXT, pvpErrorText } from "../../lib/pvpErrors";
import { randomRequestId } from "../../lib/requestId";
import { acceptSnapshot } from "../../lib/snapshots";
import { ACK_TIMEOUT_MS } from "../../lib/useSocketStatus";

export type PvpGame = "holdem" | "sutda" | "gostop" | "sevenPoker" | "badugi";

/** 세 게임 스냅샷이 공통으로 가진 것만. */
interface PvpSnapshotBase {
  sequence: number;
  bootId?: string;
  serverTime?: number;
  room: { phase: string };
  walletBalance: number;
}

type Ack<T> = SocketAck<T>;
type AckHandler<T> = (ack: Ack<T>) => void;
type TimedAckHandler<T> = (timedOut: Error | null, ack: Ack<T>) => void;

/**
 * 세 게임의 공통 명령(입장·퇴장·앉기·일어서기·준비·봇)은 이벤트 이름의 접두어만 다르고 모양이
 * 같다(`holdem.sit` / `sutda.sit` / `gostop.sit`). 타입이 있는 소켓은 이벤트 이름을 문자열 리터럴로
 * 요구해서 접두어를 조립하면 타입이 안 맞는다 — 그 한 가지 이유로 여기서만 느슨한 모양으로 본다.
 * 게임 고유 명령(act·play·choose …)은 페이지가 원래의 타입 있는 소켓으로 보낸다.
 */
interface LooseSocket {
  connected: boolean;
  emit(event: string, payload: unknown, ack: (response: Ack<unknown>) => void): void;
  timeout(ms: number): { emit(event: string, payload: unknown, ack: (error: Error | null, response: Ack<unknown>) => void): void };
  on(event: string, listener: (...args: never[]) => void): void;
  off(event: string, listener: (...args: never[]) => void): void;
}

export interface PvpRoom<T> {
  snapshot: T | null;
  /** 최신 스냅샷. 안정된(useCallback) 핸들러가 렌더를 다시 만들지 않고 읽는다. */
  snapshotRef: RefObject<T | null>;
  message: string;
  setMessage: (text: string) => void;
  accept: (next: T) => void;
  /** 성공이면 스냅샷을 받고 `then` 을, 실패면 한국어 문구를 띄운다. */
  onAck: (then?: (data: T) => void) => AckHandler<T>;
  /** socket.timeout(...).emit 용 — 응답이 안 오면 그 사실도 말한다. */
  onTimedAck: (then?: (data: T) => void) => TimedAckHandler<T>;
  /** extra 는 게임별 착석 값(홀덤 바이인 등). */
  sit: (seatNumber: number, extra?: Record<string, unknown>) => void;
  /** 게임 전용 명령(홀덤 충전 등) — 요청 id·방 id 를 붙여 보내고 응답 스냅샷을 받는다. */
  send: (event: string, payload: Record<string, unknown>) => void;
  standUp: () => void;
  setReady: (ready: boolean) => void;
  bots: { busy: boolean; skill: BotSkill; setSkill: (skill: BotSkill) => void; add: () => void; remove: (seatNumber: number) => void };
}

/**
 * 방 하나의 스냅샷 구독과 공통 명령. 세 페이지가 한 줄씩 다르게 복사해 쓰던 것을 모았다.
 *
 * `beforeAccept` 는 새 스냅샷을 받기 "직전"에 불린다 — 고스톱은 여기서 카드 위치를 기록해 두고
 * 커밋 뒤에 그 자리에서부터 날린다(FLIP).
 */
export function usePvpRoom<T extends PvpSnapshotBase>(socket: GameSocket, game: PvpGame, roomId: string, options: { beforeAccept?: (next: T) => void } = {}): PvpRoom<T> {
  const loose = socket as unknown as LooseSocket;
  const [snapshot, setSnapshot] = useState<T | null>(null);
  const [message, setMessage] = useState("");
  const snapshotRef = useRef<T | null>(null);
  snapshotRef.current = snapshot;
  const beforeAccept = useRef(options.beforeAccept);
  beforeAccept.current = options.beforeAccept;

  const accept = useCallback((next: T) => {
    beforeAccept.current?.(next);
    setSnapshot((current) => acceptSnapshot(current, next));
  }, []);
  const fail = useCallback((ack: Ack<unknown>) => { if (!ack.ok) setMessage(pvpErrorText(ack)); }, []);
  const onAck = useCallback((then?: (data: T) => void): AckHandler<T> => (ack) => {
    if (ack.ok) { accept(ack.data); then?.(ack.data); } else fail(ack);
  }, [accept, fail]);
  const onTimedAck = useCallback((then?: (data: T) => void): TimedAckHandler<T> => (timedOut, ack) => {
    if (timedOut) { setMessage(PVP_TIMEOUT_TEXT); return; }
    onAck(then)(ack);
  }, [onAck]);

  // 리스너가 입장보다 먼저 붙어야 입장 직후 오는 스냅샷을 놓치지 않는다 — 이 이펙트가 먼저 선언된다.
  useEffect(() => {
    const onSnapshot = (next: T) => accept(next);
    const onWallet = ({ balance }: { balance: number }) => setSnapshot((current) => (current ? { ...current, walletBalance: balance } : current));
    // UNAUTHORIZED 는 SocketProvider 가 세션 갱신으로 처리한다.
    const onConnectError = (error: Error) => { if (error.message !== "UNAUTHORIZED") setMessage("게임 서버에 연결할 수 없습니다."); };
    loose.on(`${game}.snapshot`, onSnapshot as never);
    loose.on("wallet.updated", onWallet as never);
    loose.on("connect_error", onConnectError as never);
    return () => {
      loose.off(`${game}.snapshot`, onSnapshot as never);
      loose.off("wallet.updated", onWallet as never);
      loose.off("connect_error", onConnectError as never);
    };
  }, [loose, game, accept]);

  useRoomPresence(
    socket,
    () => loose.emit(`${game}.join`, { roomId }, (ack) => (ack.ok ? accept(ack.data as T) : fail(ack))),
    () => loose.emit(`${game}.leave`, { roomId }, () => undefined),
    [game, roomId],
  );

  // 거절 문구("지금은 내 차례가 아니에요")가 다음 스트리트까지 남아 있으면 안 된다.
  const phase = snapshot?.room.phase;
  useEffect(() => { if (phase === "PLAYER_TURN" || phase === "WAITING") setMessage(""); }, [phase]);

  const timed = useCallback((event: string, payload: unknown) => {
    loose.timeout(ACK_TIMEOUT_MS).emit(`${game}.${event}`, payload, onTimedAck() as TimedAckHandler<unknown>);
  }, [loose, game, onTimedAck]);
  const sit = useCallback((seatNumber: number, extra?: Record<string, unknown>) => timed("sit", { requestId: randomRequestId(), roomId, seatNumber, ...extra }), [timed, roomId]);
  const send = useCallback((event: string, payload: Record<string, unknown>) => timed(event, { requestId: randomRequestId(), roomId, ...payload }), [timed, roomId]);
  const standUp = useCallback(() => timed("standUp", { roomId }), [timed, roomId]);
  const setReady = useCallback((ready: boolean) => timed("ready", { roomId, ready }), [timed, roomId]);

  // 봇 추가/내보내기 — 서버가 응답할 때까지 잠그지 않으면 두 번 눌러 봇 둘이 한 번에 앉는다.
  // 잠금은 ref 로 한다: 상태(busy)는 다음 렌더에야 바뀌어 같은 틱의 두 번째 클릭을 못 막는다.
  const [skill, setSkill] = useBotSkill();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const botCommand = useCallback((event: string, payload: unknown) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    loose.timeout(ACK_TIMEOUT_MS).emit(`${game}.${event}`, payload, (timedOut, ack) => {
      lock.current = false;
      setBusy(false);
      (onTimedAck() as TimedAckHandler<unknown>)(timedOut, ack);
    });
  }, [loose, game, onTimedAck]);
  const addBot = useCallback(() => botCommand("addBot", { requestId: randomRequestId(), roomId, skill }), [botCommand, roomId, skill]);
  const removeBot = useCallback((seatNumber: number) => botCommand("removeBot", { requestId: randomRequestId(), roomId, seatNumber }), [botCommand, roomId]);

  return {
    snapshot, snapshotRef, message, setMessage, accept, onAck, onTimedAck, sit, send, standUp, setReady,
    bots: { busy, skill, setSkill, add: addBot, remove: removeBot },
  };
}
