import { useMemo } from "react";
import type { HwatuCard as Hwatu } from "@opencasino/contracts";
import { evaluateSutdaHand, type SutdaHand } from "@opencasino/game-core/sutda";
import { HwatuCard } from "../../components/HwatuCard";
import { HandStrengthMeter } from "../../components/PvpBits";
import { CardSqueeze } from "../../components/TableBits";
import { hwatuLabel, readSutdaHand } from "../../lib/sutdaHandRead";
import { PhaseSeconds } from "../pvp/phaseClock";

/**
 * 독 자리에 올라오는 "고르는 창" — 3장 섯다의 공개 패·최종 두 장, 직접 쪼기. 그리고 판 가운데의 기리.
 *
 * 판 위의 내 패는 폰에서 폭 40px 남짓에 서로 겹쳐 있어 누르기 힘들었고, 선택 단계는 베팅 차례가 아니라
 * "내 차례"로 안 보여서 놓칠 뻔했다. 국내 섯다 앱처럼 내 패를 크게 펼쳐 한 번 누르면 끝나게 한다.
 */

/** 3장 섯다: 받은 두 장 중 상대에게 보여줄 한 장. 누르면 바로 보낸다(창이 닫히기 전엔 바꿀 수 있다). */
export function ChoiceSheet({ cards, chosenId, recommendId, recommendLine, handLabel, onChoose }: {
  cards: Hwatu[];
  chosenId: string | null;
  recommendId: string | null;
  recommendLine: string | null;
  handLabel: string | null;
  onChoose: (cardId: string) => void;
}) {
  return (
    <section className={`sv6-sheet ${chosenId ? "is-done" : "is-urgent"}`} aria-label="공개할 패 선택">
      <header>
        <strong>{chosenId ? "공개할 패를 골랐어요" : "상대에게 보여줄 패를 고르세요"}</strong>
        <small>{chosenId ? "다른 사람을 기다리는 중 · 눌러서 바꿀 수 있어요" : <><PhaseSeconds />초 · 안 고르면 첫 장 공개</>}</small>
      </header>
      <div className="sv6-sheet-row">
        {cards.map((card) => {
          const on = chosenId === card.id;
          const recommended = !chosenId && recommendId === card.id;
          return (
            <button key={card.id} type="button" className={`sv6-sheet-card ${on ? "is-on" : ""} ${chosenId && !on ? "is-off" : ""}`} onClick={() => onChoose(card.id)} aria-pressed={on} aria-label={`${hwatuLabel(card)} 공개${recommended ? " (추천)" : ""}`}>
              {recommended && <span className="sv6-sheet-flag">추천</span>}
              <HwatuCard card={card} />
              <b>{on ? "공개" : chosenId ? "숨김" : hwatuLabel(card)}</b>
            </button>
          );
        })}
      </div>
      {(handLabel || recommendLine) && <p className="sv6-sheet-note">{[handLabel && `내 두 장 ${handLabel}`, !chosenId && recommendLine].filter(Boolean).join(" · ")}</p>}
    </section>
  );
}

/** "6끗으로" / "알리로" — 받침 없거나 ㄹ 받침이면 "로". */
export function withRo(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${word}로`;
  const final = code % 28;
  return `${word}${final === 0 || final === 8 ? "로" : "으로"}`;
}

const SPECIAL_SHORT: Record<SutdaHand["special"], string | null> = { none: null, ddang_catcher: "땡 잡음", ambassador: "광땡 잡음", mungu: "재경기", gusa: "재경기" };

/**
 * 3장 섯다 최종 선택: 세 장으로 만들 수 있는 두 장 조합은 딱 셋이다. 카드를 두 번 짚게 하는 대신 조합
 * 셋을 족보와 함께 늘어놓고 하나를 누르게 한다 — 무엇으로 승부하는지가 누르기 전에 보이고, 땡잡이처럼
 * 끗은 낮아도 상대를 잡는 조합도 일부러 고를 수 있다.
 */
export function SelectSheet({ cards, pickedIds, onPick }: { cards: Hwatu[]; pickedIds: string[]; onPick: (ids: [string, string]) => void }) {
  const options = useMemo(() => {
    const list: Array<{ ids: [string, string]; pair: [Hwatu, Hwatu]; hand: SutdaHand; read: ReturnType<typeof readSutdaHand> }> = [];
    for (let i = 0; i < cards.length; i += 1) for (let j = i + 1; j < cards.length; j += 1) {
      const pair: [Hwatu, Hwatu] = [cards[i]!, cards[j]!];
      list.push({ ids: [pair[0].id, pair[1].id], pair, hand: evaluateSutdaHand(pair), read: readSutdaHand(pair) });
    }
    return list.sort((a, b) => b.hand.rank - a.hand.rank);
  }, [cards]);
  const best = options[0];
  const picked = pickedIds.length === 2 ? options.find((option) => option.ids.every((id) => pickedIds.includes(id))) ?? null : null;
  return (
    <section className={`sv6-sheet ${picked ? "is-done" : "is-urgent"}`} aria-label="승부할 두 장 선택">
      <header>
        <strong>{picked ? `${withRo(picked.hand.label)} 승부해요` : "승부할 두 장을 고르세요"}</strong>
        <small>{picked ? "다른 사람을 기다리는 중 · 눌러서 바꿀 수 있어요" : <><PhaseSeconds />초 · 안 고르면 {best?.hand.label}</>}</small>
      </header>
      <div className="sv6-sheet-row">
        {options.map((option) => {
          const on = picked === option;
          const special = SPECIAL_SHORT[option.hand.special];
          return (
            <button key={option.ids.join("+")} type="button" className={`sv6-sheet-pair ${on ? "is-on" : ""} ${picked && !on ? "is-off" : ""}`} onClick={() => onPick(option.ids)} aria-pressed={on} title={option.read?.specialLine ?? option.hand.detail} aria-label={`${option.pair.map(hwatuLabel).join(" + ")} · ${option.hand.label}`}>
              {option === best && !picked && <span className="sv6-sheet-flag">최고</span>}
              {special && <span className="sv6-sheet-flag is-special">{special}</span>}
              <span className="sv6-sheet-pair-cards">{option.pair.map((card) => <HwatuCard key={card.id} card={card} />)}</span>
              <b>{option.hand.label}</b>
              {option.read && option.read.meter > 0 && <HandStrengthMeter tier={option.read.meter} label={option.read.meterLabel} />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * 직접 쪼기: 엎어 온 패를 크게, 내 패 오른쪽 아래에 띄운다. 독을 가리지 않아서 내 차례에도 베팅 버튼과 같이
 * 있고, 쪼는 동안 판(판돈·상대)도 그대로 보인다. 이미 아는 패는 판 위 내 자리에 그대로 있다.
 */
export function SqueezeSheet({ card, title, myTurn, openNow, onOpen }: { card: Hwatu; title: string; myTurn: boolean; openNow: boolean; onOpen: () => void }) {
  return (
    <section className="sv6-sheet is-squeeze" aria-label="패 쪼기">
      <header>
        <strong>{title} 쪼기</strong>
        <small>{myTurn ? "베팅하면 열려요" : "꾹 누르거나 위로 밀기"}</small>
      </header>
      <div className="sv6-sheet-row">
        <span className="sv6-sheet-squeeze">
          <CardSqueeze openNow={openNow} onOpen={onOpen} hint="↑"><HwatuCard card={card} /></CardSqueeze>
        </span>
        <button type="button" className="sv6-sheet-open" onClick={onOpen}>바로<br />열기</button>
      </div>
    </section>
  );
}

/** 기리: 판과 판 사이, 자를 차례인 사람에게만. 뭉치를 옆으로 펼쳐 두고 자를 곳을 누르게 한다. */
const CUT_SLICES = 19;
export function CutStrip({ onCut, onSkip }: { onCut: (at: number) => void; onSkip: () => void }) {
  return (
    <div className="sv6-cutter" role="group" aria-label="기리 · 패 뭉치 자르기">
      <header>
        <p><strong>기리</strong> 자를 곳을 누르세요</p>
        <button type="button" className="sv6-cut-skip" onClick={onSkip}>건너뛰기</button>
      </header>
      <div className="sv6-cut-strip">
        {Array.from({ length: CUT_SLICES }, (_, index) => index + 1).map((at) => (
          <button key={at} type="button" onClick={() => onCut(at)} aria-label={`위에서 ${at}장째 아래를 자르기`} />
        ))}
      </div>
    </div>
  );
}
