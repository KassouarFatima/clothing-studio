# Atelier — an AI clothing studio in a walkable 3D street

**Describe your clothes → an AI tailor designs them → see it in 3D → try it on your own photo → download print-ready files.**

Atelier is a boutique on a 3D Japanese shopping street that runs in the browser. Walk in, talk to **Yanis**, the AI
tailor, and he turns your idea ("a black tee with a golden eagle and the word LIBERTÉ") into a finished t-shirt.

Built for the **thirduni** competition.

## Features

- **Walkable 3D street**: about 30 shops with Japanese signage, utility poles and overhead wires, a torii shrine,
  cherry trees with falling petals, people walking, bicycles, birds, and anime-style ink outlines with ambient occlusion.
- **Yanis, the AI tailor**: a chat seller that understands any language and designs right away. He runs on Groq
  (about 1 s replies), with Gemini and Gemma as fallbacks.
- **AI design generation**: FLUX for illustrations, with a vector-artwork fallback (Gemini, then Groq).
- **Realistic 3D garments**: the design is printed into the fabric of a real garment model, on a turntable you can rotate.
  Choose a **T-shirt, long-sleeve tee, tank top, sweatshirt or hoodie** (with hood, drawstrings, kangaroo pocket and
  ribbing), and switch at any time: the print moves with you.
- **Describe a new garment type**: "+ New type" turns a description ("a cropped hoodie with a zip", "a long t-shirt
  dress with a V-neck") into a 3D garment. Sleeves, length, neckline, hood, zip, pockets, ribbing and fabric are all
  options. You then choose: **publish it to the catalogue** for everyone, **keep it just for you**, or discard it.
- **Try it on**:
  - *Realistic photo*: the FitDiT / IDM-VTON try-on models dress your photo. Only the clothing area is replaced, so
    your face and background stay untouched.
  - *Quick preview*: the 3D shirt follows your body live through the webcam (MediaPipe body tracking).
- **Print package**: a ZIP with a 4500×5400 px PNG at 300 DPI (transparent), a vector SVG, a PDF spec sheet (shirt
  colour, placement, size, ink colours) and mockups, ready to send to a print shop.
- **MODE, the fashion store** (left of the boutique): describe a style, an occasion or the clothes you want, and
  **Rin, the stylist**, puts together a complete look in 3D with **professionally made garments** (Marvelous Designer /
  CLO quality, prepared in Blender on one shared body frame, shown like an invisible-mannequin product shoot, with a
  studio HDRI light and ambient occlusion). She **searches the collection first** (112 colourful pieces from 22 garments — tops, dresses, coats, trousers, skirts, shoes, hats, a bag — and 29 ready-made looks, none of them all black) and
  **creates new colourways only when the colour you want isn't there**; if you ask for a shape we don't have, she says so
  and offers the closest. No image AI and no try-on quota are used. Save a look and it appears in the shop window.
  - **Your body & fit (virtual fitting room)**: choose Woman or Man and enter your height, chest, waist and hips: a
    realistic avatar (Blender Studio Human Base Meshes, CC0) is reshaped to your measurements and wears the look. Every
    garment is **fitted to the avatars in Blender** (`blender/fit_garments.py`: collar on the neck, shoulders, sleeves turned
    to the arms, trouser legs onto the legs, shoes on the feet, fabric pushed just outside the skin), and the clothes
    follow the body when you change your measurements, so body and clothes always match. Every garment's size chart is
    compared with your body to **recommend a size** (XS–XXL) with the ease at chest, waist and hips, you can try other
    sizes, and the **fit map** colours each zone: too tight, snug, good fit or loose. Measurements stay on your device.
  - **How to make it (tailor sheet)**: for every piece, the fabric to buy (type, weight, metres), the pattern pieces to
    cut, the sewing order, notions, seams and needles, and the measurements to take; download it as a PDF with the look's
    picture to send to a tailor.
- **Locked store designs**: designs in the store (like the official Thirduni tee) never change; trying one on another
  garment makes a copy.
- **Clear errors**: every AI request has a time limit and ends with a readable message, never an endless spinner.
- **Café Sakura** next door: walk in and order a drink from Mika the barista.
- **Sound**: city ambience, sparrows, the Japanese crossing signal, footsteps, and music inside each shop. It's all
  synthesised live, with no audio files.
- **Observability**: every chat, design and try-on is traced in LangSmith, including each model call, its timing and
  any errors.

## Run it

Requirements: Node.js 20+ and a modern desktop browser (Chrome recommended).

```bash
npm install
cp .env.example .env      # then add your own keys (see the comments in the file)
npm start                 # → http://localhost:8792/street.html
```

On macOS you can also double-click **`Open Atelier City.command`**.

Controls: **WASD** walk · **mouse** look · **Shift** faster · **E** talk to Yanis or Rin / try a design / order at the café ·
**M** sound · **Esc** pause.

Other views: `/mode.html` (the MODE stylist on its own), `/world.html` (v1, a photographed city square) and `/index.html` (the shop panel on its own).

## How it works

| Part | Technology |
|---|---|
| 3D world, shirt rendering | three.js (WebGL), post-processing (GTAO + custom outline pass) |
| AI seller | Groq (`gpt-oss-120b`) → Gemini → Gemma, JSON-structured replies |
| Designs | FLUX.1-schnell (Hugging Face Space) → vector SVG by Gemini/Groq |
| Try-on | FitDiT → IDM-VTON (Hugging Face Spaces), mask-based compositing with sharp |
| Webcam preview | MediaPipe Pose Landmarker + rigid 3D garment |
| Print files | sharp, pdfkit, imagetracerjs, archiver |
| Tracing | LangSmith REST API |

All API keys stay on the local server (`server.mjs`); the browser never sees them.

## Credits and licences

- Code: MIT.
- MODE garments (CC BY 4.0; resized, re-oriented, decimated and recoloured for the web — see `blender/prepare_garments.py`):
  - [Standard T-shirt](https://sketchfab.com/3d-models/standard-t-shirt-1815c01895bd4538bc0bd05c3394698d) by Pieter Ferreira — CC Attribution
  - [Men's Shirt](https://sketchfab.com/3d-models/mens-shirt-ab5e592ccab34ed0ad2777f9b32c2e0f) by johnniemaneiro — CC Attribution
  - [men's caro flannel shirt](https://sketchfab.com/3d-models/mens-caro-flannel-shirt-0af9b1465e8e46fa92e93f8bcad0a705) by funlab117 — CC Attribution
  - [Hoodie](https://sketchfab.com/3d-models/hoodie-6dca9cd855a8441881f0b324236cf325) by Pieter Ferreira — CC Attribution
  - [Men's Two Piece Suit](https://sketchfab.com/3d-models/mens-two-piece-suit-8cafbab7a73e4fb7966a00659a4e31ef) by DineshThennarasan — CC Attribution
  - [VETEMENTS Cargo Jeans / Wide-Leg Track Pants](https://sketchfab.com/3d-models/vetements-cargo-jeans-wide-leg-track-pants-a9067eecf6d24e75bdf28345027e7552) by SKVORSOW — CC Attribution
  - [Oversized Baggy Custom Jeans](https://sketchfab.com/3d-models/oversized-baggy-custom-jeans-a663bab1b858417da8c1b1765793309d) by SKVORSOW — CC Attribution
  - [female short jeans](https://sketchfab.com/3d-models/female-short-jeans-6b42c4a5591e4122940bd0fccde6f2f8) by Toxic — CC Attribution
  - [Plaid Gothic Mini Skirt](https://sketchfab.com/3d-models/plaid-gothic-mini-skirt-7a1869479e58422b84ad18533b5b4439) by Yasmany Batista — CC Attribution
  - [Converse — FREE](https://sketchfab.com/3d-models/converse-free-bc791439d26f4dd9974819c168e12385) by Yaroslav Karas — CC Attribution
  - [Adidas Racer TR21](https://sketchfab.com/3d-models/adidas-racer-tr21-bc0d0141da164d3c9f9fe71f6f340c9b) by inciprocal — CC Attribution
  - [Long Evening Dress](https://sketchfab.com/3d-models/long-evening-dress-05874623f9c34a63984e011579b29394) by samsikua — CC Attribution
  - [Evening Red Dress](https://sketchfab.com/3d-models/evening-red-dress-0e8acea5f2a14f08947837001bb0992d) by samsikua — CC Attribution
  - [Black Dress](https://sketchfab.com/3d-models/black-dress-c0516d4bba74464ca6a04b634cdf550b) by Konstantin R. — CC Attribution
  - [Female Overcoat](https://sketchfab.com/3d-models/female-overcoat-4bc89e3be7fb4c11b3b1153e9ea384dd) by 3DGunsmith — CC Attribution
  - [Pale Green Padded Parka Coat](https://sketchfab.com/3d-models/pale-green-padded-parka-coat-3ef9e8b2dcf344f281eeec498103c401) by 2021-Hydrema912-2021 — CC Attribution
  - [Classic high heel pumps](https://sketchfab.com/3d-models/classic-high-heel-pumps-e968fd35a2f1474996bc1536ae85970f) by Andrey — CC Attribution
  - [High Heels](https://sketchfab.com/3d-models/high-heels-1561c09fc45349d680e48e3e007b64e0) by cebraVFX — CC Attribution
  - [Womens chelsea boot black](https://sketchfab.com/3d-models/womens-chelsea-boot-black-459c0864e8cc441cb12cd50566479844) by victorn8c — CC Attribution
  - [Coraline Riding Boot](https://sketchfab.com/3d-models/coraline-riding-boot-e0aec450be8e45ab888613b3a44d26a6) by inciprocal — CC Attribution
  - [Bucket Hat](https://sketchfab.com/3d-models/bucket-hat-38d07cea51d04e9fb419376d1fdaa77e) by Boxroom 3D — CC Attribution
  - [Baseball Cap](https://sketchfab.com/3d-models/baseball-cap-1c1d34d73fd94e6b9e8f82b1eb7194a0) by Scott VanArsdale — CC Attribution
  - [Worn leather handbag](https://sketchfab.com/3d-models/worn-leather-handbag-0732e0dfee7747e49cef95f3d179d880) by Lassi Kaukonen — CC Attribution
- Avatars (MODE fitting room and the Blender garment tests): Blender Studio [Human Base Meshes](https://www.blender.org/download/demo-files/) (CC0), exported by `blender/export_avatars.py`.
- 3D t-shirt model: [jericNuez/shirt-designer](https://github.com/jericNuez/shirt-designer) (MIT).
- People: [Quaternius](https://quaternius.com) characters via poly.pizza (CC0).
- Textures, fabric scans, the studio and city-square HDRIs: [Poly Haven](https://polyhaven.com) (CC0).
- 3D engine: [three.js](https://threejs.org) (MIT).
- **Note:** the try-on models used through Hugging Face (FitDiT, IDM-VTON) are licensed for **non-commercial use**.
  Commercial use would need a commercial try-on API.
