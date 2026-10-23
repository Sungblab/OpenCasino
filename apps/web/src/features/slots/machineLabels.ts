import type { SlotMachineId } from "@opencasino/contracts";

/**
 * 방 목록 타일에 쓰는 기계 한 줄 소개. 릴·그림 코드를 로비 묶음에 끌어오지 않으려고 따로 둔다.
 * 슬롯 방 code 가 곧 기계 이름이다(game-core slot-machines.ts).
 */
export const SLOT_MACHINE_LABELS: Record<SlotMachineId, string> = {
  "golden-seven": "5릴 · 20라인 · 프리스핀",
  "lucky-cherry": "클래식 3릴 · 5라인",
  "golden-dragon": "243웨이 · 배수 WILD",
};

export function slotMachineIdForCode(code: string): SlotMachineId {
  return code in SLOT_MACHINE_LABELS ? (code as SlotMachineId) : "golden-seven";
}
