import { useEffect, useRef } from "react";
import type { RoundResultNoticeData } from "../../components/RoundResultNotice";
import { playSound, type SoundName } from "../../lib/sound";
import { useTimedValue } from "../../lib/tableHooks";
import { celebrateWin } from "../../components/WinEffect";

export interface ResultCue {
  notice: RoundResultNoticeData;
  /** 승패 소리(없으면 조용히 — 다이한 판 등). */
  sound?: SoundName | null;
  /** 한 박자 뒤에 얹는 외침(이긴 족보, 박). 승패 소리와 겹쳐 틀면 둘 다 안 들린다. */
  callout?: SoundName | null;
}

const NOTICE_MS = 4_200;
const CALLOUT_DELAY_MS = 1_100;

/**
 * 판이 끝났을 때 독에 뜨는 "내 결과" 배너와 그 소리.
 *
 * `resultKey` 는 결과가 화면에 있는 동안만 값이 있고(그 밖엔 null), 결과 한 번마다 다른 값이어야
 * 한다. 값이 null 이 아닌 새 값으로 바뀌는 순간에만 한 번 울린다.
 *
 * 예전 키는 게임마다 달랐다: 홀덤은 roundId(같은 핸드의 결과가 다시 오면 안 울리지만, 결과 전
 * 단계의 스냅샷에서도 roundId 는 같다), 섯다·고스톱은 sequence(결과 단계 안에서 누가 준비만 눌러도
 * sequence 가 올라 배너와 소리가 다시 났다). 이제 세 게임 모두 "결과 단계에 들어선 순간"을 키로
 * 쓴다 — 페이지는 결과 단계면 roundId 를, 아니면 null 을 넘긴다. 구사 재경기처럼 같은 roundId 로
 * 결과가 두 번 와도 그 사이에 결과가 아닌 단계(null)를 지나므로 두 번 다 울린다.
 */
export function useResultNotice(resultKey: string | null, build: () => ResultCue | null): RoundResultNoticeData | null {
  const [notice, show] = useTimedValue<RoundResultNoticeData>();
  const previous = useRef<string | null>(null);
  const callout = useRef<number | null>(null);
  const buildRef = useRef(build);
  buildRef.current = build;

  useEffect(() => {
    const before = previous.current;
    previous.current = resultKey;
    if (resultKey === null || resultKey === before) return;
    const cue = buildRef.current();
    if (!cue) return;
    show(cue.notice, NOTICE_MS);
    if (cue.sound) playSound(cue.sound);
    celebrateWin(cue.notice.net);
    if (callout.current !== null) window.clearTimeout(callout.current);
    const hand = cue.callout;
    callout.current = hand ? window.setTimeout(() => { callout.current = null; playSound(hand); }, CALLOUT_DELAY_MS) : null;
  }, [resultKey, show]);

  useEffect(() => () => { if (callout.current !== null) window.clearTimeout(callout.current); }, []);
  return notice;
}
