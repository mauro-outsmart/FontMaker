# Brush Types Feature Plan

## Overview
Add 3 brush types: Normal (current), Growing (starts thin, grows thicker), Rough (textured jitter). Brush type is a **global setting** stored in settings (like stroke width).

## Files to Create
### `src/brushes.js` — Shared brush rendering module
Central place for all brush drawing logic. Every render path (editor, grid, preview, font export) calls into this module.

```
drawStroke(ctx, points, lineWidth, brushType, ox, oy, size)
  → dispatches to drawNormal / drawGrowing / drawRough
```

**Normal brush**: Current single-path quadratic curve rendering (extracted from existing code).

**Growing brush**: Draws each segment with increasing lineWidth. Starts at ~30% of strokeWidth, grows based on cumulative distance, caps at full strokeWidth. Uses individual line segments with round lineCap for smooth joins.

**Rough brush**: Same quadratic path as normal, but rendered twice: once normally, then overlaid with jittered points. Uses deterministic jitter (seeded from point coordinates) so re-renders are stable.

## Files to Modify

### `src/glyphs.js`
- Add `brushType: 'normal'` to default settings
- Return it from `getSettings()`

### `index.html`
- Add brush selector in the top bar controls row (between Stroke and Kerning):
  ```html
  <label class="control">
    <span class="control__label">Brush</span>
    <select id="brushType" class="control__select">
      <option value="normal">Normal</option>
      <option value="growing">Growing</option>
      <option value="rough">Rough</option>
    </select>
  </label>
  ```

### `src/main.js`
- Wire brush selector: load from settings, save on change
- Pass `brushType` to editor, preview, and grid refreshes

### `src/canvas.js` (DrawingEngine)
- Add `brushType` property (default: 'normal')
- Add `setBrushType(type)` method
- Replace `_drawStroke()` body with call to `brushes.drawStroke()`

### `src/grid.js`
- Import `drawStroke` from brushes
- Pass `settings.brushType` into `renderThumbnail`
- Replace inline stroke rendering with `drawStroke()` call

### `src/preview.js`
- Import `drawStroke` from brushes
- Add `brushType` property, `setBrushType()` method
- Replace `_drawGlyphStrokes()` body with `drawStroke()` calls

### `src/contour.js`
- Import `drawStroke` from brushes
- `renderToGrid()` accepts `brushType` parameter
- Replace inline stroke rendering with `drawStroke()` call

### `src/font-export.js`
- Pass `brushType` setting to `glyphToContours()`

### `src/editor.js`
- Add `updateBrushType()` method to pass through to engine

## Rendering Details

### Growing Brush Algorithm
```
minWidth = lineWidth * 0.3
capDistance = 0.5 (in normalized 0-1 coords, ~half the canvas)
For each segment i:
  cumDist += distance(points[i-1], points[i])
  t = min(1, cumDist / capDistance)
  segWidth = minWidth + (lineWidth - minWidth) * t
  Draw segment with round lineCap at segWidth
```

### Rough Brush Algorithm
```
Draw normal quadratic path first.
Then for each point, add deterministic jitter:
  jitterX = noise(point.x * 1000 + point.y) * roughness
  jitterY = noise(point.y * 1000 + point.x) * roughness
  roughness = lineWidth * 0.15
Redraw path with jittered points at slightly reduced opacity.
```
Uses simple hash-based pseudo-random for deterministic noise.
