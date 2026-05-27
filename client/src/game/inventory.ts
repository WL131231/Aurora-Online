import { ITEMS, type ItemDef } from "./items";

type Listener = () => void;

class Emitter {
  private listeners = new Set<Listener>();
  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
  protected emit() {
    for (const l of this.listeners) l();
  }
}

export class Inventory extends Emitter {
  private counts = new Map<string, number>();

  add(itemId: string, n = 1): boolean {
    if (!ITEMS[itemId]) return false;
    this.counts.set(itemId, (this.counts.get(itemId) ?? 0) + n);
    this.emit();
    return true;
  }

  // Set absolute count from an authoritative source (server). count<=0 removes.
  setFromServer(itemId: string, count: number): void {
    if (!ITEMS[itemId]) return;
    if (count <= 0) this.counts.delete(itemId);
    else this.counts.set(itemId, count);
    this.emit();
  }

  // Replace all counts from a snapshot. Used on reconnect.
  replaceFromServer(snapshot: Iterable<[string, number]>): void {
    this.counts.clear();
    for (const [id, n] of snapshot) {
      if (ITEMS[id] && n > 0) this.counts.set(id, n);
    }
    this.emit();
  }

  count(itemId: string): number {
    return this.counts.get(itemId) ?? 0;
  }

  has(itemId: string): boolean {
    return this.count(itemId) > 0;
  }

  entries(): Array<{ item: ItemDef; count: number }> {
    return [...this.counts]
      .filter(([, n]) => n > 0)
      .map(([id, n]) => ({ item: ITEMS[id], count: n }));
  }
}

export const HOTBAR_SLOTS = 8;
export const HOTBAR_PRESETS = 8;

export class Hotbar extends Emitter {
  // 8 presets × 8 slots — Z9별 style action bar.
  private presets: Array<Array<string | null>> = Array.from(
    { length: HOTBAR_PRESETS },
    () => new Array(HOTBAR_SLOTS).fill(null),
  );
  private activePresetIdx = 0;
  private selectedIndex = 0;

  setSlot(index: number, itemId: string | null) {
    if (index < 0 || index >= HOTBAR_SLOTS) return;
    this.presets[this.activePresetIdx][index] = itemId;
    this.emit();
  }

  getSlot(index: number): ItemDef | null {
    const id = this.presets[this.activePresetIdx][index];
    return id ? ITEMS[id] ?? null : null;
  }

  getSelected(): ItemDef | null {
    return this.getSlot(this.selectedIndex);
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  select(index: number) {
    if (index < 0 || index >= HOTBAR_SLOTS) return;
    if (this.selectedIndex === index) return;
    this.selectedIndex = index;
    this.emit();
  }

  size(): number {
    return HOTBAR_SLOTS;
  }

  setActivePreset(idx: number) {
    if (idx < 0 || idx >= HOTBAR_PRESETS) return;
    if (this.activePresetIdx === idx) return;
    this.activePresetIdx = idx;
    this.emit();
  }

  getActivePreset(): number {
    return this.activePresetIdx;
  }

  presetCount(): number {
    return HOTBAR_PRESETS;
  }
}
