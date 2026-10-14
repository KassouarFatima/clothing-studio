import { createHash, timingSafeEqual } from 'node:crypto';

export const TRYON_MODEL = 'lucy-vton-3.5';
export const TOKEN_ENDPOINT = 'https://api.decart.ai/v1/client/tokens';
const DEFAULT_ORIGINS = [
    'http://localhost:5173', 'http://localhost:5174',
    'http://127.0.0.1:5173', 'http://127.0.0.1:5174',
    'http://[::1]:5173', 'http://[::1]:5174',
];
const DISABLED_MESSAGE = 'Real AI try-on is not enabled. The website owner must connect a Decart account and enable it. Decart uses credits; Hugging Face image tokens cannot power this live effect.';

export class TryOnError extends Error {
    constructor(message, status = 502, retryAfter = undefined) {
        super(message);
        this.name = 'TryOnError';
        this.status = status;
        this.retryAfter = retryAfter;
    }
}

function isLoopback(address = '') {
    return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}

function isLoopbackHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function canonicalOrigin(value) {
    if (typeof value !== 'string' || value.length > 253) return null;
    try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value
            || parsed.username || parsed.password || parsed.hostname.includes('*')) return null;
        // Public deployments send an access code, so require encrypted transport.
        if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) return null;
        return parsed.origin;
    } catch {
        return null;
    }
}

export function readTryOnConfig(env = process.env) {
    const enabled = env.TRYON_ENABLED === 'true';
    const apiKey = typeof env.DECART_API_KEY === 'string' ? env.DECART_API_KEY.trim() : '';
    const accessCode = typeof env.TRYON_ACCESS_CODE === 'string' ? env.TRYON_ACCESS_CODE.trim() : '';
    const rawOrigins = env.TRYON_ALLOWED_ORIGINS?.trim()
        ? env.TRYON_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
        : DEFAULT_ORIGINS;
    const origins = [...new Set(rawOrigins)];
    const validOrigins = origins.length > 0 && origins.length <= 20 && origins.every(canonicalOrigin);
    const validAccessCode = !accessCode || accessCode.length >= 16;
    const requestedDuration = Number(env.TRYON_SESSION_SECONDS || 60);
    const durationSeconds = Number.isFinite(requestedDuration)
        ? Math.min(60, Math.max(10, Math.floor(requestedDuration))) : 60;
    const configured = Boolean(apiKey && validOrigins && validAccessCode);
    return { enabled, configured, apiKey, accessCode, origins, durationSeconds, production: env.NODE_ENV === 'production' };
}

function needsAccessCode(config, request) {
    const origin = canonicalOrigin(request.origin);
    // Do not infer identity from req.ip, Host, X-Forwarded-For, or a proxy's claims.
    // A reverse proxy needs the access code even when its socket is loopback.
    return Boolean(config.accessCode || config.production || !isLoopback(request.remoteAddress)
        || request.forwarded || !origin || !isLoopbackHost(new URL(origin).hostname));
}

export function publicTryOnConfig(config, request = {}) {
    return {
        enabled: config.enabled,
        configured: config.configured,
        model: TRYON_MODEL,
        durationSeconds: config.durationSeconds,
        requiresAccessCode: needsAccessCode(config, request),
        pricing: {
            currency: 'USD',
            creditsPerSecond: 2,
            estimatedUsdPerMinute: 1.2,
            url: 'https://docs.platform.decart.ai/getting-started/pricing',
        },
        message: !config.enabled ? DISABLED_MESSAGE : !config.configured
            ? 'Real AI try-on needs a valid Decart API key and server configuration.'
            : 'Live AI try-on sends your camera video and garment image to Decart and uses Decart credits. Standard generation costs about $1.20 per minute.',
    };
}

function validAccessCode(actual, expected) {
    if (typeof actual !== 'string' || actual.length > 512 || !expected || expected.length < 16) return false;
    // Compare equal-length digests so neither code contents nor length controls timingSafeEqual.
    return timingSafeEqual(createHash('sha256').update(actual).digest(), createHash('sha256').update(expected).digest());
}

export function authorizeTryOn(config, request) {
    if (!config.enabled) throw new TryOnError(DISABLED_MESSAGE, 503);
    if (!config.configured) throw new TryOnError('Real AI try-on needs a valid Decart API key and server configuration.', 503);
    const origin = canonicalOrigin(request.origin);
    if (!origin || !config.origins.includes(origin)) throw new TryOnError('This website origin is not allowed to start AI try-on.', 403);
    if (needsAccessCode(config, request) && !validAccessCode(request.accessCode, config.accessCode)) {
        throw new TryOnError('An owner access code is required to start AI try-on from this connection.', 403);
    }
    if (request.consent !== true) throw new TryOnError('Confirm camera sharing and Decart credit usage before starting AI try-on.', 400);
    return origin;
}

// Deliberately low limits for this single-owner demo. Kept in the server, never
// supplied by a request. Use shared authenticated quotas before scaling replicas.
export function createTryOnLimiter({ now = Date.now } = {}) {
    const perAddress = new Map();
    let globalStarts = [];
    return (address) => {
        const currentTime = now();
        const tenMinutesAgo = currentTime - 10 * 60 * 1000;
        const hourAgo = currentTime - 60 * 60 * 1000;
        for (const [key, entries] of perAddress) {
            const active = entries.filter((time) => time > tenMinutesAgo);
            if (active.length) perAddress.set(key, active);
            else perAddress.delete(key);
        }
        globalStarts = globalStarts.filter((time) => time > hourAgo);
        const starts = perAddress.get(address) || [];
        if (starts.length >= 3) {
            throw new TryOnError('AI try-on start limit reached. Try again in a few minutes.', 429,
                Math.max(1, Math.ceil((starts[0] + 10 * 60 * 1000 - currentTime) / 1000)));
        }
        if (globalStarts.length >= 6) {
            throw new TryOnError('The website has reached its hourly AI try-on limit. Try again later.', 429,
                Math.max(1, Math.ceil((globalStarts[0] + 60 * 60 * 1000 - currentTime) / 1000)));
        }
        perAddress.set(address, [...starts, currentTime]);
        globalStarts.push(currentTime);
    };
}

export async function createTryOnSession(config, origin, { fetchToken = fetch, signal, timeoutMs = 10000 } = {}) {
    // This guard also protects accidental direct service calls. Route authorization
    // additionally checks caller identity, origin, consent, and throttles issuance.
    if (!config.enabled || !config.configured) throw new TryOnError(DISABLED_MESSAGE, 503);
    if (!canonicalOrigin(origin) || !config.origins.includes(origin)) throw new TryOnError('This website origin is not allowed to start AI try-on.', 403);
    const durationSeconds = Math.min(60, Math.max(10, Math.floor(config.durationSeconds)));
    const timeout = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
        const response = await fetchToken(TOKEN_ENDPOINT, {
            method: 'POST',
            redirect: 'error',
            signal: requestSignal,
            headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey },
            body: JSON.stringify({
                expiresIn: 30,
                allowedModels: [TRYON_MODEL],
                allowedOrigins: [origin],
                constraints: { realtime: { maxSessionDuration: durationSeconds } },
            }),
        });
        // Never forward upstream bodies/errors: they can echo credentials.
        if (response.status === 429) throw new TryOnError('Decart is busy or its session limit was reached. Please try again later.', 429, 60);
        if (response.status === 402) throw new TryOnError('The Decart account has no available credits for real AI try-on.', 402);
        if (response.status === 401 || response.status === 403) throw new TryOnError('Decart rejected the server credentials. The website owner needs to check the Decart account.', 503);
        if (!response.ok) throw new TryOnError('Decart could not start AI try-on. Please try again later.', 502);
        const payload = await response.json();
        if (typeof payload.apiKey !== 'string' || !payload.apiKey.trim() || payload.apiKey.length > 16384
            || payload.apiKey === config.apiKey) throw new TryOnError('Decart returned an invalid session credential.', 502);
        return { apiKey: payload.apiKey, model: TRYON_MODEL, durationSeconds };
    } catch (error) {
        if (error instanceof TryOnError) throw error;
        if (timeout.aborted) throw new TryOnError('Decart took too long to start AI try-on. Please try again.', 504);
        if (signal?.aborted) throw new TryOnError('AI try-on request was cancelled.', 499);
        throw new TryOnError('Cannot connect to Decart for real AI try-on. Please try again later.', 502);
    }
}
