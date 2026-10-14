// Detect as often as the camera delivers: every skipped frame is lag the
// garment cannot be smoothed out of.
const FRAME_INTERVAL = 1000 / 30;
// Generous limits: the first detection also compiles the model's shaders, and
// a slow CPU fallback can take seconds per frame without being broken.
const INITIALIZATION_TIMEOUT = 60_000;
const FRAME_TIMEOUT = 20_000;

const abortError = () => new DOMException('Pose tracking was cancelled.', 'AbortError');

// A <video> reports readyState and videoWidth once frames flow; a photo
// (<img>) is usable the moment it has decoded naturalWidth/naturalHeight.
// Both are createImageBitmap sources, so detect() accepts either.
function frameSource(source) {
  if (typeof source.currentTime === 'number') {
    return {
      ready: source.readyState >= 2 && source.videoWidth > 0 && source.videoHeight > 0,
      width: source.videoWidth,
      height: source.videoHeight,
      time: source.currentTime,
    };
  }
  return {
    ready: source.naturalWidth > 0 && source.naturalHeight > 0,
    width: source.naturalWidth,
    height: source.naturalHeight,
    time: 0,
    still: true,
  };
}

/**
 * Creates a local pose worker. Camera acquisition belongs to the caller.
 * detect(source) can be called from requestAnimationFrame: only one downscaled
 * frame is captured/transferred at a time, and detection is limited to 15 fps.
 * source is a <video> (the live camera) or an <img> (a chosen photo, which is
 * analysed exactly once). precise asks the worker for the heavy ML model: a
 * still picture can afford a slower detection in exchange for an exact fit.
 */
export function createPoseTracker({ onPose, onError, signal, precise } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    if (typeof Worker === 'undefined' || typeof createImageBitmap !== 'function') {
      reject(new Error('This browser does not support local camera tracking. Try a recent Chrome, Edge, Firefox or Safari.'));
      return;
    }

    let worker;
    let ready = false;
    let closed = false;
    let inFlight = false;
    let lastFrameAt = -Infinity;
    let lastVideoTime = -Infinity;
    let lastSource;
    let capturedAt;
    let frameId = 0;
    let initializationTimer;
    let frameTimer;

    function cleanup() {
      if (closed) return;
      closed = true;
      clearTimeout(initializationTimer);
      clearTimeout(frameTimer);
      signal?.removeEventListener('abort', abort);
      worker?.terminate();
      worker = undefined;
    }

    function fail(error) {
      if (closed) return;
      const wasReady = ready;
      cleanup();
      if (wasReady) onError?.(error);
      else reject(error);
    }

    function abort() {
      if (!ready) { fail(abortError()); return; }
      cleanup();
    }

    async function detect(source) {
      if (closed || !ready || inFlight || !source) return;
      const frame = frameSource(source);
      if (!frame.ready) return;
      const timestamp = performance.now();
      // A still photo never advances its timestamp: only a NEW source re-arms
      // detection, so every chosen photo is analysed exactly once while camera
      // frames keep their 15 fps cap.
      if (timestamp - lastFrameAt < FRAME_INTERVAL
        || (source === lastSource && frame.time === lastVideoTime)) return;
      lastFrameAt = timestamp;
      lastVideoTime = frame.time;
      lastSource = source;
      inFlight = true;
      capturedAt = timestamp;
      let bitmap;
      try {
        // A camera frame stays small and fast; a still photo is analysed once,
        // so it is captured near its own resolution — the ML landmarks (and
        // therefore the garment's exact size on any picture) come out precise.
        const cap = frame.still ? 1280 : 640;
        const resize = Math.min(1, cap / Math.max(frame.width, frame.height));
        bitmap = await createImageBitmap(source, {
          resizeWidth: Math.max(1, Math.round(frame.width * resize)),
          resizeHeight: Math.max(1, Math.round(frame.height * resize)),
          resizeQuality: frame.still ? 'high' : 'low',
        });
        if (closed) { bitmap.close(); return; }
        frameId += 1;
        worker.postMessage({ type: 'frame', bitmap, timestamp, frameId }, [bitmap]);
        bitmap = undefined; // The worker owns and closes the transferred bitmap.
        frameTimer = setTimeout(() => fail(new Error('Camera tracking stopped responding. Please try again.')), FRAME_TIMEOUT);
      } catch (error) {
        bitmap?.close();
        fail(new Error(`Could not process the camera frame: ${error.message || error}`));
      }
    }

    try {
      // Do not set type:'module': MediaPipe loads its WASM glue with importScripts.
      worker = new Worker(new URL('./pose.worker.js', import.meta.url));
      worker.onmessage = event => {
        if (closed) return;
        const data = event.data;
        if (data.type === 'ready' && !ready) {
          ready = true;
          clearTimeout(initializationTimer);
          resolve({ detect, close: cleanup });
        } else if (data.type === 'pose' && data.frameId === frameId) {
          clearTimeout(frameTimer);
          inFlight = false;
          onPose?.(data.landmarks, {
            worldLandmarks: data.worldLandmarks ?? null,
            mask: data.mask ?? null,
            // When this frame left the camera, so the fit can be carried
            // forward by however long the detection actually took.
            capturedAt: capturedAt ?? performance.now(),
          });
        } else if (data.type === 'error') {
          fail(new Error(data.message || 'Local pose tracking failed.'));
        }
      };
      worker.onerror = event => {
        event.preventDefault();
        fail(new Error(event.message || 'The local camera tracker could not load.'));
      };
      worker.onmessageerror = () => fail(new Error('The browser could not read the tracking result.'));
      signal?.addEventListener('abort', abort, { once: true });
      initializationTimer = setTimeout(() => fail(new Error('Camera tracking took too long to load. Please try again.')), INITIALIZATION_TIMEOUT);
      // precise: a still photo can spend the heavier ML model on one exact fit.
      worker.postMessage({ type: 'init', precise: precise === true });
    } catch (error) {
      fail(error);
    }
  });
}
