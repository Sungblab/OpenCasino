import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { GameType } from "@opencasino/contracts";
import "../styles/game-loading.css";

/**
 * 방에 들어갈 때 게임 화면 전체를 덮는 첫 화면. 판(3D·캔버스)이 실제로 보이기 시작할 때까지 덮어 두어, 그동안은
 * 칩도 베팅 칸도 누를 수 없다 — 반쯤 그려진 판에서 첫 판 베팅 시간이 흘러가던 일을 화면 쪽에서 막는다(빈 방의 첫 판은
 * 서버가 table.ready 를 받고 연다).
 *
 * 모양은 우리 것이고 일부러 단순하다(2026-10-23 사용자: "칩 쌓이는 것·테이블 빼고 심플하게, 로딩바, 팁은 좋고, GOLDEN
 * CASINO 글자"): 사이트 바탕에 OPENCASINO 글자, 그 아래 로딩바, 게임·방 이름 한 줄, 팁 한 줄. 금빛 그라데이션 제목·
 * 반짝이 선·로고 메달 같은 에볼루션 시작 화면의 짜임새는 쓰지 않는다("너무 따라 했다", "GC 로고는 별로").
 * 게임마다 다른 건 바탕 아래쪽에 비치는 펠트 색(--gl-felt)뿐이다.
 *
 * 연결 전(스냅숏 없음)과 연결 후(GameShell 안)에 서로 다른 자리에서 그려지므로, 시작 시각은 모듈에 들고 있다 —
 * 자리가 바뀌어 다시 마운트돼도 로딩바가 처음부터 다시 차지 않는다.
 */

interface Art { title: string; felt: string; tips: readonly string[] }

const BACCARAT_TIPS = [
  "뱅커로 이기면 수수료 5%를 뗀 0.95배를 받습니다.",
  "타이가 나오면 플레이어·뱅커에 건 돈은 그대로 돌려받습니다.",
  "타이는 8배, 플레이어·뱅커 페어는 11배입니다.",
];
const SICBO_TIPS = [
  "주사위 셋의 합이 4~10이면 스몰, 11~17이면 빅입니다.",
  "트리플(셋 다 같은 눈)이 나오면 스몰·빅은 집니다.",
];
const ROULETTE_TIPS = [
  "숫자 하나는 35배, 레드·블랙·홀짝·하이로우는 1배입니다.",
  "숫자 사이 선을 누르면 스플릿, 네 칸이 만나는 점을 누르면 코너 베팅입니다.",
  "레이스트랙 버튼으로 휠에서 이웃한 번호들에 한 번에 걸 수 있습니다.",
];
const BLACKJACK_TIPS = [
  "처음 두 장으로 21(블랙잭)이면 1.5배를 받습니다.",
  "딜러는 16 이하면 반드시 받고, 17 이상이면 멈춥니다.",
  "처음 두 장 뒤 서렌더하면 베팅의 절반을 돌려받고 그 판을 접습니다.",
];

const ART: Partial<Record<GameType, Art>> = {
  baccarat: { title: "Baccarat", felt: "#5b1218", tips: BACCARAT_TIPS },
  bonus_baccarat: { title: "Bonus Baccarat", felt: "#5b1218", tips: [...BACCARAT_TIPS, "보너스 베팅은 이긴 쪽이 점수 차를 크게 벌릴수록 배당이 커집니다."] },
  lightning_baccarat: { title: "Lightning Baccarat", felt: "#1d2350", tips: BACCARAT_TIPS },
  dragon_tiger: { title: "Dragon Tiger", felt: "#4d1111", tips: ["카드 한 장씩, 높은 쪽이 이깁니다. K가 가장 높고 A가 가장 낮습니다.", "타이는 11배, 같은 무늬 타이는 50배입니다.", "타이가 나오면 드래곤·타이거에 건 돈은 절반을 돌려받습니다."] },
  blackjack: { title: "Blackjack", felt: "#0f4a2e", tips: BLACKJACK_TIPS },
  lightning_blackjack: { title: "Lightning Blackjack", felt: "#1d2350", tips: BLACKJACK_TIPS },
  roulette: { title: "Roulette", felt: "#0f4a2e", tips: ROULETTE_TIPS },
  lightning_roulette: { title: "Lightning Roulette", felt: "#1d2350", tips: ["번개 맞은 번호에 스트레이트로 걸었다면 그 배수만큼 받습니다.", "번개가 치지 않은 번호의 스트레이트는 30배입니다.", ...ROULETTE_TIPS.slice(1)] },
  sic_bo: { title: "Sic Bo", felt: "#0d4246", tips: SICBO_TIPS },
  super_sic_bo: { title: "Super Sic Bo", felt: "#1d2350", tips: SICBO_TIPS },
  slot: { title: "Slots", felt: "#4a2c0c", tips: ["스핀 결과는 서버가 정하고, 릴은 그 결과를 보여 줄 뿐입니다.", "베팅 금액을 바꿔도 당첨 확률은 같습니다."] },
  video_poker: { title: "Video Poker", felt: "#14305c", tips: ["잭 이상 원페어부터 당첨입니다.", "남길 카드를 고른 뒤, 나머지를 한 번 바꿔 받습니다."] },
  pachinko: { title: "Pachinko", felt: "#10285a", tips: ["구슬은 못에 부딪히며 좌우로 튑니다. 가운데 칸이 가장 잘 맞고, 가장자리일수록 드뭅니다.", "안정·보통·도전은 같은 판에 배당만 다릅니다. 도전은 가장자리가 110배입니다."] },
  money_wheel: { title: "Money Wheel", felt: "#3a1660", tips: ["휠이 멈춘 칸의 숫자만큼 받습니다. 10에 걸고 10에 서면 10배입니다.", "2x·7x 칸에 서면 한 번 더 돌리고, 다음 결과에 그 배수가 곱해집니다."] },
  crash: { title: "Crash", felt: "#122a52", tips: ["배수가 오르는 동안 언제든 캐시아웃할 수 있습니다.", "터지기 전에 캐시아웃하지 못하면 그 판 베팅은 사라집니다."] },
  // 팁은 game-core 의 규칙 주석과 같은 말이어야 한다.
  hilo: { title: "Hi-Lo", felt: "#0f4a35", tips: ["2가 가장 낮고 A가 가장 높습니다.", "같은 숫자가 나와도 이깁니다(높거나 같음 · 낮거나 같음).", "맞힐 때마다 캐시아웃하거나, 나온 카드로 이어서 도전할 수 있습니다."] },
  // 표 게임(TableGameRoomPage).
  bac_bo: { title: "Bac Bo", felt: "#12304f", tips: ["주사위 두 개씩 굴려 합이 높은 쪽이 이깁니다.", "합이 같으면 플레이어·뱅커 베팅은 돌려받습니다."] },
  mega_ball: { title: "Mega Ball", felt: "#3a1660", tips: ["공 12개 중 내 번호가 나오면 이깁니다.", "마지막 한 개가 메가볼입니다."] },
  top_card: { title: "Top Card", felt: "#0f4a2e", tips: ["스페이드·하트·다이아·클럽 중 가장 높은 카드가 이깁니다.", "가장 높은 카드가 같으면 그 자리는 베팅금을 돌려받습니다."] },
};
const PLAIN: Art = { title: "", felt: "#2a1c0e", tips: [] };

/** 다 준비돼도 이만큼은 보여 준다 — 번쩍 지나가면 화면이 깜빡인 것처럼 보인다. */
const MIN_SHOW_MS = 900;
const FADE_MS = 450;

/** 지금 들어와 있는 방 한 번. readyAt 이 찍히면 그 방에서는 다시 덮지 않는다(재접속·리렌더로 ready 가 잠깐 false 가 돼도). */
let session: { key: string; startedAt: number; readyAt: number | null; tipSeed: number } | null = null;

function sessionFor(key: string) {
  if (session?.key !== key) session = { key, startedAt: performance.now(), readyAt: null, tipSeed: Math.random() };
  return session;
}

/** 기다리는 동안은 90% 쪽으로 점점 느리게 차고("아직"이라는 신호), 준비되면 끝까지 찬다. */
function creep(elapsedMs: number): number {
  return 0.9 * (1 - Math.exp(-elapsedMs / 2200));
}

export function GameLoading({ game, title, roomKey, roomName, ready, step, error, backTo = "/lobby" }: {
  /** 스냅숏이 오기 전(연결 중)에는 모른다 — 그동안은 이름 없이, 알게 되면 이름과 팁이 뜬다. */
  game?: GameType;
  /** 게임 종류 이름 대신 쓸 이름(슬롯은 기계마다 — Lucky Cherry 등). */
  title?: string;
  /** 같은 방 입장 한 번을 가리키는 값(방 id). 다른 방에 들어가면 처음부터 다시 잰다. */
  roomKey: string;
  roomName?: string;
  ready: boolean;
  /** 지금 무엇을 기다리는지, 연결 실패 안내. 있으면 팁 대신 이걸 보인다. */
  step?: string;
  /** 들어가지 못한 이유(등급·잔액 제한, 없는 방 등). 있으면 진행을 멈추고 이유와 나가는 버튼을 보인다 — 칩 더미와 %가
   *  그대로 있으면 "멈춘 로딩"으로 읽혔다. */
  error?: string;
  /** 기다리다 나갈 수 있게 — 연결이 안 되면 이 화면에 갇힌다. */
  backTo?: string;
}) {
  const base = (game && ART[game]) || PLAIN;
  const art = title ? { ...base, title } : base;
  const entry = sessionFor(roomKey);
  if (ready && entry.readyAt === null) entry.readyAt = performance.now();
  const [now, setNow] = useState(() => performance.now());

  // 이 화면 제목의 세리프를 덮개가 떠 있는 동안 받아 둔다(처음엔 대체 글꼴로 보이다 바뀌지 않게).
  useEffect(() => {
  }, []);

  const hideAt = entry.readyAt === null ? null : Math.max(entry.readyAt, entry.startedAt + MIN_SHOW_MS);
  const gone = hideAt !== null && now >= hideAt + FADE_MS;

  useEffect(() => {
    if (gone) return;
    let frame = 0;
    const tick = () => { setNow(performance.now()); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    // 가려진 탭은 rAF 가 멈춘다 — 그래도 걷히게 타이머로 한 번 더 깨운다.
    const timer = hideAt === null ? 0 : window.setTimeout(() => setNow(performance.now()), Math.max(0, hideAt + FADE_MS - performance.now()) + 20);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [gone, hideAt]);

  if (error) {
    return (
      <div className="gl-cover is-error" style={{ "--gl-felt": art.felt } as CSSProperties} role="alert">
        <div className="gl-center">
          <strong className="gl-wordmark">OPENCASINO</strong>
          <p className="gl-room">{[art.title, roomName].filter(Boolean).join(" · ") || " "}</p>
          <p className="gl-error">{error}</p>
          <Link className="gl-leave" to={backTo}>게임 목록으로</Link>
        </div>
      </div>
    );
  }

  if (gone) return null;
  const waited = creep((entry.readyAt ?? now) - entry.startedAt);
  const progress = entry.readyAt === null ? waited : waited + (1 - waited) * Math.min(1, (now - entry.readyAt) / 350);
  const leaving = hideAt !== null && now >= hideAt;
  const tip = art.tips.length ? art.tips[Math.floor(entry.tipSeed * art.tips.length)] : null;

  return (
    <div
      className={`gl-cover ${leaving ? "is-leaving" : ""}`}
      style={{ "--gl-felt": art.felt } as CSSProperties}
      role="status"
      aria-live="polite"
      aria-label={`${roomName ?? art.title} 불러오는 중`}
    >
      <Link className="gl-back" to={backTo} replace aria-label="게임 목록으로 돌아가기">←</Link>
      <div className="gl-center">
        <strong className="gl-wordmark">OPENCASINO</strong>
        <span className="gl-bar" aria-hidden="true"><i style={{ transform: `scaleX(${progress})` }} /></span>
        <p className="gl-room">{[art.title, roomName].filter(Boolean).join(" · ") || " "}</p>
        <p className="gl-tip">{step ?? (tip ? <><em>TIP</em>{tip}</> : " ")}</p>
      </div>
    </div>
  );
}
