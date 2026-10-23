import { TABLE_TIER_LABEL, VIP_LABEL, type AdminAuditLog, type TableTier, type VipTier } from "@opencasino/contracts";

/** 감사 로그 action → 화면 이름. 여기 없는 action(옛 기록·새로 생긴 것)은 원문 그대로 보인다. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  USER_APPROVED: "사용자 승인",
  USER_SUSPENDED: "이용 정지",
  USER_DELETED: "탈퇴 처리",
  USER_ROLE_CHANGED: "권한 변경",
  PASSWORD_RESET: "비밀번호 초기화",
  BALANCE_ADJUSTED: "잔액 조정",
  ROOM_PAUSED: "방 일시정지",
  ROOM_RESUMED: "방 재개",
  ROOM_ROAD_RESET: "통계 초기화",
  ANNOUNCEMENT_SENT: "공지 발송",
  ROOM_UPDATED: "방 설정 변경",
  USER_VIP_SET: "VIP 지정",
  USER_LEVEL_SET: "레벨 지정",
  USER_ITEM_GRANTED: "아이템 지급",
  USER_ITEM_REVOKED: "아이템 회수",
  USER_CHAT_MUTED: "채팅 제한",
  USER_CHAT_UNMUTED: "채팅 제한 해제",
  LOBBY_CHAT_DELETED: "로비 채팅 삭제",
  // 하우스(2026-10 에 없앤 기능) — 지난 기록을 읽을 수 있게 이름과 요약만 남긴다.
  HOUSE_CREATED: "하우스 개설",
  HOUSE_UPDATED: "하우스 설정 변경",
  HOUSE_INVITE_RESET: "하우스 초대 코드 변경",
  HOUSE_CLOSED: "하우스 닫기",
  HOUSE_SUSPENDED: "하우스 정지",
  HOUSE_RESUMED: "하우스 재개",
  HOUSE_MEMBER_APPROVED: "하우스 가입 승인",
  HOUSE_MEMBER_REJECTED: "하우스 가입 거절",
  HOUSE_MEMBER_KICKED: "하우스 추방",
  HOUSE_MEMBER_BANNED: "하우스 차단",
  HOUSE_MEMBER_UNBANNED: "하우스 차단 해제",
  HOUSE_ROLE_CHANGED: "하우스 역할 변경",
  HOUSE_OWNER_TRANSFERRED: "하우스 주인 변경",
  HOUSE_ROOM_OPENED: "하우스 방 열기",
  HOUSE_ROOM_CLOSED: "하우스 방 닫기",
  // 사용자끼리의 1:1 메시지를 관리자가 연 기록.
  DM_VIEWED: "DM 열람",
};

const HOUSE_ROLE_LABEL: Record<string, string> = { owner: "주인", manager: "매니저", member: "멤버" };

const ROLE_LABEL: Record<string, string> = { user: "사용자", admin: "관리자" };
const coins = (value: unknown) => `${Number(value).toLocaleString("ko-KR")}코인`;
const signed = (value: unknown) => `${Number(value) > 0 ? "+" : ""}${Number(value).toLocaleString("ko-KR")}`;
const vipText = (value: unknown) => (value ? VIP_LABEL[value as VipTier] ?? String(value) : "없음");

const ROOM_FIELD_LABEL: Record<string, string> = { name: "이름", minBet: "최소", maxBet: "최대", tier: "등급", enabled: "열림" };
/** ROOM_UPDATED 의 전/후에서 바뀐 칸만. */
function roomChanges(from: unknown, to: unknown): string {
  if (!from || !to || typeof from !== "object" || typeof to !== "object") return "";
  const before = from as Record<string, unknown>;
  const after = to as Record<string, unknown>;
  const show = (key: string, value: unknown) => (key === "tier" ? TABLE_TIER_LABEL[value as TableTier] ?? String(value) : key === "enabled" ? (value ? "열림" : "닫힘") : String(value));
  return Object.keys(ROOM_FIELD_LABEL).filter((key) => before[key] !== after[key]).map((key) => `${ROOM_FIELD_LABEL[key]} ${show(key, before[key])} → ${show(key, after[key])}`).join(", ");
}
const approval = (value: unknown) => (value ? "이용 중" : "정지");

/**
 * details 를 표 한 칸에 들어갈 한 줄로. 전/후가 있으면 "잔액 120코인 → 150코인 (+30)" 처럼, 없으면 아는
 * 값만. 남길 게 없으면 빈 문자열(화면은 "—"). 옛 기록은 전/후 없이 적혔으니(예: { amount }, { approved })
 * 그 모양도 받아 준다.
 */
export function summarizeAuditLog(log: Pick<AdminAuditLog, "action" | "details">): string {
  const d = log.details;
  switch (log.action) {
    case "BALANCE_ADJUSTED":
      return "from" in d && "to" in d ? `잔액 ${coins(d.from)} → ${coins(d.to)} (${signed(d.amount)})` : `${signed(d.amount)}코인`;
    case "USER_ROLE_CHANGED":
      return `권한 ${ROLE_LABEL[String(d.from)] ?? d.from} → ${ROLE_LABEL[String(d.to)] ?? d.to}`;
    case "USER_APPROVED":
    case "USER_SUSPENDED":
      return "from" in d ? `${approval(d.from)} → ${approval(d.to)}` : "";
    case "USER_DELETED":
      return d.username ? `원래 아이디 ${d.username}` : "";
    case "ANNOUNCEMENT_SENT":
      // 어디로 갔는지(방 이름·전체)는 대상 칸이 이미 보여 준다.
      return d.scope === "room" ? `${d.recipients ?? 0}명에게 · ${d.message ?? ""}` : String(d.message ?? "");
    case "HOUSE_CREATED":
      return String(d.name ?? "");
    case "HOUSE_ROLE_CHANGED":
      return `${d.houseName ?? ""} · ${HOUSE_ROLE_LABEL[String(d.from)] ?? d.from} → ${HOUSE_ROLE_LABEL[String(d.to)] ?? d.to}`;
    case "HOUSE_ROOM_OPENED":
      return `${d.houseName ?? ""} · ${d.name ?? ""} (${coins(d.minBet)}~${coins(d.maxBet)})`;
    case "HOUSE_ROOM_CLOSED":
      return `${d.houseName ?? ""} · ${d.name ?? ""}`;
    case "ROOM_UPDATED":
      return roomChanges(d.from, d.to);
    case "USER_VIP_SET":
      return `VIP 하한 ${vipText(d.from)} → ${vipText(d.to)}`;
    case "USER_LEVEL_SET":
      return `레벨 하한 ${d.from ?? "없음"} → ${d.to ?? "없음"}`;
    case "USER_ITEM_GRANTED":
      return `${d.name ?? d.itemId} · ${d.days ? `${d.days}일` : "영구"}`;
    case "USER_ITEM_REVOKED":
      return String(d.itemId ?? "");
    case "USER_CHAT_MUTED":
      return `${d.minutes}분${d.reason ? ` · ${d.reason}` : ""}`;
    case "USER_CHAT_UNMUTED":
      return "";
    case "LOBBY_CHAT_DELETED":
      return String(d.message ?? "");
    case "DM_VIEWED":
      return Array.isArray(d.nicknames) ? `${d.nicknames.join(" ↔ ")} 대화` : "";
    case "HOUSE_UPDATED":
    case "HOUSE_INVITE_RESET":
    case "HOUSE_CLOSED":
    case "HOUSE_SUSPENDED":
    case "HOUSE_RESUMED":
    case "HOUSE_MEMBER_APPROVED":
    case "HOUSE_MEMBER_REJECTED":
    case "HOUSE_MEMBER_KICKED":
    case "HOUSE_MEMBER_BANNED":
    case "HOUSE_MEMBER_UNBANNED":
    case "HOUSE_OWNER_TRANSFERRED":
      return String(d.houseName ?? "");
    default:
      return Object.entries(d).map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(", ");
  }
}
