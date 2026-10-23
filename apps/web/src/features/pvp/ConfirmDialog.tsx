import { useEffect, useId, useRef } from "react";

/**
 * 판 안에서 뜨는 확인 창. `window.confirm` 을 대신한다.
 *
 * 브라우저 확인 창은 (1) 전체화면을 강제로 풀고, (2) 뜨는 동안 자바스크립트를 멈춰 소켓 스냅샷과
 * 타이머가 쌓였다가 한꺼번에 쏟아지며, (3) 폰에서는 주소창 도메인까지 찍힌 낯선 모양이라 "사이트가
 * 뭘 묻나" 하고 놀라게 했다. 네이티브 <dialog> 의 showModal 은 최상위 레이어에 떠서 전체화면
 * 요소 위에도 보이고, 포커스를 창 안에 가두고, Esc 로 닫힌다 — 필요한 건 다 브라우저가 해 준다.
 */
export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel = "취소", tone = "danger", onConfirm, onCancel }: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "neutral";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      try { dialog.showModal(); } catch { dialog.setAttribute("open", ""); }
    } else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`pvp-confirm tone-${tone}`}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      // Esc 로 닫히면 브라우저가 cancel 을 먼저 보낸다 — 우리 상태도 같이 닫는다.
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <div className="pvp-confirm-card">
        <strong id={titleId}>{title}</strong>
        <p id={bodyId}>{body}</p>
        <div className="pvp-confirm-actions">
          {/* 기본 포커스는 "취소" 쪽 — 실수로 Enter 를 눌러도 핸드를 버리지 않게. */}
          <button type="button" className="pvp-confirm-cancel" onClick={onCancel} autoFocus>{cancelLabel}</button>
          <button type="button" className="pvp-confirm-ok" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </dialog>
  );
}
