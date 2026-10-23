import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A staged bet still waiting for its server acknowledgement. `base` is what the server
 * had confirmed for that zone when the bet was tapped, so the optimistic total can be
 * rebuilt as `base + everything staged since` without ever double counting a bet the
 * server has meanwhile broadcast back to us.
 */
type Ticket<Choice extends string> = { id: number; choice: Choice; base: number; amount: number };

/**
 * A staged bet is dropped after this long even without an acknowledgement. A dropped
 * socket never runs its ack callback, and a chip that sits on the felt representing a
 * bet that was never accepted is worse than a chip that briefly appears and leaves.
 */
const STALE_MS = 8_000;

/**
 * Puts a chip on the felt the instant a zone is tapped instead of after the server round
 * trip. Placing a bet is a socket emit whose acknowledgement carries a fresh snapshot, and
 * the chip stack used to render only from that snapshot - so the felt stayed empty for the
 * whole round trip (~100ms on localhost, several times that on a phone), which reads as a
 * tap that did not register.
 *
 * The displayed amount is `max(confirmed, base + staged)`, which is correct whichever way
 * the race falls: if a broadcast triggered by somebody else's bet arrives first and already
 * includes ours, `confirmed` has caught up and wins; if our own ack lands first, both terms
 * agree. Staged bets are cleared when the round changes.
 */
export function useOptimisticBets<Choice extends string>(roundId: string | null) {
  const [tickets, setTickets] = useState<Array<Ticket<Choice>>>([]);
  const nextId = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(() => { setTickets([]); }, [roundId]);
  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);

  const settle = useCallback((id: number) => {
    setTickets((current) => (current.some((ticket) => ticket.id === id) ? current.filter((ticket) => ticket.id !== id) : current));
  }, []);

  /** Show `amount` on `choice` right away. Returns the id to hand back to `settle`. */
  const stage = useCallback((choice: Choice, base: number, amount: number): number => {
    const id = nextId.current++;
    setTickets((current) => [...current, { id, choice, base, amount }]);
    timers.current.push(window.setTimeout(() => settle(id), STALE_MS));
    return id;
  }, [settle]);

  /** Drop every staged bet on a zone - used when that zone's bet is cancelled outright. */
  const clear = useCallback((choice?: Choice) => {
    setTickets((current) => (choice ? current.filter((ticket) => ticket.choice !== choice) : []));
  }, []);

  const amountFor = useCallback((choice: Choice, confirmed: number): number => {
    let base: number | null = null;
    let staged = 0;
    for (const ticket of tickets) {
      if (ticket.choice !== choice) continue;
      if (base === null) base = ticket.base;
      staged += ticket.amount;
    }
    return base === null ? confirmed : Math.max(confirmed, base + staged);
  }, [tickets]);

  /** 서버 답을 기다리는 칸들. 칸 목록이 정해져 있지 않은 게임(룰렛)이 더미를 그릴 칸을 찾을 때 쓴다. */
  const stagedChoices = [...new Set(tickets.map((ticket) => ticket.choice))];

  return { stage, settle, clear, amountFor, stagedChoices };
}
