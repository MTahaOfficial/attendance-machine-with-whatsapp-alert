// Unit test for the blink detector with synthetic eye-ratio sequences.   node scripts/test-blink.mjs
import { BlinkDetector } from '../src/engine/liveness.js';
let fail = 0;
const check = (name, got, want) => { const ok = got === want; if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} (got ${got})`); };
const run = (seq, dt = 100, opts) => { const d = new BlinkDetector(opts); let t = 0; for (const e of seq) { d.push(e, t); t += dt; } return d.blinked; };
const noise = (n, base = 0.30, j = 0.015) => Array.from({ length: n }, (_, i) => base + Math.sin(i * 2.3) * j);

check('still photo (steady eyes, jitter) -> no blink', run(noise(60)), false);
check('single clean blink -> blink', run([...noise(8), 0.12, 0.10, 0.18, ...noise(5)]), true);
check('one-frame blink at slow frame rate -> blink', run([...noise(8), 0.11, ...noise(5)], 140), true);
check('eyes held shut 3 s -> not a blink', run([...noise(8), ...Array(30).fill(0.1), ...noise(5)]), false);
check('eyes closed from the start, never reopen -> no blink', run(Array(40).fill(0.1)), false);
check('small wobble (10% dip) -> no blink', run([...noise(8), 0.27, 0.28, ...noise(8)]), false);
check('NaN frames ignored', run([...noise(6), NaN, NaN, 0.1, 0.3, ...noise(4)]), true);
process.exit(fail ? 1 : 0);
