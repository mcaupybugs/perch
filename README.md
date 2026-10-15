# Perch

A pinboard for AI responses that lives in your notch.

When Copilot, Claude or ChatGPT gives you a table you want to work through row by row, it scrolls out of view as soon as the chat moves on. Perch keeps it in view: copy the response, press a shortcut, and it's saved in the notch. Open it as a floating card next to the chat and review it one row at a time.

Works on macOS (in the notch, or at the top centre of screens without one) and Windows (at the top of the screen).

## Features

**Saving**
- Press <kbd>⌘⌃V</kbd> from any app to save what's on the clipboard, or <kbd>⌘V</kbd> while the Perch panel is open.
- Both the rich (HTML) and plain-text versions are kept, so formatting survives.
- Colours from the source app are removed so everything matches Perch's theme; indentation and bold/italic are kept.
- Tables are recognised from:
  - web chats (Copilot, ChatGPT, Claude): HTML tables
  - Markdown pipe tables
  - terminal tools like Claude Code: box-drawing tables, including cells that wrap over several lines
  - ASCII `+---+` tables

**The notch island**
- A slim black bar in the notch. Hover it and it grows down with Pip and a count of saved items; click to open the panel.
- The panel lists saved responses with search, review progress and a pin button.
- Items clear themselves after 24 hours. Pinned items are kept and survive **Clear**.

**Reviewing a table (in each card)**
- Mark each row ✓ accept, ✕ reject or ? unsure, and add a note with ✎.
- Click a column header to sort; drag ⋮⋮ to reorder rows.
- **Hide done** hides rows you've already marked.
- Progress (e.g. `3/4`) is saved and shown in the list, so closing a card loses nothing.
- **Copy** puts your accepted rows, or the whole table with statuses and notes, on the clipboard as Markdown, ready to paste back into the chat.

**Keeping cards in view**
- Cards float above other windows (**On top** turns this off).
- **▤ Compact** shrinks a card to one row at a time.
- **◐ See-through** fades a card almost completely and lets clicks pass through it.
- Drag a card to the left or right edge of the screen to snap it into a full-height side panel.
- **Raw** shows the text exactly as copied.

**Pip**

A small bird that lives in the island. Its eye follows your cursor. It waves when Perch starts, tucks each saved note under its wing, falls asleep when nothing is happening, and dances when you finish reviewing a table. Poke it in the panel or on a card: it gets annoyed, then dizzy.

## Shortcuts

| Shortcut | Where | What it does |
| --- | --- | --- |
| <kbd>⌘⌃V</kbd> (Windows: <kbd>Ctrl+Alt+V</kbd>) | Anywhere | Save the clipboard to Perch |
| <kbd>⌘V</kbd> (Windows: <kbd>Ctrl+V</kbd>) | Panel open | Save the clipboard to Perch |
| <kbd>⌘⌃T</kbd> (Windows: <kbd>Ctrl+Alt+T</kbd>) | Anywhere | Bring back see-through cards |
| <kbd>←</kbd> / <kbd>→</kbd> | Compact card | Previous / next row |
| <kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd> | Compact card | Accept / reject / unsure, then go to the next row |
| <kbd>Esc</kbd> | Search box | Clear the search |

## Running it

You need [Node.js](https://nodejs.org) 20 or newer and [Rust](https://rustup.rs). On macOS you also need the Xcode command line tools (`xcode-select --install`). On Windows, see the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
```

```bash
npm run tauri dev
```

The first build compiles the Rust side and takes a few minutes; later runs start in seconds. Frontend changes reload instantly.

To build an installable app (a `.dmg` / `.app` on macOS, an `.msi` / `.exe` on Windows):

```bash
npm run tauri build
```

The output goes in `src-tauri/target/release/bundle/`. Builds aren't signed yet, so macOS will block the app the first time: open it, then go to **System Settings → Privacy & Security → Open Anyway**.

The `src-tauri/target` folder grows to a few GB while developing. Run `cargo clean` inside `src-tauri` to free that space.

## How it's built

- [Tauri 2](https://tauri.app) (Rust) with React and TypeScript, so the app stays small (a few MB).
- `src-tauri/src/lib.rs`: saving and expiring items, reading the clipboard, the global shortcuts, and placing the island above the menu bar on macOS.
- `src/Pill.tsx`: the notch island and the panel.
- `src/ItemWindow.tsx` and `src/ReviewTable.tsx`: floating cards and table review.
- `src/render.ts`: turns saved HTML or terminal text into reviewable tables.
- `src/Bird.tsx`: Pip.

Saved items are stored on your computer only, in `items.json` in the app's data folder (on macOS, `~/Library/Application Support/com.mcaupybugs.perch/`).
