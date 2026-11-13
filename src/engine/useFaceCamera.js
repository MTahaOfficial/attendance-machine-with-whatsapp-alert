import { useCallback, useEffect, useRef, useState } from 'react';
import { createFaceDetector } from './detector.js';
import { autoZoomFor, coverMapping, drawPlain, drawScene, scopeRadius } from './render.js';
import { FaceTracker } from './tracker.js';

const hasRVFC = typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

export function cameraErrorMessage(err) {
  if (!window.isSecureContext || !navigator.mediaDevices) {
    return 'The camera needs a secure page. Open this app over HTTPS (https://<laptop-ip>:4443) or on http://localhost.';
  }
  switch (err?.name) {
    case 'NotAllowedError':
      return 'Camera permission was denied. Allow camera access in the browser and try again.';
    case 'NotFoundError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
      return 'The camera is in use by another app. Close it and try again.';
    default:
      return err?.message || String(err);
  }
}

/**
 * Camera + fast face tracking (MediaPipe) + drawing, as a reusable hook.
 *
 *   const cam = useFaceCamera({ variant: 'scope', onTick })
 *   <div className="stage"><video ref={cam.videoRef} /><canvas ref={cam.canvasRef} /></div>
 *
 * - variant 'scope' draws the Meridian lens; 'plain' draws a simple selfie view with brackets.
 * - cam.uiRef.current = { accent, label } lets the page recolour the scope (amber, green, ...).
 * - onTick({ ts, video, target, faces }) runs once per camera frame.
 *
 * Unlike the original demo, every exit path (error, stop, unmount mid-start) releases the camera.
 */
export function useFaceCamera({ variant = 'scope', onTick } = {}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const uiRef = useRef({ accent: null, label: null });
  const tickRef = useRef(onTick);
  const runRef = useRef(null);
  const [phase, setPhase] = useState('idle'); // idle | loading | running | error
  const [error, setError] = useState('');
  const [backend, setBackend] = useState('');

  useEffect(() => {
    tickRef.current = onTick;
  });

  const stop = useCallback(() => {
    const run = runRef.current;
    if (!run) return;
    runRef.current = null;
    run.cancelled = true;
    run.cleanups.splice(0).reverse().forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
    setPhase('idle');
  }, []);

  const start = useCallback(async () => {
    if (runRef.current) return;
    const run = { cancelled: false, cleanups: [] };
    runRef.current = run;
    setPhase('loading');
    setError('');

    const aborted = () => {
      if (!run.cancelled) return false;
      run.cleanups.splice(0).reverse().forEach((fn) => {
        try {
          fn();
        } catch {
          /* ignore */
        }
      });
      return true;
    };

    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('insecure'), { name: 'InsecureContext' });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });
      run.cleanups.push(() => stream.getTracks().forEach((t) => t.stop()));
      if (aborted()) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) throw new Error('Camera view is not ready');
      video.srcObject = stream;
      run.cleanups.push(() => {
        video.srcObject = null;
      });
      await video.play();
      if (aborted()) return;

      const { detector, backend: be } = await createFaceDetector();
      run.cleanups.push(() => detector.close());
      if (aborted()) return;
      setBackend(be);

      const tracker = new FaceTracker();
      const ctx = canvas.getContext('2d', { alpha: true });
      const size = { W: 0, H: 0 };
      const resize = () => {
        const box = canvas.parentElement.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        size.W = Math.max(1, Math.round(box.width));
        size.H = Math.max(1, Math.round(box.height));
        canvas.width = Math.round(size.W * dpr);
        canvas.height = Math.round(size.H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(canvas.parentElement);
      run.cleanups.push(() => ro.disconnect());

      const view = { fx: video.videoWidth / 2, fy: video.videoHeight / 2, zoom: 1.5 };
      let lastTs = 0;
      let lastVideoTime = -1;
      let rafId = 0;

      const tick = () => {
        if (run.cancelled) return;
        const fresh = hasRVFC || video.currentTime !== lastVideoTime;
        lastVideoTime = video.currentTime;

        if (video.readyState >= 2 && video.videoWidth && fresh) {
          let ts = performance.now();
          if (ts <= lastTs) ts = lastTs + 0.01;
          lastTs = ts;

          const result = detector.detectForVideo(video, ts);
          const r = tracker.update(result.detections, ts, false);
          const ui = uiRef.current;

          if (variant === 'plain') {
            drawPlain(ctx, video, size.W, size.H, { target: r.target, accent: ui.accent });
          } else {
            const { cover } = coverMapping(video.videoWidth, video.videoHeight, size.W, size.H);
            const R = scopeRadius('lock', size.W, size.H);
            let targetZoom = 1.5;
            if (r.target) {
              view.fx = r.target.cx;
              view.fy = r.target.cy;
              targetZoom = autoZoomFor(r.target.w, cover, R);
            } else {
              view.fx += (video.videoWidth / 2 - view.fx) * 0.08;
              view.fy += (video.videoHeight / 2 - view.fy) * 0.08;
            }
            view.zoom += (targetZoom - view.zoom) * 0.25;
            drawScene(ctx, video, size.W, size.H, {
              mode: 'lock',
              fx: view.fx,
              fy: view.fy,
              zoom: view.zoom,
              faces: r.faces,
              target: r.target,
              targetRaw: r.targetRaw,
              lockAgeMs: r.lockAgeMs,
              now: ts,
              accent: ui.accent,
              label: ui.label,
              hideZoom: true,
            });
          }
          tickRef.current?.({ ts, video, target: r.target, faces: r.faces });
        }
        schedule();
      };
      const schedule = () => {
        if (run.cancelled) return;
        if (hasRVFC) video.requestVideoFrameCallback(tick);
        else rafId = requestAnimationFrame(tick);
      };
      run.cleanups.push(() => cancelAnimationFrame(rafId));
      schedule();
      setPhase('running');
    } catch (err) {
      console.error(err);
      if (runRef.current === run) {
        runRef.current = null;
        run.cancelled = true;
        run.cleanups.splice(0).reverse().forEach((fn) => {
          try {
            fn();
          } catch {
            /* ignore */
          }
        });
        setError(cameraErrorMessage(err));
        setPhase('error');
      }
    }
  }, [variant]);

  useEffect(() => () => stop(), [stop]);

  return { videoRef, canvasRef, uiRef, phase, error, backend, start, stop };
}
