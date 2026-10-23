import { useEffect, useState } from "react";

/** CSS 미디어 쿼리가 지금 맞는지. 화면을 돌리거나 창 크기가 바뀌면 다시 그린다. */
export function useMediaQuery(media: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(media).matches);
  useEffect(() => {
    const query = window.matchMedia(media);
    const sync = () => setMatches(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [media]);
  return matches;
}
