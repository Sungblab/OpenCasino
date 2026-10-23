/**
 * 사람 좌석엔 아무것도 안 붙인다 — 닉네임 글자가 이미 이름이다. 봇 좌석만 "봇"을 붙여서
 * AI 상대라는 걸 표시하고(겸사겸사 내보내기 버튼도 여기), 사람 자리엔 이니셜 원을 안 그린다.
 */
export function SeatAvatar({ isMine, isBot, onRemove, busy }: {
  isMine?: boolean; isBot?: boolean; onRemove?: () => void; busy?: boolean;
}) {
  if (!isBot) return null;
  const className = `seat-avatar is-bot${isMine ? " is-mine" : ""}`;
  if (!onRemove) return <span className={className} aria-hidden="true">봇</span>;
  return (
    <button type="button" className={`${className} is-removable`} onClick={onRemove} disabled={busy} title="AI 봇 — 내보내기" aria-label="AI 봇 내보내기">
      봇
    </button>
  );
}
