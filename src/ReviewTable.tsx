import { Fragment, useMemo, useState } from "react";
import type { RowStatus, TableReview } from "./api";
import { TableData, cellText } from "./render";

const STATUSES: { value: RowStatus; label: string; title: string }[] = [
  { value: "accept", label: "✓", title: "Accept" },
  { value: "reject", label: "✕", title: "Reject" },
  { value: "unsure", label: "?", title: "Unsure" },
];

/** The user's dragged order, falling back to the original order if the table shape changed. */
export function rowOrder(table: TableData, review: TableReview) {
  const n = table.rows.length;
  const order = review.order;
  return order && order.length === n && order.every((i) => i < n) ? order : table.rows.map((_, i) => i);
}

function compare(a: string, b: string) {
  const na = parseFloat(a.replace(/[^\d.-]/g, ""));
  const nb = parseFloat(b.replace(/[^\d.-]/g, ""));
  if (!isNaN(na) && !isNaN(nb) && /\d/.test(a) && /\d/.test(b)) return na - nb;
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

type Props = {
  table: TableData;
  review: TableReview;
  hideReviewed: boolean;
  onChange: (review: TableReview) => void;
  onMark: () => void;
};

export default function ReviewTable({ table, review, hideReviewed, onChange, onMark }: Props) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [editingNote, setEditingNote] = useState<number | null>(null);

  const width = Math.max(table.headers.length, ...table.rows.map((r) => r.length));
  const order = rowOrder(table, review);

  const visible = useMemo(() => {
    let rows = [...order];
    if (sort) {
      rows.sort((a, b) => sort.dir * compare(cellText(table.rows[a][sort.col] ?? ""), cellText(table.rows[b][sort.col] ?? "")));
    }
    if (hideReviewed) rows = rows.filter((i) => !review.rows[i]?.status);
    return rows;
  }, [order, sort, hideReviewed, review.rows, table.rows]);

  const updateRow = (i: number, patch: Partial<{ status: RowStatus | undefined; note: string }>) => {
    const next = { ...review.rows[i], ...patch };
    onChange({ ...review, rows: { ...review.rows, [i]: next } });
  };

  const setStatus = (i: number, status: RowStatus) => {
    const same = review.rows[i]?.status === status;
    updateRow(i, { status: same ? undefined : status });
    if (!same) onMark();
  };

  const cycleSort = (col: number) =>
    setSort((s) => (!s || s.col !== col ? { col, dir: 1 } : s.dir === 1 ? { col, dir: -1 } : null));

  const drop = (target: number) => {
    if (dragging === null || dragging === target) return;
    const next = order.filter((i) => i !== dragging);
    next.splice(next.indexOf(target), 0, dragging);
    onChange({ ...review, order: next });
  };

  const canDrag = !sort;

  return (
    <table className="review">
      {table.headers.length > 0 && (
        <thead>
          <tr>
            <th className="grip-col" />
            {Array.from({ length: width }, (_, c) => (
              <th key={c} className="sortable" onClick={() => cycleSort(c)}>
                <span dangerouslySetInnerHTML={{ __html: table.headers[c] ?? "" }} />
                <span className="sort-mark">{sort?.col === c ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</span>
              </th>
            ))}
            <th className="status-col" />
          </tr>
        </thead>
      )}
      <tbody>
        {visible.map((i) => {
          const state = review.rows[i] ?? {};
          const showNote = editingNote === i || !!state.note;
          return (
            <Fragment key={i}>
              <tr
                className={[
                  state.status ? `is-${state.status}` : "",
                  dragging === i ? "is-dragging" : "",
                  dropTarget === i && dragging !== i ? "is-drop" : "",
                ].join(" ")}
                draggable={canDrag}
                onDragStart={(e) => {
                  setDragging(i);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (dragging === null) return;
                  e.preventDefault();
                  setDropTarget(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(i);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setDropTarget(null);
                }}
              >
                <td className="grip-col" title={canDrag ? "Drag to reorder" : "Clear sorting to reorder"}>
                  {canDrag ? "⋮⋮" : ""}
                </td>
                {Array.from({ length: width }, (_, c) => (
                  <td key={c} dangerouslySetInnerHTML={{ __html: table.rows[i][c] ?? "" }} />
                ))}
                <td className="status-col">
                  <div className="status-btns">
                    {STATUSES.map((s) => (
                      <button
                        key={s.value}
                        title={s.title}
                        className={state.status === s.value ? "on" : ""}
                        onClick={() => setStatus(i, s.value)}
                      >
                        {s.label}
                      </button>
                    ))}
                    <button
                      title="Add a note"
                      className={state.note ? "on" : ""}
                      onClick={() => setEditingNote(editingNote === i ? null : i)}
                    >
                      ✎
                    </button>
                  </div>
                </td>
              </tr>
              {showNote && (
                <tr className="note-row">
                  <td />
                  <td colSpan={width + 1}>
                    <input
                      className="note-input"
                      placeholder="Note for this row…"
                      value={state.note ?? ""}
                      autoFocus={editingNote === i}
                      onChange={(e) => updateRow(i, { note: e.target.value })}
                      onBlur={() => setEditingNote(null)}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
        {visible.length === 0 && (
          <tr>
            <td colSpan={width + 2} className="all-done">
              Every row here has been reviewed.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
