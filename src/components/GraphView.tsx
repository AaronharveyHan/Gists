/**
 * Force-directed relation graph.
 *
 * Nodes:  one per gist (small circle, colored by language group) +
 *         one per tag  (larger circle, colored by tag color).
 * Edges:  gist ↔ tag when the gist has that tag.
 *
 * Physics: custom Euler-integration simulation running in a Web Worker so
 *          the main thread is never blocked, even at 300+ nodes.
 * Pruning: only connected gists are shown; capped at MAX_VISIBLE_NODES total
 *          (highest-degree gists kept first) to maintain interactive frame rates.
 * Rendering: HTML Canvas with DPR-aware scaling.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useGistStore } from "../store/useGistStore";
import { listGistTagPairs } from "../api/tauri";
import type { Gist, Tag } from "../api/tauri";
import { useT } from "../store/useI18nStore";

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
  workerIdx: number; // index in the worker's flat position array
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

// ── Visibility cap ────────────────────────────────────────────────────────────
// At 250 nodes the O(n²) repulsion in the worker is ~31 K pairs — well under
// 1 ms per tick.  Beyond this the simulation stays smooth but the canvas
// render itself starts to slow down.
const MAX_VISIBLE_NODES = 250;

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
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ gists: 0, tags: 0, edges: 0, hidden: 0 });
  const [showAll, setShowAll] = useState(false);

  // Rendering state — all in refs to avoid triggering re-renders in the RAF loop
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const nodesRef     = useRef<SimNode[]>([]);
  const edgesRef     = useRef<SimEdge[]>([]);
  const hoveredRef   = useRef<SimNode | null>(null);
  const selectedRef  = useRef<SimNode | null>(null);
  const draggedRef   = useRef<SimNode | null>(null);
  const dragOffRef   = useRef({ x: 0, y: 0 });
  const panRef       = useRef({ x: 0, y: 0 });
  const panOriginRef = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const isPanningRef = useRef(false);
  const scaleRef     = useRef(1);
  const rafRef       = useRef<number | null>(null);
  const mdPosRef     = useRef({ x: 0, y: 0 });
  const workerRef    = useRef<Worker | null>(null);

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

  // ── Build graph data + spawn/replace worker ────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const build = async () => {
      const pairs = await listGistTagPairs().catch(() => [] as [string, number][]);
      if (cancelled) return;

      // ── Node selection ────────────────────────────────────────────────────
      const connectedGistIds = new Set<string>(pairs.map(([gid]) => gid));
      const connectedTagIds  = new Set<number>(
        pairs.filter(([gid]) => connectedGistIds.has(gid)).map(([, tid]) => tid),
      );

      const visibleTags  = allTags.filter(t => connectedTagIds.has(t.id));
      // "Show all" mode: every gist; "connected" mode: only gists with a tag.
      const candidateGists = showAll ? gists : gists.filter(g => connectedGistIds.has(g.id));

      // If still over cap, keep connected gists first then fill with isolated ones
      // (both sorted by degree so the most-linked appear first).
      let finalGists = candidateGists;
      let hidden = 0;
      if (visibleTags.length + candidateGists.length > MAX_VISIBLE_NODES) {
        const gistDeg = new Map<string, number>();
        for (const [gid] of pairs) gistDeg.set(gid, (gistDeg.get(gid) ?? 0) + 1);
        const gistSlots = Math.max(0, MAX_VISIBLE_NODES - visibleTags.length);
        finalGists = [...candidateGists]
          .sort((a, b) => (gistDeg.get(b.id) ?? 0) - (gistDeg.get(a.id) ?? 0))
          .slice(0, gistSlots);
        hidden = candidateGists.length - finalGists.length;
      }

      // ── Node construction ──────────────────────────────────────────────────
      const tagNodes = new Map<number, SimNode>();
      visibleTags.forEach((tag, idx) => {
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
          workerIdx: idx,
          tagData: tag,
        });
      });

      const tagCount = tagNodes.size;
      const gistNodes = new Map<string, SimNode>();
      finalGists.forEach((g, idx) => {
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
          workerIdx: tagCount + idx,
          gistData: g,
        });
      });

      // ── Edges + seed gist positions near their first tag ──────────────────
      const finalGistIdSet = new Set(finalGists.map(g => g.id));
      const edges: SimEdge[] = [];
      const seededGists = new Set<string>();
      for (const [gistId, tagId] of pairs) {
        const gn = gistNodes.get(gistId);
        const tn = tagNodes.get(tagId);
        if (!gn || !tn || !finalGistIdSet.has(gistId)) continue;
        if (!seededGists.has(gistId)) {
          gn.x = tn.x + (Math.random() - 0.5) * 80;
          gn.y = tn.y + (Math.random() - 0.5) * 80;
          seededGists.add(gistId);
        }
        edges.push({ s: gn, t: tn });
      }

      // ── Scale tag node size by degree ─────────────────────────────────────
      const tagDeg = new Map<number, number>();
      for (const [, tagId] of pairs) tagDeg.set(tagId, (tagDeg.get(tagId) ?? 0) + 1);
      for (const [tagId, deg] of tagDeg) {
        const tn = tagNodes.get(tagId);
        if (tn) tn.r = Math.max(12, Math.min(22, 10 + deg * 1.8));
      }

      if (cancelled) return;

      // Ordered array: tags first (workerIdx 0..tagCount-1), then gists.
      const allNodes: SimNode[] = [
        ...Array.from(tagNodes.values()),
        ...Array.from(gistNodes.values()),
      ];

      nodesRef.current = allNodes;
      edgesRef.current = edges;

      // ── Pack into typed arrays for zero-copy transfer to worker ───────────
      const n = allNodes.length;
      const positions = new Float64Array(n * 4); // [x,y,vx,vy per node]
      const radii     = new Float32Array(n);
      const edgeArr   = new Uint32Array(edges.length * 2);

      allNodes.forEach((node, i) => {
        positions[i * 4]     = node.x;
        positions[i * 4 + 1] = node.y;
        positions[i * 4 + 2] = node.vx;
        positions[i * 4 + 3] = node.vy;
        radii[i] = node.r;
      });
      edges.forEach((e, i) => {
        edgeArr[i * 2]     = e.s.workerIdx;
        edgeArr[i * 2 + 1] = e.t.workerIdx;
      });

      // ── Terminate old worker, spawn new one ───────────────────────────────
      if (workerRef.current) {
        workerRef.current.postMessage({ type: "stop" });
        workerRef.current.terminate();
      }
      const worker = new Worker(
        new URL("../workers/graphSimulation.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent<{ type: string; data: Float64Array }>) => {
        if (e.data.type !== "positions") return;
        const data = e.data.data;
        const nodes = nodesRef.current;
        const dragged = draggedRef.current;
        for (let i = 0; i < nodes.length; i++) {
          // Don't overwrite the node the user is currently dragging —
          // its position is set synchronously in onMouseMove.
          if (nodes[i] === dragged) continue;
          nodes[i].x = data[i * 2];
          nodes[i].y = data[i * 2 + 1];
        }
      };

      // Transfer typed arrays (zero-copy): worker now owns those buffers.
      worker.postMessage(
        { type: "init", nodeCount: n, positions, radii, edges: edgeArr },
        [positions.buffer, radii.buffer, edgeArr.buffer],
      );

      setStats({
        gists: gistNodes.size,
        tags:  tagNodes.size,
        edges: edges.length,
        hidden,
      });
      setLoading(false);
    };

    build();
    return () => {
      cancelled = true;
      if (workerRef.current) {
        workerRef.current.postMessage({ type: "stop" });
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [gists, allTags, showAll]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── RAF render loop (main thread only renders — no physics) ───────────────

  useEffect(() => {
    if (loading) return;

    const loop = () => {
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
      const nx = x - dragOffRef.current.x;
      const ny = y - dragOffRef.current.y;
      draggedRef.current.x  = nx;
      draggedRef.current.y  = ny;
      draggedRef.current.vx = 0;
      draggedRef.current.vy = 0;
      // Tell worker to pin this node at the new position and re-energise.
      workerRef.current?.postMessage({
        type: "drag",
        index: draggedRef.current.workerIdx,
        x: nx,
        y: ny,
      });
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
    if (draggedRef.current) {
      workerRef.current?.postMessage({ type: "dragEnd" });
    }
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
    if (draggedRef.current) {
      workerRef.current?.postMessage({ type: "dragEnd" });
    }
    hoveredRef.current   = null;
    draggedRef.current   = null;
    isPanningRef.current = false;
    setTooltip(null);
  }, []);

  const resetView = useCallback(() => {
    scaleRef.current = 1;
    panRef.current   = { x: 0, y: 0 };
  }, []);

  const relayout = useCallback(() => {
    // Randomise positions in the worker; it will start re-simulating and
    // post updated positions back.  No need to touch nodesRef directly.
    workerRef.current?.postMessage({ type: "relayout" });
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
              {stats.hidden > 0 && (
                <span className="graph-view__stats-hidden" title="Over the 250-node cap; highest-degree gists shown first">
                  {" "}· {stats.hidden} over cap
                </span>
              )}
            </span>
          )}
        </div>
        <div className="graph-view__controls">
          {!loading && (
            <>
              <button
                className={`btn graph-view__toggle${showAll ? " graph-view__toggle--active" : ""}`}
                onClick={() => setShowAll(v => !v)}
                title={showAll ? t.graph.toggleShowAllTitle : t.graph.toggleConnectedTitle}
              >
                {showAll ? t.graph.showAll : t.graph.showConnected}
              </button>
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
              <span>{t.graph.tagNode}</span>
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
