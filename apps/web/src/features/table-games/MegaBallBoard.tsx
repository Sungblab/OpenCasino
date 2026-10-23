import { useRef, useState } from "react";
import { MEGA_BALL_DRAWN, MEGA_BALL_REVEALED, megaBallRange } from "@opencasino/game-core/table-games";
import type { BoardProps } from "./types";

/**
 * 메가볼 보드: 왼쪽에 추첨기 — 공이 뒤섞이고 — 오른쪽에 공 받침대. 열린 공은 추첨 순서대로 굴러 들어와 앉고,
 * 마지막 12번째 공(메가볼)은 따로 큰 자리에 금빛으로 나타난다. 공 색은 숫자 구간(1–10 금 · 11–20 파랑 · 21–30 빨강 · 31–40 초록).
 * 내가 번호 칸에 건 숫자가 나오면 공에 고리와 체크가 붙는다. 굴러 들어오는 모습은 이 화면이 열린 뒤에 열린 공만 보인다
 * (늦게 들어온 사람에겐 이미 열린 공이 가만히 놓여 있다) — 연출은 공이 앉는 순간 한 번만 돌고, 다시 그려져도 반복되지 않는다.
 */

const NORMAL_SLOTS = MEGA_BALL_DRAWN - 1;
/** 공이 열리는 묶음의 시작(3 · 6 · 9 · 11 번째 공) — 한 묶음 안에서만 차례로 굴러 들어오게 지연을 준다. */
const BATCH_STARTS = [0, ...MEGA_BALL_REVEALED.slice(0, -1)];

/** 추첨기 안에서 뒤섞이는 공들(황금각 나선으로 고르게 흩어 둔다). 순서·모양이 고정이라 렌더마다 같다. */
const DRUM_BALLS = Array.from({ length: 18 }, (_, index) => {
  const angle = index * 2.399963;
  const radius = 37 * Math.sqrt((index + 0.5) / 18);
  return {
    range: index % 4,
    x: +(50 + radius * Math.cos(angle)).toFixed(1),
    y: +(50 + radius * Math.sin(angle)).toFixed(1),
    dx: +Math.cos(angle * 3).toFixed(2),
    dy: +Math.sin(angle * 2).toFixed(2),
    seconds: +(0.9 + (index % 5) * 0.17).toFixed(2),
  };
});

type CssVars = React.CSSProperties & Record<`--${string}`, string | number>;

function Ball({ number, mine, rollIn, delayMs, mega = false }: { number: number; mine: boolean; rollIn: boolean; delayMs: number; mega?: boolean }) {
  return (
    <span
      className={`tg-mball-ball r${megaBallRange(number)} ${mine ? "is-mine" : ""} ${rollIn ? "is-roll" : ""} ${mega ? "is-mega" : ""}`}
      style={rollIn ? ({ "--delay": `${delayMs}ms` } as CssVars) : undefined}
    >
      <b>{number}</b>
    </span>
  );
}

export function MegaBallBoard({ state, result, phase, roundId, myBets }: BoardProps) {
  const balls = (state?.balls as number[] | undefined) ?? [];
  const mega = (state?.mega as number | null | undefined) ?? null;
  const normal = balls.slice(0, NORMAL_SLOTS);
  // 처음 그려질 때 이미 열려 있던 공(늦게 들어온 사람)은 가만히 놓는다. 판이 바뀌면 다시 굴러 들어온다.
  const [mounted] = useState(() => ({ roundId, count: balls.length }));
  const still = (index: number) => roundId === mounted.roundId && index < mounted.count;
  const delay = (index: number) => (index - BATCH_STARTS.filter((start) => start <= index).at(-1)!) * 340;

  // 칩이 정산으로 치워진 뒤에도(myBets 가 비어도) 이번 판에 건 번호는 다음 판까지 공에 표시한다.
  const kept = useRef<{ roundId: string | null; numbers: number[] }>({ roundId, numbers: [] });
  const placed = Object.keys(myBets).filter((choice) => /^mball:n\d+$/.test(choice) && (myBets[choice] ?? 0) > 0).map((choice) => Number(choice.slice(7)));
  if (placed.length > 0) kept.current = { roundId, numbers: placed };
  const bets = placed.length > 0 ? placed : kept.current.roundId === roundId ? kept.current.numbers : [];
  const isMine = (number: number) => bets.includes(number);
  const hits = bets.filter((number) => balls.includes(number)).length;

  const odd = balls.filter((ball) => ball % 2 === 1).length;
  const big = balls.filter((ball) => ball >= 21).length;
  const even = balls.length - odd;
  const small = balls.length - big;
  const done = balls.length === MEGA_BALL_DRAWN;
  const mode = result ? "done" : phase === "BETTING" ? "calm" : "draw";

  return (
    <div
      className={`tg-board tg-mball is-${mode}`}
      role="img"
      aria-label={balls.length === 0 ? "추첨 대기 중" : `추첨된 공 ${normal.join(", ")}${mega !== null ? `, 메가볼 ${mega}` : ""}`}
    >
      <div className="tg-mball-drum" aria-hidden="true">
        <div className="tg-mball-cage">
          <div className="tg-mball-spin">
            {DRUM_BALLS.map((ball, index) => (
              <i
                key={index}
                className={`tg-mball-dball r${ball.range}`}
                style={{ left: `${ball.x}%`, top: `${ball.y}%`, "--dx": ball.dx, "--dy": ball.dy, "--t": `${ball.seconds}s` } as CssVars}
              />
            ))}
          </div>
        </div>
        <span className="tg-mball-chute" />
        <span className="tg-mball-base" />
      </div>

      <ol className="tg-mball-tray">
        {Array.from({ length: NORMAL_SLOTS }, (_, index) => (
          <li key={index} className="tg-mball-slot">
            {normal[index] !== undefined && <Ball number={normal[index]!} mine={isMine(normal[index]!)} rollIn={!still(index)} delayMs={delay(index)} />}
          </li>
        ))}
        <li className="tg-mball-slot is-mega">
          {mega !== null && <Ball mega number={mega} mine={isMine(mega)} rollIn={!still(NORMAL_SLOTS)} delayMs={0} />}
          <em>MEGA</em>
        </li>
      </ol>

      {/* 공이 열리기 전에도 자리를 지켜 둔다(보이지 않게) — 첫 공이 열릴 때 판이 아래로 밀리지 않게. */}
      <p className={`tg-mball-stats ${balls.length === 0 ? "is-idle" : ""}`} aria-hidden={balls.length === 0}>
        <span>홀수 <b className={odd > even ? "is-lead" : ""}>{odd}</b> : <b className={even > odd ? "is-lead" : ""}>{even}</b> 짝수</span>
        <span>작은 수 <b className={small > big ? "is-lead" : ""}>{small}</b> : <b className={big > small ? "is-lead" : ""}>{big}</b> 큰 수</span>
        {bets.length > 0 && <span className={hits > 0 ? "is-mine" : ""}>✓ 내 번호 <b>{hits}</b>/{bets.length}</span>}
        {done && odd * 2 === MEGA_BALL_DRAWN && <span className="is-tie">홀짝 동수</span>}
        {done && big * 2 === MEGA_BALL_DRAWN && <span className="is-tie">대소 동수</span>}
      </p>
    </div>
  );
}
