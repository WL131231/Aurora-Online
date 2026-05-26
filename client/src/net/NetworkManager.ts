import { Client, Room, getStateCallbacks } from "colyseus.js";

export interface RemotePlayer {
  name: string;
  x: number;
  y: number;
  dir: number;
  moving: number;
}

export interface ChatMessage {
  sessionId: string;
  name: string;
  text: string;
  ts: number;
}

export type PlayerHandler = (sessionId: string, player: RemotePlayer) => void;
export type LeaveHandler = (sessionId: string) => void;
export type ChatHandler = (msg: ChatMessage) => void;

export class NetworkManager {
  private client: Client;
  public room?: Room;
  public sessionId?: string;
  public connected = false;

  private addHandlers: PlayerHandler[] = [];
  private removeHandlers: LeaveHandler[] = [];
  private chatHandlers: ChatHandler[] = [];

  constructor(endpoint: string) {
    this.client = new Client(endpoint);
  }

  async connect(name: string): Promise<boolean> {
    try {
      const room = await this.client.joinOrCreate("world", { name });
      this.room = room;
      this.sessionId = room.sessionId;
      this.connected = true;

      const $ = getStateCallbacks(room);
      const players = ($(room.state) as unknown as {
        players: {
          onAdd: (cb: (p: RemotePlayer, k: string) => void) => void;
          onRemove: (cb: (p: RemotePlayer, k: string) => void) => void;
        };
      }).players;

      players.onAdd((player, sessionId) => {
        for (const h of this.addHandlers) h(sessionId, player);
      });
      players.onRemove((_player, sessionId) => {
        for (const h of this.removeHandlers) h(sessionId);
      });

      room.onMessage<ChatMessage>("chat", (msg) => {
        for (const h of this.chatHandlers) h(msg);
      });

      room.onLeave(() => {
        this.connected = false;
        console.log("[net] disconnected");
      });

      room.onError((code, message) => {
        console.warn("[net] room error", code, message);
      });

      console.log(`[net] connected as ${this.sessionId}`);
      return true;
    } catch (err) {
      console.warn("[net] connect failed:", err);
      this.connected = false;
      return false;
    }
  }

  getPlayers(): Map<string, RemotePlayer> | undefined {
    return this.room?.state?.players as unknown as Map<string, RemotePlayer> | undefined;
  }

  sendMove(x: number, y: number, dir: number, moving: boolean) {
    if (!this.connected || !this.room) return;
    this.room.send("move", { x, y, dir, moving: moving ? 1 : 0 });
  }

  sendChat(text: string) {
    if (!this.connected || !this.room) return;
    this.room.send("chat", { text });
  }

  onPlayerAdd(cb: PlayerHandler) {
    this.addHandlers.push(cb);
  }
  onPlayerRemove(cb: LeaveHandler) {
    this.removeHandlers.push(cb);
  }
  onChat(cb: ChatHandler) {
    this.chatHandlers.push(cb);
  }
}
