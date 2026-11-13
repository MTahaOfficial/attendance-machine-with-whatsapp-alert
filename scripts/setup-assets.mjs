// Prepares everything the app needs to run offline:
//   1. MediaPipe WASM runtime        -> public/mediapipe/wasm   (fast face tracking)
//   2. MediaPipe BlazeFace model     -> public/models           (downloaded once)
//   3. face-api recognition models   -> public/models/faceapi   (copied from the npm package)
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe/wasm');
const modelDst = join(root, 'public/models/blaze_face_short_range.tflite');
const faceApiSrc = join(root, 'node_modules/@vladmandic/face-api/model');
const faceApiDst = join(root, 'public/models/faceapi');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

if (existsSync(wasmSrc)) {
  mkdirSync(wasmDst, { recursive: true });
  cpSync(wasmSrc, wasmDst, { recursive: true });
  console.log('[meridian] MediaPipe WASM runtime copied to public/mediapipe/wasm');
}

if (existsSync(faceApiSrc)) {
  mkdirSync(faceApiDst, { recursive: true });
  const wanted = ['tiny_face_detector_model', 'face_landmark_68_tiny_model', 'face_recognition_model'];
  let n = 0;
  for (const f of readdirSync(faceApiSrc)) {
    if (wanted.some((w) => f.startsWith(w))) {
      cpSync(join(faceApiSrc, f), join(faceApiDst, f));
      n++;
    }
  }
  console.log(`[meridian] ${n} face-recognition model files copied to public/models/faceapi`);
}

if (!existsSync(modelDst)) {
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    mkdirSync(dirname(modelDst), { recursive: true });
    writeFileSync(modelDst, Buffer.from(await res.arrayBuffer()));
    console.log('[meridian] BlazeFace model downloaded to public/models');
  } catch (e) {
    console.warn(`[meridian] Model download skipped (${e.message}); the app will load it from Google's CDN at runtime.`);
  }
}
