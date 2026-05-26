import Phaser from "phaser";
import { NetworkManager } from "../net/NetworkManager";
import type { RemotePlayer } from "../net/NetworkManager";

const TILE = 32;
const MAP_W = 50;
const MAP_H = 50;
const WORLD_W = MAP_W * TILE;
const WORLD_H = MAP_H * TILE;
const PLAYER_SPEED = 140;
const INV_SQRT2 = 1 / Math.SQRT2;

const SEND_INTERVAL_MS = 80;
const MOVE_DELTA_THRESHOLD = 0.5;

const SERVER_ENDPOINT =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "ws://localhost:2567";

// Kenney Tiny Town tileset frame indices (12 cols × 11 rows, 132 tiles)
const GRASS_BASE = 0;
const GRASS_TUFT = 1;
const GRASS_FLOWER = 2;
const TREE_FRAMES = [4, 6, 7, 8, 9, 10, 11];
const DECORATION_FRAMES = [5];
const SPAWN_CLEAR_RADIUS = 5;

// PixelLab character sprite sheets
const PLAYER_FRAME = 60;
// dir convention: 0=S, 1=W, 2=E, 3=N
// 8-direction sheet layout (PixelLab): 0=S, 1=SE, 2=E, 3=NE, 4=N, 5=NW, 6=W, 7=SW
const IDLE_FRAME_BY_DIR = [0, 6, 2, 4];

type WASDKeys = {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  enter: Phaser.Input.Keyboard.Key;
};

interface RemoteEntity {
  sprite: Phaser.GameObjects.Sprite;
  nameTag: Phaser.GameObjects.Text;
  chatBubble?: Phaser.GameObjects.Container;
  chatTimer?: Phaser.Time.TimerEvent;
}

export class MainScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: WASDKeys;
  private nameTag!: Phaser.GameObjects.Text;
  private trees!: Phaser.Physics.Arcade.StaticGroup;

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

  constructor() {
    super("MainScene");
  }

  preload() {
    this.load.spritesheet("tinytown", "/assets/tilesets/tinytown.png", {
      frameWidth: TILE,
      frameHeight: TILE,
    });
    this.load.spritesheet("player_walk", "/assets/characters/player_walk.png", {
      frameWidth: PLAYER_FRAME,
      frameHeight: PLAYER_FRAME,
    });
    this.load.spritesheet("player_idle", "/assets/characters/player_idle.png", {
      frameWidth: PLAYER_FRAME,
      frameHeight: PLAYER_FRAME,
    });
  }

  async create() {
    this.playerName = pickName();

    this.buildGroundLayer();
    this.buildDecorations();
    this.trees = this.buildTrees();
    this.createPlayerAnimations();

    const spawnX = WORLD_W / 2;
    const spawnY = WORLD_H / 2;
    this.player = this.physics.add.sprite(spawnX, spawnY, "player_idle", 0);
    this.player.setOrigin(0.5, 0.85);
    this.player.setCollideWorldBounds(true);
    const pbody = this.player.body as Phaser.Physics.Arcade.Body;
    pbody.setSize(20, 8).setOffset(20, 46);
    this.physics.add.collider(this.player, this.trees);

    this.nameTag = this.add
      .text(spawnX, spawnY - 24, this.playerName, {
        fontFamily: "monospace",
        fontSize: "10px",
        color: "#ffffff",
        backgroundColor: "rgba(0,0,0,0.55)",
        padding: { x: 4, y: 2 },
        resolution: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(100000);

    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
    this.cameras.main.setZoom(2);
    this.cameras.main.setRoundPixels(true);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      enter: Phaser.Input.Keyboard.KeyCodes.ENTER,
    }) as WASDKeys;

    this.setupHud();
    this.setupChatInput();

    this.net = new NetworkManager(SERVER_ENDPOINT);
    this.net.onPlayerAdd((id, player) => this.handlePlayerAdd(id, player));
    this.net.onPlayerRemove((id) => this.handlePlayerRemove(id));
    this.net.onChat((msg) => this.appendChat(`${msg.name}: ${msg.text}`, msg.sessionId));

    this.setStatus("연결 중...");
    const ok = await this.net.connect(this.playerName);
    if (ok) {
      this.setStatus(`온라인 — ${this.playerName}`);
    } else {
      this.setStatus(`오프라인 모드 — ${this.playerName} (서버 없음)`);
    }

    this.lastSentX = this.player.x;
    this.lastSentY = this.player.y;
  }

  update(time: number) {
    let vx = 0;
    let vy = 0;
    if (this.cursors.left?.isDown || this.wasd.left.isDown) vx -= 1;
    if (this.cursors.right?.isDown || this.wasd.right.isDown) vx += 1;
    if (this.cursors.up?.isDown || this.wasd.up.isDown) vy -= 1;
    if (this.cursors.down?.isDown || this.wasd.down.isDown) vy += 1;
    if (vx !== 0 && vy !== 0) {
      vx *= INV_SQRT2;
      vy *= INV_SQRT2;
    }
    this.player.setVelocity(vx * PLAYER_SPEED, vy * PLAYER_SPEED);

    if (vy < 0) this.dir = 3;
    else if (vy > 0) this.dir = 0;
    else if (vx < 0) this.dir = 1;
    else if (vx > 0) this.dir = 2;

    this.player.setDepth(this.player.y);
    this.nameTag.setPosition(this.player.x, this.player.y - this.player.displayHeight * 0.85 + 2);

    const moving = vx !== 0 || vy !== 0;
    this.applyPlayerAnimation(this.player, this.dir, moving);

    this.syncRemotes();
    this.maybeSendMove(time, moving);
  }

  private createPlayerAnimations() {
    if (this.anims.exists("walk_south")) return;
    this.anims.create({
      key: "walk_south",
      frames: this.anims.generateFrameNumbers("player_walk", { start: 0, end: 5 }),
      frameRate: 10,
      repeat: -1,
    });
  }

  private applyPlayerAnimation(
    sprite: Phaser.GameObjects.Sprite,
    dir: number,
    moving: boolean
  ) {
    if (moving && dir === 0) {
      sprite.play("walk_south", true);
      return;
    }
    if (sprite.anims.isPlaying) sprite.anims.stop();
    const idleFrame = IDLE_FRAME_BY_DIR[dir] ?? 0;
    sprite.setTexture("player_idle", idleFrame);
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
      ent.nameTag.setPosition(ent.sprite.x, ent.sprite.y - ent.sprite.displayHeight * 0.85 + 2);
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
    const sprite = this.add.sprite(p.x, p.y, "player_idle", IDLE_FRAME_BY_DIR[p.dir | 0] ?? 0);
    sprite.setOrigin(0.5, 0.85);
    sprite.setDepth(p.y);
    const nameTag = this.add
      .text(p.x, p.y - 24, p.name, {
        fontFamily: "monospace",
        fontSize: "10px",
        color: "#cfe8ff",
        backgroundColor: "rgba(0,0,0,0.55)",
        padding: { x: 4, y: 2 },
        resolution: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(p.y + 1);
    this.remotes.set(sid, { sprite, nameTag });
    this.appendChat(`* ${p.name} 입장`, sid);
  }

  private handlePlayerRemove(sid: string) {
    const ent = this.remotes.get(sid);
    if (!ent) return;
    const name = ent.nameTag.text;
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

    this.chatLogText = this.add
      .text(8, 540 - 8 - 80, "", {
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
      .text(8, 540 - 8, "[Enter] 채팅  |  WASD / 화살표 이동", {
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
    const t = this.add
      .text(0, 0, text, {
        fontFamily: "monospace",
        fontSize: "10px",
        color: "#000000",
        backgroundColor: "#ffffff",
        padding: { x: 5, y: 3 },
        wordWrap: { width: 140 },
        resolution: 2,
      })
      .setOrigin(0.5, 1);
    return this.add.container(0, 0, [t]);
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
    for (let i = 0; i < 40; i++) {
      const tx = rng.between(1, MAP_W - 2);
      const ty = rng.between(1, MAP_H - 2);
      if (Math.abs(tx - center.x) < SPAWN_CLEAR_RADIUS && Math.abs(ty - center.y) < SPAWN_CLEAR_RADIUS) continue;
      const idx = DECORATION_FRAMES[rng.between(0, DECORATION_FRAMES.length - 1)];
      const wx = tx * TILE + TILE / 2;
      const wy = ty * TILE + TILE / 2;
      const sprite = this.add.sprite(wx, wy, "tinytown", idx);
      sprite.setOrigin(0.5, 0.85);
      sprite.setDepth(wy - 1);
    }
  }

  private buildTrees(): Phaser.Physics.Arcade.StaticGroup {
    const trees = this.physics.add.staticGroup();
    const rng = new Phaser.Math.RandomDataGenerator(["aurora-trees"]);
    const center = { x: MAP_W / 2, y: MAP_H / 2 };
    for (let i = 0; i < 90; i++) {
      const tx = rng.between(1, MAP_W - 2);
      const ty = rng.between(1, MAP_H - 2);
      if (Math.abs(tx - center.x) < SPAWN_CLEAR_RADIUS && Math.abs(ty - center.y) < SPAWN_CLEAR_RADIUS) continue;
      const idx = TREE_FRAMES[rng.between(0, TREE_FRAMES.length - 1)];
      const wx = tx * TILE + TILE / 2;
      const wy = ty * TILE + TILE / 2;
      const tree = trees.create(wx, wy, "tinytown", idx) as Phaser.Physics.Arcade.Sprite;
      tree.setOrigin(0.5, 0.85);
      const body = tree.body as Phaser.Physics.Arcade.StaticBody;
      body.setSize(18, 10).setOffset(7, 18);
      tree.refreshBody();
      tree.setDepth(wy);
    }
    return trees;
  }

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
