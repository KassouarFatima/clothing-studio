# Testing the app — step by step (from a cold start)

## 0. Run the app

Open PowerShell in the project folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-all.ps1
```

It starts (and verifies) all three services:

| port | service |
|------|---------|
| **8792** | the street world + Atelier shop (Yanis, Rin) |
| **8080** | studio backend (AI chat, images, hand-off between the sites) |
| **5173** | the "Let'sDo it." design studio (Vite) |

Expected: three lines `port 8792: OK … 8080: OK … 5173: OK` and
`Ready. Open http://localhost:8792/`.
Crash reasons land in `atelier\server.log`, `customizer\serveur\server.log`, `customizer\vite.log`.

---

## 1. The street world

1. Open **http://localhost:8792/** in Chrome → **Ctrl+F5** once.
2. Expected: "Loading the street…" → the 3D street appears in a few seconds (three.js is local, no CDN).
3. Controls: **W A S D** walk, **Shift** faster, **mouse** look, **E** interact, **M** sound, **Esc** pause.
4. Walk to the ATELIER counter → prompt **"Press E to talk to Yanis"** → press **E**.
5. Expected: the shop panel opens — Yanis chat on the left, 3D stage + garment picker on the right.

## 2. Yanis: AI design + price in dollars

1. Pick a garment under the 3D view (T-shirt, hoodie…).
2. Type a design idea (`a golden falcon on black`) → **Send**.
3. Expected: "Yanis is typing…" → reply → stage shows "Designing…" → the design appears on the garment (drag to turn it).
4. These buttons enable: **Try it on (realistic photo)**, **Download for printing**, **New version**, **🏬 Put it in the store**.
   (For a new garment type a small dialog asks: **Publish to the catalogue / Keep it just for me / Discard**.)
5. Ask `how much?` → Expected price in **dollars**, e.g.
   *"My price for it: $24.90 — that's $19.90 for the T-shirt and $5.00 for the print"*
   — never DH / درهم.
6. Language: answer in French → he answers French; answer in Darija/Arabic → he answers **Arabic, right-to-left**.
   (Open `http://localhost:8792/index.html?lang=ar` to force Arabic.)

## 3. The full loop: street → studio → back with the price

1. In Yanis's panel click **✨ Let'sDo it.** → a new tab opens the studio (port 5173).
2. Studio intro: **"Let'sDo it."** → click **Customize it**.
3. Make something: pick a garment, change colours, add text, (AI image tab uses the backend on 8080).
4. Click **🎁 Give to customer** (top toolbar).
   - Expected: the studio tab closes itself (or redirects to the street), and the design is sent through the local backend.
5. Back on the street tab: within ~0–5 s the panel **reopens automatically in front of Yanis**
   (`index.html?design=…&price=1`) and Yanis **greets you with the price** in your language ($).
6. Also: the design **hangs in the shop window** (newest in front). Walk to it →
   **"Press E to try «…» by …"** works.

## 4. Rin the stylist (MODE shop)

1. Walk to MODE → **"Press E to talk to Rin, the stylist"** → **E**.
2. Expected greeting ends with: *"Want a print or artwork on a piece? Click ✨ Let'sDo it. below — it opens
   the design studio (the other site), and you come back to me with it."*
3. Her **✨ Let'sDo it.** button (first button under the 3D view) opens port 5173 in a new tab.
4. Chat: describe a style → she lists the pieces and dresses the 3D mannequin.
5. Ask about a custom print in Darija: `حاب نحط لوغو تاعي على تيشيرت` →
   she answers in Algerian Darija (Arabic script) and mentions **✨ Let'sDo it.** (English works too).
6. **Your body & fit** panel: pick Woman/Man + height/chest/waist/hips → tick **Show my avatar**.
   Expected (the avatar fixes): a **painted face** (eyes, brows, lips — no blank doll),
   **no clothes poking through the skin**, smooth shoulders/arms.
7. Click **Save** → toast *"Saved! Your look is now on a mannequin in the MODE window."*
   → **← Back to the street** → the mannequin outside MODE wears it → **"Press E to see this look: …"**.
8. Optional: **✂️ How to make it (tailor sheet)** → panel + PDF download.

## 5. The studio design assistant

1. In the studio, click the floating assistant button (bottom, aria-label "Open the design assistant").
2. Expected welcome: *"Salam! 👋 I'm your design assistant. Ask me anything in Darija, العربية, English or Français…"*.
3. Ask in any of the four → it answers in the same language; a brief marked `#design:`
   opens the AI tab pre-filled.
4. If the backend were down you would see *"Could not reach the assistant server…"* —
   with 8080 running you get real answers (`"source":"ai"`).

## 6. Wear it (live camera)

1. Studio intro → **Wear it** (or the **Wear it** button in the editor toolbar).
2. Browser asks for the camera → **Allow**.
   - Expected: live video + the garment following your body, status **"Following your movement"**.
   - If the camera is busy: it **retries by itself** — *"The camera is busy — trying again (1/3)…"* (3 tries).
   - If it still fails, the message states the exact cause + a **Try again** button
     (permission → click the camera/padlock icon in the address bar → Always allow).
3. Test the controls: **Size**, **Position**, **Mirror** sliders; switch garments in the selector.
4. Tip: close other apps/tabs that use the camera (Zoom, Firefox…) before testing.

## 7. Developer gates (after any code change)

```powershell
npm test                     # root: 95/95 must pass (54 frontend + 41 backend)
cd customizer; npx eslint src --ext .js,.jsx   # must stay at 106 errors (baseline)
```
