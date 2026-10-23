import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

/**
 * 렌더 중 던져진 에러를 잡아 "문제가 생겼습니다" 패널로 바꾼다.
 *
 * 이게 없으면 게임방 하나가 스냅샷을 잘못 읽고 던지는 순간 React 가 트리 전체를 내리고 흰 화면만
 * 남았다 — 사용자는 뒤로가기도, 로비로 가는 링크도 없이 새로고침만 할 수 있었다. 라우트마다
 * 하나씩 두르므로 한 화면이 죽어도 헤더·토스트·소켓은 살아 있다.
 */

const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk [\w-]+ failed/i;
const RELOAD_MARK = "opencasino.chunkReloadAt";
/** 이 안에 이미 한 번 새로고침했다면 또 하지 않는다 — 서버가 정말 파일을 못 주는 상황에서 무한 새로고침 방지. */
const RELOAD_WINDOW_MS = 30_000;

/**
 * 배포 직후 흔한 실패: 열어 둔 탭은 옛 빌드의 청크 이름(해시)을 기억하고 있는데 서버에는 새
 * 빌드만 있다. 그러면 게임방으로 들어가는 lazy import 가 404 로 실패한다. 다시 시도해도 같은 옛
 * 이름을 부르므로 소용없고, 새로고침으로 새 index.html 을 받아야만 풀린다.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return CHUNK_ERROR.test(message);
}

/** 최근에 같은 이유로 새로고침한 적이 없을 때만 새로고침한다. 안 했으면 false. */
export function reloadOnceForChunkError(reload: () => void = () => window.location.reload()): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_MARK) ?? 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_MARK, String(Date.now()));
  } catch {
    // 저장소를 못 쓰면 반복 여부를 알 수 없으니 자동 새로고침은 하지 않는다. 버튼은 남는다.
    return false;
  }
  reload();
  return true;
}

/**
 * Vite 는 미리 받아 두려던 청크가 실패하면 window 에 vite:preloadError 를 쏜다. 렌더까지 가기 전에
 * 여기서 한 번 새로고침해 버리면 사용자는 에러 패널조차 보지 않는다.
 */
export function installChunkReloadGuard(): void {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadOnceForChunkError()) event.preventDefault();
  });
}

type FallbackRender = (props: { error: Error; reset: () => void; chunk: boolean }) => ReactNode;

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 이 값이 바뀌면 에러 상태를 풀고 다시 그린다(보통 경로). 다른 화면으로 가면 패널이 따라오지 않게. */
  resetKey?: unknown;
  fallback?: FallbackRender;
}

interface ErrorBoundaryState {
  error: Error | null;
  resetKey: unknown;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState): Partial<ErrorBoundaryState> | null {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 배포 직후 옛 청크를 부른 경우는 한 번 새로고침하면 그대로 풀린다. 패널은 그게 안 됐을 때만 본다.
    if (isChunkLoadError(error)) {
      reloadOnceForChunkError();
      return;
    }
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkLoadError(error);
    const render = this.props.fallback ?? ((props) => <ErrorPanel {...props} />);
    return render({ error, reset: this.reset, chunk });
  }
}

/**
 * 라우트 안에서 쓰는 기본 패널. "다시 시도"는 청크 실패면 새로고침(같은 lazy import 는 같은
 * 실패를 캐시하고 있어 다시 그려도 소용없다), 그 밖이면 그 화면만 다시 그린다.
 */
export function ErrorPanel({ reset, chunk, homeHref = "/lobby", useRouterLink = true, inline = false, homeLabel = "로비로" }: { reset: () => void; chunk: boolean; homeHref?: string; useRouterLink?: boolean; inline?: boolean; homeLabel?: string }) {
  const retry = () => {
    if (chunk) window.location.reload();
    else reset();
  };
  // 관리자 화면처럼 이미 <main> 안에 있는 자리면 <div> 로, 화면 전체를 대신할 때만 <main> 으로.
  const Wrapper = inline ? "div" : "main";
  return (
    <Wrapper className={`app-error${inline ? " is-inline" : ""}`} role="alert">
      <div className="app-error-card">
        <h1>문제가 생겼습니다</h1>
        <p>
          {chunk
            ? "새 버전이 배포되어 화면을 불러오지 못했습니다. 새로고침하면 바로 이어집니다."
            : "화면을 그리는 중 오류가 났습니다. 다시 시도해도 같으면 다른 화면으로 옮겨 주세요."}
        </p>
        <div className="app-error-actions">
          <button type="button" className="gold-button" onClick={retry}>{chunk ? "새로고침" : "다시 시도"}</button>
          {useRouterLink
            ? <Link className="app-error-home" to={homeHref}>{homeLabel}</Link>
            : <a className="app-error-home" href={homeHref}>{homeLabel}</a>}
        </div>
      </div>
    </Wrapper>
  );
}

/** lazy 화면을 기다리는 동안의 자리. 안쪽 자리(inline)면 레이아웃을 밀어내지 않는 한 줄만. */
export function RouteLoading({ inline = false, label = "불러오는 중…" }: { inline?: boolean; label?: string }) {
  const content = <p className="route-loading"><span className="route-loading-dot" aria-hidden="true" />{label}</p>;
  if (inline) return <div className="route-loading-inline" aria-busy="true">{content}</div>;
  return <main className="loading-screen" aria-busy="true">{content}</main>;
}

/**
 * lazy 라우트 하나를 두르는 경계: 에러 경계 + Suspense. 경로가 바뀌면 에러 상태를 푼다 —
 * 그래야 패널의 "로비로"를 눌렀을 때 로비가 제대로 그려진다.
 */
export function RouteBoundary({ children, inline = false, fallback }: { children: ReactNode; inline?: boolean; fallback?: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname} fallback={(props) => <ErrorPanel {...props} inline={inline} homeHref={inline ? "/admin" : "/lobby"} homeLabel={inline ? "관리 홈으로" : "로비로"} />}>
      <Suspense fallback={fallback ?? <RouteLoading inline={inline} />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

/**
 * 앱 맨 바깥 경계. 라우터 바깥이라 Link 를 쓸 수 없어서 평범한 링크로 로비에 보낸다(전체 새로 불러오기).
 */
export function RootErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary fallback={({ reset, chunk }) => <ErrorPanel reset={reset} chunk={chunk} useRouterLink={false} />}>
      {children}
    </ErrorBoundary>
  );
}
