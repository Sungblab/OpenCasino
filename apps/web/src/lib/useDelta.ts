import { useEffect, useRef, useState } from "react";

export interface Delta { delta: number; key: number }

/**
 * The transient change in a number, for the "+1,200 / -300" that floats off a stack or the
 * balance chip when it moves. Null while nothing has changed recently; `key` changes per
 * event so a keyed element re-mounts (and re-animates) even when two deltas are equal.
 */
export function useDelta(value: number, holdMs = 1600): Delta | null {
  const previous = useRef(value);
  const [delta, setDelta] = useState<Delta | null>(null);
  useEffect(() => {
    const diff = value - previous.current;
    previous.current = value;
    if (diff === 0) return;
    setDelta({ delta: diff, key: Date.now() });
    const timer = window.setTimeout(() => setDelta(null), holdMs);
    return () => window.clearTimeout(timer);
  }, [value, holdMs]);
  return delta;
}
