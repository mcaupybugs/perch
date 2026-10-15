import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Effect,
  EffectState,
  LogicalPosition,
  LogicalSize,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import {
  Item,
  addItem,
  clearItems,
  deleteItem,
  listItems,
  openItemWindow,
  quit,
  saveClipboard,
  setPinned,
  timeAgo,
} from "./api";
import Bird, { Mood } from "./Bird";

const COLLAPSED = { w: 300, h: 34 };
// While open, the island grows downward so Pip sits in the notch at full size.
const PEEK = { w: 300, h: 112 };
const ISLAND_MS = 320; // matches the island's CSS height transition
const HOVER_POLL_MS = 80;
const LEAVE_DELAY_MS = 250;
const EXPANDED = { w: 400, h: 500 };
const SLEEP_AFTER_MS = 90_000;
const CATCH_MS = 1400;
const HELLO_MS = 2100;
const isMac = navigator.userAgent.includes("Mac");
const SHORTCUT = isMac ? "⌘⌃V" : "Ctrl+Alt+V";

const win = getCurrentWindow();

/** Resizes the window and keeps it centred against the top edge of the screen. */
async function placeAtTop(size: { w: number; h: number }) {
  const monitor = await currentMonitor();
  if (!monitor) return;
  const scale = monitor.scaleFactor;
  const x = monitor.position.x / scale + (monitor.size.width / scale - size.w) / 2;
  const y = monitor.position.y / scale;
  await win.setSize(new LogicalSize(size.w, size.h));
  await win.setPosition(new LogicalPosition(x, y));
}

export default function Pill() {
  const [items, setItems] = useState<Item[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  // Pip pops out of the notch and waves when Perch starts.
  const [mood, setMood] = useState<Mood>("hello");
  const [lastActive, setLastActive] = useState(Date.now());
  const [hovered, setHovered] = useState(false);
  // Set when the slim bar is clicked before hover opened it: the click opens the island first.
  const [clickedOpen, setClickedOpen] = useState(false);

  const refresh = useCallback(() => listItems().then(setItems), []);
  const wake = () => setLastActive(Date.now());
  // Pip spreads a wing and tucks the new note under it.
  const catchIt = () => {
    wake();
    setMood("catch");
    setTimeout(() => setMood((m) => (m === "catch" ? "idle" : m)), CATCH_MS);
  };

  useEffect(() => {
    refresh();
    const hello = setTimeout(() => setMood((m) => (m === "hello" ? "idle" : m)), HELLO_MS);
    const unlisten = [
      listen("items-changed", refresh),
      listen("item-saved", catchIt),
      win.onFocusChanged(({ payload: focused }) => {
        if (!focused) setExpanded(false);
      }),
    ];
    return () => {
      clearTimeout(hello);
      unlisten.forEach((p) => p.then((f) => f()));
    };
  }, [refresh]);

  // Pip dozes off when nothing has happened for a while.
  useEffect(() => {
    const t = setInterval(() => {
      setMood((m) => (m === "idle" && Date.now() - lastActive > SLEEP_AFTER_MS ? "sleep" : m));
    }, 5000);
    return () => clearInterval(t);
  }, [lastActive]);

  // macOS doesn't send hover events to an unfocused window, so hover is found by polling the
  // cursor instead — the island then opens on the first hover, no click needed.
  useEffect(() => {
    if (expanded) return;
    let alive = true;
    let wasInside = false;
    let leaveTimer: number | undefined;
    const t = setInterval(async () => {
      const pos = await invoke<[number, number] | null>("cursor_in_window").catch(() => null);
      const rect = document.querySelector(".island")?.getBoundingClientRect();
      if (!alive || !pos || !rect) return;
      const inside = pos[0] >= rect.left && pos[0] <= rect.right && pos[1] >= -4 && pos[1] <= rect.bottom;
      if (inside) {
        clearTimeout(leaveTimer);
        leaveTimer = undefined;
        if (!wasInside) {
          wasInside = true;
          setHovered(true);
          wake();
          setMood((m) => (m === "sleep" ? "idle" : m));
        }
      } else if (wasInside && leaveTimer === undefined) {
        // Only on the way out — a short grace period so brushing the edge doesn't flicker.
        leaveTimer = window.setTimeout(() => {
          wasInside = false;
          leaveTimer = undefined;
          setHovered(false);
          setClickedOpen(false);
        }, LEAVE_DELAY_MS);
      }
    }, HOVER_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
      clearTimeout(leaveTimer);
    };
  }, [expanded]);

  // The island opens on hover, on a click, at launch and while catching a note.
  const peek = !expanded && (hovered || clickedOpen || mood === "hello" || mood === "catch");
  useEffect(() => {
    if (expanded) return;
    if (peek) {
      placeAtTop(PEEK);
      return;
    }
    // Let the island finish shrinking before the window does, or the animation gets clipped.
    const t = setTimeout(() => placeAtTop(COLLAPSED), ISLAND_MS);
    return () => clearTimeout(t);
  }, [peek, expanded]);

  useEffect(() => {
    if (expanded) {
      placeAtTop(EXPANDED);
      setHovered(false);
      setClickedOpen(false);
      wake();
      setMood("idle");
      // Native frosted glass behind the panel; the collapsed pill stays solid black for the notch.
      win.setEffects({ effects: [Effect.HudWindow], state: EffectState.Active, radius: 18 });
      win.setFocus();
    } else {
      setQuery("");
      win.clearEffects();
    }
  }, [expanded]);

  // Cmd/Ctrl+V while the panel is open: keep both the HTML and plain-text flavours.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData;
      if (!data || (e.target as HTMLElement).closest(".search")) return;
      e.preventDefault();
      addItem(data.getData("text/plain"), data.getData("text/html") || null).then(catchIt);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const q = query.trim().toLowerCase();
  const shown = items
    .filter((i) => !q || i.title.toLowerCase().includes(q) || i.text.toLowerCase().includes(q))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const unpinned = items.filter((i) => !i.pinned).length;

  if (!expanded) {
    return (
      <div className="pill-wrap">
        <div
          className={`island ${peek ? "open" : ""} ${mood === "catch" ? "bounce" : ""}`}
          onClick={() => (peek ? setExpanded(true) : setClickedOpen(true))}
        >
          <div className="island-bar">
            {!peek && <Bird mood={mood} size={28} lookAt />}
            <span className="pill-gap" />
            <span className="pill-count">{items.length || ""}</span>
          </div>
          {peek && (
            <div className="island-body">
              <span className="peek">
                <Bird mood={mood} size={64} lookAt />
              </span>
              <div className="island-text">
                <div className="island-title">
                  {mood === "hello"
                    ? "Hi, I'm Pip"
                    : mood === "catch"
                      ? "Got it!"
                      : items.length
                        ? `${items.length} saved`
                        : "Nothing perched yet"}
                </div>
                <div className="muted">Click to open · {SHORTCUT} to save</div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <header className="panel-head">
        <Bird mood={mood} size={56} interactive lookAt className="bird-enter" />
        <span className="brand">Perch</span>
        <span className="muted">{items.length} saved</span>
        <span className="spacer" />
        <button onClick={() => saveClipboard()} title="Save what's on the clipboard">
          Paste
        </button>
        {unpinned > 0 && (
          <button onClick={() => clearItems()} title="Remove everything except pinned items">
            Clear
          </button>
        )}
        <button className="ghost" onClick={() => quit()} title="Quit Perch">
          ✕
        </button>
      </header>

      {items.length > 0 && (
        <div className="search-wrap">
          <input
            className="search"
            placeholder="Search saved responses"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          />
        </div>
      )}

      <ul className="list">
        {items.length === 0 && (
          <li className="empty">
            <Bird mood="sleep" size={92} />
            <div>Nothing perched yet.</div>
            <div>
              Copy a response, then press <kbd>{SHORTCUT}</kbd> anywhere
              <br />
              or <kbd>{isMac ? "⌘V" : "Ctrl+V"}</kbd> while this panel is open.
            </div>
          </li>
        )}
        {items.length > 0 && shown.length === 0 && <li className="empty">No matches for “{query}”.</li>}
        {shown.map((item) => {
          const r = item.review;
          return (
            <li key={item.id} className={`row ${item.pinned ? "is-pinned" : ""}`} onClick={() => openItemWindow(item)}>
              <div className="row-main">
                <div className="row-title">{item.title}</div>
                <div className="muted row-meta">
                  <span>{item.pinned ? "Pinned" : timeAgo(item.created_at)}</span>
                  <span>· {item.html ? "rich" : "text"}</span>
                  {r && r.total > 0 && (
                    <span className="row-progress">
                      <span className="bar">
                        <span style={{ width: `${(r.done / r.total) * 100}%` }} />
                      </span>
                      {r.done}/{r.total}
                    </span>
                  )}
                </div>
              </div>
              <button
                className={`ghost pin ${item.pinned ? "on-pin" : ""}`}
                title={item.pinned ? "Unpin (expires after 24h again)" : "Pin: keep past the 24h cleanup"}
                onClick={(e) => {
                  e.stopPropagation();
                  setPinned(item.id, !item.pinned);
                }}
              >
                {item.pinned ? "●" : "○"}
              </button>
              <button
                className="ghost del"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteItem(item.id);
                }}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      <footer className="muted foot">Unpinned items clear themselves after 24 hours</footer>
    </div>
  );
}
