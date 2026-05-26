import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ORIGINAL = "C:/Users/지영민/Downloads/1.png";
const OUT = path.join(ROOT, "client", "public", "assets", "characters", "player_idle.png");

const N_FRAMES = 8;
const SRC_FRAME = 120;
const DST_FRAME = 60;
const TARGET_CHAR_H = 30;
const TARGET_FEET_Y = 44;

const composites = [];

for (let i = 0; i < N_FRAMES; i++) {
  const frame = await sharp(ORIGINAL)
    .extract({ left: i * SRC_FRAME, top: 0, width: SRC_FRAME, height: SRC_FRAME })
    .toBuffer();

  const trimmed = await sharp(frame).trim({ threshold: 1 }).toBuffer();
  const meta = await sharp(trimmed).metadata();
  if (!meta.width || !meta.height) {
    console.warn(`frame ${i}: failed to read trimmed metadata`);
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
    left: i * DST_FRAME + padX,
    top: padY,
  });
  console.log(`frame ${i}: src ${meta.width}x${meta.height} → ${newW}x${newH} at (${padX},${padY})`);
}

await sharp({
  create: {
    width: N_FRAMES * DST_FRAME,
    height: DST_FRAME,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toFile(OUT);

console.log(`\nwrote ${OUT}`);
console.log(`  ${N_FRAMES * DST_FRAME}x${DST_FRAME}, ${N_FRAMES} frames @ ${DST_FRAME}px`);
console.log(`  character height target: ${TARGET_CHAR_H}px, feet at y=${TARGET_FEET_Y}`);
