/**
 * 스케줄러의 기간 키(한국 시간). 한국은 서머타임이 없어 늘 UTC+9 라 고정 오프셋으로 센다.
 * 모든 함수는 실제 시각(Date)을 받고, 경계도 실제 시각(Date)으로 돌려준다.
 */

const KST_OFFSET_MS = 9 * 60 * 60_000;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const WEEK_MS = 7 * DAY_MS;

/** 한국 벽시계 값을 UTC 칸에 담은 Date — getUTC* 로 읽는다. */
const kst = (now: Date) => new Date(now.getTime() + KST_OFFSET_MS);
/** 한국 날짜 (y, m, d) 자정의 실제 시각. m 이 범위를 넘어도 된다(Date.UTC 가 해를 넘긴다). */
const kstMidnight = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day) - KST_OFFSET_MS);

/** 한국 날짜 YYYY-MM-DD. */
export function kstDateKey(now: Date): string {
  return kst(now).toISOString().slice(0, 10);
}

/** 그 시각이 속한 한국 날짜의 00:00. */
export function kstDayStart(now: Date): Date {
  const local = kst(now);
  return kstMidnight(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
}

/** 그 시각이 속한 한국 주(월요일 시작)의 월요일 00:00. */
export function kstWeekStart(now: Date): Date {
  const local = kst(now);
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  return kstMidnight(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - sinceMonday);
}

/** ISO 주 키 "YYYY-Www"(한국 시간). 주의 해는 그 주 목요일이 속한 해다(1월 초·12월 말은 해가 갈린다). */
export function isoWeekKey(now: Date): string {
  const local = kst(now);
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  const thursday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 3 - sinceMonday));
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / WEEK_MS) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * 지금 입찰을 받는 경매 주: 그 주 일요일 21:00 KST 에 마감하고, 마감이 지났으면 다음 주.
 * 키가 바뀌는 순간(일 21:00)이 곧 지난 경매를 정산하고 다음 경매를 여는 때다.
 */
export function auctionWeek(now: Date): { key: string; monday: Date; endsAt: Date } {
  let monday = kstWeekStart(now);
  if (now.getTime() >= monday.getTime() + 6 * DAY_MS + 21 * 60 * MINUTE_MS) monday = new Date(monday.getTime() + WEEK_MS);
  return { key: isoWeekKey(monday), monday, endsAt: new Date(monday.getTime() + 6 * DAY_MS + 21 * 60 * MINUTE_MS) };
}

/** 주간 칭호: 월요일 00:05 KST 부터 지난주(키·범위). 월요일 00:00~00:05 사이는 아직 아니다(null). */
export function lastWeek(now: Date): { key: string; start: Date; end: Date } | null {
  const end = kstWeekStart(now);
  if (now.getTime() < end.getTime() + 5 * MINUTE_MS) return null;
  const start = new Date(end.getTime() - WEEK_MS);
  return { key: isoWeekKey(start), start, end };
}

/** 시즌 칭호: 매월 1일 00:10 KST 부터 지난달(키 YYYY-MM·범위). 1일 00:00~00:10 사이는 null. */
export function lastMonth(now: Date): { key: string; start: Date; end: Date } | null {
  const local = kst(now);
  const end = kstMidnight(local.getUTCFullYear(), local.getUTCMonth(), 1);
  if (now.getTime() < end.getTime() + 10 * MINUTE_MS) return null;
  const start = kstMidnight(local.getUTCFullYear(), local.getUTCMonth() - 1, 1);
  return { key: kstDateKey(start).slice(0, 7), start, end };
}

/** 하루 정리: 한국 시간 05:00 부터 그날 키. 00:00~05:00 은 null(어제 것은 이미 돌았다). */
export function dailyAt5(now: Date): string | null {
  return kst(now).getUTCHours() >= 5 ? kstDateKey(now) : null;
}

/** everyMinutes 분 간격의 칸 키(UTC ISO 의 분까지). */
export function slotKey(now: Date, everyMinutes: number): string {
  const span = everyMinutes * MINUTE_MS;
  return new Date(Math.floor(now.getTime() / span) * span).toISOString().slice(0, 16);
}
