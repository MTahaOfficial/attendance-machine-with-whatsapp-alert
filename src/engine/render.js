const ACCENT_DEFAULT = '#ffffff';
export const ACCENT = { red: '#ff6b6b', amber: '#ffc247', green: '#3ddc97', cyan: '#5ec8f2' };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** '#rrggbb' + alpha -> 'rgba(...)' so the accent colour can change (red scanning, green verified...). */
function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Maps video pixels to screen pixels for a mirrored, object-fit:cover video. */
export function coverMapping(vw, vh, W, H) {
  const cover = Math.max(W / vw, H / vh);
  return {
    cover,
    toScreen: (vx, vy) => [W / 2 - (vx - vw / 2) * cover, H / 2 + (vy - vh / 2) * cover],
    toVideo: (sx, sy) => [vw / 2 - (sx - W / 2) / cover, vh / 2 + (sy - H / 2) / cover],
  };
}

export function scopeRadius(mode, W, H) {
  return Math.min(W, H) * (mode === 'lock' ? 0.42 : 0.2);
}

export function autoZoomFor(faceW, cover, R) {
  return clamp((0.9 * R) / (faceW * cover), 1.5, 8);
}

function brackets(ctx, x1, y1, x2, y2, len, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const [x, y, dx, dy] of [
    [x1, y1, 1, 1],
    [x2, y1, -1, 1],
    [x1, y2, 1, -1],
    [x2, y2, -1, -1],
  ]) {
    ctx.moveTo(x, y + dy * len);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * len, y);
  }
  ctx.stroke();
}

function drawReticle(ctx, sx, sy, R, locked, t, RED) {
  const thin = Math.max(1, R * 0.0045);
  const thick = Math.max(3, R * 0.03);
  const postStart = R * 0.42;

  ctx.strokeStyle = '#050505';
  ctx.lineCap = 'butt';

  // Fine crosshair
  ctx.lineWidth = thin;
  ctx.beginPath();
  ctx.moveTo(sx - R, sy);
  ctx.lineTo(sx + R, sy);
  ctx.moveTo(sx, sy - R);
  ctx.lineTo(sx, sy + R);
  ctx.stroke();

  // Heavy duplex posts from the edge inward
  ctx.lineWidth = thick;
  ctx.beginPath();
  ctx.moveTo(sx - R, sy);
  ctx.lineTo(sx - postStart, sy);
  ctx.moveTo(sx + postStart, sy);
  ctx.lineTo(sx + R, sy);
  ctx.moveTo(sx, sy + postStart);
  ctx.lineTo(sx, sy + R);
  ctx.moveTo(sx, sy - R);
  ctx.lineTo(sx, sy - postStart);
  ctx.stroke();

  // Stadia ticks
  ctx.lineWidth = thin;
  ctx.beginPath();
  for (let i = 1; i <= 3; i++) {
    const d = (postStart / 4) * i;
    const l = R * (i === 2 ? 0.03 : 0.018);
    for (const s of [-1, 1]) {
      ctx.moveTo(sx + s * d, sy - l);
      ctx.lineTo(sx + s * d, sy + l);
      ctx.moveTo(sx - l, sy + s * d);
      ctx.lineTo(sx + l, sy + s * d);
    }
  }
  ctx.stroke();

  // Centre target
  const r = R * 0.032;
  if (locked) {
    ctx.shadowColor = RED;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = RED;
    ctx.lineWidth = Math.max(1.5, R * 0.007);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(1.5, R * 0.007), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  } else {
    const pulse = 0.5 + 0.5 * Math.sin(t / 180);
    ctx.strokeStyle = alpha(RED, 0.35 + 0.4 * pulse);
    ctx.lineWidth = Math.max(1, R * 0.005);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * Draws one frame: the magnified lens view, reticle, lock indicators and scope body.
 * The un-magnified background is the <video> element behind this canvas.
 */
export function drawScene(ctx, video, W, H, s) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  ctx.clearRect(0, 0, W, H);
  if (!vw || !vh) return;

  const { cover, toScreen } = coverMapping(vw, vh, W, H);
  const R = scopeRadius(s.mode, W, H);
  const [sx, sy] = s.mode === 'lock' ? [W / 2, H / 2] : toScreen(s.fx, s.fy);
  const scale = cover * s.zoom;
  const locked = !!s.target;
  const RED = s.accent || ACCENT_DEFAULT;

  // Markers on every other detected face (on the background view)
  if (s.mode === 'track') {
    for (const f of s.faces) {
      if (s.targetRaw && f.cx === s.targetRaw.cx && f.cy === s.targetRaw.cy) continue;
      const [ax, ay] = toScreen(f.x + f.w, f.y);
      const [bx, by] = toScreen(f.x, f.y + f.h);
      brackets(ctx, ax, ay, bx, by, Math.min(bx - ax, by - ay) * 0.2, 'rgba(255,255,255,0.75)', 1.5);
    }
  }

  // Soft vignette around the scope
  const far = Math.hypot(W, H);
  const outer = ctx.createRadialGradient(sx, sy, R * 1.15, sx, sy, far * 0.75);
  outer.addColorStop(0, 'rgba(0,0,0,0)');
  outer.addColorStop(1, s.mode === 'lock' ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.55)');
  ctx.fillStyle = outer;
  ctx.fillRect(0, 0, W, H);

  // ---- Lens contents ----
  ctx.save();
  ctx.beginPath();
  ctx.arc(sx, sy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#000';
  ctx.fillRect(sx - R, sy - R, R * 2, R * 2);

  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(-scale, scale); // mirrored, magnified around the aim point
  ctx.translate(-s.fx, -s.fy);
  ctx.drawImage(video, 0, 0, vw, vh);
  ctx.restore();

  // Glass vignette + faint coating tint
  const lens = ctx.createRadialGradient(sx, sy, R * 0.55, sx, sy, R);
  lens.addColorStop(0, 'rgba(0,0,0,0)');
  lens.addColorStop(0.75, 'rgba(0,0,0,0.25)');
  lens.addColorStop(1, 'rgba(0,0,0,0.95)');
  ctx.fillStyle = lens;
  ctx.fillRect(sx - R, sy - R, R * 2, R * 2);

  // Target brackets around the locked face (inside the lens)
  if (locked) {
    const t = s.target;
    const xa = sx - scale * (t.x + t.w - s.fx);
    const xb = sx - scale * (t.x - s.fx);
    const ya = sy + scale * (t.y - s.fy);
    const yb = sy + scale * (t.y + t.h - s.fy);
    const len = Math.min(xb - xa, yb - ya) * 0.18;
    ctx.shadowColor = RED;
    ctx.shadowBlur = 8;
    brackets(ctx, xa, ya, xb, yb, len, RED, Math.max(2, R * 0.006));
    ctx.shadowBlur = 0;
  }

  drawReticle(ctx, sx, sy, R, locked, s.now, RED);

  // Acquisition flash
  if (locked && s.lockAgeMs < 350) {
    const k = s.lockAgeMs / 350;
    ctx.strokeStyle = alpha(RED, 1 - k);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx, sy, R * (0.08 + 0.5 * k), 0, Math.PI * 2);
    ctx.stroke();
  }

  // Readout inside the glass
  const fs = Math.max(10, R * 0.045);
  ctx.font = `600 ${fs}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = locked ? RED : alpha(RED, 0.8);
  ctx.fillText(
    s.label || (locked ? `LOCK ${Math.round((s.target.score || 0) * 100)}%` : 'SCANNING'),
    sx + R * 0.12,
    sy + R * 0.1,
  );
  if (!s.hideZoom) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(`${s.zoom.toFixed(1)}x`, sx + R * 0.12, sy - R * 0.1 - fs);
  }
  ctx.restore();

  // ---- Scope body (tube) ----
  const tube = R * 0.16;
  const ring = ctx.createRadialGradient(sx, sy, R, sx, sy, R + tube);
  ring.addColorStop(0, '#000');
  ring.addColorStop(0.55, '#0d0d0f');
  ring.addColorStop(0.85, '#26272b');
  ring.addColorStop(1, 'rgba(10,10,12,0)');
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(sx, sy, R + tube, 0, Math.PI * 2);
  ctx.arc(sx, sy, R, 0, Math.PI * 2, true);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(sx, sy, R + tube * 0.82, 0, Math.PI * 2);
  ctx.stroke();

  // Scanning sweep on the rim
  if (!locked) {
    const a = (s.now / 600) % (Math.PI * 2);
    ctx.strokeStyle = alpha(RED, 0.55);
    ctx.lineWidth = Math.max(2, R * 0.008);
    ctx.beginPath();
    ctx.arc(sx, sy, R + tube * 0.35, a, a + 0.6);
    ctx.stroke();
  }
}

/**
 * Plain selfie overlay (no scope): corner brackets around the face + an oval guide.
 * Used by the enrolment camera, where the person must see themselves clearly.
 */
export function drawPlain(ctx, video, W, H, s) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  ctx.clearRect(0, 0, W, H);
  if (!vw || !vh) return;
  const { toScreen } = coverMapping(vw, vh, W, H);
  const color = s.accent || ACCENT_DEFAULT;

  // Oval guide
  ctx.save();
  ctx.strokeStyle = alpha(color, 0.5);
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(W / 2, H / 2, Math.min(W, H) * 0.27, Math.min(W, H) * 0.36, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  if (s.target) {
    const t = s.target;
    const [ax, ay] = toScreen(t.x + t.w, t.y);
    const [bx, by] = toScreen(t.x, t.y + t.h);
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    brackets(ctx, ax, ay, bx, by, Math.min(bx - ax, by - ay) * 0.2, color, 3);
    ctx.shadowBlur = 0;
  }
}
