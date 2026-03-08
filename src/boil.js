export const BOIL_FRAMES = 4;
const BOIL_INTENSITY = 0.007; // Reduced fraction for gentler deformation

// Cache for generated frames to avoid re-computing them on every frame
const boilCache = {};

/**
 * Normalizes strokes array to a string to detect if underlying strokes changed
 */
function getStrokesHash(strokes) {
  if (!strokes || strokes.length === 0) return '';
  return JSON.stringify(strokes);
}

/**
 * Given the original strokes (array of point arrays {x, y} scaled 0-1),
 * generates an array of slightly mutated stroke sets.
 */
export function getBoilFrames(char, strokes) {
  if (!strokes || strokes.length === 0) return [[]];

  const hash = getStrokesHash(strokes);
  const cached = boilCache[char];

  if (cached && cached.hash === hash && cached.frames && cached.frames.length === BOIL_FRAMES) {
    return cached.frames;
  }

  // Need to generate new frames
  const frames = [];

  // Frame 0 is the original stroke
  frames.push(strokes);

  for (let f = 1; f < BOIL_FRAMES; f++) {
    const mutatedStrokes = [];

    for (const stroke of strokes) {
      if (!stroke || stroke.length < 2) continue;

      const mutatedStroke = [];
      const numPoints = stroke.length;

      // 1. Calculate the bounding box and center of the stroke
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pt of stroke) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      // 2. Generate macro-level "redrawn" transformations
      // A new hand-drawn stroke usually has a slightly different size, angle, and starting position
      const scaleX = 1.0 + (Math.random() * 2 - 1) * 0.03; // +/- 3% width
      const scaleY = 1.0 + (Math.random() * 2 - 1) * 0.03; // +/- 3% height
      const rotation = (Math.random() * 2 - 1) * 0.02; // +/- ~1 degree
      const translateX = (Math.random() * 2 - 1) * 0.005; // tiny global shift
      const translateY = (Math.random() * 2 - 1) * 0.005;

      // 3. Generate very sparse, large structural deviations (like drawing a slightly wider curve)
      const numControls = Math.max(2, Math.ceil(numPoints / 15));
      const controls = [];
      for (let c = 0; c < numControls; c++) {
        // Higher intensity structurally, but very few control points so it's a smooth macro-change
        const intensity = 0.008;
        controls.push({
          dx: (Math.random() * 2 - 1) * intensity,
          dy: (Math.random() * 2 - 1) * intensity
        });
      }

      for (let i = 0; i < numPoints; i++) {
        const pt = stroke[i];
        const t = numPoints <= 1 ? 0 : i / (numPoints - 1);

        // A. Apply structural deviation
        const segmentFloat = t * (numControls - 1);
        const idx = Math.floor(segmentFloat);
        const nextIdx = Math.min(idx + 1, numControls - 1);
        const fraction = segmentFloat - idx;
        const smoothFraction = fraction * fraction * (3 - 2 * fraction);

        const devX = controls[idx].dx + (controls[nextIdx].dx - controls[idx].dx) * smoothFraction;
        const devY = controls[idx].dy + (controls[nextIdx].dy - controls[idx].dy) * smoothFraction;

        // B. Apply macro transformations
        // Translate to origin
        let x = pt.x - cx;
        let y = pt.y - cy;

        // Rotate
        const rx = x * Math.cos(rotation) - y * Math.sin(rotation);
        const ry = x * Math.sin(rotation) + y * Math.cos(rotation);

        // Scale and translate back, adding global translation and structural deviation
        const finalX = (rx * scaleX) + cx + translateX + devX;
        const finalY = (ry * scaleY) + cy + translateY + devY;

        mutatedStroke.push({
          x: finalX,
          y: finalY
        });
      }

      mutatedStrokes.push(mutatedStroke);
    }

    frames.push(mutatedStrokes);
  }

  boilCache[char] = { hash, frames };
  return frames;
}

/**
 * Simple random to avoid Math.random artifacts if needed
 */
function pseudoRandom(seed) {
  let x = Math.sin(seed++) * 10000;
  return x - Math.floor(x);
}
