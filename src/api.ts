import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Effect, EffectState } from "@tauri-apps/api/window";

export type Item = {
  id: string;
  title: string;
  created_at: number;
  text: string;
  html: string | null;
  pinned: boolean;
  review: Review | null;
};

export type RowStatus = "accept" | "reject" | "unsure";
export type RowReview = { status?: RowStatus; note?: string };
/** `order` holds original row indices in the user's dragged order. */
export type TableReview = { order?: number[]; rows: Record<number, RowReview> };
/** Saved with the item so progress survives closing the card. */
export type Review = { tables: TableReview[]; done: number; total: number };

export const listItems = () => invoke<Item[]>("list_items");
export const getItem = (id: string) => invoke<Item | null>("get_item", { id });
export const addItem = (text: string, html: string | null) =>
  invoke<Item | null>("add_item", { text, html });
export const saveClipboard = () => invoke<Item | null>("save_clipboard");
export const deleteItem = (id: string) => invoke<void>("delete_item", { id });
export const clearItems = () => invoke<void>("clear_items");
export const setPinned = (id: string, pinned: boolean) => invoke<void>("set_pinned", { id, pinned });
export const setReview = (id: string, review: Review) => invoke<void>("set_review", { id, review });
export const copyText = (text: string) => invoke<void>("copy_text", { text });
export const quit = () => invoke<void>("quit");

export async function openItemWindow(item: Item) {
  const label = `item-${item.id}`;
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  new WebviewWindow(label, {
    url: `index.html?item=${encodeURIComponent(item.id)}`,
    title: item.title,
    width: 560,
    height: 420,
    minWidth: 260,
    minHeight: 160,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    shadow: true,
    // Lets rows be reordered with HTML drag and drop instead of Tauri's file-drop handling.
    dragDropEnabled: false,
    windowEffects: { effects: [Effect.HudWindow], state: EffectState.Active, radius: 14 },
  });
}

export function timeAgo(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
