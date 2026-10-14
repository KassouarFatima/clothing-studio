import express from 'express'
import { ChatError, normalizeMessages, respondToChat } from '../services/chat.js'

const router = express.Router();

// Lightweight per-IP budget so an open page cannot flood the free provider.
const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 20;
const hits = new Map();

const rateLimited = (key, now = Date.now()) => {
    const recent = (hits.get(key) || []).filter((time) => now - time < WINDOW_MS);
    if (recent.length >= MAX_REQUESTS) {
        hits.set(key, recent);
        return true;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) {
        for (const [entryKey, times] of hits) {
            if (!times.some((time) => now - time < WINDOW_MS)) hits.delete(entryKey);
        }
    }
    return false;
};

router.route('/').get((req, res) => {
    res.status(200).json({ message: 'Design assistant chat service' });
});

router.route('/').post(async (req, res) => {
    const controller = new AbortController();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', onClose);
    try {
        if (rateLimited(req.ip || req.socket?.remoteAddress || 'unknown')) {
            return res.status(429).json({ message: 'Too many messages. Wait a moment and try again.' });
        }
        const messages = normalizeMessages(req.body?.messages);
        const result = await respondToChat(messages, { signal: controller.signal });
        if (!controller.signal.aborted) res.status(200).json(result);
    } catch (error) {
        if (controller.signal.aborted) return;
        const status = error instanceof ChatError ? error.status : 500;
        res.status(status).json({
            message: error instanceof ChatError ? error.message : 'The assistant failed. Please try again.',
        });
    } finally {
        res.off('close', onClose);
    }
});

export default router;
