// Face recognition: turns a face in the camera image into a 128-number "descriptor".
// Two photos of the same person give descriptors that are close together (distance < ~0.5);
// different people are far apart (> ~0.8). Matching itself happens on the server.
import * as faceapi from '@vladmandic/face-api';
import { earFromLandmarks, yawFromLandmarks } from './liveness.js';

const MODEL_URL = `${import.meta.env.BASE_URL}models/faceapi`;

let loading = null;

/** Loads the TensorFlow backend and the three small models (detector, landmarks, recogniser). Safe to call repeatedly. */
export function loadFaceId() {
  if (!loading) {
    loading = (async () => {
      const tf = faceapi.tf;
      try {
        await tf.setBackend('webgl');
        await tf.ready();
      } catch {
        await tf.setBackend('cpu');
        await tf.ready();
      }
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      return tf.getBackend();
    })().catch((e) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

const DETECTOR_OPTIONS = () => new faceapi.TinyFaceDetectorOptions({ inputSize: 256, scoreThreshold: 0.5 });

/**
 * Looks at the current video frame. Returns null when no face is found, otherwise
 * { box, score, ear, yaw, descriptor } - descriptor only when `descriptor: true` (it is the slow part).
 */
export async function analyseFace(video, { descriptor = false } = {}) {
  let task = faceapi.detectSingleFace(video, DETECTOR_OPTIONS()).withFaceLandmarks(true);
  if (descriptor) task = task.withFaceDescriptor();
  const r = await task;
  if (!r) return null;
  const pts = r.landmarks.positions;
  const b = r.detection.box;
  return {
    box: { x: b.x, y: b.y, width: b.width, height: b.height },
    score: r.detection.score,
    ear: earFromLandmarks(pts),
    yaw: yawFromLandmarks(pts),
    descriptor: r.descriptor ? Array.from(r.descriptor) : null,
  };
}

export function descriptorDistance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

export function averageDescriptors(list) {
  const out = new Array(128).fill(0);
  for (const d of list) for (let i = 0; i < 128; i++) out[i] += d[i] / list.length;
  return out;
}

/** Small square JPEG of the face (shown on the kiosk "Welcome" card and in lists). */
export function faceThumbnail(video, box, size = 128) {
  const pad = box.width * 0.45;
  const side = Math.max(box.width, box.height) + pad * 2;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const sx = Math.max(0, Math.min(video.videoWidth - side, cx - side / 2));
  const sy = Math.max(0, Math.min(video.videoHeight - side, cy - side / 2));
  const s = Math.min(side, video.videoWidth, video.videoHeight);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').drawImage(video, sx, sy, s, s, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.82);
}

// ---- eye openness on every camera frame (cheap: only the small landmark network, on a 112 px face crop)
const eyeCanvas = document.createElement('canvas');
eyeCanvas.width = eyeCanvas.height = 112;
const eyeCtx = eyeCanvas.getContext('2d', { willReadFrequently: true });

/** Standard deviation of brightness in a box: high for an open eye (dark iris vs white), low for a closed lid. */
function contrastIn(ctx, cx, cy, halfW, halfH) {
  const x = Math.max(0, Math.round(cx - halfW));
  const y = Math.max(0, Math.round(cy - halfH));
  const w = Math.min(112 - x, Math.round(halfW * 2));
  const h = Math.min(112 - y, Math.round(halfH * 2));
  if (w < 4 || h < 4) return 0;
  const d = ctx.getImageData(x, y, w, h).data;
  let sum = 0;
  let sum2 = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    sum += l;
    sum2 += l * l;
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sum2 / n - mean * mean));
}

/**
 * Eye "openness" for the face at `box` ({x,y,w,h} in video pixels, e.g. the MediaPipe target).
 * It combines two cues so a blink is unmistakable:
 *   - eye aspect ratio from the 68 landmarks (the eye gets flatter when it closes)
 *   - contrast inside a fixed-size window around each eye (an open eye has a dark iris and white sclera;
 *     a closed eyelid is plain skin)
 * The value has no unit - only its relative drop matters. It is far cheaper than analyseFace(),
 * so it can run on every frame and never miss a fast blink.
 */
export async function eyeAspectOf(video, box) {
  const padX = box.w * 0.12;
  const padY = box.h * 0.12;
  const sx = Math.max(0, box.x - padX);
  const sy = Math.max(0, box.y - padY);
  const sw = Math.min(video.videoWidth - sx, box.w + padX * 2);
  const sh = Math.min(video.videoHeight - sy, box.h + padY * 2);
  if (sw <= 8 || sh <= 8) return NaN;
  eyeCtx.drawImage(video, sx, sy, sw, sh, 0, 0, 112, 112);
  const lm = await faceapi.nets.faceLandmark68TinyNet.detectLandmarks(eyeCanvas);
  const pts = lm.positions;
  const ear = earFromLandmarks(pts);

  let contrast = 0;
  for (const idx of [[36, 42], [42, 48]]) {
    const eye = pts.slice(idx[0], idx[1]);
    const cx = eye.reduce((a, p) => a + p.x, 0) / 6;
    const cy = eye.reduce((a, p) => a + p.y, 0) / 6;
    const width = Math.hypot(eye[3].x - eye[0].x, eye[3].y - eye[0].y);
    contrast += contrastIn(eyeCtx, cx, cy, width * 0.6, width * 0.3) / 2;
  }
  const openness = ear * contrast;
  if (typeof window !== 'undefined' && window.__fsDebugEars) window.__fsDebugEars.push([Math.round(performance.now()), +openness.toFixed(3), +ear.toFixed(3), +contrast.toFixed(2)]);
  return openness;
}

// Test hook (only active when a test page sets window.__fsDebugEars before the app loads).
if (typeof window !== 'undefined' && window.__fsDebugEars) window.__fsFaceId = { eyeAspectOf, analyseFace, loadFaceId };
