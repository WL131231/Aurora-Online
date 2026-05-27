import { Client, Room } from "colyseus";
import { FarmPatch, Harvestable, Player, WorldState } from "../schemas/WorldState.js";

const TILE = 32;
// World is one continuous 150-tile-wide strip split into 3 zones:
// logging (X 0..49) | village (X 50..99) | mine (X 100..149).
const MAP_W = 150;
const MAP_H = 50;
const WORLD_W = MAP_W * TILE;
const WORLD_H = MAP_H * TILE;
const SPAWN_CLEAR_RADIUS = 5;

// Zones (mirror client: farm/village/logging horizontal split).
const ZONE_FARM_X_MAX = Math.floor(MAP_W / 3);
const ZONE_VILLAGE_X_MAX = Math.floor((MAP_W * 2) / 3);

// Harvest config — mirrors client/src/game/items.ts.
const RESOURCE_BASE_HP: Record<string, number> = {
  tree: 4,
  rock: 3,
  copper_node: 5,
  silver_node: 7,
  gold_node: 9,
};
const RESOURCE_RESPAWN_MS: Record<string, number> = {
  tree: 45_000,
  rock: 60_000,
  copper_node: 90_000,
  silver_node: 120_000,
  gold_node: 180_000,
};
const TOOL_FOR_RESOURCE: Record<string, string> = {
  tree: "axe",
  rock: "pickaxe",
  copper_node: "pickaxe",
  silver_node: "pickaxe",
  gold_node: "pickaxe",
};
const DROP_FOR_RESOURCE: Record<string, string> = {
  tree: "wood",
  rock: "stone",
  copper_node: "copper_ore",
  silver_node: "silver_ore",
  gold_node: "gold_ore",
};

// Distance check for harvest — slight buffer over client HARVEST_RANGE=56
// so honest clients don't get rejected by float drift.
const HARVEST_RANGE_SQ = 80 * 80;
const FARM_REACH_SQ = 80 * 80;
const FARM_GROW_MS = 30_000;
const FARM_BASE_TX = 82;
const FARM_BASE_TY = 36;
const FARM_COLS = 6;
const FARM_ROWS = 5;

// Tinytown frame indices used for trees (alive variants).
const TREE_FRAMES = [0, 1, 2, 3, 4, 5, 6, 7];

type JoinOptions = { name?: string };
type MoveMessage = { x: number; y: number; dir?: number; moving?: number };
type ChatMessage = { text: string };
type HarvestMessage = { id: string; toolId: string };
type HotbarSelectMessage = { index: number };
type FarmActionMessage = { id: string };

const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]", "g");
const MAX_NAME = 16;
const MAX_CHAT = 200;

export class WorldRoom extends Room<WorldState> {
  state = new WorldState();
  maxClients = 64;

  onCreate() {
    this.seedHarvestables();
    this.seedFarmPatches();

    this.onMessage("move", (client, msg: MoveMessage) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      if (typeof msg.x !== "number" || typeof msg.y !== "number") return;
      p.x = clamp(msg.x, 0, WORLD_W);
      p.y = clamp(msg.y, 0, WORLD_H);
      if (typeof msg.dir === "number" && msg.dir >= 0 && msg.dir < 8) {
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

    this.onMessage("harvest", (client, msg: HarvestMessage) => {
      this.handleHarvest(client, msg);
    });

    this.onMessage("hotbar_select", (client, msg: HotbarSelectMessage) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      const idx = msg?.index | 0;
      if (idx < 0 || idx >= p.hotbar.length) return;
      p.selectedHotbar = idx;
    });

    this.onMessage("farm_plant", (client, msg: FarmActionMessage) => {
      this.handleFarmPlant(client, msg);
    });
    this.onMessage("farm_harvest", (client, msg: FarmActionMessage) => {
      this.handleFarmHarvest(client, msg);
    });
  }

  private seedFarmPatches() {
    let counter = 0;
    for (let dy = 0; dy < FARM_ROWS; dy++) {
      for (let dx = 0; dx < FARM_COLS; dx++) {
        const f = new FarmPatch();
        f.x = (FARM_BASE_TX + dx) * TILE + TILE / 2;
        f.y = (FARM_BASE_TY + dy) * TILE + TILE / 2;
        f.state = "empty";
        f.plantedAt = 0;
        f.plantedBy = "";
        this.state.farmPatches.set(`f${counter++}`, f);
      }
    }
    console.log(`[seed] ${this.state.farmPatches.size} farm patches`);
  }

  private handleFarmPlant(client: Client, msg: FarmActionMessage) {
    if (!msg || typeof msg.id !== "string") return;
    const patch = this.state.farmPatches.get(msg.id);
    if (!patch || patch.state !== "empty") return;
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const dx = patch.x - p.x;
    const dy = patch.y - p.y;
    if (dx * dx + dy * dy > FARM_REACH_SQ) return;
    const seeds = p.inventory.get("turnip_seed") ?? 0;
    if (seeds <= 0) return;
    p.inventory.set("turnip_seed", seeds - 1);
    patch.state = "planted";
    patch.plantedAt = Date.now();
    patch.plantedBy = client.sessionId;
    this.clock.setTimeout(() => {
      const cur = this.state.farmPatches.get(msg.id);
      if (!cur || cur.state !== "planted") return;
      cur.state = "grown";
    }, FARM_GROW_MS);
  }

  private handleFarmHarvest(client: Client, msg: FarmActionMessage) {
    if (!msg || typeof msg.id !== "string") return;
    const patch = this.state.farmPatches.get(msg.id);
    if (!patch || patch.state !== "grown") return;
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const dx = patch.x - p.x;
    const dy = patch.y - p.y;
    if (dx * dx + dy * dy > FARM_REACH_SQ) return;
    const cur = p.inventory.get("turnip") ?? 0;
    p.inventory.set("turnip", cur + 1);
    patch.state = "empty";
    patch.plantedAt = 0;
    patch.plantedBy = "";
  }

  private seedHarvestables() {
    let counter = 0;
    const rand = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));

    const place = (
      rtype: string,
      tx: number,
      ty: number,
      variant: number,
      scale: number,
    ) => {
      const h = new Harvestable();
      h.rtype = rtype;
      h.x = tx * TILE + TILE / 2;
      h.y = ty * TILE + TILE / 2;
      h.hp = RESOURCE_BASE_HP[rtype];
      h.maxHp = h.hp;
      h.alive = 1;
      h.variant = variant;
      h.scale = scale;
      this.state.harvestables.set(`h${counter++}`, h);
    };

    // Logging zone (X 0..ZONE_FARM_X_MAX): trees only.
    for (let i = 0; i < 80; i++) {
      const tx = rand(1, ZONE_FARM_X_MAX);
      const ty = rand(1, MAP_H - 2);
      const variant = TREE_FRAMES[rand(0, TREE_FRAMES.length - 1)];
      place("tree", tx, ty, variant, 1.75);
    }

    // Mine zone (X ZONE_VILLAGE_X_MAX+1..MAP_W-2): rocks + ores.
    for (let i = 0; i < 25; i++) {
      const tx = rand(ZONE_VILLAGE_X_MAX + 1, MAP_W - 2);
      const ty = rand(1, MAP_H - 2);
      place("rock", tx, ty, 11, 1);
    }
    const ores: Array<{ type: string; count: number }> = [
      { type: "copper_node", count: 12 },
      { type: "silver_node", count: 6 },
      { type: "gold_node", count: 3 },
    ];
    for (const ore of ores) {
      for (let i = 0; i < ore.count; i++) {
        const tx = rand(ZONE_VILLAGE_X_MAX + 1, MAP_W - 2);
        const ty = rand(1, MAP_H - 2);
        place(ore.type, tx, ty, 0, 1);
      }
    }

    console.log(`[seed] ${this.state.harvestables.size} harvestables`);
  }

  private handleHarvest(client: Client, msg: HarvestMessage) {
    if (!msg || typeof msg.id !== "string" || typeof msg.toolId !== "string") return;
    const h = this.state.harvestables.get(msg.id);
    if (!h || h.alive !== 1) return;

    const required = TOOL_FOR_RESOURCE[h.rtype];
    if (!required || msg.toolId !== required) return;

    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const dx = h.x - p.x;
    const dy = h.y - p.y;
    if (dx * dx + dy * dy > HARVEST_RANGE_SQ) return;

    h.hp = Math.max(0, h.hp - 1);
    if (h.hp <= 0) {
      h.alive = 0;
      const dropId = DROP_FOR_RESOURCE[h.rtype];
      // Credit the harvester's inventory (server-authoritative).
      const current = p.inventory.get(dropId) ?? 0;
      p.inventory.set(dropId, current + 1);

      this.broadcast("harvest_drop", {
        id: msg.id,
        sessionId: client.sessionId,
        x: h.x,
        y: h.y,
        rtype: h.rtype,
        dropId,
      });
      const respawnMs = RESOURCE_RESPAWN_MS[h.rtype];
      this.clock.setTimeout(() => {
        const node = this.state.harvestables.get(msg.id);
        if (!node) return;
        node.hp = node.maxHp;
        node.alive = 1;
      }, respawnMs);
    }
  }

  onJoin(client: Client, options: JoinOptions) {
    const p = new Player();
    const requested = sanitize(options?.name ?? "").slice(0, MAX_NAME);
    p.name = requested || `Guest${client.sessionId.slice(0, 4)}`;
    p.x = WORLD_W / 2 + (Math.random() - 0.5) * 96;
    p.y = WORLD_H / 2 + (Math.random() - 0.5) * 96;
    p.dir = 0;

    // Starter inventory + hotbar (20 slots not enforced server-side yet — just defaults).
    p.inventory.set("axe", 1);
    p.inventory.set("pickaxe", 1);
    p.inventory.set("turnip_seed", 5);
    p.hotbar.push("axe", "pickaxe", "turnip_seed", "", "", "", "", "");
    p.selectedHotbar = 0;

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
