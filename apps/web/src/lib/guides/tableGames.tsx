import { GuideHeading, GuideNote, GuideSteps, GuideTerms, type GameGuideContent } from "../../components/GameGuide";
import { PayoutTable } from "./houseGames";

/**
 * 표 게임(game-core table-games)의 안내. 게임마다 const 하나를 만들고 아래 GUIDES 에 한 줄을 더한다.
 * 베팅 방법·배당 같은 숫자는 게임 정의(game-core)와 맞춘다 — 배당이 판마다 다른 게임은 "어떻게 정해지는지" 를 적는다.
 */

export const hiloGuide: GameGuideContent = {
  gameKey: "hilo",
  title: "하이로우",
  intro: "카드 한 장이 먼저 보여요. 다음 카드가 그보다 높을지, 낮을지, 같을지(또는 빨강인지 검정인지)를 맞히는 게임. 카드는 자동으로 뽑히고, 나는 어느 쪽일지에만 베팅합니다.",
  sections: [
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "기준 카드를 보고 베팅 (15초)", body: "판이 열리면 기준 카드가 앞면으로 보입니다. 아래 칸(하이·같음·로우·레드·블랙) 중 원하는 칸에 칩을 거세요. 여러 칸에 동시에 걸 수 있고, 마감 전에는 되돌리기로 취소할 수 있어요." },
              { title: "다음 카드 공개", body: "베팅이 끝나면 엎어 둔 다음 카드가 뒤집힙니다. 기준 카드를 뺀 남은 51장 중 한 장이에요." },
              { title: "정산", body: "맞힌 칸은 칸에 적힌 배당대로 돌려받아요. 같은 숫자가 나오면 하이·로우는 집니다." },
            ]}
          />
          <GuideHeading>숫자 순서</GuideHeading>
          <GuideNote>에이스(A)가 가장 낮고 K 가 가장 높아요. A &lt; 2 &lt; … &lt; 10 &lt; J &lt; Q &lt; K. 무늬는 숫자 비교에 쓰이지 않고, 레드(♥♦)·블랙(♠♣) 칸에서만 봅니다.</GuideNote>
          <GuideHeading>배당은 판마다 달라요</GuideHeading>
          <GuideNote>이길 수 있는 카드가 많은 칸은 배당이 낮고, 적은 칸은 높습니다. 예를 들어 기준이 K 면 "하이"는 이길 카드가 없어 닫히고, "로우"는 거의 다 이기니 배당이 낮아요. 배당 = 51 ÷ (이기는 카드 수) 에서 하우스 몫 3% 를 뺀 값이고, 칸에 항상 표시돼 있어요.</GuideNote>
          <PayoutTable
            rows={[
              { bet: "하이 / 로우", pays: "판마다 다름", note: "기준보다 높은(낮은) 카드가 나오면 적중. 같은 숫자는 집니다" },
              { bet: "같음", pays: "약 16배", note: "같은 숫자(3장)가 나오면 적중 · 높은 배당 칸 한도가 적용돼요" },
              { bet: "레드 / 블랙", pays: "약 2배", note: "다음 카드의 색. 기준 카드와 같은 색이 한 장 적게 남아 배당이 조금씩 달라요" },
            ]}
          />
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "기준 카드", body: "베팅 전에 먼저 앞면으로 놓이는 카드. 다음 카드와 비교하는 기준이에요." },
            { term: "같음", body: "다음 카드가 기준과 같은 숫자일 때(무늬는 상관없음)." },
            { term: "높은 배당 칸", body: "같음처럼 배당이 큰 칸은 방마다 정해진 별도 한도까지만 걸 수 있어요." },
          ]}
        />
      ),
    },
  ],
};

export const topCardGuide: GameGuideContent = {
  gameKey: "top_card",
  title: "탑 카드",
  intro: "네 무늬(♠ ♥ ♦ ♣)가 카드를 한 장씩 받아요. 그중 가장 높은 카드가 나오는 무늬를 맞히는 게임. 카드는 자동으로 뽑히고, 나는 어느 무늬가 이길지(또는 맨 위 카드가 얼마나 높을지)에만 베팅합니다.",
  sections: [
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "무늬와 사이드 칸에 베팅 (15초)", body: "위 줄 네 칸(스페이드·하트·다이아·클럽) 중 가장 높은 카드가 나올 것 같은 무늬에, 아래 줄(공동 탑·탑 J·Q·K·A·탑 9 이하)에도 걸 수 있어요. 여러 칸에 동시에 걸 수 있고, 마감 전에는 되돌리기로 취소할 수 있어요." },
              { title: "카드 공개", body: "베팅이 끝나면 ♠ ♥ ♦ ♣ 순서로 한 장씩 뒤집힙니다. 네 장은 서로 상관없이 무늬마다 13개 숫자 중 하나가 같은 확률로 나와요. 공개되는 동안엔 지금까지 열린 카드 중 가장 높은 카드에 옅은 금테가 따라다녀요." },
              { title: "정산", body: "네 장이 다 열리면 가장 높은 카드가 위로 떠오르며 TOP 표가 붙어요(공동이면 TIE). 맞힌 칸은 칸에 적힌 배당대로 돌려받아요." },
            ]}
          />
          <GuideHeading>숫자 순서</GuideHeading>
          <GuideNote>A 가 가장 높고 K &gt; Q &gt; J &gt; 10 &gt; … &gt; 2 순서로 낮아져요. 무늬는 높낮이에 쓰이지 않아요. 같은 숫자끼리는 우열이 없습니다.</GuideNote>
          <GuideHeading>공동 탑이면?</GuideHeading>
          <GuideNote>가장 높은 숫자가 두 무늬 이상에서 같게 나오면 공동 탑이에요. 공동 탑에 낀 무늬 칸은 비김(베팅금 그대로 반환), 나머지 무늬 칸은 집니다. 아래 줄 칸은 "가장 높은 숫자"만 보기 때문에 공동 탑이어도 결과가 달라지지 않아요.</GuideNote>
          <PayoutTable
            rows={[
              { bet: "스페이드 · 하트 · 다이아 · 클럽", pays: "×4.1", note: "그 무늬가 혼자 가장 높으면 적중. 공동 탑이면 베팅금 반환" },
              { bet: "공동 탑", pays: "×6.45", note: "가장 높은 숫자가 두 무늬 이상에서 같을 때 · 높은 배당 칸 한도가 적용돼요" },
              { bet: "탑 J·Q·K·A", pays: "×1.24", note: "가장 높은 카드가 J, Q, K, A 중 하나면 적중" },
              { bet: "탑 9 이하", pays: "×6.65", note: "가장 높은 카드가 2~9 사이면 적중" },
            ]}
          />
          <GuideNote>배당은 베팅금을 포함해 돌려받는 배수예요(×4.1 = 10코인 걸어 적중하면 41코인).</GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "탑 카드", body: "네 장 중 숫자가 가장 높은 카드. 그 카드를 받은 무늬가 이겨요." },
            { term: "공동 탑", body: "가장 높은 숫자가 둘 이상의 무늬에서 같을 때(무늬는 상관없음). 무늬 칸은 비김이에요." },
            { term: "비김", body: "베팅금이 그대로 돌아오는 결과. 이기지도 지지도 않아요." },
            { term: "높은 배당 칸", body: "공동 탑처럼 배당이 큰 칸은 방마다 정해진 별도 한도까지만 걸 수 있어요." },
          ]}
        />
      ),
    },
  ],
};

export const bacBoGuide: GameGuideContent = {
  gameKey: "bac_bo",
  title: "박 보",
  intro: "주사위 바카라. 파랑 플레이어와 빨강 뱅커가 주사위를 두 개씩 굴려, 두 개의 합이 더 큰 쪽이 이깁니다. 주사위는 자동으로 굴러가고, 나는 어느 쪽이 이길지(또는 비길지, 네 주사위의 합이 클지 작을지)에만 베팅합니다.",
  sections: [
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "베팅 (15초)", body: "판이 열리면 아래 칸(플레이어·타이·뱅커, 그리고 스몰·빅)에 칩을 거세요. 여러 칸에 동시에 걸 수 있고, 마감 전에는 되돌리기로 취소할 수 있어요. 베팅 전에는 주사위가 아직 정해져 있지 않아요." },
              { title: "주사위 공개", body: "마감되면 플레이어 첫 주사위 → 뱅커 첫 주사위 → 플레이어 둘째 → 뱅커 둘째 순서로 하나씩 굴러 나옵니다. 두 주사위가 다 나온 쪽은 합이 숫자로 표시돼요(2~12)." },
              { title: "정산", body: "합이 더 큰 쪽이 이기고, 같으면 타이입니다. 맞힌 칸은 칸에 적힌 배당대로 돌려받아요." },
            ]}
          />
          <GuideHeading>타이에서는 푸시</GuideHeading>
          <GuideNote>두 쪽의 합이 같으면 플레이어·뱅커에 건 칩은 지지도 이기지도 않고 그대로 돌아옵니다(푸시). 이때는 타이 칸만 이겨요.</GuideNote>
          <GuideHeading>스몰·빅은 네 주사위의 합</GuideHeading>
          <GuideNote>네 주사위(플레이어 둘 + 뱅커 둘)를 모두 더한 값(4~24)이 15 이상이면 빅, 13 이하면 스몰이 이깁니다. 합이 정확히 14 이면 스몰·빅 둘 다 집니다. 결과가 열리면 화면 아래에 "네 주사위 합" 이 표시돼요.</GuideNote>
          <PayoutTable
            rows={[
              { bet: "플레이어 / 뱅커", pays: "×1.91", note: "내 쪽 합이 더 크면 적중 · 타이면 원금 반환(푸시)" },
              { bet: "타이", pays: "×8.5", note: "두 쪽 합이 같으면 적중 · 높은 배당 칸 한도가 적용돼요" },
              { bet: "스몰 (13 이하)", pays: "×2.16", note: "네 주사위 합이 13 이하면 적중 · 14 는 집니다" },
              { bet: "빅 (15 이상)", pays: "×2.16", note: "네 주사위 합이 15 이상이면 적중 · 14 는 집니다" },
            ]}
          />
          <GuideNote>배당은 원금을 포함해 돌려받는 배수예요(칸에 적힌 숫자와 같습니다). 주사위 한 개는 1~6 이 똑같은 확률로 나옵니다. 플레이어·뱅커의 하우스 몫은 약 4% 입니다.</GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "플레이어 / 뱅커", body: "파랑 쪽과 빨강 쪽. 각자 주사위 두 개의 합으로 겨뤄요. 어느 쪽이 먼저 굴러도 승률은 같습니다." },
            { term: "타이", body: "두 쪽의 합이 같은 경우. 같은 눈이 아니라 합이 같으면 돼요(예: 3+4 와 5+2)." },
            { term: "푸시", body: "비김. 건 칩이 그대로 돌아옵니다." },
            { term: "스몰 / 빅", body: "네 주사위 전체의 합이 작은 쪽(13 이하) / 큰 쪽(15 이상). 한가운데 14 는 둘 다 지는 칸이에요." },
            { term: "높은 배당 칸", body: "타이처럼 배당이 큰 칸은 방마다 정해진 별도 한도까지만 걸 수 있어요." },
          ]}
        />
      ),
    },
  ],
};

export const megaBallGuide: GameGuideContent = {
  gameKey: "mega_ball",
  title: "메가볼",
  intro: "추첨기에서 1~40번 공 12개가 차례로 나오는 게임. 마지막 12번째 공이 메가볼이에요. 공은 자동으로 뽑히고, 나는 어떤 번호가 나올지, 메가볼이 어느 구간일지, 홀짝·대소가 어느 쪽으로 기울지에 베팅합니다.",
  sections: [
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "칸을 골라 베팅 (15초)", body: "번호 40칸(1~40), 메가 구간 4칸, 홀수·짝수·큰 수·작은 수 4칸 중 원하는 칸에 칩을 거세요. 여러 칸에 동시에 걸 수 있고, 마감 전에는 되돌리기로 취소할 수 있어요." },
              { title: "공 12개 추첨", body: "베팅이 끝나면 공이 순서대로 나와 받침대에 놓여요. 3개 → 6개 → 9개 → 11개가 차례로 열리고, 마지막에 12번째 공(메가볼)이 혼자 나옵니다. 12번째 공이 나오기 전까지는 어떤 번호가 메가볼인지 아무도 몰라요." },
              { title: "정산", body: "맞힌 칸은 칸에 적힌 배당대로 돌려받아요. 내가 번호 칸에 건 숫자가 나오면 공에 ✓ 표시가 붙습니다." },
            ]}
          />
          <GuideHeading>배당</GuideHeading>
          <PayoutTable
            rows={[
              { bet: "번호 (1~40)", pays: "3.15배", note: "그 번호가 12개 안에 한 번이라도 나오면 적중 (메가볼 자리도 포함, 12/40 확률)" },
              { bet: "메가 구간 (1–10 / 11–20 / 21–30 / 31–40)", pays: "3.8배", note: "12번째 공(메가볼)이 그 구간이면 적중 · 높은 배당 칸 한도가 적용돼요" },
              { bet: "홀수 많음 / 짝수 많음", pays: "2.6배", note: "나온 12개 중 홀수(짝수)가 더 많으면 적중" },
              { bet: "큰 수 많음 / 작은 수 많음", pays: "2.6배", note: "나온 12개 중 21 이상(20 이하)이 더 많으면 적중" },
            ]}
          />
          <GuideNote tone="red">홀짝·대소는 6대6이면 양쪽 모두 집니다. 비겨서 돌려받는 일은 없어요.</GuideNote>
          <GuideHeading>공 색</GuideHeading>
          <GuideNote>1–10은 금색, 11–20은 파랑, 21–30은 빨강, 31–40은 초록이에요. 최근 결과 구슬에는 메가볼 번호가 같은 색으로 쌓입니다.</GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "메가볼", body: "12개 중 마지막(12번째)으로 나오는 공. 메가 구간 칸만 이 공 하나로 결정돼요." },
            { term: "많음", body: "홀수와 짝수(또는 큰 수와 작은 수)의 개수를 비교해 더 많은 쪽. 화면 아래 숫자가 공이 열릴 때마다 갱신돼요." },
            { term: "큰 수 / 작은 수", body: "21~40은 큰 수, 1~20은 작은 수예요. 각각 20개씩이라 어느 쪽도 유리하지 않아요." },
            { term: "동수", body: "6대6으로 개수가 같은 경우. 그 쪽 칸은 모두 집니다." },
            { term: "높은 배당 칸", body: "메가 구간처럼 배당이 큰 칸은 방마다 정해진 별도 한도까지만 걸 수 있어요." },
          ]}
        />
      ),
    },
  ],
};

const GUIDES: Record<string, GameGuideContent> = {
  hilo: hiloGuide,
  mega_ball: megaBallGuide,
  bac_bo: bacBoGuide,
  top_card: topCardGuide,
};

export function tableGameGuide(game: string): GameGuideContent | undefined {
  return GUIDES[game];
}
