import { Client } from '@gradio/client';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildArtworkPrompt } from '../services/huggingface.js';

// One anonymous public-Space sample. No account credentials or paid API calls.
const prompt = 'A fierce vintage tiger head surrounded by a small rising sun and curved botanical leaves, bold orange, cream and deep black palette, crisp thick ink outlines, balanced symmetrical composition, retro screen-print illustration, subtle distressed ink texture, no text or lettering.';
const spaceId = 'black-forest-labs/FLUX.1-schnell';
let client;
let job;
let completed = false;
const timeout = setTimeout(() => {
    console.error('The free Space did not finish within 150 seconds.');
    void job?.cancel().catch(() => {});
    void job?.return?.();
    client?.close();
    process.exitCode = 1;
}, 150_000);

try {
    client = await Client.connect(spaceId, { events: ['data', 'status'] });
    console.log('Connected to the public FLUX.1 Schnell Space.');
    job = client.submit('/infer', {
        prompt: buildArtworkPrompt(prompt, 'logo'),
        seed: 124,
        randomize_seed: false,
        width: 1024,
        height: 1024,
        num_inference_steps: 4,
    });
    for await (const event of job) {
        if (event.type === 'status') {
            console.log(JSON.stringify({ stage: event.stage, queuePosition: event.position, message: event.message }));
            if (event.stage === 'error') throw new Error(event.message || 'Generation failed.');
        }
        if (event.type !== 'data') continue;
        completed = true;
        const url = new URL(event.data?.[0]?.url);
        if (url.protocol !== 'https:' || !url.hostname.endsWith('.hf.space')) throw new Error('Unexpected image host.');
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
        const mimeType = response.headers.get('content-type')?.split(';')[0];
        const extension = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' }[mimeType];
        if (!response.ok || !extension) throw new Error('The Space did not return an image file.');
        const image = Buffer.from(await response.arrayBuffer());
        const directory = new URL('../../output/', import.meta.url);
        await mkdir(directory, { recursive: true });
        const imageFile = new URL(`huggingface-tiger-sample.${extension}`, directory);
        await writeFile(imageFile, image);
        await writeFile(new URL('huggingface-tiger-sample.json', directory), JSON.stringify({
            provider: 'Hugging Face ZeroGPU Space', spaceId, authenticated: false,
            prompt: buildArtworkPrompt(prompt, 'logo'), seed: event.data?.[1] ?? 124,
            width: 1024, height: 1024, steps: 4, mimeType,
        }, null, 2));
        console.log(JSON.stringify({ saved: fileURLToPath(imageFile), bytes: image.byteLength, mimeType }));
        break;
    }
    if (!completed) throw new Error('No image returned.');
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    clearTimeout(timeout);
    if (job && !completed) void job.cancel().catch(() => {});
    client?.close();
}
