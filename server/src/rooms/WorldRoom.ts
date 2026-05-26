import { Client, Room } from "colyseus";
import { Player, WorldState } from "../schemas/WorldState.js";

const TILE = 32;
const MAP_W = 50;
const MAP_H = 50;
const WORLD_W = MAP_W * TILE;
const WORLD_H = MAP_H * TILE;

type JoinOptions = {
  name?: string;
};

type MoveMessage = {
  x: number;
  y: number;
  dir?: number;
  moving?: number;
};

type ChatMessage = {
  text: string;
};

const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]", "g");
const MAX_NAME = 16;
const MAX_CHAT = 200;

export class WorldRoom extends Room<WorldState> {
  state = new WorldState();
  maxClients = 64;

  onCreate() {
    this.onMessage("move", (client, msg: MoveMessage) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      if (typeof msg.x !== "number" || typeof msg.y !== "number") return;
      p.x = clamp(msg.x, 0, WORLD_W);
      p.y = clamp(msg.y, 0, WORLD_H);
      if (typeof msg.dir === "number" && msg.dir >= 0 && msg.dir < 4) {
        p.dir = msg.dir | 0;
      }
      if (typeof msg.moving === "number") {
        p.moving = msg.moving ? 1 : 0;
      }
    });

    this.onMessage("chat", (client, msg: ChatMessage) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      const text = sanitize(msg?.text ?? "").slice(0, MAX_CHAT);
      if (!text) return;
      this.broadcast("chat", {
        sessionId: client.sessionId,
        name: p.name,
        text,
        ts: Date.now(),
      });
    });
  }

  onJoin(client: Client, options: JoinOptions) {
    const p = new Player();
    const requested = sanitize(options?.name ?? "").slice(0, MAX_NAME);
    p.name = requested || `Guest${client.sessionId.slice(0, 4)}`;
    p.x = WORLD_W / 2 + (Math.random() - 0.5) * 96;
    p.y = WORLD_H / 2 + (Math.random() - 0.5) * 96;
    p.dir = 0;
    this.state.players.set(client.sessionId, p);
    console.log(`[join] ${p.name} (${client.sessionId}) — ${this.state.players.size} online`);
  }

  onLeave(client: Client) {
    const p = this.state.players.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    console.log(`[leave] ${p?.name ?? client.sessionId} — ${this.state.players.size} online`);
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function sanitize(s: string): string {
  return String(s).replace(CONTROL_CHARS, "").trim();
}
