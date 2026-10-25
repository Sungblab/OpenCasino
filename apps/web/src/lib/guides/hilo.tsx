import { HILO_MAX_MULTIPLIER, HILO_RTP_PERCENT } from "@opencasino/game-core/hilo";
import { GuideActions, GuideHeading, GuideNote, GuideSteps, ODDS_TIMES, startSection, type GameGuideContent } from "../../components/GameGuide";
import { PayoutTable } from "./houseGames";

/** 숫자는 game-core/hilo 와 같아야 한다 — 배수 계산·상한·환수율을 바꾸면 여기도. */
export const hiloGuide: GameGuideContent = {
  gameKey: "hilo",
  title: "하이로우",
  intro: "카드 한 장을 보고, 다음 카드가 그보다 높을지 낮을지 맞혀요. 맞히면 받고 끝내거나, 나온 카드로 계속 도전해 배수를 쌓을 수 있어요.",
  sections: [
    startSection({ steps: [{ title: "베팅 정하기", body: "− / + 로 금액을 정해요." }, { title: "높을지 낮을지 고르기", body: "다음 카드가 지금 카드보다 높거나 같을지, 낮거나 같을지 눌러요." }, { title: "받거나 계속하기", body: "맞히면 CASH OUT 으로 받고 끝내거나, 이어서 골라 배수를 더 쌓아요. 한 번 틀리면 다 잃어요." }], tip: "버튼에 맞힐 확률이 보여요. 확률이 높은 쪽을 고르고, 두세 번 맞히면 CASH OUT 해 보세요.", odds: ODDS_TIMES }),
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "베팅 고르기", body: "− / + 로 베팅을 정해요. 기준 카드가 마음에 안 들면 '카드 바꾸기'로 몇 번이든 새로 뽑을 수 있어요(공짜)." },
              { title: "높을지 낮을지 고르기", body: "'높거나 같음' 또는 '낮거나 같음'을 누르면 베팅이 빠지고 다음 카드가 뒤집혀요. 같은 숫자가 나와도 이겨요." },
              { title: "받거나 계속하기", body: "맞히면 버튼 위 배수만큼 금액이 쌓여요. CASH OUT 으로 받고 끝내거나, 방금 나온 카드를 새 기준으로 다시 골라 배수를 더 쌓아요." },
              { title: "틀리면 끝", body: "한 번이라도 틀리면 베팅과 쌓인 금액을 모두 잃고 판이 끝나요." },
            ]}
          />
          <GuideHeading>숫자 순서</GuideHeading>
          <GuideNote>2가 가장 낮고 A가 가장 높아요. 2 &lt; 3 &lt; … &lt; 10 &lt; J &lt; Q &lt; K &lt; A. 무늬는 보지 않아요.</GuideNote>
          <GuideNote>카드는 매번 새 덱에서 뽑아요. 앞에 나온 카드가 다음 확률을 바꾸지 않으니 13숫자가 늘 똑같이 1/13 이에요.</GuideNote>
          <GuideNote>기준이 2면 '같거나 높음'이 늘 이겨서 대신 '높음'과 '같음'을, A면 '낮음'과 '같음'을 골라요.</GuideNote>
        </>
      ),
    },
    {
      id: "payout",
      title: "배수",
      content: (
        <>
          <GuideNote>배수 = 13 ÷ (이기는 숫자 수) × {HILO_RTP_PERCENT}%, 소수 둘째 자리 내림. 버튼에 항상 배수와 맞힐 확률, 맞히면 받을 금액이 보여요.</GuideNote>
          <PayoutTable
            rows={[
              { bet: "K 에서 낮거나 같음", pays: "×1.07", note: "2~K 열두 숫자가 이겨요" },
              { bet: "K 에서 높거나 같음", pays: "×6.43", note: "K·A 두 숫자만 이겨요" },
              { bet: "8 에서 어느 쪽이든", pays: "×1.83", note: "일곱 숫자씩" },
              { bet: "2·A 에서 같음", pays: "×12.87", note: "같은 숫자 하나" },
            ]}
          />
          <GuideNote>이어 갈수록 배수가 곱해져요. 쌓인 금액이 베팅의 {HILO_MAX_MULTIPLIER.toLocaleString()}배에 닿으면 그 자리에서 자동으로 받아요.</GuideNote>
          <GuideNote>도중에 연결이 끊겨도 이어 가던 판은 그대로 남아요. 다시 들어오면 그 카드에서 이어서 고르거나 받을 수 있어요.</GuideNote>
        </>
      ),
    },
    {
      id: "buttons",
      title: "버튼",
      content: (
        <GuideActions
          actions={[
            { label: "▲ / ▼", tone: "gold", body: "높을지 낮을지 고르기. 판 밖이면 베팅하고 시작, 판 안이면 이어 가기. PC 는 ↑·↓ 키." },
            { label: "CASH OUT", tone: "green", body: "쌓인 금액을 받고 판 끝내기. 스페이스·엔터로도 돼요." },
            { label: "카드 바꾸기", tone: "red", body: "판 밖에서 기준 카드를 새로 뽑기(공짜). R 키." },
          ]}
        />
      ),
    },
  ],
};
