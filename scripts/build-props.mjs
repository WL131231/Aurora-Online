import sharp from "sharp";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = "C:/Users/지영민/Downloads/selected_objects/objects";
const OUT_DIR = path.join(ROOT, "client", "public", "assets", "props");
const OUT_FILE = path.join(OUT_DIR, "props.png");

// Object order — must match TS constants in MainScene
const OBJECTS = [
  "Small_round_green_oak_tree_wit", // 0
  "Medium_green_oak_tree_with_bro", // 1
  "Tall_green_pine_tree", // 2
  "Large_dense_oak_tree_with_thic", // 3
  "Autumn_maple_tree_with_orange", // 4
  "Cherry_blossom_tree_with_pink", // 5
  "Apple_tree_with_red_fruit_on_b", // 6
  "Birch_tree_with_white_trunk_an", // 7
  "Dead_leafless_tree_with_bare_b", // 8
  "Small_green_bush", // 9
  "Large_round_bush_with_berries", // 10
  "Gray_boulder_rock", // 11
  "Small_rock_pile", // 12
  "Mushroom_cluster_brown_and_red", // 13
  "Stump_of_cut_tree_with_rings_v", // 14
  "Wildflower_patch_yellow_and_wh", // 15
];

const COLS = 4;
const ROWS = 4;
const FRAME = 48;

await fs.mkdir(OUT_DIR, { recursive: true });

const composites = [];
for (let i = 0; i < OBJECTS.length; i++) {
  const objDir = path.join(SRC, OBJECTS[i]);
  const subDirs = await fs.readdir(objDir);
  const inner = subDirs[0];
  const png = path.join(objDir, inner, "rotations", "unknown.png");
  try {
    await fs.access(png);
  } catch {
    console.warn(`missing: ${png}`);
    continue;
  }
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  composites.push({
    input: png,
    left: col * FRAME,
    top: row * FRAME,
  });
}

await sharp({
  create: {
    width: COLS * FRAME,
    height: ROWS * FRAME,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toFile(OUT_FILE);

console.log(`wrote ${OUT_FILE}`);
console.log(`  ${COLS * FRAME}x${ROWS * FRAME} (${COLS}x${ROWS} @ ${FRAME}px)`);
console.log(`  ${composites.length} objects packed`);
