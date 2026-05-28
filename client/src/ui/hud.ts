import { Hotbar, HOTBAR_SLOTS, Inventory } from "../game/inventory";
import type { ItemDef } from "../game/items";

export interface Hud {
  root: HTMLElement;
  minimap: Minimap;
  showZoneLoading: (name: string) => void;
  setTime: (gameMinutes: number) => void;
  destroy(): void;
}

const SEASONS = ["봄", "여름", "가을", "겨울"];

export interface MinimapZone {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface MinimapBuilding {
  x: number;
  y: number;
}

export interface MinimapUpdate {
  worldW: number;
  worldH: number;
  playerX: number;
  playerY: number;
  zones?: MinimapZone[];
  buildings?: MinimapBuilding[];
  forEachResource: (cb: (x: number, y: number, type: string) => void) => void;
}

export interface Minimap {
  update(args: MinimapUpdate): void;
}

const MINIMAP_SIZE = 160;
const MINIMAP_THROTTLE_MS = 100;
const RESOURCE_DOT_COLORS: Record<string, string> = {
  tree: "#2d7a3a",
  rock: "#6b6b6b",
  copper_node: "#c87f33",
  silver_node: "#dcdcdc",
  gold_node: "#f5cc3a",
};

export function createHud(inventory: Inventory, hotbar: Hotbar): Hud {
  const root = document.createElement("div");
  root.className = "aurora-hud";

  // Preset row (F1-F8) — sits above the slot row, like a Z9별 action bar.
  const presetRowEl = document.createElement("div");
  presetRowEl.className = "aurora-preset-row";
  root.appendChild(presetRowEl);
  const presetButtons: HTMLElement[] = [];
  for (let i = 0; i < hotbar.presetCount(); i++) {
    const btn = document.createElement("div");
    btn.className = "aurora-preset-slot";
    btn.textContent = `F${i + 1}`;
    btn.addEventListener("click", () => hotbar.setActivePreset(i));
    presetRowEl.appendChild(btn);
    presetButtons.push(btn);
  }

  const hotbarEl = document.createElement("div");
  hotbarEl.className = "aurora-hotbar";
  root.appendChild(hotbarEl);

  const inventoryEl = document.createElement("div");
  inventoryEl.className = "aurora-inventory hidden";
  root.appendChild(inventoryEl);

  const inventoryTitle = document.createElement("div");
  inventoryTitle.className = "aurora-inventory-title";
  inventoryTitle.textContent = "인벤토리";
  inventoryEl.appendChild(inventoryTitle);

  const inventoryGrid = document.createElement("div");
  inventoryGrid.className = "aurora-inventory-grid";
  inventoryEl.appendChild(inventoryGrid);

  const inventoryHint = document.createElement("div");
  inventoryHint.className = "aurora-inventory-hint";
  inventoryHint.textContent = "[E] 닫기  ·  [1-8] 핫바 선택";
  inventoryEl.appendChild(inventoryHint);

  // Time/season clock (top-right, below minimap).
  const timeEl = document.createElement("div");
  timeEl.className = "aurora-time";
  const timeClockEl = document.createElement("div");
  timeClockEl.className = "time-clock";
  timeClockEl.textContent = "--:--";
  const timeDateEl = document.createElement("div");
  timeDateEl.className = "time-date";
  timeDateEl.textContent = "";
  timeEl.appendChild(timeClockEl);
  timeEl.appendChild(timeDateEl);
  root.appendChild(timeEl);

  function setTime(gameMinutes: number) {
    const minutesInDay = ((gameMinutes % 1440) + 1440) % 1440;
    const hour = Math.floor(minutesInDay / 60);
    const minute = Math.floor(minutesInDay % 60);
    const totalDays = Math.floor(gameMinutes / 1440);
    const seasonIdx = ((Math.floor(totalDays / 28) % 4) + 4) % 4;
    const dayOfSeason = (((totalDays % 28) + 28) % 28) + 1;
    timeClockEl.textContent = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    timeDateEl.textContent = `${SEASONS[seasonIdx]} ${dayOfSeason}일`;
  }

  const zoneLoadingEl = document.createElement("div");
  zoneLoadingEl.className = "aurora-zone-loading hidden";
  const zoneLoadingTitle = document.createElement("div");
  zoneLoadingTitle.className = "aurora-zone-loading-title";
  const zoneLoadingHint = document.createElement("div");
  zoneLoadingHint.className = "aurora-zone-loading-hint";
  zoneLoadingHint.textContent = "이동 중...";
  zoneLoadingEl.appendChild(zoneLoadingTitle);
  zoneLoadingEl.appendChild(zoneLoadingHint);
  root.appendChild(zoneLoadingEl);
  let zoneLoadingTimer: number | null = null;

  const minimapCanvas = document.createElement("canvas");
  minimapCanvas.className = "aurora-minimap";
  minimapCanvas.width = MINIMAP_SIZE;
  minimapCanvas.height = MINIMAP_SIZE;
  root.appendChild(minimapCanvas);
  const mctx = minimapCanvas.getContext("2d");
  let minimapLastDraw = 0;

  const minimap: Minimap = {
    update({ worldW, worldH, playerX, playerY, zones, buildings, forEachResource }) {
      if (!mctx) return;
      const now = performance.now();
      if (now - minimapLastDraw < MINIMAP_THROTTLE_MS) return;
      minimapLastDraw = now;

      const sx = MINIMAP_SIZE / worldW;
      const sy = MINIMAP_SIZE / worldH;

      if (zones && zones.length > 0) {
        for (const z of zones) {
          mctx.fillStyle = z.color;
          mctx.fillRect(
            Math.floor(z.x * sx),
            Math.floor(z.y * sy),
            Math.ceil(z.w * sx),
            Math.ceil(z.h * sy),
          );
        }
      } else {
        mctx.fillStyle = "#8caf5e";
        mctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
      }

      forEachResource((x, y, type) => {
        mctx.fillStyle = RESOURCE_DOT_COLORS[type] ?? "#ffffff";
        mctx.fillRect(Math.floor(x * sx) - 1, Math.floor(y * sy) - 1, 2, 2);
      });

      if (buildings) {
        mctx.fillStyle = "#5a2a0e";
        for (const b of buildings) {
          mctx.fillRect(Math.floor(b.x * sx) - 2, Math.floor(b.y * sy) - 2, 5, 5);
        }
      }

      mctx.fillStyle = "#ff3a3a";
      mctx.fillRect(
        Math.floor(playerX * sx) - 2,
        Math.floor(playerY * sy) - 2,
        4,
        4,
      );
    },
  };

  const hotbarSlots: HTMLElement[] = [];
  for (let i = 0; i < HOTBAR_SLOTS; i++) {
    const slot = makeSlot();
    const hotkey = document.createElement("div");
    hotkey.className = "slot-hotkey";
    hotkey.textContent = String(i + 1);
    slot.insertBefore(hotkey, slot.firstChild);
    slot.dataset.index = String(i);
    slot.addEventListener("click", () => hotbar.select(i));
    hotbarEl.appendChild(slot);
    hotbarSlots.push(slot);
  }

  function makeSlot(): HTMLElement {
    const slot = document.createElement("div");
    slot.className = "aurora-slot";
    const icon = document.createElement("div");
    icon.className = "slot-icon";
    const count = document.createElement("div");
    count.className = "slot-count";
    slot.appendChild(icon);
    slot.appendChild(count);
    return slot;
  }

  function renderSlotContent(slot: HTMLElement, item: ItemDef | null, count: number) {
    const icon = slot.querySelector(".slot-icon") as HTMLElement;
    const countEl = slot.querySelector(".slot-count") as HTMLElement;
    icon.replaceChildren();
    if (!item) {
      countEl.textContent = "";
      return;
    }
    if (item.iconUrl) {
      const img = document.createElement("img");
      img.src = item.iconUrl;
      img.alt = item.name;
      img.draggable = false;
      icon.appendChild(img);
    } else {
      icon.textContent = item.emoji;
    }
    if (item.kind === "resource" && count > 0) {
      countEl.textContent = String(count);
    } else {
      countEl.textContent = "";
    }
  }

  function renderHotbar() {
    const selected = hotbar.getSelectedIndex();
    const activePreset = hotbar.getActivePreset();
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const item = hotbar.getSlot(i);
      const count = item ? inventory.count(item.id) : 0;
      hotbarSlots[i].classList.toggle("selected", i === selected);
      renderSlotContent(hotbarSlots[i], item, count);
    }
    for (let i = 0; i < presetButtons.length; i++) {
      presetButtons[i].classList.toggle("active", i === activePreset);
    }
  }

  function renderInventory() {
    inventoryGrid.innerHTML = "";
    const entries = inventory.entries();
    const minSlots = 20;
    const total = Math.max(minSlots, Math.ceil(entries.length / 5) * 5);
    for (let i = 0; i < total; i++) {
      const slot = makeSlot();
      const entry = entries[i];
      if (entry) renderSlotContent(slot, entry.item, entry.count);
      inventoryGrid.appendChild(slot);
    }
  }

  function rerender() {
    renderHotbar();
    if (!inventoryEl.classList.contains("hidden")) renderInventory();
  }

  rerender();

  const offInv = inventory.on(rerender);
  const offHot = hotbar.on(rerender);

  function toggleInventory() {
    const hidden = inventoryEl.classList.toggle("hidden");
    if (!hidden) renderInventory();
  }

  function onKey(e: KeyboardEvent) {
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
    if (e.code === "KeyE") {
      toggleInventory();
      e.preventDefault();
      return;
    }
    let digit = -1;
    if (e.code.startsWith("Digit")) digit = parseInt(e.code.slice(5), 10);
    else if (e.code.startsWith("Numpad")) {
      const n = e.code.slice(6);
      if (/^\d$/.test(n)) digit = parseInt(n, 10);
    }
    if (digit >= 1 && digit <= HOTBAR_SLOTS) {
      hotbar.select(digit - 1);
      e.preventDefault();
      return;
    }
    // F1~F8 → switch preset (Z9별-style action-bar bank).
    if (e.code.length >= 2 && e.code.length <= 3 && e.code.startsWith("F")) {
      const n = parseInt(e.code.slice(1), 10);
      if (n >= 1 && n <= hotbar.presetCount()) {
        hotbar.setActivePreset(n - 1);
        e.preventDefault();
      }
    }
  }
  window.addEventListener("keydown", onKey);

  function showZoneLoading(name: string) {
    if (zoneLoadingTimer !== null) {
      window.clearTimeout(zoneLoadingTimer);
    }
    zoneLoadingTitle.textContent = name;
    zoneLoadingEl.classList.remove("hidden");
    zoneLoadingTimer = window.setTimeout(() => {
      zoneLoadingEl.classList.add("hidden");
      zoneLoadingTimer = null;
    }, 1200);
  }

  return {
    root,
    minimap,
    showZoneLoading,
    setTime,
    destroy() {
      offInv();
      offHot();
      if (zoneLoadingTimer !== null) window.clearTimeout(zoneLoadingTimer);
      window.removeEventListener("keydown", onKey);
      root.remove();
    },
  };
}
