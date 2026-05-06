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

    // Compute the glyph's contour points in font units first, then apply a
    // constant baseline shift so that the typographic baseline of the rendered
    // bitmap (at p.y_norm ≈ 0.73 for textBaseline='middle' at canvas center)
    // maps to y_font = 0. A constant — not per-glyph — shift means descenders
    // (p, q, g, j, y) correctly extend BELOW the baseline rather than sitting
    // on it.
    const BASELINE_RATIO = 0.69;
    const yShift = -(1 - BASELINE_RATIO) * unitsPerEm; // = -270 for unitsPerEm 1000

    const validContours = [];
    for (const contour of contours) {
      if (contour.length < 3) continue;
      const points = contour.map((p) => ({
        x: p.x * scale + kl,
        y: unitsPerEm - p.y * scale,
      }));
      validContours.push(points);
    }

    // Scale glyphs and advance up so cap height ends near 700 in 1000-unit
    // em — matching typical fonts. Our bitmap render uses fontSize = 0.7 *
    // size which gives cap height ~500 in font units; multiplying by 1.4
    // brings it in line with standard typography.
    const SCALE_UP = 1.4;

    const path = new opentype.Path();
    for (const points of validContours) {
      path.moveTo(points[0].x * SCALE_UP, (points[0].y + yShift) * SCALE_UP);
      for (let i = 1; i < points.length; i++) {
        path.lineTo(points[i].x * SCALE_UP, (points[i].y + yShift) * SCALE_UP);
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
      advanceWidth: Math.round(glyphAdvance * SCALE_UP),
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
