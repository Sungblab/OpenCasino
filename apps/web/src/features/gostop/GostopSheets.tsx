import type { ReactNode } from "react";
import type { GostopCardSnapshot } from "@opencasino/contracts";
import { HwatuCard } from "../../components/HwatuCard";
import { PhaseSeconds } from "../pvp/phaseClock";

/**
 * 맞고 "고르는 창" — 독 자리에서 위로 자라 내 손패 자리를 덮는다(섯다의 고르기 창과 같은 틀). 판 위의
 * 바닥 패는 폰에서 30px 남짓이라 두 장 중 하나를 누르기 힘들었고, 고/스톱·국진·광 팔기는 한 줄 독에
 * 버튼 둘이 끼어 있어 내가 골라야 하는 순간인지 잘 안 보였다.
 */

const KIND_LABEL: Record<GostopCardSnapshot["kind"], string> = { gwang: "광", yeol: "열끗", tti: "띠", pi: "피" };
const cardLabel = (card: GostopCardSnapshot) => `${card.month}월 ${card.tags.includes("ssangpi") ? "쌍피" : KIND_LABEL[card.kind]}`;

function Sheet({ title, sub, urgent = true, children, label }: { title: ReactNode; sub: ReactNode; urgent?: boolean; children: ReactNode; label: string }) {
  return (
    <section className={`gv2-sheet ${urgent ? "is-urgent" : "is-done"}`} aria-label={label}>
      <header>
        <strong>{title}</strong>
        <small>{sub}</small>
      </header>
      {children}
    </section>
  );
}

/** 바닥에 같은 월이 두 장: 먹을 패를 크게 두 장 늘어놓고 한 번 누르게. */
export function ChoiceSheet({ phase, options, onChoose }: { phase: "hand" | "flip"; options: GostopCardSnapshot[]; onChoose: (cardId: string) => void }) {
  return (
    <Sheet label="먹을 패 선택" title="바닥의 어느 패를 먹을까요?" sub={<><PhaseSeconds />초 · {phase === "hand" ? "낸 패" : "뒤집은 패"}와 짝이 두 장 · 안 고르면 앞의 패</>}>
      <div className="gv2-sheet-row">
        {options.map((card) => (
          <button key={card.id} type="button" className="gv2-sheet-card" onClick={() => onChoose(card.id)} aria-label={`${cardLabel(card)} 먹기`}>
            <HwatuCard card={card} />
            <b>{cardLabel(card)}</b>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** 고/스톱: 점수와 이미 한 고, 도우미 한 마디, 큰 버튼 둘. */
export function GoStopSheet({ points, goCount, verdict, reasons, onDeclare }: {
  points: number;
  goCount: number;
  verdict: "go" | "stop" | null;
  reasons: string | null;
  onDeclare: (decision: "go" | "stop") => void;
}) {
  return (
    <Sheet
      label="고 스톱 선택"
      title={<>{points}점 났어요 · 고 할까요?{verdict && <em className="gv2-verdict">{verdict === "go" ? "고 할 만해요" : "스톱 권장"}</em>}</>}
      sub={<><PhaseSeconds />초 · 안 고르면 스톱{goCount > 0 ? ` · 이미 ${goCount}고` : ""}{reasons ? ` · ${reasons}` : ""}</>}
    >
      <div className="gv2-sheet-row">
        <button type="button" className="gv2-sheet-choice is-go" onClick={() => onDeclare("go")}>
          <strong>고</strong>
          <small>{goCount + 1}고 · 더 모은다</small>
        </button>
        <button type="button" className="gv2-sheet-choice is-stop" onClick={() => onDeclare("stop")}>
          <strong>스톱</strong>
          <small>{points}점으로 정산</small>
        </button>
      </div>
    </Sheet>
  );
}

export function KukjinSheet({ onPick }: { onPick: (asPi: boolean) => void }) {
  return (
    <Sheet label="국진 선택" title="9월 열끗(국진) — 어떻게 쓸까요?" sub={<><PhaseSeconds />초 · 안 고르면 열끗</>}>
      <div className="gv2-sheet-row">
        <button type="button" className="gv2-sheet-choice is-go" onClick={() => onPick(false)}>
          <strong>열끗</strong>
          <small>열끗 장수 점수에</small>
        </button>
        <button type="button" className="gv2-sheet-choice is-stop" onClick={() => onPick(true)}>
          <strong>쌍피</strong>
          <small>피 2장 값</small>
        </button>
      </div>
    </Sheet>
  );
}

export function SellGwangSheet({ amount, onPick }: { amount: number; onPick: (sell: boolean) => void }) {
  return (
    <Sheet label="광 팔기" title="광이 한 장도 없어요 · 팔까요?" sub={<><PhaseSeconds />초 · 팔면 이번 판을 쉬고 {amount.toLocaleString()}코인을 받아요</>}>
      <div className="gv2-sheet-row">
        <button type="button" className="gv2-sheet-choice is-go" onClick={() => onPick(true)}>
          <strong>팔기</strong>
          <small>+{amount.toLocaleString()}코인</small>
        </button>
        <button type="button" className="gv2-sheet-choice is-stop" onClick={() => onPick(false)}>
          <strong>안 팔고 계속</strong>
          <small>광 없이 그대로</small>
        </button>
      </div>
    </Sheet>
  );
}
