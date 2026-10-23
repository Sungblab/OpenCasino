import { useLayoutEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { ChatMessage } from "@opencasino/contracts";
import { MAX_CHAT_LENGTH_HINT } from "../lib/chat";

/**
 * 대화 목록. 새 메시지가 붙으면 맨 아래로 내려간다. onReachTop 을 주면(1:1 메시지) 맨 위에 닿을 때 불러서
 * 이전 메시지를 앞에 붙이게 하고, 붙은 뒤에도 보던 줄이 제자리에 있게 스크롤을 그만큼 내려 준다.
 */
export function ChatThread({ messages, currentUserId, emptyText, onReachTop }: { messages: ChatMessage[]; currentUserId?: string | null; emptyText: string; onReachTop?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const edges = useRef<{ first?: string; last?: string; height: number }>({ height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const previous = edges.current;
    const first = messages[0]?.id;
    const last = messages[messages.length - 1]?.id;
    const prepended = Boolean(previous.last) && last === previous.last && first !== previous.first;
    // 앞에 붙었을 때와 처음 채울 때는 부드러운 스크롤(CSS)을 끈다 — 앞의 경우는 튀어 보이고, 뒤의 경우는 맨 위에서
    // 미끄러져 내려가는 동안 "맨 위에 닿음"이 불려 이전 메시지를 괜히 더 불러온다.
    if (prepended || !previous.last) element.style.scrollBehavior = "auto";
    if (prepended) element.scrollTop += element.scrollHeight - previous.height;
    else element.scrollTo({ top: element.scrollHeight });
    element.style.scrollBehavior = "";
    edges.current = { first, last, height: element.scrollHeight };
  }, [messages]);

  return (
    <div className="chat-thread" ref={ref} aria-live="polite" onScroll={onReachTop ? (event) => { if (event.currentTarget.scrollTop < 40) onReachTop(); } : undefined}>
      {messages.length === 0 && <p className="chat-thread-empty">{emptyText}</p>}
      {messages.map((message) => (
        <article key={message.id} className={`chat-bubble ${message.userId === currentUserId ? "is-mine" : ""} ${message.role === "admin" ? "is-admin" : ""}`}>
          <div className="chat-bubble-meta">
            <strong>{message.role === "admin" ? "관리자" : message.username}</strong>
            <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</time>
          </div>
          <p>{message.message}</p>
        </article>
      ))}
    </div>
  );
}

export function ChatComposer({ onSend, disabled = false, placeholder = "메시지를 입력하세요" }: { onSend: (message: string) => Promise<boolean>; disabled?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const message = draft.trim();
    if (!message || sending || disabled) return;
    setSending(true);
    try {
      if (await onSend(message)) setDraft("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="chat-composer">
      <input
        value={draft}
        maxLength={MAX_CHAT_LENGTH_HINT}
        placeholder={placeholder}
        disabled={disabled || sending}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) void submit();
        }}
      />
      <button type="button" onClick={() => void submit()} disabled={disabled || sending || !draft.trim()} aria-label="메시지 전송">
        <Send size={17} />
      </button>
    </div>
  );
}
