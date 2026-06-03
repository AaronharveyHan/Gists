/// <reference lib="webworker" />

// Force-simulation Web Worker.
// Receives typed messages, ticks physics off the main thread,
// and posts x/y position arrays back at ~60 fps until settled.

const K_REPEL         = 3000;
const K_SPRING        = 0.032;
const REST_BASE       = 90;
const K_GRAVITY       = 0.002;
const DAMPING         = 0.77;
const TICKS_PER_BATCH = 6;
const MAX_ITER        = 450;

// pos layout: [x, y, vx, vy] per node  (stride 4, index with i << 2)
let pos: Float64Array;
let radii: Float32Array;
let edges: Uint32Array; // [si, ti] pairs
let nodeCount = 0;
let iter = 0;
let running = false;
let loopActive = false;

let dragIndex = -1;
let dragX = 0;
let dragY = 0;

function tick() {
  // O(n²) pairwise repulsion with squared-distance cutoff (avoids sqrt most loops)
  for (let i = 0; i < nodeCount; i++) {
    const ix = i << 2;
    for (let j = i + 1; j < nodeCount; j++) {
      const jx = j << 2;
      const dx = pos[jx]     - pos[ix];
      const dy = pos[jx + 1] - pos[ix + 1];
      const d2 = dx * dx + dy * dy || 0.001;
      const cutoff = (radii[i] + radii[j]) * 4;
      if (d2 < cutoff * cutoff) {
        const d  = Math.sqrt(d2);
        const f  = K_REPEL / d2;
        const fx = (f * dx) / d;
        const fy = (f * dy) / d;
        pos[ix + 2] -= fx;  pos[ix + 3] -= fy;
        pos[jx + 2] += fx;  pos[jx + 3] += fy;
      }
    }
  }
  // Spring forces along edges
  for (let e = 0; e < edges.length; e += 2) {
    const si = edges[e], ti = edges[e + 1];
    const sx = si << 2, tx = ti << 2;
    const dx  = pos[tx]     - pos[sx];
    const dy  = pos[tx + 1] - pos[sx + 1];
    const d   = Math.sqrt(dx * dx + dy * dy) || 0.001;
    const rest = REST_BASE + radii[si] + radii[ti];
    const f   = K_SPRING * (d - rest);
    const fx  = (f * dx) / d;
    const fy  = (f * dy) / d;
    pos[sx + 2] += fx;  pos[sx + 3] += fy;
    pos[tx + 2] -= fx;  pos[tx + 3] -= fy;
  }
  // Gravity toward origin + damping + Euler integration
  for (let i = 0; i < nodeCount; i++) {
    const ix = i << 2;
    pos[ix + 2] = (pos[ix + 2] - pos[ix]     * K_GRAVITY) * DAMPING;
    pos[ix + 3] = (pos[ix + 3] - pos[ix + 1] * K_GRAVITY) * DAMPING;
    pos[ix]     += pos[ix + 2];
    pos[ix + 1] += pos[ix + 3];
  }
  // Pin dragged node
  if (dragIndex >= 0) {
    const di = dragIndex << 2;
    pos[di]     = dragX;  pos[di + 1] = dragY;
    pos[di + 2] = 0;      pos[di + 3] = 0;
  }
}

function postPositions() {
  const out = new Float64Array(nodeCount * 2);
  for (let i = 0; i < nodeCount; i++) {
    out[i * 2]     = pos[i << 2];
    out[i * 2 + 1] = pos[(i << 2) + 1];
  }
  // Transfer ownership — zero-copy; `out` is unusable after this call.
  postMessage({ type: "positions", data: out }, [out.buffer]);
}

function runBatch() {
  loopActive = false;
  if (!running) return;

  const needsTick = iter < MAX_ITER || dragIndex >= 0;
  if (!needsTick) return; // settled; loop stops until drag/relayout restarts it

  const n = iter < MAX_ITER ? TICKS_PER_BATCH : 1; // keep alive during drag
  for (let t = 0; t < n; t++) tick();
  if (iter < MAX_ITER) iter += n;

  postPositions();

  loopActive = true;
  // setTimeout(0) yields to the message loop so drag/relayout events are
  // processed between batches, then resumes immediately.
  setTimeout(runBatch, 0);
}

function ensureLoop() {
  if (loopActive || !running) return;
  loopActive = true;
  setTimeout(runBatch, 0);
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as {
    type: string;
    nodeCount?: number;
    positions?: Float64Array;
    radii?: Float32Array;
    edges?: Uint32Array;
    index?: number;
    x?: number;
    y?: number;
  };

  switch (msg.type) {
    case "init":
      pos       = msg.positions!;
      radii     = msg.radii!;
      edges     = msg.edges!;
      nodeCount = msg.nodeCount!;
      iter      = 0;
      running   = true;
      dragIndex = -1;
      loopActive = false;
      ensureLoop();
      break;

    case "drag":
      dragIndex = msg.index!;
      dragX     = msg.x!;
      dragY     = msg.y!;
      iter      = 0; // re-energise so neighbours re-settle around moved node
      ensureLoop();
      break;

    case "dragEnd":
      dragIndex = -1;
      break;

    case "relayout":
      for (let i = 0; i < nodeCount; i++) {
        const ix = i << 2;
        pos[ix]     = (Math.random() - 0.5) * 400;
        pos[ix + 1] = (Math.random() - 0.5) * 400;
        pos[ix + 2] = 0;
        pos[ix + 3] = 0;
      }
      iter = 0;
      ensureLoop();
      break;

    case "stop":
      running = false;
      break;
  }
};
