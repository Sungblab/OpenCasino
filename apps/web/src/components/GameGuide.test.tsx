import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameGuide, type GameGuideContent } from "./GameGuide";

const CONTENT: GameGuideContent = {
  gameKey: "test",
  title: "테스트 게임",
  intro: "한 줄 소개",
  sections: [
    { id: "flow", title: "진행", content: <p>진행 설명 <a href="#x">자세히</a></p> },
    { id: "rankings", title: "족보", content: <p>족보 설명</p> },
    { id: "terms", title: "용어", content: <p>용어 설명</p> },
  ],
};

function Harness({ initialSection }: { initialSection?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>도움말 열기</button>
      <button type="button">뒤쪽 버튼</button>
      <GameGuide content={CONTENT} open={open} initialSection={initialSection} onClose={() => setOpen(false)} />
    </>
  );
}

describe("GameGuide dialog focus", () => {
  it("is a labelled modal dialog and puts focus on the current tab", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "도움말 열기" }));
    const dialog = screen.getByRole("dialog", { name: "테스트 게임" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("한 줄 소개");
    expect(screen.getByRole("tab", { name: "진행" })).toHaveFocus();
  });

  it("opens on the requested section", async () => {
    const user = userEvent.setup();
    render(<Harness initialSection="rankings" />);
    await user.click(screen.getByRole("button", { name: "도움말 열기" }));
    expect(screen.getByRole("tab", { name: "족보" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("족보 설명");
  });

  it("keeps Tab and Shift+Tab inside the dialog", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "도움말 열기" }));
    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "도움말 닫기" });

    // 탭 → 본문 → 본문 안 링크 → (끝) → 처음(닫기 버튼)으로 돈다.
    for (let step = 0; step < 6; step += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    close.focus();
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole("link", { name: "자세히" })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
  });

  it("moves between tabs with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "도움말 열기" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "족보" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "족보" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "용어" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "진행" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the button that opened it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "도움말 열기" });
    await user.click(opener);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("returns focus after closing with the close button", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "도움말 열기" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "도움말 닫기" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
