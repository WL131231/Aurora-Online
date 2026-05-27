import Phaser from "phaser";
import { NetworkManager } from "../net/NetworkManager";
import type { RemoteHarvestable, RemotePlayer } from "../net/NetworkManager";
import {
  DROP_FOR_RESOURCE,
  ITEMS,
  RESOURCE_BASE_HP,
  RESOURCE_RESPAWN_MS,
  TOOL_FOR_RESOURCE,
  type ResourceType,
} from "../game/items";
import type { Hotbar, Inventory } from "../game/inventory";
import type { Hud, MinimapZone } from "../ui/hud";

const TILE = 32;
// World is a 150-tile-wide strip split into 3 zones:
// logging (X 0..49) | village (X 50..99) | mine (X 100..149).
// The whole current screen worth of tiles is one zone — walking off the
// edge of the village transitions you into the next zone seamlessly.
const MAP_W = 150;
const MAP_H = 50;
const WORLD_W = MAP_W * TILE;
const WORLD_H = MAP_H * TILE;
const PLAYER_SPEED = 140;
const RUN_SPEED = 230;

// Map zones (3-way horizontal split). Farm = west, village = center, logging = east.
const ZONE_FARM_X_MAX = Math.floor(MAP_W / 3);          // 0..16 = farm
const ZONE_VILLAGE_X_MAX = Math.floor((MAP_W * 2) / 3); // 17..33 = village
// 34..49 = logging
const INV_SQRT2 = 1 / Math.SQRT2;

const SEND_INTERVAL_MS = 80;
const MOVE_DELTA_THRESHOLD = 0.5;

const SERVER_ENDPOINT =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "ws://localhost:2567";

// Kenney Tiny Town tileset frame indices (12 cols × 11 rows, 132 tiles).
// Only grass variants kept — trees and props now come from PixelLab.
const GRASS_BASE = 0;
const GRASS_TUFT = 1;
const GRASS_FLOWER = 2;
const SPAWN_CLEAR_RADIUS = 5;

// PixelLab props sheet (4x4 grid, 48px each)
// Row 0: 0=smallOak, 1=mediumOak, 2=tallPine, 3=largeOak
// Row 1: 4=autumnMaple, 5=cherryBlossom, 6=appleTree, 7=birch
// Row 2: 8=deadTree, 9=smallBush, 10=largeBush, 11=boulder
// Row 3: 12=smallRocks, 13=mushrooms, 14=stump, 15=wildflowers
const PROP_FRAME = 48;
// Trees: alive only, scaled 1.5x and collidable
const TREE_FRAMES = [0, 1, 2, 3, 4, 5, 6, 7];
// Large props that should NOT scale (already big enough at native size), collidable
const OBSTACLE_FRAMES = [11, 14];
// Walk-through decorations (no collision, native size)
const DECORATION_FRAMES = [9, 10, 12, 13, 15];

// PixelLab character sprite sheets
const PLAYER_FRAME = 60;
const WALK_FRAMES_PER_DIR = 6;
const CHOP_FRAMES_PER_DIR = 8;

// Distance threshold (px) for SPACE-key harvest pickup
const HARVEST_RANGE = 56;
// Delay between swing start and damage impact (matches mid-arc of chop anim).
const SWING_IMPACT_MS = 220;
// 8-direction order (PixelLab + our internal dir): 0=S, 1=SE, 2=E, 3=NE, 4=N, 5=NW, 6=W, 7=SW
const DIR_KEYS = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"] as const;
// Chop sheets only have 4 cardinals, but N/S frames don't render the tool clearly.
// Map N → S (front-facing chop) so the player always swings facing the camera
// unless they're moving sideways. E/W keep their own sideview frames.
const CARDINAL_KEYS = ["S", "E", "N", "W"] as const;
const DIR_TO_CARDINAL = [0, 1, 1, 1, 0, 3, 3, 3];
const CHOP_TOOLS = ["axe", "pickaxe"] as const;

// World spawn config for ore nodes. Counts scale rarity by tier.
const ORE_NODES: Array<{ type: ResourceType; textureKey: string; count: number }> = [
  { type: "copper_node", textureKey: "node_copper", count: 12 },
  { type: "silver_node", textureKey: "node_silver", count: 6 },
  { type: "gold_node", textureKey: "node_gold", count: 3 },
];

// Zone transition is by walking across the village's west/east border:
// camera flashes when the player's current zone changes (no portal sprite).
const ZONE_LABEL: Record<string, string> = {
  village: "마을",
  logging: "벌목장",
  mine: "광산",
};

// Village buildings (top-down 3/4 perspective). Each is placed once.
interface BuildingSpec {
  key: string;          // texture key
  tx: number;           // tile x (top-left anchor relative to origin)
  ty: number;           // tile y
  npcKey?: string;      // optional NPC sprite placed just below the door
  npcName: string;      // display name above NPC
}
const BUILDINGS: BuildingSpec[] = [
  // tx values sit inside the village zone (X 50..99). Town hall flanks the
  // road centerline (tile 75); store + blacksmith flank the plaza further south.
  { key: "bldg_town_hall", tx: 75, ty: 14, npcKey: "npc_chief_lee",       npcName: "이장 이씨" },
  { key: "bldg_store",     tx: 70, ty: 32, npcKey: "npc_mrs_lee",         npcName: "잡화점 이씨"  },
  { key: "bldg_blacksmith",tx: 79, ty: 32, npcKey: "npc_blacksmith_roh",  npcName: "대장장이 노씨" },
];

const NPC_LINES: Record<string, string> = {
  "이장 이씨": "어서 오게, 모험가. 마을은 평화롭지만 곧 할 일이 생길 거야.",
  "잡화점 이씨": "오늘은 어떤 게 필요해요? 곧 진열대를 채울 예정이에요!",
  "대장장이 노씨": "도구가 무뎌졌으면 가져오게. 강화 시스템도 곧 준비할 테니.",
};
const NPC_TALK_RANGE_SQ = 70 * 70;

interface RemoteEntity {
  sprite: Phaser.GameObjects.Sprite;
  nameTag: Phaser.GameObjects.Image;
  name: string;
  chatBubble?: Phaser.GameObjects.Container;
  chatTimer?: Phaser.Time.TimerEvent;
}

interface LabelStyle {
  color: string;
  background?: string;
  stroke?: { color: string; width: number };
  fontSize?: number;
  padX?: number;
  padY?: number;
  fontFamily?: string;
}

const LABEL_FONT_FAMILY = "PFStardust, Galmuri11, monospace";

export class MainScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private harvestKey!: Phaser.Input.Keyboard.Key;
  private runKey!: Phaser.Input.Keyboard.Key;
  private nameTag!: Phaser.GameObjects.Image;
  private harvestables!: Phaser.GameObjects.Group;
  // id → sprite map for server-synced harvestables (online mode only).
  private harvestablesById = new Map<string, Phaser.GameObjects.Sprite>();
  // Server-synced harvestable HP cache so we can detect deltas on change.
  private serverHpCache = new Map<string, number>();
  private npcs: Array<{ sprite: Phaser.GameObjects.Sprite; name: string; line: string }> = [];

  private net!: NetworkManager;
  private playerName = "Aurora";
  private remotes = new Map<string, RemoteEntity>();

  private lastSentAt = 0;
  private lastSentX = 0;
  private lastSentY = 0;
  private lastSentDir = 0;
  private lastSentMoving = false;
  private dir = 0;

  private statusText!: Phaser.GameObjects.Text;
  private chatLogText!: Phaser.GameObjects.Text;
  private chatLog: string[] = [];
  private bakedTextureCounter = 0;
  private ready = false;
  private swinging = false;
  private lastZone: "village" | "logging" | "mine" = "village";
  private zoneBanner?: Phaser.GameObjects.Text;
  private minimapZones: MinimapZone[] = [
    { x: 0, y: 0, w: ZONE_FARM_X_MAX * TILE, h: WORLD_H, color: "#c2b07d" },
    {
      x: ZONE_FARM_X_MAX * TILE,
      y: 0,
      w: (ZONE_VILLAGE_X_MAX - ZONE_FARM_X_MAX) * TILE,
      h: WORLD_H,
      color: "#a89c8a",
    },
    {
      x: ZONE_VILLAGE_X_MAX * TILE,
      y: 0,
      w: WORLD_W - ZONE_VILLAGE_X_MAX * TILE,
      h: WORLD_H,
      color: "#4d7a3a",
    },
  ];

  constructor() {
    super("MainScene");
  }

  preload() {
    this.load.spritesheet("tinytown", "/assets/tilesets/tinytown.png", {
      frameWidth: TILE,
      frameHeight: TILE,
    });
    this.load.spritesheet("props", "/assets/props/props.png", {
      frameWidth: PROP_FRAME,
      frameHeight: PROP_FRAME,
    });
    this.load.spritesheet("player_walks", "/assets/characters/player_walks.png", {
      frameWidth: PLAYER_FRAME,
      frameHeight: PLAYER_FRAME,
    });
    this.load.spritesheet("player_idle", "/assets/characters/player_idle.png", {
      frameWidth: PLAYER_FRAME,
      frameHeight: PLAYER_FRAME,
    });
    this.load.spritesheet("player_runs", "/assets/characters/player_runs.png", {
      frameWidth: PLAYER_FRAME,
      frameHeight: PLAYER_FRAME,
    });
    for (const item of Object.values(ITEMS)) {
      if (item.iconUrl) this.load.image(`item_${item.id}`, item.iconUrl);
    }
    for (const ore of ORE_NODES) {
      this.load.image(ore.textureKey, `/assets/props/${ore.textureKey}.png`);
    }
    // Village buildings.
    this.load.image("bldg_town_hall", "/assets/buildings/town_hall.png");
    this.load.image("bldg_store", "/assets/buildings/store.png");
    this.load.image("bldg_blacksmith", "/assets/buildings/blacksmith.png");
    // Castle (gatehouse) at the north end of the village.
    this.load.image("castle", "/assets/buildings/castle.png");
    // Market props on the central plaza.
    this.load.image("fountain", "/assets/props/fountain.png");
    this.load.image("stall_yellow", "/assets/props/stall_yellow.png");
    this.load.image("stall_red", "/assets/props/stall_red.png");
    this.load.image("stall_green", "/assets/props/stall_green.png");
    // Painted village reference (not painted as a layer — kept for reference).
    this.load.image("map_village", "/assets/maps/village.png");
    // NPC south-facing idles (full 8-direction support can be added later)
    this.load.image("npc_chief_lee", "/assets/npcs/chief_lee.png");
    this.load.image("npc_mrs_lee", "/assets/npcs/mrs_lee.png");
    this.load.image("npc_blacksmith_roh", "/assets/npcs/blacksmith_roh.png");
    for (const tool of CHOP_TOOLS) {
      this.load.spritesheet(`player_chop_${tool}`, `/assets/characters/player_chop_${tool}.png`, {
        frameWidth: PLAYER_FRAME,
        frameHeight: PLAYER_FRAME,
      });
    }
    // Missing optional sheets fall back gracefully (chop → tool overlay, runs → walk).
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      if (file.key === "player_runs" || file.key.startsWith("player_chop_")) {
        console.info(`[anim] missing ${file.key} — falling back`);
      }
    });
  }

  async create() {
    this.playerName = pickName();

    // Block on font load so canvas-baked labels render with Galmuri11 from
    // the start; without this, the first labels would bake with the fallback
    // monospace font and only swap in after the font loads.
    try {
      await Promise.all([
        document.fonts.load("12px PFStardust"),
        document.fonts.load("11px Galmuri11"),
      ]);
    } catch {
      // ignore — caller will fall back to monospace
    }

    this.buildGroundLayer();
    this.buildDecorations();
    this.harvestables = this.add.group();
    this.buildVillage();
    this.createPlayerAnimations();

    const spawnX = WORLD_W / 2;
    const spawnY = WORLD_H / 2;
    this.player = this.physics.add.sprite(spawnX, spawnY, "player_idle", 0);
    this.player.setOrigin(0.5, 0.85);
    this.player.setCollideWorldBounds(true);
    const pbody = this.player.body as Phaser.Physics.Arcade.Body;
    pbody.setSize(20, 8).setOffset(20, 46);

    const nameTagKey = this.bakeLabel(this.playerName, {
      color: "#ffffff",
      fontSize: 11,
    });
    this.nameTag = this.add
      .image(spawnX, spawnY - 5, nameTagKey)
      .setOrigin(0.5, 0)
      .setDepth(100000);

    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.startFollow(this.player, true, 1, 1);
    this.cameras.main.setZoom(2);
    this.cameras.main.setRoundPixels(true);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.harvestKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.harvestKey.on("down", () => this.tryHarvest());
    this.runKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

    this.setupHud();
    this.setupChatInput();

    this.net = new NetworkManager(SERVER_ENDPOINT);
    this.net.onPlayerAdd((id, player) => this.handlePlayerAdd(id, player));
    this.net.onPlayerRemove((id) => this.handlePlayerRemove(id));
    this.net.onChat((msg) => this.appendChat(`${msg.name}: ${msg.text}`, msg.sessionId));
    this.net.onHarvestableAdd((id, h) => this.addServerHarvestable(id, h));
    this.net.onHarvestableChange((id, h) => this.changeServerHarvestable(id, h));
    this.net.onHarvestableRemove((id) => this.removeServerHarvestable(id));
    this.net.onHarvestDrop((evt) => this.handleHarvestDrop(evt));
    const inventory = this.registry.get("inventory") as Inventory | undefined;
    if (inventory) {
      this.net.onInventoryChange((itemId, count) => {
        inventory.setFromServer(itemId, count);
      });
    }

    this.setStatus("연결 중...");
    const ok = await this.net.connect(this.playerName);
    if (ok) {
      this.setStatus(`온라인 — ${this.playerName}`);
    } else {
      // Offline: seed locally so the world isn't empty.
      this.seedOfflineHarvestables();
      this.setStatus(`오프라인 모드 — ${this.playerName} (서버 없음)`);
    }

    this.lastSentX = this.player.x;
    this.lastSentY = this.player.y;
    this.ready = true;
  }

  update(time: number) {
    if (!this.ready) return;
    if (this.swinging) {
      this.player.setVelocity(0, 0);
      this.nameTag.setPosition(this.player.x, this.player.y - 5);
      this.syncRemotes();
      this.maybeSendMove(time, false);
      this.updateMinimap();
      return;
    }
    let vx = 0;
    let vy = 0;
    if (this.cursors.left?.isDown) vx -= 1;
    if (this.cursors.right?.isDown) vx += 1;
    if (this.cursors.up?.isDown) vy -= 1;
    if (this.cursors.down?.isDown) vy += 1;
    if (vx !== 0 && vy !== 0) {
      vx *= INV_SQRT2;
      vy *= INV_SQRT2;
    }
    const moving = vx !== 0 || vy !== 0;
    const running = moving && this.runKey.isDown;
    const speed = running ? RUN_SPEED : PLAYER_SPEED;
    this.player.setVelocity(vx * speed, vy * speed);

    const sx = vx === 0 ? 0 : vx < 0 ? -1 : 1;
    const sy = vy === 0 ? 0 : vy < 0 ? -1 : 1;
    if (sx !== 0 || sy !== 0) {
      const d = directionFromVector(sx, sy);
      if (d !== undefined) this.dir = d;
    }

    this.player.setDepth(this.player.y);
    // No Math.round here — camera.setRoundPixels(true) handles screen snapping.
    // Rounding world coords causes 1px jumps that don't align with camera scrolling,
    // which is what produced the nameplate jitter.
    this.nameTag.setPosition(this.player.x, this.player.y - 5);

    this.applyPlayerAnimation(this.player, this.dir, moving, running);
    this.tryBuildingEnter();
    this.checkZoneTransition();

    this.syncRemotes();
    this.maybeSendMove(time, moving);
    this.updateMinimap();
  }

  private updateMinimap() {
    const hud = this.registry.get("hud") as Hud | undefined;
    if (!hud) return;
    hud.minimap.update({
      worldW: WORLD_W,
      worldH: WORLD_H,
      playerX: this.player.x,
      playerY: this.player.y,
      zones: this.minimapZones,
      buildings: BUILDINGS.map((b) => ({
        x: b.tx * TILE + TILE / 2,
        y: b.ty * TILE + TILE / 2,
      })),
      forEachResource: (cb) => {
        for (const obj of this.harvestables.getChildren()) {
          const sprite = obj as Phaser.GameObjects.Sprite;
          if (!sprite.active || !sprite.visible) continue;
          cb(sprite.x, sprite.y, sprite.getData("resourceType") as string);
        }
      },
    });
  }

  private createPlayerAnimations() {
    if (this.anims.exists("walk_S")) return;
    for (let dir = 0; dir < DIR_KEYS.length; dir++) {
      const key = `walk_${DIR_KEYS[dir]}`;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers("player_walks", {
          start: dir * WALK_FRAMES_PER_DIR,
          end: dir * WALK_FRAMES_PER_DIR + WALK_FRAMES_PER_DIR - 1,
        }),
        frameRate: 10,
        repeat: -1,
      });
    }
    if (this.textures.exists("player_runs")) {
      for (let dir = 0; dir < DIR_KEYS.length; dir++) {
        this.anims.create({
          key: `run_${DIR_KEYS[dir]}`,
          frames: this.anims.generateFrameNumbers("player_runs", {
            start: dir * WALK_FRAMES_PER_DIR,
            end: dir * WALK_FRAMES_PER_DIR + WALK_FRAMES_PER_DIR - 1,
          }),
          frameRate: 14,
          repeat: -1,
        });
      }
    }
    for (const tool of CHOP_TOOLS) {
      const sheet = `player_chop_${tool}`;
      if (!this.textures.exists(sheet)) continue;
      for (let dir = 0; dir < CARDINAL_KEYS.length; dir++) {
        this.anims.create({
          key: `chop_${tool}_${CARDINAL_KEYS[dir]}`,
          frames: this.anims.generateFrameNumbers(sheet, {
            start: dir * CHOP_FRAMES_PER_DIR,
            end: dir * CHOP_FRAMES_PER_DIR + CHOP_FRAMES_PER_DIR - 1,
          }),
          frameRate: 18,
          repeat: 0,
        });
      }
    }
  }

  private applyPlayerAnimation(
    sprite: Phaser.GameObjects.Sprite,
    dir: number,
    moving: boolean,
    running = false
  ) {
    const clampedDir = dir >= 0 && dir < DIR_KEYS.length ? dir : 0;
    if (moving) {
      const runKey = `run_${DIR_KEYS[clampedDir]}`;
      const useRun = running && this.anims.exists(runKey);
      const key = useRun ? runKey : `walk_${DIR_KEYS[clampedDir]}`;
      // Replay if direction changed OR if the anim is currently stopped.
      // Previously we only checked key change, which meant releasing a key
      // and pressing it again kept currentAnim.key === target but isPlaying
      // was false — the character moved without animating.
      if (sprite.anims.currentAnim?.key !== key || !sprite.anims.isPlaying) {
        sprite.play(key, true);
      }
      return;
    }
    if (sprite.anims.isPlaying) sprite.anims.stop();
    if (sprite.texture.key !== "player_idle" || sprite.frame.name !== String(clampedDir)) {
      sprite.setTexture("player_idle", clampedDir);
    }
  }

  private maybeSendMove(time: number, moving: boolean) {
    if (!this.net.connected) return;
    const dx = this.player.x - this.lastSentX;
    const dy = this.player.y - this.lastSentY;
    const moved = Math.abs(dx) > MOVE_DELTA_THRESHOLD || Math.abs(dy) > MOVE_DELTA_THRESHOLD;
    const dirChanged = this.dir !== this.lastSentDir;
    const movingChanged = moving !== this.lastSentMoving;
    if (!moved && !dirChanged && !movingChanged) return;
    if (time - this.lastSentAt < SEND_INTERVAL_MS && !movingChanged) return;

    this.net.sendMove(this.player.x, this.player.y, this.dir, moving);
    this.lastSentAt = time;
    this.lastSentX = this.player.x;
    this.lastSentY = this.player.y;
    this.lastSentDir = this.dir;
    this.lastSentMoving = moving;
  }

  private syncRemotes() {
    const players = this.net.getPlayers();
    if (!players) return;
    for (const [sid, ent] of this.remotes) {
      const p = (players as unknown as { get: (k: string) => RemotePlayer | undefined }).get(sid);
      if (!p) continue;
      const lerp = 0.25;
      ent.sprite.x = Phaser.Math.Linear(ent.sprite.x, p.x, lerp);
      ent.sprite.y = Phaser.Math.Linear(ent.sprite.y, p.y, lerp);
      ent.sprite.setDepth(ent.sprite.y);
      ent.nameTag.setPosition(ent.sprite.x, ent.sprite.y - 5);
      ent.nameTag.setDepth(ent.sprite.y + 1);
      this.applyPlayerAnimation(ent.sprite, p.dir | 0, !!p.moving);
      if (ent.chatBubble) {
        ent.chatBubble.setPosition(ent.sprite.x, ent.sprite.y - ent.sprite.displayHeight - 8);
        ent.chatBubble.setDepth(ent.sprite.y + 2);
      }
    }
  }

  private handlePlayerAdd(sid: string, p: RemotePlayer) {
    if (sid === this.net.sessionId) return;
    if (this.remotes.has(sid)) return;
    const initialDir = Math.min(Math.max(p.dir | 0, 0), DIR_KEYS.length - 1);
    const sprite = this.add.sprite(p.x, p.y, "player_idle", initialDir);
    sprite.setOrigin(0.5, 0.85);
    sprite.setDepth(p.y);
    const nameTagKey = this.bakeLabel(p.name, {
      color: "#cfe8ff",
      fontSize: 11,
    });
    const nameTag = this.add
      .image(p.x, p.y - 5, nameTagKey)
      .setOrigin(0.5, 0)
      .setDepth(p.y + 1);
    this.remotes.set(sid, { sprite, nameTag, name: p.name });
    this.appendChat(`* ${p.name} 입장`, sid);
  }

  private handlePlayerRemove(sid: string) {
    const ent = this.remotes.get(sid);
    if (!ent) return;
    const name = ent.name;
    ent.sprite.destroy();
    ent.nameTag.destroy();
    ent.chatBubble?.destroy();
    ent.chatTimer?.remove();
    this.remotes.delete(sid);
    this.appendChat(`* ${name} 퇴장`, sid);
  }

  private setupHud() {
    this.statusText = this.add
      .text(8, 8, "", {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#ffffff",
        backgroundColor: "rgba(0,0,0,0.5)",
        padding: { x: 6, y: 4 },
        resolution: 2,
      })
      .setScrollFactor(0)
      .setDepth(100001);

    // Bottom of canvas is occupied by the HTML hotbar (~100px tall when
     // scaled). Push these texts above that band so they never clip into the
     // hotbar background.
    this.chatLogText = this.add
      .text(8, 540 - 110 - 4, "", {
        fontFamily: "monospace",
        fontSize: "10px",
        color: "#ffffff",
        backgroundColor: "rgba(0,0,0,0.4)",
        padding: { x: 6, y: 4 },
        resolution: 2,
        wordWrap: { width: 400 },
      })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(100001);

    this.add
      .text(8, 540 - 110, "[방향키] 이동  ·  [Shift] 달리기  ·  [Space] 채취  ·  [E] 인벤토리  ·  [Enter] 채팅", {
        fontFamily: "monospace",
        fontSize: "9px",
        color: "#aaaaaa",
        resolution: 2,
      })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(100001);
  }

  private setupChatInput() {
    this.input.keyboard!.on("keydown-ENTER", () => {
      const existing = document.getElementById("chat-input") as HTMLInputElement | null;
      if (existing) {
        const text = existing.value.trim();
        if (text) {
          this.net.sendChat(text);
        }
        existing.remove();
        this.input.keyboard!.enabled = true;
        return;
      }
      const input = document.createElement("input");
      input.id = "chat-input";
      input.type = "text";
      input.maxLength = 200;
      input.placeholder = "메시지 입력 후 Enter (Esc 취소)";
      Object.assign(input.style, {
        position: "fixed",
        left: "50%",
        bottom: "20px",
        transform: "translateX(-50%)",
        width: "min(420px, 80vw)",
        padding: "8px 12px",
        border: "1px solid #555",
        borderRadius: "6px",
        background: "rgba(20,20,20,0.9)",
        color: "#fff",
        font: "14px monospace",
        zIndex: "9999",
        outline: "none",
      });
      document.body.appendChild(input);
      this.input.keyboard!.enabled = false;
      requestAnimationFrame(() => input.focus());
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const text = input.value.trim();
          if (text) this.net.sendChat(text);
          input.remove();
          this.input.keyboard!.enabled = true;
          e.stopPropagation();
        } else if (e.key === "Escape") {
          input.remove();
          this.input.keyboard!.enabled = true;
          e.stopPropagation();
        }
      });
    });
  }

  private setStatus(text: string) {
    if (!this.statusText) return;
    this.statusText.setText(text);
  }

  private appendChat(line: string, sid?: string) {
    this.chatLog.push(line);
    if (this.chatLog.length > 6) this.chatLog.shift();
    this.chatLogText.setText(this.chatLog.join("\n"));

    if (sid && sid !== this.net.sessionId) {
      const ent = this.remotes.get(sid);
      if (ent && !line.startsWith("* ")) {
        const bubbleText = line.split(": ").slice(1).join(": ");
        this.showBubble(ent, bubbleText);
      }
    } else if (sid && sid === this.net.sessionId && !line.startsWith("* ")) {
      this.showSelfBubble(line.split(": ").slice(1).join(": "));
    }
  }

  private showBubble(ent: RemoteEntity, text: string) {
    ent.chatBubble?.destroy();
    ent.chatTimer?.remove();
    const container = this.makeBubble(text);
    container.setPosition(ent.sprite.x, ent.sprite.y - ent.sprite.displayHeight - 8);
    container.setDepth(ent.sprite.y + 2);
    ent.chatBubble = container;
    ent.chatTimer = this.time.delayedCall(3500, () => {
      container.destroy();
      ent.chatBubble = undefined;
      ent.chatTimer = undefined;
    });
  }

  private selfBubble?: Phaser.GameObjects.Container;
  private selfBubbleTimer?: Phaser.Time.TimerEvent;
  private showSelfBubble(text: string) {
    this.selfBubble?.destroy();
    this.selfBubbleTimer?.remove();
    const container = this.makeBubble(text);
    container.setPosition(this.player.x, this.player.y - this.player.displayHeight - 8);
    container.setDepth(this.player.y + 2);
    this.selfBubble = container;
    this.selfBubbleTimer = this.time.delayedCall(3500, () => {
      container.destroy();
      this.selfBubble = undefined;
      this.selfBubbleTimer = undefined;
    });
  }

  private makeBubble(text: string): Phaser.GameObjects.Container {
    const key = this.bakeLabel(text, {
      color: "#000000",
      background: "#ffffff",
      padX: 5,
      padY: 3,
    });
    const img = this.add.image(0, 0, key).setOrigin(0.5, 1);
    return this.add.container(0, 0, [img]);
  }

  private bakeLabel(text: string, style: LabelStyle): string {
    const fontSize = style.fontSize ?? 11;
    const padX = style.padX ?? 3;
    const padY = style.padY ?? 1;
    const fontFamily = style.fontFamily ?? LABEL_FONT_FAMILY;
    const strokeW = style.stroke?.width ?? 0;
    const key = `label-${this.bakedTextureCounter++}`;

    const font = `${fontSize}px ${fontFamily}`;
    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = font;
    const lines = text.split("\n");
    const lineW = Math.ceil(Math.max(...lines.map((s) => measure.measureText(s).width)));
    const lineH = fontSize + 2;
    const w = lineW + padX * 2 + strokeW * 2;
    const h = lineH * lines.length + padY * 2 + strokeW * 2;

    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    if (style.background) {
      ctx.fillStyle = style.background;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.font = font;
    ctx.textBaseline = "top";
    lines.forEach((line, i) => {
      const x = padX + strokeW;
      const y = padY + strokeW + i * lineH;
      if (style.stroke) {
        ctx.strokeStyle = style.stroke.color;
        ctx.lineWidth = style.stroke.width;
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        ctx.strokeText(line, x, y);
      }
      ctx.fillStyle = style.color;
      ctx.fillText(line, x, y);
    });

    // Threshold both alpha AND color to remove ClearType subpixel anti-aliasing
    // that canvas font rendering bakes into the texture. Threshold 32 keeps
    // the rendered bitmap glyph intact while clipping faint AA fringes.
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha < 32) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
        continue;
      }
      const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (lum > 128) {
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
      } else {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
      }
      data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);

    const tex = this.textures.addCanvas(key, c);
    // Explicit NEAREST filter so scaling via camera zoom stays pixel-perfect
    // even if the global pixelArt default doesn't propagate to canvas textures.
    if (tex && typeof (tex as unknown as { setFilter?: (f: number) => void }).setFilter === "function") {
      (tex as unknown as { setFilter: (f: number) => void }).setFilter(0);
    }
    return key;
  }

  private buildGroundLayer() {
    const rng = new Phaser.Math.RandomDataGenerator(["aurora-ground"]);
    const data: number[][] = [];
    for (let y = 0; y < MAP_H; y++) {
      const row: number[] = [];
      for (let x = 0; x < MAP_W; x++) {
        const r = rng.frac();
        row.push(r < 0.85 ? GRASS_BASE : r < 0.93 ? GRASS_TUFT : GRASS_FLOWER);
      }
      data.push(row);
    }
    const map = this.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
    const tileset = map.addTilesetImage("tinytown", "tinytown", TILE, TILE, 0, 0);
    if (tileset) {
      const layer = map.createLayer(0, tileset, 0, 0);
      layer?.setDepth(-1000);
    }
  }

  private buildDecorations() {
    const rng = new Phaser.Math.RandomDataGenerator(["aurora-decor"]);
    const center = { x: MAP_W / 2, y: MAP_H / 2 };
    for (let i = 0; i < 50; i++) {
      const tx = rng.between(1, MAP_W - 2);
      const ty = rng.between(1, MAP_H - 2);
      if (Math.abs(tx - center.x) < SPAWN_CLEAR_RADIUS && Math.abs(ty - center.y) < SPAWN_CLEAR_RADIUS) continue;
      if (this.isInVillage(tx, ty)) continue;
      const idx = DECORATION_FRAMES[rng.between(0, DECORATION_FRAMES.length - 1)];
      const wx = tx * TILE + TILE / 2;
      const wy = ty * TILE + TILE / 2;
      const sprite = this.add.sprite(wx, wy, "props", idx);
      sprite.setOrigin(0.5, 0.9);
      sprite.setDepth(wy - 1);
    }
  }

  private isInVillage(tx: number, _ty: number): boolean {
    // Village is the central X band; full vertical span (ty unused).
    return tx > ZONE_FARM_X_MAX && tx <= ZONE_VILLAGE_X_MAX;
  }

  // Offline fallback when the server isn't reachable. Server is the master in
  // online mode; this only runs when net.connect() fails.
  private seedOfflineHarvestables() {
    const group = this.harvestables;
    const rng = new Phaser.Math.RandomDataGenerator(["aurora-trees"]);
    const center = { x: MAP_W / 2, y: MAP_H / 2 };

    for (let i = 0; i < 80; i++) {
      const tx = rng.between(1, MAP_W - 2);
      const ty = rng.between(1, MAP_H - 2);
      if (Math.abs(tx - center.x) < SPAWN_CLEAR_RADIUS && Math.abs(ty - center.y) < SPAWN_CLEAR_RADIUS) continue;
      if (this.isInVillage(tx, ty)) continue;
      const idx = TREE_FRAMES[rng.between(0, TREE_FRAMES.length - 1)];
      const wx = tx * TILE + TILE / 2;
      const wy = ty * TILE + TILE / 2;
      const tree = this.add.sprite(wx, wy, "props", idx);
      tree.setOrigin(0.5, 0.9);
      tree.setScale(1.75);
      tree.setDepth(wy);
      this.markHarvestable(tree, "tree");
      group.add(tree);
    }

    // Boulders are rock-harvestable; stumps remain props (already harvested).
    for (let i = 0; i < 25; i++) {
      const tx = rng.between(1, MAP_W - 2);
      const ty = rng.between(1, MAP_H - 2);
      if (Math.abs(tx - center.x) < SPAWN_CLEAR_RADIUS && Math.abs(ty - center.y) < SPAWN_CLEAR_RADIUS) continue;
      if (this.isInVillage(tx, ty)) continue;
      const idx = OBSTACLE_FRAMES[rng.between(0, OBSTACLE_FRAMES.length - 1)];
      const wx = tx * TILE + TILE / 2;
      const wy = ty * TILE + TILE / 2;
      const sprite = this.add.sprite(wx, wy, "props", idx);
      sprite.setOrigin(0.5, 0.9);
      sprite.setDepth(wy);
      if (idx === 11) {
        this.markHarvestable(sprite, "rock");
        group.add(sprite);
      }
      // stumps stay as scenery
    }

    // Ore nodes (copper / silver / gold) — only if textures loaded successfully.
    for (const ore of ORE_NODES) {
      if (!this.textures.exists(ore.textureKey)) continue;
      for (let i = 0; i < ore.count; i++) {
        const tx = rng.between(1, MAP_W - 2);
        const ty = rng.between(1, MAP_H - 2);
        if (Math.abs(tx - center.x) < SPAWN_CLEAR_RADIUS && Math.abs(ty - center.y) < SPAWN_CLEAR_RADIUS) continue;
        if (this.isInVillage(tx, ty)) continue;
        const wx = tx * TILE + TILE / 2;
        const wy = ty * TILE + TILE / 2;
        const sprite = this.add.sprite(wx, wy, ore.textureKey);
        sprite.setOrigin(0.5, 0.9);
        sprite.setDepth(wy);
        this.markHarvestable(sprite, ore.type);
        group.add(sprite);
      }
    }
  }

  // ---- Server-synced harvestables ----

  private resolveHarvestableTexture(h: RemoteHarvestable): { key: string; frame?: number } | null {
    if (h.rtype === "tree" || h.rtype === "rock") {
      return { key: "props", frame: h.variant };
    }
    if (h.rtype === "copper_node") return { key: "node_copper" };
    if (h.rtype === "silver_node") return { key: "node_silver" };
    if (h.rtype === "gold_node") return { key: "node_gold" };
    return null;
  }

  private addServerHarvestable(id: string, h: RemoteHarvestable) {
    const tex = this.resolveHarvestableTexture(h);
    if (!tex) return;
    if (!this.textures.exists(tex.key)) return;
    const sprite = tex.frame !== undefined
      ? this.add.sprite(h.x, h.y, tex.key, tex.frame)
      : this.add.sprite(h.x, h.y, tex.key);
    sprite.setOrigin(0.5, 0.9);
    if (h.scale !== 1) sprite.setScale(h.scale);
    sprite.setDepth(h.y);
    sprite.setData("resourceType", h.rtype);
    sprite.setData("harvestableId", id);
    sprite.setData("baseScaleY", sprite.scaleY);
    sprite.setVisible(h.alive === 1);
    sprite.setActive(h.alive === 1);
    this.harvestables.add(sprite);
    this.harvestablesById.set(id, sprite);
    this.serverHpCache.set(id, h.hp);
  }

  private changeServerHarvestable(id: string, h: RemoteHarvestable) {
    const sprite = this.harvestablesById.get(id);
    if (!sprite) return;
    const prevHp = this.serverHpCache.get(id) ?? h.maxHp;
    this.serverHpCache.set(id, h.hp);

    if (h.hp < prevHp) this.flashHarvestable(sprite);

    const wasAlive = sprite.visible;
    const isAlive = h.alive === 1;
    if (wasAlive && !isAlive) {
      const baseScaleY = (sprite.getData("baseScaleY") as number) ?? sprite.scaleY;
      this.tweens.add({
        targets: sprite,
        alpha: 0,
        scaleY: baseScaleY * 0.6,
        duration: 220,
        onComplete: () => {
          sprite.setVisible(false).setActive(false);
          sprite.setAlpha(1);
          sprite.setScale(sprite.scaleX, baseScaleY);
        },
      });
    } else if (!wasAlive && isAlive) {
      sprite.setVisible(true).setActive(true);
    }
  }

  private removeServerHarvestable(id: string) {
    const sprite = this.harvestablesById.get(id);
    if (!sprite) return;
    this.harvestables.remove(sprite, true, true);
    this.harvestablesById.delete(id);
    this.serverHpCache.delete(id);
  }

  private handleHarvestDrop(evt: {
    id: string;
    sessionId: string;
    x: number;
    y: number;
    rtype: string;
    dropId: string;
  }) {
    // Server-authoritative inventory: the count is already updated via the
    // player.inventory MapSchema. We only spawn the visual particle here.
    if (!this.textures.exists(`item_${evt.dropId}`)) return;
    const drop = this.add.image(evt.x, evt.y - 12, `item_${evt.dropId}`);
    drop.setDepth(99999);
    drop.setScale(0.6);
    if (evt.sessionId === this.net.sessionId) {
      // Self: fly to player.
      this.tweens.add({
        targets: drop,
        y: evt.y - 28,
        scale: 0.8,
        duration: 220,
        ease: "Sine.easeOut",
        onComplete: () => {
          this.tweens.add({
            targets: drop,
            x: this.player.x,
            y: this.player.y - 12,
            scale: 0.35,
            alpha: 0.4,
            duration: 320,
            ease: "Cubic.easeIn",
            onComplete: () => drop.destroy(),
          });
        },
      });
    } else {
      // Spectator: gentle float-and-fade.
      this.tweens.add({
        targets: drop,
        y: drop.y - 18,
        alpha: 0,
        duration: 400,
        onComplete: () => drop.destroy(),
      });
    }
  }

  private flashHarvestable(sprite: Phaser.GameObjects.Sprite) {
    sprite.setTint(0xff8a8a);
    this.time.delayedCall(90, () => sprite.clearTint());
    const baseX = sprite.x;
    this.tweens.add({
      targets: sprite,
      x: baseX + 3,
      duration: 40,
      yoyo: true,
      repeat: 1,
      onComplete: () => sprite.setX(baseX),
    });
  }

  // Attach harvest metadata + remember initial scale so respawn can reset it
  // even after the death tween squashed the sprite.
  private markHarvestable(sprite: Phaser.GameObjects.Sprite, type: ResourceType) {
    sprite.setData("resourceType", type);
    sprite.setData("hp", RESOURCE_BASE_HP[type]);
    sprite.setData("baseScaleY", sprite.scaleY);
  }

  private buildVillage() {
    // Layout reconstructs the partner-supplied reference image
    // (assets/maps/village.png) in-engine using individual sprites:
    //   - cobblestone road runs N→S through the village
    //   - castle gatehouse at the north end
    //   - 3 buildings (town hall, store, blacksmith) flank the plaza
    //   - fountain + 3 market stalls form the central plaza
    //   - dense tree belt lines the village along both edges

    // 1. Cobblestone road (north-south through the village center).
    const villageCenterTileX = Math.floor((ZONE_FARM_X_MAX + ZONE_VILLAGE_X_MAX + 1) / 2);
    const roadCx = villageCenterTileX * TILE + TILE / 2;
    const roadHalfW = TILE * 2; // 4-tile wide road
    const road = this.add.graphics();
    road.fillStyle(0x8a857a, 1);
    road.fillRect(roadCx - roadHalfW, 0, roadHalfW * 2, WORLD_H);
    road.lineStyle(2, 0x5e5a52, 1);
    road.lineBetween(roadCx - roadHalfW, 0, roadCx - roadHalfW, WORLD_H);
    road.lineBetween(roadCx + roadHalfW, 0, roadCx + roadHalfW, WORLD_H);
    // Faint cobble dots every 2 tiles for texture.
    road.fillStyle(0x6e6a60, 0.6);
    for (let y = 16; y < WORLD_H; y += TILE) {
      for (let x = roadCx - roadHalfW + 6; x < roadCx + roadHalfW; x += 16) {
        road.fillRect(x, y, 2, 2);
      }
    }
    road.setDepth(-800);

    // 2. Castle gatehouse — north anchor of the village.
    const castleTileY = 5;
    if (this.textures.exists("castle")) {
      const castle = this.add.sprite(roadCx, castleTileY * TILE, "castle");
      castle.setOrigin(0.5, 0.5);
      castle.setDepth(castleTileY * TILE);
    }

    // 3. Central plaza fountain.
    const fountainTileY = 25;
    if (this.textures.exists("fountain")) {
      const fountain = this.add.sprite(roadCx, fountainTileY * TILE, "fountain");
      fountain.setOrigin(0.5, 0.9);
      fountain.setScale(2);
      fountain.setDepth(fountainTileY * TILE);
    }

    // 4. Three market stalls around the fountain.
    const stalls: Array<{ tx: number; ty: number; key: string }> = [
      { tx: villageCenterTileX - 3, ty: fountainTileY + 1, key: "stall_yellow" },
      { tx: villageCenterTileX + 3, ty: fountainTileY + 1, key: "stall_red" },
      { tx: villageCenterTileX,     ty: fountainTileY - 3, key: "stall_green" },
    ];
    for (const s of stalls) {
      if (!this.textures.exists(s.key)) continue;
      const wx = s.tx * TILE + TILE / 2;
      const wy = s.ty * TILE + TILE / 2;
      const stall = this.add.sprite(wx, wy, s.key);
      stall.setOrigin(0.5, 0.9);
      stall.setScale(1.5);
      stall.setDepth(wy);
    }

    // 5. Dense tree belts along the inner edges of the village zone.
    // Skip the small-oak (0) and birch (7) frames — they render weird thin
    // trunks at this scale that look like broken vertical bars.
    const beltTileLeft = ZONE_FARM_X_MAX + 1;     // first tile inside village
    const beltTileRight = ZONE_VILLAGE_X_MAX;     // last tile inside village
    const beltVariants = [1, 2, 3, 4, 5, 6];
    for (let ty = 4; ty < MAP_H - 1; ty += 2) {
      for (const tx of [beltTileLeft, beltTileLeft + 1, beltTileRight - 1, beltTileRight]) {
        if (ty >= fountainTileY - 4 && ty <= fountainTileY + 4) continue;
        const variant = beltVariants[(tx + ty) % beltVariants.length];
        const tree = this.add.sprite(tx * TILE + TILE / 2, ty * TILE + TILE / 2, "props", variant);
        tree.setOrigin(0.5, 0.9);
        tree.setScale(1.75);
        tree.setDepth(ty * TILE);
      }
    }

    // 6. Buildings (3 sided around the plaza).
    for (const b of BUILDINGS) {
      const wx = b.tx * TILE + TILE / 2;
      const wy = b.ty * TILE + TILE / 2;
      if (this.textures.exists(b.key)) {
        const bldg = this.add.sprite(wx, wy, b.key);
        bldg.setOrigin(0.5, 0.9);
        // Buildings are 256px source (no upscaling stretch) — scale to ~0.75
        // so two of them flank the road comfortably inside the 16-tile-wide
        // village zone.
        bldg.setScale(0.75);
        bldg.setDepth(wy);
      }
      if (b.npcKey && this.textures.exists(b.npcKey)) {
        const nx = wx;
        // Stand below the (now larger) building so NPCs are clearly outside
        // the doorway rather than clipping into the wall.
        const ny = wy + TILE * 5;
        const npc = this.add.sprite(nx, ny, b.npcKey);
        npc.setOrigin(0.5, 0.85);
        // NPC source canvas is 68px, player frame is 60px — scale so the
        // silhouette matches the player on screen.
        npc.setScale(60 / 68);
        npc.setDepth(ny);
        const labelKey = this.bakeLabel(b.npcName, {
          color: "#ffefb0",
          fontSize: 9,
        });
        // Name plate now sits below the feet so the face is unobstructed.
        const label = this.add.image(nx, ny + 6, labelKey);
        label.setOrigin(0.5, 0);
        label.setDepth(ny + 1);
        this.npcs.push({
          sprite: npc,
          name: b.npcName,
          line: NPC_LINES[b.npcName] ?? "...",
        });
      }
    }
  }

  private currentZone(): "village" | "logging" | "mine" {
    const tx = Math.floor(this.player.x / TILE);
    if (tx <= ZONE_FARM_X_MAX) return "logging";
    if (tx > ZONE_VILLAGE_X_MAX) return "mine";
    return "village";
  }

  // Camera flashes + a big center banner when the player crosses a zone
  // border. No teleport — the world is contiguous; the banner just sells the
  // "new map" feel partner asked for.
  private checkZoneTransition() {
    const zone = this.currentZone();
    if (zone === this.lastZone) return;
    this.lastZone = zone;
    this.cameras.main.flash(260, 0, 0, 0);
    this.showZoneBanner(ZONE_LABEL[zone]);
  }

  private showZoneBanner(name: string) {
    this.zoneBanner?.destroy();
    const banner = this.add
      .text(480, 160, `[${name}]`, {
        fontFamily: "PFStardust, Galmuri11, monospace",
        fontSize: "28px",
        color: "#fff8d0",
        backgroundColor: "rgba(0,0,0,0.72)",
        padding: { x: 28, y: 14 },
        resolution: 2,
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(100002)
      .setAlpha(0);
    this.zoneBanner = banner;
    this.tweens.add({
      targets: banner,
      alpha: 1,
      duration: 220,
      yoyo: true,
      hold: 1200,
      onComplete: () => {
        banner.destroy();
        if (this.zoneBanner === banner) this.zoneBanner = undefined;
      },
    });
  }

  private tryBuildingEnter() {
    if (!this.cursors.up) return;
    if (!Phaser.Input.Keyboard.JustDown(this.cursors.up)) return;
    for (const b of BUILDINGS) {
      const bx = b.tx * TILE + TILE / 2;
      const by = b.ty * TILE + TILE / 2;
      const dx = bx - this.player.x;
      const dy = by - this.player.y;
      if (dx * dx + dy * dy < 140 * 140) {
        this.enterBuilding(b);
        return;
      }
    }
  }

  private enterBuilding(b: BuildingSpec) {
    // Interior zones (full rooms) ship in the next chapter. For now a placeholder
    // greeting fires so the building feels alive and the resident NPC speaks up.
    this.appendChat(`[${b.npcName}의 건물 입구] 내부는 다음 업데이트에 열립니다.`);
    const line = NPC_LINES[b.npcName];
    if (line) this.appendChat(`${b.npcName}: ${line}`);
  }

  private tryHarvest() {
    if (this.swinging) return;

    // NPC interaction wins over harvest when a friendly is in range.
    for (const npc of this.npcs) {
      const dx = npc.sprite.x - this.player.x;
      const dy = npc.sprite.y - this.player.y;
      if (dx * dx + dy * dy < NPC_TALK_RANGE_SQ) {
        this.appendChat(`${npc.name}: ${npc.line}`);
        return;
      }
    }

    const hotbar = this.registry.get("hotbar") as Hotbar | undefined;
    const inventory = this.registry.get("inventory") as Inventory | undefined;
    if (!hotbar || !inventory) return;
    const tool = hotbar.getSelected();
    if (!tool || tool.kind !== "tool") return;

    const targetTypes = new Set<ResourceType>();
    for (const [rtype, requiredTool] of Object.entries(TOOL_FOR_RESOURCE) as Array<[ResourceType, string]>) {
      if (requiredTool === tool.id) targetTypes.add(rtype);
    }

    const px = this.player.x;
    const py = this.player.y;
    let nearest: Phaser.GameObjects.Sprite | null = null;
    if (targetTypes.size > 0) {
      let nearestDist = HARVEST_RANGE;
      for (const obj of this.harvestables.getChildren()) {
        const sprite = obj as Phaser.GameObjects.Sprite;
        if (!sprite.active || !sprite.visible) continue;
        if (!targetTypes.has(sprite.getData("resourceType") as ResourceType)) continue;
        const dx = sprite.x - px;
        const dy = sprite.y - py;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < nearestDist) {
          nearest = sprite;
          nearestDist = dist;
        }
      }
    }

    if (nearest) {
      const ndx = nearest.x - this.player.x;
      const ndy = nearest.y - this.player.y;
      if (Math.abs(ndx) > Math.abs(ndy)) {
        this.dir = ndx > 0 ? 2 : 6;
      } else {
        this.dir = ndy > 0 ? 0 : 4;
      }
    }

    const playedChar = this.playCharacterSwing(tool.id);
    if (!playedChar) this.playSwing(tool.id, nearest);

    if (nearest) {
      const id = nearest.getData("harvestableId") as string | undefined;
      if (id && this.net.connected) {
        // Online: server owns HP/respawn; flash + drop come back via onChange/onHarvestDrop.
        this.net.sendHarvest(id, tool.id);
      } else if (id === undefined) {
        // Offline fallback: client-side damage and drop on impact frame.
        this.time.delayedCall(SWING_IMPACT_MS, () => {
          if (nearest && nearest.scene && nearest.active) {
            this.damageHarvestableLocally(nearest, inventory);
          }
        });
      }
    }
  }

  // Returns true if the chop sprite-sheet was available and the character anim is playing.
  private playCharacterSwing(toolId: string): boolean {
    const cardinalIdx = DIR_TO_CARDINAL[this.dir] ?? 0;
    const animKey = `chop_${toolId}_${CARDINAL_KEYS[cardinalIdx]}`;
    if (!this.anims.exists(animKey)) return false;
    this.swinging = true;
    this.player.anims.stop();
    this.player.play(animKey);
    this.player.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.swinging = false;
    });
    return true;
  }

  // Direction-aware tool swing overlay. Renders the tool icon in front of the
  // player and sweeps it through an arc — temporary until the PixelLab
  // "Picking Up" character animation lands.
  private playSwing(toolId: string, target: Phaser.GameObjects.Sprite | null) {
    const key = `item_${toolId}`;
    if (!this.textures.exists(key)) return;

    // Direction toward target if any, else use player facing.
    let dx: number;
    let dy: number;
    if (target) {
      const vx = target.x - this.player.x;
      const vy = target.y - this.player.y;
      const len = Math.max(0.001, Math.sqrt(vx * vx + vy * vy));
      dx = vx / len;
      dy = vy / len;
    } else {
      const DX = [0, 0.7, 1, 0.7, 0, -0.7, -1, -0.7];
      const DY = [1, 0.7, 0, -0.7, -1, -0.7, 0, 0.7];
      dx = DX[this.dir] ?? 0;
      dy = DY[this.dir] ?? 0;
    }
    const facingLeft = dx < -0.05;

    const handX = this.player.x + dx * 10;
    const handY = this.player.y - 14 + dy * 6;
    const tool = this.add.image(handX, handY, key);
    tool.setDepth(this.player.y + 2);
    tool.setScale(0.75);
    tool.setFlipX(facingLeft);

    const base = facingLeft ? Math.PI : 0;
    const startRot = base + (facingLeft ? Math.PI * 0.55 : -Math.PI * 0.55);
    const endRot = base + (facingLeft ? -Math.PI * 0.25 : Math.PI * 0.25);
    tool.setRotation(startRot);

    this.tweens.add({
      targets: tool,
      rotation: endRot,
      x: this.player.x + dx * 18,
      y: this.player.y - 8 + dy * 10,
      duration: 220,
      ease: "Cubic.easeOut",
      onComplete: () => {
        this.tweens.add({
          targets: tool,
          alpha: 0,
          duration: 80,
          onComplete: () => tool.destroy(),
        });
      },
    });
  }

  // Offline fallback only — server-synced harvestables go through changeServerHarvestable.
  private damageHarvestableLocally(sprite: Phaser.GameObjects.Sprite, inventory: Inventory) {
    const type = sprite.getData("resourceType") as ResourceType;
    const hp = (sprite.getData("hp") as number) - 1;

    sprite.setTint(0xff8a8a);
    this.time.delayedCall(90, () => sprite.clearTint());
    const baseX = sprite.x;
    this.tweens.add({
      targets: sprite,
      x: baseX + 3,
      duration: 40,
      yoyo: true,
      repeat: 1,
      onComplete: () => sprite.setX(baseX),
    });

    if (hp <= 0) {
      const dropId = DROP_FOR_RESOURCE[type];
      const dropX = sprite.x;
      const dropY = sprite.y - sprite.displayHeight * 0.4;
      const baseScaleY = (sprite.getData("baseScaleY") as number) ?? sprite.scaleY;
      const baseHp = RESOURCE_BASE_HP[type];
      const respawnMs = RESOURCE_RESPAWN_MS[type];

      this.tweens.add({
        targets: sprite,
        alpha: 0,
        scaleY: baseScaleY * 0.6,
        duration: 220,
        onComplete: () => {
          sprite.setActive(false).setVisible(false);
          // Reset visual state so respawn shows the node intact, not the squashed corpse.
          sprite.setAlpha(1);
          sprite.setScale(sprite.scaleX, baseScaleY);
          sprite.setData("hp", baseHp);
        },
      });
      this.spawnDropParticle(dropX, dropY, dropId, inventory);

      this.time.delayedCall(respawnMs, () => {
        if (!sprite.scene) return;
        sprite.setActive(true).setVisible(true);
      });
    } else {
      sprite.setData("hp", hp);
    }
  }

  private spawnDropParticle(x: number, y: number, itemId: string, inventory: Inventory) {
    const key = `item_${itemId}`;
    if (!this.textures.exists(key)) {
      inventory.add(itemId, 1);
      return;
    }
    const drop = this.add.image(x, y, key);
    drop.setDepth(99999);
    drop.setScale(0.6);
    this.tweens.add({
      targets: drop,
      y: y - 16,
      scale: 0.8,
      duration: 220,
      ease: "Sine.easeOut",
      onComplete: () => {
        this.tweens.add({
          targets: drop,
          x: this.player.x,
          y: this.player.y - 12,
          scale: 0.35,
          alpha: 0.4,
          duration: 320,
          ease: "Cubic.easeIn",
          onComplete: () => {
            drop.destroy();
            inventory.add(itemId, 1);
          },
        });
      },
    });
  }
}

// Maps a unit-vector (sx, sy) to a direction index matching DIR_KEYS.
// sx, sy ∈ {-1, 0, 1}; (0, 0) returns undefined (caller keeps last dir).
function directionFromVector(sx: number, sy: number): number | undefined {
  if (sx === 0 && sy === 0) return undefined;
  if (sx === 0 && sy > 0) return 0;  // S
  if (sx > 0 && sy > 0) return 1;    // SE
  if (sx > 0 && sy === 0) return 2;  // E
  if (sx > 0 && sy < 0) return 3;    // NE
  if (sx === 0 && sy < 0) return 4;  // N
  if (sx < 0 && sy < 0) return 5;    // NW
  if (sx < 0 && sy === 0) return 6;  // W
  if (sx < 0 && sy > 0) return 7;    // SW
  return undefined;
}

function pickName(): string {
  const stored = localStorage.getItem("aurora.name");
  if (stored && stored.length > 0) return stored;
  const fallback = `Player${Math.floor(Math.random() * 9000 + 1000)}`;
  const entered = window.prompt("이름을 입력하세요 (16자 이하)", fallback) ?? fallback;
  const trimmed = entered.trim().slice(0, 16) || fallback;
  localStorage.setItem("aurora.name", trimmed);
  return trimmed;
}
