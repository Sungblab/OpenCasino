import { useCallback, useEffect, useState } from "react";
import { MessageCircleMore, Radio, UserRound } from "lucide-react";
import type { ChatMessage, GameRoom, SupportConversation } from "@opencasino/contracts";
import { getAdminSupportConversations, getAdminSupportMessages, getRoomChatMessages, sendAdminBroadcast } from "../api";
import { GAME_TYPE_LABEL } from "../lib/gameLabels";
import { ChatComposer, ChatThread } from "./ChatThread";
import { Dropdown } from "./Dropdown";
import { useGameSocket } from "../lib/gameSocket";
import { useCurrentUser } from "../app/auth";
import { useToast } from "../app/toast";

type SendMode = "chat" | "room-notice" | "all-notice";

const SEND_MODES: { value: SendMode; label: string; placeholder: string }[] = [
  { value: "chat", label: "방 채팅", placeholder: "이 방 채팅으로 보내기" },
  { value: "room-notice", label: "이 방 공지", placeholder: "이 방 접속자에게 토스트 공지" },
  { value: "all-notice", label: "전체 공지", placeholder: "접속 중인 전체 유저에게 토스트 공지" },
];

function appendMessage(current: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return current.some((item) => item.id === message.id) ? current : [...current, message];
}

export function AdminChatCenter({ token, rooms, onSupportChanged }: { token: string; rooms: GameRoom[]; onSupportChanged: () => void }) {
  const [conversations, setConversations] = useState<SupportConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [supportMessages, setSupportMessages] = useState<ChatMessage[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState(rooms[0]?.id ?? "");
  const [roomMessages, setRoomMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [sendMode, setSendMode] = useState<SendMode>("chat");
  const adminId = useCurrentUser()?.id ?? null;
  const toast = useToast();
  const socket = useGameSocket();

  const loadConversations = useCallback(async () => {
    try {
      const result = await getAdminSupportConversations(token);
      setConversations(result.items);
      setSelectedConversationId((current) => result.items.some((item) => item.id === current) ? current : result.items[0]?.id ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "문의 목록을 불러오지 못했습니다.");
    }
  }, [token]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!rooms.some((room) => room.id === selectedRoomId)) setSelectedRoomId(rooms[0]?.id ?? "");
  }, [rooms, selectedRoomId]);

  useEffect(() => {
    if (!selectedConversationId) {
      setSupportMessages([]);
      return;
    }
    let cancelled = false;
    getAdminSupportMessages(token, selectedConversationId)
      .then((history) => {
        if (!cancelled) setSupportMessages(history.items);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "문의 대화를 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedConversationId, token]);

  useEffect(() => {
    if (!selectedRoomId) {
      setRoomMessages([]);
      return;
    }
    let cancelled = false;
    getRoomChatMessages(token, selectedRoomId)
      .then((history) => {
        if (!cancelled) setRoomMessages(history.items);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "방 채팅을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRoomId, token]);

  useEffect(() => {
    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);
    setConnected(socket.connected);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, [socket]);

  useEffect(() => {
    const handleSupport = (message: ChatMessage) => {
      if (message.conversationId === selectedConversationId) setSupportMessages((current) => appendMessage(current, message));
      void loadConversations();
      onSupportChanged();
    };
    const handleRoom = (message: ChatMessage) => {
      if (message.roomId === selectedRoomId) setRoomMessages((current) => appendMessage(current, message));
    };
    socket.on("support.message", handleSupport);
    socket.on("room.chat.message", handleRoom);
    return () => {
      socket.off("support.message", handleSupport);
      socket.off("room.chat.message", handleRoom);
    };
  }, [loadConversations, onSupportChanged, selectedConversationId, selectedRoomId, socket]);

  const sendSupport = (message: string): Promise<boolean> => new Promise((resolve) => {
    if (!selectedConversationId || !socket.connected) {
      setError("상담 서버 연결을 확인해주세요.");
      resolve(false);
      return;
    }
    socket.emit("admin.support.send", { conversationId: selectedConversationId, message }, (ack) => {
      if (!ack.ok) {
        setError(ack.error);
        resolve(false);
        return;
      }
      setSupportMessages((current) => appendMessage(current, ack.data));
      setError("");
      resolve(true);
    });
  });

  const sendRoomMessage = (message: string): Promise<boolean> => new Promise((resolve) => {
    if (!selectedRoomId || !socket.connected) {
      setError("채팅 서버 연결을 확인해주세요.");
      resolve(false);
      return;
    }
    socket.emit("room.chat.send", { roomId: selectedRoomId, message }, (ack) => {
      if (!ack.ok) {
        setError(ack.error);
        resolve(false);
        return;
      }
      setRoomMessages((current) => appendMessage(current, ack.data));
      setError("");
      resolve(true);
    });
  });

  const send = async (message: string): Promise<boolean> => {
    if (sendMode === "chat") return sendRoomMessage(message);
    try {
      await sendAdminBroadcast(token, sendMode === "all-notice" ? { scope: "all", message } : { scope: "room", roomId: selectedRoomId, message });
      setError("");
      toast.success(sendMode === "all-notice" ? "전체 공지를 보냈습니다." : "이 방에 공지를 보냈습니다.");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "공지를 보내지 못했습니다.");
      return false;
    }
  };

  const selectedConversation = conversations.find((item) => item.id === selectedConversationId);
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId);

  return (
    <section id="support" className="admin-chat-section">
      <div className="admin-chat-grid">
        <article className="admin-panel admin-support-panel">
          <div className="admin-panel-heading"><h2><MessageCircleMore size={17} /> 1:1 문의</h2><span>{conversations.filter((item) => item.status === "open").length}건 답변 대기 · {connected ? "실시간 연결" : "연결 중"}</span></div>
          <div className="admin-support-layout">
            <nav className="admin-conversation-list" aria-label="문의 사용자 목록">
              {conversations.length === 0 && <p className="admin-chat-empty">접수된 문의가 없습니다.</p>}
              {conversations.map((conversation) => (
                <button key={conversation.id} type="button" className={conversation.id === selectedConversationId ? "is-selected" : ""} onClick={() => setSelectedConversationId(conversation.id)}>
                  <span className="admin-conversation-avatar"><UserRound size={15} /></span>
                  <span><strong>{conversation.username}</strong><small>{conversation.lastMessage?.message ?? "대화 없음"}</small></span>
                  <i className={conversation.status === "open" ? "needs-reply" : "answered"}>{conversation.status === "open" ? "대기" : "완료"}</i>
                </button>
              ))}
            </nav>
            <div className="admin-chat-thread-wrap">
              <header><strong>{selectedConversation ? `${selectedConversation.username} 님과의 문의` : "대화를 선택하세요"}</strong><small>관리자 답변 시 처리 완료로 전환됩니다.</small></header>
              <ChatThread messages={supportMessages} currentUserId={adminId} emptyText="선택한 사용자와의 대화가 여기에 표시됩니다." />
              <ChatComposer onSend={sendSupport} disabled={!selectedConversationId || !connected} placeholder="관리자 답변 입력" />
            </div>
          </div>
        </article>

        <article className="admin-panel admin-room-chat-panel">
          <div className="admin-panel-heading"><h2><Radio size={17} /> 방 채팅 · 공지</h2><span>{connected ? "실시간 연결" : "연결 중"}</span></div>
          <div className="admin-room-chat-select">
            <span>방</span>
            <Dropdown
              ariaLabel="방 선택"
              value={selectedRoomId}
              onChange={setSelectedRoomId}
              options={rooms.map((room) => ({ value: room.id, label: `${room.name} · ${GAME_TYPE_LABEL[room.gameType]}` }))}
            />
          </div>
          <header className="admin-room-chat-head"><strong>{selectedRoom?.name ?? "방 없음"}</strong><small>{selectedRoom ? `${selectedRoom.playerCount}명 접속 · ${selectedRoom.phase}` : ""}</small></header>
          <ChatThread messages={roomMessages} currentUserId={adminId} emptyText="이 방에는 아직 채팅이 없습니다." />
          {/* One composer, three destinations. Broadcast used to be its own form on the 게임 운영
              page, which meant writing to the same players from two screens depending on whether
              you wanted a chat line or a toast. */}
          <div className="admin-send-modes" role="radiogroup" aria-label="보내는 방식">
            {SEND_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                role="radio"
                aria-checked={sendMode === mode.value}
                className={sendMode === mode.value ? "active" : ""}
                onClick={() => setSendMode(mode.value)}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <ChatComposer
            onSend={send}
            disabled={!connected || (sendMode !== "all-notice" && !selectedRoomId)}
            placeholder={SEND_MODES.find((mode) => mode.value === sendMode)?.placeholder}
          />
        </article>
      </div>
      {error && <p className="chat-error">{error}</p>}
    </section>
  );
}
