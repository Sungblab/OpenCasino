import { useEffect, useState } from "react";
import type { Features } from "@opencasino/contracts";
import { getFeatures } from "../api";

/**
 * 이 서버의 운영 방식(플레이머니·하우스·가입 승인). 서버 설정이라 세션 동안 바뀌지 않으므로 한 번만 묻고
 * 모든 화면이 같은 답을 나눠 쓴다. 실패하면 다음에 부르는 화면이 다시 묻는다.
 */
let cached: Features | null = null;
let inFlight: Promise<Features> | null = null;

export function loadFeatures(): Promise<Features> {
  if (cached) return Promise.resolve(cached);
  inFlight ??= getFeatures()
    .then((features) => {
      cached = features;
      return features;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** 아직 모르면 null — 그동안은 충전·하우스처럼 모드에 따라 갈리는 칸을 그리지 않는다. */
export function useFeatures(): Features | null {
  const [features, setFeatures] = useState<Features | null>(cached);
  useEffect(() => {
    if (features) return;
    let cancelled = false;
    loadFeatures().then((next) => { if (!cancelled) setFeatures(next); }, () => undefined);
    return () => { cancelled = true; };
  }, [features]);
  return features;
}

/** 테스트용. */
export function resetFeaturesForTest(next: Features | null = null): void {
  cached = next;
  inFlight = null;
}
