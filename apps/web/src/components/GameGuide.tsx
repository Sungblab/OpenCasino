import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useFocusTrap } from "../app/useFocusTrap";

export interface GuideSection {
  id: string;
  /** Tab label — two or three words at most, it has to fit a phone-width tab strip. */
  title: string;
  content: ReactNode;
}

export interface GameGuideContent {
  /** Stable per-game identifier — which guide this is, not tied to any particular room. */
  gameKey: string;
  title: string;
  /** One sentence a first-timer reads before anything else. */
  intro: string;
  sections: GuideSection[];
}

/**
 * The in-game help sheet: 족보, how a round goes, and the words on the buttons —
 * everything a player who has never sat at this table needs, without leaving it.
 *
 * Portalled onto <body> so it clears the game shell's overflow:hidden; a bottom
 * sheet on phones and a centered panel on wider screens (CSS). The table keeps
 * running underneath — this is a reference, not a modal that pauses anything.
 *
 * 그래도 화면을 덮는 동안은 aria-modal 대화상자로 행동한다: 열리면 지금 탭에 포커스가 들어오고,
 * Tab 은 시트 안에서만 돌며, 닫히면 열었던 버튼으로 포커스가 돌아간다. 예전에는 포커스가 시트
 * 뒤의 게임 바에 남아 있어서 키보드로는 시트 안의 탭을 누를 방법이 없었다.
 */
export function GameGuide({ content, open, initialSection, onClose }: { content: GameGuideContent; open: boolean; initialSection?: string; onClose: () => void }) {
  // 사용자가 고른 탭. 고르기 전(null)에는 열 때 요청받은 탭을 쓴다 — effect 로 한 박자 늦게 맞추면
  // 첫 렌더에서는 엉뚱한 탭이 선택된 채 포커스가 그리로 들어가 버린다.
  const [chosen, setChosen] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const baseId = useId();

  // 닫히면 고른 탭을 잊는다. 다음에 열 때는 다시 요청받은 탭(없으면 첫 탭)부터.
  useEffect(() => {
    if (!open) setChosen(null);
  }, [open]);

  const requested = initialSection && content.sections.some((section) => section.id === initialSection) ? initialSection : content.sections[0]?.id ?? "";
  const active = chosen ?? requested;
  const setActive = setChosen;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useFocusTrap(dialogRef, open, { initialFocusRef: activeTabRef });

  if (!open) return null;
  const section = content.sections.find((entry) => entry.id === active) ?? content.sections[0];
  const tabId = (id: string) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;

  // 탭 목록은 Tab 한 번으로 들어가고 화살표로 옮긴다(APG tabs 패턴). 탭 다섯 개를 Tab 으로 하나씩
  // 지나야 본문에 닿던 것을 줄인다.
  const onTabKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const index = content.sections.findIndex((entry) => entry.id === section?.id);
    const last = content.sections.length - 1;
    const next = event.key === "ArrowRight" ? (index >= last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index <= 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : -1;
    if (next < 0) return;
    event.preventDefault();
    const target = content.sections[next];
    if (!target) return;
    setActive(target.id);
    // 새 탭 버튼은 다음 렌더에서야 tabIndex=0 이 되지만 포커스는 지금 옮겨도 된다.
    document.getElementById(tabId(target.id))?.focus();
  };

  return createPortal(
    <div className="game-guide-root" role="presentation">
      <div className="game-guide-scrim" onClick={onClose} aria-hidden="true" />
      <section
        className="game-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${baseId}-title`}
        aria-describedby={`${baseId}-intro`}
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="game-guide-head">
          <div>
            <h2 id={`${baseId}-title`}>{content.title}</h2>
            <p id={`${baseId}-intro`}>{content.intro}</p>
          </div>
          <button type="button" className="game-guide-close" onClick={onClose} aria-label="도움말 닫기"><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="game-guide-tabs" role="tablist" aria-label="도움말 항목">
          {content.sections.map((entry) => {
            const selected = entry.id === section?.id;
            return (
              <button
                key={entry.id}
                id={tabId(entry.id)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                ref={selected ? activeTabRef : undefined}
                className={`game-guide-tab ${selected ? "is-active" : ""}`}
                onClick={() => setActive(entry.id)}
                onKeyDown={onTabKey}
              >
                {entry.title}
              </button>
            );
          })}
        </div>
        {/* 본문은 길어서 스크롤된다 — 키보드로도 스크롤할 수 있게 포커스를 받는다. */}
        <div className="game-guide-body" role="tabpanel" id={panelId} aria-labelledby={section ? tabId(section.id) : undefined} tabIndex={0}>
          {section?.content}
        </div>
      </section>
    </div>,
    // 전체화면 중에는 fullscreenElement(.game-shell) 바깥이 그려지지 않는다 — body 로 보내면
    // 도움말 버튼은 눌리는데 시트가 안 보인다. 그때만 그 요소 안으로 띄운다.
    document.fullscreenElement ?? document.body,
  );
}

/* ── Small building blocks the per-game guide modules share ─────────────── */

/** Numbered "how a round goes" list. */
export function GuideSteps({ steps }: { steps: Array<{ title: string; body: ReactNode }> }) {
  return (
    <ol className="guide-steps">
      {steps.map((step, index) => (
        <li key={step.title}>
          <span className="guide-step-num">{index + 1}</span>
          <div className="guide-step-text">
            <strong>{step.title}</strong>
            <span>{step.body}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** "What each button does" — the tone class colours the chip like the real button. */
export function GuideActions({ actions }: { actions: Array<{ label: string; tone: string; body: ReactNode }> }) {
  return (
    <ul className="guide-actions">
      {actions.map((action) => (
        <li key={action.label}>
          <span className={`guide-action-chip ${action.tone}`}>{action.label}</span>
          <span className="guide-action-body">{action.body}</span>
        </li>
      ))}
    </ul>
  );
}

/** Glossary. */
export function GuideTerms({ terms }: { terms: Array<{ term: string; body: ReactNode }> }) {
  return (
    <dl className="guide-terms">
      {terms.map((entry) => (
        <div key={entry.term} className="guide-term">
          <dt>{entry.term}</dt>
          <dd>{entry.body}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A tinted callout for the one thing a beginner most often gets wrong. */
export function GuideNote({ children, tone = "gold" }: { children: ReactNode; tone?: "gold" | "red" | "green" }) {
  return <p className={`guide-note is-${tone}`}>{children}</p>;
}

/** Section heading inside a tab. */
export function GuideHeading({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="guide-heading">
      <h3>{children}</h3>
      {sub && <span>{sub}</span>}
    </div>
  );
}
