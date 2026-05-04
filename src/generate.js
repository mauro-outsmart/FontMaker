import { GLYPHS, beginBatch, batchSaveGlyph, flushBatch, endBatch } from './glyphs.js';
import { extractContours, chaikin, simplify, fixWinding } from './contour.js';

const CANVAS_SIZE = 100;
const ORIGINAL_SIZE = 300;
const FLUSH_INTERVAL = 20;

// --- Public API ---

export async function generateGlyphsProgressive(referenceFont, chars, onProgress, signal, brushType = 'normal') {
  // Limit to Basic Latin — extended Unicode sets are too slow and overflow storage
  chars = chars.filter(c => { const code = c.codePointAt(0); return code >= 0x21 && code <= 0x7E; });
  const total = chars.length;
  let count = 0;
  beginBatch();
  try {
    for (let i = 0; i < total; i++) {
      if (signal.aborted) {
        endBatch();
        return { completed: false, count };
      }
      const char = chars[i];
      let strokes;
      if (brushType === 'original') {
        strokes = generateOriginalGlyph(char, referenceFont, ORIGINAL_SIZE, 0);
      } else if (brushType === 'original-italic') {
        strokes = generateOriginalGlyph(char, referenceFont, ORIGINAL_SIZE, 10);
      } else {
        strokes = generateGlyph(char, referenceFont, CANVAS_SIZE);
      }
      if (strokes.length > 0) {
        batchSaveGlyph(char, strokes);
        count++;
      }
      // Flush to localStorage periodically
      if ((i + 1) % FLUSH_INTERVAL === 0) {
        try {
          flushBatch();
        } catch (e) {
          endBatch();
          return { completed: false, count, error: 'Storage full — generated ' + count + ' glyphs before running out of space.' };
        }
      }
      onProgress(char, strokes, i, total);
      // Yield to event loop so browser can repaint and process cancel clicks
      await new Promise(r => setTimeout(r, 0));
    }
  } finally {
    try { endBatch(); } catch { /* quota exceeded on final flush */ }
  }
  return { completed: true, count };
}

function generateOriginalGlyph(char, referenceFont, size, italicDeg) {
  const grid = renderCharToBitmap(char, referenceFont, size);

  let hasPixels = false;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i]) { hasPixels = true; break; }
  }
  if (!hasPixels) return [];

  const raw = extractContours(grid, size, size);
  const smoothed = raw
    .map(c => simplify(c, 0.6))
    .filter(c => c.length >= 3)
    .map(c => simplify(chaikin(chaikin(c)), 0.3))
    .filter(c => c.length >= 3);
  const wound = fixWinding(smoothed);

  // Italic shear pivoted at the vertical center keeps the glyph roughly
  // in place — top moves right, bottom moves left.
  const shear = italicDeg ? Math.tan(italicDeg * Math.PI / 180) : 0;

  let globalT = 0;
  return wound.map((contour) => {
    const stroke = contour.map((p, i) => {
      if (i > 0) globalT += 1;
      const ny = p.y / size;
      const nx = p.x / size + shear * (0.5 - ny);
      return { x: nx, y: ny, t: Math.round(globalT) };
    });
    globalT += 40;
    return stroke;
  });
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
  let iterations = 0;
  const MAX_ITERATIONS = 100;
  while (changed && iterations < MAX_ITERATIONS) {
    changed = false;
    iterations++;

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

    // Stop at junctions; let other traces handle remaining branches
    const nc = neighborCount(g, nx, ny, w, h);
    if (nc >= 3) {
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

// Drop tiny stroke fragments — short serif nubs and noise produced at junctions
const MIN_STROKE_PX = 5;

function pushIfLongEnough(strokes, stroke) {
  if (stroke.length < MIN_STROKE_PX) return;
  strokes.push(subsample(stroke, 4));
}

function traceSkeletonStrokes(grid, w, h) {
  const visited = new Uint8Array(w * h);
  const rawStrokes = [];

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

  // Trace from each endpoint, then loops
  for (const ep of endpoints) {
    if (visited[ep.y * w + ep.x]) continue;
    const s = traceFrom(grid, w, h, ep.x, ep.y, visited);
    if (s.length >= 2) rawStrokes.push(s);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grid[y * w + x] || visited[y * w + x]) continue;
      const s = traceFrom(grid, w, h, x, y, visited);
      if (s.length >= 2) rawStrokes.push(s);
    }
  }
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] && !visited[i]) visited[i] = 1;
  }

  // Merge fragments that meet at the same junction with aligned tangents.
  // This produces fewer, longer strokes — fonts like Playfair stop dropping
  // into a heap of tiny fragments around serifs.
  const merged = mergeAlignedAtJunctions(rawStrokes);

  // Drop noise nubs and subsample what's left.
  const result = [];
  for (const s of merged) {
    if (s.length < MIN_STROKE_PX) continue;
    result.push(subsample(s, 4));
  }
  return result;
}

function endpointDir(stroke, atStart) {
  // Tangent direction pointing AWAY from the endpoint (into the stroke).
  const k = Math.min(3, stroke.length - 1);
  const a = atStart ? stroke[0] : stroke[stroke.length - 1];
  const b = atStart ? stroke[k] : stroke[stroke.length - 1 - k];
  const dx = b.x - a.x, dy = b.y - a.y;
  const m = Math.hypot(dx, dy) || 1;
  return { dx: dx / m, dy: dy / m };
}

function mergeAlignedAtJunctions(strokes) {
  // Group strokes by each endpoint location; if two ends meet at the same
  // pixel and their incoming tangents are roughly opposite (the strokes form
  // a smooth continuation), splice them together.
  const ALIGN_DOT = -0.5; // -1 = perfectly opposite, > -0.5 = too sharp a kink
  const out = strokes.map(s => s.slice());

  let didMerge = true;
  while (didMerge) {
    didMerge = false;
    outer:
    for (let i = 0; i < out.length; i++) {
      const si = out[i];
      if (!si) continue;
      for (let j = i + 1; j < out.length; j++) {
        const sj = out[j];
        if (!sj) continue;

        // Test the four endpoint pairings: (i.start|end) × (j.start|end)
        const ends = [
          { ai: 0, aj: 0, joinAt: 'startStart' },
          { ai: 0, aj: sj.length - 1, joinAt: 'startEnd' },
          { ai: si.length - 1, aj: 0, joinAt: 'endStart' },
          { ai: si.length - 1, aj: sj.length - 1, joinAt: 'endEnd' },
        ];
        for (const e of ends) {
          const pi = si[e.ai], pj = sj[e.aj];
          if (Math.abs(pi.x - pj.x) > 1.5 || Math.abs(pi.y - pj.y) > 1.5) continue;
          const di = endpointDir(si, e.ai === 0);
          const dj = endpointDir(sj, e.aj === 0);
          // Tangents both point INTO their stroke; for a smooth join, they
          // should be opposite (dot ~ -1).
          const dot = di.dx * dj.dx + di.dy * dj.dy;
          if (dot > ALIGN_DOT) continue;

          // Build merged stroke with si then sj, reversing where needed
          let a = si, b = sj;
          if (e.joinAt === 'startStart') a = si.slice().reverse();
          else if (e.joinAt === 'startEnd') { a = si.slice().reverse(); b = sj.slice().reverse(); }
          else if (e.joinAt === 'endEnd') b = sj.slice().reverse();
          // endStart: keep both as-is
          out[i] = a.concat(b.slice(1));
          out[j] = null;
          didMerge = true;
          continue outer;
        }
      }
    }
  }
  return out.filter(Boolean);
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

      // Per-point jitter (fades at endpoints) — kept very small so strokes
      // read as smooth, not noisy
      const edgeFade = Math.sin(t * Math.PI);
      const jitterAmount = 0.0025 * edgeFade;
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
