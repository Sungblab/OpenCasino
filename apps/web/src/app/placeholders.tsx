import type { ReactNode } from "react";

/**
 * 데이터를 기다리는 동안의 자리. 예전 지갑·프로필·게임 기록은 헤더까지 통째로 "불러오는 중…"
 * 한 줄로 바꿔 그렸다 — 이미 알고 있는 틀(헤더, 제목, 통계 칸)까지 사라졌다 나타나서 화면이
 * 매번 깜빡이고, 느린 망에서는 앱이 멈춘 것처럼 보였다. 틀은 그대로 두고 숫자 자리만 비워 둔다.
 */
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />;
}

/** 통계 타일 줄(지갑·게임 기록·프로필 상단) 모양의 자리. */
export function SkeletonStats({ count = 4, label }: { count?: number; label: string }) {
  return (
    <section className="wallet-summary skeleton-stats" aria-busy="true" aria-label={label}>
      {Array.from({ length: count }, (_, index) => (
        <div className="wallet-stat" key={index}>
          <SkeletonBlock className="skeleton-line is-short" />
          <SkeletonBlock className="skeleton-line is-strong" />
        </div>
      ))}
    </section>
  );
}

/** 패널 하나(제목 + 줄 몇 개) 모양의 자리. */
export function SkeletonPanel({ rows = 4 }: { rows?: number }) {
  return (
    <section className="profile-panel skeleton-panel" aria-hidden="true">
      <SkeletonBlock className="skeleton-line is-heading" />
      {Array.from({ length: rows }, (_, index) => <SkeletonBlock key={index} className="skeleton-line" />)}
    </section>
  );
}

/**
 * 비어 있을 때의 안내 + 다음에 할 일. "기록이 없습니다" 한 줄로 끝나면 사용자는 그 화면에서 할 수
 * 있는 게 없다. 비어 있는 이유와 바로 채우러 갈 버튼을 같이 준다.
 */
export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <strong className="empty-state-title">{title}</strong>
      {description && <p className="empty-state-text">{description}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

/** 불러오기 실패. 전체 화면을 바꾸지 않고 그 자리에서 다시 시도할 수 있게. */
export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty-state is-error" role="alert">
      <strong className="empty-state-title">불러오지 못했습니다</strong>
      <p className="empty-state-text">{message}</p>
      {onRetry && <div className="empty-state-action"><button type="button" className="app-secondary-button" onClick={onRetry}>다시 시도</button></div>}
    </div>
  );
}
