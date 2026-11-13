import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { CameraIcon, CheckIcon, FullscreenIcon, MuteIcon, VolumeIcon, XIcon } from '../../components/Icons.jsx';
import { Avatar, fmtTime, lsGet, lsSet, usePolling } from '../../components/ui.jsx';
import { analyseFace, averageDescriptors, descriptorDistance, eyeAspectOf, loadFaceId } from '../../engine/faceId.js';
import { BlinkDetector } from '../../engine/liveness.js';
import { ACCENT } from '../../engine/render.js';
import { useFaceCamera } from '../../engine/useFaceCamera.js';

const MIN_FACE = 0.16; // face must fill at least 16% of the frame width ("step closer")
const HOLD_MS = 600; // face must stay put this long before a check starts
const ATTEMPT_TIMEOUT_MS = 12000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What the scope shows for each stage: [colour, label on the lens]
const SCOPE = {
  idle: [null, null],
  hold: [ACCENT.amber, 'HOLD STILL'],
  blink: [ACCENT.amber, 'BLINK NOW'],
  scan: [ACCENT.amber, 'VERIFYING'],
  sending: [ACCENT.amber, 'CHECKING'],
  matched: [ACCENT.green, 'VERIFIED'],
  repeat: [ACCENT.cyan, 'ALREADY LOGGED'],
  unknown: [ACCENT.red, 'NOT RECOGNISED'],
  error: [ACCENT.red, 'TRY AGAIN'],
};

const PROMPT = {
  loading: ['Getting ready…', ''],
  idle: ['Step up to the camera', 'Look at the screen to mark your attendance'],
  closer: ['Move a little closer', ''],
  hold: ['Hold still…', ''],
  blink: ['Now blink once', 'This proves you are a real person'],
  scan: ['Verifying…', ''],
  sending: ['Checking…', ''],
};

// Test hook: when a test sets window.__fsDebugEars = [], the attempt logic reports what it is doing.
const dbg = (...a) => typeof window !== 'undefined' && window.__fsDebugLog?.push([Math.round(performance.now()), ...a]);

let audioCtx = null;
function beep(good) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g);
    g.connect(audioCtx.destination);
    o.type = 'sine';
    const t = audioCtx.currentTime;
    o.frequency.setValueAtTime(good ? 880 : 220, t);
    if (good) o.frequency.setValueAtTime(1175, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (good ? 0.35 : 0.5));
    o.start(t);
    o.stop(t + 0.55);
  } catch {
    /* audio is optional */
  }
}

function speak(text) {
  try {
    window.speechSynthesis?.cancel();
    window.speechSynthesis?.speak(new SpeechSynthesisUtterance(text));
  } catch {
    /* optional */
  }
}

export default function Verify() {
  const wrapRef = useRef(null);
  const [models, setModels] = useState('loading'); // loading | ready | error
  const [stage, setStageState] = useState('idle');
  const [hint, setHint] = useState('');
  const [result, setResult] = useState(null);
  const [counts, setCounts] = useState(null);
  const [sound, setSound] = useState(lsGet('fs_sound') !== '0');
  const [settings, setSettings] = useState(null);

  // Everything the per-frame loop needs lives in refs so it never goes stale.
  const m = useRef({ busy: false, needAbsence: false, lastSeen: 0, faceSince: 0, cooldownUntil: 0, alive: true, stage: 'idle', small: false, target: null, lostSince: 0 });
  const settingsRef = useRef(null);
  const modelsRef = useRef('loading');
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const setStage = useCallback((s) => {
    dbg('stage', s);
    if (m.current.stage === s) return;
    m.current.stage = s;
    const [accent, label] = SCOPE[s] || SCOPE.idle;
    cam.uiRef.current.accent = accent;
    cam.uiRef.current.label = label;
    setStageState(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshCounts = useCallback(() => api('/c/summary').then(setCounts).catch(() => {}), []);
  const loadSettings = useCallback(
    () =>
      api('/c/settings').then((r) => {
        settingsRef.current = r.settings;
        setSettings(r.settings);
      }),
    [],
  );
  usePolling(refreshCounts, 20000);

  // ------------------------------------------------------------------ one verification attempt
  const showResult = useCallback(
    async (res) => {
      const mm = m.current;
      const kind = res.result;
      setResult(res);
      setStage(SCOPE[kind] ? kind : 'error');
      const good = kind === 'matched';
      if (soundRef.current) {
        beep(good || kind === 'repeat');
        if (good && settingsRef.current?.voice) speak(res.kind === 'in' ? `Welcome ${res.participant.name}` : `Goodbye ${res.participant.name}`);
      }
      if (good) refreshCounts();
      await sleep(good ? 3500 : kind === 'repeat' ? 2800 : 2500);
      setResult(null);
      mm.needAbsence = kind === 'matched' || kind === 'repeat'; // wait until the person leaves
      mm.cooldownUntil = performance.now() + 800;
      mm.faceSince = 0;
      setStage('idle');
    },
    [refreshCounts, setStage],
  );

  const runAttempt = useCallback(
    async (video) => {
      const mm = m.current;
      const st = settingsRef.current;
      const needBlink = false; // blink check removed
      const blink = new BlinkDetector();
      const samples = [];
      let blinked = !needBlink;
      const t0 = performance.now();
      setStage(needBlink ? 'blink' : 'scan');
      dbg('attempt-start');

      // Phase 1 - blink: watch the eyes on EVERY camera frame (a blink lasts only ~150-300 ms).
      while (mm.alive && !blinked) {
        const now = performance.now();
        if (mm.lostSince && now - mm.lostSince > 1500) {
          dbg('walked-away', Math.round(now - mm.lostSince));
          setStage('idle'); // the tracker has reported "no face" for 1.5 s: person walked away
          return;
        }
        if (now - t0 > ATTEMPT_TIMEOUT_MS) {
          dbg('no-blink-timeout');
          return showResult({ result: 'error', title: 'No blink detected', message: 'Look at the camera and blink once, naturally.' });
        }
        const tg = mm.target;
        if (!tg || tg.w / video.videoWidth < MIN_FACE) {
          await sleep(15);
          continue;
        }
        let ear;
        try {
          ear = await eyeAspectOf(video, tg);
        } catch (e) {
          console.error(e);
          return showResult({ result: 'error', message: 'Face analysis failed - reload the page' });
        }
        await sleep(0); // hand the thread back so React can repaint the prompt ("Now blink once")
        if (blink.push(ear, performance.now())) {
          dbg('blink-detected');
          blinked = true;
          setStage('scan');
        }
      }
      if (blinked && needBlink) await sleep(250); // let the eyes fully reopen before taking the sample

      // Phase 2 - take two face samples (the slow, accurate recogniser) and average them.
      while (mm.alive && blinked) {
        const now = performance.now();
        if (mm.lostSince && now - mm.lostSince > 1500) {
          setStage('idle');
          return;
        }
        if (now - t0 > ATTEMPT_TIMEOUT_MS + 8000) {
          return showResult({ result: 'error', title: 'Could not get a clear view', message: 'Please look straight at the camera and try again.' });
        }
        let r;
        try {
          r = await analyseFace(video, { descriptor: true });
        } catch (e) {
          console.error(e);
          return showResult({ result: 'error', message: 'Face analysis failed - reload the page' });
        }
        if (!r || r.box.width / video.videoWidth < MIN_FACE) {
          await sleep(30);
          continue;
        }
        samples.push(r.descriptor);
        if (samples.length === 2 && descriptorDistance(samples[0], samples[1]) > 0.45) samples.shift(); // movement blur - retake
        if (samples.length >= 2) break;
      }
      if (!mm.alive) return;

      setStage('sending');
      try {
        const res = await api('/c/verify', { method: 'POST', body: { descriptor: averageDescriptors(samples), liveness: needBlink } });
        await showResult(res);
      } catch (err) {
        if (err.status === 400) loadSettings().catch(() => {}); // settings changed on the server
        await showResult({ result: 'error', message: err.message });
      }
    },
    [loadSettings, setStage, showResult],
  );

  // ------------------------------------------------------------------ per-camera-frame logic
  const onTick = useCallback(
    ({ ts, video, target }) => {
      const mm = m.current;
      mm.target = target;
      mm.lostSince = target ? 0 : mm.lostSince || ts; // when the tracker first reported "no face"
      if (target) mm.lastSeen = ts;
      else if (ts - mm.lastSeen > 1200) {
        mm.needAbsence = false;
        mm.faceSince = 0;
      }
      if (mm.busy || modelsRef.current !== 'ready' || !settingsRef.current) return;
      if (ts < mm.cooldownUntil || mm.needAbsence) return;

      if (!target) {
        mm.faceSince = 0;
        if (mm.small) {
          mm.small = false;
          setHint('');
        }
        setStage('idle');
        return;
      }
      if (target.w / video.videoWidth < MIN_FACE) {
        mm.faceSince = 0;
        if (!mm.small) {
          mm.small = true;
          setHint('closer');
        }
        return;
      }
      if (mm.small) {
        mm.small = false;
        setHint('');
      }
      if (!mm.faceSince) mm.faceSince = ts;
      if (ts - mm.faceSince < HOLD_MS) {
        setStage('hold');
        return;
      }
      mm.busy = true;
      runAttempt(video)
        .catch((e) => console.error(e))
        .finally(() => {
          mm.busy = false;
        });
    },
    [runAttempt, setStage],
  );
  const cam = useFaceCamera({ variant: 'plain', onTick });

  // ------------------------------------------------------------------ start up / tear down
  useEffect(() => {
    const mm = m.current;
    mm.alive = true;
    loadSettings().catch(() => {});
    loadFaceId()
      .then(() => {
        modelsRef.current = 'ready';
        setModels('ready');
      })
      .catch((e) => {
        console.error(e);
        modelsRef.current = 'error';
        setModels('error');
      });
    cam.start();
    return () => {
      mm.alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSound = () => {
    setSound((s) => {
      lsSet('fs_sound', s ? '0' : '1');
      return !s;
    });
  };
  const fullscreen = () => {
    const el = wrapRef.current;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el?.requestFullscreen?.().catch(() => {});
    if (soundRef.current) beep(true); // also unlocks audio on tablets (needs a tap)
  };

  // ------------------------------------------------------------------ render
  const loading = cam.phase === 'loading' || models === 'loading' || !settings;
  const statusDot = cam.phase === 'error' || models === 'error' ? 'red' : loading ? 'amber' : 'green';
  const statusText =
    cam.phase === 'error' ? 'Camera unavailable' : models === 'error' ? 'Models failed to load' : loading ? 'Starting…' : 'Ready';
  const promptKey = loading ? 'loading' : hint === 'closer' && stage === 'idle' ? 'closer' : stage;
  const [pTitle, pSub] = PROMPT[promptKey] || ['', ''];

  return (
    <div className="kiosk" ref={wrapRef} style={{ flex: 1, minHeight: 0 }}>
      <div className="stage">
        <video ref={cam.videoRef} playsInline muted />
        <canvas ref={cam.canvasRef} />
      </div>

      <div className="k-top">
        <Clock />
        <div className="k-actions">
          <div className="pill" title={cam.backend ? `Tracker: ${cam.backend}` : ''}>
            <span className={`dot ${statusDot}`} /> {statusText}
          </div>
          {counts && (
            <div className="pill" title="People who have checked in today">
              <CheckIcon size={15} /> {counts.present} of {counts.total} in
            </div>
          )}
          <button className="iconbtn" onClick={toggleSound} aria-label={sound ? 'Mute sounds' : 'Unmute sounds'} title="Sounds">
            {sound ? <VolumeIcon size={18} /> : <MuteIcon size={18} />}
          </button>
          <button className="iconbtn" onClick={fullscreen} aria-label="Full screen" title="Full screen">
            <FullscreenIcon size={18} />
          </button>
        </div>
      </div>

      <div className="k-bottom">
        {result ? <ResultCard res={result} /> : (
          <div className={`prompt ${stage === 'blink' || stage === 'hold' ? 'amber' : ''}`} aria-live="polite">
            {pTitle}
            {pSub && <small>{pSub}</small>}
          </div>
        )}
      </div>

      {(cam.phase === 'error' || models === 'error') && (
        <div className="cam-error">
          <div className="box">
            <CameraIcon size={44} />
            <h2 style={{ margin: '12px 0 8px' }}>{cam.phase === 'error' ? 'Camera is not available' : 'Face models did not load'}</h2>
            <p>{cam.phase === 'error' ? cam.error : 'Reload the page. If it keeps failing, run `npm install` again so the model files are copied.'}</p>
            {cam.phase === 'error' && (
              <button className="btn primary big" onClick={cam.start}>
                Start camera
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const [time, ampm] = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }).split(' ');
  return (
    <div className="k-clock" aria-label="Current time">
      <div className="k-time">
        {time}
        <small>{ampm}</small>
      </div>
      <div className="k-date">{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    </div>
  );
}

const toMin = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return h * 60 + m;
};
const span = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`);
const fmt12 = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
};

/** The "pass" shown after a scan: who, when, and a stamp that says how it went. */
function ResultCard({ res }) {
  if (res.result === 'matched' || res.result === 'repeat') {
    const p = res.participant;
    const repeat = res.result === 'repeat';
    const out = !repeat && res.kind === 'out';
    const at = new Date(res.ts);
    const mins = at.getHours() * 60 + at.getMinutes() - toMin(res.due);
    let stamp;
    if (repeat) stamp = ['again', 'Already logged'];
    else if (out) stamp = ['out', 'Signed out'];
    else if (res.status === 'late') stamp = ['late', `${span(Math.max(1, mins))} late`];
    else stamp = ['on', mins < -1 ? `${span(-mins)} early` : 'On time'];
    return (
      <div className={`pass ${stamp[0]}`}>
        <Avatar name={p.name} photo={p.photo} size="lg" />
        <div className="pass-main">
          <h2>
            {repeat ? 'Already logged' : out ? 'Goodbye' : 'Welcome'}, {p.name.split(' ')[0]}
          </h2>
          <p>{[p.name, p.department].filter(Boolean).join(' · ')}</p>
          <div className="pass-times">
            {repeat ? (
              <span>
                <small>Scanned</small>
                <b>{res.ago}s ago</b>
              </span>
            ) : (
              <>
                <span>
                  <small>{out ? 'Time out' : 'Time in'}</small>
                  <b>{fmtTime(res.ts)}</b>
                </span>
                {!out && (
                  <span>
                    <small>Due</small>
                    <b>{fmt12(res.due)}</b>
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <i className={`stamp ${stamp[0]}`}>{stamp[1]}</i>
      </div>
    );
  }
  const unknown = res.result === 'unknown';
  return (
    <div className="pass bad">
      <div className="big-icon">
        <XIcon size={38} />
      </div>
      <div className="pass-main">
        <h2>{unknown ? 'Not recognised' : res.title || 'Something went wrong'}</h2>
        <p>{unknown ? (res.ambiguous ? 'Could not tell you apart from someone else. Try again.' : 'You are not enrolled yet. Ask the admin to add you.') : res.message}</p>
      </div>
    </div>
  );
}
