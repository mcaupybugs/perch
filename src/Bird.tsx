import { MouseEvent, RefObject, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type Mood = "idle" | "happy" | "sleep" | "proud" | "catch" | "dizzy" | "annoyed" | "hello";

const DIZZY_CLICKS = 3; // clicks within DIZZY_WINDOW_MS make Pip dizzy
const DIZZY_WINDOW_MS = 1200;
const DURATION: Partial<Record<Mood, number>> = { annoyed: 900, dizzy: 2600 };
const LOOK_INTERVAL_MS = 60;
const LOOK_REACH = 0.9; // how far the pupil travels, in viewBox units

/** Moves Pip's pupil toward the cursor, anywhere on screen. */
function useLookAt(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  const [look, setLook] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = async () => {
      const pos = await invoke<[number, number] | null>("cursor_in_window").catch(() => null);
      const el = ref.current;
      if (!alive || !pos || !el) return;
      const r = el.getBoundingClientRect();
      const dx = pos[0] - (r.left + r.width * 0.7);
      const dy = pos[1] - (r.top + r.height * 0.34);
      const dist = Math.hypot(dx, dy) || 1;
      const pull = Math.min(1, dist / 160) * LOOK_REACH;
      setLook({ x: (dx / dist) * pull, y: (dy / dist) * pull });
    };
    const t = setInterval(tick, LOOK_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [ref, enabled]);
  return look;
}

/**
 * Pip, the little bird that perches on Perch. Monochrome so it sits in the black-and-white theme.
 * - idle: gentle bob and the odd blink
 * - catch: spreads its wing, a note grows in front of it and gets tucked under the wing
 * - hello: pops out from the top edge and waves on launch
 * - happy: a hop and a chirp when a row is marked
 * - annoyed: a frown and a huff when poked once or twice
 * - dizzy: spiral eyes and circling stars if you keep poking
 * Its eye follows the cursor around the screen when `lookAt` is set.
 * - sleep: eyes shut, drifting z's after a while with nothing to do
 * - proud: a little dance when every row in a table has been reviewed
 */
export default function Bird({
  mood = "idle",
  size = 22,
  interactive = false,
  lookAt = false,
  className = "",
}: {
  mood?: Mood;
  size?: number;
  interactive?: boolean;
  lookAt?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [poke, setPoke] = useState<{ mood: Mood; n: number } | null>(null);
  const clicks = useRef<number[]>([]);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = (e: MouseEvent) => {
    if (!interactive) return;
    e.stopPropagation();
    const now = Date.now();
    clicks.current = [...clicks.current.filter((t) => now - t < DIZZY_WINDOW_MS), now];
    const next: Mood = poke?.mood === "dizzy" || clicks.current.length >= DIZZY_CLICKS ? "dizzy" : "annoyed";
    setPoke((p) => ({ mood: next, n: (p?.n ?? 0) + 1 }));
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setPoke(null);
      clicks.current = [];
    }, DURATION[next]);
  };

  const shown = poke?.mood ?? mood;
  // Re-keying restarts the CSS animation when the same reaction fires twice in a row.
  const key = poke && poke.mood === "annoyed" ? `${shown}-${poke.n}` : shown;
  const eyesOpen = shown === "idle" || shown === "happy" || shown === "hello";
  const look = useLookAt(ref, lookAt && eyesOpen);

  return (
    <span
      ref={ref}
      className={`bird bird-${shown} ${interactive ? "bird-interactive" : ""} ${className}`}
      style={{ width: size, height: size }}
      onClick={onClick}
      aria-hidden
    >
      <svg key={key} viewBox="0 0 32 32" width={size} height={size}>
        <g className="bird-body">
          {/* tail */}
          <path d="M8.5 17.5 L2.5 14 L4.5 20.5 Z" fill="#e9e9ec" />
          {/* body */}
          <ellipse className="bird-belly" cx="15" cy="18.5" rx="9" ry="7.6" fill="#fff" />
          {/* head */}
          <circle cx="20.5" cy="11.5" r="5.6" fill="#fff" />
          {/* beak */}
          <path className="bird-beak" d="M25.6 10.6 L29.6 12 L25.6 13.4 Z" fill="#a9a9b0" />
          {/* cheek */}
          <circle cx="21.6" cy="14" r="1.3" fill="#c8c8ce" opacity="0.8" />
          <g className="bird-look" style={{ transform: eyesOpen ? `translate(${look.x}px, ${look.y}px)` : undefined }}>
            <Eye mood={shown} />
          </g>
          {shown === "annoyed" && (
            <path className="bird-brow" d="M20.4 7.9 L24.2 9.1" stroke="#111" strokeWidth="1" strokeLinecap="round" />
          )}
          {/* the note Pip catches: grows in front of the beak, then slides under the wing */}
          {shown === "catch" && (
            <g className="bird-note-paper">
              <rect x="23.5" y="15" width="7" height="8.4" rx="1.2" fill="#fff" stroke="#111" strokeWidth="0.6" />
              <path d="M25 17.6 h4 M25 19.4 h4 M25 21.2 h2.6" stroke="#777" strokeWidth="0.6" strokeLinecap="round" />
            </g>
          )}
          {/* wing: drawn after the note so the tucked note disappears beneath it */}
          <g className="bird-wing">
            <path d="M9 17.2 Q14 13.6 19 18.4 Q14 21.6 9 17.2 Z" fill="#d5d5da" />
            <path className="bird-feathers" d="M10.5 16.4 L8.6 13.4 M12.6 15.4 L11.6 12 M14.8 15.2 L14.8 11.8" stroke="#d5d5da" strokeWidth="1.3" strokeLinecap="round" />
          </g>
          {/* legs */}
          <path d="M13.5 25.5 v3 M17 25.5 v3" stroke="#e9e9ec" strokeWidth="1.1" strokeLinecap="round" />
        </g>
        {shown === "annoyed" && (
          <path
            className="bird-vein"
            d="M26.2 2.4 q0.9 0.8 0 1.6 M29 2.4 q-0.9 0.8 0 1.6 M26.8 1.9 q0.8 0.9 1.6 0 M26.8 4.6 q0.8 -0.9 1.6 0"
            stroke="#fff"
            strokeWidth="0.7"
            fill="none"
            strokeLinecap="round"
          />
        )}
        {shown === "dizzy" && (
          <g className="bird-stars">
            <path d="M20.5 0.6 l0.7 1.5 1.5 0.2 -1.1 1 0.3 1.5 -1.4 -0.8 -1.4 0.8 0.3 -1.5 -1.1 -1 1.5 -0.2 Z" fill="#fff" />
            <circle cx="14.6" cy="3.6" r="0.9" fill="#fff" />
            <circle cx="26.4" cy="3.6" r="0.9" fill="#fff" />
          </g>
        )}
      </svg>
      {shown === "sleep" && <span className="bird-z">z</span>}
      {shown === "happy" && <span className="bird-glyph">♪</span>}
      {shown === "proud" && <span className="bird-glyph">✦</span>}
    </span>
  );
}

function Eye({ mood }: { mood: Mood }) {
  if (mood === "sleep") {
    return <path d="M21 10.8 Q22.4 12 23.8 10.8" stroke="#111" strokeWidth="1.1" fill="none" strokeLinecap="round" />;
  }
  if (mood === "proud" || mood === "catch") {
    return <path d="M21 11.6 Q22.4 10 23.8 11.6" stroke="#111" strokeWidth="1.1" fill="none" strokeLinecap="round" />;
  }
  if (mood === "annoyed") {
    // half-closed, unimpressed
    return <path d="M21.2 10.6 a1.2 1.2 0 0 0 2.4 0 Z" fill="#111" />;
  }
  if (mood === "dizzy") {
    return (
      <g className="bird-spiral">
        <path
          d="M22.4 10.9 m0.35 0 a0.35 0.35 0 1 1 -0.7 0 a0.75 0.75 0 1 1 1.5 0.1 a1.2 1.2 0 1 1 -2.3 -0.3"
          stroke="#111"
          strokeWidth="0.55"
          fill="none"
          strokeLinecap="round"
        />
      </g>
    );
  }
  return (
    <g className="bird-eye">
      <circle cx="22.4" cy="10.9" r="1.35" fill="#111" />
      <circle cx="22.85" cy="10.4" r="0.4" fill="#fff" />
    </g>
  );
}
