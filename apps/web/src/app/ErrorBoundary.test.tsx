import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, Link } from "react-router-dom";
import { ErrorBoundary, isChunkLoadError, reloadOnceForChunkError, RouteBoundary } from "./ErrorBoundary";

function Bomb({ error }: { error: Error }): never {
  throw error;
}

/** 고장 난 동안에만 던지는 화면 — 고친 뒤 "다시 시도"가 정말 다시 그리는지 본다. */
const flaky = { broken: true };
function Flaky() {
  if (flaky.broken) throw new Error("일시적인 오류");
  return <p>다시 그려졌습니다</p>;
}

describe("ErrorBoundary", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // React 는 잡힌 에러도 콘솔에 찍는다. 테스트 출력만 조용히.
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    flaky.broken = true;
  });
  afterEach(() => consoleError.mockRestore());

  it("shows the Korean fallback panel with retry and lobby actions instead of a blank screen", () => {
    render(
      <MemoryRouter>
        <RouteBoundary><Bomb error={new Error("boom")} /></RouteBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "문제가 생겼습니다" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "로비로" })).toHaveAttribute("href", "/lobby");
  });

  it("re-renders the children when 다시 시도 is pressed", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RouteBoundary><Flaky /></RouteBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "문제가 생겼습니다" })).toBeInTheDocument();
    flaky.broken = false;
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(screen.getByText("다시 그려졌습니다")).toBeInTheDocument();
  });

  it("resets when the route changes (the lobby link actually shows the lobby)", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/rooms/x"]}>
        <Routes>
          <Route path="/rooms/x" element={<RouteBoundary><Bomb error={new Error("boom")} /></RouteBoundary>} />
          <Route path="/lobby" element={<RouteBoundary><p>로비 화면</p></RouteBoundary>} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("link", { name: "로비로" }));
    expect(screen.getByText("로비 화면")).toBeInTheDocument();
  });

  it("keeps the rest of the page alive when one section throws", () => {
    render(
      <MemoryRouter>
        <header>헤더 <Link to="/lobby">로비</Link></header>
        <ErrorBoundary><Bomb error={new Error("boom")} /></ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText(/헤더/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "문제가 생겼습니다" })).toBeInTheDocument();
  });

  it("offers a reload for a stale-chunk failure", () => {
    // 자동 새로고침은 직전에 이미 한 것으로 표시해서 막는다(패널이 보여야 하는 경우).
    sessionStorage.setItem("opencasino.chunkReloadAt", String(Date.now()));
    render(
      <MemoryRouter>
        <RouteBoundary><Bomb error={new TypeError("Failed to fetch dynamically imported module: /assets/BaccaratRoomPage-abc.js")} /></RouteBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "새로고침" })).toBeInTheDocument();
    expect(screen.getByText(/새 버전이 배포되어/)).toBeInTheDocument();
  });
});

describe("chunk-load detection", () => {
  it("recognises the browsers' dynamic import failures", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/a.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
  });

  it("reloads at most once within the guard window", () => {
    const reload = vi.fn();
    expect(reloadOnceForChunkError(reload)).toBe(true);
    expect(reloadOnceForChunkError(reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
