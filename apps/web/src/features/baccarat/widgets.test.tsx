import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RoundHistoryEntry } from "@opencasino/contracts";
import { BeadRoad, BetSplit, MobileWidget, ShoeStats, SidePanel, type WidgetData } from "./widgets";

function entry(result: RoundHistoryEntry["result"], extra: Partial<RoundHistoryEntry> = {}): RoundHistoryEntry {
  return { result, ...extra } as RoundHistoryEntry;
}

const HISTORY: RoundHistoryEntry[] = [
  entry("player"), entry("player", { playerPair: true }), entry("banker"), entry("tie"), entry("banker", { bankerPair: true }), entry("banker"), entry("banker"),
];

function data(overrides: Partial<WidgetData> = {}): WidgetData {
  return {
    history: HISTORY,
    prediction: null,
    onPredict: vi.fn(),
    betTotals: {},
    shoeRemaining: 300,
    ...overrides,
  };
}

describe("BeadRoad", () => {
  it("draws one bead per round with pair markers and an optional preview", () => {
    const { container } = render(<BeadRoad history={HISTORY} prediction="player" />);
    expect(screen.getByRole("img", { name: "구슬판 최근 7판" })).toBeInTheDocument();
    expect(container.querySelectorAll(".bead:not(.is-preview)")).toHaveLength(7);
    expect(container.querySelectorAll(".bead.pp")).toHaveLength(1);
    expect(container.querySelectorAll(".bead.bp")).toHaveLength(1);
    expect(container.querySelector(".bead.is-preview")).toHaveTextContent("P");
  });
});

describe("BetSplit", () => {
  it("shows the player/banker split as percentages", () => {
    render(<BetSplit totals={{ player: { players: 2, amount: 300 }, banker: { players: 1, amount: 100 } }} />);
    expect(screen.getByText(/PLAYER/).closest("span")).toHaveTextContent("75%");
    expect(screen.getByText(/BANKER/).closest("span")).toHaveTextContent("25%");
    expect(screen.queryByText("아직 이번 판 베팅이 없습니다")).not.toBeInTheDocument();
  });

  it("says so when nobody has bet yet", () => {
    render(<BetSplit totals={{}} />);
    expect(screen.getByText("아직 이번 판 베팅이 없습니다")).toBeInTheDocument();
  });
});

describe("ShoeStats", () => {
  it("counts results, pairs and streaks from the road", () => {
    render(<ShoeStats history={HISTORY} shoeRemaining={300} compact={false} />);
    const stats = screen.getByText("PLAYER").closest("dl")!;
    expect(within(stats).getByText("PLAYER").nextElementSibling).toHaveTextContent("2");
    expect(within(stats).getByText("BANKER").nextElementSibling).toHaveTextContent("4");
    expect(within(stats).getByText("PAIR").nextElementSibling).toHaveTextContent("P 1 · B 1");
    expect(within(stats).getByText("지금 연속").nextElementSibling).toHaveTextContent("B 4");
    expect(screen.getByText(/남은 카드 300장/)).toBeInTheDocument();
  });
});

describe("SidePanel / MobileWidget", () => {
  it("renders the chosen widgets with a labelled picker per slot", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const onToggleSplit = vi.fn();
    render(<SidePanel side="left" ids={["bead", "betSplit"]} data={data()} onChoose={onChoose} onToggleSplit={onToggleSplit} />);
    expect(screen.getByRole("region", { name: "구슬판" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "베팅 비율" })).toBeInTheDocument();
    const topPicker = screen.getByRole("combobox", { name: "왼쪽 위 칸에 보여 줄 위젯 구슬판" });
    await user.click(topPicker);
    await user.click(screen.getByRole("option", { name: "슈 통계" }));
    expect(onChoose).toHaveBeenCalledWith("left", 0, "shoeStats");
    await user.click(screen.getByRole("button", { name: "왼쪽 칸 합치기" }));
    expect(onToggleSplit).toHaveBeenCalledWith("left");
  });

  it("switches the phone widget with a dropdown", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<MobileWidget id="bead" data={data()} onChoose={onChoose} />);
    expect(screen.getByRole("region", { name: "구슬판" })).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "보여 줄 정보 구슬판" }));
    await user.click(screen.getByRole("option", { name: "슈 통계" }));
    expect(onChoose).toHaveBeenCalledWith("shoeStats");
  });
});
