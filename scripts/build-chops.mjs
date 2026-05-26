// Stitches PixelLab chop animations into per-tool 8-col × 4-row spritesheets
// at the same scale as player_walks (30px char height, feet@y=44 in 60×60 cell).
//
// Input: scripts/.chop-urls.json
//   {
//     "axe":     { "south": [url0..url8], "east": [...], "north": [...], "west": [...] },
//     "pickaxe": { ... }
//   }
//   Each url array has 9 entries: index 0 = reference frame (skipped),
//   indices 1..8 = animated frames.
//
// Output: client/public/assets/characters/player_chop_axe.png + _pickaxe.png

import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(__dirname, ".chop-urls.json");
const OUT_DIR = path.join(ROOT, "client", "public", "assets", "characters");

const SRC_FRAME = 120;
const DST_FRAME = 60;
const TARGET_CHAR_H = 30;
const TARGET_FEET_Y = 44;
const N_FRAMES = 8;
const DIRECTIONS = ["south", "east", "north", "west"];

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));

for (const tool of ["axe", "pickaxe"]) {
  const toolConfig = config[tool];
  if (!toolConfig) {
    console.warn(`skip ${tool}: no config entry`);
    continue;
  }
  const composites = [];
  for (let dir = 0; dir < DIRECTIONS.length; dir++) {
    const direction = DIRECTIONS[dir];
    const urls = toolConfig[direction];
    if (!urls) throw new Error(`missing urls for ${tool}/${direction}`);
    for (let f = 0; f < N_FRAMES; f++) {
      const url = urls[f + 1]; // skip reference frame at index 0
      if (!url) throw new Error(`missing frame ${f + 1} for ${tool}/${direction}`);
      const raw = await fetchBuffer(url);
      const trimmed = await sharp(raw).trim({ threshold: 1 }).toBuffer();
      const meta = await sharp(trimmed).metadata();
      if (!meta.width || !meta.height) {
        console.warn(`${tool}/${direction} frame ${f + 1}: empty bbox`);
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
    console.log(`${tool}/${direction} processed`);
  }
  const sheetW = N_FRAMES * DST_FRAME;
  const sheetH = DIRECTIONS.length * DST_FRAME;
  const out = path.join(OUT_DIR, `player_chop_${tool}.png`);
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
    .toFile(out);
  console.log(`wrote ${out}`);
  console.log(`  ${sheetW}x${sheetH}, ${N_FRAMES} cols × ${DIRECTIONS.length} rows @ ${DST_FRAME}px`);
  console.log(`  rows: 0=S 1=E 2=N 3=W`);
}
