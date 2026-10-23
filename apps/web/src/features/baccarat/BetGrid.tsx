import { memo, type ReactElement } from "react";
import { Users } from "lucide-react";
import type { BetZoneTotal } from "@opencasino/contracts";
import { ChipPile } from "../stage/ChipPile";

/**
 * 베팅판(DOM). 바카라와 용호가 함께 쓴다 — 영역 목록(ZoneSpec)만 게임마다 다르고, 칩 더미·
 * 테이블 전체 베팅·내 결과 표시는 같다. 선택지 타입은 게임별 문자열(BaccaratBetChoice,
 * DragonTigerBetChoice)이라 제네릭으로 둔다.
 */

export type ZoneTone = "player" | "banker" | "tie" | "pair-p" | "pair-b" | "bonus-p" | "bonus-b" | "suited";

export interface ZoneSpec<C extends string = string> {
  choice: C;
  label: string;
  odds: string;
  tone: ZoneTone;
  /** 넓은 줄(플레이어·뱅커, 드래곤·타이거)은 크게. */
  big?: boolean;
}

export interface ZoneOutcome {
  /** half: 용호 타이 때 드래곤·타이거 베팅은 절반만 돌려받는다. */
  state: "win" | "lose" | "push" | "half";
  /** 이긴 금액(원금 제외). 진 곳은 0. */
  profit: number;
  /** 돌려받는 금액(원금 포함). half 일 때 보여 준다. */
  returned?: number;
}

/** 베팅 금액과 돌려받을 금액으로 영역 결과를 매긴다. */
export function zoneOutcome(amount: number, payout: number): ZoneOutcome {
  if (payout > amount) return { state: "win", profit: payout - amount, returned: payout };
  if (payout === amount) return { state: "push", profit: 0, returned: payout };
  if (payout > 0) return { state: "half", profit: 0, returned: payout };
  return { state: "lose", profit: 0, returned: 0 };
}

interface BetGridProps<C extends string> {
  zones: ZoneSpec<C>[];
  amounts: Partial<Record<C, number>>;
  totals: Partial<Record<string, BetZoneTotal>>;
  outcomes: Partial<Record<C, ZoneOutcome>> | null;
  /** 결과가 난 영역. 내 베팅이 없어도 빛낸다. */
  winners: ReadonlySet<C>;
  disabled: boolean;
  denominations: readonly number[];
  onPlace: (choice: C) => void;
  pileRef: (choice: C, kind: "stake" | "payout", element: HTMLSpanElement | null) => void;
  /** 게임별 배치(용호는 가운데에 타이·SUITED TIE를 두 줄로 쌓는다). */
  className?: string;
}

function BetGridView<C extends string>({ zones, amounts, totals, outcomes, winners, disabled, denominations, onPlace, pileRef, className = "" }: BetGridProps<C>) {
  // 이번 판 테이블 전체 베팅 대비 이 영역이 차지하는 비율(쏠림 위젯과 별개로, 판 안에서 바로 보이게).
  const tableTotal = zones.reduce((sum, zone) => sum + (totals[zone.choice]?.amount ?? 0), 0);
  return (
    <div className={`bac-grid ${className} ${disabled ? "is-locked" : ""}`}>
      {zones.map((zone) => {
        const amount = amounts[zone.choice] ?? 0;
        const total = totals[zone.choice];
        const outcome = outcomes?.[zone.choice];
        const won = winners.has(zone.choice);
        const cap = zone.big ? 12 : 7;
        const lost = outcome?.state === "lose" || outcome?.state === "half";
        const pct = tableTotal > 0 ? Math.round(((total?.amount ?? 0) / tableTotal) * 100) : 0;
        return (
          <button
            key={zone.choice}
            type="button"
            className={`bac-zone ${zone.tone} zone-${zone.choice} ${zone.big ? "big" : ""} ${amount > 0 ? "has-bet" : ""} ${won ? "is-win" : ""} ${lost ? "is-lose" : ""}`}
            aria-disabled={disabled}
            aria-label={`${zone.label} ${zone.odds}${amount > 0 ? `, 내 베팅 ${amount.toLocaleString()}코인` : ""}`}
            onClick={() => { if (!disabled) onPlace(zone.choice); }}
          >
            <span className="bac-zone-name">{zone.label}</span>
            <span className="bac-zone-odds">{zone.odds}</span>
            {/* 아무도 안 건 칸에서도 자리는 잡아 둔다 — 누가 걸어 줄이 생길 때 칸 높이가 바뀌지 않게. */}
            <span className={`bac-zone-table ${total && total.players > 0 ? "" : "is-empty"}`} aria-hidden="true"><Users size={11} /> {total?.players ?? 0}명 · {pct}%</span>
            {/* 건 금액은 칩 더미 맨 위 칩에, 판의 내 손익은 게임 화면의 결과 배너 한 곳에 — 칸마다 +이익·−잃음 글자를
                또 적지 않는다(같은 정보가 두 번 떴다). 이긴 칸은 딴 칩 더미와 금테, 진 칸은 흐림으로 보인다. */}
            <span className="chip-pile-slot payout" ref={(element) => pileRef(zone.choice, "payout", element)}>
              {outcome?.state === "win" && <ChipPile amount={outcome.profit} denominations={denominations} cap={cap} className="is-payout" />}
            </span>
            <span className="chip-pile-slot stake" ref={(element) => pileRef(zone.choice, "stake", element)}>
              <ChipPile amount={amount} denominations={denominations} cap={cap} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** memo 는 제네릭을 잃으므로 타입만 되살려 내보낸다. */
export const BetGrid = memo(BetGridView) as <C extends string>(props: BetGridProps<C>) => ReactElement;
