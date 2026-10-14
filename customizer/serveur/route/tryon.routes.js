import express from 'express';
import {
    authorizeTryOn, createTryOnLimiter, createTryOnSession,
    publicTryOnConfig, readTryOnConfig, TryOnError,
} from '../services/tryon.js';

function requestContext(req) {
    return {
        origin: req.get('origin'),
        remoteAddress: req.socket.remoteAddress,
        forwarded: Boolean(req.get('forwarded') || req.get('x-forwarded-for') || req.get('x-forwarded-host') || req.get('x-forwarded-proto')),
        accessCode: req.get('x-tryon-access-code'),
        consent: req.body?.consent,
    };
}

export function createTryOnHandlers({ env = process.env, fetchToken = fetch, now = Date.now, timeoutMs = 10000 } = {}) {
    const limitStarts = createTryOnLimiter({ now });
    return {
        config(req, res) {
            res.set('Cache-Control', 'no-store');
            res.json(publicTryOnConfig(readTryOnConfig(env), requestContext(req)));
        },
        async session(req, res) {
            res.set('Cache-Control', 'no-store');
            const controller = new AbortController();
            const onClose = () => { if (!res.writableEnded) controller.abort(); };
            res.on('close', onClose);
            try {
                const config = readTryOnConfig(env);
                const request = requestContext(req);
                const origin = authorizeTryOn(config, request);
                limitStarts(request.remoteAddress);
                const session = await createTryOnSession(config, origin, { fetchToken, signal: controller.signal, timeoutMs });
                if (!controller.signal.aborted) res.status(200).json(session);
            } catch (error) {
                if (controller.signal.aborted) return;
                if (error instanceof TryOnError) {
                    if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
                    res.status(error.status).json({ message: error.message });
                } else {
                    res.status(502).json({ message: 'Cannot start real AI try-on. Please try again later.' });
                }
            } finally {
                res.off('close', onClose);
            }
        },
    };
}

const router = express.Router();
const handlers = createTryOnHandlers();
router.get('/config', handlers.config);
router.post('/session', handlers.session);
export default router;
