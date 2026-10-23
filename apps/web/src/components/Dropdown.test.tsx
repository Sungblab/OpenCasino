import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dropdown, type DropdownOption } from "./Dropdown";

const OPTIONS: DropdownOption[] = [
  { value: "all", label: "전체 게임" },
  { value: "baccarat", label: "바카라" },
  { value: "blackjack", label: "블랙잭" },
  { value: "holdem", label: "Holdem" },
  { value: "sutda", label: "Sutda" },
];

function Harness({ onChange }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState("all");
  return (
    <>
      <Dropdown ariaLabel="게임 종류" value={value} options={OPTIONS} onChange={(next) => { setValue(next); onChange?.(next); }} />
      <button type="button">다음 요소</button>
    </>
  );
}

function activeOption(trigger: HTMLElement): HTMLElement | null {
  const id = trigger.getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
}

describe("Dropdown keyboard", () => {
  it("names the combobox by its label and current value", () => {
    render(<Harness />);
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveAccessibleName("게임 종류 전체 게임");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens with ArrowDown, moves with arrows/Home/End and commits with Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    trigger.focus();

    await user.keyboard("{ArrowDown}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    // 열면 지금 고른 항목을 가리킨다.
    expect(activeOption(trigger)).toHaveTextContent("전체 게임");

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(activeOption(trigger)).toHaveTextContent("블랙잭");
    await user.keyboard("{ArrowUp}");
    expect(activeOption(trigger)).toHaveTextContent("바카라");
    await user.keyboard("{End}");
    expect(activeOption(trigger)).toHaveTextContent("Sutda");
    await user.keyboard("{Home}");
    expect(activeOption(trigger)).toHaveTextContent("전체 게임");

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("baccarat");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAccessibleName("게임 종류 바카라");
    // 포커스는 늘 트리거에 남는다.
    expect(trigger).toHaveFocus();
  });

  it("selects with Space and closes with Escape without changing the value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    trigger.focus();

    await user.keyboard(" ");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{ArrowDown}{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();

    await user.keyboard(" {ArrowDown}{ArrowDown} ");
    expect(onChange).toHaveBeenLastCalledWith("blackjack");
  });

  it("marks the selected option with aria-selected", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: "전체 게임" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "바카라" })).toHaveAttribute("aria-selected", "false");
  });

  it("jumps by typed characters (typeahead)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("combobox");
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("s");
    expect(activeOption(trigger)).toHaveTextContent("Sutda");
    await user.keyboard("{Escape}");
    // 이어 친 글자는 한 단어로 모으므로("sh"), 새 글자로 보이게 잠깐 쉰다.
    await new Promise((resolve) => setTimeout(resolve, 700));
    // 닫힌 채로 치면 바로 그 값으로 바뀐다(네이티브 select 와 같다).
    await user.keyboard("h");
    expect(trigger).toHaveAccessibleName("게임 종류 Holdem");
  });

  it("commits the active option on Tab and moves focus on", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    trigger.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await user.tab();
    expect(onChange).toHaveBeenCalledWith("baccarat");
    expect(screen.getByRole("button", { name: "다음 요소" })).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("still works with the mouse", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "블랙잭" }));
    expect(onChange).toHaveBeenCalledWith("blackjack");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
