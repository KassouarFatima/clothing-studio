import express from 'express'
import * as dotenv from 'dotenv'
import OpenAI from 'openai'
import { fileURLToPath } from 'node:url'
import { generateWithHuggingFace, ImageGenerationError, normalizeArtworkOptions, buildArtworkPrompt } from '../services/huggingface.js'
import { generateLocalArtwork } from '../services/fallbackArtwork.js'
import { generateArtViaAtelier } from '../services/atelierBridge.js'

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const router = express.Router();

const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1-mini';
const IMAGE_PROVIDER = process.env.IMAGE_PROVIDER || 'huggingface';
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

const generateWithOpenAI = async (prompt) => {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    // gpt-image models always return base64 (b64_json)
    const response = await openai.images.generate({
        model: IMAGE_MODEL,
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'low',
    });

    return response.data[0].b64_json;
}

// Legacy integration, used only when explicitly selected.
const generateWithPollinations = async (prompt) => {
    const response = await fetch(
        `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`
    );

    if (!response.ok) {
        const error = new Error(`Pollinations request failed (${response.status})`);
        error.status = response.status;
        throw error;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.toString('base64');
}

const generateWithGemini = async (prompt, signal) => {
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': process.env.GEMINI_API_KEY,
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseModalities: ['IMAGE'] },
            }),
            ...(signal ? { signal } : {}),
        }
    );

    const data = await response.json();

    if (!response.ok) {
        const error = new Error(data.error?.message || 'Gemini request failed');
        error.status = response.status;
        throw error;
    }

    const imagePart = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData);
    if (!imagePart) throw new Error('Gemini did not return an image');

    return imagePart.inlineData.data;
}

router.route('/').get((req, res) => {
    res.status(200).json({ message: 'Image generation service', provider: IMAGE_PROVIDER })
})

router.route('/').post(async (req, res) => {
    const controller = new AbortController();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', onClose);
    try {
        const { prompt, mode, style, palette, seed, garment } = req.body || {};

        if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) {
            return res.status(400).json({ message: 'Enter a prompt between 1 and 2000 characters.' });
        }
        const artworkOptions = normalizeArtworkOptions({ mode, style, palette, seed, garment });

        if (IMAGE_PROVIDER === 'huggingface') {
            // The free sources get quota-blocked at busy hours; the tab never dead-ends:
            // Hugging Face -> Gemini image -> the Atelier's vector artist (free text
            // models, no GPU quota) -> the always-available local pattern generator.
            let image;
            try {
                image = await generateWithHuggingFace(prompt.trim(), {
                    ...artworkOptions,
                    signal: controller.signal,
                    timeoutMs: 45_000,
                });
            } catch (error) {
                if (controller.signal.aborted) throw error;
                console.warn(`AI tab: Hugging Face failed (${error.status ?? 502}) - ${error.message} - falling back to the Gemini image model`);
                try {
                    const geminiSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]);
                    const geminiPhoto = await generateWithGemini(
                        buildArtworkPrompt(prompt.trim(), artworkOptions.mode, artworkOptions),
                        geminiSignal,
                    );
                    image = { photo: geminiPhoto, mimeType: 'image/png', engine: 'gemini-image' };
                } catch (geminiError) {
                    if (controller.signal.aborted) throw geminiError;
                    console.warn(`AI tab: Gemini image failed - ${geminiError.message} - asking the Atelier vector artist`);
                    try {
                        const vector = await generateArtViaAtelier(
                            buildArtworkPrompt(prompt.trim(), artworkOptions.mode, artworkOptions),
                            { signal: controller.signal },
                        );
                        image = {
                            photo: vector.artwork.replace(/^data:image\/\w+;base64,/, ''),
                            mimeType: vector.artwork.match(/^data:([\w.+-]+);base64,/)?.[1] || 'image/png',
                            engine: vector.engine,
                        };
                    } catch (atelierError) {
                        if (controller.signal.aborted) throw atelierError;
                        console.warn(`AI tab: Atelier vector artist failed - ${atelierError.message} - drawing the local pattern`);
                        image = generateLocalArtwork({ prompt: prompt.trim(), ...artworkOptions });
                    }
                }
            }
            if (!controller.signal.aborted) res.status(200).json(image);
            return;
        }

        const generators = {
            pollinations: generateWithPollinations,
            gemini: generateWithGemini,
            openai: generateWithOpenAI,
        };

        const generator = Object.hasOwn(generators, IMAGE_PROVIDER) ? generators[IMAGE_PROVIDER] : null;
        if (!generator) throw new ImageGenerationError('Unknown IMAGE_PROVIDER. Set IMAGE_PROVIDER=huggingface in serveur/.env.', 503);
        const image = await generator(prompt.trim());

        res.status(200).json({ photo: image });
    } catch (error) {
        if (controller.signal.aborted) return;
        // Provider errors can contain authorization headers: do not log raw error objects.
        const status = error instanceof ImageGenerationError ? error.status : 502;
        res.status(status).json({ message: error instanceof ImageGenerationError ? error.message : 'Image generation failed. Check your provider configuration and try again.' });
    } finally {
        res.off('close', onClose);
    }
})

export default router;
