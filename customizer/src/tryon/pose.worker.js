/* Dedicated CLASSIC worker: MediaPipe's WASM loader needs importScripts. */
// Keep the pinned runtime's optional metrics logger inside this worker's local
// asset boundary. MediaPipe 1.0.1 uses fetch for its Google metrics endpoint.
// This does not replace fetch in the application or affect image generation.
const fetchLocalAsset = self.fetch.bind(self);
self.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input, self.location.href);
  if (url.origin !== self.location.origin) {
    throw new TypeError('External requests are disabled in the local pose tracker.');
  }
  // A same-origin asset must not silently redirect to an external service.
  return fetchLocalAsset(input, { ...options, redirect: 'error' });
};

let landmarker;
let initialized = false;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function initialize(precise) {
  // All runtime files are served by this website. No frames leave this worker.
  const runtimeUrl = new URL('/tryon/vision_bundle.mjs', self.location.origin).href;
  const { FilesetResolver, PoseLandmarker } = await import(/* @vite-ignore */ runtimeUrl);
  const vision = await FilesetResolver.forVisionTasks('/tryon/wasm');
  let previousError;
  // A still photo is analysed exactly once, so it can afford the heavy ML
  // model: far more exact landmarks (and mask edges) than the camera's lite
  // model. If the heavy file is missing, the lite model simply takes over.
  const models = precise
    ? ['/tryon/pose_landmarker_heavy.task', '/tryon/pose_landmarker_lite.task']
    : ['/tryon/pose_landmarker_lite.task'];
  // GPU inference is several times faster than CPU here, and the garment can
  // only sit still on a moving body if each frame comes back quickly. CPU
  // remains the fallback for software renderers and older devices.
  for (const modelAssetPath of models) {
    for (const delegate of ['GPU', 'CPU']) {
      try {
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath, delegate },
          runningMode: 'VIDEO', numPoses: 1,
          minPoseDetectionConfidence: 0.55,
          minPosePresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
          // The body mask keeps the garment inside your silhouette instead of
          // floating over the room behind you.
          outputSegmentationMasks: true,
        });
        initialized = true;
        self.postMessage({ type: 'ready', delegate, precise: modelAssetPath.includes('heavy') });
        return;
      } catch (error) {
        landmarker?.close();
        landmarker = undefined;
        previousError = error || previousError;
      }
    }
  }
  throw new Error(`Pose tracking could not start: ${errorMessage(previousError)}`);
}

self.onmessage = async event => {
  const { type, bitmap, timestamp, frameId } = event.data;
  if (type === 'init') {
    try { await initialize(event.data.precise === true); }
    catch (error) { self.postMessage({ type: 'error', message: errorMessage(error) }); }
  } else if (type === 'frame') {
    try {
      if (!initialized || !landmarker) throw new Error('Pose tracking is not ready.');
      const result = landmarker.detectForVideo(bitmap, timestamp);
      // The mask is a float per pixel: how certain that pixel is part of you.
      // It is packed into bytes here so the frame transfers without a copy.
      const found = result.segmentationMasks?.[0];
      let mask = null;
      try {
        const values = found?.getAsFloat32Array();
        if (values) {
          const coverage = new Uint8Array(values.length);
          for (let index = 0; index < values.length; index++) {
            coverage[index] = values[index] * 255;
          }
          mask = { coverage, width: found.width, height: found.height };
        }
      } finally {
        found?.close();
      }
      self.postMessage({
        type: 'pose', frameId, mask,
        landmarks: result.landmarks[0] || null,
        worldLandmarks: result.worldLandmarks?.[0] || null,
      }, mask ? [mask.coverage.buffer] : []);
    } catch (error) {
      self.postMessage({ type: 'error', message: errorMessage(error), frameId });
    } finally {
      bitmap?.close();
    }
  } else if (type === 'close') {
    landmarker?.close();
    landmarker = undefined;
    self.close();
  }
};
