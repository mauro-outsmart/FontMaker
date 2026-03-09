// Brush types: 'normal', 'growing', 'simple'

export function drawStroke(ctx, points, lineWidth, brushType, ox, oy, w, h) {
  if (points.length < 2) return;
  h = h || w;
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
  // Aggressive subsample — keep every 20th point plus first and last
  const step = 20;
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

