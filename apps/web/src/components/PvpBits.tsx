import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import type { BotSkill } from "@opencasino/contracts";
import { BOT_SKILLS, BOT_SKILL_LABEL } from "@opencasino/game-core/bots";

/**
 * Small, shared pieces of the three player-vs-player tables (섯다, 홀덤, 고스톱). All
 * three put the same questions in front of a beginner — "how strong is what I hold",
 * "where are we in the round", and "what does this button do" — so the answers are
 * drawn the same way on every felt. 좌석·독·도구 줄 같은 더 큰 공용 조각은
 * features/pvp 에 있다.
 */

/** Five-segment strength meter. `tier` is 1 (weakest) – 5 (strongest). */
export function HandStrengthMeter({ tier, label, detail }: { tier: number; label: string; detail?: ReactNode }) {
  const level = Math.max(1, Math.min(5, Math.round(tier)));
  return (
    <div className={`hand-meter tier-${level}`} role="img" aria-label={`패 강도 ${label}, 5단계 중 ${level}단계`}>
      <span className="hand-meter-bars" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((step) => <i key={step} className={step <= level ? "is-on" : ""} />)}
      </span>
      <span className="hand-meter-label">{label}</span>
      {detail && <span className="hand-meter-detail">{detail}</span>}
    </div>
  );
}

/** Where the round is: "첫 패 → 베팅 → 둘째 패 → 베팅 → 승부". `current` is 0-based; -1 for none. */
export function StepBar({ steps, shortSteps, current, ariaLabel }: { steps: string[]; shortSteps?: string[]; current: number; ariaLabel: string }) {
  return (
    <ol className="step-bar" aria-label={ariaLabel}>
      {steps.map((step, index) => (
        <li key={step} className={index < current ? "is-done" : index === current ? "is-current" : ""} aria-current={index === current ? "step" : undefined}>
          <span className="step-full">{step}</span>
          {/* A narrower label for the landscape-phone rail, where five full words don't fit. */}
          <span className="step-short" aria-hidden="true">{shortSteps?.[index] ?? step}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * An action button that says what it does, not just what it's called: the big
 * word is the poker/섯다 term, the small line under it is plain Korean ("따라가기",
 * "포기"). `tone` picks the colour family every table uses for that action.
 */
export function ActionButton({ label, hint, tone, onClick, disabled, title }: { label: ReactNode; hint?: ReactNode; tone: "red" | "gold" | "blue" | "green" | "purple"; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button type="button" className={`pvp-act tone-${tone}`} onClick={onClick} disabled={disabled} title={title}>
      <strong>{label}</strong>
      {hint && <small>{hint}</small>}
    </button>
  );
}

/* ---------------------------------------------------------------------------
   AI 봇 — 빈 자리를 사람이 직접 채운다. 자동으로 앉지 않는다.
   --------------------------------------------------------------------------- */

/**
 * 빈 좌석에서 봇을 부르는 버튼. 이미 앉아 있는 사람에게만 보인다 — 앉지 않은 사람에게는
 * 그 자리가 "앉기" 버튼이고, 둘을 한 칸에 겹쳐 놓으면 앉으려다 봇을 부르게 된다.
 *
 * 좌석 칸의 기하를 건드리지 않도록 빈 좌석과 똑같은 클래스를 그대로 쓴다.
 */
export function AddBotSeat({ onClick, busy, seatNumber, style, attrs }: { onClick: () => void; busy?: boolean; seatNumber: number; style?: CSSProperties; attrs?: Record<`data-${string}`, string | undefined> }) {
  return (
    <button
      type="button"
      className="holdem-seat holdem-seat-empty is-bot-slot"
      style={style}
      {...attrs}
      onClick={onClick}
      disabled={busy}
      aria-label={`${seatNumber}번 좌석에 AI 봇 부르기`}
      title="이 자리에 AI 봇을 앉힙니다"
    >
      <span className="bot-slot-icon" aria-hidden="true">AI</span>
      <span className="bot-slot-label">봇 부르기</span>
    </button>
  );
}

/**
 * 봇 강도 선택. 다음에 부를 봇에 적용되고, 이미 앉은 봇은 바뀌지 않는다 — 판이 도는
 * 도중에 상대 실력이 바뀌면 그건 게임이 아니다.
 *
 * 값을 순환하는 알약 하나다. 라벨 붙은 select 로 먼저 만들었더니 세로 412px 에서
 * 툴바가 40px 넘쳤고, 두 줄로 접었더니 이번엔 홀덤 2번 좌석을 덮었다. 툴바에 이미 세 개가
 * 있는 화면에서 네 번째가 쓸 수 있는 폭은 알약 하나뿐이다.
 */
export function BotSkillPicker({ value, onChange }: { value: BotSkill; onChange: (skill: BotSkill) => void }) {
  const next = BOT_SKILLS[(BOT_SKILLS.indexOf(value) + 1) % BOT_SKILLS.length]!;
  return (
    <button
      type="button"
      className="pvp-tool pvp-bot-skill"
      onClick={() => onChange(next)}
      title={`부를 봇의 실력: ${BOT_SKILL_LABEL[value]} (눌러서 ${BOT_SKILL_LABEL[next]}(으)로)`}
      aria-label={`부를 봇의 실력 ${BOT_SKILL_LABEL[value]}, 눌러서 ${BOT_SKILL_LABEL[next]}(으)로 변경`}
    >
      <span className="bot-skill-caption">봇 실력</span>
      {/* 좀은 화면용 한 글자 라벨 — 위의 StepBar 가 쓰는 것과 같은 방식이다.
          읽히는 이름은 aria-label 에 전체로 들어 있다. */}
      <strong className="bot-skill-full">{BOT_SKILL_LABEL[value]}</strong>
      <strong className="bot-skill-short" aria-hidden="true">{BOT_SKILL_LABEL[value].slice(0, 1)}</strong>
    </button>
  );
}

/** 강도 선택을 이 브라우저에만 기억한다. 사람마다 취향이 다르고, 서버가 알 필요는 없다. */
export function useBotSkill(): [BotSkill, (skill: BotSkill) => void] {
  const [skill, setSkill] = useState<BotSkill>(() => {
    try {
      const saved = localStorage.getItem("opencasino.botSkill");
      return BOT_SKILLS.includes(saved as BotSkill) ? (saved as BotSkill) : "normal";
    } catch { return "normal"; }
  });
  // 안정된 함수로 준다 — 도구 줄과 봇 명령 콜백이 이걸 의존성으로 쓰는데, 렌더마다 새 함수면
  // 그 콜백들이 매번 새로 만들어져 memo 한 좌석까지 다시 그려진다.
  const update = useCallback((next: BotSkill) => {
    setSkill(next);
    try { localStorage.setItem("opencasino.botSkill", next); } catch { /* 저장이 막혀 있어도 이번 판은 된다. */ }
  }, []);
  return [skill, update];
}
