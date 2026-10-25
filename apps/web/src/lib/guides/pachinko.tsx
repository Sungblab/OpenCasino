import { PACHINKO_PAY_PERMILLE, PACHINKO_RISKS, PACHINKO_RISK_LABEL, pachinkoMultiplierText, pachinkoRtpPercent } from "@opencasino/game-core/pachinko";
import { GuideActions, GuideNote, GuideSteps, ODDS_TIMES, startSection, type GameGuideContent } from "../../components/GameGuide";

/** 위험도마다 맨 끝·가운데 배수를 한 줄로. 숫자는 game-core 표에서 읽는다 — 표를 바꾸면 안내도 같이 바뀐다. */
const EDGE = (risk: (typeof PACHINKO_RISKS)[number]) => pachinkoMultiplierText(PACHINKO_PAY_PERMILLE[risk][0]!);
const MIDDLE = (risk: (typeof PACHINKO_RISKS)[number]) => pachinkoMultiplierText(PACHINKO_PAY_PERMILLE[risk][6]!);

export const pachinkoGuide: GameGuideContent = {
  gameKey: "pachinko",
  title: "파친코",
  intro: "구슬을 떨어뜨리면 못에 부딪히며 좌우로 튀다가 아래 칸에 들어가요. 들어간 칸의 배수만큼 돌려받습니다.",
  sections: [
    startSection({ steps: [{ title: "위험도 고르기", body: "안정 · 보통 · 도전 중 하나. 처음엔 안정이 좋아요." }, { title: "베팅 고르기", body: "− / + 로 구슬 한 알의 금액을 정해요." }, { title: "DROP", body: "누를 때마다 구슬이 하나씩 떨어지고, 들어간 칸의 배수만큼 돌려받아요." }], tip: "안정에 작은 베팅으로 몇 알 떨어뜨려 보세요. 가운데 칸은 1보다 작은 배수라 원금보다 적게 돌아오고, 가장자리로 갈수록 드물지만 커요.", odds: ODDS_TIMES }),
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "위험도 고르기", body: "안정 · 보통 · 도전. 같은 판이고 칸의 배당만 달라요. 아래 칸의 숫자가 곧 배수예요." },
              { title: "베팅 고르기", body: "− / + 로 구슬 한 알의 베팅을 골라요. 0.2코인부터 방의 최대까지예요." },
              { title: "DROP", body: "누를 때마다 구슬이 한 알씩 떨어져요. 판 위에 여러 알이 동시에 있어도 돼요. 스페이스·엔터로도 돼요." },
              { title: "AUTO", body: "켜 두면 일정한 간격으로 계속 떨어뜨려요. 잔액이 모자라거나 연결이 끊기면 저절로 멈춰요." },
            ]}
          />
          <GuideNote>어느 칸에 들어갈지는 DROP 을 누르는 순간 서버가 정해요. 화면은 정해진 길을 따라 굴러가는 모습을 보여 주기만 해요.</GuideNote>
        </>
      ),
    },
    {
      id: "paytable",
      title: "배당",
      content: (
        <>
          <table className="guide-payouts">
            <thead><tr><th>위험도</th><th>가운데 칸</th><th>맨 끝 칸</th><th>환수율</th></tr></thead>
            <tbody>
              {PACHINKO_RISKS.map((risk) => (
                <tr key={risk}><td>{PACHINKO_RISK_LABEL[risk]}</td><td>{MIDDLE(risk)}배</td><td>{EDGE(risk)}배</td><td>{pachinkoRtpPercent(risk).toFixed(2)}%</td></tr>
              ))}
            </tbody>
          </table>
          <GuideNote>구슬은 줄마다 왼쪽·오른쪽으로 반반씩 튀어요. 그래서 가운데 칸이 가장 자주(약 5번에 1번) 맞고, 맨 끝 칸은 4096번에 두 번쯤 맞아요.</GuideNote>
          <GuideNote>배수는 베팅 대비 "돌려받는 전체"예요. 1배보다 작은 칸에 들어가면 일부만 돌아오고, 1배 칸은 본전이에요.</GuideNote>
        </>
      ),
    },
    {
      id: "buttons",
      title: "버튼",
      content: (
        <GuideActions
          actions={[
            { label: "DROP", tone: "gold", body: "구슬 한 알 떨어뜨리기. 스페이스·엔터로도 돼요." },
            { label: "AUTO", tone: "green", body: "일정 간격으로 계속 떨어뜨리기. 다시 누르면 멈춰요." },
          ]}
        />
      ),
    },
  ],
};
