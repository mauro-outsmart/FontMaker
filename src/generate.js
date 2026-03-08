import { GLYPHS, saveGlyph } from './glyphs.js';

const CANVAS_SIZE = 200;

// --- Public API ---

export function generateAllGlyphs(referenceFont) {
  const entries = [];
  for (const char of GLYPHS) {
    const strokes = generateGlyph(char, referenceFont, CANVAS_SIZE);
    if (strokes.length > 0) {
      entries.push({ char, strokes });
    }
  }
  // Batch save
  for (const { char, strokes } of entries) {
    saveGlyph(char, strokes);
  }
}

function generateGlyph(char, referenceFont, size) {
  const grid = renderCharToBitmap(char, referenceFont, size);

  let hasPixels = false;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i]) { hasPixels = true; break; }
  }
  if (!hasPixels) return [];

  // Extract small round components before thinning (dots get erased by Zhang-Suen)
  const { dotStrokes, remaining } = extractDots(grid, size, size);

  const skeleton = zhangSuenThin(remaining, size, size);

  let strokes = traceSkeletonStrokes(skeleton, size, size);
  strokes = dotStrokes.concat(strokes);
  if (strokes.length === 0) return [];

  // Sort top-to-bottom, left-to-right for natural stroke order
  strokes.sort((a, b) => {
    const aMinY = Math.min(...a.map(p => p.y));
    const bMinY = Math.min(...b.map(p => p.y));
    if (Math.abs(aMinY - bMinY) > 5) return aMinY - bMinY;
    const aMinX = Math.min(...a.map(p => p.x));
    const bMinX = Math.min(...b.map(p => p.x));
    return aMinX - bMinX;
  });

  strokes = normalizeStrokes(strokes, size);
  strokes = humanizeStrokes(strokes, char);
  strokes = addTimingData(strokes);

  return strokes;
}

// --- Step 1: Render character to binary bitmap ---

function renderCharToBitmap(char, font, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const fontSize = size * 0.7;
  ctx.font = `${fontSize}px "${font}"`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, size / 2, size / 2);

  const imageData = ctx.getImageData(0, 0, size, size);
  const grid = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) {
    grid[i] = imageData.data[i * 4 + 3] > 128 ? 1 : 0;
  }
  return grid;
}

// --- Step 1b: Extract small round components (dots) before thinning ---

function floodFill(grid, w, h, sx, sy, visited) {
  const pixels = [];
  const stack = [{ x: sx, y: sy }];
  visited[sy * w + sx] = 1;
  while (stack.length > 0) {
    const { x, y } = stack.pop();
    pixels.push({ x, y });
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (!grid[ny * w + nx] || visited[ny * w + nx]) continue;
        visited[ny * w + nx] = 1;
        stack.push({ x: nx, y: ny });
      }
    }
  }
  return pixels;
}

function extractDots(grid, w, h) {
  const visited = new Uint8Array(w * h);
  const dotStrokes = [];
  const remaining = new Uint8Array(grid);
  const DOT_MAX_PIXELS = Math.round(w * h * 0.008); // ~320 pixels at 200x200

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grid[y * w + x] || visited[y * w + x]) continue;
      const pixels = floodFill(grid, w, h, x, y, visited);
      if (pixels.length > DOT_MAX_PIXELS) continue;

      // Check aspect ratio — dots are roughly circular
      let minX = w, maxX = 0, minY = h, maxY = 0;
      for (const p of pixels) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const ratio = Math.min(bw, bh) / Math.max(bw, bh);
      if (ratio < 0.4) continue; // not a dot, skip (e.g. a dash)

      // Centroid — create a short tap stroke (pen press) instead of a circle
      const cx = pixels.reduce((s, p) => s + p.x, 0) / pixels.length;
      const cy = pixels.reduce((s, p) => s + p.y, 0) / pixels.length;
      dotStrokes.push([
        { x: cx - 0.3, y: cy - 0.3 },
        { x: cx + 0.3, y: cy + 0.3 },
      ]);

      // Remove from remaining bitmap so thinning doesn't touch these pixels
      for (const p of pixels) {
        remaining[p.y * w + p.x] = 0;
      }
    }
  }
  return { dotStrokes, remaining };
}

// --- Step 2: Zhang-Suen thinning ---

function getNeighbors(g, x, y, w) {
  return [
    g[(y - 1) * w + x],       // P2 top
    g[(y - 1) * w + x + 1],   // P3 top-right
    g[y * w + x + 1],         // P4 right
    g[(y + 1) * w + x + 1],   // P5 bottom-right
    g[(y + 1) * w + x],       // P6 bottom
    g[(y + 1) * w + x - 1],   // P7 bottom-left
    g[y * w + x - 1],         // P8 left
    g[(y - 1) * w + x - 1],   // P9 top-left
  ];
}

function transitions(P2, P3, P4, P5, P6, P7, P8, P9) {
  const seq = [P2, P3, P4, P5, P6, P7, P8, P9, P2];
  let count = 0;
  for (let i = 0; i < 8; i++) {
    if (seq[i] === 0 && seq[i + 1] === 1) count++;
  }
  return count;
}

function zhangSuenThin(grid, w, h) {
  const g = new Uint8Array(grid);

  let changed = true;
  while (changed) {
    changed = false;

    // Sub-iteration 1
    const toRemove1 = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!g[y * w + x]) continue;
        const [P2, P3, P4, P5, P6, P7, P8, P9] = getNeighbors(g, x, y, w);
        const B = P2 + P3 + P4 + P5 + P6 + P7 + P8 + P9;
        const A = transitions(P2, P3, P4, P5, P6, P7, P8, P9);
        if (B >= 2 && B <= 6 && A === 1 && (P2 * P4 * P6) === 0 && (P4 * P6 * P8) === 0) {
          toRemove1.push(y * w + x);
        }
      }
    }
    for (const idx of toRemove1) { g[idx] = 0; changed = true; }

    // Sub-iteration 2
    const toRemove2 = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!g[y * w + x]) continue;
        const [P2, P3, P4, P5, P6, P7, P8, P9] = getNeighbors(g, x, y, w);
        const B = P2 + P3 + P4 + P5 + P6 + P7 + P8 + P9;
        const A = transitions(P2, P3, P4, P5, P6, P7, P8, P9);
        if (B >= 2 && B <= 6 && A === 1 && (P2 * P4 * P8) === 0 && (P2 * P6 * P8) === 0) {
          toRemove2.push(y * w + x);
        }
      }
    }
    for (const idx of toRemove2) { g[idx] = 0; changed = true; }
  }

  return g;
}

// --- Step 3: Trace skeleton into stroke paths ---

function neighborCount(g, x, y, w, h) {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && g[ny * w + nx]) count++;
    }
  }
  return count;
}

function traceFrom(g, w, h, sx, sy, visited) {
  const points = [{ x: sx, y: sy }];
  visited[sy * w + sx] = 1;

  let cx = sx, cy = sy;
  // Direction priority: prefer continuing in same direction
  let prevDx = 0, prevDy = 0;

  while (true) {
    let bestDx = 0, bestDy = 0;
    let found = false;

    // Score neighbors: prefer continuing in same direction
    let bestScore = -1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (!g[ny * w + nx] || visited[ny * w + nx]) continue;

        // Score: prefer same direction, then cardinal, then diagonal
        let score = 1;
        if (dx === prevDx && dy === prevDy) score = 4;
        else if (dx * prevDx + dy * prevDy > 0) score = 3;
        if (dx === 0 || dy === 0) score += 0.5; // slight cardinal preference

        if (score > bestScore) {
          bestScore = score;
          bestDx = dx;
          bestDy = dy;
          found = true;
        }
      }
    }

    if (!found) break;

    const nx = cx + bestDx, ny = cy + bestDy;
    visited[ny * w + nx] = 1;
    points.push({ x: nx, y: ny });
    prevDx = bestDx;
    prevDy = bestDy;
    cx = nx;
    cy = ny;

    // Stop at junctions (3+ neighbors among unvisited + current path)
    const nc = neighborCount(g, nx, ny, w, h);
    if (nc >= 3) {
      // Allow junction to be re-visited by other traces
      visited[ny * w + nx] = 0;
      break;
    }
  }

  return points;
}

function subsample(stroke, step) {
  if (stroke.length <= step * 2) return stroke;
  const result = [stroke[0]];
  for (let i = step; i < stroke.length - 1; i += step) {
    result.push(stroke[i]);
  }
  result.push(stroke[stroke.length - 1]);
  return result;
}

function traceSkeletonStrokes(grid, w, h) {
  const visited = new Uint8Array(w * h);
  const strokes = [];

  // Find endpoints (1 neighbor) — natural stroke start/end
  const endpoints = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grid[y * w + x]) continue;
      if (neighborCount(grid, x, y, w, h) === 1) {
        endpoints.push({ x, y });
      }
    }
  }

  // Trace from each endpoint
  for (const ep of endpoints) {
    if (visited[ep.y * w + ep.x]) continue;
    const stroke = traceFrom(grid, w, h, ep.x, ep.y, visited);
    if (stroke.length >= 2) strokes.push(subsample(stroke, 3));
  }

  // Handle remaining loops (unvisited skeleton pixels)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grid[y * w + x] || visited[y * w + x]) continue;
      const stroke = traceFrom(grid, w, h, x, y, visited);
      if (stroke.length >= 2) strokes.push(subsample(stroke, 3));
    }
  }

  // Handle isolated pixels (dots) — create tiny 2-point strokes
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grid[y * w + x] || visited[y * w + x]) continue;
      strokes.push([{ x, y }, { x: x + 0.5, y: y + 0.5 }]);
      visited[y * w + x] = 1;
    }
  }

  return strokes;
}

// --- Step 4: Humanize strokes ---

function makeRng(seed) {
  let state = seed;
  return function rand() {
    state = (state * 16807 + 0) % 2147483647;
    return state / 2147483647;
  };
}

function humanizeStrokes(strokes, char) {
  const rand = makeRng(char.charCodeAt(0) * 7 + 13);

  return strokes.map(stroke => {
    if (stroke.length < 2) return stroke;

    const cx = stroke.reduce((s, p) => s + p.x, 0) / stroke.length;
    const cy = stroke.reduce((s, p) => s + p.y, 0) / stroke.length;

    // Global stroke transform
    const rotation = (rand() * 2 - 1) * 0.015;
    const scaleX = 1.0 + (rand() * 2 - 1) * 0.02;
    const scaleY = 1.0 + (rand() * 2 - 1) * 0.02;
    const translateX = (rand() * 2 - 1) * 0.008;
    const translateY = (rand() * 2 - 1) * 0.008;

    return stroke.map((p, i) => {
      const t = stroke.length <= 1 ? 0 : i / (stroke.length - 1);

      // Apply global rotation + scale around centroid
      let x = p.x - cx;
      let y = p.y - cy;
      const rx = x * Math.cos(rotation) - y * Math.sin(rotation);
      const ry = x * Math.sin(rotation) + y * Math.cos(rotation);
      x = rx * scaleX + cx + translateX;
      y = ry * scaleY + cy + translateY;

      // Per-point jitter (fades at endpoints)
      const edgeFade = Math.sin(t * Math.PI);
      const jitterAmount = 0.006 * edgeFade;
      x += (rand() * 2 - 1) * jitterAmount;
      y += (rand() * 2 - 1) * jitterAmount;

      // Slight overshoot at stroke start/end
      if (i === 0 && stroke.length > 3) {
        const dx = stroke[1].x - stroke[0].x;
        const dy = stroke[1].y - stroke[0].y;
        x -= dx * 0.08 * rand();
        y -= dy * 0.08 * rand();
      }
      if (i === stroke.length - 1 && stroke.length > 3) {
        const dx = stroke[stroke.length - 1].x - stroke[stroke.length - 2].x;
        const dy = stroke[stroke.length - 1].y - stroke[stroke.length - 2].y;
        x += dx * 0.08 * rand();
        y += dy * 0.08 * rand();
      }

      return { x, y };
    });
  });
}

// --- Step 5: Normalize pixel coords to 0-1 ---

function normalizeStrokes(strokes, size) {
  return strokes.map(stroke =>
    stroke.map(p => ({ x: p.x / size, y: p.y / size }))
  );
}

// --- Step 6: Add timing data ---

function addTimingData(strokes) {
  let globalT = 0;
  const GAP_MS = 80;
  const BASE_SPEED = 4;

  return strokes.map((stroke, si) => {
    if (si > 0) globalT += GAP_MS;

    return stroke.map((p, i) => {
      if (i === 0) return { ...p, t: Math.round(globalT) };

      const tNorm = stroke.length <= 1 ? 0 : i / (stroke.length - 1);
      const speedFactor = 0.5 + 0.5 * Math.sin(tNorm * Math.PI);
      const dt = BASE_SPEED / Math.max(0.3, speedFactor);
      globalT += dt;
      return { ...p, t: Math.round(globalT) };
    });
  });
}
