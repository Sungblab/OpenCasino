import { Link } from "react-router-dom";
import { SUTDA_RANKINGS, SUTDA_SPECIALS, SUTDA_TIER_LABEL, type SutdaRankingRow, type SutdaTier } from "@opencasino/game-core/sutda";
import { GuideActions, GuideHeading, GuideNote, GuideSteps, GuideTerms, type GameGuideContent } from "../../components/GameGuide";
import { HwatuCard } from "../../components/HwatuCard";

const TIER_ORDER: SutdaTier[] = ["gwangddaeng", "ddaeng", "named", "gabo", "kkeut", "mangtong"];

function RankingRow({ row, rank }: { row: SutdaRankingRow; rank: number }) {
  return (
    <li className={`guide-rank-row tier-${row.tier}`}>
      <span className="guide-rank-num">{rank}</span>
      <span className="guide-rank-cards guide-rank-cards-hwatu" aria-hidden="true">
        {row.cards.map((card) => <HwatuCard key={card.id} card={card} />)}
      </span>
      <span className="guide-rank-text">
        <strong>{row.label}</strong>
        <small>{row.note}</small>
      </span>
    </li>
  );
}

function SutdaRankingList() {
  // 8끗~1끗 are one rule, not eight separate things to memorise — collapse them
  // into a single row between 갑오 and 망통 so the list stays scannable.
  const kkeutRows = SUTDA_RANKINGS.filter((row) => row.tier === "kkeut");
  let position = 0;
  return (
    <div className="guide-rank-groups">
      {TIER_ORDER.map((tier) => {
        const rows = SUTDA_RANKINGS.filter((row) => row.tier === tier);
        if (rows.length === 0) return null;
        if (tier === "kkeut") {
          position += rows.length;
          const first = kkeutRows[0]!;
          return (
            <section key={tier} className={`guide-rank-group tier-${tier}`}>
              <h4>{SUTDA_TIER_LABEL[tier]} <span>8끗 → 1끗</span></h4>
              <ul>
                <li className="guide-rank-row tier-kkeut">
                  <span className="guide-rank-num">…</span>
                  <span className="guide-rank-cards guide-rank-cards-hwatu" aria-hidden="true">
                    {first.cards.map((card) => <HwatuCard key={card.id} card={card} />)}
                  </span>
                  <span className="guide-rank-text">
                    <strong>8끗 ~ 1끗</strong>
                    <small>두 장의 월 수를 더한 값의 일의 자리. 예: 2월+6월 = 8끗, 5월+6월 = 11 → 1끗. 숫자가 클수록 강해요</small>
                  </span>
                </li>
              </ul>
            </section>
          );
        }
        return (
          <section key={tier} className={`guide-rank-group tier-${tier}`}>
            <h4>
              {SUTDA_TIER_LABEL[tier]}
              {tier === "ddaeng" && <span>장땡 → 삥땡</span>}
              {tier === "named" && <span>땡 아래, 갑오 위</span>}
            </h4>
            <ul>
              {rows.map((row) => {
                position += 1;
                return <RankingRow key={row.label} row={row} rank={position} />;
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function SutdaSpecialList() {
  return (
    <ul className="guide-special-list">
      {SUTDA_SPECIALS.map((row) => (
        <li key={row.label} className="guide-special-row">
          <span className="guide-rank-cards guide-rank-cards-hwatu" aria-hidden="true">
            {row.cards.map((card) => <HwatuCard key={card.id} card={card} />)}
          </span>
          <span className="guide-rank-text">
            <strong>{row.label}</strong>
            <small className="is-effect">{row.effect}</small>
            <small>{row.fallback}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

export const sutdaGuide: GameGuideContent = {
  gameKey: "sutda",
  title: "섯다",
  intro: "화투 2장으로 족보를 만들어 겨루는 게임. 족보가 가장 높은 사람이 판돈(팟)을 모두 가져갑니다.",
  sections: [
    {
      id: "rankings",
      title: "족보표",
      content: (
        <>
          <GuideNote>위에 있을수록 강한 패예요. 같은 족보끼리는 무승부(팟을 나눠 가짐)이고, 끗은 숫자가 클수록 이깁니다.</GuideNote>
          <SutdaRankingList />
          <GuideHeading sub="상황에 따라 효과가 바뀌는 패">특수 패</GuideHeading>
          <SutdaSpecialList />
        </>
      ),
    },
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideNote tone="green">처음이라면 봇과 각본대로 한 판 쳐 보세요 — 코인이 오가지 않아요. <Link className="app-secondary-button" to="/learn/sutda">연습해 보기</Link></GuideNote>
          <GuideSteps
            steps={[
              { title: "자리에 앉고 준비 완료", body: "빈 자리를 누르면 앉을 수 있어요. 앉은 사람 모두가 준비 완료를 누르면 판이 시작됩니다 (2명 이상)." },
              { title: "삥(기본 베팅) 자동 납부", body: "판이 시작되면 참가자 전원이 기본 베팅(삥)을 자동으로 냅니다. 이 돈이 첫 판돈이에요." },
              { title: "첫 패 1장 → 1차 베팅", body: "한 장을 받고 순서대로 베팅합니다. 내 차례에는 22초 안에 다이 · 체크/콜 · 삥 · 따당 · 쿼터 · 하프 · 올인 중 하나를 고르세요. 1차 베팅의 첫 사람은 하프·체크(콜)·다이만 고를 수 있어요(하프-콜 룰)." },
              { title: "둘째 패 1장 → 2차 베팅", body: "남은 사람은 두 번째 장을 받고 한 번 더 베팅합니다. 이제 내 족보가 확정돼요." },
              { title: "승부", body: "남은 사람끼리 족보를 비교해 가장 높은 사람이 팟을 가져갑니다. 나 빼고 전부 다이하면 비교 없이 내가 이겨요. 땡·광땡으로 이기면 따라온 아랫패에게 땡값을 더 받습니다." },
            ]}
          />
          <GuideHeading>버튼 설명</GuideHeading>
          <GuideActions
            actions={[
              { label: "다이", tone: "red", body: "이번 판을 포기합니다. 지금까지 낸 돈은 돌려받지 못하지만, 더 잃지도 않아요." },
              { label: "체크", tone: "gold", body: "돈을 더 내지 않고 차례를 넘깁니다. 아무도 올리지 않았을 때만 가능해요." },
              { label: "콜", tone: "blue", body: "상대가 올린 금액만큼 똑같이 맞춰 냅니다. 판에 계속 남으려면 받거나 올려야 해요." },
              { label: "삥", tone: "green", body: "기본 베팅(삥) 금액만큼 올립니다. 가장 적게 올리는 방법이에요." },
              { label: "따당", tone: "green", body: "앞사람이 올린 금액의 두 배가 되도록 올립니다. 받을 돈이 있을 때만 나와요." },
              { label: "쿼터", tone: "green", body: "받은 뒤 판돈의 4분의 1만큼 더 올립니다." },
              { label: "하프", tone: "green", body: "받은 뒤 판돈의 절반만큼 더 올립니다." },
              { label: "올인", tone: "purple", body: "낼 수 있는 돈을 전부 넣습니다. 콜 금액에 모자라도 가진 만큼 넣고 따라갈 수 있고, 그때는 그만큼만 걸고 승부해요." },
            ]}
          />
          <GuideNote>올리는 버튼에 적힌 숫자가 이번에 실제로 내는 총액(받을 돈 + 올리는 돈)입니다. 레일의 족보표에는 내 패가 전체에서 몇 %를 이기는지가 함께 나와요.</GuideNote>
          <GuideNote tone="red">22초 안에 아무것도 고르지 않으면 자동으로 체크(올린 사람이 없을 때) 또는 다이 처리됩니다. 두 번 연속 시간을 넘기면 자리에서 일어난 것으로 봐요.</GuideNote>
          <GuideNote>판과 판 사이에 선의 오른쪽 사람에게 <b>기리</b>(패 뭉치 자르기) 차례가 옵니다. 펼쳐진 뭉치에서 자를 곳을 누르면 다음 판이 그 자리에서 잘린 순서로 돌아가요. 섞은 쪽이 패를 마음대로 쌓지 못하게 하는 장치이고, 건너뛰어도 됩니다.</GuideNote>
          <GuideHeading sub="이름에 '3장 초이스'가 붙은 테이블">3장 초이스 섯다</GuideHeading>
          <GuideSteps
            steps={[
              { title: "패 2장 → 한 장 공개", body: "처음에 두 장을 받고 15초 안에 그중 한 장을 골라 상대에게 보여줍니다. 안 고르면 첫 장이 공개돼요. 어떤 패를 보여줄지가 이 게임의 심리전입니다." },
              { title: "1차 베팅 → 셋째 패 → 2차 베팅", body: "공개된 패를 보며 베팅하고, 셋째 장을 받은 뒤 한 번 더 베팅합니다." },
              { title: "최종 선택 → 승부", body: "베팅이 끝나면 세 장 중 쇼다운에 쓸 두 장을 15초 안에 직접 고릅니다. 안 고르면 가장 높은 조합이 자동으로 쓰여요. 끗값은 낮아도 땡잡이·암행어사·구사처럼 상대를 잡거나 재경기를 부르는 패를 일부러 고를 수 있어요 — 이게 3장 초이스의 진짜 심리전입니다." },
            ]}
          />
          <GuideNote>테이블마다 한 판에 한 사람이 낼 수 있는 최대 금액이 정해져 있어요. 올리는 금액은 그 한도까지만 커지고, 한도에 닿으면 버튼이 잠깁니다.</GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "족보", body: "패 2장의 조합 이름. 광땡 > 땡 > 특수 족보(알리·독사·구삥·장삥·장사·세륙) > 갑오 > 끗 > 망통 순으로 강해요." },
            { term: "끗", body: "두 장의 월 수를 더한 값의 일의 자리. 9끗은 갑오, 0끗은 망통이라고 불러요." },
            { term: "땡", body: "같은 월 두 장. 10월 두 장이 장땡, 1월 두 장이 삥땡." },
            { term: "광", body: "1월·3월·8월의 광(光) 카드. 광 두 장이면 광땡이에요." },
            { term: "띠 · 열끗", body: "화투 카드의 종류. 특수 패(암행어사·땡잡이·구사)는 정해진 종류의 카드로만 만들어져요." },
            { term: "삥", body: "판이 시작될 때 모두가 내는 기본 베팅. 테이블의 최소 베팅 금액과 같아요." },
            { term: "선", body: "이번 판의 기준 자리(딜러). 선 다음 사람부터 베팅을 시작하고, 매 판 시계 방향으로 넘어가요." },
            { term: "팟", body: "이번 판에 모인 판돈 전체. 승자가 가져가며, 딜러비(수수료 5%)가 빠집니다. 전원 다이로 끝난 판은 빼지 않아요. 올인한 사람이 있으면 그 사람이 낸 만큼만 걸린 몫을 따로 갈라 나눠요." },
            { term: "땡값", body: "땡이나 광땡으로 이겼을 때, 끝까지 따라온 아랫패가 자기가 낸 돈의 일부를 승자에게 더 주는 돈. 38광땡 50%, 광땡 30%, 장땡 20%, 그 외 땡 10%예요." },
            { term: "재경기", body: "멍텅구리 구사나 구사가 성립하면 판을 무효로 하고, 죽은 사람까지 낸 돈을 그대로 돌려받아요." },
          ]}
        />
      ),
    },
  ],
};
