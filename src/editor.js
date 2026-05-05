import { DrawingEngine } from './canvas.js';
import { saveGlyph, saveGlyphKerning, getGlyph, getSettings, GLYPHS } from './glyphs.js';

const KERN_MAX = 200;
const EM_SIZE = 1000;
const BASE_ADVANCE = 650;
const HALF_MARGIN = (EM_SIZE - BASE_ADVANCE) / 2;  // 175
const ASPECT = 1400 / 1000;

export class Editor {
  constructor(elements) {
    this.modal = elements.modal;
    this.canvasWrap = elements.canvasWrap;
    this.canvas = elements.canvas;
    this.label = elements.label;
    this.kerningToggle = elements.kerningToggle;
    this.currentChar = null;
    this.currentIndex = -1;
    this.referenceFont = 'Arial';
    this.strokeWidth = 8;

    // Kerning state
    this.kerningMode = false;
    this.kerningLeft = 0;
    this.kerningRight = 0;
    this.kerningEdited = false;
    this.draggingLine = null;
    this._glyphChars = GLYPHS;

    this.engine = new DrawingEngine(this.canvas);
    this.engine.onAfterRender = () => this._renderKerningOverlay();

    // Button listeners
    elements.save.addEventListener('click', () => this.save());
    elements.clear.addEventListener('click', () => this.clear());
    elements.undo.addEventListener('click', () => this.undo());
    elements.cancel.addEventListener('click', () => this.close());
    elements.prev.addEventListener('click', () => this.prev());
    elements.next.addEventListener('click', () => this.next());

    // Kerning toggle
    this.kerningToggle.addEventListener('change', () => {
      this.kerningMode = this.kerningToggle.checked;
      this.engine.drawingEnabled = !this.kerningMode;
      this.canvas.classList.toggle('editor-canvas--kerning-mode', this.kerningMode);
      this.engine.render();
    });

    // Kerning drag handlers
    this.canvas.addEventListener('pointerdown', (e) => this._onKerningPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this._onKerningPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this._onKerningPointerUp(e));
    this.canvas.addEventListener('pointerleave', (e) => this._onKerningPointerUp(e));

    // Close on overlay click (but not on modal body click)
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });

    // Keyboard shortcuts (only when modal is open)
    this._onKeyDown = this._onKeyDown.bind(this);
    document.addEventListener('keydown', this._onKeyDown);
  }

  _onKeyDown(e) {
    if (this.modal.hidden) return;

    if (e.key === 'Escape') {
      this.close();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      this.undo();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.prev();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.next();
    }
  }

  open(char, referenceFont, strokeWidth, brushType) {
    this.currentChar = char;
    this.currentIndex = this._glyphChars.indexOf(char);
    this.referenceFont = referenceFont;
    this.strokeWidth = strokeWidth;
    this.label.textContent = char;
    this.modal.hidden = false;
    document.body.style.overflow = 'hidden';

    // Reset kerning mode
    this.kerningToggle.checked = false;
    this.kerningMode = false;
    this.engine.drawingEnabled = true;
    this.canvas.classList.remove('editor-canvas--kerning-mode');

    // Wait for layout before sizing canvas
    requestAnimationFrame(() => {
      this._sizeCanvas();
      this.engine.setStrokeWidth(strokeWidth);
      // Always sync brush type at open time so the engine matches the current
      // dropdown selection regardless of init order.
      if (brushType !== undefined) this.engine.setBrushType(brushType);
      this.engine.setReference(char, referenceFont);

      const glyph = getGlyph(char);
      this.engine.setStrokes(glyph.strokes);

      // If per-glyph kerning was never edited, initialize from global
      if (glyph.kerningLeft === null && glyph.kerningRight === null) {
        const global = getSettings().kerning;
        this.kerningLeft = Math.floor(global / 2 / 10) * 10;
        this.kerningRight = global - this.kerningLeft;
        this.kerningEdited = false;
      } else {
        this.kerningLeft = glyph.kerningLeft || 0;
        this.kerningRight = glyph.kerningRight || 0;
        this.kerningEdited = true;
      }
    });
  }

  _sizeCanvas() {
    const wrapRect = this.canvasWrap.getBoundingClientRect();
    const maxH = Math.min(wrapRect.height - 16, 560);
    const maxW = wrapRect.width - 16;
    let h = maxH;
    let w = h * ASPECT;
    if (w > maxW) {
      w = maxW;
      h = w / ASPECT;
    }
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  save() {
    const strokes = this.engine.getStrokes();
    saveGlyph(this.currentChar, strokes, true);
    if (this.kerningEdited) {
      saveGlyphKerning(this.currentChar, this.kerningLeft, this.kerningRight);
    }
    window.dispatchEvent(new CustomEvent('glyph-updated', { detail: this.currentChar }));
    this.close();
  }

  clear() {
    this.engine.clear();
  }

  undo() {
    this.engine.undo();
  }

  close() {
    this.modal.hidden = true;
    document.body.style.overflow = '';
    this.engine.clear();
    this.currentChar = null;
    this.currentIndex = -1;
    this.kerningLeft = 0;
    this.kerningRight = 0;
    this.kerningEdited = false;
    this.kerningMode = false;
    this.kerningToggle.checked = false;
    this.canvas.classList.remove('editor-canvas--kerning-mode');
  }

  prev() {
    if (this.currentIndex <= 0) return;
    this._autoSave();
    const newChar = this._glyphChars[this.currentIndex - 1];
    this.open(newChar, this.referenceFont, this.strokeWidth, this.engine.brushType);
  }

  next() {
    if (this.currentIndex >= this._glyphChars.length - 1) return;
    this._autoSave();
    const newChar = this._glyphChars[this.currentIndex + 1];
    this.open(newChar, this.referenceFont, this.strokeWidth, this.engine.brushType);
  }

  setGlyphChars(chars) {
    this._glyphChars = chars;
  }

  _autoSave() {
    if (this.currentChar) {
      const strokes = this.engine.getStrokes();
      if (this.kerningEdited) {
        saveGlyphKerning(this.currentChar, this.kerningLeft, this.kerningRight);
      }
      if (strokes.length > 0) {
        saveGlyph(this.currentChar, strokes, true);
      }
      window.dispatchEvent(new CustomEvent('glyph-updated', { detail: this.currentChar }));
    }
  }

  updateStrokeWidth(w) {
    this.strokeWidth = w;
    if (!this.modal.hidden) {
      this.engine.setStrokeWidth(w);
    }
  }

  updateBrushType(type) {
    if (!this.modal.hidden) {
      this.engine.setBrushType(type);
    }
  }

  updateReferenceFont(font) {
    this.referenceFont = font;
    if (!this.modal.hidden && this.currentChar) {
      this.engine.setReference(this.currentChar, font);
    }
  }

  // --- Kerning overlay ---

  _renderKerningOverlay() {
    if (!this.kerningMode) return;
    const ctx = this.canvas.getContext('2d');
    const { cw, ch, squareSize, extraPx } = this.engine.getLayout();
    const pxPerUnit = squareSize / EM_SIZE;

    const leftX = extraPx + (HALF_MARGIN - this.kerningLeft) * pxPerUnit;
    const rightX = extraPx + (EM_SIZE - HALF_MARGIN + this.kerningRight) * pxPerUnit;

    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);

    ctx.beginPath();
    ctx.moveTo(leftX, 0);
    ctx.lineTo(leftX, ch);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(rightX, 0);
    ctx.lineTo(rightX, ch);
    ctx.stroke();

    ctx.setLineDash([]);
    this._drawPill(ctx, leftX, ch / 2, this.kerningLeft, cw);
    this._drawPill(ctx, rightX, ch / 2, this.kerningRight, cw);
    ctx.restore();
  }

  _drawPill(ctx, x, y, value, canvasWidth) {
    const dpr = window.devicePixelRatio || 1;
    const fontSize = 12 * dpr;
    const text = String(Math.round(value));
    ctx.save();
    ctx.font = `${fontSize}px "Fira Code", monospace`;
    const metrics = ctx.measureText(text);
    const pw = metrics.width + 16 * dpr;
    const ph = 22 * dpr;
    const r = ph / 2;

    // Clamp pill position so it stays within canvas bounds
    const pillX = Math.max(pw / 2 + 2, Math.min(canvasWidth - pw / 2 - 2, x));
    const px = pillX - pw / 2;
    const py = y - ph / 2;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, r);
    ctx.fill();

    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, pillX, y);
    ctx.restore();
  }

  // --- Kerning drag ---

  _hitTestKerningLine(e) {
    const rect = this.canvas.getBoundingClientRect();
    const { squareSize, extraPx } = this.engine.getLayout();
    const pxPerUnit = squareSize / EM_SIZE;
    const scale = this.canvas.width / rect.width;

    const clientX = (e.clientX - rect.left) * scale;
    const leftX = extraPx + (HALF_MARGIN - this.kerningLeft) * pxPerUnit;
    const rightX = extraPx + (EM_SIZE - HALF_MARGIN + this.kerningRight) * pxPerUnit;
    const hitThreshold = 24 * (window.devicePixelRatio || 1);

    if (Math.abs(clientX - leftX) < hitThreshold) return 'left';
    if (Math.abs(clientX - rightX) < hitThreshold) return 'right';
    return null;
  }

  _onKerningPointerDown(e) {
    if (!this.kerningMode) return;
    const hit = this._hitTestKerningLine(e);
    if (hit) {
      this.draggingLine = hit;
      this.canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    }
  }

  _onKerningPointerMove(e) {
    if (!this.kerningMode || !this.draggingLine) return;
    const rect = this.canvas.getBoundingClientRect();
    const { squareSize, extraPx } = this.engine.getLayout();
    const pxPerUnit = squareSize / EM_SIZE;
    const scale = this.canvas.width / rect.width;
    const clientX = (e.clientX - rect.left) * scale;

    this.kerningEdited = true;

    if (this.draggingLine === 'left') {
      const raw = HALF_MARGIN - (clientX - extraPx) / pxPerUnit;
      this.kerningLeft = Math.round(raw / 10) * 10;
      this.kerningLeft = Math.max(-KERN_MAX, Math.min(KERN_MAX, this.kerningLeft));
    } else if (this.draggingLine === 'right') {
      const raw = (clientX - extraPx) / pxPerUnit - (EM_SIZE - HALF_MARGIN);
      this.kerningRight = Math.round(raw / 10) * 10;
      this.kerningRight = Math.max(-KERN_MAX, Math.min(KERN_MAX, this.kerningRight));
    }

    this.engine.render();
  }

  _onKerningPointerUp() {
    this.draggingLine = null;
  }
}
