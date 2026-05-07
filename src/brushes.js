// Brush types: 'normal' (Handdrawn round), 'growing' (Handdrawn paint),
// 'original', 'original-italic' (Original sheared at gen time)

export function isOriginalStyle(brushType) {
  return brushType === 'original' || brushType === 'original-italic';
}

export function drawStroke(ctx, points, lineWidth, brushType, ox, oy, w, h) {
  if (points.length < 2) return;
  h = h || w;
  if (isOriginalStyle(brushType)) return; // handled via drawGlyph
  switch (brushType) {
    case 'growing':
      drawGrowing(ctx, points, lineWidth, ox, oy, w, h);
      break;
    default:
      drawNormal(ctx, points, lineWidth, ox, oy, w, h);
      break;
  }
}

// Render a glyph's strokes. For 'original'/'original-italic', fills all
// contours as one path with even-odd rule so holes (e.g. inside B, O) cut
// through. For other styles, loops drawStroke per stroke.
export function drawGlyph(ctx, strokes, lineWidth, brushType, ox, oy, w, h) {
  h = h || w;
  if (isOriginalStyle(brushType)) {
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

  // If the start and end points sit within ~5% of the canvas of each other
  // (e.g. a skeleton-traced "O", "0", or the bowl of a "B"), treat the path
  // as a closed loop and use closePath() so the rendered ring is continuous
  // instead of leaving a visible notch where the trace ended.
  const start = points[0];
  const end = points[points.length - 1];
  const seDist = Math.hypot(end.x - start.x, end.y - start.y);
  const isClosed = points.length >= 4 && seDist < 0.05;

  ctx.beginPath();
  ctx.moveTo(ox + start.x * w, oy + start.y * h);

  for (let i = 1; i < points.length - 1; i++) {
    const xc = ox + (points[i].x + points[i + 1].x) / 2 * w;
    const yc = oy + (points[i].y + points[i + 1].y) / 2 * h;
    ctx.quadraticCurveTo(
      ox + points[i].x * w,
      oy + points[i].y * h,
      xc, yc
    );
  }
  ctx.lineTo(ox + end.x * w, oy + end.y * h);
  if (isClosed) ctx.closePath();
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

  // For closed-loop strokes (O, 0, bowls of B/D/P/etc.) append a final
  // segment back to the start so the ring renders without a notch.
  const start = points[0];
  const end = points[points.length - 1];
  const seDist = Math.hypot(end.x - start.x, end.y - start.y);
  const closingPoints = (points.length >= 4 && seDist < 0.05)
    ? points.concat([points[0]])
    : points;

  let cumDist = 0;

  for (let i = 1; i < closingPoints.length; i++) {
    const prev = closingPoints[i - 1];
    const curr = closingPoints[i];
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

