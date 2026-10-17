# Microsoft Store listing for Perch

Copy these into the submission in Partner Center.

## Properties

- **Category:** Productivity
- **Privacy policy URL:** https://mcaupybugs.github.io/perch-waitlist/privacy.html
- **Website:** https://github.com/mcaupybugs/perch
- **Support contact:** https://github.com/mcaupybugs/perch/issues

## Store listing (English)

**Product name:** Perch

**Short description** (shown in search results):

> Save any AI answer with one shortcut and review it row by row, right beside your chat.

**Description:**

> Copilot, ChatGPT and Claude bury that perfect table the moment you reply. Perch keeps it in view.
>
> Select a response in any app and press Ctrl+Alt+V. Perch copies it, saves it, and keeps it a hover away at the top of your screen. Open it as a floating card next to your chat and work through it one row at a time.
>
> • Save from anywhere: web chats, VS Code, even tables from Claude Code in the terminal. Formatting and indentation are kept.
> • Review row by row: mark each row accept, reject or unsure, add notes, sort columns and drag rows into your own order.
> • Send your picks back: copy just the rows you accepted, or the whole table with your notes, as Markdown ready to paste into the chat.
> • Always in view: cards float above other windows. Shrink one to a single row, make it see-through so clicks pass through, or snap it to the edge of the screen.
> • Stays out of the way: a thin line at the top of the screen that only opens when you rest the cursor on it.
> • Tidy by default: saved items clear themselves after 24 hours unless you pin them.
> • Private: everything stays on your computer. No account, no tracking.
>
> And there's Pip, a small bird who lives at the top of your screen, catches every note you save and gets dizzy if you poke it too much.
>
> Perch is free and open source.

**What's new in this version:**

> First Store release. One shortcut now copies your selection and saves it.

**Features** (up to 20, one per line):

- Save any AI response with one shortcut
- Review tables row by row: accept, reject, unsure
- Notes on each row
- Copy your picks back as Markdown
- Floating cards that stay on top
- Compact one-row mode
- See-through mode
- Snap cards to the screen edge
- Search and pin saved items
- Everything stays on your computer

**Search terms** (up to 7): AI, ChatGPT, Copilot, Claude, clipboard, table, productivity

**Screenshots:** at least one, 1366×768 or larger. Suggested:
1. A card beside a chat, with rows marked ✓ ✕ ? and a note
2. The island open at the top of the screen with Pip
3. The panel listing saved items with progress bars
4. Compact mode next to a chat

## Submission options → runFullTrust justification

The capability box takes about 500 characters. Paste this (367):

> Perch is a desktop utility (Win32, built with Tauri). It needs runFullTrust for: (1) a global shortcut, Ctrl+Alt+V, that saves the user's selected text by sending one Ctrl+C to the foreground app, only when the user presses it; (2) always-on-top windows that keep saved content visible beside other apps. All data stays on the device. No network requests, no sign-in.

## Submission options → notes for certification

Paste into "Notes for certification":

> Perch is a desktop productivity utility built as a full-trust Win32 app (Tauri framework). It needs runFullTrust to work as designed:
>
> 1. A system-wide keyboard shortcut (Ctrl+Alt+V) that saves the user's current selection from any app. When the user presses it, Perch sends a single Ctrl+C keystroke to the foreground app and then reads the clipboard. This happens only when the user presses the shortcut.
> 2. Small always-on-top windows (a slim bar at the top of the screen and floating cards) so saved content stays visible beside other apps.
> 3. A second shortcut (Ctrl+Alt+T) to restore cards the user made click-through.
>
> All data stays on the device in the app's local data folder; the app makes no network requests. No account or sign-in is needed.
>
> How to test: open any app with text (for example Notepad or Edge), select some text and press Ctrl+Alt+V. Rest the mouse on the thin line at the top centre of the screen to open Perch, click it to see the saved item, and click the item to open it as a floating card.
