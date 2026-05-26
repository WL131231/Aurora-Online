import Phaser from "phaser";

const TILE = 32;
const MAP_W = 50;
const MAP_H = 50;
const WORLD_W = MAP_W * TILE;
const WORLD_H = MAP_H * TILE;
const PLAYER_SPEED = 140;
const INV_SQRT2 = 1 / Math.SQRT2;

type WASDKeys = {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
};

export class MainScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: WASDKeys;
  private nameTag!: Phaser.GameObjects.Text;
  private trees!: Phaser.Physics.Arcade.StaticGroup;

  constructor() {
    super("MainScene");
  }

  preload() {
    this.makeGrassTexture();
    this.makePlayerTexture();
    this.makeTreeTexture();
  }

  create() {
    this.add
      .tileSprite(0, 0, WORLD_W, WORLD_H, "grass")
      .setOrigin(0, 0);

    this.trees = this.physics.add.staticGroup();
    const rng = new Phaser.Math.RandomDataGenerator(["aurora-online-day1"]);
    for (let i = 0; i < 80; i++) {
      const tx = rng.between(2, MAP_W - 3);
      const ty = rng.between(2, MAP_H - 3);
      const x = tx * TILE + TILE / 2;
      const y = ty * TILE + TILE / 2;
      const tree = this.trees.create(x, y, "tree") as Phaser.Physics.Arcade.Sprite;
      tree.setOrigin(0.5, 0.85);
      const body = tree.body as Phaser.Physics.Arcade.StaticBody;
      body.setSize(20, 14).setOffset(6, 34);
      tree.refreshBody();
      tree.setDepth(y);
    }

    const spawnX = WORLD_W / 2;
    const spawnY = WORLD_H / 2;
    this.player = this.physics.add.sprite(spawnX, spawnY, "player");
    this.player.setOrigin(0.5, 0.9);
    this.player.setCollideWorldBounds(true);
    const pbody = this.player.body as Phaser.Physics.Arcade.Body;
    pbody.setSize(14, 10).setOffset(5, 18);

    this.physics.add.collider(this.player, this.trees);

    this.nameTag = this.add
      .text(spawnX, spawnY - 24, "Aurora", {
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
    }) as WASDKeys;

    const hint = this.add
      .text(
        12,
        12,
        "Aurora Online — Day 1\nWASD / 화살표로 이동",
        {
          fontFamily: "monospace",
          fontSize: "12px",
          color: "#ffffff",
          backgroundColor: "rgba(0,0,0,0.5)",
          padding: { x: 8, y: 6 },
          resolution: 2,
        }
      )
      .setScrollFactor(0)
      .setDepth(100001);
    hint.setScale(1 / this.cameras.main.zoom);
  }

  update() {
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

    this.player.setDepth(this.player.y);
    this.nameTag.setPosition(this.player.x, this.player.y - this.player.displayHeight + 2);
  }

  private makeGrassTexture() {
    const g = this.add.graphics({ x: 0, y: 0 });
    g.fillStyle(0x5da130, 1);
    g.fillRect(0, 0, TILE, TILE);
    g.fillStyle(0x4a8328, 1);
    for (let i = 0; i < 8; i++) {
      const x = Phaser.Math.Between(2, TILE - 4);
      const y = Phaser.Math.Between(2, TILE - 4);
      g.fillRect(x, y, 2, 2);
    }
    g.fillStyle(0x6dbb3a, 1);
    for (let i = 0; i < 4; i++) {
      const x = Phaser.Math.Between(1, TILE - 2);
      const y = Phaser.Math.Between(1, TILE - 2);
      g.fillRect(x, y, 1, 1);
    }
    g.generateTexture("grass", TILE, TILE);
    g.destroy();
  }

  private makePlayerTexture() {
    const W = 16;
    const H = 24;
    const g = this.add.graphics({ x: 0, y: 0 });
    g.fillStyle(0xffd7a8, 1);
    g.fillRect(4, 0, 8, 8);
    g.fillStyle(0x000000, 1);
    g.fillRect(6, 3, 1, 1);
    g.fillRect(9, 3, 1, 1);
    g.fillStyle(0x4a3a2a, 1);
    g.fillRect(3, 0, 10, 2);
    g.fillRect(3, 1, 2, 4);
    g.fillRect(11, 1, 2, 4);
    g.fillStyle(0xd83b3b, 1);
    g.fillRect(3, 8, 10, 10);
    g.fillStyle(0xffd7a8, 1);
    g.fillRect(2, 9, 2, 6);
    g.fillRect(12, 9, 2, 6);
    g.fillStyle(0x2a3f6b, 1);
    g.fillRect(4, 18, 4, 5);
    g.fillRect(8, 18, 4, 5);
    g.fillStyle(0x1a1a1a, 1);
    g.fillRect(4, 22, 4, 2);
    g.fillRect(8, 22, 4, 2);
    g.generateTexture("player", W, H);
    g.destroy();
  }

  private makeTreeTexture() {
    const W = 32;
    const H = 48;
    const g = this.add.graphics({ x: 0, y: 0 });
    g.fillStyle(0x6b4226, 1);
    g.fillRect(13, 30, 6, 16);
    g.fillStyle(0x4a2e1a, 1);
    g.fillRect(13, 30, 2, 16);
    g.fillStyle(0x2e7d2e, 1);
    g.fillCircle(16, 18, 14);
    g.fillStyle(0x3a9d3a, 1);
    g.fillCircle(12, 14, 7);
    g.fillCircle(21, 16, 6);
    g.fillStyle(0x4fb84f, 1);
    g.fillCircle(14, 12, 3);
    g.fillCircle(20, 13, 3);
    g.generateTexture("tree", W, H);
    g.destroy();
  }
}
