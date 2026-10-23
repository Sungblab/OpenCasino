import { GuideHeading, GuideNote, GuideSteps, GuideTerms, type GameGuideContent } from "../../components/GameGuide";

export const crashGuide: GameGuideContent = {
  gameKey: "crash",
  title: "크래시",
  intro: "배율이 1.00x 부터 점점 빨리 오르다 어느 순간 터져요. 터지기 전에 캐시아웃하면 건 금액 × 그 배율을 받고, 못 빼면 건 금액을 잃어요.",
  sections: [
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "금액을 정하고 베팅 (8초)", body: "칩이나 −/+ 로 금액을 고르고 베팅을 누르세요. 한 판에 한 번만 걸 수 있고, 베팅 시간 안에는 취소할 수 있어요." },
              { title: "비행", body: "베팅이 닫히면 배율이 1.00x 에서 오르기 시작해요. 2x 까지 약 7초, 10x 까지 약 23초, 100x 까지 약 46초가 걸려요." },
              { title: "캐시아웃", body: "큰 버튼에 지금 빼면 받을 금액이 실시간으로 떠요. 누르는 순간 서버가 그때의 배율로 확정하고 바로 지급해요." },
              { title: "터짐", body: "터지는 배율은 판이 시작될 때 이미 정해져 있어요. 터진 뒤에 누른 캐시아웃은 받지 않아요. 바로 터지는(1.00x) 판도 있어요." },
            ]}
          />
          <GuideHeading>자동 캐시아웃</GuideHeading>
          <GuideNote>
            베팅 전에 배율(1.01x ~ 100x)을 넣어 두면, 배율이 거기에 닿는 순간 서버가 대신 캐시아웃해요. 화면을 보고 있지 않아도, 연결이 잠깐 끊겨도 그대로
            돼요. 목표가 터진 배율과 똑같으면 성공이에요(2.00x 로 맞춰 두었는데 정확히 2.00x 에서 터지면 2배를 받아요).
          </GuideNote>
          <GuideHeading>지급과 확률</GuideHeading>
          <GuideNote>
            받는 금액 = 건 금액 × 캐시아웃 배율(0.01코인 아래는 버림). 배율이 x 이상까지 갈 확률은 0.97 ÷ x 라서, 어떤 배율을 노리든 이론상 돌려받는 비율(RTP)은
            97% 로 같아요. 배율은 최대 100x 에서 반드시 터져요.
          </GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "캐시아웃", body: "지금 배율로 빠져나와 건 금액 × 배율을 받는 것." },
            { term: "자동 캐시아웃", body: "미리 정한 배율에 닿으면 서버가 대신 캐시아웃해 주는 것." },
            { term: "터짐", body: "그 판이 끝나는 배율. 그때까지 캐시아웃하지 못한 베팅은 모두 잃어요." },
            { term: "최근 터짐 배율", body: "그래프 위 줄. 2x 미만은 빨강, 2x 이상은 초록, 10x 이상은 금색이에요. 지난 판은 다음 판과 상관이 없어요." },
          ]}
        />
      ),
    },
  ],
};
