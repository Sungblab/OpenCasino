// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changePassword, getProfile, onAccessTokenRefreshed, rememberAccessToken, SESSION_EXPIRED_EVENT } from "./api";

const USER = { id: "8f0e7a7e-2f7b-4f55-9d0a-3b8d3c1f6a11", username: "qauser", nickname: "큐에이", role: "user" as const };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function authHeader(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.Authorization;
}

/** 프로필 응답 — profileResponseSchema 를 통과하는 최소 모양은 테스트마다 만들 필요가 없어서 가로챈다. */
const PROFILE_PATH = "/api/v1/profile";

describe("request: 401 → silent refresh → retry once", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let expired: Array<{ refreshFailed: boolean } | undefined>;
  const onExpired = (event: Event) => expired.push((event as CustomEvent<{ refreshFailed: boolean }>).detail);

  beforeEach(() => {
    expired = [];
    rememberAccessToken(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
  });
  afterEach(() => {
    window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    vi.unstubAllGlobals();
  });

  it("refreshes and retries the original request with the new token", async () => {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/v1/auth/refresh")) return json(200, { token: "new-token", user: USER });
      if (url.endsWith("/api/v1/profile/password")) {
        return authHeader(init) === "Bearer new-token" ? json(200, { ok: true }) : json(401, { message: "로그인이 만료되었습니다." });
      }
      return json(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const refreshed: string[] = [];
    const unsubscribe = onAccessTokenRefreshed((result) => refreshed.push(result.token));

    await expect(changePassword("old-token", "a", "b")).resolves.toBeUndefined();

    const calls = fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${String(url)} ${authHeader(init as RequestInit) ?? "-"}`);
    expect(calls).toEqual([
      "POST /api/v1/profile/password Bearer old-token",
      "POST /api/v1/auth/refresh -",
      "POST /api/v1/profile/password Bearer new-token",
    ]);
    // 재시도는 원래 본문을 그대로 다시 보낸다.
    expect((fetchMock.mock.calls[2]![1] as RequestInit).body).toBe(JSON.stringify({ currentPassword: "a", newPassword: "b" }));
    expect(refreshed).toEqual(["new-token"]);
    expect(expired).toEqual([]);
    unsubscribe();
  });

  it("shares one refresh between concurrent 401s", async () => {
    let refreshCalls = 0;
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/v1/auth/refresh")) {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return json(200, { token: "new-token", user: USER });
      }
      return authHeader(init) === "Bearer new-token" ? json(200, { ok: true }) : json(401, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([changePassword("old", "a", "b"), changePassword("old", "c", "d"), changePassword("old", "e", "f")]);
    expect(refreshCalls).toBe(1);
  });

  it("does not refresh again when another request already rotated the token", async () => {
    rememberAccessToken("newer-token");
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/v1/auth/refresh")) throw new Error("should not refresh");
      return authHeader(init) === "Bearer newer-token" ? json(200, { ok: true }) : json(401, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(changePassword("stale-token", "a", "b")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries only once: a second 401 after a good refresh is the request's own error, not a logout", async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/v1/auth/refresh")) return json(200, { token: "new-token", user: USER });
      return json(401, { message: "현재 비밀번호가 올바르지 않습니다." });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(changePassword("old", "wrong", "next")).rejects.toThrow("현재 비밀번호가 올바르지 않습니다.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(expired).toEqual([]);
  });

  it("signals session expiry (refreshFailed) and surfaces the original error when the refresh fails", async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/v1/auth/refresh")) return json(401, { message: "세션이 만료되었습니다. 다시 로그인해주세요." });
      return json(401, { message: "로그인이 만료되었습니다." });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(getProfile("old")).rejects.toThrow("로그인이 만료되었습니다.");
    expect(expired).toEqual([{ refreshFailed: true }]);
    // 갱신 요청 자체의 401 로는 다시 갱신하지 않는다(루프 없음): 원래 요청 1 + 갱신 1.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]![0])).toContain(PROFILE_PATH);
  });

  it("never retries requests made without a token (login failures stay login failures)", async () => {
    const { login } = await import("./api");
    fetchMock = vi.fn(async () => json(401, { message: "아이디 또는 비밀번호가 올바르지 않습니다." }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(login("qauser", "nope")).rejects.toThrow("아이디 또는 비밀번호가 올바르지 않습니다.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(expired).toEqual([]);
  });
});
