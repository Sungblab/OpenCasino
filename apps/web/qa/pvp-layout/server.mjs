// PvP 화면 QA 용 가짜 API. 진짜 서버 대신 고정 스냅샷을 내려준다.
// 방 id 자리에 상태 이름을 넣어 접속한다: /rooms/sutda/turn2 → fixtures-sutda STATES.turn2,
// /rooms/holdem/flop-turn → fixtures-holdem STATES["flop-turn"].
import { createRequire } from "node:module";
import http from "node:http";
import * as sutda from "./fixtures-sutda.mjs";
import * as holdem from "./fixtures-holdem.mjs";
import * as gostop from "./fixtures-gostop.mjs";
const require = createRequire(new URL("../../../api/package.json", import.meta.url));
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const GAMES = { sutda, holdem, gostop };
const ME = sutda.ME;
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.get("/api/v1/health", (_req, res) => res.json({ ok: true }));
app.get("/api/v1/chat/rooms/:id/messages", (_req, res) => res.json({ items: [] }));
app.post("/api/v1/auth/refresh", (_req, res) => res.json({ token: "qa-token", user: ME }));
app.post("/api/v1/auth/logout", (_req, res) => res.json({ ok: true }));
app.use((_req, res) => res.json({}));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
io.on("connection", (socket) => {
  let current = null;
  for (const [game, mod] of Object.entries(GAMES)) {
    socket.on(`${game}.join`, ({ roomId }, ack) => {
      current = mod.fixture(roomId);
      ack(current ? { ok: true, data: current } : { ok: false, error: `no ${game} fixture: ${roomId}` });
    });
  }
  socket.onAny((event, ...args) => {
    if (event.endsWith(".join")) return;
    const ack = args.at(-1);
    if (typeof ack === "function") ack({ ok: true, data: current ?? {} });
  });
});
const PORT = Number(process.env.QA_API_PORT ?? 5199);
server.listen(PORT, "127.0.0.1", () => console.log(`qa api on ${PORT} (sutda, holdem, gostop)`));
