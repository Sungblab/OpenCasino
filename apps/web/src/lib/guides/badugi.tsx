import type { Card } from "@opencasino/contracts";
import { BADUGI_RANKINGS, badugiMeter, evaluateBadugiHand, sameBadugiCard } from "@opencasino/game-core/badugi";
import { CardFace } from "../../components/CardFace";
import { GuideActions, GuideHeading, GuideNote, GuideSteps, GuideTerms, type GameGuideContent } from "../../components/GameGuide";

/** 카드 넉 장 — 묶음에서 빠진 죽은 패는 흐리게. */
function Hand({ cards }: { cards: Card[] }) {
  const hand = evaluateBadugiHand(cards);
  return (
    <span className="guide-rank-cards guide-rank-cards-poker" aria-hidden="true">
      {cards.map((card) => (
        <span key={`${card.rank}${card.suit}`} className={`guide-poker-card ${hand.dead.some((dead) => sameBadugiCard(dead, card)) ? "is-dead" : ""}`}><CardFace card={card} /></span>
      ))}
    </span>
  );
}

function BadugiRankingList() {
  return (
    <ol className="guide-rank-list">
      {BADUGI_RANKINGS.map((row, index) => (
        <li key={row.label} className={`guide-rank-row poker-tier-${badugiMeter(evaluateBadugiHand(row.cards))}`}>
          <span className="guide-rank-num">{index + 1}</span>
          <Hand cards={row.cards} />
          <span className="guide-rank-text">
            <strong>{row.label}</strong>
            <small>{row.note}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

const c = (code: string): Card => ({ rank: code.slice(0, -1) as Card["rank"], suit: code.slice(-1) as Card["suit"] });
const EXAMPLES: Array<{ cards: Card[]; read: string }> = [
  { cards: ["7H", "3S", "AD", "5C"].map(c), read: "넷 다 무늬도 숫자도 달라 메이드. 가장 높은 카드가 7 → 7탑 메이드." },
  { cards: ["2S", "6H", "9D", "4D"].map(c), read: "9♦ 와 4♦ 는 무늬가 같아 높은 9 가 빠진다 → 6·4·2, 6탑 베이스. 9 를 버리고 한 장 받으면 메이드를 노린다." },
  { cards: ["3C", "3H", "8S", "8C"].map(c), read: "3 도 두 장, 8 도 두 장 — 숫자가 겹쳐 두 장만 남는다 → 8·3, 8탑 투베이스. 두 장을 바꿔야 한다." },
  { cards: ["5S", "4H", "2D", "AC"].map(c), read: "5·4·2·A — 써드. 골프(A-2-3-4)·세컨드(A-2-3-5) 다음으로 센 메이드." },
];

export const badugiGuide: GameGuideContent = {
  gameKey: "badugi",
  title: "바둑이",
  intro: "카드 4장을 세 번 바꿔 가며 무늬도 숫자도 서로 다른 '낮은' 패를 만드는 게임. 마지막까지 남은 사람 중 족보가 가장 좋은 사람이 팟을 가져갑니다.",
  sections: [
    {
      id: "rankings",
      title: "족보표",
      content: (
        <>
          <GuideNote>4장 중 <b>무늬도 숫자도 서로 다른</b> 카드끼리 묶는다. 묶음이 많을수록 강하다: 메이드(4장) &gt; 베이스(3장) &gt; 투베이스(2장) &gt; 노베이스(1장). 에이스는 1, 가장 낮은 카드예요.</GuideNote>
          <BadugiRankingList />
          <GuideNote tone="green">같은 장수끼리는 묶음의 <b>가장 높은 카드</b>부터 비교해 낮은 쪽이 이겨요. 같으면 그다음 카드로. 숫자가 전부 같으면 무늬와 상관없이 팟을 나눠요.</GuideNote>
        </>
      ),
    },
    {
      id: "read",
      title: "족보 읽기",
      content: (
        <>
          <GuideHeading sub="흐린 카드가 묶음에서 빠진 죽은 패">이렇게 읽어요</GuideHeading>
          <ol className="guide-rank-list">
            {EXAMPLES.map((example, index) => {
              const hand = evaluateBadugiHand(example.cards);
              return (
                <li key={index} className={`guide-rank-row poker-tier-${badugiMeter(hand)}`}>
                  <span className="guide-rank-num">{index + 1}</span>
                  <Hand cards={example.cards} />
                  <span className="guide-rank-text">
                    <strong>{hand.label}</strong>
                    <small>{example.read}</small>
                  </span>
                </li>
              );
            })}
          </ol>
          <GuideNote>판 위 내 카드 옆 "내 족보" 칸이 지금 패를 실시간으로 읽어 줘요. 죽은 패는 어둡게, 메이드면 네 장 모두 금테가 둘러져요.</GuideNote>
        </>
      ),
    },
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "앉고 준비 완료", body: "빈 자리를 누르면 앉아요(최소 삥의 2배 코인). 앉은 사람 모두가 준비하면 판이 시작돼요(2~5명)." },
              { title: "삥(앤티) → 카드 4장", body: "판마다 모두 삥을 내고 카드 4장을 엎어서 받아요. 내 카드는 나만 볼 수 있어요." },
              { title: "베팅 → 아침", body: "첫 베팅이 끝나면 아침(1차 교체). 모두 동시에 버릴 카드를 0~4장 고르고, 같은 수만큼 새로 받아요." },
              { title: "베팅 → 점심 → 베팅 → 저녁", body: "교체는 아침·점심·저녁 세 번, 교체마다 그 앞뒤로 베팅이 있어요(베팅 4번)." },
              { title: "쇼다운", body: "마지막 베팅까지 남은 사람끼리 카드를 공개하고 족보가 가장 좋은 사람이 팟을 가져가요. 나 빼고 전부 다이하면 공개 없이 내가 이겨요(남은 교체·베팅은 하지 않아요)." },
            ]}
          />
          <GuideHeading>교체 규칙</GuideHeading>
          <GuideNote>교체 창은 15초. 카드를 누르면 버릴 카드로 위로 들리고, "N장 바꾸기"를 누르면 끝. 하나도 안 고르면 <b>패스</b>(시간이 지나도 패스). 창이 닫히기 전엔 다시 골라 바꿀 수 있어요.</GuideNote>
          <GuideNote tone="green">다른 사람에게는 내가 <b>몇 장 바꿨는지</b>만 보여요(자리 옆 "2장"·"패스"). 저녁에 패스한 상대는 메이드일 가능성이 높아요 — 바둑이의 핵심 눈치예요.</GuideNote>
          <GuideHeading>버튼 설명</GuideHeading>
          <GuideActions
            actions={[
              { label: "다이", tone: "red", body: "이번 판을 포기해요. 이미 낸 돈은 돌려받지 못해요." },
              { label: "체크", tone: "gold", body: "돈을 더 내지 않고 넘겨요. 아무도 올리지 않았을 때만." },
              { label: "콜", tone: "blue", body: "앞사람이 올린 만큼 맞춰 내요." },
              { label: "삥", tone: "green", body: "기본 판돈(삥)만큼 올려요." },
              { label: "따당", tone: "green", body: "앞사람 베팅의 2배로 올려요." },
              { label: "하프", tone: "green", body: "콜을 받은 뒤 판돈의 절반만큼 더 올려요." },
              { label: "올인", tone: "purple", body: "낼 수 있는 돈을 전부(판당 최대까지). 돈이 모자라 콜을 못 할 때 가진 만큼만 넣고 따라가는 길이기도 해요." },
            ]}
          />
          <GuideNote tone="red">차례마다 20초. 시간이 지나면 낼 돈이 있으면 다이, 없으면 체크로 넘어가요.</GuideNote>
          <GuideNote>한 사람이 한 판에 낼 수 있는 돈은 방의 '판당 최대'까지. 팟에서 딜러비(5%, 상한 있음)를 뗀 금액이 승자에게 가요. 전원 다이로 끝난 판은 떼지 않아요.</GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "메이드", body: "네 장 모두 무늬·숫자가 다른 패. 가장 높은 카드로 '7탑 메이드'처럼 불러요." },
            { term: "골프 · 세컨드 · 써드", body: "A-2-3-4 · A-2-3-5 · A-2-4-5 메이드. 바둑이에서 가장 센 세 패." },
            { term: "베이스 · 투베이스", body: "묶음이 세 장·두 장인 패. 한 장·두 장 바꿔 메이드를 노려요." },
            { term: "노베이스", body: "네 장이 전부 같은 무늬(또는 같은 숫자)라 한 장만 남는 패. 가장 약해요." },
            { term: "죽은 패", body: "다른 카드와 무늬나 숫자가 겹쳐 묶음에서 빠진 카드. 보통 이걸 버려요." },
            { term: "아침 · 점심 · 저녁", body: "1·2·3차 교체." },
            { term: "패스", body: "교체에서 한 장도 바꾸지 않는 것. 좋은 메이드를 들고 있다는 신호로 읽혀요." },
            { term: "삥", body: "판마다 모두 내는 기본 판돈이자 베팅 최소 단위." },
          ]}
        />
      ),
    },
  ],
};
