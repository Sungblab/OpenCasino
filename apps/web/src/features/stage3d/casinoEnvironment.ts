import { BackSide, BoxGeometry, Mesh, MeshBasicMaterial, PlaneGeometry, Scene, SphereGeometry } from "three";

/**
 * 금속·아크릴·카드가 비칠 주변 — 카지노 홀을 흉내 낸 작은 방. three 의 RoomEnvironment(하얀 스튜디오)는 황동이
 * 회색 빛을 받아 플라스틱 같았다. 이 방은 어두운 벽에 따뜻한 천장 조명 띠, 벽 조명, 멀리 붉고 노란 조명 방울이 있어
 * 반사에 카지노 색이 묻는다. PMREMGenerator.fromScene 으로 한 번 구워 scene.environment 로 쓴다(빛 계산은 없다 —
 * 밝기는 색 값 그 자체, 1 을 넘는 값이 HDR 로 들어간다).
 */
export function casinoRoom(): Scene {
  const scene = new Scene();
  const bright = (r: number, g: number, b: number, k: number) => {
    const m = new MeshBasicMaterial();
    m.color.setRGB(r * k, g * k, b * k);
    return m;
  };

  // 어두운 나무·벽지 방(안쪽 면만).
  const room = new Mesh(new BoxGeometry(16, 7, 16), new MeshBasicMaterial({ color: "#1a120c", side: BackSide }));
  room.position.y = 2.5;
  scene.add(room);
  const floor = new Mesh(new PlaneGeometry(16, 16), new MeshBasicMaterial({ color: "#0d0907" }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.98;
  scene.add(floor);

  // 테이블 바로 위 긴 조명 띠 — 황동 윗면과 카드에 맺히는 주 하이라이트.
  const strip = new Mesh(new PlaneGeometry(6, 0.8), bright(1, 0.86, 0.68, 7));
  strip.rotation.x = Math.PI / 2;
  strip.position.set(0, 5.9, 0);
  scene.add(strip);
  for (const x of [-4.5, 4.5]) {
    const soft = new Mesh(new PlaneGeometry(2.4, 2.4), bright(1, 0.78, 0.55, 2.4));
    soft.rotation.x = Math.PI / 2;
    soft.position.set(x, 5.8, -1);
    scene.add(soft);
  }

  // 벽 조명(호박색)과 금빛 띠.
  for (const [x, z, ry] of [[-7.9, -3, Math.PI / 2], [-7.9, 3, Math.PI / 2], [7.9, -3, -Math.PI / 2], [7.9, 3, -Math.PI / 2], [-3, -7.9, 0], [3, -7.9, 0]] as const) {
    const sconce = new Mesh(new PlaneGeometry(0.5, 1.1), bright(1, 0.62, 0.3, 9));
    sconce.position.set(x, 2.2, z);
    sconce.rotation.y = ry;
    scene.add(sconce);
  }
  // 벽을 두르는 금빛 띠(안쪽을 보는 판 넷).
  const gold = bright(0.9, 0.66, 0.28, 1.6);
  for (let i = 0; i < 4; i += 1) {
    const band = new Mesh(new PlaneGeometry(15.8, 0.12), gold);
    const angle = (i * Math.PI) / 2;
    band.position.set(Math.sin(angle) * -7.95, 0.9, Math.cos(angle) * -7.95);
    band.rotation.y = angle;
    scene.add(band);
  }

  // 멀리 보이는 조명 방울(슬롯 머신·샹들리에 느낌).
  const dot = new SphereGeometry(0.18, 12, 8);
  const colors: Array<[number, number, number, number]> = [[1, 0.3, 0.25, 6], [1, 0.75, 0.3, 7], [0.4, 0.6, 1, 4], [1, 0.5, 0.2, 6]];
  for (let i = 0; i < 18; i += 1) {
    const [r, g, b, k] = colors[i % colors.length]!;
    const angle = (i / 18) * Math.PI * 2;
    const ball = new Mesh(dot, bright(r, g, b, k));
    ball.position.set(Math.cos(angle) * 7.4, 1.4 + (i % 3) * 0.7, Math.sin(angle) * 7.4);
    scene.add(ball);
  }
  return scene;
}
