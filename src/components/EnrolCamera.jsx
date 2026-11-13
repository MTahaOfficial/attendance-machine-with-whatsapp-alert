import { useEffect, useRef, useState } from 'react';
import { ACCENT } from '../engine/render.js';
import { analyseFace, descriptorDistance, faceThumbnail, loadFaceId } from '../engine/faceId.js';
import { useFaceCamera } from '../engine/useFaceCamera.js';
import { CameraIcon, CheckIcon } from './Icons.jsx';
import { Modal, useToast } from './ui.jsx';

const MIN_FACE = 0.16; // face must be at least 16% of the frame width
const STEPS = ['Look straight at the camera', 'Turn your head slightly to the left', 'Turn your head slightly to the right'];

/**
 * Takes 3 face samples (slightly different angles) and returns { descriptors, photo }.
 * Several samples make later recognition far more reliable than a single photo.
 */
export default function EnrolCamera({ onDone, onClose }) {
  const toast = useToast();
  const [models, setModels] = useState('loading');
  const [shots, setShots] = useState([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const readyRef = useRef(false);

  const onTick = ({ target, video }) => {
    const ok = !!target && target.w / video.videoWidth >= MIN_FACE;
    if (ok !== readyRef.current) {
      readyRef.current = ok;
      setReady(ok);
      cam.uiRef.current.accent = ok ? ACCENT.green : null;
    }
  };
  const cam = useFaceCamera({ variant: 'plain', onTick });

  useEffect(() => {
    loadFaceId()
      .then(() => setModels('ready'))
      .catch((e) => {
        console.error(e);
        setModels('error');
      });
    cam.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capture = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const video = cam.videoRef.current;
      const r = await analyseFace(video, { descriptor: true });
      if (!r) throw new Error('No face found - look straight at the camera');
      if (r.box.width / video.videoWidth < MIN_FACE) throw new Error('Move a little closer to the camera');
      if (shots.length && descriptorDistance(shots[0].descriptor, r.descriptor) > 0.6) {
        throw new Error("That doesn't look like the same person - only one person in frame, please");
      }
      setShots((s) => [...s, { descriptor: r.descriptor, thumb: s.length ? null : faceThumbnail(video, r.box) }]);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const complete = shots.length >= STEPS.length;
  const canCapture = ready && models === 'ready' && cam.phase === 'running' && !busy && !complete;

  return (
    <Modal
      title="Enrol face"
      wide
      onClose={onClose}
      closeOnBackdrop={false}
      footer={
        <>
          {shots.length > 0 && (
            <button className="btn" onClick={() => setShots([])}>
              Retake
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!complete}
            onClick={() => onDone({ descriptors: shots.map((s) => s.descriptor), photo: shots[0].thumb })}
          >
            <CheckIcon size={17} /> Use these photos
          </button>
        </>
      }
    >
      <div className="enrol-stage">
        <video ref={cam.videoRef} playsInline muted />
        <canvas ref={cam.canvasRef} />
        {cam.phase === 'error' && (
          <div className="cam-error">
            <div className="box">
              <p style={{ color: '#ff8a8a' }}>{cam.error}</p>
              <button className="btn primary" onClick={cam.start}>
                Try again
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="instruction">
        {complete ? 'All 3 photos captured ✓' : models === 'loading' ? 'Loading face models…' : models === 'error' ? 'Could not load the face models' : STEPS[shots.length]}
      </div>
      <p className="muted" style={{ textAlign: 'center', margin: '0 0 6px', fontSize: 13 }}>
        {complete ? 'Press “Use these photos”, or Retake.' : ready ? 'Face found - press the camera button.' : 'Position your face inside the oval, in good light.'}
      </p>

      <div className="shots">
        {STEPS.map((label, i) => (
          <div key={label} className={`shot ${shots[i] ? 'done' : i === shots.length ? 'current' : ''}`}>
            {shots[i]?.thumb ? <img src={shots[i].thumb} alt="" /> : shots[i] ? <CheckIcon size={26} /> : i + 1}
          </div>
        ))}
        <div className="grow" />
        <div style={{ display: 'grid', placeItems: 'center' }}>
          <button className="capture-btn" onClick={capture} disabled={!canCapture} aria-label="Capture photo" title="Capture photo">
            <CameraIcon size={28} />
          </button>
        </div>
      </div>
    </Modal>
  );
}
