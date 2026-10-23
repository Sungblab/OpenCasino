import { DomainError } from "../errors/domain-error.js";

/**
 * 욕설 가림과 자동 뮤트 — 운영자가 없어도 채팅이 돌아가게. 가린 글자는 `*` 로 바꿔 보내고(채팅은 그대로 간다),
 * 10분 안에 세 번 걸리면 10분 동안 채팅(방·1:1)을 막는다. 상태는 메모리라 재시작하면 풀린다 — 벌이 아니라 진정용이다.
 *
 * 글자 사이에 공백·기호를 끼운 우회("시 발", "시.발")도 잡는다. 단어는 오탐이 적은 것만 둔다(예: "새끼"·"씹"은 일반
 * 단어에도 쓰여 뺐다). 모자란 단어는 여기 한 줄만 더하면 된다.
 */
const WORDS = [
  "시발", "씨발", "씨팔", "시팔", "ㅅㅂ", "ㅆㅂ", "병신", "ㅂㅅ", "개새끼", "개새", "좆", "존나", "졸라게", "지랄", "ㅈㄹ",
  "닥쳐", "엿먹", "느금", "니미", "애미", "애비", "창녀", "걸레", "fuck", "shit", "bitch",
];

const SEPARATOR = "[\\s.,\\-_*~·]*";
const PATTERN = new RegExp(
  WORDS.map((word) => [...word].map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(SEPARATOR)).join("|"),
  "giu",
);

export function maskProfanity(text: string): { text: string; hit: boolean } {
  let hit = false;
  const masked = text.replace(PATTERN, (match) => {
    hit = true;
    return "*".repeat([...match].filter((char) => !/[\s.,\-_*~·]/u.test(char)).length || 1);
  });
  return { text: masked, hit };
}

const STRIKE_LIMIT = 3;
const STRIKE_WINDOW_MS = 10 * 60_000;
const MUTE_MS = 10 * 60_000;

interface Record { strikes: number; windowEnds: number; mutedUntil: number }
const records = new Map<string, Record>();

/**
 * 보내기 전에 부른다: 뮤트 중이면 던지고, 아니면 욕설을 가린 글을 돌려준다(걸리면 횟수를 센다).
 * 막힌 사람에게는 "얼마 뒤에 풀린다"를 알려 줄 수 있게 남은 초를 상세에 담는다.
 */
export function screenMessage(userId: string, message: string, now = Date.now()): string {
  const current = records.get(userId);
  if (current && current.mutedUntil > now) {
    throw new DomainError("CHAT_MUTED", { retryAfterSeconds: Math.ceil((current.mutedUntil - now) / 1_000) });
  }
  const { text, hit } = maskProfanity(message);
  if (hit) {
    const record: Record = current && current.windowEnds > now ? current : { strikes: 0, windowEnds: now + STRIKE_WINDOW_MS, mutedUntil: 0 };
    record.strikes += 1;
    if (record.strikes >= STRIKE_LIMIT) {
      record.mutedUntil = now + MUTE_MS;
      record.strikes = 0;
    }
    if (records.size > 10_000) records.clear();
    records.set(userId, record);
  }
  return text;
}

/** 시험·관리자 해제용. */
export function clearChatMute(userId: string): void {
  records.delete(userId);
}
