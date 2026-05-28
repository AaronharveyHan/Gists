/**
 * Force-directed relation graph.
 *
 * Nodes:  one per gist (small circle, colored by language group) +
 *         one per tag  (larger circle, colored by tag color).
 * Edges:  gist ↔ tag when the gist has that tag.
 *
 * Physics: custom Euler-integration force simulation (no extra deps).
 * Rendering: HTML Canvas with DPR-aware scaling.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useGistStore } from "../store/useGistStore";
import { listGistTagPairs } from "../api/tauri";
import type { Gist, Tag } from "../api/tauri";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SimNode {
  id: string;
  type: "gist" | "tag";
  label: string;
  sublabel: string;
  color: string;
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gistData?: Gist;
  tagData?: Tag;
}

interface SimEdge {
  s: SimNode;
  t: SimNode;
}

// ── Color maps ────────────────────────────────────────────────────────────────

const LANG_COLORS: Record<string, string> = {
  web:       "#3178c6",
  systems:   "#dea584",
  scripting: "#3fb950",
  data:      "#f5a623",
  docs:      "#58a6ff",
  other:     "#6e7681",
};

const CAT_COLORS: Record<string, string> = {
  config:   "#f5a623",
  script:   "#3fb950",
  document: "#58a6ff",
  multi:    "#9f7aea",
  library:  "#3178c6",
  test:     "#f85149",
  snippet:  "#6e7681",
  data:     "#e08a1e",
  media:    "#c9a227",
  gist:     "#8b949e",
};

function nodeColor(g: Gist): string {
  if (g.lang_group && LANG_COLORS[g.lang_group]) return LANG_COLORS[g.lang_group];
  if (g.category && CAT_COLORS[g.category])       return CAT_COLORS[g.category];
  return LANG_COLORS.other;
}

// ── Force simulation ──────────────────────────────────────────────────────────

const K_REPEL   = 3000;
const K_SPRING  = 0.032;
const REST_BASE = 90;
const K_GRAVITY = 0.002;
const DAMPING   = 0.77;

function tick(nodes: SimNode[], edges: SimEdge[]) {
  // Pairwise repulsion (Barnes–Hut would help at 500+ nodes; at ~200 this is fine)
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy || 0.001;
      const d  = Math.sqrt(d2);
      const cutoff = (a.r + b.r) * 4;
      if (d < cutoff) {
        const f  = K_REPEL / d2;
        const fx = (f * dx) / d;
        const fy = (f * dy) / d;
        a.vx -= fx;  a.vy -= fy;
        b.vx += fx;  b.vy += fy;
      }
    }
  }

  // Spring forces along edges
  for (const e of edges) {
    const dx  = e.t.x - e.s.x;
    const dy  = e.t.y - e.s.y;
    const d   = Math.sqrt(dx * dx + dy * dy) || 0.001;
    const rest = REST_BASE + e.s.r + e.t.r;
    const f   = K_SPRING * (d - rest);
    const fx  = (f * dx) / d;
    const fy  = (f * dy) / d;
    e.s.vx += fx;  e.s.vy += fy;
    e.t.vx -= fx;  e.t.vy -= fy;
  }

  // Gravity toward origin + damping + Euler integration
  for (const n of nodes) {
    n.vx = (n.vx - n.x * K_GRAVITY) * DAMPING;
    n.vy = (n.vy - n.y * K_GRAVITY) * DAMPING;
    n.x += n.vx;
    n.y += n.vy;
  }
}

// ── Canvas renderer ───────────────────────────────────────────────────────────

function render(
  canvas: HTMLCanvasElement,
  nodes: SimNode[],
  edges: SimEdge[],
  hovered: SimNode | null,
  selected: SimNode | null,
  pan: { x: number; y: number },
  scale: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w   = canvas.clientWidth;
  const h   = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.translate(w / 2 + pan.x, h / 2 + pan.y);
  ctx.scale(scale, scale);

  // Collect connected node IDs for the hovered node (for dimming)
  const adjacent = new Set<string>();
  if (hovered) {
    adjacent.add(hovered.id);
    for (const e of edges) {
      if (e.s === hovered) adjacent.add(e.t.id);
      if (e.t === hovered) adjacent.add(e.s.id);
    }
  }

  const dimming = hovered !== null;

  // ── Edges ──
  for (const e of edges) {
    const hl = hovered && (e.s === hovered || e.t === hovered);
    ctx.beginPath();
    ctx.moveTo(e.s.x, e.s.y);
    ctx.lineTo(e.t.x, e.t.y);
    ctx.strokeStyle = hl
      ? "rgba(88,166,255,0.75)"
      : dimming && (!adjacent.has(e.s.id) || !adjacent.has(e.t.id))
      ? "rgba(48,54,61,0.15)"
      : "rgba(48,54,61,0.65)";
    ctx.lineWidth = (hl ? 1.5 : 0.8) / scale;
    ctx.stroke();
  }

  // ── Nodes (draw in order: regular → connected → hovered/selected) ──
  const sorted = nodes.slice().sort((a, b) => {
    const rank = (n: SimNode) =>
      n === selected ? 3 : n === hovered ? 2 : adjacent.has(n.id) ? 1 : 0;
    return rank(a) - rank(b);
  });

  for (const n of sorted) {
    const isHov = n === hovered;
    const isSel = n === selected;
    const dim   = dimming && !adjacent.has(n.id) && !isSel;

    ctx.globalAlpha = dim ? 0.2 : 1;

    // Glow ring
    if (isHov || isSel) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 5 / scale, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? "rgba(255,255,255,0.12)" : "rgba(88,166,255,0.18)";
      ctx.fill();
    }

    // Body
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = n.color;
    ctx.fill();

    // Border
    ctx.strokeStyle = isSel
      ? "#ffffff"
      : isHov
      ? "rgba(255,255,255,0.8)"
      : n.type === "tag"
      ? "rgba(255,255,255,0.25)"
      : "rgba(255,255,255,0.08)";
    ctx.lineWidth = (isSel ? 2 : 1) / scale;
    ctx.stroke();

    // Label (skip when zoomed out too far)
    if (scale >= 0.35) {
      const fs = Math.max(8, (n.type === "tag" ? 11 : 9) / scale);
      ctx.font        = `${n.type === "tag" ? "600 " : ""}${fs}px -apple-system,BlinkMacSystemFont,sans-serif`;
      ctx.fillStyle   = dim ? "rgba(110,118,129,0.3)" : n.type === "tag" ? "#e6edf3" : "#8b949e";
      ctx.textAlign   = "center";
      ctx.textBaseline = "top";

      const maxPx = n.r * 3.5;
      let label = n.label;
      while (label.length > 2 && ctx.measureText(label).width > maxPx) {
        label = label.slice(0, -1);
      }
      if (label !== n.label) label += "…";
      ctx.fillText(label, n.x, n.y + n.r + 3 / scale);
    }

    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// ── Component ─────────────────────────────────────────────────────────────────

const LEGEND_ITEMS = Object.entries(LANG_COLORS).map(([k, c]) => ({
  key:   k,
  color: c,
  label: k.charAt(0).toUpperCase() + k.slice(1),
}));

export function GraphView({
  onClose,
  onSelectGist,
}: {
  onClose: () => void;
  onSelectGist: (id: string) => void;
}) {
  const { gists, allTags } = useGistStore();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ gists: 0, tags: 0, edges: 0 });

  // Rendering state — all in refs to avoid triggering re-renders in the RAF loop
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const nodesRef    = useRef<SimNode[]>([]);
  const edgesRef    = useRef<SimEdge[]>([]);
  const hoveredRef  = useRef<SimNode | null>(null);
  const selectedRef = useRef<SimNode | null>(null);
  const draggedRef  = useRef<SimNode | null>(null);
  const dragOffRef  = useRef({ x: 0, y: 0 });
  const panRef      = useRef({ x: 0, y: 0 });
  const panOriginRef = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const isPanningRef = useRef(false);
  const scaleRef    = useRef(1);
  const rafRef      = useRef<number | null>(null);
  const iterRef     = useRef(0);
  const MAX_ITER    = 450;
  // Track mousedown position to distinguish click vs drag
  const mdPosRef    = useRef({ x: 0, y: 0 });

  const [tooltip, setTooltip] = useState<{
    x: number; y: number; node: SimNode;
  } | null>(null);

  // World ↔ canvas helpers
  const toWorld = useCallback((cx: number, cy: number) => {
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    return {
      x: (cx - rect.left  - w / 2 - panRef.current.x) / scaleRef.current,
      y: (cy - rect.top   - h / 2 - panRef.current.y) / scaleRef.current,
    };
  }, []);

  const hitTest = useCallback((wx: number, wy: number): SimNode | null => {
    const nodes = nodesRef.current;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = wx - n.x;
      const dy = wy - n.y;
      if (dx * dx + dy * dy <= (n.r + 4) * (n.r + 4)) return n;
    }
    return null;
  }, []);

  // ── Build graph data ───────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const build = async () => {
      const pairs = await listGistTagPairs().catch(() => [] as [string, number][]);
      if (cancelled) return;

      // Map tag id → node
      const tagNodes = new Map<number, SimNode>();
      for (const tag of allTags) {
        tagNodes.set(tag.id, {
          id: `tag-${tag.id}`,
          type: "tag",
          label: tag.name,
          sublabel: "tag",
          color: tag.color,
          r: 13,
          x: (Math.random() - 0.5) * 180,
          y: (Math.random() - 0.5) * 180,
          vx: 0, vy: 0,
          tagData: tag,
        });
      }

      // Map gist id → node
      const gistNodes = new Map<string, SimNode>();
      for (const g of gists) {
        const r = Math.max(7, Math.min(13, 6 + g.files.length * 1.5));
        gistNodes.set(g.id, {
          id: `gist-${g.id}`,
          type: "gist",
          label: g.description || g.files[0]?.filename || g.id.slice(0, 8),
          sublabel: g.files[0]?.language ?? "",
          color: nodeColor(g),
          r,
          x: (Math.random() - 0.5) * 500,
          y: (Math.random() - 0.5) * 500,
          vx: 0, vy: 0,
          gistData: g,
        });
      }

      // Build edges + seed gist positions near their tags
      const edges: SimEdge[] = [];
      for (const [gistId, tagId] of pairs) {
        const gn = gistNodes.get(gistId);
        const tn = tagNodes.get(tagId);
        if (!gn || !tn) continue;
        if (edges.length === 0 || edges[edges.length - 1].s !== gn || edges[edges.length - 1].t !== tn) {
          // Only seed position on the first edge for this gist
          if (!edges.some((e) => e.s === gn)) {
            gn.x = tn.x + (Math.random() - 0.5) * 80;
            gn.y = tn.y + (Math.random() - 0.5) * 80;
          }
        }
        edges.push({ s: gn, t: tn });
      }

      // Scale tag node size by degree
      const tagDeg = new Map<number, number>();
      for (const [, tagId] of pairs) tagDeg.set(tagId, (tagDeg.get(tagId) ?? 0) + 1);
      for (const [tagId, deg] of tagDeg) {
        const tn = tagNodes.get(tagId);
        if (tn) tn.r = Math.max(12, Math.min(22, 10 + deg * 1.8));
      }

      if (cancelled) return;

      nodesRef.current = [
        ...Array.from(tagNodes.values()),
        ...Array.from(gistNodes.values()),
      ];
      edgesRef.current = edges;
      iterRef.current  = 0;

      setStats({
        gists: gistNodes.size,
        tags:  tagNodes.size,
        edges: edges.length,
      });
      setLoading(false);
    };

    build();
    return () => { cancelled = true; };
  }, [gists, allTags]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Animation loop ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (loading) return;

    const loop = () => {
      if (iterRef.current < MAX_ITER) {
        tick(nodesRef.current, edgesRef.current);
        iterRef.current++;
      }
      const canvas = canvasRef.current;
      if (canvas) {
        render(
          canvas,
          nodesRef.current,
          edgesRef.current,
          hoveredRef.current,
          selectedRef.current,
          panRef.current,
          scaleRef.current,
        );
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [loading]);

  // ── Wheel zoom (passive: false required to prevent scroll) ────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      scaleRef.current = Math.max(0.08, Math.min(8, scaleRef.current * factor));
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, [loading]);

  // ── Mouse handlers ─────────────────────────────────────────────────────────

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    mdPosRef.current = { x: e.clientX, y: e.clientY };
    const { x, y } = toWorld(e.clientX, e.clientY);
    const hit = hitTest(x, y);
    if (hit) {
      draggedRef.current = hit;
      dragOffRef.current = { x: x - hit.x, y: y - hit.y };
    } else {
      isPanningRef.current = true;
      panOriginRef.current = {
        mx: e.clientX,
        my: e.clientY,
        px: panRef.current.x,
        py: panRef.current.y,
      };
    }
  }, [toWorld, hitTest]);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = toWorld(e.clientX, e.clientY);

    if (draggedRef.current) {
      draggedRef.current.x  = x - dragOffRef.current.x;
      draggedRef.current.y  = y - dragOffRef.current.y;
      draggedRef.current.vx = 0;
      draggedRef.current.vy = 0;
      iterRef.current = 0; // Re-energise simulation
      setTooltip(null);
      return;
    }

    if (isPanningRef.current) {
      const o = panOriginRef.current;
      panRef.current = {
        x: o.px + (e.clientX - o.mx),
        y: o.py + (e.clientY - o.my),
      };
      setTooltip(null);
      return;
    }

    const hit = hitTest(x, y);
    hoveredRef.current = hit;
    if (hit) {
      const rect = canvasRef.current!.getBoundingClientRect();
      setTooltip({ x: e.clientX - rect.left + 14, y: e.clientY - rect.top + 14, node: hit });
    } else {
      setTooltip(null);
    }
  }, [toWorld, hitTest]);

  const onMouseUp = useCallback(() => {
    draggedRef.current  = null;
    isPanningRef.current = false;
  }, []);

  const onClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const dx = e.clientX - mdPosRef.current.x;
    const dy = e.clientY - mdPosRef.current.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) return; // was a drag

    const { x, y } = toWorld(e.clientX, e.clientY);
    const hit = hitTest(x, y);
    selectedRef.current = hit ?? null;

    if (hit?.type === "gist" && hit.gistData) {
      if (e.detail === 2) {
        onSelectGist(hit.gistData.id);
      }
    }
  }, [toWorld, hitTest, onSelectGist]);

  const onMouseLeave = useCallback(() => {
    hoveredRef.current   = null;
    draggedRef.current   = null;
    isPanningRef.current = false;
    setTooltip(null);
  }, []);

  const resetView = useCallback(() => {
    scaleRef.current  = 1;
    panRef.current    = { x: 0, y: 0 };
  }, []);

  const relayout = useCallback(() => {
    for (const n of nodesRef.current) {
      n.x = (Math.random() - 0.5) * 400;
      n.y = (Math.random() - 0.5) * 400;
      n.vx = 0;
      n.vy = 0;
    }
    iterRef.current = 0;
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="graph-view">
      <div className="graph-view__head">
        <div className="graph-view__title">
          <span className="graph-view__title-text">Relation Graph</span>
          {!loading && (
            <span className="graph-view__stats">
              {stats.gists} gists · {stats.tags} tags · {stats.edges} connections
            </span>
          )}
        </div>
        <div className="graph-view__controls">
          {!loading && (
            <>
              <button className="btn" onClick={resetView} title="Reset zoom & pan">
                Reset view
              </button>
              <button className="btn" onClick={relayout} title="Randomise and re-simulate">
                Re-layout
              </button>
            </>
          )}
          <button className="btn" onClick={onClose}>✕ Close</button>
        </div>
      </div>

      {loading ? (
        <div className="graph-view__loading">Building graph…</div>
      ) : (
        <div className="graph-view__body">
          <canvas
            ref={canvasRef}
            className="graph-view__canvas"
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onClick={onClick}
            onMouseLeave={onMouseLeave}
          />

          {/* Tooltip */}
          {tooltip && (
            <div
              className="graph-view__tooltip"
              style={{ left: tooltip.x, top: tooltip.y }}
            >
              <div className="graph-view__tt-name">{tooltip.node.label}</div>
              {tooltip.node.sublabel && (
                <div className="graph-view__tt-sub">{tooltip.node.sublabel}</div>
              )}
              {tooltip.node.type === "gist" && (
                <div className="graph-view__tt-hint">Double-click to open</div>
              )}
            </div>
          )}

          {/* Legend */}
          <div className="graph-view__legend">
            <div className="graph-view__legend-head">Language groups</div>
            {LEGEND_ITEMS.map((item) => (
              <div key={item.key} className="graph-view__legend-row">
                <span
                  className="graph-view__legend-dot"
                  style={{ background: item.color }}
                />
                <span>{item.label}</span>
              </div>
            ))}
            <div className="graph-view__legend-divider" />
            <div className="graph-view__legend-row">
              <span className="graph-view__legend-dot graph-view__legend-dot--tag" />
              <span>Tag node</span>
            </div>
            <div className="graph-view__legend-tip">
              Scroll → zoom<br />
              Drag node → move<br />
              Double-click → open
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
