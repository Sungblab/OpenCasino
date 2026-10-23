import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Columns2, Rows2, Rows3 } from "lucide-react";
import type { BetZoneTotal, RoundHistoryEntry, RoundResult } from "@opencasino/contracts";
import { BigRoad } from "../../components/BigRoad";
import { DerivedRoads } from "../../components/DerivedRoads";
import { Dropdown } from "../../components/Dropdown";

/**
 * 베팅판 양옆 칸에 넣는 위젯들. 바카라에서 시작했고 용호도 같은 칸을 쓴다(블랙잭은 로드가 없어 칸을 두지 않는다).
 *
 * 사용자가 칸마다 보고 싶은 위젯을 고르고, 한쪽 칸을 둘로 나눌 수 있다. 선택은 이 브라우저에
 * 게임별로 저장한다. 모바일은 같은 위젯을 탭으로 하나씩 보여 준다. 위젯은 모두 이미 스냅샷에
 * 있는 데이터(로드 기록, 영역별 전체 베팅, 슈 남은 카드)나 이 페이지가 모은 내 결과로만 그린다.
 *
 * 용호의 로드는 서버 기록을 바카라 모양(드래곤→player, 타이거→banker, SUITED TIE→bankerPair)
 * 으로 바꿔 넣고, 글자와 이름만 게임별로 바꿔 그린다. 로드를 쌓는 규칙이 두 게임에서 같기 때문이다.
 */

export type WidgetId = "bead" | "bigRoad" | "derived" | "betSplit" | "shoeStats";
export type PanelSide = "left" | "right";
export type WidgetGame = "baccarat" | "dragonTiger";

export interface WidgetData {
  /** 없으면 바카라. */
  game?: WidgetGame;
  history: RoundHistoryEntry[];
  prediction: RoundResult | null;
  onPredict: (result: RoundResult) => void;
  betTotals: Partial<Record<string, BetZoneTotal>>;
  shoeRemaining: number;
}

export const WIDGETS: Record<WidgetId, { title: string }> = {
  bead: { title: "구슬판" },
  bigRoad: { title: "빅로드" },
  derived: { title: "파생 로드" },
  betSplit: { title: "베팅 비율" },
  shoeStats: { title: "슈 통계" },
};

export interface WidgetLayout {
  left: WidgetId[];
  right: WidgetId[];
  mobile: WidgetId;
}

const ROAD_WIDGETS: WidgetId[] = ["bead", "bigRoad", "derived", "betSplit", "shoeStats"];
/** 바카라·용호 데스크톱은 옆 칸이 위에서 아래까지 길어서 칸마다 셋까지 쌓는다: 왼쪽은 로드판, 오른쪽은 베팅 비율·슈 통계(아래엔 채팅이 꽂힌다). */
export const DEFAULT_LAYOUT: WidgetLayout = { left: ["bead", "bigRoad", "derived"], right: ["betSplit", "shoeStats"], mobile: "bigRoad" };

/**
 * 옆 칸이 위아래로 긴 데스크톱 배치(baccarat-table.css 의 .bac-room.is-columns)가 켜지는 조건. 이때
 * 채팅이 오른쪽 칸에 꽂힌다. CSS 쪽 미디어 쿼리와 같이 고칠 것.
 */
export const COLUMNS_LAYOUT_MEDIA = "(min-width: 901px) and (min-height: 541px)";

/** 게임마다 고를 수 있는 위젯과 처음 배치, 저장 키, 한 칸에 쌓을 수 있는 위젯 수. 칸이 셋으로 바뀌면서 키를 v2 로 올렸다(두 칸짜리 옛 배치 대신 새 기본 배치). */
export const WIDGET_SETS: Record<WidgetGame, { order: WidgetId[]; defaults: WidgetLayout; key: string; slots: number }> = {
  baccarat: { order: ROAD_WIDGETS, defaults: DEFAULT_LAYOUT, key: "opencasino.baccarat.widgets.v2", slots: 3 },
  dragonTiger: { order: ROAD_WIDGETS, defaults: DEFAULT_LAYOUT, key: "opencasino.dragonTiger.widgets.v2", slots: 3 },
};

/**
 * 로드·구슬판·통계에 쓰는 글자와 이름. 용호는 D/T 로 적고, 타이는 타이거의 T 와 헷갈리지 않게
 * "타"로 적는다(베팅판도 "타이"라고 쓴다).
 */
export const ROAD_LABELS: Record<"baccarat" | "dragonTiger", { letters: Record<RoundResult, string>; names: Record<RoundResult, string>; pairName: string }> = {
  baccarat: { letters: { player: "P", banker: "B", tie: "T" }, names: { player: "PLAYER", banker: "BANKER", tie: "TIE" }, pairName: "PAIR P · B" },
  dragonTiger: { letters: { player: "D", banker: "T", tie: "타" }, names: { player: "DRAGON", banker: "TIGER", tie: "TIE" }, pairName: "SUITED TIE" },
};
const labelsFor = (game: WidgetGame) => ROAD_LABELS[game];

/** 저장된 배치를 읽는다. 그 게임에 없는 위젯이 들어 있으면 버리고 처음 배치로 채운다. */
export function readLayout(game: WidgetGame = "baccarat", stored?: string | null): WidgetLayout {
  const { order, defaults, key, slots } = WIDGET_SETS[game];
  try {
    const raw = stored === undefined ? window.localStorage.getItem(key) : stored;
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<WidgetLayout>;
    const valid = (id: unknown): id is WidgetId => typeof id === "string" && order.includes(id as WidgetId);
    const side = (list: unknown, fallback: WidgetId[]) => {
      const ids = Array.isArray(list) ? list.filter(valid).slice(0, slots) : [];
      return ids.length > 0 ? ids : fallback;
    };
    return {
      left: side(parsed.left, defaults.left),
      right: side(parsed.right, defaults.right),
      mobile: valid(parsed.mobile) ? parsed.mobile : defaults.mobile,
    };
  } catch {
    return defaults;
  }
}

/** 한 칸에 위젯을 고른다. 그 위젯이 이미 다른 칸에 있으면 두 칸의 위젯을 맞바꾼다. */
export function chooseWidget(current: WidgetLayout, side: PanelSide, index: number, id: WidgetId): WidgetLayout {
  const next: WidgetLayout = { ...current, left: [...current.left], right: [...current.right] };
  const previous = next[side][index];
  if (previous === undefined) return current;
  for (const other of ["left", "right"] as PanelSide[]) {
    const at = next[other].indexOf(id);
    if (at >= 0 && !(other === side && at === index)) next[other][at] = previous;
  }
  next[side][index] = id;
  return next;
}

/** 한쪽 칸을 slots 개까지 나누거나(안 쓰는 위젯을 아래에 채운다) 하나로 합친다. */
export function toggleSplitLayout(current: WidgetLayout, side: PanelSide, order: readonly WidgetId[] = ROAD_WIDGETS, slots = 2): WidgetLayout {
  const list = current[side];
  if (list.length > 1) return { ...current, [side]: [list[0]!] };
  const used = new Set([...current.left, ...current.right]);
  return { ...current, [side]: [list[0]!, ...order.filter((id) => !used.has(id))].slice(0, slots) };
}

/** 칸 배치. 이 브라우저에 게임별로 저장한다. */
export function useWidgetLayout(game: WidgetGame = "baccarat") {
  const { order, defaults, key, slots } = WIDGET_SETS[game];
  const [layout, setLayout] = useState<WidgetLayout>(() => readLayout(game));
  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify(layout)); } catch { /* 이 브라우저만의 편의 기능 */ }
  }, [layout, key]);
  const choose = useCallback((side: PanelSide, index: number, id: WidgetId) => setLayout((current) => chooseWidget(current, side, index, id)), []);
  const toggleSplit = useCallback((side: PanelSide) => setLayout((current) => toggleSplitLayout(current, side, order, slots)), [order, slots]);
  const chooseMobile = useCallback((id: WidgetId) => setLayout((current) => ({ ...current, mobile: id })), []);
  const reset = useCallback(() => setLayout(defaults), [defaults]);
  return { layout, choose, toggleSplit, chooseMobile, reset };
}

/* ───────── 칸 ───────── */

export function SidePanel({ side, ids, data, onChoose, onToggleSplit }: {
  side: PanelSide;
  ids: WidgetId[];
  data: WidgetData;
  onChoose: (side: PanelSide, index: number, id: WidgetId) => void;
  onToggleSplit: (side: PanelSide) => void;
}) {
  const sideLabel = side === "left" ? "왼쪽" : "오른쪽";
  const { order, slots } = WIDGET_SETS[data.game ?? "baccarat"];
  const split = ids.length > 1;
  const places = ids.length === 3 ? ["위", "가운데", "아래"] : ["위", "아래"];
  return (
    <div className={`bac-panel ${split ? "is-split" : ""}`}>
      {ids.map((id, index) => (
        <section className="bac-widget" key={`${side}-${index}`} aria-label={WIDGETS[id].title}>
          <header className="bac-widget-head">
            <Dropdown
              className="bac-widget-select"
              value={id}
              ariaLabel={`${sideLabel} ${split ? `${places[index]} ` : ""}칸에 보여 줄 위젯`}
              options={order.map((option) => ({ value: option, label: WIDGETS[option].title }))}
              onChange={(value) => onChoose(side, index, value as WidgetId)}
            />
            {index === 0 && (
              <button
                type="button"
                className="bac-widget-split"
                onClick={() => onToggleSplit(side)}
                aria-label={split ? `${sideLabel} 칸 합치기` : `${sideLabel} 칸 ${slots === 3 ? "셋으로" : "둘로"} 나누기`}
                title={split ? "한 칸으로 합치기" : `${slots === 3 ? "세" : "두"} 칸으로 나누기`}
              >
                {split ? <Columns2 size={15} /> : slots === 3 ? <Rows3 size={15} /> : <Rows2 size={15} />}
              </button>
            )}
          </header>
          <div className="bac-widget-body">
            <WidgetBody id={id} data={data} compact={false} />
          </div>
        </section>
      ))}
    </div>
  );
}

/** 모바일: 위젯 하나를 옆 칸과 같은 드롭다운으로 골라 본다(탭 줄은 가로 스크롤이 생겨서 뺐다). */
export function MobileWidget({ id, data, onChoose }: { id: WidgetId; data: WidgetData; onChoose: (id: WidgetId) => void }) {
  const order = WIDGET_SETS[data.game ?? "baccarat"].order;
  return (
    <section className="bac-widget bac-mobile-widget" aria-label={WIDGETS[id].title}>
      <header className="bac-widget-head">
        <Dropdown
          className="bac-widget-select"
          value={id}
          ariaLabel="보여 줄 정보"
          options={order.map((option) => ({ value: option, label: WIDGETS[option].title }))}
          onChange={(value) => onChoose(value as WidgetId)}
        />
      </header>
      <div className="bac-widget-body">
        <WidgetBody id={id} data={data} compact />
      </div>
    </section>
  );
}

function WidgetBody({ id, data, compact }: { id: WidgetId; data: WidgetData; compact: boolean }): ReactNode {
  const game = data.game ?? "baccarat";
  const labels = labelsFor(game);
  switch (id) {
    case "bead": return <BeadRoad history={data.history} prediction={data.prediction} letters={labels.letters} />;
    case "bigRoad": return <BigRoad history={data.history} prediction={data.prediction} onPredict={data.onPredict} labels={game === "dragonTiger" ? labels.letters : undefined} />;
    case "derived": return <DerivedRoads history={data.history} prediction={data.prediction} />;
    case "betSplit": return <BetSplit totals={data.betTotals} game={game} />;
    case "shoeStats": return <ShoeStats history={data.history} shoeRemaining={data.shoeRemaining} compact={compact} game={game} />;
  }
}

/* ───────── 위젯 ───────── */

const LETTER: Record<RoundResult, string> = ROAD_LABELS.baccarat.letters;

/** 구슬판: 결과를 한 칸씩 위에서 아래로, 여섯 칸이 차면 옆 줄로. */
export const BeadRoad = memo(function BeadRoad({ history, prediction, letters = LETTER }: { history: RoundHistoryEntry[]; prediction: RoundResult | null; letters?: Record<RoundResult, string> }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const cells = useMemo(() => history.slice(-120), [history]);
  useEffect(() => {
    gridRef.current?.scrollTo({ left: gridRef.current.scrollWidth, behavior: "smooth" });
  }, [cells.length, prediction]);
  return (
    <div className="bead-road" ref={gridRef} role="img" aria-label={`구슬판 최근 ${cells.length}판`}>
      {cells.map((entry, index) => (
        <i key={index} className={`bead ${entry.result} ${entry.playerPair ? "pp" : ""} ${entry.bankerPair ? "bp" : ""}`}>{letters[entry.result]}</i>
      ))}
      {prediction && <i className={`bead ${prediction} is-preview`}>{letters[prediction]}</i>}
    </div>
  );
});

function compact(amount: number): string {
  if (amount < 10_000) return amount.toLocaleString();
  const man = amount / 10_000;
  return `${man >= 10 ? Math.round(man) : man.toFixed(1)}만`;
}

/** 게임별로 두 큰 영역과 나머지 영역의 키·이름. */
const SPLIT_KEYS: Record<"baccarat" | "dragonTiger", { main: [string, string]; rows: Array<[string, string, string]> }> = {
  baccarat: { main: ["player", "banker"], rows: [["tie", "TIE", "t"], ["player_pair", "P PAIR", "p"], ["banker_pair", "B PAIR", "b"], ["player_bonus", "P BONUS", "p"], ["banker_bonus", "B BONUS", "b"]] },
  dragonTiger: { main: ["dragon", "tiger"], rows: [["tie", "TIE", "t"], ["suited_tie", "SUITED TIE", "s"]] },
};

/** 이번 판 테이블 전체 베팅이 어느 쪽에 몰렸는지. 서버가 영역별 합계와 인원을 이미 보내 준다. */
export const BetSplit = memo(function BetSplit({ totals, game = "baccarat" }: { totals: Partial<Record<string, BetZoneTotal>>; game?: WidgetGame }) {
  const keys = SPLIT_KEYS[game];
  const names = labelsFor(game).names;
  const [playerKey, bankerKey] = keys.main;
  const player = totals[playerKey]?.amount ?? 0;
  const banker = totals[bankerKey]?.amount ?? 0;
  const main = player + banker;
  const playerPct = main > 0 ? Math.round((player / main) * 100) : 50;
  return (
    <div className="bet-split">
      <div className="bet-split-heads">
        <span className="p">{names.player} <b>{main > 0 ? `${playerPct}%` : "–"}</b></span>
        <span className="b"><b>{main > 0 ? `${100 - playerPct}%` : "–"}</b> {names.banker}</span>
      </div>
      <div className="bet-split-bar" aria-hidden="true">
        <span className="p" style={{ width: `${playerPct}%` }} />
        <span className="b" style={{ width: `${100 - playerPct}%` }} />
      </div>
      <div className="bet-split-heads small">
        <span>{compact(player)}코인 · {totals[playerKey]?.players ?? 0}명</span>
        <span>{totals[bankerKey]?.players ?? 0}명 · {compact(banker)}코인</span>
      </div>
      <ul className="bet-split-side">
        {keys.rows.filter(([key]) => (totals[key]?.amount ?? 0) > 0 || key === "tie").map(([key, label, tone]) => (
          <li key={key} className={tone}><span>{label}</span><b>{compact(totals[key]?.amount ?? 0)}</b><em>{totals[key]?.players ?? 0}명</em></li>
        ))}
      </ul>
      {main === 0 && <p className="bac-empty">아직 이번 판 베팅이 없습니다</p>}
    </div>
  );
});

function streaks(history: RoundHistoryEntry[]) {
  let current: { side: "player" | "banker"; length: number } | null = null;
  const longest = { player: 0, banker: 0 };
  let run: { side: "player" | "banker"; length: number } | null = null;
  for (const entry of history) {
    if (entry.result === "tie") continue;
    run = run && run.side === entry.result ? { side: run.side, length: run.length + 1 } : { side: entry.result, length: 1 };
    longest[run.side] = Math.max(longest[run.side], run.length);
  }
  current = run;
  return { current, longest };
}

const SHOE_CARDS = 416;

/** 이 슈의 결과 통계. 로드 기록만으로 계산한다. */
export const ShoeStats = memo(function ShoeStats({ history, shoeRemaining, compact: small, game = "baccarat" }: { history: RoundHistoryEntry[]; shoeRemaining: number; compact: boolean; game?: WidgetGame }) {
  const { names, letters, pairName } = labelsFor(game);
  const counts = { player: 0, banker: 0, tie: 0 };
  let pp = 0;
  let bp = 0;
  for (const entry of history) {
    counts[entry.result] += 1;
    if (entry.playerPair) pp += 1;
    if (entry.bankerPair) bp += 1;
  }
  const total = history.length;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const { current, longest } = streaks(history);
  const used = Math.max(0, Math.min(1, 1 - shoeRemaining / SHOE_CARDS));
  return (
    <div className={`shoe-stats ${small ? "is-compact" : ""}`}>
      <div className="shoe-stats-bar" aria-label={`${names.player} ${pct(counts.player)}%, ${names.banker} ${pct(counts.banker)}%, ${names.tie} ${pct(counts.tie)}%`}>
        <span className="p" style={{ flexGrow: counts.player || 1 }} />
        <span className="b" style={{ flexGrow: counts.banker || 1 }} />
        <span className="t" style={{ flexGrow: counts.tie || (total ? 0 : 1) }} />
      </div>
      <dl>
        <div className="p"><dt>{names.player}</dt><dd>{counts.player}<small>{pct(counts.player)}%</small></dd></div>
        <div className="b"><dt>{names.banker}</dt><dd>{counts.banker}<small>{pct(counts.banker)}%</small></dd></div>
        <div className="t"><dt>{names.tie}</dt><dd>{counts.tie}<small>{pct(counts.tie)}%</small></dd></div>
        {/* 용호에는 페어가 없고, 기록의 bankerPair 자리에 SUITED TIE를 담아 온다. */}
        {game === "dragonTiger"
          ? <div><dt>{pairName}</dt><dd>{bp}</dd></div>
          : <div><dt>PAIR</dt><dd><b className="side-p">{letters.player}</b> {pp} · <b className="side-b">{letters.banker}</b> {bp}</dd></div>}
        {/* 이름(플레이어 12)은 칸이 좁으면 두 줄로 꺾여서, 로드처럼 색 글자(P 12)로 적는다. */}
        <div><dt>지금 연속</dt><dd>{current ? <><b className={current.side === "player" ? "side-p" : "side-b"}>{letters[current.side]}</b> {current.length}</> : "–"}</dd></div>
        <div><dt>최장 연속</dt><dd><b className="side-p">{letters.player}</b> {longest.player} · <b className="side-b">{letters.banker}</b> {longest.banker}</dd></div>
      </dl>
      <div className="shoe-stats-shoe">
        <span>슈 진행 {total}판 · 남은 카드 {shoeRemaining}장</span>
        <i aria-hidden="true"><b style={{ width: `${Math.round(used * 100)}%` }} /></i>
      </div>
    </div>
  );
});
