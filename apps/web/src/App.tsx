import { lazy } from "react";
import type { ReactNode } from "react";
import { Route, Routes, useParams } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { LegalPage } from "./pages/LegalPage";
import { GuidePage } from "./pages/GuidePage";
import { LobbyPage } from "./pages/LobbyPage";
import { GameRoomsPage, PrivateRoomLink } from "./pages/GameRoomsPage";
import { SiteToast } from "./components/SiteToast";
import { SocketProvider } from "./lib/gameSocket";
import { FriendsProvider } from "./lib/friends";
import { AuthProvider, RedirectIfAuthenticated, RequireAdmin, RequireAuth, RequirePlayer, useAuth } from "./app/auth";
import { ToastProvider } from "./app/toast";
import { RouteBoundary as Screen, RouteLoading } from "./app/ErrorBoundary";
import { NotFoundPage } from "./app/NotFoundPage";
import { GameLoading } from "./components/GameLoading";

/**
 * 게임방과 관리자 화면은 들어갈 때 받는다. 예전에는 로그인 화면에서도 여섯 게임방과 관리자
 * 콘솔 전체(약 800KB)를 한 번에 받았다. 로그인·로비는 첫 화면이라 그대로 둔다.
 */
const WalletPage = lazy(() => import("./pages/WalletPage").then((m) => ({ default: m.WalletPage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage").then((m) => ({ default: m.ProfilePage })));
const GameHistoryPage = lazy(() => import("./pages/GameHistoryPage").then((m) => ({ default: m.GameHistoryPage })));
const LeaderboardPage = lazy(() => import("./pages/LeaderboardPage").then((m) => ({ default: m.LeaderboardPage })));
const MissionsPage = lazy(() => import("./pages/MissionsPage").then((m) => ({ default: m.MissionsPage })));
const AuctionPage = lazy(() => import("./pages/AuctionPage").then((m) => ({ default: m.AuctionPage })));
const ShopPage = lazy(() => import("./pages/ShopPage").then((m) => ({ default: m.ShopPage })));
const SupportPage = lazy(() => import("./pages/SupportPage").then((m) => ({ default: m.SupportPage })));
const FriendsPage = lazy(() => import("./pages/FriendsPage").then((m) => ({ default: m.FriendsPage })));
const BaccaratRoomPage = lazy(() => import("./pages/BaccaratRoomPage").then((m) => ({ default: m.BaccaratRoomPage })));
const BlackjackRoomPage = lazy(() => import("./pages/BlackjackRoomPage").then((m) => ({ default: m.BlackjackRoomPage })));
const DragonTigerRoomPage = lazy(() => import("./pages/DragonTigerRoomPage").then((m) => ({ default: m.DragonTigerRoomPage })));
const RouletteRoomPage = lazy(() => import("./pages/RouletteRoomPage").then((m) => ({ default: m.RouletteRoomPage })));
const SicBoRoomPage = lazy(() => import("./pages/SicBoRoomPage").then((m) => ({ default: m.SicBoRoomPage })));
const CrashRoomPage = lazy(() => import("./pages/CrashRoomPage").then((m) => ({ default: m.CrashRoomPage })));
const MoneyWheelRoomPage = lazy(() => import("./pages/MoneyWheelRoomPage").then((m) => ({ default: m.MoneyWheelRoomPage })));
const HiLoRoomPage = lazy(() => import("./pages/HiLoRoomPage").then((m) => ({ default: m.HiLoRoomPage })));
const TableGameRoomPage = lazy(() => import("./pages/TableGameRoomPage").then((m) => ({ default: m.TableGameRoomPage })));
const SlotRoomPage = lazy(() => import("./pages/SlotRoomPage").then((m) => ({ default: m.SlotRoomPage })));
const VideoPokerRoomPage = lazy(() => import("./pages/VideoPokerRoomPage").then((m) => ({ default: m.VideoPokerRoomPage })));
const PachinkoRoomPage = lazy(() => import("./pages/PachinkoRoomPage").then((m) => ({ default: m.PachinkoRoomPage })));
const HoldemRoomPage = lazy(() => import("./pages/HoldemRoomPage").then((m) => ({ default: m.HoldemRoomPage })));
const SutdaRoomPage = lazy(() => import("./pages/SutdaRoomPage").then((m) => ({ default: m.SutdaRoomPage })));
const SevenPokerRoomPage = lazy(() => import("./pages/SevenPokerRoomPage").then((m) => ({ default: m.SevenPokerRoomPage })));
const BadugiRoomPage = lazy(() => import("./pages/BadugiRoomPage").then((m) => ({ default: m.BadugiRoomPage })));
const GostopRoomPage = lazy(() => import("./pages/GostopRoomPage").then((m) => ({ default: m.GostopRoomPage })));
const TutorialPage = lazy(() => import("./pages/TutorialPage").then((m) => ({ default: m.TutorialPage })));
const AdminApp = lazy(() => import("./admin/AdminShell").then((m) => ({ default: m.AdminApp })));
const AdminDashboardPage = lazy(() => import("./pages/AdminDashboardPage").then((m) => ({ default: m.AdminDashboardPage })));
const AdminCoinsPage = lazy(() => import("./pages/AdminCoinsPage").then((m) => ({ default: m.AdminCoinsPage })));
const AdminSupportPage = lazy(() => import("./pages/AdminSupportPage").then((m) => ({ default: m.AdminSupportPage })));
const AdminUsersPage = lazy(() => import("./pages/AdminUsersPage").then((m) => ({ default: m.AdminUsersPage })));
const AdminUserDetailPage = lazy(() => import("./pages/AdminUserDetailPage").then((m) => ({ default: m.AdminUserDetailPage })));
const AdminGameHistoryPage = lazy(() => import("./pages/AdminGameHistoryPage").then((m) => ({ default: m.AdminGameHistoryPage })));
const AdminLobbyChatPage = lazy(() => import("./pages/AdminLobbyChatPage").then((m) => ({ default: m.AdminLobbyChatPage })));
const AdminGamesPage = lazy(() => import("./pages/AdminGamesPage").then((m) => ({ default: m.AdminGamesPage })));
const AdminStatsPage = lazy(() => import("./pages/AdminStatsPage").then((m) => ({ default: m.AdminStatsPage })));
const AdminLivePage = lazy(() => import("./pages/AdminLivePage").then((m) => ({ default: m.AdminLivePage })));
const AdminNoticesPage = lazy(() => import("./pages/AdminNoticesPage").then((m) => ({ default: m.AdminNoticesPage })));
const AdminAdminsPage = lazy(() => import("./pages/AdminAdminsPage").then((m) => ({ default: m.AdminAdminsPage })));
const AdminAuditLogPage = lazy(() => import("./pages/AdminAuditLogPage").then((m) => ({ default: m.AdminAuditLogPage })));

/**
 * 게임방 라우트의 경계. 방 화면(lazy 청크)이 오기 전에도 방이 쓰는 입장 화면(GameLoading)을 보여 준다 — 같은 방 id 로
 * 시작 시각을 기억하므로 청크가 오고 방이 같은 화면을 이어 그려도 끊김 없이 한 화면으로 보인다.
 */
function RoomScreen({ children }: { children: ReactNode }) {
  const { roomId } = useParams();
  return <Screen fallback={<GameLoading roomKey={roomId ?? ""} ready={false} />}>{children}</Screen>;
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ToastProvider>
  );
}

/**
 * 라우트 표. 로그인 여부·관리자 여부는 RequireAuth/RequireAdmin/RequirePlayer 가 판단한다 —
 * 예전에는 라우트마다 `token ? <화면/> : <Navigate/>` 를 손으로 써서, 한 줄만 빠뜨려도 로그아웃
 * 상태로 화면이 그려졌다. 각 화면은 Screen(에러 경계 + Suspense)으로 둘러서, 한 방이 던져도
 * 흰 화면 대신 "문제가 생겼습니다" 패널이 뜨고 헤더·소켓은 그대로 살아 있다.
 */
function AppRoutes() {
  const { token, user, ready, login, logout } = useAuth();

  if (!ready) return <RouteLoading label="로그인 상태 확인 중…" />;

  // RequireAuth 아래에서만 그려지므로 여기서 token 은 늘 채워져 있다. 방 화면들은 아직 props 로 받는다.
  const session = { token: token ?? "", onLogout: logout };

  const routes = (
    <Routes>
      {/* 약관·방침은 로그인 여부와 상관없이 열린다(가입 화면·푸터에서 링크). */}
      <Route path="/terms" element={<Screen><LegalPage doc="terms" /></Screen>} />
      <Route path="/privacy" element={<Screen><LegalPage doc="privacy" /></Screen>} />
      <Route path="/guide" element={<Screen><GuidePage /></Screen>} />

      <Route element={<RedirectIfAuthenticated />}>
        <Route path="/login" element={<Screen><LoginPage onLogin={login} /></Screen>} />
        <Route path="/signup" element={<Screen><SignupPage /></Screen>} />
      </Route>

      {/* 메인은 로그인 전에도 열린다(LobbyPage 가 로그인 여부로 공개/회원 로비를 가른다). /lobby 는 옛 주소 그대로 둔다. */}
      <Route path="/" element={<Screen><LobbyPage {...session} user={user} onLogin={login} /></Screen>} />
      <Route path="/lobby" element={<Screen><LobbyPage {...session} user={user} onLogin={login} /></Screen>} />

      <Route element={<RequireAuth />}>
        <Route path="/claim" element={<Screen><SignupPage claim /></Screen>} />
        <Route path="/lobby/:game" element={<Screen><GameRoomsPage {...session} user={user} /></Screen>} />
        <Route path="/wallet" element={<Screen><WalletPage {...session} /></Screen>} />
        <Route path="/profile" element={<Screen><ProfilePage {...session} /></Screen>} />
        <Route path="/game-history" element={<Screen><GameHistoryPage {...session} /></Screen>} />
        <Route path="/leaderboard" element={<Screen><LeaderboardPage {...session} /></Screen>} />
        <Route path="/missions" element={<Screen><MissionsPage {...session} /></Screen>} />
        <Route path="/auction" element={<Screen><AuctionPage {...session} /></Screen>} />
        <Route path="/shop" element={<Screen><ShopPage {...session} /></Screen>} />
        <Route path="/vip" element={<Screen><ShopPage {...session} initialTab="vip" /></Screen>} />
        <Route path="/r/:code" element={<Screen><PrivateRoomLink {...session} /></Screen>} />
        <Route path="/support" element={<RequirePlayer><Screen><SupportPage {...session} /></Screen></RequirePlayer>} />
        <Route path="/friends" element={<Screen><FriendsPage {...session} /></Screen>} />
        <Route path="/rooms/blackjack/:roomId" element={<RoomScreen><BlackjackRoomPage {...session} /></RoomScreen>} />
        <Route path="/rooms/dragon-tiger/:roomId" element={<RoomScreen><DragonTigerRoomPage {...session} /></RoomScreen>} />
        <Route path="/rooms/roulette/:roomId" element={<RoomScreen><RouletteRoomPage {...session} /></RoomScreen>} />
        <Route path="/rooms/sicbo/:roomId" element={<RoomScreen><SicBoRoomPage {...session} /></RoomScreen>} />
        <Route path="/rooms/crash/:roomId" element={<RoomScreen><CrashRoomPage {...session} /></RoomScreen>} />
        <Route path="/rooms/money-wheel/:roomId" element={<RoomScreen><MoneyWheelRoomPage {...session} /></RoomScreen>} />
        <Route path="/rooms/table/:roomId" element={<RoomScreen><TableGameRoomPage {...session} /></RoomScreen>} />
        <Route path="/rooms/slot/:roomId"element={<RoomScreen><SlotRoomPage {...session} /></RoomScreen>} />
        <Route path="/rooms/video-poker/:roomId" element={<RoomScreen><VideoPokerRoomPage {...session} /></RoomScreen>} />
        <Route path="/rooms/pachinko/:roomId" element={<RoomScreen><PachinkoRoomPage {...session} /></RoomScreen>} />
        <Route path="/rooms/hilo/:roomId" element={<RoomScreen><HiLoRoomPage {...session} /></RoomScreen>} />
        <Route path="/rooms/holdem/:roomId" element={<RoomScreen><HoldemRoomPage {...session} /></RoomScreen>} />
        <Route path="/rooms/sutda/:roomId" element={<RoomScreen><SutdaRoomPage {...session} /></RoomScreen>} />
        <Route path="/rooms/seven-poker/:roomId" element={<RoomScreen><SevenPokerRoomPage {...session} /></RoomScreen>} />
        <Route path="/rooms/badugi/:roomId" element={<RoomScreen><BadugiRoomPage {...session} /></RoomScreen>} />
        <Route path="/rooms/gostop/:roomId" element={<RoomScreen><GostopRoomPage {...session} /></RoomScreen>} />
        <Route path="/learn/:game" element={<Screen><TutorialPage {...session} /></Screen>} />
        <Route path="/rooms/:roomId" element={<RoomScreen><BaccaratRoomPage {...session} /></RoomScreen>} />
      </Route>

      <Route element={<RequireAdmin />}>
        <Route path="/admin" element={<Screen><AdminApp {...session} /></Screen>}>
          <Route index element={<Screen inline><AdminDashboardPage /></Screen>} />
          <Route path="live" element={<Screen inline><AdminLivePage /></Screen>} />
          <Route path="coins" element={<Screen inline><AdminCoinsPage /></Screen>} />
          <Route path="admins" element={<Screen inline><AdminAdminsPage /></Screen>} />
          <Route path="notices" element={<Screen inline><AdminNoticesPage /></Screen>} />
          <Route path="support" element={<Screen inline><AdminSupportPage /></Screen>} />
          <Route path="users" element={<Screen inline><AdminUsersPage /></Screen>} />
          <Route path="users/:userId" element={<Screen inline><AdminUserDetailPage /></Screen>} />
          <Route path="history" element={<Screen inline><AdminGameHistoryPage /></Screen>} />
          <Route path="games" element={<Screen inline><AdminGamesPage /></Screen>} />
          <Route path="stats" element={<Screen inline><AdminStatsPage /></Screen>} />
          <Route path="audit" element={<Screen inline><AdminAuditLogPage /></Screen>} />
          <Route path="lobby-chat" element={<Screen inline><AdminLobbyChatPage /></Screen>} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );

  if (!token) return routes;
  return (
    <SocketProvider token={token}>
      <FriendsProvider>
        <SiteToast />
        {routes}
      </FriendsProvider>
    </SocketProvider>
  );
}
