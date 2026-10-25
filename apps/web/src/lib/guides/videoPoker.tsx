import { VIDEO_POKER_PAYS, VIDEO_POKER_RANK_LABEL, VIDEO_POKER_RANKS } from "@opencasino/game-core/video-poker";
import { GuideActions, GuideHeading, GuideNote, GuideSteps, startSection, type GameGuideContent } from "../../components/GameGuide";

/** 족보마다 어떤 손인지 한 줄. 배당표 순서(VIDEO_POKER_RANKS)와 같다. */
const RANK_NOTE: Record<(typeof VIDEO_POKER_RANKS)[number], string> = {
  royal_flush: "같은 무늬 10·J·Q·K·A",
  straight_flush: "같은 무늬로 이어진 다섯 장(A-2-3-4-5 포함)",
  four_of_a_kind: "같은 숫자 네 장",
  full_house: "트리플 + 원페어",
  flush: "같은 무늬 다섯 장",
  straight: "이어진 숫자 다섯 장(A 는 맨 아래·맨 위 둘 다)",
  three_of_a_kind: "같은 숫자 세 장",
  two_pair: "페어 두 개(숫자 상관없음)",
  jacks_or_better: "J·Q·K·A 중 하나로 된 페어",
};

export const videoPokerGuide: GameGuideContent = {
  gameKey: "video_poker",
  title: "비디오 포커 · 잭스 오어 베터",
  intro: "카드 5장을 받고, 마음에 드는 카드만 잡은 뒤 나머지를 한 번 바꿔요. 마지막 5장의 포커 족보로 배당이 정해집니다.",
  sections: [
    startSection({ steps: [{ title: "베팅 고르고 DEAL", body: "− / + 로 금액을 정하고 DEAL 을 누르면 카드 5장이 와요." }, { title: "남길 카드 HOLD", body: "남기고 싶은 카드를 누르면 HOLD 가 붙어요." }, { title: "DRAW", body: "안 잡은 카드만 새로 바뀌고, 마지막 5장의 족보대로 바로 정산돼요." }], tip: "이미 족보(J 이상 원페어·투페어 등)가 있으면 그 카드를 잡고, 없으면 J·Q·K·A 같은 높은 카드나 같은 무늬 4장을 잡아요. J 보다 낮은 원페어는 당첨이 아니에요.", odds: <>배당표의 숫자가 그 족보로 받는 코인이에요(지금 베팅 기준). 원페어는 J 이상부터 당첨이에요.</> }),
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "베팅 고르기", body: "− / + 또는 배당표 위쪽 금액을 눌러 0.2코인부터 25코인까지. 고른 금액의 열이 배당표에서 밝게 표시돼요." },
              { title: "DEAL", body: "베팅이 빠지고 카드 5장이 한 장씩 뒤집혀요. 지금 손에 이미 족보가 있으면 위에 알려 주고 배당표 줄이 밝아져요." },
              { title: "HOLD", body: "남길 카드를 누르면 위에 HOLD 가 붙어요. 다시 누르면 풀려요. 하나도 안 잡아도, 다섯 장 다 잡아도 돼요." },
              { title: "DRAW", body: "안 잡은 카드만 새 카드로 바뀌어요(잡은 카드는 그대로). 마지막 5장의 족보대로 바로 정산돼요." },
            ]}
          />
          <GuideNote>52장 한 덱(조커 없음)으로 매 판 새로 섞어요. 바꿀 카드까지 DEAL 때 서버가 정해 두지만, DRAW 전에는 화면에 오지 않아요.</GuideNote>
          <GuideNote>도중에 연결이 끊겨도 받은 손은 그대로 남아 있어요. 다시 들어오면 잡아 둔 카드까지 돌아와 이어서 DRAW 할 수 있어요.</GuideNote>
        </>
      ),
    },
    {
      id: "paytable",
      title: "배당표",
      content: (
        <>
          <table className="guide-payouts">
            <thead><tr><th>족보</th><th>배당</th><th>설명</th></tr></thead>
            <tbody>
              {VIDEO_POKER_RANKS.map((rank) => (
                <tr key={rank}><td>{VIDEO_POKER_RANK_LABEL[rank]}</td><td>{VIDEO_POKER_PAYS[rank]}배</td><td>{RANK_NOTE[rank]}</td></tr>
              ))}
            </tbody>
          </table>
          <GuideNote>배당은 베팅 대비 "돌려받는 전체"예요. 잭 이상 원페어(1배)는 원금만 돌아오고, 10 이하 원페어나 족보 없음은 베팅을 잃어요.</GuideNote>
          <GuideNote>8/5 배당표 · 최적으로 잡았을 때 이론 환수율 97.30%. 한 손 최대 지급은 베팅의 800배(로열 플러시)예요.</GuideNote>
        </>
      ),
    },
    {
      id: "buttons",
      title: "버튼",
      content: (
        <>
          <GuideActions
            actions={[
              { label: "DEAL", tone: "gold", body: "베팅하고 새 카드 5장 받기. 스페이스·엔터로도 돼요." },
              { label: "HOLD", tone: "green", body: "카드를 눌러 잡기/풀기. PC 는 숫자 1~5 키." },
              { label: "DRAW", tone: "red", body: "안 잡은 카드 바꾸고 정산. 스페이스·엔터로도 돼요." },
            ]}
          />
          <GuideHeading>잡는 요령</GuideHeading>
          <GuideNote>이미 된 족보(투페어 이상, 잭 이상 원페어)는 깨지 마세요. 로열·스트레이트 플러시 4장이 보이면 페어보다 그쪽이 낫고, 아무것도 없으면 J 이상 높은 카드만 남기는 게 기본이에요.</GuideNote>
        </>
      ),
    },
  ],
};
