/*
 * Stylesheet order. It decides the cascade, so keep it as written.
 *
 * app-ui.css comes first because it declares the @layer order once for the whole app:
 * base (tokens, element defaults, scrollbars, default focus ring) < components (toast, error, 404,
 * skeleton, empty state, bottom tab bar) < pages < tables < overrides. Only base and components
 * hold rules today. Everything else is unlayered, and unlayered CSS beats every layer, so the
 * order of the unlayered sheets below still matters:
 *   app-ui.css (its unlayered focus/dropdown patches win over styles.css by specificity)
 *   → styles.css → the PvP table sheets (table-holdem, table-sutda, table-pvp,
 *     table-gostop, in that order) → game-guide, deck-shoe
 *   → mobile-perf.css last (it undoes table effects on phones by coming later)
 *   → the canvas-table sheets (baccarat-table, dragon-tiger-table, blackjack-table), imported by
 *     their room pages and so loaded after all of these, plus the parts they share (stage-canvas,
 *     chip-pile), imported by StageCanvas / ChipPile / tableFx themselves.
 * Moving styles.css or the table sheets into layers is blocked on the PvP sheets: many of their
 * rules lose to styles.css today by specificity alone, and putting one side in a layer would flip
 * those regardless of specificity. See the header of app-ui.css.
 */
import "./styles/app-ui.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { installChunkReloadGuard, RootErrorBoundary } from "./app/ErrorBoundary";
import { COMMON_SOUNDS, installAudioUnlock, preloadSounds } from "./lib/sound";
import "./styles.css";
import "./styles/legal.css";
import "./styles/admin-polish.css";
import "./styles/table-holdem.css";
import "./styles/table-sutda.css";
// PvP 세 게임 공통(좌석 기하·위 띠·독·내 줄·좌석) — 게임별 파일 사이에 둔다: 섯다의 장판 규칙을
// 덮고, 홀덤 v5·고스톱 파일이 그 위에 게임 고유 모양을 얹는다.
import "./styles/table-pvp.css";
// 섯다 v6(캔버스 판) — 공용 PvP 규칙 뒤에 와야 이름표·독 모양을 덮는다.
import "./styles/table-sutda-v6.css";
// 맞고 v2(캔버스 판) — 섯다 v6 와 같은 틀.
import "./styles/table-gostop-v2.css";
// 홀덤 v6(캔버스 판) — 같은 틀.
import "./styles/table-holdem-v6.css";
import "./styles/game-guide.css";
import "./styles/deck-shoe.css";
// 폰 전용 성능 오버라이드 — 앞의 테이블 스타일을 덮어야 해서 마지막에 온다.
import "./styles/mobile-perf.css";
// 이름·제목에만 쓰는 세리프 — 어디에 쓰는지 한 파일에 모은다.
import "./styles/typography.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* 라우트마다 경계가 따로 있지만, 라우터·프로바이더 자체가 던지면 그 바깥에서 받아야 흰 화면이 안 된다. */}
    <RootErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </RootErrorBoundary>
  </StrictMode>,
);

// 배포 직후 옛 청크를 부르다 실패하면 한 번 새로고침해서 새 빌드를 받는다(ErrorBoundary.tsx 참고).
installChunkReloadGuard();

// Off the critical path — the first game sound shouldn't be the one waiting on the download.
installAudioUnlock();
(window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200)))(() => preloadSounds(COMMON_SOUNDS));
