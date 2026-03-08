import { drawStroke } from './brushes.js';

export const TRACE_SIZE = 1000;

export function glyphToContours(strokes, strokeWidth, brushType = 'normal') {
  if (!strokes || strokes.length === 0) return [];

  const { grid, width, height } = renderToGrid(strokes, strokeWidth, brushType);
  const rawContours = extractContours(grid, width, height);

  const simplified = rawContours
    .map(c => simplify(c, 1.0))
    .filter(c => c.length >= 3);

  // Chaikin subdivision to smooth out staircase artifacts from marching squares,
  // then a light simplification pass to keep point count manageable
  const smoothed = simplified
    .map(c => simplify(chaikin(chaikin(c)), 0.4))
    .filter(c => c.length >= 3);

  // Fix winding for TrueType non-zero fill rule.
  // Marching squares traces all contours CW in pixel coords.
  // After Y-flip in font-export, they all become CCW.
  // TrueType needs: outer contours CW, holes CCW (in font Y-up coords).
  // So: reverse outer contours (even nesting depth), leave holes as-is.
  return fixWinding(smoothed);
}

function fixWinding(contours) {
  // Determine nesting: count how many other contours contain each one
  const nesting = contours.map(() => 0);

  for (let i = 0; i < contours.length; i++) {
    const testPoint = contours[i][0];
    for (let j = 0; j < contours.length; j++) {
      if (i === j) continue;
      if (isPointInContour(testPoint, contours[j])) {
        nesting[i]++;
      }
    }
  }

  // Even nesting = outer contour → reverse (becomes CW after Y-flip)
  // Odd nesting = hole → leave as-is (stays CCW after Y-flip)
  return contours.map((c, i) =>
    nesting[i] % 2 === 0 ? [...c].reverse() : c
  );
}

function isPointInContour(point, contour) {
  let inside = false;
  const { x, y } = point;

  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    const xi = contour[i].x, yi = contour[i].y;
    const xj = contour[j].x, yj = contour[j].y;

    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

function renderToGrid(strokes, strokeWidth, brushType) {
  const size = TRACE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const lw = strokeWidth * (size / 200);
  ctx.strokeStyle = '#fff';

  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    drawStroke(ctx, stroke, lw, brushType, 0, 0, size, size);
  }

  const imageData = ctx.getImageData(0, 0, size, size);
  const grid = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) {
    grid[i] = imageData.data[i * 4 + 3] > 128 ? 1 : 0;
  }

  return { grid, width: size, height: size };
}

// Marching squares edge table
// Edges: 0=top, 1=right, 2=bottom, 3=left
// For each case: entry edge → exit edge
const EDGES = [];
EDGES[0] = null;
EDGES[1] = { 3: 2, 2: 3 };
EDGES[2] = { 2: 1, 1: 2 };
EDGES[3] = { 3: 1, 1: 3 };
EDGES[4] = { 0: 1, 1: 0 };
EDGES[5] = { 0: 1, 1: 0, 3: 2, 2: 3 };
EDGES[6] = { 0: 2, 2: 0 };
EDGES[7] = { 3: 0, 0: 3 };
EDGES[8] = { 0: 3, 3: 0 };
EDGES[9] = { 0: 2, 2: 0 };
EDGES[10] = { 3: 0, 0: 3, 2: 1, 1: 2 };
EDGES[11] = { 0: 1, 1: 0 };
EDGES[12] = { 3: 1, 1: 3 };
EDGES[13] = { 1: 2, 2: 1 };
EDGES[14] = { 2: 3, 3: 2 };
EDGES[15] = null;

const EDGE_MID = [
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5],
];

const NEIGHBOR = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

const OPPOSITE = [2, 3, 0, 1];

function getCase(grid, x, y, w, h) {
  const g = (px, py) =>
    px >= 0 && py >= 0 && px < w && py < h ? grid[py * w + px] : 0;
  return (g(x, y) << 3) | (g(x + 1, y) << 2) | (g(x + 1, y + 1) << 1) | g(x, y + 1);
}

function extractContours(grid, w, h) {
  const contours = [];
  const visited = new Set();

  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const c = getCase(grid, x, y, w, h);
      if (!EDGES[c]) continue;

      for (const entryStr of Object.keys(EDGES[c])) {
        const entry = parseInt(entryStr);
        const key = `${x},${y},${entry}`;
        if (visited.has(key)) continue;

        const contour = trace(grid, w, h, x, y, entry, visited);
        if (contour.length >= 3) contours.push(contour);
      }
    }
  }

  return contours;
}

function trace(grid, w, h, sx, sy, sEntry, visited) {
  const pts = [];
  let cx = sx, cy = sy, entry = sEntry;
  let limit = w * h;

  do {
    const c = getCase(grid, cx, cy, w, h);
    const table = EDGES[c];
    if (!table || !(entry in table)) break;

    const exit = table[entry];
    visited.add(`${cx},${cy},${entry}`);
    visited.add(`${cx},${cy},${exit}`);

    const [mx, my] = EDGE_MID[exit];
    pts.push({ x: cx + mx, y: cy + my });

    const [nx, ny] = NEIGHBOR[exit];
    cx += nx;
    cy += ny;
    entry = OPPOSITE[exit];

    if (--limit <= 0) break;
  } while (cx !== sx || cy !== sy || entry !== sEntry);

  return pts;
}

function chaikin(pts) {
  if (pts.length < 3) return pts;
  const n = pts.length;

  // Detect sharp corners by comparing incoming/outgoing direction vectors
  const isCorner = pts.map((_, i) => {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
    const len1 = Math.hypot(dx1, dy1);
    const len2 = Math.hypot(dx2, dy2);
    if (len1 === 0 || len2 === 0) return false;
    const dot = (dx1 * dx2 + dy1 * dy2) / (len1 * len2);
    return dot < 0.5; // turning angle > ~60 degrees
  });

  const result = [];
  for (let i = 0; i < n; i++) {
    const curr = pts[i];
    const next = pts[(i + 1) % n];

    if (isCorner[i]) {
      result.push(curr);
    } else {
      result.push({ x: 0.75 * curr.x + 0.25 * next.x, y: 0.75 * curr.y + 0.25 * next.y });
    }

    if (!isCorner[(i + 1) % n]) {
      result.push({ x: 0.25 * curr.x + 0.75 * next.x, y: 0.25 * curr.y + 0.75 * next.y });
    }
  }
  return result;
}

function simplify(pts, tol) {
  if (pts.length <= 2) return pts;

  let maxD = 0, maxI = 0;
  const a = pts[0], b = pts[pts.length - 1];

  for (let i = 1; i < pts.length - 1; i++) {
    const d = pDist(pts[i], a, b);
    if (d > maxD) { maxD = d; maxI = i; }
  }

  if (maxD > tol) {
    const l = simplify(pts.slice(0, maxI + 1), tol);
    const r = simplify(pts.slice(maxI), tol);
    return l.slice(0, -1).concat(r);
  }
  return [a, b];
}

function pDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const sq = dx * dx + dy * dy;
  if (sq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / sq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
