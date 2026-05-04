import GIF from 'gif.js';
import { getGlyph } from './glyphs.js';
import { drawGlyph } from './brushes.js';
import { getBoilFrames, BOIL_FRAMES } from './boil.js';

const BOIL_FPS = 8;
const REVEAL_FPS = 30;
const GLYPH_SIZE = 120;
const BASELINE = 20;
const CANVAS_HEIGHT = GLYPH_SIZE + BASELINE * 2;
const DEFAULT_GLYPH_DURATION = 500;

function measureText(text, kerning) {
  const spaceAdvance = GLYPH_SIZE * 400 / 1000;
  let totalWidth = 0;
  for (const char of text) {
    if (char === ' ') {
      totalWidth += spaceAdvance;
      continue;
    }
    const glyph = getGlyph(char);
    const hasPerGlyph = glyph.kerningLeft !== null || glyph.kerningRight !== null;
    const kl = hasPerGlyph ? (glyph.kerningLeft || 0) : 0;
    const kr = hasPerGlyph ? (glyph.kerningRight || 0) : 0;
    const kern = hasPerGlyph ? (kl + kr) : kerning;
    totalWidth += GLYPH_SIZE * (650 + kern) / 1000;
  }
  return totalWidth;
}

function getGlyphDuration(strokes) {
  if (!strokes || strokes.length === 0) return DEFAULT_GLYPH_DURATION;
  let maxT = 0;
  for (const stroke of strokes) {
    for (const p of stroke) {
      if (p.t !== undefined && p.t > maxT) maxT = p.t;
    }
  }
  return maxT > 0 ? maxT : DEFAULT_GLYPH_DURATION;
}

function getPartialStrokes(strokes, elapsed) {
  const hasTiming = strokes.some(s => s.some(p => p.t !== undefined));
  if (!hasTiming) {
    const totalPoints = strokes.reduce((n, s) => n + s.length, 0);
    const fraction = Math.min(1, elapsed / DEFAULT_GLYPH_DURATION);
    const pointsToShow = Math.ceil(totalPoints * fraction);
    const result = [];
    let count = 0;
    for (const stroke of strokes) {
      if (count >= pointsToShow) break;
      const remaining = pointsToShow - count;
      if (remaining >= stroke.length) {
        result.push(stroke);
        count += stroke.length;
      } else {
        result.push(stroke.slice(0, remaining));
        count += remaining;
      }
    }
    return result;
  }

  const result = [];
  for (const stroke of strokes) {
    if (stroke[0].t !== undefined && stroke[0].t > elapsed) break;
    const visible = stroke.filter(p => p.t === undefined || p.t <= elapsed);
    if (visible.length >= 2) result.push(visible);
  }
  return result;
}

function renderFrame(ctx, text, settings, canvasWidth, padding, getStrokes) {
  const { kerning, strokeWidth, brushType } = settings;
  const spaceAdvance = GLYPH_SIZE * 400 / 1000;
  const lw = strokeWidth * (GLYPH_SIZE / 200);

  ctx.clearRect(0, 0, canvasWidth, CANVAS_HEIGHT);

  let x = padding;
  let charIdx = 0;
  for (const char of text) {
    if (char === ' ') {
      x += spaceAdvance;
      continue;
    }

    const glyph = getGlyph(char);
    const hasPerGlyph = glyph.kerningLeft !== null || glyph.kerningRight !== null;
    const kl = hasPerGlyph ? (glyph.kerningLeft || 0) : 0;
    const kr = hasPerGlyph ? (glyph.kerningRight || 0) : 0;
    const kern = hasPerGlyph ? (kl + kr) : kerning;
    const glyphAdvance = GLYPH_SIZE * (650 + kern) / 1000;
    const leftOffset = GLYPH_SIZE * kl / 1000;

    const strokes = getStrokes(char, charIdx, glyph);
    if (strokes && strokes.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#fff';
      drawGlyph(ctx, strokes, lw, brushType, x + leftOffset, BASELINE, GLYPH_SIZE, GLYPH_SIZE);
      ctx.restore();
    }

    x += glyphAdvance;
    charIdx++;
  }
}

// --- Frame generators (shared by GIF and APNG) ---

function generateBoilFrames(ctx, text, settings, canvasWidth, padding, addFrame) {
  for (let f = 0; f < BOIL_FRAMES; f++) {
    renderFrame(ctx, text, settings, canvasWidth, padding, (char, idx, glyph) => {
      if (!glyph.strokes || glyph.strokes.length === 0) return [];
      const frames = getBoilFrames(char, glyph.strokes);
      return frames[f % frames.length] || glyph.strokes;
    });
    addFrame(1000 / BOIL_FPS);
  }
}

function generateRevealFrames(ctx, text, settings, canvasWidth, padding, addFrame) {
  const chars = buildTimeline(text);
  const totalDuration = chars.length > 0 ? chars[chars.length - 1].startTime + chars[chars.length - 1].duration : 0;
  if (totalDuration === 0) return;

  const frameDelay = 1000 / REVEAL_FPS;
  const totalFrames = Math.ceil(totalDuration / frameDelay);

  for (let f = 0; f <= totalFrames; f++) {
    const elapsed = f * frameDelay;

    renderFrame(ctx, text, settings, canvasWidth, padding, (char, idx, glyph) => {
      const c = findTimelineEntry(chars, idx);
      if (!glyph.strokes || glyph.strokes.length === 0) return [];
      const glyphElapsed = elapsed - c.startTime;
      if (glyphElapsed < 0) return [];
      if (glyphElapsed >= c.duration) return glyph.strokes;
      return getPartialStrokes(glyph.strokes, glyphElapsed);
    });

    addFrame(frameDelay);
  }
}

function generateBothFrames(ctx, text, settings, canvasWidth, padding, addFrame) {
  const chars = buildTimeline(text);
  const totalDuration = chars.length > 0 ? chars[chars.length - 1].startTime + chars[chars.length - 1].duration : 0;
  if (totalDuration === 0) return;

  const frameDelay = 1000 / REVEAL_FPS;
  const revealFrames = Math.ceil(totalDuration / frameDelay);

  let boilIdx = 0;
  for (let f = 0; f <= revealFrames; f++) {
    const elapsed = f * frameDelay;
    const currentBoilFrame = boilIdx % BOIL_FRAMES;

    renderFrame(ctx, text, settings, canvasWidth, padding, (char, idx, glyph) => {
      const c = findTimelineEntry(chars, idx);
      if (!glyph.strokes || glyph.strokes.length === 0) return [];
      const glyphElapsed = elapsed - c.startTime;
      if (glyphElapsed < 0) return [];

      if (glyphElapsed >= c.duration) {
        const frames = getBoilFrames(char, glyph.strokes);
        return frames[currentBoilFrame] || glyph.strokes;
      }
      return getPartialStrokes(glyph.strokes, glyphElapsed);
    });

    addFrame(frameDelay);

    if ((f * frameDelay) % (1000 / BOIL_FPS) < frameDelay) {
      boilIdx++;
    }
  }

  const boilLoopDelay = 1000 / BOIL_FPS;
  for (let f = 0; f < BOIL_FRAMES; f++) {
    renderFrame(ctx, text, settings, canvasWidth, padding, (char, idx, glyph) => {
      if (!glyph.strokes || glyph.strokes.length === 0) return [];
      const frames = getBoilFrames(char, glyph.strokes);
      return frames[f % frames.length] || glyph.strokes;
    });
    addFrame(boilLoopDelay);
  }
}

// --- Helpers ---

function buildTimeline(text) {
  const chars = [];
  for (const char of text) {
    if (char === ' ') {
      chars.push({ char: ' ', duration: 0 });
    } else {
      const glyph = getGlyph(char);
      const duration = (glyph.strokes && glyph.strokes.length > 0)
        ? getGlyphDuration(glyph.strokes) : 0;
      chars.push({ char, duration });
    }
  }
  let cumulative = 0;
  for (const c of chars) {
    c.startTime = cumulative;
    cumulative += c.duration;
  }
  return chars;
}

function findTimelineEntry(chars, nonSpaceIdx) {
  let count = 0;
  for (const c of chars) {
    if (c.char !== ' ') {
      if (count === nonSpaceIdx) return c;
      count++;
    }
  }
  return chars[0];
}

function setupCanvas(text, settings) {
  const totalWidth = measureText(text, settings.kerning);
  const padding = GLYPH_SIZE * 0.3;
  const canvasWidth = Math.ceil(totalWidth) + padding * 2;
  if (canvasWidth <= padding * 2) return null;

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d');
  return { ctx, canvasWidth, padding };
}

function getGenerator(mode) {
  if (mode === 'reveal') return generateRevealFrames;
  if (mode === 'both') return generateBothFrames;
  return generateBoilFrames;
}

function downloadBlob(blob, fontName, ext) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const sanitized = (fontName || 'MyFont').replace(/[^a-zA-Z0-9]/g, '');
  a.download = sanitized + '-preview.' + ext;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Exports ---

export function exportGIF(text, settings, fontName, mode = 'boil') {
  if (!text) return;
  const setup = setupCanvas(text, settings);
  if (!setup) return;
  const { ctx, canvasWidth, padding } = setup;

  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: canvasWidth,
    height: CANVAS_HEIGHT,
    transparent: 0x000000,
    workerScript: import.meta.env.BASE_URL + 'gif.worker.js',
  });

  getGenerator(mode)(ctx, text, settings, canvasWidth, padding, (delay) => {
    gif.addFrame(ctx, { copy: true, delay });
  });

  gif.on('finished', (blob) => downloadBlob(blob, fontName, 'gif'));
  gif.render();
}
