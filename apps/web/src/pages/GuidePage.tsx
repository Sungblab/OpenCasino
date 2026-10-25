import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Crown, Gift, Layers, LayoutGrid, LifeBuoy, MessageSquare, Sparkles, Store, X, type LucideIcon } from "lucide-react";
import {
  BONUS_BOX_COINS, BONUS_BOX_COOLDOWN_MS, BONUS_BOX_DAILY, DAILY_WHEEL_SEGMENTS, DAILY_WHEEL_STREAK, LEVEL_MILESTONES, MAX_LEVEL,
  MISSION_REWARDS, ROOM_CREATE_FEE, ROOM_CREATE_VIP_MIN, TABLE_TIERS, TABLE_TIER_LABEL, TIER_GATES, VIP_LABEL, VIP_PERKS,
  VIP_THRESHOLDS, VIP_TIERS, XP_DAILY_ROUND_CAP, levelReward, rankForLevel, vipBonusMultiplier,
} from "@opencasino/contracts";
import { useCurrentUser } from "../app/auth";
import { Brand } from "../components/Brand";
import { ResponsiblePlayNotice } from "../components/ResponsiblePlayNotice";
import { useFeatures } from "../lib/features";
import { LOBBY_CATEGORIES, LOBBY_GAMES } from "../lib/lobbyGames";
import { gateText } from "../lib/tiers";
import "../styles/guide.css";

/** 로비의 "처음이라면" 띠를 접었거나 가이드를 한 번 열었다. */
const SEEN_KEY = "opencasino.guideSeen";

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* 저장소가 막혀도 띠가 한 번 더 보일 뿐 */ }
}

function wasSeen() {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
}

const SECTIONS: ReadonlyArray<{ id: string; title: string; icon: LucideIcon }> = [
  { id: "start", title: "시작하기", icon: Sparkles },
  { id: "games", title: "게임 고르기", icon: LayoutGrid },
  { id: "tiers", title: "테이블 등급", icon: Layers },
  { id: "coins", title: "무료 코인", icon: Gift },
  { id: "level", title: "레벨·VIP", icon: Crown },
  { id: "shop", title: "상점·경매", icon: Store },
  { id: "social", title: "친구·채팅·기록", icon: MessageSquare },
  { id: "help", title: "도움받기", icon: LifeBuoy },
];

const CATEGORY_NOTE: Record<string, string> = {
  table: "딜러가 진행하는 판에 여럿이 함께 겁니다.",
  quick: "한 판이 짧아서 가볍게 즐기기 좋아요.",
  machine: "혼자 돌리는 기계 — 원할 때 바로 한 판.",
  pvp: "딜러 없이 사람끼리 겨룹니다. 가입한 회원만.",
};

/** 계급이 바뀌는 레벨. 앞 두 칸은 급·단이 레벨마다 하나씩 오른다. */
const RANK_STEPS: ReadonlyArray<[level: number, name?: string]> = [[1, "9급 → 1급"], [10, "1단 → 9단"], [19], [30], [45], [60], [80], [MAX_LEVEL]];

const coins = (value: number) => value.toLocaleString("ko-KR");
const hours = BONUS_BOX_COOLDOWN_MS / 3_600_000;

/**
 * 이용 가이드(/guide). 로그인 없이 열린다 — 처음 온 사람이 코인·게임·등급을 한 장에서 훑고, 칸마다 그 기능으로 바로 간다.
 * 숫자는 전부 contracts 상수에서 읽는다(규칙이 바뀌면 가이드도 같이). 게임별 족보·진행은 게임 안 도움말이 맡는다.
 */
export function GuidePage() {
  const user = useCurrentUser();
  const target = useFeatures()?.dailyCoins?.target;

  useEffect(() => {
    markSeen();
    // 다른 화면에서 /guide#coins 처럼 칸을 짚어 들어오면 그 칸으로.
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, []);

  const join = !user ? { to: "/signup", label: "회원가입" } : user.guest ? { to: "/claim", label: "가입하고 이어가기" } : null;

  return (
    <>
      <header className="topbar public-topbar">
        <Link className="brand-home" to="/" aria-label="OpenCasino 로비"><Brand /></Link>
        <div className="account">
          {join && <Link className="admin-nav-link public-login" to={join.to}>{join.label}</Link>}
          <Link className="admin-nav-link" to="/">로비로</Link>
        </div>
      </header>
      <main className="guide-page" id="main-content">
        <div className="guide-hero">
          <h1>이용 가이드</h1>
          <p>코인 받는 법부터 게임 고르기, 등급과 VIP까지 — 위에서부터 훑어보면 3분이면 충분해요.</p>
          <nav className="guide-toc" aria-label="가이드 목차">
            {SECTIONS.map(({ id, title, icon: Icon }) => (
              <a key={id} href={`#${id}`}><Icon size={15} aria-hidden="true" />{title}</a>
            ))}
          </nav>
        </div>

        <GuideSection id="start" go={[join ?? { to: "/", label: "로비로 가기" }]}>
          <p><b>OpenCasino 는 현금 가치가 없는 무료 코인으로 즐기는 카드·테이블 게임 사이트예요.</b> 코인은 사고팔거나 현금으로 바꿀 수 없어요.</p>
          <ul>
            <li><b>가입 없이 체험</b> — 첫 화면에서 하우스 게임 테이블을 누르면 체험 계정이 바로 만들어져요. 가입하면 그 코인과 기록이 그대로 이어지고 PvP·채팅·친구·랭킹이 열려요.</li>
            <li><b>매일 무료 코인</b> — 잔액이 {target ? <>{coins(target)}코인</> : "기준"}보다 적으면 하루 한 번 로비 위 띠에서 {target ? `${coins(target)}코인까지` : "기준까지"} 채워 받을 수 있어요(자정에 다시).</li>
          </ul>
        </GuideSection>

        <GuideSection id="games" go={[{ to: "/learn/sutda", label: "섯다 연습하기" }, { to: "/learn/holdem", label: "홀덤 연습하기" }]}>
          <p>로비는 게임마다 한 줄이에요. 위의 칩으로 묶음을 거를 수 있고, 줄 머리의 <b>바로 시작</b>은 지금 들어갈 수 있는 첫 테이블로 데려가요.</p>
          <div className="guide-categories">
            {LOBBY_CATEGORIES.filter((category) => category.key !== "all").map((category) => (
              <div key={category.key} className="guide-category">
                <strong>{category.label}</strong>
                <small>{CATEGORY_NOTE[category.key]}</small>
                <p>{LOBBY_GAMES.filter((game) => game.category === category.key).map((game) => <span key={game.key}>{game.label}</span>)}</p>
              </div>
            ))}
          </div>
          <ul>
            <li><b>규칙이 궁금하면</b> — 게임 안 오른쪽 위 메뉴의 <b>도움말</b>에 족보·진행 순서·버튼 설명이 있어요.</li>
            <li><b>PvP 는 방 목록</b>에서 빠른 시작·방 만들기·비공개 코드로 들어가요. 섯다·홀덤은 코인이 오가지 않는 연습 판도 있어요.</li>
          </ul>
        </GuideSection>

        <GuideSection id="tiers">
          <p>같은 게임도 판돈에 따라 네 등급 테이블로 나뉘어요. 등급이 높을수록 베팅 단위가 커지고, 조건이 안 맞는 테이블엔 자물쇠와 이유가 보여요.</p>
          <div className="guide-table" role="table" aria-label="테이블 등급">
            <div role="row" className="is-head"><span role="columnheader">등급</span><span role="columnheader">입장 조건</span><span role="columnheader">PvP 방 만들기</span></div>
            {TABLE_TIERS.map((tier) => (
              <div role="row" key={tier}>
                <span role="cell"><b>{TABLE_TIER_LABEL[tier]}</b></span>
                <span role="cell">{gateText(tier, false)}</span>
                <span role="cell">{coins(ROOM_CREATE_FEE[tier])}코인{tier === "vip" && ` · VIP ${VIP_LABEL[ROOM_CREATE_VIP_MIN]}부터`}</span>
              </div>
            ))}
          </div>
          {TIER_GATES.rookie.pvpMaxBalance !== null && (
            <p className="guide-aside">PvP {TABLE_TIER_LABEL.rookie} 방은 잔액 {coins(TIER_GATES.rookie.pvpMaxBalance)}코인 이하만 들어갈 수 있어요 — 입문 방을 큰손이 휩쓸지 않게.</p>
          )}
        </GuideSection>

        <GuideSection id="coins" go={[{ to: "/missions", label: "오늘의 미션" }, { to: "/", label: "로비에서 받기" }]}>
          <p>코인은 아래 방법으로 매일 무료로 생겨요. 휠·상자·미션은 로비 오른쪽 <b>오늘의 보상</b>(폰은 접힌 한 줄)에 모여 있어요.</p>
          <div className="guide-facts">
            <Fact label="데일리 휠" value={`${coins(Math.min(...DAILY_WHEEL_SEGMENTS))}~${coins(Math.max(...DAILY_WHEEL_SEGMENTS))}`}>
              하루 한 번. 연속 출석하면 ×{DAILY_WHEEL_STREAK[0]} → ×{DAILY_WHEEL_STREAK.at(-1)}({DAILY_WHEEL_STREAK.length}일차)까지 커지고, 하루 빠지면 1일차로.
            </Fact>
            <Fact label="무료 상자" value={`${coins(BONUS_BOX_COINS)}`}>{hours}시간마다 열 수 있고 하루 {BONUS_BOX_DAILY}번까지.</Fact>
            <Fact label="오늘의 미션" value={`${coins(MISSION_REWARDS[0])}~${coins(MISSION_REWARDS.at(-1)!)}`}>매일 쉬움·보통·어려움 세 개({MISSION_REWARDS.map(coins).join(" · ")}). 자정에 새로 나와요.</Fact>
            <Fact label="레벨 업" value={`Lv × ${levelReward(1)}`}>오른 레벨마다 — Lv10 이 되면 {coins(levelReward(10))}코인.</Fact>
          </div>
          <p className="guide-aside">VIP 등급이 있으면 휠·상자 보상이 등급마다 10%씩 더 커져요.</p>
        </GuideSection>

        <GuideSection id="level" go={[{ to: "/vip", label: "내 VIP 보기" }, { to: "/leaderboard", label: "랭킹" }]}>
          <p><b>레벨</b>은 코인을 건 판마다 XP 1 씩 쌓여 올라요(하루 {XP_DAILY_ROUND_CAP}판까지, 최고 Lv{MAX_LEVEL}). 레벨에 따라 계급이 붙고, Lv{Object.keys(LEVEL_MILESTONES).join("·")} 에 닿으면 명패·칭호를 받아요.</p>
          <ol className="guide-ranks" aria-label="계급">
            {RANK_STEPS.map(([level, name]) => {
              const rank = rankForLevel(level);
              return <li key={level} style={{ "--rank": rank.color } as CSSProperties}><small>Lv{level}</small><b>{name ?? rank.name}</b></li>;
            })}
          </ol>
          <p><b>VIP</b>는 한 번 오르면 내려가지 않는 평생 등급이에요. 포인트는 상점·방 개설비·경매에 쓴 코인과, 딜러 게임에 건 금액 중 하우스 몫(평균적으로 잃는 만큼)으로 쌓여요.</p>
          <div className="guide-table is-vip" role="table" aria-label="VIP 등급">
            <div role="row" className="is-head"><span role="columnheader">등급</span><span role="columnheader">포인트</span><span role="columnheader">열리는 것</span></div>
            {VIP_TIERS.map((tier) => (
              <div role="row" key={tier}>
                <span role="cell"><b>{VIP_LABEL[tier]}</b></span>
                <span role="cell">{coins(VIP_THRESHOLDS[tier])}</span>
                <span role="cell">{VIP_PERKS[tier]}<small>휠·상자 보상 +{Math.round((vipBonusMultiplier(tier) - 1) * 100)}%</small></span>
              </div>
            ))}
          </div>
        </GuideSection>

        <GuideSection id="shop" go={[{ to: "/shop", label: "상점" }, { to: "/auction", label: "경매" }]}>
          <ul>
            <li><b>상점</b> — 카드 뒷면·펠트·명패·승리 연출·칭호·닉네임 색을 코인으로 사서 꾸며요. 꾸밈일 뿐 확률·배당과는 상관없어요. <b>이번 주 한정</b> 칸은 월요일 0시에 바뀌어요.</li>
            <li><b>주간 경매</b> — 매주 한정 칭호 하나를 두고 겨뤄요. 일요일 21시 마감, 입찰가가 밀리면 건 코인은 바로 돌려받아요.</li>
          </ul>
        </GuideSection>

        <GuideSection id="social" go={[{ to: "/friends", label: "친구" }, { to: "/game-history", label: "게임 기록" }]}>
          <ul>
            <li><b>전체 채팅</b> — 위 띠의 말풍선 버튼. 게임 방 안에는 그 방 사람끼리의 채팅이 따로 있어요.</li>
            <li><b>친구·1:1 메시지</b> — 오른쪽 위 프로필 메뉴(폰은 아래 탭 <b>친구</b>). 친구 대화창에서 코인을 보낼 수도 있어요.</li>
            <li><b>게임 기록·랭킹</b> — 내가 한 판마다 결과와 손익이 남고, 랭킹에서 다른 사람과 견줘 볼 수 있어요.</li>
          </ul>
          <p className="guide-aside">체험 계정은 채팅·친구·PvP·랭킹을 쓸 수 없어요 — 가입하면 바로 열려요.</p>
        </GuideSection>

        <GuideSection id="help" go={[{ to: "/support", label: "1:1 문의" }]}>
          <p>막히는 게 있으면 1:1 문의로 운영자에게 직접 물어보세요. 게임 하나의 규칙은 그 게임 안 메뉴의 도움말이 가장 자세해요.</p>
          <ResponsiblePlayNotice placement="footer" />
        </GuideSection>
      </main>
    </>
  );
}

function GuideSection({ id, go, children }: { id: string; go?: ReadonlyArray<{ to: string; label: string }>; children: ReactNode }) {
  const { title, icon: Icon } = SECTIONS.find((section) => section.id === id)!;
  return (
    <section className="guide-card" id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}><Icon size={18} aria-hidden="true" />{title}</h2>
      {children}
      {go && (
        <div className="guide-go">
          {go.map((link, index) => (
            <Link key={link.to + link.label} to={link.to} className={index === 0 ? "gold-button" : "app-secondary-button"}>{link.label}</Link>
          ))}
        </div>
      )}
    </section>
  );
}

function Fact({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="guide-fact">
      <small>{label}</small>
      <strong>{value}<span>코인</span></strong>
      <p>{children}</p>
    </div>
  );
}

/** 로비 위 "처음이라면" 띠. 접거나 가이드를 한 번 열면 다시 안 뜬다. */
export function GuideNudge() {
  const [seen, setSeen] = useState(wasSeen);
  if (seen) return null;
  return (
    <aside className="guide-nudge" role="note">
      <BookOpen size={22} aria-hidden="true" />
      <p>
        <strong>처음이라면 이용 가이드부터 보세요</strong>
        <span>무료 코인 받는 법 · 게임 고르기 · 테이블 등급 · 레벨과 VIP를 한 장에.</span>
      </p>
      <Link to="/guide" className="gold-button guide-nudge-go">가이드 보기</Link>
      <button type="button" className="guide-nudge-close" aria-label="가이드 안내 닫기" onClick={() => { markSeen(); setSeen(true); }}>
        <X size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}
