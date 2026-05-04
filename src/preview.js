import { getGlyph } from './glyphs.js';
import { drawGlyph } from './brushes.js';
import { getBoilFrames, BOIL_FRAMES } from './boil.js';

const DEFAULT_GLYPH_DURATION = 500; // ms for glyphs without timing data

export class Preview {
  constructor(canvas, input) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = input;
    this.referenceFont = 'Arial';
    this.kerning = 0;
    this.strokeWidth = 8;
    this.brushType = 'normal';

    // Playback state
    this.isPlaying = false;
    this._animFrameId = null;
    this.onPlayStateChange = null;

    this.input.addEventListener('input', () => {
      if (this.isPlaying) this.stopAnimation();
      this.render();
    });
    window.addEventListener('glyph-updated', () => {
      if (!this.isPlaying) this.render();
    });
    window.addEventListener('resize', () => {
      if (!this.isPlaying) this.render();
    });
  }

  setReferenceFont(font) {
    this.referenceFont = font;
    this.render();
  }

  setKerning(kerning) {
    this.kerning = kerning;
    this.render();
  }

  setStrokeWidth(w) {
    this.strokeWidth = w;
    this.render();
  }

  setBrushType(type) {
    this.brushType = type;
    this.render();
  }

  // Accepts an optional function: (char, originalStrokes) => return customStrokes
  render(getCustomStrokes = null) {
    this.lastGetCustomStrokes = getCustomStrokes;
    const text = this.input.value || '';
    const ctx = this.ctx;

    // Size canvas to container
    const container = this.canvas.parentElement;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const canvasWidth = rect.width;

    const glyphSize = 60;
    const baseline = 10;
    const lineHeight = glyphSize + baseline;
    const wrapX = canvasWidth * 0.75;
    const spaceAdvance = glyphSize * 400 / 1000;

    // Pre-measure to find line count
    const lines = this._wrapText(text, glyphSize, wrapX, spaceAdvance);
    const canvasHeight = Math.max(80, lines.length * lineHeight + baseline);

    this.canvas.width = canvasWidth * dpr;
    this.canvas.height = canvasHeight * dpr;
    this.canvas.style.width = canvasWidth + 'px';
    this.canvas.style.height = canvasHeight + 'px';
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    for (let row = 0; row < lines.length; row++) {
      let x = 0;
      const y = baseline + row * lineHeight;

      for (const char of lines[row]) {
        if (char === ' ') {
          x += spaceAdvance;
          continue;
        }

        const glyph = getGlyph(char);
        const hasStrokes = glyph && glyph.strokes && glyph.strokes.length > 0;
        const hasPerGlyph = glyph.kerningLeft !== null || glyph.kerningRight !== null;
        const kl = hasPerGlyph ? (glyph.kerningLeft || 0) : 0;
        const kr = hasPerGlyph ? (glyph.kerningRight || 0) : 0;
        const kern = hasPerGlyph ? (kl + kr) : this.kerning;
        const leftOffset = glyphSize * kl / 1000;

        if (hasStrokes) {
          const glyphAdvance = glyphSize * (650 + kern) / 1000;
          const strokesToDraw = getCustomStrokes ? getCustomStrokes(char, glyph.strokes) : glyph.strokes;
          this._drawGlyphStrokes(ctx, strokesToDraw, x + leftOffset, y, glyphSize);
          x += glyphAdvance;
        } else {
          ctx.save();
          ctx.globalAlpha = 0.15;
          ctx.font = `${glyphSize}px "${this.referenceFont}"`;
          ctx.fillStyle = '#fff';
          ctx.textBaseline = 'top';
          ctx.fillText(char, x, y);
          const measured = ctx.measureText(char);
          ctx.restore();
          x += measured.width;
        }
      }
    }
  }

  _wrapText(text, glyphSize, wrapX, spaceAdvance) {
    // Split into words first
    const words = text.split(/( )/);
    const lines = [''];
    let x = 0;

    for (const word of words) {
      if (word === ' ') {
        lines[lines.length - 1] += ' ';
        x += spaceAdvance;
        continue;
      }

      // Measure word width
      let wordWidth = 0;
      for (const char of word) {
        const glyph = getGlyph(char);
        const hasStrokes = glyph && glyph.strokes && glyph.strokes.length > 0;
        if (hasStrokes) {
          const hasPerGlyph = glyph.kerningLeft !== null || glyph.kerningRight !== null;
          const kl = hasPerGlyph ? (glyph.kerningLeft || 0) : 0;
          const kr = hasPerGlyph ? (glyph.kerningRight || 0) : 0;
          const kern = hasPerGlyph ? (kl + kr) : this.kerning;
          wordWidth += glyphSize * (650 + kern) / 1000;
        } else {
          wordWidth += this._measureRefChar(char, glyphSize);
        }
      }

      // Wrap before the word if it would overflow
      if (x > 0 && x + wordWidth > wrapX) {
        // Trim trailing space from previous line
        lines[lines.length - 1] = lines[lines.length - 1].replace(/ +$/, '');
        lines.push('');
        x = 0;
      }

      lines[lines.length - 1] += word;
      x += wordWidth;
    }

    return lines;
  }

  _measureRefChar(char, glyphSize) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${glyphSize}px "${this.referenceFont}"`;
    const w = ctx.measureText(char).width;
    ctx.restore();
    return w;
  }

  _drawGlyphStrokes(ctx, strokes, offsetX, offsetY, size) {
    const lw = this.strokeWidth * (size / 200);
    ctx.save();
    ctx.strokeStyle = '#fff';
    drawGlyph(ctx, strokes, lw, this.brushType, offsetX, offsetY, size, size);
    ctx.restore();
  }

  // --- Playback animation ---

  _getGlyphDuration(strokes) {
    if (!strokes || strokes.length === 0) return DEFAULT_GLYPH_DURATION;
    let maxT = 0;
    for (const stroke of strokes) {
      for (const p of stroke) {
        if (p.t !== undefined && p.t > maxT) maxT = p.t;
      }
    }
    return maxT > 0 ? maxT : DEFAULT_GLYPH_DURATION;
  }

  _getPartialStrokes(strokes, elapsed) {
    const hasTiming = strokes.some(s => s.some(p => p.t !== undefined));
    if (!hasTiming) {
      // No timing data: linear reveal over DEFAULT_GLYPH_DURATION
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

  playAnimation(speed = 1, lineBoil = false) {
    if (this.isPlaying) this.stopAnimation();

    const text = this.input.value || '';
    if (!text) return;

    // Build timeline: sequential glyph durations (skip spaces)
    const chars = [];
    for (const char of text) {
      if (char === ' ') {
        chars.push({ char: ' ', duration: 0 });
      } else {
        const glyph = getGlyph(char);
        const duration = (glyph.strokes && glyph.strokes.length > 0)
          ? this._getGlyphDuration(glyph.strokes)
          : 0;
        chars.push({ char, duration });
      }
    }

    // Cumulative start times
    let cumulative = 0;
    for (const c of chars) {
      c.startTime = cumulative;
      cumulative += c.duration;
    }
    const totalDuration = cumulative;
    if (totalDuration === 0) return;

    this.isPlaying = true;
    if (this.onPlayStateChange) this.onPlayStateChange(true);

    const startTs = performance.now();
    const BOIL_INTERVAL = 1000 / 8;
    let lastBoilAdvance = 0;
    let boilFrame = 0;

    const tick = (ts) => {
      const elapsed = (performance.now() - startTs) * speed;

      // Advance boil frame at 8 FPS
      if (lineBoil && ts - lastBoilAdvance > BOIL_INTERVAL) {
        boilFrame = (boilFrame + 1) % BOIL_FRAMES;
        lastBoilAdvance = ts;
      }

      if (elapsed >= totalDuration) {
        this.isPlaying = false;
        this._animFrameId = null;
        this.render();
        if (this.onPlayStateChange) this.onPlayStateChange(false);
        return;
      }

      // Build a map of char index -> partial strokes for this frame
      const charStrokesMap = new Map();
      let charIdx = 0;
      for (const c of chars) {
        if (c.char !== ' ') {
          const glyphElapsed = elapsed - c.startTime;
          const glyph = getGlyph(c.char);
          if (glyphElapsed < 0) {
            charStrokesMap.set(charIdx, []);
          } else if (glyphElapsed >= c.duration) {
            // Fully revealed — apply boil if enabled
            if (lineBoil && glyph.strokes && glyph.strokes.length > 0) {
              const frames = getBoilFrames(c.char, glyph.strokes);
              charStrokesMap.set(charIdx, frames[boilFrame] || glyph.strokes);
            } else {
              charStrokesMap.set(charIdx, glyph.strokes);
            }
          } else {
            charStrokesMap.set(charIdx, this._getPartialStrokes(glyph.strokes, glyphElapsed));
          }
          charIdx++;
        }
      }

      // Render with positional callback
      let renderIdx = 0;
      this.render((char, originalStrokes) => {
        const partial = charStrokesMap.get(renderIdx);
        renderIdx++;
        return partial !== undefined ? partial : originalStrokes;
      });

      this._animFrameId = requestAnimationFrame(tick);
    };

    this._animFrameId = requestAnimationFrame(tick);
  }

  stopAnimation() {
    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
    this.isPlaying = false;
    if (this.onPlayStateChange) this.onPlayStateChange(false);
    this.render();
  }
}
