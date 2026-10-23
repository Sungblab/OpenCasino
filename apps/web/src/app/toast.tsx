import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";

/**
 * 앱 전체가 쓰는 토스트 하나.
 *
 * 예전에는 토스트가 세 벌이었다 — 사이트 공지(SiteToast), 관리자 알림(AdminShell), 테이블 채팅
 * (RoomChat). 각자 타이머·닫기 버튼·aria-live 를 따로 구현해서 서로 겹쳐 뜨거나(공지와 관리자
 * 알림이 같은 자리), 하나는 닫기 버튼이 없고 하나는 스크린리더에 안 읽히는 식으로 어긋났다.
 * 이제 큐 하나에 넣고 컴포넌트 하나로 그린다. 자리는 둘뿐이다: 화면 위("top", 기본)와 테이블
 * 채팅 버튼 위("corner") — 채팅 한 줄이 펠트 한가운데를 가리지 않게 하려는 자리 구분이지 다른
 * 구현이 아니다.
 */

export type ToastVariant = "info" | "success" | "error" | "announcement";
export type ToastPlacement = "top" | "corner";

export interface ToastAction {
  label: string;
  /** 앱 안 경로. 있으면 링크로 그린다. */
  href?: string;
  onClick?: () => void;
}

export interface ToastOptions {
  /** 같은 id 로 다시 띄우면 새로 쌓지 않고 그 자리를 갈아 끼운다(타이머도 다시 센다). */
  id?: string;
  variant?: ToastVariant;
  title?: string;
  message: string;
  action?: ToastAction;
  /** ms. null 이면 사용자가 닫을 때까지 남는다. */
  duration?: number | null;
  placement?: ToastPlacement;
  /** 한꺼번에 치우거나(dismissGroup) 개수를 따로 묶을 때 쓰는 이름. 예: 한 방의 채팅. */
  group?: string;
  /** 같은 group 안에서 동시에 보일 최대 개수. 채팅이 몰려도 펠트를 벽처럼 덮지 않게. */
  groupLimit?: number;
  /** 작성자 본인 채팅처럼 강조만 조금 다르게 할 때 붙이는 클래스. */
  className?: string;
}

export interface ToastRecord extends Required<Pick<ToastOptions, "variant" | "message" | "placement">> {
  id: string;
  title?: string;
  action?: ToastAction;
  duration: number | null;
  group?: string;
  className?: string;
  /** 같은 id 로 갈아 끼울 때 타이머를 다시 세게 하는 값. */
  version: number;
}

/** 자리마다 동시에 보이는 최대 개수. 넘치면 가장 오래된 것부터 내린다. */
export const MAX_VISIBLE = 4;

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  info: 5_000,
  success: 4_000,
  // 실패는 읽고 이해할 시간이 더 필요하다 — 무엇이 안 됐는지 놓치면 같은 걸 또 누른다.
  error: 8_000,
  announcement: 8_000,
};

export interface ToastApi {
  show: (options: ToastOptions) => string;
  success: (message: string, options?: Omit<ToastOptions, "message" | "variant">) => string;
  error: (message: string, options?: Omit<ToastOptions, "message" | "variant">) => string;
  info: (message: string, options?: Omit<ToastOptions, "message" | "variant">) => string;
  dismiss: (id: string) => void;
  dismissGroup: (group: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const ToastListContext = createContext<ToastRecord[]>([]);

let nextId = 0;

/** 큐에 하나를 넣는다. 순수 함수라 테스트에서 바로 부를 수 있다. */
export function enqueueToast(current: ToastRecord[], incoming: ToastRecord, groupLimit?: number): ToastRecord[] {
  const existing = current.find((toast) => toast.id === incoming.id);
  let next = existing
    ? current.map((toast) => (toast.id === incoming.id ? { ...incoming, version: existing.version + 1 } : toast))
    : [...current, incoming];
  if (incoming.group && groupLimit && groupLimit > 0) {
    const inGroup = next.filter((toast) => toast.group === incoming.group);
    const overflow = inGroup.length - groupLimit;
    if (overflow > 0) {
      const drop = new Set(inGroup.slice(0, overflow).map((toast) => toast.id));
      next = next.filter((toast) => !drop.has(toast.id));
    }
  }
  const inPlacement = next.filter((toast) => toast.placement === incoming.placement);
  const overflow = inPlacement.length - MAX_VISIBLE;
  if (overflow > 0) {
    const drop = new Set(inPlacement.slice(0, overflow).map((toast) => toast.id));
    next = next.filter((toast) => !drop.has(toast.id));
  }
  return next;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const dismissGroup = useCallback((group: string) => {
    setToasts((current) => current.filter((toast) => toast.group !== group));
  }, []);

  const show = useCallback((options: ToastOptions) => {
    const variant = options.variant ?? "info";
    const id = options.id ?? `toast-${++nextId}`;
    const record: ToastRecord = {
      id,
      variant,
      message: options.message,
      title: options.title,
      action: options.action,
      duration: options.duration === undefined ? DEFAULT_DURATION[variant] : options.duration,
      placement: options.placement ?? "top",
      group: options.group,
      className: options.className,
      version: 0,
    };
    setToasts((current) => enqueueToast(current, record, options.groupLimit));
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({
    show,
    success: (message, options) => show({ ...options, message, variant: "success" }),
    error: (message, options) => show({ ...options, message, variant: "error" }),
    info: (message, options) => show({ ...options, message, variant: "info" }),
    dismiss,
    dismissGroup,
  }), [show, dismiss, dismissGroup]);

  return (
    <ToastContext.Provider value={api}>
      <ToastListContext.Provider value={toasts}>
        {children}
        <ToastViewport toasts={toasts} onDismiss={dismiss} />
      </ToastListContext.Provider>
    </ToastContext.Provider>
  );
}

const NOOP_API: ToastApi = {
  show: () => "",
  success: () => "",
  error: () => "",
  info: () => "",
  dismiss: () => undefined,
  dismissGroup: () => undefined,
};

/**
 * 토스트 API. 프로바이더 밖(다른 화면의 단위 테스트 등)에서는 조용히 아무것도 하지 않는다 —
 * 알림 하나 못 띄운다고 화면 전체가 던지면 안 된다.
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP_API;
}

/** 지금 떠 있는 토스트 목록. 테스트와 디버깅용. */
export function useToastList(): ToastRecord[] {
  return useContext(ToastListContext);
}

const VARIANT_LABEL: Record<ToastVariant, string> = {
  info: "알림",
  success: "완료",
  error: "오류",
  announcement: "공지",
};

/**
 * 자리마다 aria-live 영역을 하나씩 늘 깔아 둔다. 영역이 토스트와 같이 생겼다 사라지면 스크린리더가
 * "바뀐 내용"을 못 알아채서 첫 알림을 읽지 않는다. 실패와 공지는 role="alert" 로 끼어들어 읽힌다.
 */
function ToastViewport({ toasts, onDismiss }: { toasts: ToastRecord[]; onDismiss: (id: string) => void }) {
  const top = toasts.filter((toast) => toast.placement === "top");
  const corner = toasts.filter((toast) => toast.placement === "corner");
  return (
    <>
      <section className="toast-region is-top" aria-live="polite" aria-relevant="additions" aria-label="알림">
        {top.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />)}
      </section>
      <section className="toast-region is-corner" aria-live="polite" aria-relevant="additions" aria-label="테이블 채팅 알림">
        {corner.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />)}
      </section>
    </>
  );
}

export function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration);
  const startedAt = useRef(0);

  // 같은 id 로 갈아 끼웠으면 처음부터 다시 센다.
  useEffect(() => {
    remaining.current = toast.duration;
  }, [toast.version, toast.duration]);

  // 마우스를 올리거나 키보드로 닫기 버튼에 머무는 동안은 멈춘다 — 읽는 중에 사라지면 안 된다.
  useEffect(() => {
    if (paused || remaining.current === null) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      if (remaining.current !== null) remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, toast.id, toast.version, onDismiss]);

  const urgent = toast.variant === "error" || toast.variant === "announcement";
  return (
    <div
      className={`toast is-${toast.variant}${toast.className ? ` ${toast.className}` : ""}`}
      role={urgent ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {toast.variant === "announcement" && <span className="toast-badge">{VARIANT_LABEL.announcement}</span>}
      <div className="toast-body">
        {toast.title && <strong className="toast-title">{toast.title}</strong>}
        <span className="toast-message">{toast.message}</span>
      </div>
      {toast.action && (toast.action.href
        ? <Link className="toast-action" to={toast.action.href} onClick={() => { toast.action?.onClick?.(); onDismiss(toast.id); }}>{toast.action.label}</Link>
        : <button type="button" className="toast-action" onClick={() => { toast.action?.onClick?.(); onDismiss(toast.id); }}>{toast.action.label}</button>)}
      <button type="button" className="toast-close" aria-label="알림 닫기" onClick={() => onDismiss(toast.id)}>
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
