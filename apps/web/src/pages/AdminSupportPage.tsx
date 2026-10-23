import { AdminChatCenter } from "../components/AdminChatCenter";
import { useAdminData } from "../admin/AdminData";
import { AdminView } from "./AdminView";

export function AdminSupportPage() {
  const { token, overview, refresh } = useAdminData();
  if (!overview) return null;
  return <AdminView title="문의·채팅" meta={`${overview.openSupportConversations}건 답변 대기`}><AdminChatCenter token={token} rooms={overview.rooms} onSupportChanged={refresh} /></AdminView>;
}
