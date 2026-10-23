import { randomUUID } from "node:crypto";
import type { SnapshotMeta } from "@opencasino/contracts";

/** 이 프로세스가 뜰 때마다 새로 만든다. 화면은 이 값이 바뀌면 sequence 를 처음부터 다시 믿는다. */
export const BOOT_ID = randomUUID();

/** 모든 게임 스냅샷에 붙는 공통 정보 — contracts 의 snapshotMetaShape 참고. */
export function snapshotMeta(phaseDurationMs: number | null = null): Required<SnapshotMeta> {
  return { bootId: BOOT_ID, serverTime: Date.now(), phaseDurationMs };
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

/** 절대 시각까지 기다린다. 스냅샷을 보내는 데 걸린 시간만큼 시간표가 밀리지 않게 한다. */
export function delayUntil(epochMs: number): Promise<void> {
  return delay(epochMs - Date.now());
}
