import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, Outlet, useLocation, type Location } from "react-router-dom";
import type { PublicAuthUser } from "@opencasino/contracts";
import { logoutServer, onAccessTokenRefreshed, refreshAccessToken, rememberAccessToken, SESSION_EXPIRED_EVENT, type SessionExpiredDetail } from "../api";

/**
 * 조용한 갱신 주기. 액세스 토큰 수명은 서버(auth.ts)가 정하고 바뀔 수 있으므로 여기에 숫자로
 * 박아 두지 않는다 — 대신 이 값이 그 수명의 절반을 넘지 않게만 지킨다. 여섯 시간이면 오래 켜 둔
 * 탭도 토큰이 늘 살아 있고, 예전 20분 타이머처럼 쉴 새 없이 두드리지도 않는다. 서버 수명이 12시간
 * 아래로 내려가면 이 값도 같이 줄여야 한다. 그 사이에 탭이 잠들어 타이머를 놓쳐도(모바일 브라우저는
 * 백그라운드 타이머를 멈춘다) api.ts 가 401 을 받은 순간 한 번 갱신하고 다시 보내므로 괜찮다.
 */
export const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000;

const TOKEN_KEY = "opencasino.accessToken";
const USER_KEY = "opencasino.user";

function readUser(): PublicAuthUser | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as PublicAuthUser) : null;
  } catch {
    return null;
  }
}

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * 갱신이 네트워크 오류(fetch 자체가 TypeError 로 실패)로 끝났다면 세션이 끝난 게 아니다 —
 * 서버가 재시작 중이거나 폰이 잠깐 끊긴 것이다. 그걸 로그아웃으로 받으면 서버 쪽 갱신 체인까지
 * 끊어 버려서, 망이 돌아와도 다시 로그인해야 했다.
 */
function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

export interface AuthValue {
  token: string | null;
  user: PublicAuthUser | null;
  isAdmin: boolean;
  /** 새로고침 직후 갱신 쿠키로 세션을 되살리는 중이면 false. 그동안 라우트를 판단하면 로그인 화면으로 튄다. */
  ready: boolean;
  login: (token: string, user: PublicAuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * 로그인 상태의 단일 출처. 예전에는 App 이 토큰을 들고 있고, AppShell·ProfileMenu·RoomChat·
 * 관리자 화면이 각자 sessionStorage 의 "opencasino.user" 를 다시 파싱해 역할과 id 를 알아냈다 —
 * 같은 값을 다섯 군데서 읽으니 한쪽만 갱신되는 순간(권한 변경 직후 등)이 생겼다.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState(() => ({ token: readToken(), user: readUser() }));
  const [ready, setReady] = useState(() => Boolean(session.token));

  const login = useCallback((token: string, user: PublicAuthUser) => {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      // 저장소를 못 쓰는 브라우저(사생활 보호 모드 등)에서도 이 탭 안에서는 로그인 상태가 유지된다.
    }
    setSession({ token, user });
    setReady(true);
  }, []);

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
    } catch {
      // 위와 같은 이유로 무시한다.
    }
    setSession({ token: null, user: null });
    setReady(true);
    rememberAccessToken(null);
    void logoutServer();
  }, []);

  // api 계층이 어디서 갱신했든(401 재시도, 타이머, 복구) 새 토큰을 React 상태와 저장소에 맞춘다.
  useEffect(() => onAccessTokenRefreshed((result) => login(result.token, result.user)), [login]);

  useEffect(() => {
    rememberAccessToken(session.token);
  }, [session.token]);

  useEffect(() => {
    // 세션 만료 신호. api.ts 는 이미 갱신을 해 보고 실패했을 때만(refreshFailed) 보내므로 그때는
    // 바로 로그아웃한다. 소켓의 UNAUTHORIZED 는 갱신을 거치지 않고 오므로 여기서 한 번 갱신해 보고,
    // 그것마저 실패해야 로그아웃한다 — 곧장 로그아웃하면(서버의 갱신 체인까지 끊는다) 흔한
    // 토큰 만료가 강제 재로그인이 되어 버린다.
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<SessionExpiredDetail | undefined>).detail;
      if (detail?.refreshFailed) {
        logout();
        return;
      }
      refreshAccessToken().catch((error: unknown) => {
        if (!isNetworkFailure(error)) logout();
      });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handle);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handle);
  }, [logout]);

  // 새로고침·브라우저 재시작 뒤 sessionStorage 가 비어 있으면 갱신 쿠키로 세션을 되살린다.
  // 이게 없으면 탭을 새로 열 때마다 로그아웃된 것처럼 보인다. 성공하면 위의 구독이 login 을 부른다.
  useEffect(() => {
    if (ready) return;
    let cancelled = false;
    refreshAccessToken()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ready]);

  useEffect(() => {
    if (!session.token) return;
    const timer = window.setInterval(() => {
      refreshAccessToken().catch((error: unknown) => {
        if (!isNetworkFailure(error)) logout();
      });
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [logout, session.token]);

  const value = useMemo<AuthValue>(() => ({
    token: session.token,
    user: session.user,
    isAdmin: session.user?.role === "admin",
    ready,
    login,
    logout,
  }), [session, ready, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

/**
 * 공용 컴포넌트(AppShell·ProfileMenu·RoomChat…)용. 이 컴포넌트들은 다른 화면의 단위 테스트에서
 * 프로바이더 없이 그려지기도 하므로, 없으면 던지지 않고 "로그인 정보 없음"으로 본다.
 */
export function useCurrentUser(): PublicAuthUser | null {
  return useContext(AuthContext)?.user ?? null;
}

/** useCurrentUser 와 같은 이유로 프로바이더가 없으면 던지지 않고 null(닉네임 배지 같은 공용 조각용). */
export function useAccessToken(): string | null {
  return useContext(AuthContext)?.token ?? null;
}

export type RedirectState = { from?: Location; notice?: string } | null;

/** 로그인이 필요한 라우트. 로그인 뒤 원래 가려던 곳으로 돌려보내려고 위치를 state 로 넘긴다. */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { token } = useAuth();
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: location } satisfies RedirectState} />;
  return <>{children ?? <Outlet />}</>;
}

/** 관리자 전용. 일반 사용자가 주소를 쳐서 들어오면 로비로 돌린다. */
export function RequireAdmin({ children }: { children?: ReactNode }) {
  const { token, isAdmin } = useAuth();
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: location } satisfies RedirectState} />;
  if (!isAdmin) return <Navigate to="/lobby" replace />;
  return <>{children ?? <Outlet />}</>;
}

/** 플레이어 전용(1:1 문의). 관리자는 같은 대화를 관리자 문의 화면에서 받으므로 그리로 보낸다. */
export function RequirePlayer({ children, adminTo = "/admin/support" }: { children?: ReactNode; adminTo?: string }) {
  const { token, isAdmin } = useAuth();
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: location } satisfies RedirectState} />;
  if (isAdmin) return <Navigate to={adminTo} replace />;
  return <>{children ?? <Outlet />}</>;
}

/** 로그인·가입 화면. 이미 로그인했으면 원래 가려던 곳(없으면 로비)으로 보낸다. */
export function RedirectIfAuthenticated({ children }: { children?: ReactNode }) {
  const { token } = useAuth();
  const location = useLocation();
  if (token) {
    const from = (location.state as RedirectState)?.from;
    const target = from && from.pathname !== "/login" && from.pathname !== "/signup" ? `${from.pathname}${from.search}` : "/lobby";
    return <Navigate to={target} replace />;
  }
  return <>{children ?? <Outlet />}</>;
}
