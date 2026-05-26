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
// 8-direction order (PixelLab + our internal dir): 0=S, 1=SE, 2=E, 3=NE, 4=N, 5=NW, 6=W, 7=SW
const DIR_KEYS = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"] as const;

type WASDKeys = {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  enter: Phaser.Input.Keyboard.Key;
};

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
  private wasd!: WASDKeys;
  private nameTag!: Phaser.GameObjects.Image;
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
  private bakedTextureCounter = 0;
  private ready = false;

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
    this.ready = true;
  }

  update(time: number) {
    if (!this.ready) return;
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

    const moving = vx !== 0 || vy !== 0;
    this.applyPlayerAnimation(this.player, this.dir, moving);

    this.syncRemotes();
    this.maybeSendMove(time, moving);
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
  }

  private applyPlayerAnimation(
    sprite: Phaser.GameObjects.Sprite,
    dir: number,
    moving: boolean
  ) {
    const clampedDir = dir >= 0 && dir < DIR_KEYS.length ? dir : 0;
    if (moving) {
      const key = `walk_${DIR_KEYS[clampedDir]}`;
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
      const idx = DECORATION_FRAMES[rng.between(0, DECORATION_FRAMES.length - 1)];
      const wx = tx * TILE + TILE / 2;
      const wy = ty * TILE + TILE / 2;
      const sprite = this.add.sprite(wx, wy, "props", idx);
      sprite.setOrigin(0.5, 0.9);
      sprite.setDepth(wy - 1);
    }
  }

  private buildTrees(): Phaser.Physics.Arcade.StaticGroup {
    const group = this.physics.add.staticGroup();
    const rng = new Phaser.Math.RandomDataGenerator(["aurora-trees"]);
    const center = { x: MAP_W / 2, y: MAP_H / 2 };

    // Trees (scaled 1.5x)
    for (let i = 0; i < 80; i++) {
      const tx = rng.between(1, MAP_W - 2);
      const ty = rng.between(1, MAP_H - 2);
      if (Math.abs(tx - center.x) < SPAWN_CLEAR_RADIUS && Math.abs(ty - center.y) < SPAWN_CLEAR_RADIUS) continue;
      const idx = TREE_FRAMES[rng.between(0, TREE_FRAMES.length - 1)];
      const wx = tx * TILE + TILE / 2;
      const wy = ty * TILE + TILE / 2;
      const tree = group.create(wx, wy, "props", idx) as Phaser.Physics.Arcade.Sprite;
      tree.setOrigin(0.5, 0.9);
      tree.setScale(1.75);
      const body = tree.body as Phaser.Physics.Arcade.StaticBody;
      body.setSize(14, 6).setOffset(17, 38);
      tree.refreshBody();
      tree.setDepth(wy);
    }

    // Rocks and stumps (native size, no scaling)
    for (let i = 0; i < 25; i++) {
      const tx = rng.between(1, MAP_W - 2);
      const ty = rng.between(1, MAP_H - 2);
      if (Math.abs(tx - center.x) < SPAWN_CLEAR_RADIUS && Math.abs(ty - center.y) < SPAWN_CLEAR_RADIUS) continue;
      const idx = OBSTACLE_FRAMES[rng.between(0, OBSTACLE_FRAMES.length - 1)];
      const wx = tx * TILE + TILE / 2;
      const wy = ty * TILE + TILE / 2;
      const obs = group.create(wx, wy, "props", idx) as Phaser.Physics.Arcade.Sprite;
      obs.setOrigin(0.5, 0.9);
      const body = obs.body as Phaser.Physics.Arcade.StaticBody;
      body.setSize(28, 12).setOffset(10, 32);
      obs.refreshBody();
      obs.setDepth(wy);
    }

    return group;
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
