import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChipTray } from "./ChipTray";

// jsdom 에는 canvas 2D 컨텍스트가 없다. 칩 그림은 canvas 로 그려 data URL 을 만드므로, 그 두 함수만
// 가짜 URL 로 바꾸고(나머지 칩 쪼개기 로직은 진짜 그대로) 마크업만 확인한다.
vi.mock("../lib/chipArt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/chipArt")>()),
  chipTopUrl: (value: number) => `chip-top-${value}.png`,
  chipLayerUrl: (tier: number) => `chip-layer-${tier}.png`,
}));

describe("ChipTray", () => {
  it("renders one pressed-state button per chip and marks the current one", () => {
    render(<ChipTray chips={[1, 5, 10]} chip={5} onChip={() => undefined} maxAdditional={100} />);
    expect(screen.getByRole("button", { name: "1코인 칩" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "5코인 칩" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "10코인 칩" })).toBeEnabled();
  });

  it("disables chips larger than what can still be bet", () => {
    render(<ChipTray chips={[1, 5, 10]} chip={1} onChip={() => undefined} maxAdditional={7} />);
    expect(screen.getByRole("button", { name: "5코인 칩" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "10코인 칩" })).toBeDisabled();
  });

  it("adds a max-amount chip when the limit doesn't land on a chip value", () => {
    render(<ChipTray chips={[1, 5, 10]} chip={1} onChip={() => undefined} maxAdditional={7} />);
    expect(screen.getByRole("button", { name: "가능한 최대 금액 7코인" })).toBeEnabled();
  });

  it("does not add a max chip when the limit equals a chip", () => {
    render(<ChipTray chips={[1, 5, 10]} chip={1} onChip={() => undefined} maxAdditional={10} />);
    expect(screen.queryByRole("button", { name: /가능한 최대 금액/ })).not.toBeInTheDocument();
  });

  it("blocks the max chip on request and everything when the window is closed", () => {
    const { rerender } = render(<ChipTray chips={[1, 5]} chip={1} onChip={() => undefined} maxAdditional={3} maxBlocked />);
    expect(screen.getByRole("button", { name: "가능한 최대 금액 3코인" })).toBeDisabled();
    rerender(<ChipTray chips={[1, 5]} chip={1} onChip={() => undefined} maxAdditional={3} disabled />);
    expect(screen.getByRole("button", { name: "1코인 칩" })).toBeDisabled();
  });

  it("reports the picked chip, including from the phone picker menu", async () => {
    const user = userEvent.setup();
    const onChip = vi.fn();
    render(<ChipTray chips={[1, 5, 10]} chip={1} onChip={onChip} maxAdditional={100} />);
    await user.click(screen.getByRole("button", { name: "10코인 칩" }));
    expect(onChip).toHaveBeenLastCalledWith(10);

    const picker = screen.getByRole("button", { name: "칩 단위 선택" });
    expect(picker).toHaveAttribute("aria-expanded", "false");
    await user.click(picker);
    expect(picker).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("menuitem", { name: "5" }));
    expect(onChip).toHaveBeenLastCalledWith(5);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("draws chip art images when art is on", () => {
    const { container } = render(<ChipTray chips={[1, 5]} chip={1} onChip={() => undefined} maxAdditional={5} art />);
    expect(container.querySelectorAll(".chip-art img")).toHaveLength(2);
  });
});
