import { useEffect, useRef, useState } from "react";

/** 말풍선이 떠 있는 시간 — 이모트(useEmotes)와 같다. */
const BUBBLE_MS = 3_000;

/**
 * 좌석마다 "방금 한 행동" 말풍선을 잠깐만 띄운다.
 *
 * 예전 말풍선은 seat.lastAction 이 남아 있는 동안 계속 떠 있었다. 서버는 다음 스트리트 카드를
 * 다 깐 뒤에야 lastAction 을 비우므로, 플랍이 깔리는 동안 프리플랍의 "콜"이 그대로 떠 있었고
 * 새 스트리트의 첫 행동과 섞여 누가 지금 뭘 했는지 읽을 수 없었다.
 *
 * 이제 규칙은 둘이다: (1) 좌석의 key 가 새 값으로 바뀌면 그 좌석 말풍선을 3초 띄운다.
 * (2) resetKey(스트리트·판)가 바뀌면 떠 있던 말풍선을 전부 내리고, 그 순간 남아 있던 key 는
 * "이미 본 것"으로 친다 — 서버가 늦게 비우는 지난 스트리트의 행동이 다시 뜨지 않는다.
 *
 * `signature` 는 좌석별 key 를 한 줄로 이은 것이다(`"1=call:20|4=null"`). 배열을 그대로 받으면
 * 렌더마다 새 배열이라 이펙트가 매번 돈다.
 */
export function useSeatBubbles(signature: string, resetKey: string): ReadonlySet<number> {
  const [visible, setVisible] = useState<ReadonlySet<number>>(() => new Set());
  const seen = useRef(new Map<number, string>());
  const timers = useRef(new Map<number, number>());
  const lastReset = useRef<string | null>(null);

  useEffect(() => {
    const current = parseSignature(signature);
    if (lastReset.current !== resetKey) {
      const firstRun = lastReset.current === null;
      lastReset.current = resetKey;
      if (!firstRun) {
        for (const id of timers.current.values()) window.clearTimeout(id);
        timers.current.clear();
        seen.current = current;
        setVisible(new Set());
        return;
      }
    }
    const show: number[] = [];
    const hide: number[] = [];
    for (const [seat, key] of current) {
      if (key === "") { if (seen.current.get(seat)) hide.push(seat); }
      else if (seen.current.get(seat) !== key) show.push(seat);
    }
    for (const seat of seen.current.keys()) if (!current.has(seat)) hide.push(seat);
    seen.current = current;
    if (show.length === 0 && hide.length === 0) return;
    for (const seat of [...show, ...hide]) {
      const existing = timers.current.get(seat);
      if (existing !== undefined) window.clearTimeout(existing);
      timers.current.delete(seat);
    }
    for (const seat of show) {
      timers.current.set(seat, window.setTimeout(() => {
        timers.current.delete(seat);
        setVisible((prev) => { if (!prev.has(seat)) return prev; const next = new Set(prev); next.delete(seat); return next; });
      }, BUBBLE_MS));
    }
    setVisible((prev) => {
      const next = new Set(prev);
      for (const seat of hide) next.delete(seat);
      for (const seat of show) next.add(seat);
      return next;
    });
  }, [signature, resetKey]);

  useEffect(() => () => { for (const id of timers.current.values()) window.clearTimeout(id); }, []);
  return visible;
}

/** 좌석별 key 를 한 줄로. null 은 빈 칸으로 적는다. */
export function bubbleSignature(entries: Iterable<[seatNumber: number, key: string | null]>): string {
  const parts: string[] = [];
  for (const [seat, key] of entries) parts.push(`${seat}=${key ?? ""}`);
  return parts.join("|");
}

function parseSignature(signature: string): Map<number, string> {
  const map = new Map<number, string>();
  if (!signature) return map;
  for (const part of signature.split("|")) {
    const at = part.indexOf("=");
    map.set(Number(part.slice(0, at)), part.slice(at + 1));
  }
  return map;
}
