import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@gradio/client';
import { generateWithHuggingFace, ImageGenerationError, normalizeArtworkOptions } from '../services/huggingface.js';

const token = 'hf_test_token_not_a_real_credential';
const imageUrl = 'https://black-forest-labs-flux-1-schnell.hf.space/file=output.png';
const imageBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
);
const imageEvent = { type: 'data', data: [{ url: imageUrl }, 123] };

const fixture = ({ events = [imageEvent], response, job: suppliedJob } = {}) => {
    const calls = { connections: [], submissions: [], downloads: [], cancellations: 0, closes: 0 };
    const job = suppliedJob || {
        async *[Symbol.asyncIterator]() {
            yield* events;
        },
        cancel() { calls.cancellations += 1; },
    };
    const options = {
        token,
        spaceId: 'black-forest-labs/FLUX.1-schnell',
        timeoutMs: 1000,
        connectSpace: async (...args) => {
            calls.connections.push(args);
            return {
                submit(...submission) {
                    calls.submissions.push(submission);
                    return job;
                },
                close() { calls.closes += 1; },
            };
        },
        fetchImage: async (...args) => {
            calls.downloads.push(args);
            return response || new Response(imageBytes, { headers: { 'content-type': 'image/png; charset=binary' } });
        },
    };
    return { options, calls };
};

const rejectsWithStatus = (status, pattern) => (error) => {
    assert.ok(error instanceof ImageGenerationError);
    assert.equal(error.status, status);
    if (pattern) assert.match(error.message, pattern);
    assert.ok(!error.message.includes(token), 'Provider credentials must never appear in public errors');
    return true;
};

// A real timer keeps Node alive while AbortSignal.timeout's unreferenced timer runs.
// Match Gradio: cancel requests remote cancellation; return ends the local iterator.
const pendingJob = () => {
    let release;
    let timer;
    let cancellations = 0;
    let started;
    const waiting = new Promise((resolve) => { started = resolve; });
    const job = {
        [Symbol.asyncIterator]() { return this; },
        next() {
            started();
            return new Promise((resolve) => {
                release = resolve;
                timer = setTimeout(() => resolve({ done: true }), 1000);
            });
        },
        cancel() {
            cancellations += 1;
        },
        async return() {
            clearTimeout(timer);
            release?.({ done: true });
            return { done: true };
        },
    };
    return { job, waiting, cancellations: () => cancellations };
};

test('returns image MIME, base64 and actual seed without sending the HF token to the image URL', async () => {
    const { options, calls } = fixture();
    const result = await generateWithHuggingFace('A moon riding a skateboard', options);

    assert.deepEqual(result, { photo: imageBytes.toString('base64'), mimeType: 'image/png', seed: 123 });
    assert.deepEqual(calls.connections, [[options.spaceId, { token, events: ['data', 'status'] }]]);
    assert.equal(calls.submissions[0][0], '/infer');
    assert.equal(calls.downloads.length, 1);
    assert.equal(calls.downloads[0][0], imageUrl);
    assert.equal(calls.downloads[0][1].redirect, 'error');
    assert.ok(calls.downloads[0][1].signal instanceof AbortSignal);
    assert.equal(calls.downloads[0][1].headers, undefined);
    assert.equal(calls.cancellations, 0);
    assert.equal(calls.closes, 1);
});

test('default Gradio connection preserves the static method receiver', async (t) => {
    const { options } = fixture();
    const fakeConnect = options.connectSpace;
    delete options.connectSpace;
    t.mock.method(Client, 'connect', function (...args) {
        assert.equal(this, Client, 'Client.connect constructs new this() and must retain its receiver');
        return fakeConnect(...args);
    });
    const result = await generateWithHuggingFace('A mountain', options);
    assert.equal(result.mimeType, 'image/png');
});

test('logo and full modes request distinct artwork while preserving the user description', async () => {
    const prompt = 'An orange astronaut cat with stars';
    for (const mode of ['logo', 'full']) {
        const { options, calls } = fixture();
        await generateWithHuggingFace(prompt, { ...options, mode });
        const submittedPrompt = calls.submissions[0][1].prompt;
        assert.ok(submittedPrompt.includes(prompt));
        assert.match(submittedPrompt, /Artwork only/);
        assert.match(submittedPrompt, /no T-shirt, clothing mockup/);
        if (mode === 'logo') {
            assert.match(submittedPrompt, /centered.*illustration/);
            assert.match(submittedPrompt, /plain white background/);
            assert.doesNotMatch(submittedPrompt, /seamless repeating/);
        } else {
            assert.match(submittedPrompt, /seamless repeating textile pattern/);
            assert.match(submittedPrompt, /matching edges/);
        }
    }
});

test('default generation requests all-over sport textile artwork with a randomized seed', async () => {
    const { options, calls } = fixture();
    await generateWithHuggingFace('Ocean-inspired flowing bands', options);
    const input = calls.submissions[0][1];
    assert.match(input.prompt, /seamless repeating textile pattern for a T-shirt, edge-to-edge/);
    assert.match(input.prompt, /Technical sportswear/);
    assert.match(input.prompt, /fabric folds, lighting, shadows, logos, lettering, borders/);
    assert.doesNotMatch(input.prompt, /plain white background|generous margins|centered T-shirt print/);
    assert.equal(input.randomize_seed, true);
    assert.equal(input.seed, 0);
    assert.equal(input.width, 1024);
    assert.equal(input.height, 1024);
    assert.equal(input.num_inference_steps, 4);
});

test('garment selection reaches the textile brief while keeping user colors', async () => {
    for (const [garment, label] of [
        ['tshirt', 'T-shirt'], ['dress', 'dress'], ['suit', 'tailored suit'], ['hoodie', 'hoodie'],
        ['pants', 'pants'], ['jacket', 'jacket'], ['hat', 'hat'], ['bag', 'backpack'],
    ]) {
        const { options, calls } = fixture();
        await generateWithHuggingFace('Pink fabric with white petals', { ...options, garment, style: 'botanical' });
        const prompt = calls.submissions[0][1].prompt;
        assert.ok(prompt.includes(`pattern for a ${label}`));
        assert.ok(prompt.includes('Pink fabric with white petals'));
        assert.doesNotMatch(prompt, /deep navy, burgundy/);
    }
});

test('style and palette guide the textile brief while preserving the user description', async () => {
    const styles = {
        sport: /Technical sportswear/,
        minimal: /Minimal designer textile/,
        botanical: /Botanical textile/,
        abstract: /Modern abstract textile/,
    };
    const palette = ['#102a43', '#a51c30', '#f4c95d'];
    for (const [style, expected] of Object.entries(styles)) {
        const { options, calls } = fixture();
        await generateWithHuggingFace('Midnight waveforms', { ...options, style, palette });
        const prompt = calls.submissions[0][1].prompt;
        assert.match(prompt, expected);
        assert.match(prompt, /#102A43, #A51C30, #F4C95D/);
        assert.match(prompt, /Midnight waveforms/);
        assert.doesNotMatch(prompt, /deep navy, burgundy and warm gold/);
        assert.ok(prompt.split(/\s+/).length < 100, 'Keep the textile wrapper concise for the model');
    }
    assert.deepEqual(palette, ['#102a43', '#a51c30', '#f4c95d'], 'Do not mutate caller palette');
});

test('explicit seeds disable randomization and the response reports the provider seed', async () => {
    for (const seed of [0, 987654, 2147483647]) {
        const { options, calls } = fixture();
        const image = await generateWithHuggingFace('A geometric repeat', { ...options, seed });
        assert.equal(calls.submissions[0][1].seed, seed);
        assert.equal(calls.submissions[0][1].randomize_seed, false);
        assert.equal(image.seed, 123, 'Return the actual provider seed, not the submitted seed');
    }
});

test('missing or malformed provider seed never invents a reproducible seed', async () => {
    for (const seed of [undefined, null, '123', -1, 0.5, 2147483648]) {
        const { options } = fixture({ events: [{ type: 'data', data: [{ url: imageUrl }, seed] }] });
        const image = await generateWithHuggingFace('A geometric repeat', options);
        assert.equal(image.seed, null);
        assert.equal(image.mimeType, 'image/png');
    }
});

test('shared request validation applies full/sport defaults and accepts two to four hex colors', () => {
    assert.deepEqual(normalizeArtworkOptions(), {
        mode: 'full', style: 'sport', palette: undefined, seed: undefined, garment: 'tshirt',
    });
    for (const palette of [['#000000', '#ffffff'], ['#000000', '#ffffff', '#aabbcc', '#dd0011']]) {
        assert.deepEqual(normalizeArtworkOptions({ palette }).palette, palette.map((color) => color.toUpperCase()));
    }
});

test('invalid modes, styles, palettes and seeds fail with 400 before connecting or downloading', async () => {
    const invalidOptions = [
        { mode: 'mockup' }, { mode: null },
        { garment: 'cape' }, { garment: null }, { garment: 'toString' },
        { style: 'unknown' }, { style: null }, { style: 'toString' },
        { palette: null }, { palette: '#ffffff' }, { palette: [] }, { palette: ['#ffffff'] },
        { palette: Array(5).fill('#ffffff') }, { palette: ['white', '#000000'] },
        { palette: ['#FFF', '#000000'] }, { palette: ['#ffffff', 123456] },
        { seed: -1 }, { seed: 1.5 }, { seed: 2147483648 }, { seed: '123' }, { seed: null },
    ];
    for (const invalid of invalidOptions) {
        const { options, calls } = fixture();
        await assert.rejects(generateWithHuggingFace('A geometric repeat', { ...options, ...invalid }), rejectsWithStatus(400));
        assert.equal(calls.connections.length, 0, JSON.stringify(invalid));
        assert.equal(calls.downloads.length, 0);
    }
});

test('blank tokens allow anonymous generation without a token connection property', async () => {
    for (const blankToken of ['', '   ']) {
        const { options, calls } = fixture();
        const result = await generateWithHuggingFace('A mountain', { ...options, token: blankToken });

        assert.equal(result.mimeType, 'image/png');
        assert.deepEqual(calls.connections, [[options.spaceId, { events: ['data', 'status'] }]]);
        assert.equal(calls.downloads.length, 1);
        assert.equal(calls.closes, 1);
    }
});

test('an unset HF_TOKEN allows anonymous generation', async () => {
    const previousToken = process.env.HF_TOKEN;
    delete process.env.HF_TOKEN;
    try {
        const { options, calls } = fixture();
        delete options.token;
        const result = await generateWithHuggingFace('A mountain', options);

        assert.equal(result.mimeType, 'image/png');
        assert.deepEqual(calls.connections, [[options.spaceId, { events: ['data', 'status'] }]]);
    } finally {
        if (previousToken === undefined) delete process.env.HF_TOKEN;
        else process.env.HF_TOKEN = previousToken;
    }
});

test('a supplied valid token is trimmed before connection', async () => {
    const { options, calls } = fixture();
    await generateWithHuggingFace('A mountain', { ...options, token: `  ${token}\n` });
    assert.deepEqual(calls.connections, [[options.spaceId, { token, events: ['data', 'status'] }]]);
});

test('a malformed nonblank token fails before connecting or downloading', async () => {
    for (const invalidToken of ['not-an-hf-token', '  not-an-hf-token  ']) {
        const { options, calls } = fixture();
        await assert.rejects(
            generateWithHuggingFace('A mountain', { ...options, token: invalidToken }),
            rejectsWithStatus(503, /HF_TOKEN/),
        );
        assert.equal(calls.connections.length, 0);
        assert.equal(calls.downloads.length, 0);
    }
});

test('quota status errors become 429 responses and do not expose provider details', async () => {
    for (const configuredToken of [token, '']) {
        const { options, calls } = fixture({
            events: [{ type: 'status', stage: 'error', message: `GPU quota exceeded; Authorization: Bearer ${token}` }],
        });
        await assert.rejects(
            generateWithHuggingFace('A mountain', { ...options, token: configuredToken }),
            rejectsWithStatus(429, /quota.*exhausted.*No paid fallback was used/i),
        );
        assert.equal(calls.connections.length, 1);
        assert.equal(calls.downloads.length, 0);
        assert.equal(calls.closes, 1);
        assert.ok(calls.cancellations > 0);
    }
});

test('connection authentication errors are sanitized', async () => {
    const { options, calls } = fixture();
    options.connectSpace = async () => {
        throw Object.assign(new Error(`Rejected credential ${token}`), { status: 401 });
    };
    await assert.rejects(generateWithHuggingFace('A mountain', options), rejectsWithStatus(503, /rejected the token/));
    assert.equal(calls.downloads.length, 0);
});

test('anonymous authentication errors explain that the Space requires sign-in', async () => {
    for (const source of ['connection', 'job']) {
        const { options, calls } = fixture({
            events: [{ type: 'status', stage: 'error', message: 'Authentication required for this Space' }],
        });
        if (source === 'connection') {
            options.connectSpace = async () => {
                throw Object.assign(new Error('Authentication required'), { status: 401 });
            };
        }
        await assert.rejects(
            generateWithHuggingFace('A mountain', { ...options, token: '' }),
            (error) => {
                rejectsWithStatus(503, /Space requires sign-in/i)(error);
                assert.doesNotMatch(error.message, /rejected the token/i);
                return true;
            },
        );
        assert.equal(calls.downloads.length, 0);
        if (source === 'job') assert.equal(calls.closes, 1);
    }
});

test('unsupported image URLs fail without a download', async () => {
    for (const url of [
        'not a URL',
        'http://example.hf.space/file.png',
        'https://example.com/file.png',
        'https://example.hf.space.evil.test/file.png',
        'https://127.0.0.1/file.png',
        'https://user:password@example.hf.space/file.png',
        'https://example.hf.space:444/file.png',
        'data:image/png;base64,AAAA',
    ]) {
        const { options, calls } = fixture({ events: [{ type: 'data', data: [{ url }] }] });
        await assert.rejects(generateWithHuggingFace('A mountain', options), rejectsWithStatus(502, /image URL/));
        assert.equal(calls.downloads.length, 0, url);
        assert.equal(calls.closes, 1);
    }
});

test('rejects nonimage responses and failed HTTP downloads', async () => {
    for (const response of [
        new Response('<html>Not an image</html>', { headers: { 'content-type': 'text/html' } }),
        new Response(imageBytes, { status: 404, headers: { 'content-type': 'image/png' } }),
    ]) {
        const { options } = fixture({ response });
        await assert.rejects(generateWithHuggingFace('A mountain', options), rejectsWithStatus(502, /supported image/));
    }
});

test('rejects empty and oversized image responses', async () => {
    for (const response of [
        new Response('', { headers: { 'content-type': 'image/png' } }),
        new Response(imageBytes, { headers: { 'content-type': 'image/png', 'content-length': String(16 * 1024 * 1024) } }),
    ]) {
        const { options } = fixture({ response });
        await assert.rejects(generateWithHuggingFace('A mountain', options), rejectsWithStatus(502, /empty image|too large/));
    }
});

test('deadline cancels and closes a waiting job even when cancel does not finish iteration', async (t) => {
    const pending = pendingJob();
    t.after(() => pending.job.return());
    const { options, calls } = fixture({ job: pending.job });
    await assert.rejects(
        generateWithHuggingFace('A mountain', { ...options, timeoutMs: 20 }),
        rejectsWithStatus(504, /took too long/),
    );
    assert.ok(pending.cancellations() > 0);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.closes, 1);
});

test('caller cancellation aborts and closes a waiting job and returns 499', async (t) => {
    const controller = new AbortController();
    const pending = pendingJob();
    t.after(() => pending.job.return());
    const { options, calls } = fixture({ job: pending.job });
    const result = generateWithHuggingFace('A mountain', { ...options, signal: controller.signal });
    await pending.waiting;
    controller.abort();
    await assert.rejects(result, rejectsWithStatus(499, /cancelled/));
    assert.ok(pending.cancellations() > 0);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.closes, 1);
});

test('an already aborted request never connects', async () => {
    const { options, calls } = fixture();
    await assert.rejects(
        generateWithHuggingFace('A mountain', { ...options, signal: AbortSignal.abort() }),
        rejectsWithStatus(499, /cancelled/),
    );
    assert.equal(calls.connections.length, 0);
    assert.equal(calls.downloads.length, 0);
});

test('missing image data and a job ending without image data fail clearly', async () => {
    for (const events of [[], [{ type: 'data', data: [] }], [{ type: 'status', stage: 'complete' }]]) {
        const { options, calls } = fixture({ events });
        await assert.rejects(
            generateWithHuggingFace('A mountain', options),
            rejectsWithStatus(502, /no image|without returning an image/),
        );
        assert.equal(calls.downloads.length, 0);
        assert.equal(calls.closes, 1);
    }
});
