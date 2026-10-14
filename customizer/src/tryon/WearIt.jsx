import { Component, Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Center } from '@react-three/drei';
import { useSnapshot } from 'valtio';
import state from '../store';
import Garment from '../canvas/Garment';
import GarmentSelector from '../comp/GarmentSelector';
import { createPoseTracker } from './poseTracker';
import { getPoseFit } from './fitPose';
import { detectPeople, fitStatus, NO_CLEAR_PERSON, NO_PERSON, subjectBox } from './detect.js';
import { describeSize, measureBody, predictSize } from './bodySize';
import { measureRoomLight, paintOcclusion } from './occlusion';
import { createFitSmoother } from './smoothFit';
import './wearIt.css';

// Which way you are turned, from the pose model's metric landmarks: the
// garment turns with you instead of staying flat against the picture.
function bodyYaw(worldLandmarks) {
  const left = worldLandmarks?.[11];
  const right = worldLandmarks?.[12];
  if (!left || !right || !Number.isFinite(left.z) || !Number.isFinite(right.z)) return 0;
  // Rear view: the anatomical left shoulder sits on the image's left, which
  // flips the angle by ~PI — it would squash the garment sideways. Worn on the
  // back, it stays flat against the picture instead.
  if (Number.isFinite(left.x) && Number.isFinite(right.x) && left.x < right.x) return 0;
  const yaw = Math.atan2(left.z - right.z, left.x - right.x);
  return Math.max(-0.8, Math.min(0.8, yaw));
}

class ModelBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError('The garment could not load. Close this preview and try again.'); }
  render() { return this.state.failed ? null : this.props.children; }
}

function TrackedGarment({ pose, adjustments }) {
  const snap = useSnapshot(state);
  const group = useRef();
  const smoother = useRef(null);
  const lastSample = useRef(0);
  const { size } = useThree();
  smoother.current ||= createFitSmoother();

  // A different garment is a different shape: start its tracking clean.
  useEffect(() => {
    smoother.current.reset();
    lastSample.current = 0;
  }, [snap.garment]);

  useFrame(() => {
    if (!group.current) return;
    const sample = pose.current;
    // A still photo stays fresh forever, so the garment sits on it for as
    // long as the picture is open. A garment that does not fit this pose (the
    // backpack on a front view) is simply never pushed, and stays hidden.
    if (sample && sample.capturedAt !== lastSample.current) {
      lastSample.current = sample.capturedAt;
      const fit = getPoseFit(sample.landmarks, size.width, size.height, snap.garment, adjustments);
      if (fit.visible) {
        smoother.current.push({
          x: fit.center.x - size.width / 2,
          y: size.height / 2 - fit.center.y,
          scaleX: fit.scaleX, scaleY: fit.scaleY,
          rotation: fit.rotation, yaw: bodyYaw(sample.worldLandmarks),
        }, sample.capturedAt / 1000);
      }
    }
    const fit = sample ? smoother.current.predict(performance.now() / 1000) : null;
    if (!fit) { group.current.visible = false; return; }
    group.current.position.set(fit.x, fit.y, 0);
    group.current.scale.set(fit.scaleX, fit.scaleY, Math.sqrt(fit.scaleX * fit.scaleY));
    group.current.rotation.set(0, fit.yaw, fit.rotation);
    group.current.visible = true;
  });

  return <group ref={group} visible={false}><Center key={snap.garment}><Garment /></Center></group>;
}

// The lights follow the brightness of the room, so the garment does not glow
// in a dim room or look grey in a bright one.
function RoomLights({ light }) {
  const ambient = useRef();
  const key = useRef();

  useFrame((_, delta) => {
    const level = light.current ?? 0.5;
    const amount = 1 - Math.exp(-3 * delta);
    if (ambient.current) ambient.current.intensity += (0.55 + level * 1.3 - ambient.current.intensity) * amount;
    if (key.current) key.current.intensity += (0.7 + level * 1.7 - key.current.intensity) * amount;
  });

  return <>
    <ambientLight ref={ambient} intensity={1.3} />
    <directionalLight ref={key} position={[-3, 5, 8]} intensity={1.8} />
    <directionalLight position={[4, 2, 4]} intensity={0.6} />
  </>;
}

const centimetres = value => (Number.isFinite(value) && value ? `${value.toFixed(1)} cm` : '—');

export default function WearIt({ onClose }) {
  const dialog = useRef();
  const occlusion = useRef();
  const pose = useRef(null);
  const roomLight = useRef(0.5);
  const probe = useRef(null);
  probe.current ||= typeof document === 'undefined' ? null : Object.assign(document.createElement('canvas'), { width: 16, height: 16 });
  const sessionFailure = useRef(() => {});
  // The local YOLO detector's verdict for this photo (null = service off),
  // and the detected person the pose measured, drawn over the picture.
  const detector = useRef(null);
  const [detectorBox, setDetectorBox] = useState(null);
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState('');
  const [ready, setReady] = useState(false);
  const [ratio, setRatio] = useState(3 / 4);
  const [size, setSize] = useState(1);
  const [verticalOffset, setVerticalOffset] = useState(0);
  const [horizontalOffset, setHorizontalOffset] = useState(0);
  const [mirrored, setMirrored] = useState(true);
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoName, setPhotoName] = useState('');
  // The body the pose model measured, kept as state so the size panel repaints
  // on every detection instead of reading a stale ref.
  const [measurements, setMeasurements] = useState(null);
  // Flexible stage: the wheel zooms the picture (image, garment and silhouette
  // together) and dragging pans it inside the frame; double-click fits again.
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const photo = useRef();
  const stage = useRef();
  const zoomPane = useRef();
  const pan = useRef(null);
  const filePicker = useRef();
  const photoUrlRef = useRef('');
  photoUrlRef.current = photoUrl;
  const snap = useSnapshot(state);

  // The status line must describe the fit the user actually sees, so it reads
  // the current Size/Position values instead of hard-coded defaults.
  const adjustments = useRef({ size: 1, verticalOffset: 0, horizontalOffset: 0 });
  useEffect(() => {
    adjustments.current = { size, verticalOffset, horizontalOffset };
  }, [size, verticalOffset, horizontalOffset]);

  const report = predictSize(snap.garment, measurements);

  useEffect(() => {
    const pane = zoomPane.current;
    if (!pane) return undefined;
    const onWheel = event => {
      event.preventDefault();
      setView(previous => {
        const scale = Math.min(4, Math.max(1, previous.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
        if (scale <= 1) return { scale: 1, x: 0, y: 0 };
        const limitX = ((scale - 1) / 2) * pane.offsetWidth;
        const limitY = ((scale - 1) / 2) * pane.offsetHeight;
        const keepX = Math.max(-limitX, Math.min(limitX, previous.x));
        const keepY = Math.max(-limitY, Math.min(limitY, previous.y));
        return { scale, x: keepX, y: keepY };
      });
    };
    pane.addEventListener('wheel', onWheel, { passive: false });
    return () => pane.removeEventListener('wheel', onWheel);
  }, []);

  // Dragging moves the zoomed view; at 100 % the clamp keeps it pinned.
  const startPan = event => {
    if (view.scale <= 1) return;
    pan.current = { x: event.clientX, y: event.clientY, ox: view.x, oy: view.y };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic events have no pointer to capture */ }
  };
  const panMove = event => {
    if (!pan.current || !zoomPane.current) return;
    const limitX = ((view.scale - 1) / 2) * zoomPane.current.offsetWidth;
    const limitY = ((view.scale - 1) / 2) * zoomPane.current.offsetHeight;
    const keep = (value, limit) => Math.max(-limit, Math.min(limit, value));
    setView({
      scale: view.scale,
      x: keep(pan.current.ox + event.clientX - pan.current.x, limitX),
      y: keep(pan.current.oy + event.clientY - pan.current.y, limitY),
    });
  };
  const endPan = () => { pan.current = null; };
  const resetView = () => setView({ scale: 1, x: 0, y: 0 });

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element.showModal();
    return () => { element.close(); previousFocus?.focus(); };
  }, []);

  useEffect(() => () => { if (photoUrlRef.current?.startsWith('blob:')) URL.revokeObjectURL(photoUrlRef.current); }, []);

  // One photo, analysed once: the pose, the metric frame and the silhouette
  // all come from that single detection, and the garment sits on the picture.
  useEffect(() => {
    if (!photoUrl) { setReady(false); setStatus(''); setMeasurements(null); return undefined; }
    const element = photo.current;
    const controller = new AbortController();
    const cleanup = () => { controller.abort(); tracker?.close(); tracker = null; pose.current = null; setReady(false); };
    let tracker = null;
    let alive = true;
    let gotPose = false;
    let giveUp = null;
    setFailure('');
    setReady(false);
    setMeasurements(null);
    detector.current = null;
    setDetectorBox(null);
    setStatus('Reading your photo…');
    const rejectPhoto = problem => { if (alive) { setFailure(problem); setStatus(''); } };
    sessionFailure.current = problem => rejectPhoto(problem?.message || 'That photo could not be read.');

    async function analyse() {
      if (!element.naturalWidth) {
        // The picture element can still be decoding its first frame.
        await new Promise((resolve, reject) => {
          element.addEventListener('load', resolve, { once: true, signal: controller.signal });
          element.addEventListener('error', () => reject(new Error('That photo could not be opened. Choose another image (JPG or PNG).')), { once: true, signal: controller.signal });
        });
      }
      if (!alive || controller.signal.aborted) return;
      setRatio(element.naturalWidth / element.naturalHeight);
      setStatus('Measuring your body…');
      // The local detector (OpenCV + YOLOv8, detect/server.py) reads the very
      // same photo in parallel: it vouches how many people are in the picture
      // and that the pose landed on one of them. Service off? It answers
      // {down:true} and everything below behaves exactly as before.
      const detection = fetch(photoUrl)
        .then(response => (response.ok ? response.blob() : Promise.reject(new Error('unreadable photo'))))
        .then(blob => detectPeople(blob, { signal: controller.signal }))
        .catch(() => ({ down: true, boxes: [], count: 0 }));
      detection.then(result => {
        // Confident there is nobody? Give the pose model a moment to
        // disagree, then stop waiting the full twenty seconds.
        if (alive && !gotPose && !result.down && result.count === 0) {
          clearTimeout(giveUp);
          giveUp = setTimeout(() => { if (!gotPose) rejectPhoto(NO_PERSON); }, 2500);
        }
      });
      // One photo, one verdict: measurements are only handed over once the
      // detector has confirmed they were taken from a person in this picture.
      const settle = async (poseLandmarks, worldLandmarks, mask) => {
        const result = await detection;
        if (!alive || controller.signal.aborted) return;
        detector.current = result;
        if (!result.down && result.count === 0) { rejectPhoto(NO_PERSON); return; }
        // These landmarks must sit inside a detected person — otherwise the
        // pose locked onto something else and every number from it is a lie.
        const subject = result.down ? null : subjectBox(result.boxes, poseLandmarks);
        if (!result.down && !subject) { rejectPhoto(NO_CLEAR_PERSON); return; }
        const visible = getPoseFit(poseLandmarks, element.naturalWidth, element.naturalHeight, state.garment, adjustments.current).visible;
        setMeasurements(measureBody(poseLandmarks, worldLandmarks, mask, element.naturalWidth, element.naturalHeight));
        setDetectorBox(subject);
        setReady(true);
        setStatus(fitStatus(visible, result, state.garment));
      };
      tracker = await createPoseTracker({
        signal: controller.signal,
        precise: true, // one still picture: the heavy ML model for an exact fit
        onPose: (landmarks, extras) => {
          if (!alive || gotPose) return;
          gotPose = true;
          clearTimeout(giveUp);
          // One detection covers the whole still picture: an infinite time
          // keeps the fit fresh (and the silhouette mask un-stale) forever.
          pose.current = { landmarks, worldLandmarks: extras?.worldLandmarks ?? null, mask: extras?.mask ?? null, capturedAt: extras?.capturedAt ?? performance.now(), time: Number.POSITIVE_INFINITY };
          roomLight.current = measureRoomLight(probe.current, element, landmarks) ?? roomLight.current;
          paintOcclusion(occlusion.current, element, pose.current, { skipHead: state.garment === 'hat' });
          settle(landmarks, extras?.worldLandmarks ?? null, extras?.mask ?? null)
            .catch(() => { if (alive) rejectPhoto('That photo could not be read.'); });
        },
        onError: error => rejectPhoto(error?.message || 'Local body tracking failed. Please try again.'),
      });
      if (!alive || controller.signal.aborted) return;
      tracker.detect(element);
      giveUp = setTimeout(() => {
        if (!gotPose) rejectPhoto(NO_PERSON);
      }, 20000);
    }
    analyse().catch(error => { if (alive && error?.name !== 'AbortError') rejectPhoto(error?.message || 'That photo could not be read.'); });
    return () => { alive = false; cleanup(); };
  }, [photoUrl]);

  // The photo is analysed only once, but every garment switch needs a fresh
  // verdict: the backpack only fits from behind, and the head must not be
  // painted over the cap.
  useEffect(() => {
    if (!ready || !pose.current || !photo.current) return;
    const sample = pose.current;
    const element = photo.current;
    paintOcclusion(occlusion.current, element, sample, { skipHead: snap.garment === 'hat' });
    const visible = getPoseFit(sample.landmarks, element.naturalWidth, element.naturalHeight, snap.garment, adjustments.current).visible;
    setStatus(fitStatus(visible, detector.current, snap.garment));
  }, [ready, snap.garment]);

  const pickPhoto = () => filePicker.current?.click();
  const onPhotoPicked = event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setFailure('Please choose an image file (JPG or PNG).'); return; }
    setPhotoName(file.name);
    setPhotoUrl(previous => { if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous); return URL.createObjectURL(file); });
  };

  // The exact picture on screen — photo, garment and your silhouette on top —
  // saved at full resolution as a PNG.
  const savePicture = () => {
    const source = photo.current;
    const width = source?.naturalWidth;
    const height = source?.naturalHeight;
    if (!width || !height) return;
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const context = output.getContext('2d');
    if (!context) return;
    if (mirrored) { context.translate(width, 0); context.scale(-1, 1); } // the preview is mirrored as a whole
    context.drawImage(source, 0, 0, width, height);
    for (const layer of stage.current?.querySelectorAll('.wear-overlay canvas, canvas.wear-occlusion') || []) {
      context.drawImage(layer, 0, 0, width, height);
    }
    output.toBlob(blob => {
      if (!blob) return;
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      Object.assign(link, { href: url, download: 'wear-it.png' });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  };

  return <dialog ref={dialog} className="wear-dialog" aria-labelledby="wear-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="wear-header">
      <div><h2 id="wear-title">Wear it</h2><p>Pick a photo · get your size · free</p></div>
      <button type="button" className="wear-close" onClick={onClose} aria-label="Close">×</button>
    </header>
    <div className="wear-options"><GarmentSelector /></div>
    <input ref={filePicker} type="file" accept="image/*" className="wear-file" aria-label="Choose a photo to measure and try a garment on" onChange={onPhotoPicked} />
    <div className="wear-pick">
      <button type="button" className="wear-pick-button" onClick={pickPhoto}>{photoName ? 'Choose another image' : 'Select an image'}</button>
      {photoName && <span className="wear-pick-name">{photoName}</span>}
    </div>
    <div ref={stage} className="wear-stage-shell">
      <div ref={zoomPane} className={`wear-stage-frame${view.scale > 1 ? ' wear-zoomed' : ''}`}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        onPointerDown={startPan} onPointerMove={panMove} onPointerUp={endPan} onPointerCancel={endPan}
        onDoubleClick={resetView}>
      <div className={`wear-stage${mirrored ? ' wear-mirrored' : ''}`} style={{ aspectRatio: ratio, width: `min(100%, calc(54dvh * ${ratio}))` }}>
        {photoUrl && <img ref={photo} src={photoUrl} alt="The photo you chose" />}
        {ready && <div className="wear-overlay"><Canvas orthographic camera={{ position: [0, 0, 1000], near: 0.1, far: 3000, zoom: 1 }} dpr={[1, 1.5]} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}>
          <RoomLights light={roomLight} />
          <ModelBoundary key={snap.garment} onError={message => sessionFailure.current(new Error(message))}><Suspense fallback={null}><TrackedGarment pose={pose} adjustments={{ size, verticalOffset, horizontalOffset }} /></Suspense></ModelBoundary>
        </Canvas></div>}
        {/* Your body and the room, painted back over the garment. */}
        <canvas ref={occlusion} className="wear-occlusion" aria-hidden="true" />
        {/* The local detector's box: which person in this photo was measured. */}
        {ready && detectorBox && <div className="wear-detect" aria-hidden="true"
          style={{
            left: `${detectorBox.xyxy[0] * 100}%`,
            top: `${detectorBox.xyxy[1] * 100}%`,
            width: `${(detectorBox.xyxy[2] - detectorBox.xyxy[0]) * 100}%`,
            height: `${(detectorBox.xyxy[3] - detectorBox.xyxy[1]) * 100}%`,
          }}>
          <b>{`person ${Math.round(detectorBox.score * 100)}%`}</b>
        </div>}
      </div>
      </div>
      {!photoUrl && !failure && <div className="wear-message" role="status">
        <p>Pick a photo of yourself. It is measured here, on your device — nothing is uploaded.</p>
        <button type="button" onClick={pickPhoto}>Select an image</button>
      </div>}
      {failure && <div className="wear-message" role="alert">
        <p>{failure}</p>
        <button type="button" onClick={pickPhoto}>Choose another image</button>
      </div>}
      {!failure && status && <p className="wear-status" role="status">{status}</p>}
    </div>
    {ready && <section className="wear-size" aria-live="polite">
      {report && <h3>{`Your size: ${report.size}`}</h3>}
      {measurements && <ul className="wear-size-list">
        <li><span>Chest</span><b>{centimetres(measurements.chestCm)}</b></li>
        <li><span>Waist</span><b>{centimetres(measurements.waistCm)}</b></li>
        <li><span>Hips</span><b>{centimetres(measurements.hipCm)}</b></li>
        <li><span>Shoulders</span><b>{centimetres(measurements.shoulderCm)}</b></li>
        <li><span>Torso</span><b>{centimetres(measurements.torsoCm)}</b></li>
      </ul>}
      <p className="wear-size-note">{describeSize(report)}</p>
    </section>}
    <div className="wear-adjustments">
      <label>Size <input type="range" min="0.75" max="1.3" step="0.01" value={size} onChange={event => setSize(Number(event.target.value))} /></label>
      <label>Position <input type="range" min="-0.4" max="0.4" step="0.01" value={verticalOffset} onChange={event => setVerticalOffset(Number(event.target.value))} /></label>
      <label>Left / Right <input type="range" min="-0.5" max="0.5" step="0.01" value={horizontalOffset} onChange={event => setHorizontalOffset(Number(event.target.value))} /></label>
      <label className="wear-mirror"><input type="checkbox" checked={mirrored} onChange={event => setMirrored(event.target.checked)} /> Mirror</label>
      <button type="button" className="wear-reset" onClick={() => { setSize(1); setVerticalOffset(0); setHorizontalOffset(0); }}>Reset</button>
    </div>
    <div className="wear-actions">
      {ready && <button type="button" onClick={savePicture}>Save picture</button>}
    </div>
    <p className="wear-note">Your photos stay on this device. The size is an estimate from one picture, not a tailor's measurement — use the Size slider to fine-tune the fit.</p>
  </dialog>;
}
