import { useLayoutEffect, useRef, useState } from "react";
import { BACBO_BIG_FROM, BACBO_SMALL_TO, bacBoTotals, type BacBoOutcome, type BacBoSide } from "@opencasino/game-core/table-games";
import type { BoardProps } from "./types";

/**
 * 박 보 보드: 왼쪽 파랑 플레이어, 오른쪽 빨강 뱅커, 가운데 VS. 쪽마다 주사위 두 개와 그 합(두 주사위가 다 열려야 보이는 알약).
 * 공개 순서(플레이어1 → 뱅커1 → 플레이어2 → 뱅커2)는 서버가 단계마다 state 로 보내므로 보드는 받은 만큼만 그린다 —
 * 열린 순간 그 주사위가 굴러서(CSS 텀블 + 눈이 빠르게 바뀌다 멈춤) 자리를 잡는다. 소리는 방 화면이 단계마다 한 번 낸다.
 * 결과가 열리면 이긴 쪽이 금빛으로 빛나고 진 쪽은 어두워지며, 타이면 가운데가 금색 TIE 로 바뀐다.
 */

const SIDE_LABEL: Record<BacBoSide, string> = { player: "PLAYER", banker: "BANKER" };
/** 면마다 켜지는 눈 자리(3×3 칸 번호, 0 이 왼쪽 위). */
const PIPS: Record<number, readonly number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const ROLL_MS = 700;
const FLICKER_MS = 80;

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const randomFace = () => 1 + Math.floor(Math.random() * 6);

type Dice = ReadonlyArray<number | null>;
const diceOf = (value: unknown): Dice => (Array.isArray(value) ? [value[0] ?? null, value[1] ?? null] : [null, null]);
const totalOf = (value: unknown): number | null => (typeof value === "number" ? value : null);

/** 주사위 한 개. 처음 보일 때(null → 숫자)만 구르고, 이미 열려 있던 판에 늦게 들어온 사람에게는 구르지 않는다. */
function Die({ side, value }: { side: BacBoSide; value: number | null }) {
  const [face, setFace] = useState<number | null>(value);
  const [rolling, setRolling] = useState(false);
  const previous = useRef(value);

  // 칠하기 전에 구르기 시작해야 열린 첫 프레임에 최종 눈이 번쩍 보이지 않는다.
  useLayoutEffect(() => {
    const was = previous.current;
    previous.current = value;
    if (value === null || was !== null || prefersReducedMotion()) {
      setFace(value);
      setRolling(false);
      return undefined;
    }
    setRolling(true);
    setFace(randomFace());
    const flicker = window.setInterval(() => setFace(randomFace()), FLICKER_MS);
    const settle = window.setTimeout(() => { window.clearInterval(flicker); setFace(value); setRolling(false); }, ROLL_MS);
    return () => { window.clearInterval(flicker); window.clearTimeout(settle); };
  }, [value]);

  const shown = value === null ? null : rolling ? face : value;
  return (
    <span className={`tg-bacbo-die is-${side} ${shown === null ? "is-hidden" : ""} ${rolling ? "is-roll" : ""}`} aria-hidden="true">
      {shown === null
        ? <b>?</b>
        : Array.from({ length: 9 }, (_, cell) => <i key={cell} className={PIPS[shown]?.includes(cell) ? "pip" : undefined} />)}
    </span>
  );
}

function Side({ side, dice, total, win, lose, tie }: { side: BacBoSide; dice: Dice; total: number | null; win: boolean; lose: boolean; tie: boolean }) {
  return (
    <section className={`tg-bacbo-side is-${side} ${win ? "is-win" : ""} ${lose ? "is-lose" : ""} ${tie ? "is-tie" : ""}`}>
      <h3 className="tg-bacbo-name">{SIDE_LABEL[side]}</h3>
      <div className="tg-bacbo-dice">
        <Die side={side} value={dice[0] ?? null} />
        <Die side={side} value={dice[1] ?? null} />
      </div>
      <div className={`tg-bacbo-total ${total === null ? "" : "is-set"}`}>{total ?? "?"}</div>
    </section>
  );
}

export function BacBoBoard({ state, result, winners }: BoardProps) {
  const player = diceOf(state?.player);
  const banker = diceOf(state?.banker);
  const playerTotal = totalOf(state?.playerTotal);
  const bankerTotal = totalOf(state?.bankerTotal);
  const decided = result !== null;
  const tie = decided && winners.has("bacbo:tie");
  const playerWins = decided && winners.has("bacbo:player");
  const bankerWins = decided && winners.has("bacbo:banker");
  // 네 주사위 합은 결과가 열린 뒤에만(스몰·빅 칸이 걸린 사람에게 왜 이겼는지 보이도록).
  const all = result ? bacBoTotals(result.outcome as BacBoOutcome).all : null;
  const opened = [...player, ...banker].filter((value) => value !== null).length;
  const label = opened === 0
    ? "박 보: 주사위가 아직 열리지 않았습니다"
    : `박 보: 플레이어 ${player.filter((v) => v !== null).join("·") || "-"}${playerTotal !== null ? ` 합 ${playerTotal}` : ""}, 뱅커 ${banker.filter((v) => v !== null).join("·") || "-"}${bankerTotal !== null ? ` 합 ${bankerTotal}` : ""}${decided ? (tie ? ", 타이" : playerWins ? ", 플레이어 승" : ", 뱅커 승") : ""}`;
  return (
    <div className={`tg-board tg-bacbo ${decided ? "has-result" : ""}`} role="img" aria-label={label}>
      <div className="tg-bacbo-row">
        <Side side="player" dice={player} total={playerTotal} win={playerWins} lose={decided && !tie && !playerWins} tie={tie} />
        <div className={`tg-bacbo-vs ${tie ? "is-tie" : ""}`} aria-hidden="true">{tie ? "TIE" : "VS"}</div>
        <Side side="banker" dice={banker} total={bankerTotal} win={bankerWins} lose={decided && !tie && !bankerWins} tie={tie} />
      </div>
      {all !== null && (
        <p className="tg-bacbo-sum" aria-hidden="true">
          네 주사위 합 <b>{all}</b>
          {all >= BACBO_BIG_FROM ? <em className="is-big">BIG</em> : all <= BACBO_SMALL_TO ? <em className="is-small">SMALL</em> : <em className="is-none">14 · SMALL·BIG 모두 패</em>}
        </p>
      )}
    </div>
  );
}
