import { BufferAttribute, type BufferGeometry, Vector3 } from "three";

/** 룰렛·식보가 같이 쓰는 번개 줄기. 매 깜빡임마다 다시 만든다(50~60ms). */

/** 번개 줄기: 두 점 사이를 반씩 나누며 옆으로 흔든다(중점 변위). */
export function boltPoints(from: Vector3, to: Vector3, rand: () => number): Vector3[] {
  let points = [from.clone(), to.clone()];
  let spread = from.distanceTo(to) * 0.16;
  for (let depth = 0; depth < 5; depth += 1) {
    const next: Vector3[] = [points[0]!];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.x += (rand() - 0.5) * spread;
      mid.z += (rand() - 0.5) * spread;
      next.push(mid, b);
    }
    points = next;
    spread *= 0.55;
  }
  return points;
}

/** 카메라를 향하는 띠. 선 굵기가 1px 로 묶이는 WebGL 선 대신. */
export function ribbon(geometry: BufferGeometry, points: Vector3[], width: number, eye: Vector3): void {
  const positions = new Float32Array(points.length * 2 * 3);
  const side = new Vector3();
  const toEye = new Vector3();
  const tangent = new Vector3();
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)]!;
    const b = points[Math.min(points.length - 1, i + 1)]!;
    tangent.subVectors(b, a).normalize();
    toEye.subVectors(eye, p).normalize();
    side.crossVectors(tangent, toEye).normalize().multiplyScalar(width * (0.35 + 0.65 * (1 - i / points.length)));
    positions.set([p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z], i * 6);
  });
  const index: number[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const k = i * 2;
    index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
}
