// One Euro filter (Casiez et al. 2012): removes jitter when the target is still,
// but cuts filtering almost to zero when it moves fast — so the reticle doesn't lag.

function smoothingFactor(cutoffHz, dtSec) {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

export class OneEuroFilter {
  constructor(minCutoff = 1.5, beta = 0.02, derivativeCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
    this.reset();
  }

  reset() {
    this.value = null;
    this.derivative = 0;
    this.lastTime = null;
  }

  filter(x, timeSec) {
    if (this.value === null) {
      this.value = x;
      this.lastTime = timeSec;
      return x;
    }
    const dt = Math.max(timeSec - this.lastTime, 1e-3);
    this.lastTime = timeSec;

    const rawDerivative = (x - this.value) / dt;
    const aD = smoothingFactor(this.derivativeCutoff, dt);
    this.derivative = aD * rawDerivative + (1 - aD) * this.derivative;

    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    const a = smoothingFactor(cutoff, dt);
    this.value = a * x + (1 - a) * this.value;
    return this.value;
  }
}
