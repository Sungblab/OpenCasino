import { SEVEN_POKER_RANKINGS } from "@opencasino/game-core/seven-poker";
import { CardFace } from "../../components/CardFace";
import { GuideActions, GuideHeading, GuideNote, GuideSteps, GuideTerms, type GameGuideContent } from "../../components/GameGuide";

function SevenPokerRankingList() {
  return (
    <ol className="guide-rank-list">
      {SEVEN_POKER_RANKINGS.map((row, index) => (
        <li key={row.category} className={`guide-rank-row poker-tier-${Math.min(5, Math.ceil((SEVEN_POKER_RANKINGS.length - index) / 2.6))}`}>
          <span className="guide-rank-num">{index + 1}</span>
          <span className="guide-rank-cards guide-rank-cards-poker" aria-hidden="true">
            {row.cards.map((card) => <span key={`${card.rank}${card.suit}`} className="guide-poker-card"><CardFace card={card} /></span>)}
          </span>
          <span className="guide-rank-text">
            <strong>{row.name}</strong>
            <small>{row.note}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

export const sevenPokerGuide: GameGuideContent = {
  gameKey: "seven_poker",
  title: "7포커",
  intro: "카드 7장 중 가장 좋은 5장으로 겨루는 한국식 세븐 카드 스터드. 남의 앞면 카드를 보며 베팅하고, 끝까지 남은 사람 중 족보가 가장 높은 사람이 팟을 모두 가져갑니다.",
  sections: [
    {
      id: "rankings",
      title: "족보표",
      content: (
        <>
          <GuideNote>위에 있을수록 강해요. 한국식이라 <b>백스트레이트(A·2·3·4·5)가 마운틴 바로 아래</b>이고, 백 스트레이트 플러시도 로열 바로 아래입니다.</GuideNote>
          <SevenPokerRankingList />
          <GuideNote>같은 족보면 숫자로 비교합니다(투페어는 높은 쌍 → 낮은 쌍 → 남은 카드). 숫자까지 같으면 팟을 나누지 않고 <b>족보를 이루는 가장 높은 카드의 무늬</b>로 가려요: ♠ 스페이드 &gt; ◆ 다이아 &gt; ♥ 하트 &gt; ♣ 클로버.</GuideNote>
          <GuideNote tone="green">판 위 "내 족보" 칸이 지금 내 카드로 만든 족보를 실시간으로 알려 줘요. 금색 테두리가 그 족보에 쓰인 카드이고, 쇼다운에선 이긴 다섯 장에 금테가 둘러집니다.</GuideNote>
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
              { title: "앉고 준비 완료", body: "빈 자리를 누르면 앉아요(2~5인). 앉은 사람 모두가 준비 완료를 누르면 판이 시작됩니다." },
              { title: "삥(앤티) 자동 납부", body: "판이 시작되면 전원이 기본 베팅(삥)을 냅니다. 이 돈이 첫 판돈이에요." },
              { title: "4장 받고 초이스", body: "엎은 카드 4장을 받습니다. 15초 안에 ① 버릴 카드 한 장, ② 남은 세 장 중 앞면으로 보여줄 카드 한 장을 고르세요. 모두 동시에 고르고, 고른 내용은 다 같이 공개돼요. 안 고르면 자동(가장 쓸모없는 카드를 버리고, 페어에 안 낀 낮은 카드를 공개)." },
              { title: "4구 · 5구 · 6구", body: "한 장씩 앞면으로 더 받고 그때마다 베팅합니다. 매번 앞면 카드가 가장 좋은 사람(보스)부터 시계 방향으로 걸어요." },
              { title: "7구(히든)", body: "마지막 카드는 엎어서 받고 마지막 베팅을 합니다. 이제 7장이 다 모였어요." },
              { title: "쇼다운", body: "남은 사람끼리 카드를 펼쳐 7장 중 가장 좋은 5장으로 겨룹니다. 나 빼고 전부 다이하면 카드를 펼치지 않고 내가 이겨요(남은 카드는 돌리지 않습니다)." },
            ]}
          />
          <GuideHeading sub="공개된 앞면 카드만으로">보스(먼저 거는 사람)</GuideHeading>
          <GuideNote>앞면 카드끼리 페어·트리플을 먼저 보고, 없으면 높은 숫자, 그것도 같으면 무늬(♠ &gt; ◆ &gt; ♥ &gt; ♣)로 정해요. 앞면은 4장까지라 스트레이트·플러시는 따지지 않습니다. 이름표 모서리의 <b>보스</b> 표시가 그 사람이에요.</GuideNote>
          <GuideHeading>버튼 설명</GuideHeading>
          <GuideActions
            actions={[
              { label: "다이", tone: "red", body: "이번 판을 포기합니다. 낸 돈은 돌려받지 못하지만 더 잃지도 않아요." },
              { label: "체크", tone: "gold", body: "돈을 더 내지 않고 넘깁니다. 아무도 걸지 않았을 때만 가능해요." },
              { label: "콜", tone: "blue", body: "앞사람이 건 만큼 맞춰 냅니다." },
              { label: "삥", tone: "green", body: "기본 베팅(삥) 금액만큼 겁니다(올립니다). 가장 적게 거는 방법이에요." },
              { label: "따당", tone: "green", body: "앞사람이 건 금액의 두 배가 되게 올립니다. 받을 돈이 있을 때만 나와요." },
              { label: "쿼터 · 하프", tone: "green", body: "받은 뒤 판돈의 ¼ · ½ 만큼 더 겁니다." },
              { label: "올인", tone: "purple", body: "낼 수 있는 돈을 전부 넣습니다. 콜 금액에 모자라도 가진 만큼 넣고 끝까지 갈 수 있어요(그만큼만 걸린 몫으로 승부)." },
            ]}
          />
          <GuideNote>버튼의 숫자가 이번에 실제로 내는 총액(받을 돈 + 올리는 돈)이에요. 한 판에 한 사람이 낼 수 있는 최대 금액(판당 최대)이 정해져 있고, 거기에 닿으면 올인과 같아집니다.</GuideNote>
          <GuideNote tone="red">차례마다 20초. 시간이 지나면 자동으로 체크(건 사람이 없을 때) 또는 다이 처리되고, 두 번 연속 넘기면 자리에서 일어난 것으로 봐요.</GuideNote>
          <GuideNote>팟에서 딜러비(5%, 판당 최대의 3% 상한)를 뺀 금액이 승자에게 갑니다. 전원 다이로 끝난 판은 떼지 않아요. 하우스는 상대가 아니고 다른 플레이어와 겨루는 게임이에요.</GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "초이스", body: "처음 4장 중 한 장을 버리고 한 장을 앞면으로 공개하는 단계. 어떤 카드를 보여주느냐가 첫 심리전이에요." },
            { term: "히든", body: "마지막 7번째 카드. 엎어서 받아 나만 봅니다. 내 화면에서 나만 보는 카드는 조금 어둡게, 모두에게 보이는 카드는 살짝 올려 그려요." },
            { term: "보스", body: "앞면 카드가 가장 좋아서 이번 베팅을 먼저 여는 사람." },
            { term: "마운틴 · 백스트레이트", body: "마운틴은 10·J·Q·K·A, 백스트레이트는 A·2·3·4·5. 한국식에선 둘이 스트레이트 중 1·2위예요." },
            { term: "탑", body: "아무 족보도 없을 때. 가장 높은 카드로 승부합니다(예: A 탑)." },
            { term: "삥(앤티)", body: "판이 시작될 때 모두가 내는 기본 베팅. 테이블의 최소 금액과 같아요." },
            { term: "사이드팟", body: "누가 가진 돈이 모자라 올인하면, 그 사람이 낸 만큼까지만 걸린 몫을 따로 갈라 나눠요." },
          ]}
        />
      ),
    },
  ],
};
