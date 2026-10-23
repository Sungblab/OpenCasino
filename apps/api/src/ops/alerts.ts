import { config } from "../config.js";
import { logger } from "../logging/logger.js";

/**
 * 운영 알림 — ALERT_WEBHOOK_URL(디스코드 웹훅)이 있으면 {content} 로 보낸다. 없으면 아무것도 안 한다.
 * 같은 글은 10분에 한 번만(예외가 루프를 돌면 채널이 도배된다). 절대 던지지 않는다 — 알림이 실패해서
 * 장애 처리 경로가 같이 넘어지면 안 된다.
 */
const REPEAT_MS = 10 * 60_000;
const lastSent = new Map<string, number>();

export async function sendAlert(text: string, nowMs = Date.now()): Promise<void> {
  try {
    const url = config.alertWebhookUrl;
    if (!url) return;
    const last = lastSent.get(text);
    if (last !== undefined && nowMs - last < REPEAT_MS) return;
    if (lastSent.size > 1_000) lastSent.clear();
    lastSent.set(text, nowMs);
    // 디스코드 content 는 2,000자까지.
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text.slice(0, 1_900) }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) logger.warn("alert webhook refused", { status: response.status });
  } catch (error) {
    logger.warn("alert webhook failed", { err: error });
  }
}

/** 예외를 알림 한 줄로. 스택은 로그에 있으니 메시지만. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
