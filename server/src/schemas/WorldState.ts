import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") name = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") dir = 0;
  @type("number") moving = 0;
  // itemId -> count
  @type({ map: "number" }) inventory = new MapSchema<number>();
  // 8 hotbar slots; empty string = empty slot
  @type(["string"]) hotbar = new ArraySchema<string>();
  @type("uint8") selectedHotbar = 0;
}

export class FarmPatch extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  // empty | planted | grown
  @type("string") state = "empty";
  @type("number") plantedAt = 0;
  // sessionId of the planter (for soft ownership; V1 anyone can harvest)
  @type("string") plantedBy = "";
}

export class Harvestable extends Schema {
  // Resource type: tree | rock | copper_node | silver_node | gold_node
  @type("string") rtype = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") hp = 0;
  @type("number") maxHp = 0;
  // 1 = visible/harvestable, 0 = chopped, awaiting respawn
  @type("uint8") alive = 1;
  // Client-side render hint. For trees: tinytown frame index 0-7.
  // For rocks: frame 11. For ore nodes: ignored.
  @type("uint8") variant = 0;
  // Visual scale to apply on the client sprite.
  @type("number") scale = 1;
}

export class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Harvestable }) harvestables = new MapSchema<Harvestable>();
  @type({ map: FarmPatch }) farmPatches = new MapSchema<FarmPatch>();
}
