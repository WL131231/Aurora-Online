import sharp from "sharp";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SHEET = path.join(ROOT, "client", "public", "assets", "tilesets", "tinytown.png");
const OUT = path.join(ROOT, ".tmp", "debug-tiles");

const TILE = 32;
const COLS = 12;

await fs.mkdir(OUT, { recursive: true });

const indices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 21];
for (const i of indices) {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const left = col * TILE;
  const top = row * TILE;
  await sharp(SHEET)
    .extract({ left, top, width: TILE, height: TILE })
    .png()
    .toFile(path.join(OUT, `frame_${String(i).padStart(3, "0")}.png`));
}
console.log(`extracted ${indices.length} debug frames to ${OUT}`);
