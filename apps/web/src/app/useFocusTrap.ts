import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=\"hidden\"])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

/** root 안에서 Tab 으로 갈 수 있는 요소들(문서 순서). */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  // tabIndex=-1 은 스크립트로만 포커스하는 요소(로빙 탭의 비활성 탭 등)라 Tab 순서에서 뺀다.
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.tabIndex >= 0 && !element.closest("[inert]") && element.getAttribute("aria-hidden") !== "true",
  );
}

/**
 * 대화상자용 포커스 관리: 열릴 때 안으로 포커스를 넣고, (trap 이면) Tab/Shift+Tab 을 안에서만
 * 돌리고, 닫히면 열기 전 자리로 포커스를 돌려준다.
 *
 * 돌려주기가 빠지면 키보드 사용자는 닫는 순간 포커스가 <body> 로 떨어져 문서 맨 처음부터 다시
 * Tab 을 쳐야 했다 — 도움말을 한 번 열어 본 대가가 게임 바 전체를 다시 지나가는 것이었다.
 *
 * trap 은 도중에 바뀔 수 있다(채팅 패널은 폰에서만 전체화면 = 모달). 바뀐다고 효과를 다시 돌리면
 * 포커스가 한 번 밖으로 나갔다 들어오므로 ref 로 읽는다.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  { initialFocusRef, trap = true, restoreFocus = true }: { initialFocusRef?: RefObject<HTMLElement | null>; trap?: boolean; restoreFocus?: boolean } = {},
): void {
  const trapRef = useRef(trap);
  trapRef.current = trap;
  const initialRef = useRef(initialFocusRef);
  initialRef.current = initialFocusRef;

  useEffect(() => {
    if (!active) return;
    const root = containerRef.current;
    if (!root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initial = initialRef.current?.current ?? focusableWithin(root)[0] ?? root;
    initial.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !trapRef.current) return;
      const items = focusableWithin(root);
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement;
      const outside = !current || !root.contains(current);
      if (event.shiftKey && (current === first || current === root || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // 닫힌 뒤 원래 자리가 아직 문서에 있을 때만 — 그 사이 화면이 바뀌었으면 엉뚱한 곳을 잡지 않는다.
      if (restoreFocus && previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active, containerRef, restoreFocus]);
}
