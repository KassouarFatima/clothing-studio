#!/usr/bin/env python3
"""Clothing Studio - local person detector for Wear it.

OpenCV (cv2) + YOLOv8n run entirely on this machine: the browser POSTs a
photo to http://127.0.0.1:8081/detect and gets the person boxes back as
normalised coordinates. Nothing is uploaded anywhere, and Wear it keeps
working exactly as before when this service is not running.

Run:   python detect/server.py                    (npm start does this for you)
       python detect/server.py --selftest photo.jpg
First run downloads yolov8n.onnx (~12 MB, Ultralytics - AGPL-3.0) once and
caches it next to this file.
"""
from __future__ import annotations

import json
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    import cv2
    import numpy as np
except ImportError as exc:  # pragma: no cover - environment problem, not logic
    print(f"[detect] missing Python package ({exc}). Install it once with:")
    print("[detect]   pip install opencv-python")
    raise SystemExit(1) from exc

HOST = "127.0.0.1"
PORT = 8081
HERE = Path(__file__).resolve().parent
MODEL_PATH = HERE / "yolov8n.onnx"
MODEL_URLS = (
    "https://huggingface.co/kshitijjjjjjjjjjjjjjjj/yolov8n-coco-onnx/resolve/main/yolov8n.onnx",
    "https://github.com/yoobright/yolo-onnx/raw/master/yolov8n.onnx",
)
INPUT = 640            # YOLOv8n's fixed export size
PERSON = 0             # COCO class id for a person
SCORE = 0.30           # minimum confidence to keep a box
IOU = 0.45             # non-max suppression overlap
MAX_BODY = 30 * 1024 * 1024

_net = None
_net_lock = threading.Lock()


def ensure_model() -> Path:
    if MODEL_PATH.exists() and MODEL_PATH.stat().st_size > 1_000_000:
        return MODEL_PATH
    for url in MODEL_URLS:
        try:
            print(f"[detect] downloading yolov8n.onnx from {url} ...")
            request = urllib.request.Request(url, headers={"User-Agent": "clothing-studio-detect"})
            with urllib.request.urlopen(request, timeout=60) as response:
                MODEL_PATH.write_bytes(response.read())
            size = MODEL_PATH.stat().st_size
            if size > 1_000_000:
                print(f"[detect] saved {size // (1024 * 1024)} MB -> {MODEL_PATH}")
                return MODEL_PATH
        except Exception as exc:  # noqa: BLE001 - try the next mirror
            print(f"[detect] download failed ({exc}), trying the next mirror")
        MODEL_PATH.unlink(missing_ok=True)
    raise SystemExit(
        "[detect] could not download yolov8n.onnx - connect once online, "
        "the model is cached afterwards (or drop the file next to server.py)."
    )


def load_net():
    global _net
    if _net is None:
        _net = cv2.dnn.readNetFromONNX(str(ensure_model()))
    return _net


def letterbox(image, size=INPUT):
    """Resize keeping the aspect ratio, pad to a square the way YOLO trains."""
    height, width = image.shape[:2]
    scale = min(size / width, size / height)
    new_w, new_h = round(width * scale), round(height * scale)
    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    canvas = np.full((size, size, 3), 114, dtype=np.uint8)
    x0 = (size - new_w) // 2
    y0 = (size - new_h) // 2
    canvas[y0:y0 + new_h, x0:x0 + new_w] = resized
    return canvas, scale, x0, y0


def detect_people(image) -> list:
    """Person boxes in the original image, normalised to 0..1 per edge."""
    canvas, scale, x0, y0 = letterbox(image)
    blob = cv2.dnn.blobFromImage(canvas, 1 / 255.0, (INPUT, INPUT), swapRB=True, crop=False)
    net = load_net()
    with _net_lock:
        net.setInput(blob)
        output = net.forward()          # (1, 84, 8400): cx cy w h + 80 class scores
    predictions = output[0].T           # (8400, 84)
    scores = predictions[:, PERSON + 4]
    rows = predictions[scores >= SCORE]
    keep_scores = scores[scores >= SCORE]
    if rows.size == 0:
        return []
    height, width = image.shape[:2]
    boxes = []
    for (cx, cy, bw, bh), conf in zip(rows[:, :4], keep_scores):
        # Undo the letterbox: canvas pixels -> original image pixels.
        left = float((cx - bw / 2 - x0) / scale)
        top = float((cy - bh / 2 - y0) / scale)
        right = float((cx + bw / 2 - x0) / scale)
        bottom = float((cy + bh / 2 - y0) / scale)
        boxes.append([left, top, right, bottom, float(conf)])
    # One box per person: several arms/sides of the same body collapse here.
    pixel = [[int(left), int(top), int(right - left), int(bottom - top)]
             for left, top, right, bottom, _ in boxes]
    indices = cv2.dnn.NMSBoxes(pixel, [box[4] for box in boxes], SCORE, IOU)
    survivors = [boxes[int(i)] for i in np.asarray(indices).flatten()] if len(indices) else []
    people = []
    for left, top, right, bottom, conf in survivors:
        left, top = max(0.0, left), max(0.0, top)
        right, bottom = min(float(width), right), min(float(height), bottom)
        if right - left < 1 or bottom - top < 1:
            continue
        people.append({
            "label": "person",
            "score": round(conf, 3),
            "xyxy": [round(left / width, 4), round(top / height, 4),
                     round(right / width, 4), round(bottom / height, 4)],
        })
    return sorted(people, key=lambda person: -person["score"])


class Handler(BaseHTTPRequestHandler):
    server_version = "ClothingDetect"

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):  # CORS preflight from the studio page
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/health":
            self._send_json({"ok": True, "service": "wearit-detect", "model": "yolov8n"})
        else:
            self._send_json({"ok": False, "error": "not found"}, 404)

    def do_POST(self):
        if self.path.split("?")[0] != "/detect":
            self._send_json({"ok": False, "error": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            self._send_json({"ok": False, "error": "empty body"}, 400)
            return
        if length > MAX_BODY:
            self._send_json({"ok": False, "error": "image too large"}, 413)
            return
        raw = self.rfile.read(length)
        started = time.perf_counter()
        image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            self._send_json({"ok": False, "error": "unreadable image"}, 400)
            return
        try:
            people = detect_people(image)
        except Exception as exc:  # noqa: BLE001 - answer instead of dying
            print(f"[detect] inference failed: {exc}", file=sys.stderr)
            self._send_json({"ok": False, "error": "detection failed"}, 500)
            return
        ms = round((time.perf_counter() - started) * 1000, 1)
        height, width = image.shape[:2]
        print(f"[detect] {len(people)} person(s) in {ms} ms ({width}x{height})")
        self._send_json({
            "ok": True, "boxes": people, "count": len(people),
            "image": [width, height], "ms": ms,
        })

    def log_message(self, *args):  # quiet: our own one-line log above is enough
        pass


def selftest(path: str) -> int:
    image = cv2.imread(path)
    if image is None:
        print(f"[detect] cannot read {path}")
        return 1
    started = time.perf_counter()
    people = detect_people(image)
    ms = round((time.perf_counter() - started) * 1000, 1)
    height, width = image.shape[:2]
    print(json.dumps(people, indent=2))
    print(f"[detect] {len(people)} person(s) in {ms} ms ({width}x{height})")
    return 0 if people else 2


def main() -> None:
    if len(sys.argv) >= 3 and sys.argv[1] == "--selftest":
        raise SystemExit(selftest(sys.argv[2]))
    load_net()  # download once, and fail here with a clear message
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[detect] YOLOv8 person detector - OpenCV {cv2.__version__}")
    print(f"[detect] listening on http://{HOST}:{PORT}  (GET /health, POST /detect)")
    print("[detect] Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[detect] stopped")


if __name__ == "__main__":
    main()
