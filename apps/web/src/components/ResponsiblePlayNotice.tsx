export function ResponsiblePlayNotice({ placement }: { placement: "footer" | "login" | "menu" }) {
  return (
    <aside className={`responsible-play-notice is-${placement}`} aria-label="안전한 게임 이용 안내">
      <p>실제 돈을 거는 도박은 하지 마세요. 이곳은 현금 가치가 없는 무료 게임 코인 시뮬레이터입니다.</p>
      <p><strong>도박 문제 전화상담</strong>: <a href="tel:1336">국번 없이 1336 (무료)</a></p>
    </aside>
  );
}
