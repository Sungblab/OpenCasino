import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";

export interface DropdownOption {
  value: string;
  label: string;
}

/** 이 시간 안에 이어 친 글자는 한 단어로 본다(예: "라이" → 라이트닝…). */
const TYPEAHEAD_RESET_MS = 600;

/**
 * A themed stand-in for a native <select>. Browsers own the popup chrome of a real <select> —
 * the hover/selected highlight in particular is OS accent color and can't be restyled via CSS
 * in most engines, so a native select can never fully match the rest of the gold theme. This
 * is a real listbox (button + positioned list) instead, so every pixel of it is ours.
 *
 * 그 대신 네이티브 select 가 공짜로 주던 키보드 동작을 직접 갖춰야 한다. 예전 목록은 클릭으로만
 * 고를 수 있어서, 키보드만 쓰는 관리자는 게임 기록 필터를 아예 바꿀 수 없었다. WAI-ARIA 의
 * "select-only combobox" 패턴을 따른다: 포커스는 늘 트리거 버튼에 머물고, 목록 안에서 지금
 * 가리키는 항목은 aria-activedescendant 로 알린다(항목마다 포커스를 옮기면 스크린리더가 목록을
 * 나갔다 들어왔다 한다).
 *  - 닫힘: ↓/↑/Enter/Space 로 열기, Home/End 는 열면서 처음/끝으로
 *  - 열림: ↑/↓ 이동, Home/End, PageUp/PageDown(10칸), Enter/Space 선택, Esc 닫기(값 유지),
 *          Tab 은 가리키던 항목을 고르고 다음 요소로 넘어간다, 글자를 치면 그 글자로 시작하는 항목으로
 */
export function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const valueId = `${baseId}-value`;
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const current = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  // 가리키는 항목이 목록 스크롤 밖이면 따라 내려간다. 포커스가 버튼에 있으니 브라우저가 대신 해 주지 않는다.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const element = listRef.current?.children.item(activeIndex);
    element?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex]);

  const openAt = (index: number) => {
    setActiveIndex(Math.max(0, Math.min(options.length - 1, index)));
    setOpen(true);
    // 아래로 펼 자리가 모자라고 위가 더 넓으면 위로 편다(네이티브 select 가 하던 일을 우리가 대신).
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const needed = Math.min(280, options.length * 36 + 12);
      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      setOpenUp(below < needed && above > below);
    }
  };

  const close = () => {
    setOpen(false);
    setActiveIndex(-1);
  };

  const commit = (index: number) => {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    close();
  };

  const findByText = (key: string): number => {
    const now = Date.now();
    const state = typeahead.current;
    state.text = now - state.at > TYPEAHEAD_RESET_MS ? key : state.text + key;
    state.at = now;
    const needle = state.text.toLocaleLowerCase("ko-KR");
    const start = open ? activeIndex : selectedIndex;
    // 같은 글자를 거듭 치면 그 글자로 시작하는 다음 항목으로 돈다(네이티브 select 와 같다).
    const repeating = needle.length > 1 && [...needle].every((char) => char === needle[0]);
    const query = repeating ? needle[0]! : needle;
    const offset = repeating || needle.length === 1 ? 1 : 0;
    for (let step = 0; step < options.length; step += 1) {
      const index = (Math.max(start, 0) + offset + step) % options.length;
      if (options[index]!.label.toLocaleLowerCase("ko-KR").startsWith(query)) return index;
    }
    return -1;
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (options.length === 0) return;
    const last = options.length - 1;
    const from = activeIndex >= 0 ? activeIndex : Math.max(selectedIndex, 0);
    if (!open) {
      switch (event.key) {
        case "ArrowDown":
        case "ArrowUp":
        case "Enter":
        case " ":
          event.preventDefault();
          openAt(Math.max(selectedIndex, 0));
          return;
        case "Home":
          event.preventDefault();
          openAt(0);
          return;
        case "End":
          event.preventDefault();
          openAt(last);
          return;
      }
    } else {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          if (event.altKey) return;
          setActiveIndex(Math.min(last, from + 1));
          return;
        case "ArrowUp":
          event.preventDefault();
          // Alt+↑ 는 네이티브 select 처럼 "지금 것을 고르고 닫기".
          if (event.altKey) commit(from);
          else setActiveIndex(Math.max(0, from - 1));
          return;
        case "Home":
          event.preventDefault();
          setActiveIndex(0);
          return;
        case "End":
          event.preventDefault();
          setActiveIndex(last);
          return;
        case "PageDown":
          event.preventDefault();
          setActiveIndex(Math.min(last, from + 10));
          return;
        case "PageUp":
          event.preventDefault();
          setActiveIndex(Math.max(0, from - 10));
          return;
        case "Enter":
        case " ":
          event.preventDefault();
          commit(from);
          return;
        case "Escape":
          event.preventDefault();
          // 대화상자 안의 드롭다운이면 Esc 가 대화상자까지 닫지 않게 여기서 멈춘다.
          event.stopPropagation();
          close();
          return;
        case "Tab":
          commit(from);
          return;
      }
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
      const match = findByText(event.key);
      if (match < 0) return;
      event.preventDefault();
      if (open) setActiveIndex(match);
      else if (options[match]!.value !== value) onChange(options[match]!.value);
    }
  };

  return (
    <div className={`dropdown ${open && openUp ? "opens-up" : ""} ${className ?? ""}`} ref={rootRef}>
      <span id={labelId} className="visually-hidden">{ariaLabel}</span>
      <button
        type="button"
        className="dropdown-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        onClick={() => (open ? close() : openAt(Math.max(selectedIndex, 0)))}
        onKeyDown={onKeyDown}
        // 목록 항목은 mousedown 에서 포커스를 뺏지 않으므로, 여기서 포커스를 잃었다는 건 정말 밖으로 나갔다는 뜻이다.
        onBlur={() => { if (open) close(); }}
      >
        <span id={valueId}>{current?.label ?? ""}</span>
        <ChevronDown size={14} className="dropdown-chevron" aria-hidden="true" />
      </button>
      {open && (
        <ul className="dropdown-menu" role="listbox" id={listId} aria-labelledby={labelId} ref={listRef} tabIndex={-1}>
          {options.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={option.value === value}
              className={`${option.value === value ? "selected" : ""}${index === activeIndex ? " is-active" : ""}`}
              // 포커스를 트리거에 남겨 둬야 blur 로 목록이 먼저 닫히지 않고, 고른 뒤 Tab 이 제자리에서 이어진다.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => commit(index)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
