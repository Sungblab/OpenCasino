import type { HwatuCard as Hwatu } from "@opencasino/contracts";

/** 카드 id 가 곧 에셋 파일명이다 — 섯다 20장도 고스톱 48장도 같은 규칙을 쓴다. */
export function hwatuFaceUrl(card: Pick<Hwatu, "id">): string { return `/cards/hwatu/Hwatu_${card.id}.webp`; }

// card 는 id/month 만 쓴다(그림 경로 + 모서리 숫자) — kind 는 안 본다. 섯다(kind: hikari/tanzaku/
// tane/kasu, 1~10월)와 고스톱(kind: gwang/yeol/tti/pi, 1~12월)은 kind 리터럴 유니언이 서로 달라
// 전체 Hwatu 타입으로 받으면 둘 중 한쪽 호출부가 구조적으로 안 맞는다. 실제로 쓰는 두 필드만 받는다.
//
// 뒷면의 이름은 부르는 쪽이 정한다(`backLabel`). 예전엔 뒷면이면 무조건 "상대 패"라고 읽혀서
// 덱 뭉치도, 쪼기 전의 내 패도 스크린리더에는 전부 "상대 패"였다. 이름을 안 주면 장식으로
// 취급해 읽지 않는다 — 옆에 장수·주인이 따로 적혀 있는 자리가 대부분이라 그 편이 덜 시끄럽다.
export function HwatuCard({ card, hidden = false, backLabel }: { card?: Pick<Hwatu, "id" | "month">; hidden?: boolean; backLabel?: string }) {
  if (hidden || !card) {
    return backLabel
      ? <span className="hwatu-card hwatu-back" role="img" aria-label={backLabel} />
      : <span className="hwatu-card hwatu-back" aria-hidden="true" />;
  }
  return (
    <span className="hwatu-card">
      <img src={hwatuFaceUrl(card)} draggable={false} alt={`${card.month}월 화투`} />
      <b className="hwatu-month" aria-hidden="true">{card.month}</b>
    </span>
  );
}
