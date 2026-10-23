import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { enqueueToast, MAX_VISIBLE, ToastProvider, useToast, type ToastApi, type ToastRecord } from "./toast";

function record(id: string, extra: Partial<ToastRecord> = {}): ToastRecord {
  return { id, variant: "info", message: id, placement: "top", duration: 5_000, version: 0, ...extra };
}

describe("enqueueToast (queue rules)", () => {
  it("appends in order", () => {
    const queue = enqueueToast(enqueueToast([], record("a")), record("b"));
    expect(queue.map((toast) => toast.id)).toEqual(["a", "b"]);
  });

  it("replaces a toast with the same id instead of stacking it, bumping its version", () => {
    const first = enqueueToast([], record("a", { message: "처음" }));
    const next = enqueueToast(first, record("a", { message: "다시" }));
    expect(next).toHaveLength(1);
    expect(next[0]!.message).toBe("다시");
    expect(next[0]!.version).toBe(1);
  });

  it("drops the oldest once a placement exceeds the visible maximum", () => {
    let queue: ToastRecord[] = [];
    for (let index = 0; index < MAX_VISIBLE + 2; index += 1) queue = enqueueToast(queue, record(`t${index}`));
    expect(queue).toHaveLength(MAX_VISIBLE);
    expect(queue[0]!.id).toBe("t2");
  });

  it("counts each placement separately", () => {
    let queue: ToastRecord[] = [];
    for (let index = 0; index < MAX_VISIBLE; index += 1) queue = enqueueToast(queue, record(`top${index}`));
    queue = enqueueToast(queue, record("chat", { placement: "corner" }));
    expect(queue).toHaveLength(MAX_VISIBLE + 1);
  });

  it("applies a per-group limit (a burst of chat never walls off the table)", () => {
    let queue: ToastRecord[] = [record("notice")];
    for (let index = 0; index < 5; index += 1) queue = enqueueToast(queue, record(`c${index}`, { group: "room", placement: "corner" }), 3);
    expect(queue.map((toast) => toast.id)).toEqual(["notice", "c2", "c3", "c4"]);
  });
});

describe("ToastProvider", () => {
  let api: ToastApi;
  function Capture() {
    api = useToast();
    return null;
  }
  const renderProvider = () => render(<MemoryRouter><ToastProvider><Capture /></ToastProvider></MemoryRouter>);

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders into a polite live region that exists before any toast arrives", () => {
    renderProvider();
    const region = screen.getByLabelText("알림");
    expect(region).toHaveAttribute("aria-live", "polite");
    act(() => { api.success("송금했습니다."); });
    expect(within(region).getByRole("status")).toHaveTextContent("송금했습니다.");
  });

  it("announces errors and announcements assertively", () => {
    renderProvider();
    act(() => { api.error("잔액이 부족합니다."); });
    expect(screen.getByRole("alert")).toHaveTextContent("잔액이 부족합니다.");
    act(() => { api.show({ variant: "announcement", message: "점검 예정" }); });
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getByText("공지")).toBeInTheDocument();
  });

  it("auto-dismisses after its duration", () => {
    renderProvider();
    act(() => { api.show({ message: "잠깐", duration: 1_000 }); });
    expect(screen.getByText("잠깐")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(999); });
    expect(screen.getByText("잠깐")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2); });
    expect(screen.queryByText("잠깐")).not.toBeInTheDocument();
  });

  it("pauses the countdown while hovered", () => {
    renderProvider();
    act(() => { api.show({ message: "읽는 중", duration: 1_000 }); });
    fireEvent.mouseEnter(screen.getByText("읽는 중").closest(".toast")!);
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(screen.getByText("읽는 중")).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByText("읽는 중").closest(".toast")!);
    act(() => { vi.advanceTimersByTime(1_001); });
    expect(screen.queryByText("읽는 중")).not.toBeInTheDocument();
  });

  it("stays until dismissed when duration is null, and the close button dismisses", () => {
    renderProvider();
    act(() => { api.show({ message: "남아 있음", duration: null }); });
    act(() => { vi.advanceTimersByTime(60_000); });
    fireEvent.click(screen.getByRole("button", { name: "알림 닫기" }));
    expect(screen.queryByText("남아 있음")).not.toBeInTheDocument();
  });

  it("renders a link action and dismisses a whole group at once", () => {
    renderProvider();
    act(() => {
      api.show({ message: "새 충전 신청", action: { label: "바로 보기", href: "/admin/cash" } });
      api.show({ message: "채팅1", placement: "corner", group: "room:1" });
      api.show({ message: "채팅2", placement: "corner", group: "room:1" });
    });
    expect(screen.getByRole("link", { name: "바로 보기" })).toHaveAttribute("href", "/admin/cash");
    act(() => { api.dismissGroup("room:1"); });
    expect(screen.queryByText("채팅1")).not.toBeInTheDocument();
    expect(screen.queryByText("채팅2")).not.toBeInTheDocument();
    expect(screen.getByText("새 충전 신청")).toBeInTheDocument();
  });

  it("does nothing (and does not throw) outside a provider", () => {
    render(<Capture />);
    expect(() => api.success("무시됨")).not.toThrow();
  });
});
