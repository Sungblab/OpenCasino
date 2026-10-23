import { memo, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { GameShellContext, LandscapeMenu } from "../../components/LandscapeControls";
import type { BotSkill } from "@opencasino/contracts";
import { GameShell, openGameGuide } from "../../components/GameShell";
import { BotSkillPicker } from "../../components/PvpBits";
import { RoomChat } from "../../components/RoomChat";
import { RoundResultNotice, type RoundResultNoticeData } from "../../components/RoundResultNotice";
import { EmotePicker } from "../../components/TableBits";
import type { GameSocket } from "../../lib/gameSocket";
import { ConfirmDialog } from "./ConfirmDialog";
import { DockBar, DockClock, usePhaseSeconds } from "./phaseClock";

/* ===========================================================================
   판 둘레의 공용 조각 — 셸, 위 띠 도구 줄, 관전 안내, 준비 줄, 차례 외침, 독 머리줄, 결과 목록.
   세 페이지가 거의 같은 JSX 를 복사해 들고 있던 것들이다.
   =========================================================================== */

type ShellProps = Omit<ComponentProps<typeof GameShell>, "phaseSeconds"> & { hasDeadline: boolean };

/**
 * GameShell 에 남은 초를 꽂아 주는 얇은 껍데기. 초는 PhaseClock 컨텍스트에서 읽으므로 이 컴포넌트만
 * 매초 다시 그려지고, children(판 전체)은 같은 요소라 건너뛴다.
 */
export function PvpShell({ hasDeadline, ...props }: ShellProps) {
  const seconds = usePhaseSeconds();
  return <GameShell {...props} phaseSeconds={hasDeadline ? seconds : null} />;
}

/**
 * 위 띠 오른쪽 도구 줄. 순서는 세 게임 공통: 규칙표 · (지난 핸드) · (도우미) · 봇 실력 · 자리 비우기 ·
 * 표정 · 채팅. 앉은 사람에게만 필요한 것(봇·자리 비우기·표정)은 앉았을 때만 나온다.
 */
export const PvpTools = memo(function PvpTools({ socket, roomId, token, guideLabel, seated, extra, assist, botSkill, onBotSkill, leave, emote, moreMenu = false, landMenu = true }: {
  socket: GameSocket;
  roomId: string;
  token: string;
  guideLabel: string;
  seated: boolean;
  /** 규칙표 바로 뒤에 끼우는 게임 고유 도구(홀덤의 지난 핸드). */
  extra?: ReactNode;
  assist?: { on: boolean; toggle: () => void };
  botSkill: BotSkill;
  onBotSkill: (skill: BotSkill) => void;
  leave: { confirm: string | null; title?: string; onLeave: () => void };
  emote: { catalog: Array<{ id: string; text: string }>; onSend: (id: string) => void; muted: boolean; onToggleMuted: (next: boolean) => void };
  /** 앉은 사람용 도구(봇·자리 비우기·표정)를 좁은 화면에서 "⋯" 메뉴로 접는다. 넓은 화면은 그대로 한 줄. */
  moreMenu?: boolean;
  /** 가로 폰의 ⛶·≡ 메뉴를 이 줄 끝에 둔다. 도구 줄이 긴 게임(고스톱)은 끄고 윗줄 왼쪽에 따로 둔다. */
  landMenu?: boolean;
}) {
  const leaveDialog = useLeaveGuard(leave.confirm, leave.onLeave);
  const seatedTools = seated && (
    <>
      <BotSkillPicker value={botSkill} onChange={onBotSkill} />
      <LeaveSeatButton confirm={leave.confirm} title={leave.title} onLeave={leave.onLeave} />
      <EmotePicker catalog={emote.catalog} onSend={emote.onSend} muted={emote.muted} onToggleMuted={emote.onToggleMuted} />
    </>
  );
  return (
    <div className="pvp-tools">
      <button type="button" className="pvp-tool" onClick={() => openGameGuide("rankings")}>{guideLabel}</button>
      {extra}
      {assist && <button type="button" className="pvp-tool" aria-pressed={assist.on} onClick={assist.toggle}>도우미</button>}
      {moreMenu && seatedTools ? <MoreTools>{seatedTools}</MoreTools> : seatedTools}
      <RoomChat socket={socket} roomId={roomId} token={token} />
      {landMenu && <LandscapeMenu />}
      {leaveDialog}
    </div>
  );
});

/**
 * 판 중에 방을 나가려 하면(← · 폰 뒤로가기 · 메뉴의 다른 화면 링크) "자리 비우기"와 같은 문구로 한 번 묻고,
 * 나가기를 고르면 그 자리에서 자리를 비운 뒤(섯다 다이·홀덤 폴드·고스톱 자동 진행) 나간다. 묻지 않고 나가면
 * 서버는 새로고침 대비 20초 유예 뒤에야 접어서, 남은 사람들이 그동안 떠난 사람의 차례 타이머를 지켜봤다.
 * 판이 없으면 묻지 않는다. 탭 닫기·새로고침은 막지 않는다 — 문구를 못 바꾸는 브라우저 기본 창뿐이고, 돌아오면
 * 유예 안에서 이어 앉는다.
 */
function useLeaveGuard(confirm: string | null, onLeave: () => void): ReactNode {
  const navigate = useNavigate();
  const backTo = useContext(GameShellContext)?.backTo ?? "/lobby";
  /** 가려던 곳(뒤로가기면 null)과 그때 보여 준 문구. 묻는 사이 판이 끝나도 창은 그대로 둔다. */
  const [pending, setPending] = useState<{ to: string | null; body: string } | null>(null);
  const latest = useRef({ confirm, backTo });
  latest.current = { confirm, backTo };
  const leaving = useRef(false);

  // 뒤로가기로 이 방에서 물러난다: 앱 안에 앞 화면이 있으면 그리로, 이 방으로 바로 들어왔으면 방 목록으로.
  const goBack = () => {
    leaving.current = true;
    if ((window.history.state?.idx ?? 0) > 0) window.history.back();
    else navigate(latest.current.backTo, { replace: true });
  };
  // 같은 주소로 한 칸 쌓아 두고, 뒤로가기가 그 칸을 넘어 물러날 때 묻는다(라우터의 idx 는 그대로 들고 간다).
  const mark = () => window.history.pushState({ ...window.history.state, leaveGuard: true }, "");

  useEffect(() => {
    // 링크는 캡처 단계에서 먼저 잡는다 — 기본 이동도, 라우터 Link 의 이동도(defaultPrevented 면 안 옮긴다) 막힌다.
    const onClick = (event: MouseEvent) => {
      const body = latest.current.confirm;
      if (!body || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.origin !== window.location.origin) return;
      if (link.pathname + link.search === window.location.pathname + window.location.search) return;
      event.preventDefault();
      setPending({ to: link.pathname + link.search + link.hash, body });
    };
    // 채팅이 위에 쌓은 칸이 빠질 때는 이 칸에 머문다(state 에 표시가 있다) — 모른 척한다.
    const onPop = () => {
      if (leaving.current || window.history.state?.leaveGuard) return;
      const body = latest.current.confirm;
      if (body) setPending({ to: null, body });
      else goBack();
    };
    // 이미 쌓아 둔 칸 위라면(다른 화면에 갔다가 뒤로가기로 돌아왔다) 그 칸을 그대로 쓴다. 떠날 때 칸을 치우지
    // 않는 것도 같은 이유 — 치우는 history.back() 은 늦게 돌아서, 다시 붙는 컴포넌트(StrictMode)가 받은
    // popstate 를 "뒤로가기"로 읽고 방을 나가 버린다.
    if (!window.history.state?.leaveGuard) mark();
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 한 번만 쌓고, 최신 값은 latest 로 읽는다.
  }, []);

  return (
    <ConfirmDialog
      open={pending !== null}
      title="판을 두고 나갈까요?"
      body={pending?.body ?? ""}
      confirmLabel="나가기"
      cancelLabel="계속 하기"
      onConfirm={() => {
        const to = pending?.to ?? null;
        setPending(null);
        onLeave();
        if (to === null) goBack();
        else navigate(to);
      }}
      onCancel={() => {
        // 뒤로가기로 물었으면 쌓아 둔 칸이 이미 빠졌다 — 다시 쌓는다.
        if (pending?.to === null) mark();
        setPending(null);
      }}
    />
  );
}

/** "⋯" 메뉴. 넓은 화면에선 CSS 가 겉껍데기를 없애 안의 도구가 줄에 그대로 선다. 밖을 누르면 닫힌다. */
function MoreTools({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div className={`pvp-more ${open ? "is-open" : ""}`} ref={ref}>
      <button type="button" className="pvp-tool pvp-more-toggle" aria-expanded={open} aria-label="도구 더 보기" onClick={() => setOpen((value) => !value)}>⋯</button>
      <div className="pvp-more-menu">{children}</div>
    </div>
  );
}

/**
 * "자리 비우기". 진행 중인 판이 있으면 판 안의 확인 창으로 한 번 묻는다(`confirm` 문구가 있을 때).
 */
export function LeaveSeatButton({ confirm, title, onLeave }: { confirm: string | null; title?: string; onLeave: () => void }) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button type="button" className="pvp-tool" title={title} onClick={() => (confirm ? setAsking(true) : onLeave())}>자리 비우기</button>
      {confirm && (
        <ConfirmDialog
          open={asking}
          title="자리를 비울까요?"
          body={confirm}
          confirmLabel="자리 비우기"
          cancelLabel="계속 두기"
          onConfirm={() => { setAsking(false); onLeave(); }}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  );
}

/** 관전자에게 보이는 앉기 안내 — 내 줄과 독이 차지할 띠에 뜬다. */
export function SpectatorPrompt({ children }: { children: ReactNode }) {
  return <div className="felt-prompt">빈 자리를 눌러 앉으세요<small>{children}</small></div>;
}

/** 대기 중 독: 준비 인원 · 준비 버튼 · 시작 조건. */
export function ReadyRow({ readyCount, seatedCount, ready, onToggle, extra, children }: { readyCount: number; seatedCount: number; ready: boolean; onToggle: (next: boolean) => void; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="pvp-dock-ready">
      <span>{readyCount}/{seatedCount}명 준비 완료</span>
      <button type="button" className={`outline-button ${ready ? "bj-act-surrender" : "bj-act-hit"}`} onClick={() => onToggle(!ready)} aria-pressed={ready}>
        {ready ? "준비 취소" : "준비 완료"}
      </button>
      {extra}
      <small>{children}</small>
    </div>
  );
}

/** 내 차례가 온 순간 판 위에 한 번 크게 외친다. */
export function TurnShout({ hint, title = "내 차례" }: { hint?: ReactNode; title?: string }) {
  return (
    <div className="pvp-turn-shout" role="status" aria-live="assertive">
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
    </div>
  );
}

/**
 * 독 머리줄 + 윗변 시간 막대. 머리줄의 문장은 차례가 올 때 읽어 주는 라이브 영역이지만, 초는 그
 * 밖에 둔다 — 예전엔 초까지 영역 안에 있어서 스크린리더가 매초 "14, 13, 12…"를 읽었다.
 */
export function DockHead({ title, hint, meta, totalSeconds }: { title: string; hint: ReactNode; meta?: ReactNode; totalSeconds: number }) {
  return (
    <>
      <div className="pvp-dock-head">
        <div className="pvp-dock-live" role="status" aria-live="polite">
          <strong>{title}</strong>
          {hint}
          {meta && <em>{meta}</em>}
        </div>
        <DockClock />
      </div>
      <DockBar totalSeconds={totalSeconds} />
    </>
  );
}

export interface DockResultRow { key: string | number; name: string; label: ReactNode; amount: ReactNode; detail?: ReactNode; win: boolean; mine: boolean; rake?: boolean }

/** 판 결과 목록(독 오른쪽). */
export function DockResults({ rows, ariaLabel }: { rows: readonly DockResultRow[]; ariaLabel: string }) {
  return (
    <ul className="pvp-dock-results" aria-label={ariaLabel}>
      {rows.map((row) => (
        <li key={row.key} className={[row.win && "is-win", row.mine && "is-mine", row.rake && "is-rake"].filter(Boolean).join(" ")}>
          <span title={row.name}>{row.name}</span>
          {row.label !== null && <b>{row.label}</b>}
          <em>{row.amount}</em>
          {row.detail && <small>{row.detail}</small>}
        </li>
      ))}
    </ul>
  );
}

/** 내 차례가 아닐 때의 독: 내 결과 배너(또는 진행 문장) + 오른쪽 목록/메타. */
export function DockStatus({ notice, status, aside }: { notice: RoundResultNoticeData | null; status: ReactNode; aside: ReactNode }) {
  return (
    <div className="pvp-dock-status">
      {/* 내 손익 배너는 독의 이 자리에 — 판 위에 띄우면 상대 자리나 판정과 겹쳤다. */}
      {notice ? <RoundResultNotice notice={notice} /> : <p>{status}</p>}
      {aside}
    </div>
  );
}
