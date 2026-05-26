import sharp from "sharp";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DOWNLOADS = "C:/Users/지영민/Downloads";
const OUT_CHARS = path.join(ROOT, "client", "public", "assets", "characters");
const OUT_TILES = path.join(ROOT, "client", "public", "assets", "tilesets");

await fs.mkdir(OUT_CHARS, { recursive: true });
await fs.mkdir(OUT_TILES, { recursive: true });

// Walk sheet: 360x60 (6 frames * 60px) — keep native size
await fs.copyFile(
  path.join(DOWNLOADS, "untitled.png"),
  path.join(OUT_CHARS, "player_walk.png")
);
console.log("✓ player_walk.png (360x60, 6 frames @ 60px)");

// 8-direction idle: 960x120 → resize to 480x60 (nearest, lossless 2x downscale)
await sharp(path.join(DOWNLOADS, "1.png"))
  .resize(480, 60, { kernel: "nearest" })
  .png({ compressionLevel: 9 })
  .toFile(path.join(OUT_CHARS, "player_idle.png"));
console.log("✓ player_idle.png (480x60, 8 frames @ 60px)");

// Map patch: keep at native 128x128 — for now save but won't use as primary
await fs.copyFile(
  path.join(DOWNLOADS, "untitled (1).png"),
  path.join(OUT_TILES, "grass_dirt_patch.png")
);
console.log("✓ grass_dirt_patch.png (128x128, single patch)");
