# Project scan and image API recommendation

> Historical scan, before the Hugging Face integration. The user subsequently chose a zero-budget workflow; the current setup uses Hugging Face ZeroGPU Spaces. See [README.md](README.md) for current setup and limits. Some findings below have since been addressed.

Reviewed September 21, 2026. Scope: application source, frontend/backend configuration, dependency manifests, documentation, and shirt model metadata. Application source and provider settings were not changed. No paid generation calls or browser interaction tests were performed; recommendations are based on code and current official documentation, not a comparative image-quality benchmark.

## Recommendation

Start with the OpenAI Image API and `gpt-image-2.5-sunburst` for quality-focused artwork and precise edits. The project already has an OpenAI server integration. Sunburst is documented as OpenAI's most capable image model; `gpt-image-2.5-flare` is the faster alternative. This is a recommendation for this project's needs, not a claim that one provider wins every design style. Sources: [Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst), [Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare).

For chest graphics, request `quality: "high"`, `background: "transparent"`, and `output_format: "png"`. Start with a square or portrait output and keep the original image for export. Both models document transparency support. Source: [Image API parameters](https://developers.openai.com/api/reference/cli/resources/images/methods/generate).

The intended flow is: prompt → flat artwork → placement on the existing 3D shirt → original artwork download. A generated photograph of a T-shirt would become a picture of a shirt printed on the existing model. Generating garment shapes, sewing patterns, or manufacturing specifications requires a separate workflow.

## Current architecture and configuration

| Area | What is present |
| --- | --- |
| Frontend | React 18 + Vite, Tailwind, Framer Motion, Valtio |
| Preview | Three.js, React Three Fiber, Drei; existing `public/shirt_baked.glb` |
| Server | Separate Express service in `serveur/`, port 8080 |
| API | `POST /api/v1/dalle`, accepting `{ prompt }`, returning base64 in `{ photo }` |
| Providers | Pollinations, OpenAI, Gemini branches |
| Local provider | `serveur/.env` selects `pollinations`, unless overridden by the process environment |
| OpenAI fallback settings | `gpt-image-1-mini`, `1024x1024`, `quality: 'low'` |
| Gemini fallback model | `gemini-2.5-flash-image` |
| Design features | Shirt color, uploaded logo/image, AI image, logo/full overlay toggles |

Only non-secret provider/model settings and the presence of credential variables were checked. Credential validity and provider account access were not verified. This directory has no Git repository metadata.

## Findings, in implementation priority

1. **Quality settings need upgrading.** The OpenAI path explicitly requests low quality, and it is not the locally selected provider. Changing a key or model environment variable alone will not change that hardcoded quality. See [server route](serveur/route/dalle.routes.js), lines 13–25.

2. **Logo and full-shirt requests are identical.** Both UI actions send only the prompt. The server cannot distinguish isolated transparent artwork from a repeating fabric pattern. Send a validated mode and use separate instructions/output settings. See [customizer](src/pages/Costumizer.jsx), lines 57–77, and [server route](serveur/route/dalle.routes.js), lines 80–94.

3. **Full-shirt coverage needs a rendering change.** The full option is a single projected `Decal`, not a texture mapped to garment panels. The GLB contains UV coordinates (`TEXCOORD_0`), so a UV-based workflow is possible, but its layout and seams need visual inspection. A better image API alone will not fix wraparound distortion or seam alignment. See [shirt renderer](src/canvas/Shirt.jsx), lines 27–44.

4. **Original-art export is missing.** The download helper is imported but unused. It exports a canvas screenshot, not the generated source artwork. Add separate original-art and preview downloads, retaining pixel dimensions and transparency. See [helpers](src/config/helpers.js), lines 1–17, and [customizer](src/pages/Costumizer.jsx), line 9.

5. **Public paid generation has no access or usage controls.** The POST endpoint has no authentication, rate limiting, or per-user quota. Anyone able to reach it can trigger requests. Add appropriate access controls and generation budgets before deploying with a paid provider. Restricting CORS alone is not authentication. See [server](serveur/index.js), lines 10–13, and [route](serveur/route/dalle.routes.js), line 80.

6. **Production backend URL is hardcoded.** Production builds send prompts to `https://devswag.onrender.com/api/v1/dalle`. Use a deployment environment variable pointing to the intended backend. See [frontend config](src/config/config.js), line 6.

7. **OpenAI initialization blocks unrelated providers without its credentials.** The client is constructed at module load, before provider selection. The installed SDK throws when credentials are absent, even if Gemini or Pollinations was selected. Initialize only the chosen provider. See [route](serveur/route/dalle.routes.js), line 9.

8. **Invalid provider configuration silently selects Pollinations.** Reject unknown provider names at startup rather than switching providers silently. See [route](serveur/route/dalle.routes.js), line 92.

9. **Prompt and image validation need strengthening.** Whitespace, non-string values, and oversized prompts pass the initial truthiness check. The JSON limit is 50 MB for a text-only route. Pollinations response bytes are not validated as an image; Gemini's MIME type is discarded; the browser assumes PNG. Return and validate image metadata. See [route](serveur/route/dalle.routes.js), lines 42, 73, 84, and [server](serveur/index.js), line 11.

10. **Failures are difficult to recover from.** Fetch calls have no application-level timeout/cancellation. The AI panel closes on failure, and the UI uses alerts. Upload actions can run before a file is selected; file read failures have no handler. Preserve the prompt and panel on errors, validate upload size/type, and surface actionable messages. See [customizer](src/pages/Costumizer.jsx), lines 57–83 and 119–123, and [file picker](src/comp/FilePiker.jsx).

11. **Design refinement and saving are absent.** The state is memory-only; refresh loses artwork. Uploaded images are not passed to AI, so reference-based generation and edits are unavailable. Save original images and metadata, then add revisions and undo. See [store](src/store/index.js), lines 4–10.

12. **Large artwork will magnify rendering overhead.** The entire state, including base64 images, is serialized into a React key. Every state change remounts the shirt group. Use stable identity and targeted updates. There is also no full rotation control for inspecting the back. See [shirt](src/canvas/Shirt.jsx), lines 16–19, and [camera](src/canvas/CameraRig.jsx), lines 34–38.

13. **Accessibility and setup need cleanup.** Tabs are clickable divs without keyboard interaction. The backend hardcodes port 8080 and starts with nodemon. The README describes Next.js, although this is Vite/React + Express. Add accurate setup instructions, a secret-free environment example, and an explicit supported Node version. See [tabs](src/comp/Tab.jsx), [server](serveur/index.js), [backend manifest](serveur/package.json), and [README](README.md).

## API alternatives

| API | Why consider it | Cost and integration considerations |
| --- | --- | --- |
| OpenAI `gpt-image-2.5-sunburst` | Quality-focused generation, precise edits, documented transparent output; existing server integration | $30 per million image output tokens, plus input charges. Actual per-image cost varies; do not reuse an older model's per-image estimate. [Model and pricing](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst) |
| Google `gemini-3.1-flash-image` | Generation/editing with resolution options through 4K; existing Gemini branch can be adapted | Standard image-output charges: $0.067 at 1K, $0.101 at 2K, $0.151 at 4K, plus input and text/thinking charges. No explicit transparent-background guarantee found in the reviewed guide. [Image guide](https://ai.google.dev/gemini-api/docs/image-generation), [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Black Forest Labs `flux-2-pro` | Another option for illustration and texture experiments; output up to 4 megapixels | Text-to-image starts at $0.03; resolution affects cost. Requires submit/poll/download handling. No explicit alpha-background option found in the reviewed schema. [Model overview](https://docs.bfl.ai/flux_2/flux2_overview), [pricing](https://docs.bfl.ai/quick_start/pricing) |

Gemini's existing `gemini-2.5-flash-image` default is legacy; Google's current pricing page lists shutdown on October 2, 2026. Update that model if choosing Gemini. [Google pricing and model lifecycle notice](https://ai.google.dev/gemini-api/docs/pricing).

FLUX output URLs expire after 10 minutes, so persist returned images. Also, 4 megapixels and a 4K image are different resolution measures. [FLUX integration guide](https://docs.bfl.ai/flux_2/flux2_text_to_image).

## Proposed first implementation

1. Keep the existing Express-to-image-provider architecture. Select OpenAI explicitly and configure model/quality on the server; keep credentials server-side.
2. Add `mode: "graphic" | "pattern"` to requests. Graphic mode asks for isolated artwork with transparency; pattern mode asks for an opaque repeating pattern. Inspect tile edges rather than assuming a prompt guarantees seamless output.
3. Return image data with MIME type, dimensions, and model metadata. Preserve original artwork separately from the 3D preview.
4. Add graphic position/scale controls and original PNG download. Build and inspect garment UV mapping for a subsequent all-over-print feature.
5. Add generation editing, timeouts, friendly errors, and the access/usage controls described above.

Suggested graphic prompt: “A bold vintage tiger illustration for the front of a black T-shirt, orange and cream palette, clean thick outlines, centered composition, isolated artwork, transparent background, no lettering, no shirt, no person, no mockup.” Request transparency through the API as well as the prompt. For exact slogans, consider adding editable text separately so spelling and placement stay under user control.

For printing, choose pixel dimensions from the desired physical print size and printer requirements. For example, 12 × 16 inches at 300 pixels per inch needs 3600 × 4800 pixels. Increasing a DPI metadata value does not add detail. Upscaling may be needed, followed by inspection. OpenAI's current custom output limits include a maximum 3840-pixel edge and experimental support above 2560 × 1440; do not promise arbitrary native print dimensions. [Output limits](https://developers.openai.com/api/docs/guides/image-generation).

## Verification

- `npm run build`: passed. Generated JS bundle approximately 1.37 MB, 397 KB gzip; Vite warned about chunk size. Also emitted outdated Browserslist-data and dependency eval warnings.
- `npm run lint`: failed with 51 errors. They include unused imports, missing prop validation, and ESLint configuration gaps for Node globals and Three.js JSX properties. These are not 51 demonstrated runtime failures.
- Backend JavaScript syntax checks: passed.
- Backend `npm ls --depth=0`: passed.
- Parsed the GLB metadata: one mesh, UV coordinates, normal and occlusion textures present.
- No live API quality, latency, billing, or account-access tests were performed. No dependency vulnerability audit or browser/device rendering audit was performed.

This report is the only authored project change; the build command also produced build artifacts in `dist/`.
