import { Link } from "react-router-dom";
import { HOLDEM_RANKINGS } from "@opencasino/game-core/holdem";
import { CardFace } from "../../components/CardFace";
import { GuideActions, GuideHeading, GuideNote, GuideSteps, GuideTerms, type GameGuideContent } from "../../components/GameGuide";

function HoldemRankingList() {
  return (
    <ol className="guide-rank-list">
      {HOLDEM_RANKINGS.map((row, index) => (
        <li key={row.category} className={`guide-rank-row poker-tier-${Math.min(5, Math.ceil((HOLDEM_RANKINGS.length - index) / 2))}`}>
          <span className="guide-rank-num">{index + 1}</span>
          <span className="guide-rank-cards guide-rank-cards-poker" aria-hidden="true">
            {row.cards.map((card) => <span key={`${card.rank}${card.suit}`} className="guide-poker-card"><CardFace card={card} /></span>)}
          </span>
          <span className="guide-rank-text">
            <strong>{row.name} <em>{row.en}</em></strong>
            <small>{row.note}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

export const holdemGuide: GameGuideContent = {
  gameKey: "holdem",
  title: "텍사스 홀덤",
  intro: "내 카드 2장 + 공유 카드 5장 중 5장으로 가장 좋은 조합을 만드는 게임. 마지막까지 남은 사람 중 조합이 가장 높은 사람이 팟을 가져갑니다.",
  sections: [
    {
      id: "rankings",
      title: "족보표",
      content: (
        <>
          <GuideNote>위에 있을수록 강해요. 같은 족보면 조합을 이루는 숫자가 높은 쪽이 이기고, 그것도 같으면 남은 카드(키커)로 비교합니다. 완전히 같으면 팟을 나눠 가져요.</GuideNote>
          <HoldemRankingList />
          <GuideNote tone="green">화면 오른쪽(모바일은 아래)의 "내 족보" 칸이 지금 내 카드로 만들어진 조합을 실시간으로 알려줘요. 금색 테두리가 그 조합에 쓰인 카드예요.</GuideNote>
        </>
      ),
    },
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideNote tone="green">처음이라면 봇과 각본대로 한 판 쳐 보세요 — 코인이 오가지 않아요. <Link className="app-secondary-button" to="/learn/holdem">연습해 보기</Link></GuideNote>
          <GuideSteps
            steps={[
              { title: "바이인하고 준비 완료", body: "빈 자리를 누르면 테이블로 가져갈 칩(바이인)을 고릅니다 — 빅블라인드 20~50배. 앉고 준비 완료를 누르세요. 앉은 사람 모두가 준비되면 핸드가 시작됩니다 (2명 이상)." },
              { title: "블라인드", body: "딜러 버튼(D) 왼쪽 두 사람이 강제로 기본 베팅을 냅니다. SB(스몰 블라인드)는 절반, BB(빅 블라인드)는 전액. 버튼은 매 핸드 시계 방향으로 이동해요." },
              { title: "내 카드 2장 → 프리플랍 베팅", body: "나만 볼 수 있는 카드 2장을 받고 첫 베팅을 합니다. BB 다음 사람부터 순서대로 폴드 · 콜 · 레이즈를 골라요." },
              { title: "플랍 3장 → 베팅", body: "모두가 함께 쓰는 공유 카드 3장이 열립니다. 이제 내 2장 + 공유 3장으로 조합을 볼 수 있어요." },
              { title: "턴 1장 → 베팅, 리버 1장 → 베팅", body: "공유 카드가 한 장씩 더 열리고 그때마다 베팅합니다. 총 7장 중 가장 좋은 5장이 내 족보예요." },
              { title: "쇼다운", body: "남은 사람끼리 카드를 공개하고 족보가 가장 높은 사람이 팟을 가져갑니다. 나 빼고 전부 폴드하면 카드 공개 없이 내가 이겨요." },
            ]}
          />
          <GuideHeading>버튼 설명</GuideHeading>
          <GuideActions
            actions={[
              { label: "폴드", tone: "red", body: "카드를 버리고 이번 핸드를 포기합니다. 이미 낸 돈은 돌려받지 못해요." },
              { label: "체크", tone: "gold", body: "돈을 더 내지 않고 차례를 넘깁니다. 아무도 베팅하지 않았을 때만 가능해요." },
              { label: "콜", tone: "blue", body: "상대가 낸 만큼 똑같이 맞춰 냅니다. 자리 칩이 부족하면 가진 만큼만 내고 올인 처리돼요." },
              { label: "베팅 / 레이즈", tone: "green", body: "돈을 걸거나(베팅) 상대보다 더 올립니다(레이즈). 추천 버튼은 프리플랍엔 BB의 2.5배·3배·4배, 플랍부터는 팟의 ⅓·½·팟 크기예요. 올인 버튼도 있어요." },
              { label: "올인", tone: "purple", body: "자리 칩을 전부 겁니다(지갑 전체가 아니라 바이인한 칩까지). 이후 베팅은 없고, 남은 사람들의 베팅은 사이드 팟으로 따로 모여요." },
            ]}
          />
          <GuideNote tone="red">차례마다 30초가 주어지고, 넘기면 타임뱅크(처음 15초, 8핸드마다 5초씩 최대 40초까지 차오름)를 씁니다. 그것도 다 쓰면 자동으로 체크(베팅이 없을 때) 또는 폴드 처리됩니다.</GuideNote>
          <GuideNote>팟에서 소액의 수수료(레이크 5%, 상한 있음)를 뺀 금액이 승자에게 돌아갑니다. 플랍을 보기 전에 끝난 판은 떼지 않아요. 하우스는 상대가 아니고, 다른 플레이어와 겨루는 게임이에요.</GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "홀카드", body: "나만 볼 수 있는 내 카드 2장." },
            { term: "보드 / 커뮤니티 카드", body: "테이블 가운데 열리는 공유 카드 5장. 플랍(3장) → 턴(1장) → 리버(1장) 순으로 열려요." },
            { term: "번 카드", body: "플랍·턴·리버를 열기 전마다 맨 위에서 엎은 채 버리는 카드 한 장. 누구에게도 공개되지 않고 보드 옆에 엎어 쌓여요." },
            { term: "D · SB · BB", body: "딜러 버튼, 스몰 블라인드, 빅 블라인드. 블라인드는 핸드 시작 시 강제로 내는 기본 베팅이에요." },
            { term: "팟", body: "이번 핸드에 모인 돈 전체. 올인이 생기면 메인 팟과 사이드 팟으로 나뉘어요." },
            { term: "바이인·충전", body: "자리에 가져온 칩. 이 칩까지만 걸리고, 딴 칩은 자리에 쌓여요. 칩이 떨어지면 자리는 그대로 두고 다음 핸드에서 빠지며, 핸드 사이에 '칩 충전'으로 최대 바이인까지 채울 수 있어요." },
            { term: "키커", body: "같은 족보일 때 승부를 가르는 나머지 카드. 예: 둘 다 K 원페어면 그 다음 높은 카드로 비교." },
            { term: "수딧 / 오프수트", body: "내 2장의 무늬가 같으면 수딧, 다르면 오프수트. 수딧은 플러시를 노리기 좋아요." },
            { term: "드로우", body: "한 장만 더 오면 플러시·스트레이트가 완성되는 상태. 내 족보 칸에 표시돼요." },
            { term: "레이크", body: "팟에서 빠지는 소액의 테이블 수수료." },
          ]}
        />
      ),
    },
  ],
};
