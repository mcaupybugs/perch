import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import {
  Effect,
  EffectState,
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import { Item, Review, RowStatus, TableReview, copyText, getItem, setReview } from "./api";
import Bird, { Mood } from "./Bird";
import ReviewTable, { rowOrder } from "./ReviewTable";
import { TableData, cellText, render, toMarkdown } from "./render";

const win = getCurrentWindow();
const isMac = navigator.userAgent.includes("Mac");
const SOLID_SHORTCUT = isMac ? "⌘⌃T" : "Ctrl+Alt+T";
const COMPACT_SIZE = { w: 460, h: 210 };
const SNAP_DISTANCE = 24; // logical px from a screen edge
const GLASS = { effects: [Effect.HudWindow], state: EffectState.Active, radius: 14 };

function emptyReview(tables: TableData[]): Review {
  return { tables: tables.map(() => ({ rows: {} })), done: 0, total: 0 };
}

function progress(tables: TableData[], review: Review) {
  const total = tables.reduce((n, t) => n + t.rows.length, 0);
  const done = tables.reduce(
    (n, t, ti) => n + t.rows.filter((_, ri) => review.tables[ti]?.rows[ri]?.status).length,
    0,
  );
  return { done, total };
}

/** Snaps the card into a full-height side panel near the left/right screen edge, and back out. */
function useEdgeSnap(enabled: boolean) {
  const preSnapHeight = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const snap = async () => {
      const [pos, size, mon] = await Promise.all([win.outerPosition(), win.outerSize(), currentMonitor()]);
      if (!mon) return;
      const wa = mon.workArea;
      const reach = SNAP_DISTANCE * mon.scaleFactor;
      const left = wa.position.x;
      const right = wa.position.x + wa.size.width;
      let x: number | null = null;
      if (Math.abs(pos.x - left) < reach) x = left;
      else if (Math.abs(pos.x + size.width - right) < reach) x = right - size.width;

      if (x === null) {
        // Dragged away from the edge: give the card its old height back.
        if (preSnapHeight.current !== null) {
          await win.setSize(new PhysicalSize(size.width, preSnapHeight.current));
          preSnapHeight.current = null;
        }
        return;
      }
      if (x === pos.x && pos.y === wa.position.y && size.height === wa.size.height) return;
      preSnapHeight.current ??= size.height;
      await win.setSize(new PhysicalSize(size.width, wa.size.height));
      await win.setPosition(new PhysicalPosition(x, wa.position.y));
    };
    const unlisten = win.onMoved(() => {
      clearTimeout(timer);
      timer = window.setTimeout(snap, 280);
    });
    return () => {
      clearTimeout(timer);
      unlisten.then((f) => f());
    };
  }, [enabled]);
}

export default function ItemWindow({ id }: { id: string }) {
  const [item, setItem] = useState<Item | null | undefined>(undefined);
  const [review, setReviewState] = useState<Review | null>(null);
  const [raw, setRaw] = useState(false);
  const [onTop, setOnTop] = useState(true);
  const [hideReviewed, setHideReviewed] = useState(false);
  const [compact, setCompact] = useState(false);
  const [ghost, setGhost] = useState(false);
  const [copyMenu, setCopyMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [hop, setHop] = useState(false);
  const [slots, setSlots] = useState<Element[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fullSize = useRef<LogicalSize | null>(null);

  useEffect(() => {
    getItem(id).then(setItem);
  }, [id]);

  const rendered = useMemo(() => (item ? render(item) : null), [item]);
  const tables = rendered?.tables ?? [];

  // Load the saved review once the item is parsed, padding it if the table count changed.
  useEffect(() => {
    if (!item || !rendered) return;
    const saved = item.review ?? emptyReview(rendered.tables);
    const padded = rendered.tables.map((_, i) => saved.tables[i] ?? { rows: {} });
    setReviewState({ ...saved, tables: padded });
  }, [item, rendered]);

  const { done, total } = review ? progress(tables, review) : { done: 0, total: 0 };

  // Persist review changes (debounced) so progress survives closing the card.
  const firstSave = useRef(true);
  useEffect(() => {
    if (!review) return;
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    const t = setTimeout(() => setReview(id, { ...review, done, total }), 300);
    return () => clearTimeout(t);
  }, [review, id, done, total]);

  // Find the table placeholders inside the rendered HTML so React can portal tables into them.
  const html = useMemo(() => ({ __html: rendered?.html ?? "" }), [rendered]);
  useLayoutEffect(() => {
    setSlots(bodyRef.current ? Array.from(bodyRef.current.querySelectorAll("[data-perch-table]")) : []);
  }, [html, raw, compact]);

  // See-through cards ignore the mouse, so a global shortcut brings them back.
  useEffect(() => {
    const unlisten = listen("solid-cards", () => {
      setGhost(false);
      win.setIgnoreCursorEvents(false);
      win.setEffects(GLASS);
      win.setShadow(true);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEdgeSnap(!compact);

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 1400);
  };
  const cheer = () => {
    setHop(true);
    setTimeout(() => setHop(false), 700);
  };

  const updateTable = (ti: number, next: TableReview) =>
    setReviewState((r) => (r ? { ...r, tables: r.tables.map((t, i) => (i === ti ? next : t)) } : r));

  const toggleOnTop = () => {
    win.setAlwaysOnTop(!onTop);
    setOnTop(!onTop);
  };

  // The native blur and shadow sit behind the page, so CSS opacity alone can't fade them.
  const goSeeThrough = () => {
    setGhost(true);
    win.setIgnoreCursorEvents(true);
    win.clearEffects();
    win.setShadow(false);
  };

  const toggleCompact = async () => {
    setCompact(!compact);
    try {
      if (!compact) {
        const size = await win.innerSize();
        fullSize.current = size.toLogical(await win.scaleFactor());
        await win.setSize(new LogicalSize(COMPACT_SIZE.w, COMPACT_SIZE.h));
      } else if (fullSize.current) {
        await win.setSize(fullSize.current);
      }
    } catch (e) {
      console.warn("Perch: could not resize card", e);
    }
  };

  const copyBack = async (mode: "accepted" | "all") => {
    if (!review) return;
    const parts = tables.map((t, ti) => {
      const tr = review.tables[ti];
      const order = rowOrder(t, tr);
      const headers = t.headers.map(cellText);
      if (mode === "accepted") {
        const rows = order.filter((i) => tr.rows[i]?.status === "accept").map((i) => t.rows[i].map(cellText));
        return rows.length ? toMarkdown(headers, rows) : "";
      }
      const width = Math.max(headers.length, ...t.rows.map((r) => r.length));
      const columns = Array.from({ length: width }, (_, c) => headers[c] ?? `Col ${c + 1}`);
      const rows = order.map((i) => [
        ...columns.map((_, c) => cellText(t.rows[i][c] ?? "")),
        tr.rows[i]?.status ?? "",
        tr.rows[i]?.note ?? "",
      ]);
      return toMarkdown([...columns, "Status", "Note"], rows);
    });
    const text = parts.filter(Boolean).join("\n\n");
    setCopyMenu(false);
    if (!text) return flash("No accepted rows yet");
    await copyText(mode === "accepted" ? `Here are the rows I picked:\n\n${text}` : text);
    flash("Copied as Markdown");
    cheer();
  };

  const mood: Mood = hop ? "happy" : total > 0 && done === total ? "proud" : "idle";

  if (item === undefined) return <div className="card" />;

  return (
    <div className={`card ${ghost ? "ghost" : ""} ${compact ? "compact" : ""}`}>
      <header className="card-head" data-tauri-drag-region>
        <Bird mood={mood} size={28} interactive lookAt />
        <span className="card-title" data-tauri-drag-region>
          {ghost ? `See-through · ${SOLID_SHORTCUT} to bring back` : (item?.title ?? "Not found")}
        </span>
        {total > 0 && (
          <span className={`progress ${done === total ? "complete" : ""}`} data-tauri-drag-region>
            {done}/{total}
          </span>
        )}
        {!ghost && item && (
          <div className="tools">
            {total > 0 && (
              <span className="menu-anchor">
                <button onClick={() => setCopyMenu(!copyMenu)} title="Copy back as Markdown">
                  Copy
                </button>
                {copyMenu && (
                  <div className="menu">
                    <button onClick={() => copyBack("accepted")}>Accepted rows</button>
                    <button onClick={() => copyBack("all")}>Table with status + notes</button>
                  </div>
                )}
              </span>
            )}
            {total > 0 && !compact && (
              <button className={hideReviewed ? "on" : ""} onClick={() => setHideReviewed(!hideReviewed)} title="Hide reviewed rows">
                Hide done
              </button>
            )}
            {!compact && (
              <button className={raw ? "on" : ""} onClick={() => setRaw(!raw)} title="Show the original text">
                Raw
              </button>
            )}
            {total > 0 && (
              <button className={compact ? "on" : ""} onClick={toggleCompact} title="Compact: one row at a time">
                ▤
              </button>
            )}
            <button onClick={goSeeThrough} title={`See-through: fade and let clicks pass (${SOLID_SHORTCUT} to undo)`}>
              ◐
            </button>
            <button className={onTop ? "on" : ""} onClick={toggleOnTop} title="Keep above other windows">
              On top
            </button>
            <button onClick={() => win.close()} title="Close">
              ✕
            </button>
          </div>
        )}
      </header>

      {toast && <div className="toast">{toast}</div>}

      {compact && review ? (
        <CompactView tables={tables} review={review} onChange={updateTable} onMark={cheer} />
      ) : (
        <div className="card-body" onClick={() => setCopyMenu(false)}>
          {!item && <p className="muted">This item has expired or was deleted.</p>}
          {item && raw && <pre className="mono">{item.text}</pre>}
          {item && !raw && <div className="rich" ref={bodyRef} dangerouslySetInnerHTML={html} />}
          {item &&
            !raw &&
            review &&
            slots.map((slot) => {
              const ti = Number(slot.getAttribute("data-perch-table"));
              return createPortal(
                <ReviewTable
                  table={tables[ti]}
                  review={review.tables[ti]}
                  hideReviewed={hideReviewed}
                  onChange={(next) => updateTable(ti, next)}
                  onMark={cheer}
                />,
                slot,
                `t${ti}`,
              );
            })}
        </div>
      )}
    </div>
  );
}

/** One row at a time, with prev/next — takes almost no screen space. */
function CompactView({
  tables,
  review,
  onChange,
  onMark,
}: {
  tables: TableData[];
  review: Review;
  onChange: (ti: number, next: TableReview) => void;
  onMark: () => void;
}) {
  const rows = useMemo(
    () => tables.flatMap((t, ti) => rowOrder(t, review.tables[ti]).map((ri) => ({ ti, ri }))),
    [tables, review.tables],
  );
  const [pos, setPos] = useState(() => {
    const firstOpen = rows.findIndex(({ ti, ri }) => !review.tables[ti].rows[ri]?.status);
    return Math.max(0, firstOpen);
  });
  const current = rows[pos];

  const setStatus = (status: RowStatus) => {
    if (!current) return;
    const tr = review.tables[current.ti];
    const same = tr.rows[current.ri]?.status === status;
    onChange(current.ti, {
      ...tr,
      rows: { ...tr.rows, [current.ri]: { ...tr.rows[current.ri], status: same ? undefined : status } },
    });
    if (!same) {
      onMark();
      setPos((p) => Math.min(rows.length - 1, p + 1));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "ArrowRight") setPos((p) => Math.min(rows.length - 1, p + 1));
      if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - 1));
      if (e.key === "1") setStatus("accept");
      if (e.key === "2") setStatus("reject");
      if (e.key === "3") setStatus("unsure");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!current) return <div className="card-body muted">No rows.</div>;
  const table = tables[current.ti];
  const state = review.tables[current.ti].rows[current.ri] ?? {};
  const cells = table.rows[current.ri];

  return (
    <div className="compact-body">
      <div className="compact-cells">
        {cells.map((cell, c) => (
          <div key={c} className="compact-cell">
            {table.headers[c] && <span className="compact-label">{cellText(table.headers[c])}</span>}
            <span dangerouslySetInnerHTML={{ __html: cell }} />
          </div>
        ))}
      </div>
      <div className="compact-bar">
        <button onClick={() => setPos((p) => Math.max(0, p - 1))} disabled={pos === 0}>
          ←
        </button>
        <span className="muted">
          Row {pos + 1} of {rows.length}
        </span>
        <span className="spacer" />
        {(["accept", "reject", "unsure"] as RowStatus[]).map((s, i) => (
          <button key={s} className={state.status === s ? "on" : ""} onClick={() => setStatus(s)} title={`${s} (${i + 1})`}>
            {["✓", "✕", "?"][i]}
          </button>
        ))}
        <button onClick={() => setPos((p) => Math.min(rows.length - 1, p + 1))} disabled={pos === rows.length - 1}>
          →
        </button>
      </div>
    </div>
  );
}
