import { Client, Room, getStateCallbacks } from "colyseus.js";

export interface RemotePlayer {
  name: string;
  x: number;
  y: number;
  dir: number;
  moving: number;
}

export interface RemoteHarvestable {
  rtype: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: number;
  variant: number;
  scale: number;
}

export interface ChatMessage {
  sessionId: string;
  name: string;
  text: string;
  ts: number;
}

export interface HarvestDropEvent {
  id: string;
  sessionId: string;
  x: number;
  y: number;
  rtype: string;
  dropId: string;
}

export type PlayerHandler = (sessionId: string, player: RemotePlayer) => void;
export type LeaveHandler = (sessionId: string) => void;
export type ChatHandler = (msg: ChatMessage) => void;
export type HarvestableAddHandler = (id: string, h: RemoteHarvestable) => void;
export type HarvestableChangeHandler = (id: string, h: RemoteHarvestable) => void;
export type HarvestableRemoveHandler = (id: string) => void;
export type HarvestDropHandler = (event: HarvestDropEvent) => void;
export type InventoryHandler = (itemId: string, count: number) => void;

export class NetworkManager {
  private client: Client;
  public room?: Room;
  public sessionId?: string;
  public connected = false;

  private addHandlers: PlayerHandler[] = [];
  private removeHandlers: LeaveHandler[] = [];
  private chatHandlers: ChatHandler[] = [];
  private hAddHandlers: HarvestableAddHandler[] = [];
  private hChangeHandlers: HarvestableChangeHandler[] = [];
  private hRemoveHandlers: HarvestableRemoveHandler[] = [];
  private hDropHandlers: HarvestDropHandler[] = [];
  private invHandlers: InventoryHandler[] = [];
  private $?: ReturnType<typeof getStateCallbacks>;

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
      this.$ = $;
      const state = $(room.state) as unknown as {
        players: {
          onAdd: (cb: (p: RemotePlayer, k: string) => void) => void;
          onRemove: (cb: (p: RemotePlayer, k: string) => void) => void;
        };
        harvestables: {
          onAdd: (cb: (h: RemoteHarvestable, k: string) => void) => void;
          onRemove: (cb: (h: RemoteHarvestable, k: string) => void) => void;
        };
      };

      state.players.onAdd((player, sessionId) => {
        for (const h of this.addHandlers) h(sessionId, player);
        if (sessionId === this.sessionId) {
          this.subscribeOwnInventory(player);
        }
      });
      state.players.onRemove((_player, sessionId) => {
        for (const h of this.removeHandlers) h(sessionId);
      });

      state.harvestables.onAdd((h, id) => {
        for (const cb of this.hAddHandlers) cb(id, h);
        // Per-instance change callback. The Colyseus typings here are loose; we
        // cast through unknown to access the onChange hook the runtime exposes.
        const node = $(h as unknown as object) as unknown as {
          onChange: (cb: () => void) => void;
        };
        node.onChange(() => {
          for (const cb of this.hChangeHandlers) cb(id, h);
        });
      });
      state.harvestables.onRemove((_h, id) => {
        for (const cb of this.hRemoveHandlers) cb(id);
      });

      room.onMessage<ChatMessage>("chat", (msg) => {
        for (const h of this.chatHandlers) h(msg);
      });
      room.onMessage<HarvestDropEvent>("harvest_drop", (msg) => {
        for (const cb of this.hDropHandlers) cb(msg);
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

  sendHarvest(id: string, toolId: string) {
    if (!this.connected || !this.room) return;
    this.room.send("harvest", { id, toolId });
  }

  private subscribeOwnInventory(player: RemotePlayer) {
    if (!this.$) return;
    const inv = (player as unknown as { inventory: object }).inventory;
    if (!inv) return;
    const callbacks = this.$(inv) as unknown as {
      onAdd: (cb: (count: number, key: string) => void) => void;
      onChange: (cb: (count: number, key: string) => void) => void;
      onRemove: (cb: (count: number, key: string) => void) => void;
    };
    callbacks.onAdd((count, itemId) => {
      for (const cb of this.invHandlers) cb(itemId, count);
    });
    callbacks.onChange((count, itemId) => {
      for (const cb of this.invHandlers) cb(itemId, count);
    });
    callbacks.onRemove((_count, itemId) => {
      for (const cb of this.invHandlers) cb(itemId, 0);
    });
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
  onHarvestableAdd(cb: HarvestableAddHandler) {
    this.hAddHandlers.push(cb);
  }
  onHarvestableChange(cb: HarvestableChangeHandler) {
    this.hChangeHandlers.push(cb);
  }
  onHarvestableRemove(cb: HarvestableRemoveHandler) {
    this.hRemoveHandlers.push(cb);
  }
  onHarvestDrop(cb: HarvestDropHandler) {
    this.hDropHandlers.push(cb);
  }
  onInventoryChange(cb: InventoryHandler) {
    this.invHandlers.push(cb);
  }
}
