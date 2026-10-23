import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ChatMessage, ProfileResponse } from "@opencasino/contracts";
import { getProfile, getSupportMessages } from "../api";
import { AppShell } from "../components/AppShell";
import { ChatComposer, ChatThread } from "../components/ChatThread";
import { useGameSocket } from "../lib/gameSocket";

function appendMessage(current: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return current.some((item) => item.id === message.id) ? current : [...current, message];
}

export function SupportPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const socket = useGameSocket();

  useEffect(() => {
    let cancelled = false;
    Promise.all([getProfile(token), getSupportMessages(token)])
      .then(([nextProfile, history]) => {
        if (cancelled) return;
        setProfile(nextProfile);
        setMessages(history.items);
        setError("");
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "문의 내역을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);
    setConnected(socket.connected);
    const handleMessage = (message: ChatMessage) => {
      if (message.conversationId) setMessages((current) => appendMessage(current, message));
    };
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("support.message", handleMessage);
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("support.message", handleMessage);
    };
  }, [socket]);

  const send = (message: string): Promise<boolean> => new Promise((resolve) => {
    if (!socket.connected) {
      setError("실시간 상담 서버에 연결 중입니다. 잠시 후 다시 시도해주세요.");
      resolve(false);
      return;
    }
    socket.emit("support.send", { message }, (ack) => {
      if (!ack.ok) {
        setError(ack.error);
        resolve(false);
        return;
      }
      setMessages((current) => appendMessage(current, ack.data));
      setError("");
      resolve(true);
    });
  });

  return (
    <AppShell balance={profile?.walletBalance ?? null} onLogout={onLogout}>
      {/* Same heading as 지갑 / 게임 기록 / 프로필. This page used to mirror it — title left,
          back-link right — so the one control that leaves the page moved across the screen
          depending on which of the four you were on. */}
      <div className="wallet-heading">
        <div className="wallet-title-group">
          <Link className="lobby-return-button" to="/lobby"><span aria-hidden="true">←</span> 게임 로비</Link>
          <h1>1:1 문의</h1>
        </div>
      </div>

      <section className="support-card" aria-label="관리자 1대1 문의">
        <header className="support-card-head">
          <div><strong>OpenCasino 고객센터</strong><small><i className={connected ? "is-online" : ""} />{connected ? "실시간 연결됨" : "연결 중"}</small></div>
        </header>
        <ChatThread messages={messages} currentUserId={profile?.user.id} emptyText="궁금한 점이나 도움이 필요한 내용을 남겨주세요. 관리자가 확인 후 답변해드립니다." />
        <ChatComposer onSend={send} disabled={!connected} placeholder="문의 내용을 입력하세요" />
        {error && <p className="chat-error">{error}</p>}
      </section>
    </AppShell>
  );
}
