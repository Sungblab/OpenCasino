import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getLobby } from "../api";
import { AppShell } from "../components/AppShell";
import { FriendsView } from "../components/FriendsView";
import { useGameSocket } from "../lib/gameSocket";

/**
 * 친구와 1:1 메시지 화면. 본문(FriendsView)은 어디서나 뜨는 친구 창과 같다 — 여기는 주소(?with=)로 대화를 고르는 껍데기.
 * 폰 아래 탭 "친구"와 바로가기 주소가 이리로 온다.
 */
export function FriendsPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [params, setParams] = useSearchParams();
  const withId = params.get("with");
  const [balance, setBalance] = useState<number | null>(null);
  const socket = useGameSocket();

  useEffect(() => {
    getLobby(token).then((lobby) => setBalance(lobby.walletBalance), () => undefined);
  }, [token]);

  // 친구에게 코인을 보내면 위 띠 잔액도 바로 바뀐다.
  useEffect(() => {
    const onWallet = ({ balance: next }: { balance: number }) => setBalance(next);
    socket.on("wallet.updated", onWallet);
    return () => { socket.off("wallet.updated", onWallet); };
  }, [socket]);

  return (
    <AppShell balance={balance} onLogout={onLogout}>
      <div className={`friends-page${withId ? " has-chat" : ""}`}>
        <div className="wallet-heading friends-heading">
          <div className="wallet-title-group">
            <Link className="lobby-return-button" to="/lobby"><span aria-hidden="true">←</span> 게임 로비</Link>
            <h1>친구</h1>
          </div>
        </div>
        <FriendsView token={token} withId={withId} onOpenChat={(userId) => setParams(userId ? { with: userId } : {})} />
      </div>
    </AppShell>
  );
}
