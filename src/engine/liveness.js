// Blink-based liveness check.
// A printed photo or a still image on a phone never blinks, so requiring a blink before the face is
// matched defeats the most common "hold up a photo" attempt. (A pre-recorded VIDEO of the person
// blinking could still fool it - for a hard guarantee you would add a depth / IR camera.)

/** Eye aspect ratio (Soukupova & Cech 2016) for one eye given its 6 landmark points. */
function eyeAspect(p) {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const horizontal = d(p[0], p[3]);
  return horizontal ? (d(p[1], p[5]) + d(p[2], p[4])) / (2 * horizontal) : NaN;
}

/** Average eye aspect ratio from the 68-point face landmarks (indices 36-41 left eye, 42-47 right eye). */
export function earFromLandmarks(points) {
  const left = eyeAspect(points.slice(36, 42));
  const right = eyeAspect(points.slice(42, 48));
  return (left + right) / 2;
}

/** Rough head turn from 68 landmarks: ~0 facing the camera, negative/positive when turned. */
export function yawFromLandmarks(points) {
  const jawL = points[0];
  const jawR = points[16];
  const nose = points[30];
  const width = jawR.x - jawL.x;
  return width ? (nose.x - (jawL.x + jawR.x) / 2) / width : 0;
}

export class BlinkDetector {
  /**
   * @param closeRatio  eyes count as closed below this fraction of their open size (0.85 = a 15% drop;
   *                    a real blink drops 25-60%, camera noise on a still photo stays under ~8%)
   * @param calibration number of initial (open-eyed) frames used to learn the open size
   * @param maxClosedMs a closure longer than this is eyes-shut, not a blink
   */
  constructor({ closeRatio = 0.85, calibration = 4, maxClosedMs = 1500 } = {}) {
    this.closeRatio = closeRatio;
    this.calibration = calibration;
    this.maxClosedMs = maxClosedMs;
    this.reset();
  }

  reset() {
    this.open = 0; // running estimate of the open-eye ratio
    this.frames = 0;
    this.closedSince = null;
    this.heldShut = false; // current closure lasted too long to count as a blink
    this.blinked = false;
  }

  /** Feed one frame's eye ratio. Returns true once a complete blink (open -> closed -> open) has been seen. */
  push(ear, tMs) {
    if (this.blinked || !Number.isFinite(ear)) return this.blinked;
    if (this.frames < this.calibration) {
      this.open = this.frames === 0 ? ear : this.open * 0.6 + ear * 0.4;
      this.frames++;
      return false;
    }
    const closed = ear < this.open * this.closeRatio;
    if (closed) {
      if (this.closedSince == null) this.closedSince = tMs;
      else if (tMs - this.closedSince > this.maxClosedMs) this.heldShut = true; // eyes held shut, not a blink
    } else {
      if (this.closedSince != null && !this.heldShut) this.blinked = true;
      this.closedSince = null;
      this.heldShut = false;
      this.open = this.open * 0.9 + ear * 0.1;
    }
    return this.blinked;
  }

  /** True while the eyes look open (safe moment to take the face sample). */
  eyesOpen(ear) {
    return this.frames >= this.calibration && ear >= this.open * 0.88;
  }
}
