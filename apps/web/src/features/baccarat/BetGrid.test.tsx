import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BaccaratBetChoice } from "@opencasino/contracts";
import { BetGrid, type ZoneSpec } from "./BetGrid";
import { ChipPile } from "../stage/ChipPile";

// jsdom 에는 canvas 2D 컨텍스트가 없다. 칩 그림은 canvas 로 그려 data URL 을 만드므로, 그 두 함수만
// 가짜 URL 로 바꾸고(나머지 칩 쪼개기 로직은 진짜 그대로) 마크업만 확인한다.
vi.mock("../../lib/chipArt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/chipArt")>()),
  chipTopUrl: (value: number) => `chip-top-${value}.png`,
  chipLayerUrl: (tier: number) => `chip-layer-${tier}.png`,
}));

const ZONES: ZoneSpec[] = [
  { choice: "player", label: "플레이어", odds: "1:1", tone: "player", big: true },
  { choice: "tie", label: "타이", odds: "8:1", tone: "tie" },
  { choice: "banker", label: "뱅커", odds: "0.95:1", tone: "banker", big: true },
];
const DENOMS = [1, 5, 10, 50, 100] as const;

function renderGrid(overrides: Partial<Parameters<typeof BetGrid>[0]> = {}) {
  const props: Parameters<typeof BetGrid>[0] = {
    zones: ZONES,
    amounts: {},
    totals: {},
    outcomes: null,
    winners: new Set<BaccaratBetChoice>(),
    disabled: false,
    denominations: DENOMS,
    onPlace: vi.fn(),
    pileRef: vi.fn(),
    ...overrides,
  };
  return { ...render(<BetGrid {...props} />), props };
}

describe("BetGrid", () => {
  it("renders one button per zone with its label and odds", () => {
    renderGrid();
    expect(screen.getByRole("button", { name: "플레이어 1:1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "타이 8:1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "뱅커 0.95:1" })).toHaveClass("big");
  });

  it("places a bet on click while open", async () => {
    const user = userEvent.setup();
    const { props } = renderGrid();
    await user.click(screen.getByRole("button", { name: "뱅커 0.95:1" }));
    expect(props.onPlace).toHaveBeenCalledWith("banker");
  });

  it("ignores clicks while locked but stays focusable (aria-disabled)", async () => {
    const user = userEvent.setup();
    const { props, container } = renderGrid({ disabled: true });
    const zone = screen.getByRole("button", { name: "플레이어 1:1" });
    expect(zone).toHaveAttribute("aria-disabled", "true");
    expect(container.querySelector(".bac-grid")).toHaveClass("is-locked");
    await user.click(zone);
    expect(props.onPlace).not.toHaveBeenCalled();
  });

  it("shows my stake in the accessible name and on the chip pile only (no separate badge)", () => {
    const { container } = renderGrid({ amounts: { player: 15 } });
    const zone = screen.getByRole("button", { name: "플레이어 1:1, 내 베팅 15코인" });
    expect(zone).toHaveClass("has-bet");
    expect(zone.querySelector(".bac-zone-mine")).toBeNull();
    const chips = container.querySelectorAll(".chip-pile-slot.stake img");
    expect(chips.length).toBeGreaterThan(0);
    // 맨 위 칩에 건 총액이 찍힌다(테스트에서는 chipTopUrl 이 가짜 URL 로 금액을 드러낸다).
    expect(chips[chips.length - 1]).toHaveAttribute("src", "chip-top-15.png");
  });

  it("shows the table's players and this zone's share of the round per zone", () => {
    renderGrid({ totals: { banker: { players: 3, amount: 25_000 }, player: { players: 1, amount: 25_000 } } });
    expect(screen.getByRole("button", { name: "뱅커 0.95:1" })).toHaveTextContent("3명 · 50%");
  });

  it("renders win / lose / push outcomes by look only — my result is written once, on the stage banner", () => {
    renderGrid({
      amounts: { player: 10, tie: 5, banker: 20 },
      outcomes: { player: { state: "win", profit: 10 }, tie: { state: "lose", profit: 0 }, banker: { state: "push", profit: 0 } },
      winners: new Set<BaccaratBetChoice>(["player"]),
    });
    const player = screen.getByRole("button", { name: /^플레이어/ });
    expect(player).toHaveClass("is-win");
    expect(player.querySelectorAll(".chip-pile.is-payout img").length).toBeGreaterThan(0);
    const tie = screen.getByRole("button", { name: /^타이/ });
    expect(tie).toHaveClass("is-lose");
    for (const zone of screen.getAllByRole("button")) expect(zone.querySelector(".bac-zone-mine")).toBeNull();
  });

  it("hands every zone's pile slots to pileRef", () => {
    const { props } = renderGrid();
    const kinds = (props.pileRef as ReturnType<typeof vi.fn>).mock.calls.filter(([, , element]) => element !== null).map(([choice, kind]) => `${choice}:${kind}`);
    expect(new Set(kinds)).toEqual(new Set(["player:stake", "player:payout", "tie:stake", "tie:payout", "banker:stake", "banker:payout"]));
  });
});

describe("ChipPile", () => {
  it("draws nothing for zero and hides itself from assistive tech", () => {
    const { container } = render(<ChipPile amount={0} denominations={DENOMS} cap={7} />);
    const pile = container.querySelector(".chip-pile")!;
    expect(pile).toHaveAttribute("aria-hidden", "true");
    expect(pile.querySelectorAll("img")).toHaveLength(0);
  });

  it("never stacks more chips than the cap", () => {
    const { container } = render(<ChipPile amount={999} denominations={DENOMS} cap={4} />);
    expect(container.querySelectorAll(".chip-pile img").length).toBeLessThanOrEqual(4);
    expect(container.querySelector(".chip-pile img:last-child")).toHaveClass("is-top");
  });
});
