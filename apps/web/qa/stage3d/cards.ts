/**
 * 카드 뒤집기 실험실 — 뒤집기 진행(f)별로 한 장씩 멈춰 세워 원근·빛 띠를 본다(개발 서버 전용).
 * http://127.0.0.1:<vite>/qa/stage3d/cards.html
 */
import { Application } from "pixi.js";
import { cardBackUrl } from "../../src/components/CardFace";
import { CardView, cardTexture, faceTexture, type CardDeps } from "../../src/features/stage/core";
import { TEX_H, TEX_W, backTexture, faceTexture as hwatuFace } from "../../src/features/stage/hwatu";

const app = new Application();
await app.init({ resizeTo: window, background: "#0f3a28", antialias: true, resolution: 1 });
document.body.appendChild(app.canvas);
const back = await cardTexture(cardBackUrl());
const face = await faceTexture({ rank: "A", suit: "S" });
const deps: CardDeps = {
  tween: async (_ms, fn) => fn(1),
  wait: async () => undefined,
  sounds: {},
  pullFromShoe: async () => ({ x: 0, y: 0, r: 0 }),
  back,
};
const steps = [0, 0.2, 0.35, 0.45, 0.55, 0.65, 0.8, 1];
steps.forEach((f, i) => {
  const view = new CardView(deps, { rank: "A", suit: "S" }, face, 1.6);
  view.position.set(110 + i * 150, 200);
  if (f >= 0.5) view.showFace();
  view.turn(f);
  view.glint(f < 0.5 ? -1 : (f - 0.5) * 2);
  view.lift = Math.sin(f * Math.PI) * 10;
  view.apply();
  app.stage.addChild(view);
});
const hwatuDeps: CardDeps = { ...deps, back: await backTexture(), size: { w: 50, h: 82, texW: TEX_W, texH: TEX_H }, thickness: 2 };
const gwang = { id: "January_Hikari", month: 1 };
const gwangFace = await hwatuFace(gwang);
steps.forEach((f, i) => {
  const view = new CardView(hwatuDeps, gwang, gwangFace, 2);
  view.position.set(110 + i * 150, 440);
  if (f >= 0.5) view.showFace();
  view.turn(f);
  view.glint(f < 0.5 ? -1 : (f - 0.5) * 2);
  view.apply();
  app.stage.addChild(view);
});
(window as unknown as { labReady: boolean }).labReady = true;
