// Stitches PixelLab running-6-frames into player_runs.png at the same scale
// as player_walks (30px char height, feet@y=44 in 60×60 cell).
//
// Input: scripts/.runs-urls.json
//   {
//     "south": [url0..url5], "south-east": [...], "east": [...], "north-east": [...],
//     "north": [...], "north-west": [...], "west": [...], "south-west": [...]
//   }
//   Direction order matches MainScene's DIR_KEYS = [S, SE, E, NE, N, NW, W, SW].
//
// Output: client/public/assets/characters/player_runs.png (6 cols × 8 rows × 60px = 360×480).

import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(__dirname, ".runs-urls.json");
const OUT = path.join(ROOT, "client", "public", "assets", "characters", "player_runs.png");

const DST_FRAME = 60;
const TARGET_CHAR_H = 30;
const TARGET_FEET_Y = 44;
const N_FRAMES = 6;
const DIRECTIONS = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"];

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));

const composites = [];
for (let dir = 0; dir < DIRECTIONS.length; dir++) {
  const direction = DIRECTIONS[dir];
  const urls = config[direction];
  if (!urls) throw new Error(`missing urls for ${direction}`);
  for (let f = 0; f < N_FRAMES; f++) {
    const url = urls[f];
    if (!url) throw new Error(`missing frame ${f} for ${direction}`);
    const raw = await fetchBuffer(url);
    const trimmed = await sharp(raw).trim({ threshold: 1 }).toBuffer();
    const meta = await sharp(trimmed).metadata();
    if (!meta.width || !meta.height) {
      console.warn(`${direction} frame ${f}: empty bbox`);
      continue;
    }
    const ratio = TARGET_CHAR_H / meta.height;
    const newW = Math.max(1, Math.round(meta.width * ratio));
    const newH = TARGET_CHAR_H;
    const resized = await sharp(trimmed)
      .resize(newW, newH, { kernel: "nearest" })
      .toBuffer();
    const padX = Math.floor((DST_FRAME - newW) / 2);
    const padY = TARGET_FEET_Y - newH;
    composites.push({
      input: resized,
      left: f * DST_FRAME + padX,
      top: dir * DST_FRAME + padY,
    });
  }
  console.log(`${direction} processed`);
}

const sheetW = N_FRAMES * DST_FRAME;
const sheetH = DIRECTIONS.length * DST_FRAME;
await sharp({
  create: {
    width: sheetW,
    height: sheetH,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toFile(OUT);

console.log(`wrote ${OUT}`);
console.log(`  ${sheetW}x${sheetH}, ${N_FRAMES} cols × ${DIRECTIONS.length} rows @ ${DST_FRAME}px`);
console.log(`  rows: 0=S 1=SE 2=E 3=NE 4=N 5=NW 6=W 7=SW`);
