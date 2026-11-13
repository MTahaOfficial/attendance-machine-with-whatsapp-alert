import { OneEuroFilter } from './oneEuro.js';

const LOST_GRACE_MS = 350; // hold the lock through a brief missed detection

function toFace(det) {
  const b = det.boundingBox;
  return {
    x: b.originX,
    y: b.originY,
    w: b.width,
    h: b.height,
    cx: b.originX + b.width / 2,
    cy: b.originY + b.height / 2,
    score: det.categories?.[0]?.score ?? 0,
  };
}

const dist = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy);

/**
 * Picks which face to target and smooths its position.
 * - Sticks to the same face between frames (no hopping between people).
 * - Click/tap selection overrides the pick.
 * - "raw" mode bypasses smoothing entirely for zero filter lag.
 */
export class FaceTracker {
  constructor() {
    this.fx = new OneEuroFilter(1.7, 0.03);
    this.fy = new OneEuroFilter(1.7, 0.03);
    this.fw = new OneEuroFilter(1.0, 0.01);
    this.fh = new OneEuroFilter(1.0, 0.01);
    this.target = null;
    this.lastSeen = -Infinity;
    this.lockedAt = 0;
    this.preferPoint = null; // video-space point chosen by the user
  }

  selectNear(vx, vy) {
    this.preferPoint = { cx: vx, cy: vy };
  }

  resetFilters() {
    this.fx.reset();
    this.fy.reset();
    this.fw.reset();
    this.fh.reset();
  }

  update(detections, timeMs, raw) {
    const faces = detections.map(toFace);
    let pick = null;

    if (faces.length) {
      if (this.preferPoint) {
        pick = faces.reduce((a, b) => (dist(a, this.preferPoint) < dist(b, this.preferPoint) ? a : b));
        this.preferPoint = null;
        this.resetFilters(); // snap straight to the newly chosen face
        this.lockedAt = timeMs;
      } else if (this.target) {
        const nearest = faces.reduce((a, b) => (dist(a, this.target) < dist(b, this.target) ? a : b));
        if (dist(nearest, this.target) < Math.max(this.target.w, 40) * 1.5) pick = nearest;
      }
      if (!pick) {
        pick = faces.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
        this.resetFilters();
        this.lockedAt = timeMs;
      }
    }

    if (pick) {
      const t = timeMs / 1000;
      // Always run the filters so switching raw ↔ smooth is seamless.
      const sx = this.fx.filter(pick.cx, t);
      const sy = this.fy.filter(pick.cy, t);
      const sw = this.fw.filter(pick.w, t);
      const sh = this.fh.filter(pick.h, t);
      this.target = raw ? { ...pick } : { ...pick, cx: sx, cy: sy, w: sw, h: sh, x: sx - sw / 2, y: sy - sh / 2 };
      this.lastSeen = timeMs;
    } else if (this.target && timeMs - this.lastSeen > LOST_GRACE_MS) {
      this.target = null;
      this.resetFilters();
    }

    return {
      faces,
      target: this.target,
      targetRaw: pick,
      detectedThisFrame: !!pick,
      lockAgeMs: this.target ? timeMs - this.lockedAt : 0,
    };
  }
}
