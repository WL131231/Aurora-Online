export type ItemKind = "tool" | "resource";

export interface ItemDef {
  id: string;
  name: string;
  emoji: string;
  kind: ItemKind;
  iconUrl?: string;
}

export const ITEMS: Record<string, ItemDef> = {
  axe: { id: "axe", name: "도끼", emoji: "🪓", kind: "tool", iconUrl: "/assets/items/axe.png" },
  pickaxe: { id: "pickaxe", name: "곡괭이", emoji: "⛏", kind: "tool", iconUrl: "/assets/items/pickaxe.png" },
  wood: { id: "wood", name: "나무", emoji: "🪵", kind: "resource", iconUrl: "/assets/items/wood.png" },
  stone: { id: "stone", name: "돌", emoji: "🪨", kind: "resource", iconUrl: "/assets/items/stone.png" },
  copper_ore: { id: "copper_ore", name: "동광석", emoji: "🟠", kind: "resource", iconUrl: "/assets/items/copper_ore.png" },
  silver_ore: { id: "silver_ore", name: "은광석", emoji: "⚪", kind: "resource", iconUrl: "/assets/items/silver_ore.png" },
  gold_ore: { id: "gold_ore", name: "금광석", emoji: "🟡", kind: "resource", iconUrl: "/assets/items/gold_ore.png" },
  turnip_seed: { id: "turnip_seed", name: "순무 씨앗", emoji: "🌱", kind: "resource" },
  turnip: { id: "turnip", name: "순무", emoji: "🥕", kind: "resource" },
};

export type ResourceType = "tree" | "rock" | "copper_node" | "silver_node" | "gold_node";

export const TOOL_FOR_RESOURCE: Record<ResourceType, string> = {
  tree: "axe",
  rock: "pickaxe",
  copper_node: "pickaxe",
  silver_node: "pickaxe",
  gold_node: "pickaxe",
};

export const DROP_FOR_RESOURCE: Record<ResourceType, string> = {
  tree: "wood",
  rock: "stone",
  copper_node: "copper_ore",
  silver_node: "silver_ore",
  gold_node: "gold_ore",
};

export const RESOURCE_BASE_HP: Record<ResourceType, number> = {
  tree: 4,
  rock: 3,
  copper_node: 5,
  silver_node: 7,
  gold_node: 9,
};

export const RESOURCE_RESPAWN_MS: Record<ResourceType, number> = {
  tree: 45_000,
  rock: 60_000,
  copper_node: 90_000,
  silver_node: 120_000,
  gold_node: 180_000,
};
