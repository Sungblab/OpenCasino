/**
 * 캔버스 게임 화면의 배치 계산. PixiJS 를 끌어오지 않는 순수 함수만 둔다 — 캔버스 엔진과
 * 캔버스 위에 겹쳐 놓는 DOM(블랙잭 좌석 버튼 등)이 같은 식으로 좌표를 구해야 둘이 어긋나지
 * 않고, 단위 테스트도 브라우저 없이 돌릴 수 있다.
 */

export interface StageFit {
  /** 설계 좌표 1 이 화면에서 몇 px 인지. */
  scale: number;
  /** 설계 폭. 화면이 넓으면 높이는 그대로 두고 옆으로 늘린다. */
  designW: number;
  /** 설계 원점이 화면에서 놓이는 곳(px). */
  x: number;
  y: number;
}

/**
 * 설계 높이(designH)는 고정하고, 폭은 minW 보다 좁아지지 않게 맞춘다. 화면이 가로로 길면 설계
 * 폭을 늘려(펠트가 옆으로 넓어진다) 빈 띠 없이 채우고, 세로로 길면 위아래에 여백을 둔다.
 */
/** 이보다 좁은 게임 화면(CSS px)은 폰으로 보고 슈·버림 패를 빼고 폰 설계(core 의 compact)를 쓴다.
 *  세로 폰 390·가로 폰 440 안팎. 캔버스 위 DOM(블랙잭 좌석)도 같은 값으로 설계를 골라야 어긋나지 않는다. */
export const COMPACT_W = 560;

export function fitStage(width: number, height: number, minW: number, designH: number): StageFit {
  if (width <= 0 || height <= 0) return { scale: 1, designW: minW, x: 0, y: 0 };
  const scale = Math.min(width / minW, height / designH);
  const designW = Math.max(minW, width / scale);
  return { scale, designW, x: (width - designW * scale) / 2, y: (height - designH * scale) / 2 };
}

/** 설계 좌표를 화면 px 로. */
export function toScreen(fit: StageFit, point: { x: number; y: number }): { x: number; y: number } {
  return { x: fit.x + point.x * fit.scale, y: fit.y + point.y * fit.scale };
}

/**
 * 뒤집는 카드의 네 모서리(왼쪽 위부터 시계 방향, x·y 번갈아). hw·hh 는 보이는 반폭·반높이, persp 는 −1~1 로
 * 다가오는 모서리 쪽(+ 오른쪽)과 정도. 원근 투영 x' = x·f/(f−z): 다가오는 모서리는 바깥으로 밀리며 커진다.
 * 0.16 ≈ 카드 폭의 3배 거리에서 보는 원근.
 */
export function flipCorners(hw: number, hh: number, persp: number): [number, number, number, number, number, number, number, number] {
  const k = persp * 0.16;
  const near = 1 / (1 - Math.abs(k));
  const far = 1 / (1 + Math.abs(k));
  const right = k >= 0 ? near : far;
  const left = k >= 0 ? far : near;
  return [-hw * left, -hh * left, hw * right, -hh * right, hw * right, hh * right, -hw * left, hh * left];
}
