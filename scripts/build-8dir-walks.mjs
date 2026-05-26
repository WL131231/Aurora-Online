import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DOWNLOADS = "C:/Users/지영민/Downloads";
const OUT = path.join(ROOT, "client", "public", "assets", "characters", "player_walks.png");

// PixelLab download order (verified by visual inspection):
// 0=S, 1=SE, 2=E, 3=NE, 4=N, 5=NW, 6=W, 7=SW
const FILES = [
  "untitled.png",
  "untitled (1).png",
  "untitled (2).png",
  "untitled (3).png",
  "untitled (4).png",
  "untitled (5).png",
  "untitled (6).png",
  "untitled (7).png",
];

const SRC_FRAME = 120;
const N_FRAMES = 6;
const DST_FRAME = 60;
const TARGET_CHAR_H = 30; // match existing idle sheet
const TARGET_FEET_Y = 44; // match existing idle sheet

const composites = [];

for (let dir = 0; dir < FILES.length; dir++) {
  const filePath = path.join(DOWNLOADS, FILES[dir]);
  for (let f = 0; f < N_FRAMES; f++) {
    const frame = await sharp(filePath)
      .extract({ left: f * SRC_FRAME, top: 0, width: SRC_FRAME, height: SRC_FRAME })
      .toBuffer();

    const trimmed = await sharp(frame).trim({ threshold: 1 }).toBuffer();
    const meta = await sharp(trimmed).metadata();
    if (!meta.width || !meta.height) {
      console.warn(`dir ${dir} frame ${f}: empty trimmed metadata`);
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
  console.log(`dir ${dir} processed (${FILES[dir]})`);
}

const sheetW = N_FRAMES * DST_FRAME;
const sheetH = FILES.length * DST_FRAME;

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

console.log(`\nwrote ${OUT}`);
console.log(`  ${sheetW}x${sheetH}, ${N_FRAMES} cols × ${FILES.length} rows @ ${DST_FRAME}px`);
console.log(`  rows: 0=S 1=SE 2=E 3=NE 4=N 5=NW 6=W 7=SW`);
