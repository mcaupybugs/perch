import DOMPurify from "dompurify";
import { marked } from "marked";
import type { Item } from "./api";

/** A table pulled out of a saved item so it can be reviewed row by row. Cells are HTML. */
export type TableData = { headers: string[]; rows: string[][] };

/**
 * Rendered item: HTML where every table has been swapped for a
 * `<div data-perch-table="i">` placeholder, plus the extracted tables.
 */
export type Rendered = { html: string; tables: TableData[] };

const BOX_DRAWING = /[│┃║┌┐└┘├┤┬┴┼─━═╭╮╰╯╔╗╚╝╠╣╦╩╬]/;
// A pipe row followed by a `|---|` separator row.
const MARKDOWN_TABLE = /^\s*\|?.*\|.*\n\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/m;

// Inline styles that carry layout (indentation, whitespace) rather than the source app's look.
const LAYOUT_PROPS = new Set([
  "white-space",
  "text-indent",
  "padding-left",
  "margin-left",
  "tab-size",
  "display",
  "font-weight",
  "font-style",
  "text-decoration",
]);

function keepLayoutStyles(body: HTMLElement) {
  body.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    const kept = Array.from(el.style)
      .filter((prop) => LAYOUT_PROPS.has(prop))
      .map((prop) => `${prop}: ${el.style.getPropertyValue(prop)}`)
      .join("; ");
    if (kept) el.setAttribute("style", kept);
    else el.removeAttribute("style");
  });
}

function sanitize(html: string, stripStyles: boolean) {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "script", "meta", "link", "img"],
    // Colours always come from Perch's theme, never from the app the text was copied from.
    FORBID_ATTR: stripStyles
      ? ["style", "class", "bgcolor", "color", "width", "height"]
      : ["class", "bgcolor", "color"],
  });
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Swaps each top-level <table> for a placeholder and returns the extracted data. */
function extractHtmlTables(html: string, stripStyles: boolean): Rendered {
  const doc = new DOMParser().parseFromString(sanitize(html, stripStyles), "text/html");
  if (!stripStyles) keepLayoutStyles(doc.body);
  const tables: TableData[] = [];
  doc.body.querySelectorAll("table").forEach((table) => {
    if (table.parentElement?.closest("table")) return; // nested tables stay inside their cell
    const rows = Array.from(table.rows).map((tr) => Array.from(tr.cells).map((c) => c.innerHTML.trim()));
    if (rows.length === 0) return;
    const first = table.rows[0];
    const hasHeader =
      (table.tHead?.rows.length ?? 0) > 0 || Array.from(first.cells).every((c) => c.tagName === "TH");
    const headers = hasHeader ? rows.shift()! : [];
    const placeholder = doc.createElement("div");
    placeholder.setAttribute("data-perch-table", String(tables.length));
    table.replaceWith(placeholder);
    tables.push({ headers, rows });
  });
  return { html: doc.body.innerHTML, tables };
}

// --- Terminal tables (Claude Code box drawing, ASCII +---+ tables) ---------------------------

const DELIM = /[│┃║|]/;
const isSeparator = (line: string) =>
  /^[\s─━═\-+:|│┃║┌┐└┘├┤┬┴┼╭╮╰╯╔╗╚╝╠╣╦╩╬╞╡╪╟╢╫]+$/.test(line) && /[─━═-]{2,}/.test(line);
const isRowLine = (line: string) => {
  const t = line.trim();
  return t.length > 1 && DELIM.test(t[0]) && DELIM.test(t[t.length - 1]);
};
const splitCells = (line: string) => line.trim().slice(1, -1).split(DELIM).map((c) => c.trim());

/** Joins wrapped lines of one logical row column by column. */
function mergeLines(lines: string[]) {
  const split = lines.map(splitCells);
  const width = Math.max(...split.map((r) => r.length));
  return Array.from({ length: width }, (_, i) =>
    split
      .map((r) => r[i] ?? "")
      .filter(Boolean)
      .join(" "),
  );
}

function parseTextTable(block: string[]): TableData | null {
  // Content lines grouped by the separator lines between them.
  const groups: string[][] = [];
  let current: string[] = [];
  for (const line of block) {
    if (isSeparator(line)) {
      if (current.length) groups.push(current);
      current = [];
    } else current.push(line);
  }
  if (current.length) groups.push(current);
  if (groups.flat().length < 2) return null;

  let headerLines: string[];
  let rowLines: string[][];
  if (groups.length === 1) {
    // No separators: first line is the header, every other line is a row.
    headerLines = [groups[0][0]];
    rowLines = groups[0].slice(1).map((l) => [l]);
  } else if (groups.length === 2) {
    // Separator only under the header: each line below is its own row.
    headerLines = groups[0];
    rowLines = groups[1].map((l) => [l]);
  } else {
    // Separator between every row: each group is one (possibly wrapped) row.
    [headerLines, ...rowLines] = groups;
  }
  const cell = (s: string) => escapeHtml(s);
  return { headers: mergeLines(headerLines).map(cell), rows: rowLines.map((r) => mergeLines(r).map(cell)) };
}

function extractTextTables(text: string): Rendered {
  const lines = text.split("\n");
  const tables: TableData[] = [];
  let html = "";
  let pending: string[] = [];
  const flushText = () => {
    if (pending.join("").trim()) html += `<pre class="mono">${escapeHtml(pending.join("\n"))}</pre>`;
    pending = [];
  };
  for (let i = 0; i < lines.length; ) {
    let j = i;
    while (j < lines.length && (isRowLine(lines[j]) || isSeparator(lines[j]))) j++;
    const block = lines.slice(i, j);
    const table = block.filter(isRowLine).length >= 2 ? parseTextTable(block) : null;
    if (table) {
      flushText();
      html += `<div data-perch-table="${tables.length}"></div>`;
      tables.push(table);
      i = j;
    } else {
      pending.push(lines[i]);
      i++;
    }
  }
  flushText();
  return { html, tables };
}

/**
 * Picks the best way to show a saved item:
 * - HTML with a table (Copilot / ChatGPT / Claude web) → cleaned HTML
 * - Markdown pipe table (Claude Code, raw Markdown) → rendered Markdown
 * - Box-drawing tables or other terminal output → monospace, tables made reviewable
 * - Other HTML → sanitized HTML keeping layout styles (code indentation)
 */
export function render(item: Item): Rendered {
  if (item.html && /<table/i.test(item.html)) return extractHtmlTables(item.html, true);
  if (MARKDOWN_TABLE.test(item.text)) {
    return extractHtmlTables(marked.parse(item.text, { async: false }), true);
  }
  if (BOX_DRAWING.test(item.text) || !item.html) return extractTextTables(item.text);
  return extractHtmlTables(item.html, false);
}

// --- Copy back as Markdown ------------------------------------------------------------------

export function cellText(html: string) {
  const el = document.createElement("div");
  el.innerHTML = html;
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function toMarkdown(headers: string[], rows: string[][]) {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const width = Math.max(headers.length, ...rows.map((r) => r.length));
  const head = headers.length ? headers : Array.from({ length: width }, (_, i) => `Col ${i + 1}`);
  const line = (cells: string[]) => `| ${cells.map(esc).join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map(line)].join("\n");
}
