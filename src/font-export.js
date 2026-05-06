import opentype from 'opentype.js';
import { glyphToContours, TRACE_SIZE } from './contour.js';
import { getAllGlyphs } from './glyphs.js';

export function exportFont(fontName, strokeWidth, kerning = 0, brushType = 'normal') {
  const unitsPerEm = 1000;
  const ascender = 800;
  const descender = -200;
  const baseAdvance = 650;
  const defaultAdvance = baseAdvance + kerning;

  const notdefGlyph = new opentype.Glyph({
    name: '.notdef',
    unicode: 0,
    advanceWidth: defaultAdvance,
    path: new opentype.Path(),
  });

  const spaceGlyph = new opentype.Glyph({
    name: 'space',
    unicode: 32,
    advanceWidth: 400,
    path: new opentype.Path(),
  });

  const glyphs = [notdefGlyph, spaceGlyph];
  const scale = unitsPerEm / TRACE_SIZE;

  const allGlyphs = getAllGlyphs();
  for (const glyph of allGlyphs) {
    if (!glyph.strokes || !glyph.strokes.length) continue;

    const hasPerGlyph = glyph.kerningLeft !== null || glyph.kerningRight !== null;
    const kl = hasPerGlyph ? (glyph.kerningLeft || 0) : 0;
    const kr = hasPerGlyph ? (glyph.kerningRight || 0) : 0;
    const kern = hasPerGlyph ? (kl + kr) : kerning;
    const glyphAdvance = baseAdvance + kern;

    const isOriginal = brushType === 'original' || brushType === 'original-italic';
    const contours = isOriginal
      ? glyph.strokes.map(s => s.map(p => ({ x: p.x * TRACE_SIZE, y: p.y * TRACE_SIZE })))
      : glyphToContours(glyph.strokes, strokeWidth, brushType);

    // Compute the glyph's contour points in font units first, then normalize
    // vertically so the glyph's bottom sits on the baseline (y_font = 0).
    // Without this, glyphs that were rendered centered in their bitmap end
    // up floating ~270 units above the baseline and read as superscripts in
    // any text editor that uses our font.
    const validContours = [];
    let minYFont = Infinity;
    for (const contour of contours) {
      if (contour.length < 3) continue;
      const points = contour.map((p) => {
        const x = p.x * scale + kl;
        const y = unitsPerEm - p.y * scale;
        if (y < minYFont) minYFont = y;
        return { x, y };
      });
      validContours.push(points);
    }
    const yShift = isFinite(minYFont) ? -minYFont : 0;

    const path = new opentype.Path();
    for (const points of validContours) {
      path.moveTo(points[0].x, points[0].y + yShift);
      for (let i = 1; i < points.length; i++) {
        path.lineTo(points[i].x, points[i].y + yShift);
      }
      path.close();
    }

    const unicode = glyph.char.codePointAt(0);
    // opentype.js v1.3.4 expects 16-bit unicode IDs; skip anything outside
    // the BMP (emoji, supplementary planes) since they'd corrupt the cmap.
    if (unicode > 0xFFFF) continue;
    const name = unicode >= 33 && unicode <= 126
      ? glyph.char
      : 'uni' + unicode.toString(16).toUpperCase().padStart(4, '0');

    glyphs.push(new opentype.Glyph({
      name,
      unicode,
      advanceWidth: glyphAdvance,
      path,
    }));
  }

  const font = new opentype.Font({
    familyName: fontName || 'MyFont',
    styleName: 'Regular',
    unitsPerEm,
    ascender,
    descender,
    glyphs,
  });

  const sanitizedName = (fontName || 'MyFont').replace(/[^a-zA-Z0-9]/g, '');
  font.download(sanitizedName + '.otf');
}
