import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { PublicAuthUser } from "@opencasino/contracts";
import { AuthProvider, RedirectIfAuthenticated, RequireAdmin, RequireAuth, RequirePlayer, useAuth, useCurrentUser } from "./auth";

const PLAYER: PublicAuthUser = { id: "u1", username: "player", nickname: "플레이어", role: "user" } as PublicAuthUser;
const ADMIN: PublicAuthUser = { id: "a1", username: "boss", nickname: "관리자", role: "admin" } as PublicAuthUser;

function signIn(user: PublicAuthUser) {
  sessionStorage.setItem("opencasino.accessToken", `token-${user.id}`);
  sessionStorage.setItem("opencasino.user", JSON.stringify(user));
}

function Where() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
  return <p data-testid="where">{location.pathname}{from ? ` from ${from}` : ""}</p>;
}

function LoginButton() {
  const { login } = useAuth();
  return <button type="button" onClick={() => login("fresh-token", PLAYER)}>로그인</button>;
}

function Me() {
  const user = useCurrentUser();
  return <p>나: {user?.nickname ?? "없음"}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route element={<RedirectIfAuthenticated />}>
            <Route path="/login" element={<><Where /><LoginButton /></>} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route path="/lobby" element={<><Where /><Me /></>} />
            <Route path="/wallet" element={<Where />} />
          </Route>
          <Route path="/support" element={<RequirePlayer><Where /></RequirePlayer>} />
          <Route path="/admin/support" element={<RequireAdmin><Where /></RequireAdmin>} />
          <Route path="/admin" element={<RequireAdmin><Where /></RequireAdmin>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("route guards", () => {
  beforeEach(() => {
    // 로그인 안 된 상태로 시작하면 AuthProvider 가 갱신 쿠키로 세션 복구를 한 번 시도한다 — 401 로 흉내 낸다.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "로그인이 필요합니다." }), { status: 401 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("RequireAuth sends a signed-out visitor to /login and remembers where they were going", async () => {
    renderAt("/wallet");
    expect(await screen.findByTestId("where")).toHaveTextContent("/login from /wallet");
  });

  it("returns to the original page after logging in", async () => {
    const user = userEvent.setup();
    renderAt("/wallet");
    await user.click(await screen.findByRole("button", { name: "로그인" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/wallet");
  });

  it("lets a signed-in user through and provides the user via context", async () => {
    signIn(PLAYER);
    renderAt("/lobby");
    expect(screen.getByTestId("where")).toHaveTextContent("/lobby");
    expect(screen.getByText("나: 플레이어")).toBeInTheDocument();
  });

  it("sends a signed-in user away from /login", () => {
    signIn(PLAYER);
    renderAt("/login");
    expect(screen.getByTestId("where")).toHaveTextContent("/lobby");
  });

  it("RequireAdmin sends players back to the lobby", () => {
    signIn(PLAYER);
    renderAt("/admin");
    expect(screen.getByTestId("where")).toHaveTextContent("/lobby");
  });

  it("RequireAdmin lets admins in", () => {
    signIn(ADMIN);
    renderAt("/admin");
    expect(screen.getByTestId("where")).toHaveTextContent("/admin");
  });

  it("RequirePlayer sends admins to the admin inbox", () => {
    signIn(ADMIN);
    renderAt("/support");
    expect(screen.getByTestId("where")).toHaveTextContent("/admin/support");
  });
});
