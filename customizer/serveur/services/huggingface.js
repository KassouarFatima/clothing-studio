import { Client } from '@gradio/client';

export class ImageGenerationError extends Error {
    constructor(message, status = 502) {
        super(message);
        this.status = status;
    }
}

const textileStyles = {
    sport: 'Technical sportswear: dynamic geometric bands and angular accents, controlled rhythm and restrained detail.',
    minimal: 'Minimal designer textile: sparse geometric forms, deliberate spacing, clean contours and understated contrast.',
    botanical: 'Botanical textile: stylized leaves and stems, flowing repeat rhythm and simplified organic shapes.',
    abstract: 'Modern abstract textile: bold flowing forms, balanced asymmetry and layered graphic movement.',
};

const isValidSeed = (seed) => Number.isInteger(seed) && seed >= 0 && seed <= 2147483647;
const garmentNames = {
    tshirt: 'T-shirt',
    dress: 'dress',
    suit: 'tailored suit',
    hoodie: 'hoodie',
    pants: 'pants',
    jacket: 'jacket',
    hat: 'hat',
    bag: 'backpack',
};

// Share validation between the route and adapter so invalid options never use GPU time.
export const normalizeArtworkOptions = ({ mode = 'full', style = 'sport', palette, seed, garment = 'tshirt' } = {}) => {
    if (!['logo', 'full'].includes(mode)) {
        throw new ImageGenerationError('Choose full pattern or logo mode.', 400);
    }
    if (typeof style !== 'string' || !Object.hasOwn(textileStyles, style)) {
        throw new ImageGenerationError('Choose sport, minimal, botanical, or abstract style.', 400);
    }
    if (palette !== undefined && (!Array.isArray(palette) || palette.length < 2 || palette.length > 4
        || palette.some((color) => typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)))) {
        throw new ImageGenerationError('Choose a palette of 2 to 4 colors in #RRGGBB format.', 400);
    }
    if (seed !== undefined && !isValidSeed(seed)) {
        throw new ImageGenerationError('The design seed must be a whole number from 0 to 2147483647.', 400);
    }
    if (typeof garment !== 'string' || !Object.hasOwn(garmentNames, garment)) {
        throw new ImageGenerationError('Choose a T-shirt, dress, suit, hoodie, pants, jacket, hat, or backpack.', 400);
    }
    return { mode, style, palette: palette?.map((color) => color.toUpperCase()), seed, garment };
};

// The image model gives the first tokens most of the attention and has a
// limited prompt length, so the user's own description leads the brief and the
// textile wrapper follows it. When the user asks for words on the garment the
// blanket "no lettering" ban would contradict the request, so it only applies
// when no text was asked for.
const wantsLettering = (prompt) => /\b(?:text|word|words|letter|letters|lettering|write|writing|name|slogan|quote|title|typography|font|fonts)\b/i.test(prompt);

export const buildArtworkPrompt = (prompt, mode = 'full', { style = 'sport', palette, garment = 'tshirt' } = {}) => {
    const description = String(prompt).trim();
    if (mode === 'logo') {
        return `Create a centered T-shirt print illustration, isolated on a plain white background, with bold clean outlines and generous margins. Artwork only: no T-shirt, clothing mockup, person, photograph of a product, or watermark. Design description: ${description}`;
    }
    const colors = palette?.length
        ? `Use only this coordinated palette: ${palette.join(', ')}.`
        : 'Follow the described colors; keep the palette coordinated.';
    const exclusions = wantsLettering(description)
        ? 'no T-shirt, clothing mockup, person, product photograph, fabric folds, lighting, shadows, borders or watermark; keep every requested word exactly as written and correctly spelled.'
        : 'no T-shirt, clothing mockup, person, product photograph, fabric folds, lighting, shadows, logos, lettering, borders or watermark.';
    return `Design description: ${description}. Follow this description exactly — it is the main subject, colors and composition of the textile. Flat seamless repeating textile pattern for a ${garmentNames[garment]}, edge-to-edge. ${textileStyles[style]} ${colors} Medium-scale motifs, deliberate breathing room, matching edges and crisp shapes. Artwork only: ${exclusions}`;
};

const normalizeError = (error, authenticated) => {
    if (error instanceof ImageGenerationError) return error;
    const message = String(error?.message || error || '');
    if (/quota|exceeded.*gpu|gpu.*(?:exhaust|limit)/i.test(message)) {
        return new ImageGenerationError('The free Hugging Face GPU quota is exhausted. Wait for it to reset and try again. No paid fallback was used.', 429);
    }
    if (error?.status === 401 || error?.status === 403 || /unauthorized|forbidden|invalid.*token|authentication/i.test(message)) {
        return new ImageGenerationError(authenticated
            ? 'Hugging Face rejected the token. Set a valid Read token in serveur/.env as HF_TOKEN and restart the backend.'
            : 'This Hugging Face Space requires sign-in for this request. Set a Read token in serveur/.env as HF_TOKEN and restart the backend.', 503);
    }
    return new ImageGenerationError('The Hugging Face Space is unavailable or could not generate this image. Try again later.');
};

const waitWithSignal = (promise, signal) => new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
});

const downloadImage = async (url, signal, fetchImage) => {
    let parsed;
    try { parsed = new URL(url); } catch {
        throw new ImageGenerationError('The Space returned an invalid image URL.');
    }
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.hf.space') || parsed.username || parsed.password || parsed.port) {
        throw new ImageGenerationError('The Space returned an unsupported image URL.');
    }

    // This integration uses a public Space. Never forward the account token to file URLs.
    const response = await fetchImage(parsed.href, { signal, redirect: 'error' });
    const mimeType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!response.ok || !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
        throw new ImageGenerationError('The Space did not return a supported image. Please try again.');
    }
    const maxBytes = 15 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > maxBytes) {
        await response.body?.cancel();
        throw new ImageGenerationError('The generated image is too large.');
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > maxBytes) throw new ImageGenerationError('The generated image is too large.');
        chunks.push(chunk);
    }
    if (!bytes) throw new ImageGenerationError('The Space returned an empty image.');
    return { photo: Buffer.concat(chunks).toString('base64'), mimeType };
};

export const generateWithHuggingFace = async (prompt, {
    mode = 'full',
    style = 'sport',
    palette,
    seed,
    garment = 'tshirt',
    token = process.env.HF_TOKEN,
    spaceId = process.env.HF_SPACE_ID || 'black-forest-labs/FLUX.1-schnell',
    signal,
    timeoutMs = 150_000,
    connectSpace = (...args) => Client.connect(...args),
    fetchImage = fetch,
} = {}) => {
    const artworkOptions = normalizeArtworkOptions({ mode, style, palette, seed, garment });
    const accessToken = token?.trim();
    if (accessToken && !accessToken.startsWith('hf_')) {
        throw new ImageGenerationError('HF_TOKEN must start with hf_. Correct it in serveur/.env, or leave it blank to use the public Space anonymously, then restart the backend.', 503);
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(spaceId)) {
        throw new ImageGenerationError('HF_SPACE_ID must have the form owner/space-name.', 503);
    }

    const deadline = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let client;
    let job;
    let finished = false;
    let cancellationRequested = false;
    const cancelJob = () => {
        if (job && !finished && !cancellationRequested) {
            cancellationRequested = true;
            // cancel() does not end Gradio's event iterator; return() closes it locally.
            void Promise.resolve().then(() => job.cancel()).catch(() => {});
            void Promise.resolve().then(() => job.return?.()).catch(() => {});
        }
    };
    const cleanup = () => {
        cancelJob();
        if (client) {
            const connection = client;
            client = null;
            connection.close?.();
        }
    };
    requestSignal.addEventListener('abort', cleanup, { once: true });

    const run = async () => {
        try {
            requestSignal.throwIfAborted();
            client = await connectSpace(spaceId, {
                ...(accessToken ? { token: accessToken } : {}),
                events: ['data', 'status'],
            });
            requestSignal.throwIfAborted();
            job = client.submit('/infer', {
                prompt: buildArtworkPrompt(prompt, mode, artworkOptions),
                seed: seed ?? 0,
                randomize_seed: seed === undefined,
                width: 1024,
                height: 1024,
                num_inference_steps: 4,
            });
            for await (const event of job) {
                requestSignal.throwIfAborted();
                if (event.type === 'status' && event.stage === 'error') throw new Error(event.message);
                if (event.type === 'data') {
                    finished = true;
                    const imageUrl = event.data?.[0]?.url;
                    if (!imageUrl) throw new ImageGenerationError('The Space returned no image. Please try a different prompt.');
                    const image = await downloadImage(imageUrl, requestSignal, fetchImage);
                    const actualSeed = event.data?.[1];
                    return { ...image, seed: isValidSeed(actualSeed) ? actualSeed : null };
                }
            }
            throw new ImageGenerationError('The Space finished without returning an image.');
        } finally {
            cleanup();
        }
    };

    try {
        return await waitWithSignal(run(), requestSignal);
    } catch (error) {
        if (deadline.aborted) throw new ImageGenerationError('The Hugging Face queue took too long. Try again later; the Space may still be finishing the request.', 504);
        if (signal?.aborted) throw new ImageGenerationError('Image generation was cancelled.', 499);
        throw normalizeError(error, Boolean(accessToken));
    } finally {
        requestSignal.removeEventListener('abort', cleanup);
    }
};
