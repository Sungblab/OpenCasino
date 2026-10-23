/**
 * 좌석 배지처럼 폭이 100px 남짓인 자리에 쓰는 짧은 금액. "WIN +12,345,678" 은 배지에서 말줄임으로
 * 잘려 "WIN +12,34…"가 됐다 — 잘린 숫자는 틀린 숫자보다 나쁘다. 만·억 단위로 줄여 쓰고, 정확한
 * 금액은 title 과 독의 결과 목록이 말한다.
 */
export function compactAmount(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const value = Math.abs(amount);
  if (value < 10_000) return `${sign}${value.toLocaleString()}`;
  if (value < 100_000_000) return `${sign}${trim(value / 10_000)}만`;
  return `${sign}${trim(value / 100_000_000)}억`;
}

/** 두 자리 이하 정수부는 소수 한 자리까지, 그 위는 정수로. 끝의 ".0" 은 뗀다. */
function trim(value: number): string {
  const text = value < 100 ? value.toFixed(1) : Math.round(value).toLocaleString();
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}
