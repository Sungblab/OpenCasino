import { GuideActions, GuideHeading, GuideNote, GuideSteps, GuideTerms, ODDS_TO_ONE, startSection, type GameGuideContent } from "../../components/GameGuide";

/** Payout table rows shared by the house games. */
export function PayoutTable({ rows }: { rows: Array<{ bet: string; pays: string; note?: string }> }) {
  return (
    <table className="guide-payouts">
      <thead><tr><th>베팅</th><th>배당</th><th>설명</th></tr></thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.bet}><td>{row.bet}</td><td>{row.pays}</td><td>{row.note ?? ""}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export const baccaratGuide: GameGuideContent = {
  gameKey: "baccarat",
  title: "바카라",
  intro: "플레이어와 뱅커 중 카드 합이 9에 더 가까운 쪽을 맞히는 게임. 카드는 자동으로 뽑히고, 나는 어느 쪽이 이길지에만 베팅합니다.",
  sections: [
    startSection({ steps: [{ title: "칩 고르기", body: "화면 아래 칩에서 걸 금액을 눌러요. 처음엔 가장 작은 칩이면 충분해요." }, { title: "PLAYER 나 BANKER 누르기", body: "이길 것 같은 쪽 칸을 누르면 칩이 올라가요. 베팅 시간은 12초예요." }, { title: "기다리기", body: "카드는 자동으로 나와요. 합이 9에 가까운 쪽이 이기고, 맞히면 잔액에 바로 들어와요." }], tip: "PLAYER 나 BANKER 한쪽에 작은 칩 하나. 둘은 거의 반반이고(뱅커가 아주 조금 더 자주 이겨요), TIE·페어는 배당이 큰 대신 자주 안 나와요.", odds: ODDS_TO_ONE }),
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "칩을 고르고 베팅 (12초)", body: "아래 칩에서 금액을 고른 뒤 PLAYER · BANKER · TIE 등 원하는 칸을 누르세요. 여러 번 누르면 금액이 더해지고, 마감 전에는 되돌리기로 취소할 수 있어요." },
              { title: "카드 오픈", body: "플레이어와 뱅커가 각각 2장을 받습니다. 규칙에 따라 자동으로 3번째 카드를 받기도 해요 (내가 고를 건 없어요)." },
              { title: "정산", body: "합이 9에 가까운 쪽이 승리. 맞힌 베팅은 배당대로 돌려받고, 잔액에 바로 반영됩니다." },
            ]}
          />
          <GuideHeading>카드 점수 계산</GuideHeading>
          <GuideNote>A는 1점, 2~9는 숫자 그대로, 10·J·Q·K는 0점. 합이 10을 넘으면 일의 자리만 봅니다 (7+8 = 15 → 5점). 첫 2장의 합이 8·9면 "내추럴"로 바로 끝나요.</GuideNote>
          <GuideHeading>배당</GuideHeading>
          <PayoutTable
            rows={[
              { bet: "PLAYER", pays: "1 : 1", note: "타이가 나오면 베팅금 반환" },
              { bet: "BANKER", pays: "0.95 : 1", note: "뱅커가 조금 더 자주 이겨서 5% 수수료가 붙어요. 타이면 반환" },
              { bet: "TIE", pays: "8 : 1", note: "양쪽 점수가 같을 때 (라이트닝 방은 5 : 1)" },
              { bet: "P PAIR / B PAIR", pays: "11 : 1", note: "그쪽 첫 2장의 숫자가 같으면 적중 (라이트닝 방은 9 : 1)" },
              { bet: "P BONUS / B BONUS", pays: "최대 30 : 1", note: "보너스 방 전용. 이긴 점수 차이가 클수록 배당이 커져요" },
            ]}
          />
          <GuideHeading>보너스 방: P BONUS · B BONUS</GuideHeading>
          <PayoutTable
            rows={[
              { bet: "9점 차로 승리", pays: "30 : 1" },
              { bet: "8점 차로 승리", pays: "10 : 1" },
              { bet: "6~7점 차로 승리", pays: "4 : 1" },
              { bet: "4~5점 차로 승리", pays: "2 : 1" },
              { bet: "내추럴로 승리", pays: "1 : 1", note: "점수 차와 상관없이" },
            ]}
          />
          <GuideNote>내추럴이 아닌 승리는 4점 차 이상이어야 적중해요(3점 차 이하는 잃어요). 내추럴끼리 비기면 베팅금을 돌려받아요.</GuideNote>
          <GuideNote tone="red">라이트닝 바카라는 베팅마다 20% 수수료를 내는 대신, 무작위로 뽑힌 라이트닝 카드가 내 승리 카드에 포함되면 배당이 2~8배로 커집니다.</GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "내추럴", body: "첫 2장의 합이 8 또는 9. 3번째 카드 없이 바로 승부가 나요." },
            { term: "슈", body: "8덱(416장)을 섞어 넣은 카드 통. 남은 카드 수가 상단에 표시돼요." },
            { term: "빅로드", body: "최근 결과 기록표. 파란 원은 플레이어, 빨간 원은 뱅커 승리, 초록 선은 타이. 연속 승리는 세로로 이어져요." },
            { term: "되돌리기 / 반복", body: "베팅 마감 전 전체 취소, 그리고 직전 라운드와 똑같이 다시 베팅하는 버튼." },
            { term: "페어", body: "한쪽의 첫 2장 숫자가 같은 경우. 무늬는 상관없어요." },
          ]}
        />
      ),
    },
  ],
};

export const dragonTigerGuide: GameGuideContent = {
  gameKey: "dragon_tiger",
  title: "드래곤 타이거",
  intro: "드래곤과 타이거가 카드를 한 장씩 받아 더 높은 카드가 이깁니다. 가장 단순한 카드 게임이에요.",
  sections: [
    startSection({ steps: [{ title: "칩 고르기", body: "화면 아래 칩에서 걸 금액을 눌러요." }, { title: "DRAGON 이나 TIGER 누르기", body: "카드가 더 높을 것 같은 쪽을 눌러요. 베팅 시간은 12초예요." }, { title: "한 장씩 공개", body: "양쪽이 한 장씩 받고 숫자가 높은 쪽이 이겨요. K 가 가장 높고 A 가 가장 낮아요." }], tip: "DRAGON 이나 TIGER 에 작은 칩 하나. 둘은 반반이고, 숫자가 같은 타이가 나오면 건 돈의 절반만 돌아온다는 것만 기억하세요.", odds: ODDS_TO_ONE }),
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "칩을 고르고 베팅 (12초)", body: "DRAGON · TIGER · TIE · SUITED TIE 중 원하는 칸을 누르세요. 여러 칸에 동시에 걸 수도 있어요." },
              { title: "카드 오픈", body: "드래곤과 타이거가 각각 1장씩 받습니다." },
              { title: "정산", body: "숫자가 높은 쪽이 승리. A가 가장 낮고(1), K가 가장 높아요(13). 무늬는 승부에 상관없어요." },
            ]}
          />
          <GuideHeading>배당</GuideHeading>
          <PayoutTable
            rows={[
              { bet: "DRAGON / TIGER", pays: "1 : 1", note: "타이가 나오면 베팅금의 절반만 돌려받아요" },
              { bet: "TIE", pays: "11 : 1", note: "두 카드의 숫자가 같을 때" },
              { bet: "SUITED TIE", pays: "50 : 1", note: "숫자와 무늬가 모두 같을 때. 최대 베팅 한도가 따로 있어요" },
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
            { term: "타이", body: "드래곤과 타이거의 숫자가 같은 경우." },
            { term: "SUITED TIE", body: "숫자뿐 아니라 무늬까지 같은 타이. 드물어서 배당이 커요." },
            { term: "로드맵", body: "최근 결과 기록. D는 드래곤, T는 타이거 승리." },
          ]}
        />
      ),
    },
  ],
};

export const rouletteGuide: GameGuideContent = {
  gameKey: "roulette",
  title: "룰렛",
  intro: "0부터 36까지 37칸이 있는 휠에 공을 굴려, 공이 들어갈 번호나 번호 묶음을 맞히는 게임. 0이 하나뿐인 유럽식이에요.",
  sections: [
    startSection({ steps: [{ title: "칩 고르기", body: "화면 아래 칩에서 걸 금액을 눌러요." }, { title: "칸 누르기", body: "번호 하나를 누르거나, 판 바깥의 RED·BLACK·ODD·EVEN 같은 넓은 칸을 눌러요. 베팅 시간은 15초예요." }, { title: "공이 멈추면 정산", body: "공이 들어간 번호를 덮은 베팅이 모두 이겨요." }], tip: "RED 나 BLACK 같은 바깥 칸부터. 0 만 빼면 반반으로 맞아요. 번호 하나는 37번에 1번꼴이라 드물지만 크게 받아요.", odds: ODDS_TO_ONE }),
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "칩을 고르고 베팅 (15초)", body: "번호 칸 가운데를 누르면 그 번호 하나, 두 칸 경계를 누르면 두 번호(스플릿), 네 칸이 만나는 점을 누르면 네 번호(코너)에 걸려요. 판 바깥쪽 칸(RED·EVEN·1st 12 등)은 넓은 묶음이에요." },
              { title: "번개 (라이트닝 룰렛만)", body: "베팅이 닫히면 번개가 번호 1~5개에 떨어져 50x~500x 배수를 붙여요." },
              { title: "스핀", body: "공이 휠과 반대 방향으로 돌다가 칸 하나에 멈춥니다." },
              { title: "정산", body: "공이 들어간 번호를 덮은 베팅이 모두 이겨요. 0이 나오면 바깥쪽 칸(RED·EVEN 등)은 모두 져요." },
            ]}
          />
          <GuideHeading>배당</GuideHeading>
          <PayoutTable
            rows={[
              { bet: "스트레이트 (1개)", pays: "35 : 1", note: "라이트닝 룰렛은 29 : 1, 번개 맞은 번호면 50x~500x" },
              { bet: "스플릿 (2개)", pays: "17 : 1", note: "두 칸 경계" },
              { bet: "스트리트 (3개)", pays: "11 : 1", note: "한 줄 바깥 변" },
              { bet: "코너 (4개)", pays: "8 : 1", note: "네 칸이 만나는 점" },
              { bet: "식스 라인 (6개)", pays: "5 : 1", note: "두 줄이 만나는 바깥 변" },
              { bet: "더즌 · 컬럼 (12개)", pays: "2 : 1", note: "1st/2nd/3rd 12, 2:1 칸" },
              { bet: "RED · BLACK · ODD · EVEN · 1-18 · 19-36", pays: "1 : 1", note: "0이 나오면 모두 패배" },
            ]}
          />
          <GuideNote>번호 칸(스트레이트~식스 라인)에는 칸마다 따로 한도가 있어요. 테이블 이름 아래에 적혀 있어요.</GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "인사이드", body: "번호 칸 위에 거는 베팅(스트레이트·스플릿·스트리트·코너·식스 라인). 배당이 커요." },
            { term: "아웃사이드", body: "판 바깥쪽 넓은 칸(RED·BLACK·ODD·EVEN·1-18·19-36·더즌·컬럼). 자주 맞지만 배당이 작아요." },
            { term: "번개 배수", body: "라이트닝 룰렛에서 번개 맞은 번호에 스트레이트로 걸었을 때 받는 원금 포함 배수. 500x 면 499 : 1." },
          ]}
        />
      ),
    },
    {
      id: "racetrack",
      title: "레이스트랙 · 즐겨찾기",
      content: (
        <>
          <GuideTerms
            terms={[
              { term: "이웃 베팅", body: "칩 줄의 타원 버튼을 누르면 베팅판 자리에 휠 순서대로 번호를 두른 레이스트랙이 열려요. 번호를 누르면 그 번호와 휠에서 양옆 N칸(−/+ 로 0~9)에 스트레이트로 한 칩씩 걸려요." },
              { term: "VOISINS DU ZÉRO", body: "0 주변 17개 번호, 9칩: 0/2/3 에 2칩, 4/7·12/15·18/21·19/22·32/35 스플릿, 25/26/28/29 코너에 2칩." },
              { term: "TIER", body: "0 맞은편 12개 번호, 6칩: 5/8·10/11·13/16·23/24·27/30·33/36 스플릿." },
              { term: "ORPHELINS", body: "위 두 구역에 안 든 8개 번호, 5칩: 1 스트레이트, 6/9·14/17·17/20·31/34 스플릿." },
              { term: "ZERO", body: "0 에 가장 가까운 7개 번호, 4칩: 0/3·12/15·32/35 스플릿, 26 스트레이트." },
              { term: "즐겨찾기", body: "★ 에서 이번 판(없으면 지난 판) 베팅을 이름 붙여 10개까지 저장하고, 누르면 그대로 다시 걸어요. 이 기기 브라우저에만 저장돼요." },
            ]}
          />
          <GuideNote>칩 하나는 지금 고른 칩 금액이에요. 레이스트랙으로 건 베팅도 보통 스플릿·코너라 베팅판에 칩으로 보이고, 되돌리기로 하나씩 취소돼요.</GuideNote>
        </>
      ),
    },
  ],
};

export const sicBoGuide: GameGuideContent = {
  gameKey: "sicbo",
  title: "식보",
  intro: "유리 돔 안에서 주사위 세 개를 흔들어, 나올 눈과 합계를 맞히는 게임. 슈퍼 식보는 흔드는 동안 번개가 칸에 떨어져 배당이 최대 1000배까지 커져요.",
  sections: [
    startSection({ steps: [{ title: "칩 고르기", body: "화면 아래 칩에서 걸 금액을 눌러요." }, { title: "SMALL 이나 BIG 누르기", body: "주사위 세 개 합이 4~10 이면 SMALL, 11~17 이면 BIG 이에요. 베팅 시간은 15초예요." }, { title: "주사위가 멈추면 정산", body: "나온 눈을 맞힌 칸이 모두 이겨요." }], tip: "SMALL 이나 BIG 부터. 거의 반반이에요. 세 눈이 모두 같은 트리플이 나오면 둘 다 진다는 것만 기억하세요.", odds: ODDS_TO_ONE }),
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "칩을 고르고 베팅 (15초)", body: "SMALL·BIG, 합계, 더블·트리플, 두 눈 조합, 싱글 중 원하는 칸을 누르세요. 여러 칸에 동시에 걸 수 있어요." },
              { title: "셰이크", body: "돔이 흔들리며 주사위 세 개가 굴러요. 슈퍼 식보는 이때 번개가 칸 몇 개에 떨어져 배수(Nx)가 붙어요." },
              { title: "정산", body: "주사위가 멈추면 그 눈을 맞힌 칸이 모두 이겨요. 번개 칸에서 이기면 원래 배당 대신 번개 배수를 받아요." },
            ]}
          />
          <GuideHeading sub="클래식 · 슈퍼 식보 기본">배당</GuideHeading>
          <PayoutTable
            rows={[
              { bet: "SMALL (4~10) · BIG (11~17)", pays: "1 : 1", note: "트리플(세 눈이 같음)이 나오면 패배" },
              { bet: "ODD · EVEN", pays: "1 : 1", note: "합계가 홀/짝. 트리플이면 패배" },
              { bet: "합계 4 · 17", pays: "60 : 1 · 50 : 1", note: "합계가 정확히 그 수" },
              { bet: "합계 5 · 16", pays: "30 : 1 · 20 : 1", note: "" },
              { bet: "합계 6 · 15", pays: "17 : 1 · 15 : 1", note: "" },
              { bet: "합계 7 · 14", pays: "12 : 1", note: "" },
              { bet: "합계 8 · 13", pays: "8 : 1", note: "" },
              { bet: "합계 9~12", pays: "6 : 1", note: "" },
              { bet: "특정 트리플", pays: "180 : 1 · 150 : 1", note: "세 눈이 모두 그 숫자" },
              { bet: "애니 트리플", pays: "30 : 1", note: "세 눈이 모두 같으면 무엇이든" },
              { bet: "특정 더블", pays: "10 : 1 · 8 : 1", note: "그 숫자가 두 개 이상" },
              { bet: "두 눈 조합", pays: "5 : 1", note: "두 숫자가 모두 나오면" },
              { bet: "싱글", pays: "1 · 2 · 3 : 1", note: "그 숫자가 나온 개수만큼" },
            ]}
          />
          <GuideNote>슈퍼 식보는 번개 재원을 위해 몇몇 칸의 기본 배당이 낮아요(위 두 번째 숫자). SMALL·BIG·ODD·EVEN 과 싱글 1개 일치에는 번개가 붙지 않아요.</GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "트리플", body: "세 주사위 눈이 모두 같은 결과. SMALL·BIG·ODD·EVEN 은 이때 모두 져요." },
            { term: "번개 배수", body: "슈퍼 식보에서 번개 맞은 칸이 이기면 받는 원금 포함 배수. 88x 면 87 : 1." },
            { term: "칸 한도", body: "SMALL·BIG·ODD·EVEN 을 뺀 칸은 칸마다 따로 한도가 있어요. 테이블 이름 아래에 적혀 있어요." },
          ]}
        />
      ),
    },
  ],
};

export const moneyWheelGuide: GameGuideContent = {
  gameKey: "money_wheel",
  title: "머니 휠",
  intro: "54칸짜리 큰 휠을 돌려, 포인터 아래 멈출 숫자를 맞히는 게임. 맞힌 숫자만큼 배당을 받고, 2x·7x 칸에 서면 다시 돌려 배당이 곱해져요.",
  sections: [
    startSection({ steps: [{ title: "칩 고르기", body: "화면 아래 칩에서 걸 금액을 눌러요." }, { title: "숫자 칸 누르기", body: "1·2·5·10·20·40 중 휠이 멈출 것 같은 숫자를 눌러요. 베팅 시간은 15초예요." }, { title: "휠이 멈추면 정산", body: "포인터 아래 숫자에 건 칸이 이겨요. 2x·7x 칸에 서면 한 번 더 돌려 배당이 커져요." }], tip: "1 칸이 가장 자주 나와요(54칸 중 23칸). 큰 숫자일수록 드물지만 크게 받아요.", odds: <>칸의 숫자가 곧 배당이에요 — 5 칸에 10코인을 걸어 맞히면 원금 10 + 50 = 60코인.</> }),
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "칩을 고르고 베팅 (15초)", body: "아래 숫자 칸(1·2·5·10·20·40) 중 원하는 칸을 누르세요. 여러 칸에 동시에 걸 수 있고, 마감 전에는 되돌리기로 취소할 수 있어요." },
              { title: "휠 회전", body: "휠이 돌다가 맨 위 포인터 아래 칸 하나에 멈춥니다." },
              { title: "배수 칸이면 다시", body: "2x·7x 칸에 서면 이번 회전은 당첨이 없고, 걸어 둔 베팅 그대로 휠을 다시 돌려요. 다음에 나온 숫자의 배당에 배수가 곱해지고, 배수 칸이 또 나오면 배수끼리 곱해집니다(2x 뒤 7x 면 ×14)." },
              { title: "정산", body: "멈춘 숫자에 건 베팅이 이겨요. 원금과 함께 숫자 × 배수만큼 받습니다." },
            ]}
          />
          <GuideHeading>칸 구성과 배당</GuideHeading>
          <PayoutTable
            rows={[
              { bet: "1", pays: "1 : 1", note: "54칸 중 23칸 · 이론 RTP 95.34%" },
              { bet: "2", pays: "2 : 1", note: "15칸 · 95.51%" },
              { bet: "5", pays: "5 : 1", note: "7칸 · 91.24%" },
              { bet: "10", pays: "10 : 1", note: "4칸 · 96.58%" },
              { bet: "20", pays: "20 : 1", note: "2칸 · 92.74%" },
              { bet: "40", pays: "40 : 1", note: "1칸 · 90.81%" },
              { bet: "2x · 7x", pays: "배수", note: "각 1칸. 걸 수 없고, 다음 결과의 배당에 곱해져요" },
            ]}
          />
          <GuideNote>예: 10 칸에 10코인, 2x → 7x → 10 이 나오면 10 + 10 × 10 × 14 = 1,410코인을 돌려받아요. 원금은 한 번만 돌려받습니다.</GuideNote>
          <GuideNote>RTP는 오래 걸었을 때 건 돈 중 돌려받는 비율의 이론값이에요(배수 연쇄 포함). 재회전은 한 판에 8번까지이고, 그 뒤엔 숫자 칸에서만 멈춰요.</GuideNote>
          <GuideNote tone="red">20 · 40 칸은 배당이 커서 칸마다 따로 한도가 있어요(테이블 이름 아래). 한 판에 한 사람이 받는 금액은 최대 500,000코인입니다.</GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "X : 1", body: "이기면 원금에 더해 건 금액의 X배를 받아요. 5 : 1 이면 10코인이 60코인이 돼요." },
            { term: "배수 칸 (2x · 7x)", body: "여기에 서면 휠을 다시 돌리고, 그다음 결과의 배당에 배수를 곱해요. 숫자 칸 전부에 똑같이 붙어요." },
            { term: "누적 배수", body: "배수 칸이 연달아 나오면 곱해진 값. 화면 오른쪽 위와 베팅 칸 모서리에 ×N 으로 보여요." },
          ]}
        />
      ),
    },
  ],
};

export const slotGuide: GameGuideContent = {
  gameKey: "slot",
  title: "슬롯 · 골든 세븐",
  intro: "릴 5개에 줄 3개, 20라인 비디오 슬롯. 같은 그림이 왼쪽 릴부터 3개 이상 이어지면 당첨이에요.",
  sections: [
    startSection({ steps: [{ title: "총베팅 고르기", body: "− / + 로 한 번 돌릴 금액을 정해요. 0.2코인부터예요." }, { title: "스핀", body: "스핀 버튼이나 스페이스바를 누르면 릴이 돌아요." }, { title: "당첨은 자동", body: "그림이 맞으면 당첨 금액이 바로 잔액에 들어와요." }], tip: "가장 작은 베팅으로 몇 번 돌려 보며 화면 옆 배당표로 어떤 그림이 큰지 익혀 보세요.", odds: <>당첨 금액은 코인으로 바로 떠요. 베팅보다 적게 돌아오면 이긴 게 아니라 "반환"(회색)이에요.</> }),
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "총베팅 고르기", body: "− / + 로 0.2코인부터 20코인까지. 20라인에 똑같이 나눠 걸려요(라인 하나 = 총베팅의 1/20)." },
              { title: "스핀", body: "스핀 버튼이나 스페이스바. 결과는 서버가 정하고, 릴은 그 칸에 그대로 멈춰요." },
              { title: "당첨", body: "라인마다 가장 큰 당첨 하나만, 여러 라인은 모두 더해요. WILD 는 BONUS 를 뺀 모든 그림을 대신해요." },
              { title: "프리스핀", body: "BONUS 가 아무 자리에 3개 이상이면 프리스핀 10회. WILD 가 더 많은 릴로 돌고 모든 당첨 ×3, 도중에 또 걸리면 +10회." },
            ]}
          />
          <GuideNote>베팅보다 적거나 같은 당첨(원금 일부만 돌아오는 경우)은 "반환"으로 회색 표시돼요. 이긴 게 아니니까요.</GuideNote>
          <GuideNote>환수율 96.09% · 한 판(프리스핀 포함) 최대 500배 · 배당표는 화면 옆(폰은 책 아이콘)에서 지금 베팅 기준으로 볼 수 있어요.</GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "라인", body: "릴 다섯 개를 지나는 정해진 길 20개. 왼쪽 첫 릴부터 같은 그림이 이어져야 해요." },
            { term: "WILD", body: "보라색 배지. 다른 그림 대신 쓰이고, 자기끼리 5개면 라인 베팅의 1,000배." },
            { term: "BONUS", body: "금화. 줄과 상관없이 아무 자리 3·4·5개면 총베팅의 2·10·50배와 프리스핀." },
          ]}
        />
      ),
    },
  ],
};

export const luckyCherryGuide: GameGuideContent = {
  gameKey: "slot",
  title: "슬롯 · 럭키 체리",
  intro: "릴 3개짜리 옛 기계식 슬롯. 5라인 중 한 줄에 같은 그림 3개(체리는 왼쪽 2개)면 당첨이에요.",
  sections: [
    startSection({ steps: [{ title: "총베팅 고르기", body: "− / + 로 한 번 돌릴 금액을 정해요. 0.2코인부터예요." }, { title: "스핀", body: "스핀 버튼이나 스페이스바를 누르면 릴이 돌아요." }, { title: "당첨은 자동", body: "그림이 맞으면 당첨 금액이 바로 잔액에 들어와요." }], tip: "가장 작은 베팅으로 몇 번 돌려 보며 화면 옆 배당표로 어떤 그림이 큰지 익혀 보세요.", odds: <>당첨 금액은 코인으로 바로 떠요. 베팅보다 적게 돌아오면 이긴 게 아니라 "반환"(회색)이에요.</> }),
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "총베팅 고르기", body: "− / + 로 0.2코인부터 20코인까지. 5라인에 똑같이 나눠 걸려요(라인 하나 = 총베팅의 1/5)." },
              { title: "스핀", body: "스핀 버튼이나 스페이스바. 결과는 서버가 정하고, 릴은 그 칸에 그대로 멈춰요." },
              { title: "당첨", body: "가운데·위·아래 줄과 대각선 둘. 라인마다 가장 큰 당첨 하나, 여러 라인은 모두 더해요." },
              { title: "WILD ×2", body: "파란 다이아 WILD 는 모든 그림을 대신하고 그 라인 당첨을 2배(두 개면 4배) 해요. WILD 셋이면 라인 베팅의 500배." },
            ]}
          />
          <GuideNote>베팅보다 적거나 같은 당첨은 "반환"으로 회색 표시돼요. 이긴 게 아니니까요.</GuideNote>
          <GuideNote>환수율 96.24% · 4번에 1번꼴로 당첨 · 한 판 최대 103배 · 프리스핀은 없어요.</GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "빈칸", body: "릴에는 그림과 빈칸이 번갈아 있어요. 빈칸이 끼면 그 라인은 당첨이 아니에요." },
            { term: "아무 7", body: "레드 7과 블루 7이 섞여 셋이어도 당첨." },
            { term: "아무 BAR", body: "BAR·더블 BAR·트리플 BAR 가 섞여 셋이어도 당첨." },
          ]}
        />
      ),
    },
  ],
};

export const goldenDragonGuide: GameGuideContent = {
  gameKey: "slot",
  title: "슬롯 · 황금 드래곤",
  intro: "릴 5개 243웨이 슬롯. 줄이 없고, 왼쪽 릴부터 이웃한 릴마다 같은 그림이 어디에든 있으면 당첨이에요.",
  sections: [
    startSection({ steps: [{ title: "총베팅 고르기", body: "− / + 로 한 번 돌릴 금액을 정해요. 0.2코인부터예요." }, { title: "스핀", body: "스핀 버튼이나 스페이스바를 누르면 릴이 돌아요." }, { title: "당첨은 자동", body: "그림이 맞으면 당첨 금액이 바로 잔액에 들어와요." }], tip: "가장 작은 베팅으로 몇 번 돌려 보며 화면 옆 배당표로 어떤 그림이 큰지 익혀 보세요.", odds: <>당첨 금액은 코인으로 바로 떠요. 베팅보다 적게 돌아오면 이긴 게 아니라 "반환"(회색)이에요.</> }),
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "총베팅 고르기", body: "− / + 로 0.2코인부터 20코인까지. 배당표 금액은 지금 베팅 기준, 웨이 하나의 당첨이에요." },
              { title: "웨이", body: "첫 릴부터 3개 릴 이상 이어지면 당첨. 릴마다 맞는 칸 수를 곱한 만큼(예: 2칸 × 1칸 × 2칸 = 4웨이) 받아요." },
              { title: "WILD", body: "릴 2~4 에만 나와 福 을 뺀 모든 그림을 대신해요." },
              { title: "프리스핀", body: "福 이 아무 자리 3·4·5개면 총베팅의 2·10·50배와 프리스핀 10·15·25회. 프리스핀에는 ×2·×3 배수 WILD 가 나오고, 한 웨이에 여럿이면 곱해요. 도중에 또 걸리면 더 받아요." },
            ]}
          />
          <GuideNote>베팅보다 적거나 같은 당첨은 "반환"으로 회색 표시돼요.</GuideNote>
          <GuideNote>환수율 96.32% · 프리스핀 약 169번에 1번 · 한 판(프리스핀 포함) 최대 1,000배. 당첨이 드문 대신 큰 편이에요.</GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "243웨이", body: "릴 5개 × 줄 3개에서 왼쪽부터 이을 수 있는 길의 수(3⁵). 줄을 고를 필요가 없어요." },
            { term: "배수 WILD", body: "프리스핀의 빨간 WILD ×2·×3. 그 칸을 지나는 웨이 당첨을 그만큼 곱해요." },
            { term: "福", body: "보너스 그림. 자리와 상관없이 개수로만 세요." },
          ]}
        />
      ),
    },
  ],
};

export const blackjackGuide: GameGuideContent = {
  gameKey: "blackjack",
  title: "블랙잭",
  intro: "카드 합을 21에 최대한 가깝게 만들되 넘기지 않으면서 딜러보다 높으면 이기는 게임. 이번엔 내가 직접 카드를 더 받을지 결정해요.",
  sections: [
    startSection({ steps: [{ title: "자리에 앉기", body: "테이블의 빈 자리(+)를 눌러 앉아요." }, { title: "베팅", body: "칩을 고르고 베팅 버튼을 눌러요. 베팅 시간은 12초예요." }, { title: "히트 또는 스탠드", body: "내 차례에 한 장 더 받거나(히트) 멈춰요(스탠드). 21을 넘으면 바로 져요. 딜러보다 21에 가까우면 이겨요." }], tip: "내 합이 11 이하면 히트, 17 이상이면 스탠드. 12~16 이면 딜러가 보여 준 카드가 7 이상일 때 히트, 6 이하일 때 스탠드 — 이것만 지켜도 크게 손해 보지 않아요.", odds: <>이기면 건 만큼 더 받아요(1 : 1, 10코인이 20코인). 첫 두 장으로 21(블랙잭)이면 1.5배를 더 받아요(3 : 2, 10코인이 25코인).</> }),
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "자리에 앉고 베팅 (12초)", body: "빈 자리를 눌러 앉은 뒤 칩을 고르고 베팅 버튼을 누르세요. 자리가 없으면 다른 플레이어의 자리를 눌러 따라 베팅(Bet Behind)할 수 있어요." },
              { title: "카드 2장씩", body: "나와 딜러가 2장씩 받습니다. 딜러는 한 장만 보여줘요. 딜러 카드가 A면 보험을 살지 물어봐요." },
              { title: "내 차례", body: "합을 보고 히트(한 장 더) · 스탠드(멈춤) · 더블 · 스플릿 · 서렌더 중 고르세요. 21을 넘으면(버스트) 바로 패배예요." },
              { title: "딜러 차례", body: "딜러는 합이 17 이상이 될 때까지 자동으로 카드를 받아요 (17이면 멈춤)." },
              { title: "정산", body: "딜러가 버스트하거나 내 합이 더 높으면 승리(1:1). 첫 2장으로 21이면 블랙잭(3:2). 같으면 푸시로 베팅금 반환." },
            ]}
          />
          <GuideHeading>카드 점수 계산</GuideHeading>
          <GuideNote>2~10은 숫자 그대로, J·Q·K는 10점, A는 1점 또는 11점 중 유리한 쪽. 예: A+7 = 18 (소프트 18), A+7+9 = 17.</GuideNote>
          <GuideHeading>버튼 설명</GuideHeading>
          <GuideActions
            actions={[
              { label: "히트", tone: "green", body: "카드를 한 장 더 받습니다. 합이 낮을 때." },
              { label: "스탠드", tone: "gold", body: "더 받지 않고 멈춥니다. 딜러 차례로 넘어가요." },
              { label: "더블", tone: "blue", body: "베팅을 2배로 올리고 딱 한 장만 더 받습니다. 첫 2장일 때만 가능." },
              { label: "스플릿", tone: "purple", body: "같은 숫자 2장을 두 패로 나눠 각각 플레이합니다. 추가 베팅이 필요해요 (최대 2패)." },
              { label: "서렌더", tone: "red", body: "이 판을 포기하고 베팅의 절반을 돌려받습니다. 첫 2장일 때만, 스플릿 전, 짝수 코인 베팅만 가능." },
              { label: "보험", tone: "gold", body: "딜러 오픈 카드가 A일 때, 베팅의 절반으로 딜러 블랙잭에 대비합니다 (적중 시 2:1)." },
            ]}
          />
          <GuideNote tone="red">라이트닝 블랙잭은 칩의 절반이 수수료예요. 대신 베팅이 닫힐 때 번개가 쳐서 17·18·19·20·21·블랙잭 점수마다 2~25배가 붙고, 그 점수로 이기면 그 배수가 다음 라운드 이익에 적용돼요(배수를 따낸 판돈만큼까지).</GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "블랙잭", body: "첫 2장이 A + 10점 카드로 21. 3:2로 배당받아요 (스플릿 후 21은 일반 21)." },
            { term: "버스트", body: "합이 21을 넘는 것. 넘는 순간 그 패는 패배." },
            { term: "푸시", body: "딜러와 합이 같은 경우. 베팅금을 돌려받아요." },
            { term: "소프트 핸드", body: "A를 11로 세고 있는 패. 한 장 더 받아도 버스트되지 않아요." },
            { term: "따라 베팅 (Bet Behind)", body: "앉은 자리가 없어도 다른 플레이어의 패에 함께 베팅하는 것. 그 사람의 결과를 그대로 따라가요." },
            { term: "사이드 베팅 · 퍼펙트 페어 (PP)", body: "본 베팅을 건 뒤 따로 거는 베팅. 첫 두 장이 같은 숫자면 당첨 — 색·무늬 다름 6:1, 같은 색 12:1, 같은 무늬 25:1. 카드를 받자마자 결판나요." },
            { term: "사이드 베팅 · 21+3", body: "내 두 장과 딜러의 오픈 카드 한 장을 포커 패로 봅니다 — 플러시 5:1, 스트레이트 10:1, 트리플 30:1, 스트레이트 플러시 40:1, 같은 무늬 트리플 100:1. 라이트닝 블랙잭에는 없어요." },
          ]}
        />
      ),
    },
  ],
};
