import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Eye } from "lucide-react";
import { TABLE_TIER_LABEL, type AdminLivePerson, type AdminLiveResponse, type AdminLiveRoom, type GameRoom } from "@opencasino/contracts";
import { useAdminData, useAdminPoll } from "../admin/AdminData";
import { getAdminLive } from "../adminToolsApi";
import { GAME_TYPE_LABEL } from "../lib/gameLabels";
import { PHASE_LABEL, roomHref } from "../lib/lobbyGames";
import { AdminKpi, AdminPanelHeading, AdminView } from "./AdminView";

const PVP = new Set(["holdem", "sutda", "gostop", "seven_poker", "badugi"]);
type Kind = "all" | "pvp" | "house" | "solo";
const KIND_LABEL: Record<Kind, string> = { all: "전체", pvp: "PvP", house: "하우스", solo: "1인 게임" };
const kindOf = (room: AdminLiveRoom): Exclude<Kind, "all"> => (room.solo ? "solo" : PVP.has(room.gameType) ? "pvp" : "house");

const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
const tone = (value: number) => (value > 0 ? "amount-positive" : value < 0 ? "amount-negative" : "");

/**
 * 지금 누가 어느 방에서 치고 있는지. 사람이 들어간 방만 카드로 보이고, 카드의 "관전"은 그 방 화면을 연다 —
 * 관리자는 입장 기준을 건너뛰고, PvP 는 앉지 않으면 관전이라 판에 끼어들지 않는다. 혼자 하는 게임은 같은 방에
 * 들어가도 남의 판이 안 보이므로 관전 대신 최근 판을 보여준다.
 */
export function AdminLivePage() {
  const { token } = useAdminData();
  const load = useCallback(() => getAdminLive(token), [token]);
  const { data, error } = useAdminPoll(load, 5_000);
  const [kind, setKind] = useState<Kind>("all");
  const rooms = useMemo(() => (data?.rooms ?? []).filter((room) => kind === "all" || kindOf(room) === kind), [data, kind]);

  return (
    <AdminView title="실시간 현황" meta="5초마다 갱신">
      <LiveKpis live={data} />
      {error && <p className="error-message">{error}</p>}
      <section className="admin-live-section">
        <AdminPanelHeading title="게임 중인 방" action={
          <div className="admin-filter-tabs" role="tablist" aria-label="게임 종류">
            {(Object.keys(KIND_LABEL) as Kind[]).map((value) => (
              <button key={value} type="button" role="tab" aria-selected={kind === value} className={kind === value ? "active" : ""} onClick={() => setKind(value)}>{KIND_LABEL[value]}</button>
            ))}
          </div>
        } />
        {data === null ? (
          <p className="admin-empty-copy">불러오는 중…</p>
        ) : rooms.length === 0 ? (
          <p className="admin-empty-copy">{data.rooms.length === 0 ? "지금 게임 중인 사람이 없습니다. 누가 방에 들어가면 여기에 바로 나타납니다." : `${KIND_LABEL[kind]} 방에 들어간 사람이 없습니다.`}</p>
        ) : (
          <div className="admin-live-board">{rooms.map((room) => <LiveRoomCard key={room.id} room={room} />)}</div>
        )}
      </section>
      {data && data.lobby.length > 0 && (
        <section className="admin-panel admin-full-panel admin-live-lobby">
          <AdminPanelHeading title="방 밖 접속자" note={`${data.lobby.length}명 · 로비·지갑 등`} />
          <ul className="admin-live-chips">
            {data.lobby.map((person) => (
              <li key={person.userId}><Link to={`/admin/users/${person.userId}`}>{person.nickname}<PersonTag person={person} /></Link><small>{person.balance.toLocaleString()}</small></li>
            ))}
          </ul>
        </section>
      )}
    </AdminView>
  );
}

/** 통합 현황 맨 위에도 같은 줄을 쓴다. */
export function LiveKpis({ live }: { live: AdminLiveResponse | null }) {
  const value = (count: number | undefined) => (count === undefined ? "—" : `${count.toLocaleString()}명`);
  return (
    <section className="admin-kpi-grid admin-live-kpis" aria-label="접속 현황">
      <AdminKpi label="접속 중" value={value(live?.online)} />
      <AdminKpi label="게임 중" value={value(live?.playing)} tone={live?.playing ? "positive" : ""} />
      <AdminKpi label="방 밖" value={value(live?.lobby.length)} />
      <AdminKpi label="열린 판" value={live ? `${live.rooms.length}개` : "—"} />
    </section>
  );
}

function LiveRoomCard({ room }: { room: AdminLiveRoom }) {
  const seatedCount = room.people.filter((person) => person.seated).length;
  const counts = [
    `${room.people.length}명`,
    room.people.some((person) => person.seated !== null) ? `앉음 ${seatedCount}` : null,
    room.bots > 0 ? `봇 ${room.bots}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <article className="admin-live-room">
      <header>
        <span className={`admin-room-led ${room.paused ? "paused" : "live"}`} aria-hidden="true" />
        <div className="admin-live-room-title">
          <strong>{GAME_TYPE_LABEL[room.gameType]}<span>{room.name}</span></strong>
          <small>
            {!room.solo && <b>{PHASE_LABEL[room.phase as GameRoom["phase"]] ?? room.phase}</b>}
            {counts}
            {room.tier !== "rookie" && <em>{TABLE_TIER_LABEL[room.tier]}</em>}
            {room.private && <em>비공개</em>}
            {room.custom && <em>{room.ownerNickname ? `${room.ownerNickname}의 방` : "사용자 방"}</em>}
            {room.paused && <em className="is-warning">일시정지</em>}
          </small>
        </div>
        {room.solo
          ? <span className="admin-live-solo" title="혼자 하는 게임이라 같은 방에 들어가도 남의 판이 보이지 않습니다">1인 게임</span>
          : <Link className="admin-small-button admin-live-watch" to={roomHref(room)}><Eye size={14} aria-hidden="true" />관전</Link>}
      </header>
      <ul className="admin-live-people">
        {room.people.map((person) => <LivePersonRow key={person.userId} person={person} solo={room.solo} />)}
      </ul>
    </article>
  );
}

function LivePersonRow({ person, solo }: { person: AdminLivePerson; solo: boolean }) {
  return (
    <li>
      <span className={`admin-live-seat${person.seated === null ? " is-none" : person.seated ? " is-seated" : ""}`} title={person.seated === null ? undefined : person.seated ? "앉음" : "관전"} aria-label={person.seated === null ? undefined : person.seated ? "앉음" : "관전"} />
      <Link className="admin-live-name" to={`/admin/users/${person.userId}`}>{person.nickname}<PersonTag person={person} /></Link>
      <span className="admin-live-money">
        <span>{person.balance.toLocaleString()}</span>
        <small className={tone(person.todayNet)} title="오늘 손익">{person.todayNet === 0 ? "오늘 0" : `오늘 ${signed(person.todayNet)}`}</small>
      </span>
      {solo && (
        <span className="admin-live-recent" aria-label="최근 판">
          {person.recent.length === 0
            ? <small>아직 판 없음</small>
            : person.recent.map((bet, index) => <i key={index} className={tone(bet.net)} title={`${bet.amount.toLocaleString()}코인 베팅 · ${new Date(bet.at).toLocaleTimeString("ko-KR", { hour12: false })}`}>{signed(bet.net)}</i>)}
        </span>
      )}
    </li>
  );
}

function PersonTag({ person }: { person: Pick<AdminLivePerson, "role" | "isGuest"> }) {
  if (person.role === "admin") return <em className="admin-live-tag">관리자</em>;
  if (person.isGuest) return <em className="admin-live-tag">게스트</em>;
  return null;
}
