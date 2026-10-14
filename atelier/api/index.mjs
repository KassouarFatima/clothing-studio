// Vercel: every /api/* and /output/* request is rewritten here (its path in ?path=) and runs the app's own handler.
export { handler as default } from '../server.mjs';
