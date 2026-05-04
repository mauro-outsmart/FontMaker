// Brush types: 'normal', 'growing', 'simple', 'original'

export function drawStroke(ctx, points, lineWidth, brushType, ox, oy, w, h) {
  if (points.length < 2) return;
  h = h || w;
  if (brushType === 'original') return; // handled via drawGlyph
  switch (brushType) {
    case 'growing':
      drawGrowing(ctx, points, lineWidth, ox, oy, w, h);
      break;
    case 'simple':
      drawSimple(ctx, points, lineWidth, ox, oy, w, h);
      break;
    default:
      drawNormal(ctx, points, lineWidth, ox, oy, w, h);
      break;
  }
}

// Render a glyph's strokes. For 'original' style, fills all contours as one
// path with even-odd rule so holes (e.g. inside B, O) cut through. For other
// styles, loops drawStroke per stroke.
export function drawGlyph(ctx, strokes, lineWidth, brushType, ox, oy, w, h) {
  h = h || w;
  if (brushType === 'original') {
    drawOriginalGlyph(ctx, strokes, ox, oy, w, h);
    return;
  }
  for (const stroke of strokes) {
    if (stroke.length >= 2) drawStroke(ctx, stroke, lineWidth, brushType, ox, oy, w, h);
  }
}

function drawOriginalGlyph(ctx, strokes, ox, oy, w, h) {
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.beginPath();
  for (const stroke of strokes) {
    if (!stroke || stroke.length < 3) continue;
    ctx.moveTo(ox + stroke[0].x * w, oy + stroke[0].y * h);
    for (let i = 1; i < stroke.length; i++) {
      ctx.lineTo(ox + stroke[i].x * w, oy + stroke[i].y * h);
    }
    ctx.closePath();
  }
  ctx.fill('evenodd');
  ctx.restore();
}

// --- Normal brush: single quadratic curve path ---

function drawNormal(ctx, points, lineWidth, ox, oy, w, h) {
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(ox + points[0].x * w, oy + points[0].y * h);

  for (let i = 1; i < points.length - 1; i++) {
    const xc = ox + (points[i].x + points[i + 1].x) / 2 * w;
    const yc = oy + (points[i].y + points[i + 1].y) / 2 * h;
    ctx.quadraticCurveTo(
      ox + points[i].x * w,
      oy + points[i].y * h,
      xc, yc
    );
  }
  const last = points[points.length - 1];
  ctx.lineTo(ox + last.x * w, oy + last.y * h);
  ctx.stroke();
  ctx.restore();
}

// --- Growing brush: starts thin, grows to full width ---

function drawGrowing(ctx, points, lineWidth, ox, oy, w, h) {
  const minWidth = lineWidth * 0.25;
  const capDist = 0.4; // normalized distance to reach full width

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let cumDist = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const dx = (curr.x - prev.x) * w;
    const dy = (curr.y - prev.y) * h;
    cumDist += Math.sqrt(dx * dx + dy * dy) / w; // normalize by width

    const t = Math.min(1, cumDist / capDist);
    // Ease-out for smoother growth
    const eased = 1 - (1 - t) * (1 - t);
    ctx.lineWidth = minWidth + (lineWidth - minWidth) * eased;

    ctx.beginPath();
    ctx.moveTo(ox + prev.x * w, oy + prev.y * h);
    ctx.lineTo(ox + curr.x * w, oy + curr.y * h);
    ctx.stroke();
  }

  ctx.restore();
}

// --- Simple brush: minimal straight line segments ---

function drawSimple(ctx, points, lineWidth, ox, oy, w, h) {
  // Adaptive subsample — keep ~4-5 points per stroke regardless of length
  const step = Math.max(3, Math.floor(points.length / 4));
  const sampled = [points[0]];
  for (let i = step; i < points.length - 1; i += step) {
    sampled.push(points[i]);
  }
  sampled.push(points[points.length - 1]);

  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(ox + sampled[0].x * w, oy + sampled[0].y * h);
  for (let i = 1; i < sampled.length; i++) {
    ctx.lineTo(ox + sampled[i].x * w, oy + sampled[i].y * h);
  }
  ctx.stroke();
  ctx.restore();
}

