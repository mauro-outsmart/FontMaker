import { drawGlyph, isOriginalStyle } from './brushes.js';

export function renderGrid(container, glyphs, settings, onGlyphClick) {
  // Preserve progress badge if it exists
  let badge = container.querySelector('.grid-progress');

  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  for (const glyph of glyphs) {
    const card = createGlyphCard(glyph, settings);
    card.addEventListener('click', () => onGlyphClick(glyph.char));
    container.appendChild(card);
  }

  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'grid-progress';
    badge.id = 'progressCount';
  }
  container.appendChild(badge);

  // Push badge to last column after layout
  requestAnimationFrame(() => {
    const cols = getComputedStyle(container).gridTemplateColumns.split(' ').length;
    badge.style.gridColumn = String(cols);
  });
}

function createGlyphCard(glyph, settings) {
  const card = document.createElement('div');
  card.className = 'glyph-card' + (glyph.strokes.length ? ' glyph-card--drawn' : '');
  card.dataset.char = glyph.char;

  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 160;
  card.appendChild(canvas);

  const label = document.createElement('span');
  label.className = 'glyph-card__label';
  label.textContent = glyph.char;
  card.appendChild(label);

  // We explicitly use the original strokes here initially.
  renderThumbnail(canvas, glyph, settings, glyph.strokes);

  return card;
}

export function renderThumbnail(canvas, glyph, settings, customStrokes = null) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Draw reference glyph faded — skip for Original/italic, where the filled
  // contour glyph already IS the reference.
  const brushType = settings.brushType || 'normal';
  if (settings.referenceFont && !isOriginalStyle(brushType)) {
    ctx.save();
    const fontSize = h * 0.7;
    ctx.font = `${fontSize}px "${settings.referenceFont}"`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph.char, w / 2, h / 2);
    ctx.restore();
  }

  // Draw strokes
  const strokesToDraw = customStrokes || glyph.strokes;
  if (strokesToDraw && strokesToDraw.length) {
    const lw = (settings.strokeWidth || 8) * (w / 200);
    ctx.save();
    ctx.strokeStyle = '#fff';
    drawGlyph(ctx, strokesToDraw, lw, brushType, 0, 0, w, h);
    ctx.restore();
  }
}

export function refreshAllThumbnails(container, glyphSet, settings) {
  const cards = container.querySelectorAll('.glyph-card');
  for (const card of cards) {
    const canvas = card.querySelector('canvas');
    const char = card.dataset.char;
    if (!canvas || !char) continue;
    const glyph = glyphSet.find(g => g.char === char);
    if (glyph) renderThumbnail(canvas, glyph, settings, glyph.strokes);
  }
}

export function refreshAllThumbnailsBoilFrame(container, glyphSet, settings, getFrameStrokes) {
  const cards = container.querySelectorAll('.glyph-card--drawn');
  for (const card of cards) {
    const canvas = card.querySelector('canvas');
    const char = card.dataset.char;
    if (!canvas || !char) continue;
    const glyph = glyphSet.find(g => g.char === char);
    if (glyph) {
      const strokes = getFrameStrokes(char, glyph.strokes);
      renderThumbnail(canvas, glyph, settings, strokes);
    }
  }
}

export function updateCard(container, char, glyph, settings) {
  const card = container.querySelector(`[data-char="${CSS.escape(char)}"]`);
  if (!card) return;

  // Update drawn state
  if (glyph.strokes.length) {
    card.classList.add('glyph-card--drawn');
  } else {
    card.classList.remove('glyph-card--drawn');
  }

  // Re-render thumbnail
  const canvas = card.querySelector('canvas');
  if (canvas) {
    renderThumbnail(canvas, glyph, settings);
  }
}
