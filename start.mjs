#!/usr/bin/env node
// Clothing Studio — one command starts the whole combined site:
//   Shop front (3D Garment Customizer) .. http://localhost:5173
//   Chat + image API .................... http://localhost:8080
//   Atelier (virtual street world) ....... http://localhost:8792/street.html
// Atelier's "✨ Let'sDo it." button opens the studio; its "🎁 Give to
// customer" sends the finished design back (it hangs in the shop window).
// Press Ctrl+C to stop everything.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const children = [];

const start = (command, args, cwd, name) => {
  const child = spawn(command, args, { cwd, shell: true, stdio: 'inherit' });
  child.on('exit', (code) => console.log(`[${name}] stopped (code ${code})`));
  children.push(child);
  return child;
};

start('npm', ['run', 'dev'], path.join(root, 'customizer'), 'shop :5173');
start('npm', ['start'], path.join(root, 'customizer', 'serveur'), 'api :8080');
start('npm', ['start'], path.join(root, 'atelier'), 'atelier :8792');

// Optional: the local YOLO person detector for Wear it (OpenCV + Python).
// It only adds a second opinion to the size prediction — when Python or
// OpenCV is missing, Wear it keeps working on the pose model alone.
try {
  const probe = spawnSync('python', ['--version'], { encoding: 'utf8', timeout: 15000 });
  if (probe.status === 0) {
    start('python', [path.join(root, 'detect', 'server.py')], root, 'detect :8081');
  } else {
    console.log('[detect] skipped — Python not found (Wear it works without the YOLO detector)');
  }
} catch {
  console.log('[detect] skipped — Python not found (Wear it works without the YOLO detector)');
}

console.log(`
==================================================
  Clothing Studio is starting
    Virtual world — start here ... http://localhost:8792/street.html
    "Let'sDo it." studio .......... http://localhost:5173
    Chat / handoff API ............ http://localhost:8080
    Wear it person detector ....... http://localhost:8081 (optional)
  In Atelier, the buyer part has a "✨ Let'sDo it." button;
  finished designs come back with "🎁 Give to customer".
  Press Ctrl+C to stop everything.
==================================================
`);

// Open the virtual world (Atelier) in the default browser once it has booted.
setTimeout(() => {
  spawn('cmd', ['/c', 'start', '', 'http://localhost:8792/street.html'], { detached: true, stdio: 'ignore' }).unref();
}, 5000);

const stopAll = () => {
  for (const child of children) {
    if (child.pid) {
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch { /* already gone */ }
    }
  }
  process.exit(0);
};
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
