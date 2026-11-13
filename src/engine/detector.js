import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

const BASE = import.meta.env.BASE_URL;
const WASM_PATH = `${BASE}mediapipe/wasm`;
const LOCAL_MODEL = `${BASE}models/blaze_face_short_range.tflite`;
const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

// Prefer the model downloaded by `npm install` (offline); fall back to Google's CDN.
async function resolveModelPath() {
  try {
    const res = await fetch(LOCAL_MODEL, { method: 'HEAD' });
    const type = res.headers.get('content-type') || '';
    if (res.ok && !type.includes('text/html')) return LOCAL_MODEL;
  } catch {
    /* fall through */
  }
  return REMOTE_MODEL;
}

/**
 * Creates a MediaPipe BlazeFace detector. Tries the GPU (WebGL) delegate first —
 * typically 1–5 ms per frame — and falls back to CPU (WASM + SIMD).
 */
export async function createFaceDetector() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const modelAssetPath = await resolveModelPath();

  for (const delegate of ['GPU', 'CPU']) {
    try {
      const detector = await FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.5,
        minSuppressionThreshold: 0.3,
      });
      return { detector, backend: delegate };
    } catch (err) {
      if (delegate === 'CPU') throw err;
      console.warn('GPU delegate unavailable, falling back to CPU:', err);
    }
  }
}
