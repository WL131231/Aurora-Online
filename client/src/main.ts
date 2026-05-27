import Phaser from "phaser";
import "./style.css";
import { MainScene } from "./scenes/MainScene";
import { Hotbar, Inventory } from "./game/inventory";
import { createHud } from "./ui/hud";

const inventory = new Inventory();
const hotbar = new Hotbar();
inventory.add("axe", 1);
inventory.add("pickaxe", 1);
hotbar.setSlot(0, "axe");
hotbar.setSlot(1, "pickaxe");

// V1 character customization — sprite-tint based, persisted in localStorage.
// V2 will swap to layered hair/hat/shirt sprites (Z9별-style module parts).
const TINT_PALETTE = [
  0xffffff, // neutral
  0xffe0c0, // peach
  0xcfe8ff, // sky
  0xc8f0c8, // mint
  0xffd9d9, // rose
  0xfff0a8, // sun
  0xd6c8f5, // lilac
];
let savedTint = localStorage.getItem("aurora.tint");
if (!savedTint) {
  savedTint = String(TINT_PALETTE[Math.floor(Math.random() * TINT_PALETTE.length)]);
  localStorage.setItem("aurora.tint", savedTint);
}
const playerTint = Number(savedTint);

const hud = createHud(inventory, hotbar);
document.body.appendChild(hud.root);

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "app",
  width: 960,
  height: 540,
  pixelArt: true,
  antialias: false,
  antialiasGL: false,
  roundPixels: true,
  backgroundColor: "#1a1a1a",
  physics: {
    default: "arcade",
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [MainScene],
};

const game = new Phaser.Game(config);
game.registry.set("inventory", inventory);
game.registry.set("hotbar", hotbar);
game.registry.set("hud", hud);
game.registry.set("playerTint", playerTint);
