import http from "node:http";
import express from "express";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import { WorldRoom } from "./rooms/WorldRoom.js";

const PORT = Number(process.env.PORT ?? 2567);

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    name: "Aurora Online",
    status: "ok",
    time: new Date().toISOString(),
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/monitor", monitor());

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("world", WorldRoom);

httpServer.listen(PORT, () => {
  console.log(`Aurora Online server listening on http://localhost:${PORT}`);
  console.log(`Monitor: http://localhost:${PORT}/monitor`);
});

const shutdown = async () => {
  console.log("\n[shutdown] gracefully closing...");
  await gameServer.gracefullyShutdown();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
