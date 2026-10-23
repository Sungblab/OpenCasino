import type { SnapshotMeta } from "@opencasino/contracts";
import { noteServerTime } from "./serverClock";

type Sequenced = SnapshotMeta & { sequence: number };

/**
 * 새 스냅샷을 받을지. sequence 는 서버 메모리에만 있어 서버가 재시작하면 0부터 다시 센다.
 * 그때 "작으니 옛것"이라며 버리면 화면이 새로고침 전까지 멈춘다. 서버 부팅 id 가 바뀌었으면
 * sequence 와 상관없이 받는다.
 */
export function isNewerSnapshot<T extends Sequenced>(current: T | null, next: T): boolean {
  if (!current) return true;
  if (next.bootId && current.bootId && next.bootId !== current.bootId) return true;
  return next.sequence >= current.sequence;
}

/** setState 에 그대로 넘기는 형태: `setSnapshot((current) => acceptSnapshot(current, next))`. */
export function acceptSnapshot<T extends Sequenced>(current: T | null, next: T): T | null {
  if (!isNewerSnapshot(current, next)) return current;
  noteServerTime(next.serverTime);
  return next;
}
