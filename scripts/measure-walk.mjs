import sharp from "sharp";

const walk = "C:/Users/지영민/aurora-online/client/public/assets/characters/player_walk.png";

for (let i = 0; i < 6; i++) {
  const frame = await sharp(walk)
    .extract({ left: i * 60, top: 0, width: 60, height: 60 })
    .toBuffer();
  const trimmed = await sharp(frame).trim({ threshold: 1 }).toBuffer();
  const meta = await sharp(trimmed).metadata();

  // Find feet y in the original 60x60 frame
  // We trim from all sides, so we need to know how much was trimmed off bottom
  // Easier: scan the original for bottom-most non-transparent row
  const raw = await sharp(frame).raw().toBuffer();
  const w = 60, h = 60;
  let bottomY = -1;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const alpha = raw[(y * w + x) * 4 + 3];
      if (alpha > 0) {
        bottomY = y;
        break;
      }
    }
    if (bottomY >= 0) break;
  }
  let topY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = raw[(y * w + x) * 4 + 3];
      if (alpha > 0) {
        topY = y;
        break;
      }
    }
    if (topY >= 0) break;
  }

  console.log(
    `frame ${i}: trimmed ${meta.width}x${meta.height}, top=${topY}, bottom=${bottomY}, height=${bottomY - topY + 1}`
  );
}
