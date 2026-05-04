import { drawStroke, drawGlyph, isOriginalStyle } from './brushes.js';

export class DrawingEngine {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.strokes = [];        // completed strokes: array of arrays of {x,y,t}
    this.currentStroke = null; // in-progress stroke
    this.glyphStartTime = null; // timestamp of first point for timing recording
    this.strokeWidth = options.strokeWidth || 8;
    this.strokeColor = options.strokeColor || '#fff';
    this.brushType = options.brushType || 'normal';
    this.referenceGlyph = null;
    this.referenceFont = null;
    this.isDrawing = false;
    this.drawingEnabled = true;
    this.onAfterRender = null;

    this._onStart = this._onStart.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onEnd = this._onEnd.bind(this);

    this._bindEvents();
  }

  _bindEvents() {
    this.canvas.addEventListener('pointerdown', this._onStart);
    this.canvas.addEventListener('pointermove', this._onMove);
    this.canvas.addEventListener('pointerup', this._onEnd);
    this.canvas.addEventListener('pointerleave', this._onEnd);
    this.canvas.style.touchAction = 'none';
  }

  getLayout() {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const squareSize = ch;
    const extraPx = (cw - squareSize) / 2;
    return { cw, ch, squareSize, extraPx };
  }

  _getPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    const { squareSize, extraPx } = this.getLayout();
    const scale = this.canvas.width / rect.width;
    const displayExtra = extraPx / scale;
    const displaySquare = squareSize / scale;
    return {
      x: (e.clientX - rect.left - displayExtra) / displaySquare,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  _onStart(e) {
    if (!this.drawingEnabled) return;
    this.isDrawing = true;
    if (this.glyphStartTime === null) {
      this.glyphStartTime = performance.now();
    }
    const pt = this._getPoint(e);
    pt.t = Math.round(performance.now() - this.glyphStartTime);
    this.currentStroke = [pt];
    this.canvas.setPointerCapture(e.pointerId);
  }

  _onMove(e) {
    if (!this.isDrawing || !this.currentStroke) return;
    const pt = this._getPoint(e);
    pt.t = Math.round(performance.now() - this.glyphStartTime);
    this.currentStroke.push(pt);
    this.render();
  }

  _onEnd(e) {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    if (this.currentStroke && this.currentStroke.length >= 2) {
      this.strokes.push(this.currentStroke);
    }
    this.currentStroke = null;
    this.render();
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    const isOriginal = isOriginalStyle(this.brushType);

    // Skip the faded reference glyph for Original/italic — the filled glyph
    // IS the reference, and overlaying the upright ghost behind a sheared
    // glyph creates visible halos.
    if (!isOriginal) this._drawReference();

    if (isOriginal) {
      // Filled-glyph rendering needs all contours in one path
      const all = this.currentStroke && this.currentStroke.length >= 2
        ? [...this.strokes, this.currentStroke]
        : this.strokes;
      const { squareSize, extraPx } = this.getLayout();
      ctx.save();
      ctx.strokeStyle = this.strokeColor;
      drawGlyph(ctx, all, this.strokeWidth * (squareSize / 200), this.brushType, extraPx, 0, squareSize, squareSize);
      ctx.restore();
    } else {
      // Draw completed strokes
      for (const stroke of this.strokes) {
        this._drawStroke(stroke);
      }
      // Draw current stroke in progress
      if (this.currentStroke && this.currentStroke.length >= 2) {
        this._drawStroke(this.currentStroke);
      }
    }

    if (this.onAfterRender) this.onAfterRender();
  }

  _drawReference() {
    if (!this.referenceGlyph || !this.referenceFont) return;
    const ctx = this.ctx;
    const { squareSize, extraPx } = this.getLayout();

    ctx.save();
    const fontSize = squareSize * 0.7;
    ctx.font = `${fontSize}px "${this.referenceFont}"`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.referenceGlyph, extraPx + squareSize / 2, squareSize / 2);
    ctx.restore();
  }

  _drawStroke(points) {
    if (points.length < 2) return;
    const ctx = this.ctx;
    const { squareSize, extraPx } = this.getLayout();
    const lw = this.strokeWidth * (squareSize / 200);

    ctx.save();
    ctx.strokeStyle = this.strokeColor;
    drawStroke(ctx, points, lw, this.brushType, extraPx, 0, squareSize, squareSize);
    ctx.restore();
  }

  setStrokes(strokes) {
    this.strokes = strokes.map(s => s.map(p => ({ ...p })));
    this.currentStroke = null;
    this.isDrawing = false;
    // Find max timestamp so new strokes continue from where recording left off
    let maxT = 0;
    for (const s of this.strokes) {
      for (const p of s) {
        if (p.t > maxT) maxT = p.t;
      }
    }
    this.glyphStartTime = maxT > 0 ? performance.now() - maxT : null;
    this.render();
  }

  getStrokes() {
    return this.strokes.map(s => s.map(p => ({ ...p })));
  }

  undo() {
    this.strokes.pop();
    this.render();
  }

  clear() {
    this.strokes = [];
    this.currentStroke = null;
    this.isDrawing = false;
    this.glyphStartTime = null;
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

  setReference(char, font) {
    this.referenceGlyph = char;
    this.referenceFont = font;
    this.render();
  }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this._onStart);
    this.canvas.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('pointerup', this._onEnd);
    this.canvas.removeEventListener('pointerleave', this._onEnd);
  }
}
