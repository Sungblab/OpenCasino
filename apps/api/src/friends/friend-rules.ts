import type { FriendRelation } from "@opencasino/contracts";

/**
 * 친구 관계 규칙. DB 를 모르는 순수 함수라 표로 시험한다(friend-rules.test.ts). friendships 한 줄(없으면 null)과
 * "나"를 받아서, 나에게 보이는 관계와 각 동작이 무엇이 되는지 정한다.
 */
export interface FriendshipRow {
  status: "pending" | "accepted" | "blocked";
  requestedBy: string;
  blockedBy: string | null;
}

/** 두 사람을 PK 순서로. uuid 는 소문자 16진 문자열이라 문자열 비교가 Postgres 의 uuid 비교와 같은 순서다. */
export function friendPair(a: string, b: string): [low: string, high: string] {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? [x, y] : [y, x];
}

/**
 * 나에게 보이는 관계. 상대가 나를 차단했으면 none — 차단당한 사실을 드러내지 않는다(요청하면
 * "요청할 수 없는 상대"로만 답한다).
 */
export function relationFor(me: string, row: FriendshipRow | null): FriendRelation {
  if (!row) return "none";
  if (row.status === "accepted") return "friend";
  if (row.status === "pending") return row.requestedBy === me ? "outgoing" : "incoming";
  return row.blockedBy === me ? "blocked" : "none";
}

/**
 * 친구 요청을 보냈을 때 일어나는 일.
 * - create: 새 요청(pending).
 * - accept: 상대가 이미 나에게 요청해 둔 상태 — 서로 원하니 바로 친구.
 * - noop: 이미 보냈거나 이미 친구. 같은 결과를 그대로 돌려준다(두 번 눌러도 오류가 아니게).
 * - blockedByMe: 내가 차단한 사람. 차단을 먼저 풀어야 한다.
 * - unavailable: 상대가 나를 차단했다. 그 사실은 말하지 않는다.
 */
export type RequestOutcome = "create" | "accept" | "noop" | "blockedByMe" | "unavailable";

export function requestOutcome(me: string, row: FriendshipRow | null): RequestOutcome {
  if (!row) return "create";
  if (row.status === "accepted") return "noop";
  if (row.status === "pending") return row.requestedBy === me ? "noop" : "accept";
  return row.blockedBy === me ? "blockedByMe" : "unavailable";
}

/** 요청·친구·차단 줄에 대한 동작. 각자 "지금 그 상태일 때만" 된다. */
export type FriendAction = "accept" | "reject" | "cancel" | "remove" | "unblock";

export function canApply(me: string, row: FriendshipRow | null, action: FriendAction): boolean {
  switch (relationFor(me, row)) {
    case "incoming": return action === "accept" || action === "reject";
    case "outgoing": return action === "cancel";
    case "friend": return action === "remove";
    case "blocked": return action === "unblock";
    default: return false;
  }
}

/**
 * 차단. 어떤 상태에서든(관계가 없어도) 걸 수 있다. 상대가 이미 나를 차단해 둔 줄은 건드리지 않는다 —
 * 한 줄에 차단한 사람을 하나만 적으므로, 덮어쓰면 상대의 차단이 풀린다. 그 사실을 드러내지 않으려고 성공처럼 답한다.
 * ponytail: 양쪽이 서로 차단한 상태는 표현하지 못한다(먼저 차단한 쪽이 풀면 나중 쪽의 차단도 사라진다). 필요해지면 blocked_by 를 두 칸으로.
 */
export function blockOutcome(me: string, row: FriendshipRow | null): "block" | "silent" {
  return row?.status === "blocked" && row.blockedBy !== me ? "silent" : "block";
}

/** 메시지는 친구 사이에만. 친구를 끊거나 차단하면 줄이 바뀌므로 그 즉시 막힌다. */
export function canMessage(row: FriendshipRow | null): boolean {
  return row?.status === "accepted";
}
