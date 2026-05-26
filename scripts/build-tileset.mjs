import sharp from "sharp";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TILES_DIR = path.join(ROOT, ".tmp", "tinytown", "Tiles");
const OUT_DIR = path.join(ROOT, "client", "public", "assets", "tilesets");
const OUT_FILE = path.join(OUT_DIR, "tinytown.png");

const TILE_SIZE = 16;
const COLS = 12;
const ROWS = 11;
const TOTAL = COLS * ROWS;

await fs.mkdir(OUT_DIR, { recursive: true });

const composite = [];
for (let i = 0; i < TOTAL; i++) {
  const filename = `tile_${String(i).padStart(4, "0")}.png`;
  const filepath = path.join(TILES_DIR, filename);
  try {
    await fs.access(filepath);
  } catch {
    console.warn(`missing ${filename}`);
    continue;
  }
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  composite.push({
    input: filepath,
    left: col * TILE_SIZE,
    top: row * TILE_SIZE,
  });
}

const width = COLS * TILE_SIZE;
const height = ROWS * TILE_SIZE;

const SCALE = 2;

const baseBuffer = await sharp({
  create: {
    width,
    height,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(composite)
  .png()
  .toBuffer();

await sharp(baseBuffer)
  .resize(width * SCALE, height * SCALE, { kernel: "nearest" })
  .png({ compressionLevel: 9 })
  .toFile(OUT_FILE);

console.log(`built ${OUT_FILE}`);
console.log(
  `  ${width * SCALE}x${height * SCALE} (${COLS}x${ROWS} tiles, ${TILE_SIZE * SCALE}px each, ${SCALE}x scaled)`
);
console.log(`  ${composite.length} tiles composited`);
