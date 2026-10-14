# Clothing Studio

Combined site: the **3D Garment Customizer** shop front + the **Atelier** AI
tailor studio in one folder.

```
clothing-studio/
  start.mjs        one-command launcher (starts everything)
  customizer/      shop front — garment lineup, Wear it, chat   (port 5173 + API 8080)
  atelier/         AI tailor studio — designs, try-on, print    (port 8792)
```

## How the two sites connect

1. The launcher opens the **virtual world** (Atelier, port 8792) — the walkable
   street and the boutique, with Yanis the AI tailor.
2. In the **buyer part** under the product, click **✨ Let'sDo it.** — the 3D
   garment studio (the customizer, port 5173) opens in a new tab.
3. Design the garment there as usual, then click **🎁 Give to customer** —
   the studio tab closes, you land back in the virtual world, and the finished
   design **saves on both sides**: it lands in the studio's History, and the
   Atelier saves it as a real design **published to the store, so it hangs in
   the shop window** (the newest customer design takes the front window —
   walk up to the boutique and see it on a hanger).
   The image travels through `POST/GET/DELETE /api/v1/handoff` on the local
   API (the two sites are different ports, so browser storage is not shared),
   and the local API **pushes it into Atelier server-to-server**
   (`POST /api/design/manual` + `POST /api/publish`) the moment it arrives —
   saved and on display no matter which browser tabs are open. The world page
   watches the store and re-hangs the display with a toast when something new
   appears (the handoff slot stays as a fallback if that push fails).

## Run it

Requirements: Node.js 22+ (Atelier: 20+), one terminal is enough.

```cmd
npm start
```

The launcher starts all three processes and opens http://localhost:8792
(the virtual world) in your browser. Press Ctrl+C to stop everything.

Start pieces individually if you prefer:

```cmd
npm run shop       :: shop front  (customizer folder, port 5173)
npm run api        :: chat + image API (customizer/serveur, port 8080)
npm run atelier    :: Atelier studio (atelier folder, port 8792)
```

## First run

Dependencies are already installed. After re-copying the folder, run:

```cmd
cd customizer && npm install
cd ..\atelier && npm install
```

Optional keys live in `atelier/.env` (copied from `.env.example`) and
`customizer/serveur/.env`. Everything works without them; AI features
(Groq/Gemini/HF) light up when you add your own free keys.

## API keys — where to change them, and where to get them

All keys are plain local text lines: `NAME=value` — no quotes, no spaces, no page
URLs, and nothing after the value. Save the file, run `node check-keys.mjs`
(it must print **VALID**), then restart the services — the files are only read
at startup (`powershell -ExecutionPolicy Bypass -File .\start-all.ps1`, or
double-click **clothing-studio services** on the Desktop).

| file | read by | keys |
|---|---|---|
| `atelier\.env` | the street world, Yanis & Rin chat, designs (port 8792) | `GROQ_API_KEY`, `GEMINI_API_KEY`, `HF_TOKEN`, `LANGSMITH_*` (optional) |
| `customizer\serveur\.env` | the studio backend / its AI image tab (port 8080) | `GEMINI_API_KEY` |

**To change a key:** open the file in Notepad → replace everything **after** the `=`
(keep the `NAME=` part) → save → `node check-keys.mjs` → restart.

### Where to get every key (all free, ~1 minute each)

| key | lights up | site → button | a real key looks like |
|---|---|---|---|
| `GEMINI_API_KEY` | **Yanis/Rin chat** (main brain) + studio images | **https://aistudio.google.com/apikey** → *Create API key* — or, equivalently, https://console.cloud.google.com/apis/credentials (enable *Generative Language API* first) | `AIza…` (39 characters) |
| `GROQ_API_KEY` | faster chat, tried before Gemini | **https://console.groq.com/keys** → *Create API Key* | `gsk_` + ~56 letters/digits |
| `HF_TOKEN` | AI design art (FLUX) + realistic try-on | **https://huggingface.co/settings/tokens** → *New token* → role **read** | `hf_` + ~34 characters |
| `LANGSMITH_API_KEY` (optional — or just delete the 3 `LANGSMITH_` lines) | request tracing dashboard | https://smith.langchain.com/settings → *API Keys* | `ls_…` / UUID-style token |

**What never works:** pasting the **page URL** after `=` (e.g. `https://console.groq.com/keys`),
leaving the token's **name/description attached** (`hf_xxx — My token`), quotes around the
value, or putting keys into Windows *environment variables* instead of these two files.

`node check-keys.mjs` is the source of truth: it prints **VALID / REJECTED / BAD** with the
exact mistake for each line — without ever printing your secrets.

## Test scenarios (scripted chats — both shops, as text)

Run the app first (`npm start`, or `powershell -ExecutionPolicy Bypass -File .\start-all.ps1`).
The scripted replies need working AI keys — check them with `node check-keys.mjs` (must print 3× VALID).

### Scenario 1 — English

1. Open **http://localhost:8792/** → walk (**W A S D**) to the **ATELIER** counter → **E**.
2. In Yanis's chat, type:
   `Hi! Design me a golden tiger on a black t-shirt.`
   **Expect:** an English reply, "Designing…" under the 3D view, then the tiger on the shirt (drag to turn).
   More designs to try in the same chat (one after another):
   - `a golden falcon on a black t-shirt`
   - `a blue hoodie with snow mountains and the word FREE`
   - `a white t-shirt with a cute cat and the name MILO`
   - `a neon tiger head, green and purple colours`

   **Expect:** each design appears on the garment it names (Yanis switches t-shirt ↔ hoodie for you; the neon-tiger one, which names no garment, prints on the one you already have), and the price stays **garment + $5 print**: t-shirt `$24.90`, hoodie `$49.90`.
3. Type:
   `How much is it?`
   **Expect** the price in dollars, e.g. `My price for it: $24.90 — that's $19.90 for the T-shirt and $5.00 for the print` (never DH).
4. Click **✨ Let'sDo it.** → the studio (port 5173) opens → make anything → click **🎁 Give to customer**.
   **Expect:** you land back in the street, the panel reopens with Yanis **greeting you with the price in English**, and the design **hangs in the shop window** (walk up: "Press E to try…").
5. Walk to **MODE** → **E** in front of Rin.
6. Type:
   `Can I put my own logo on a t-shirt?`
   **Expect** her to point at the studio: `Just click on ✨ Let'sDo it. to open our design studio…`
7. Type:
   `Build me a clean minimal summer look.`
   **Expect** a named list of pieces and the 3D mannequin dressing up.
8. Enter your measurements and tick **Show my avatar** → **Expect** a face (eyes, brows, lips) and **no clothes poking through the skin**. Click **Save** → the look appears on a mannequin outside the MODE window ("Press E to see this look: …").
9. Open the studio (port 5173) again and click **Wear it** → **Select an image** and pick a photo of yourself (a standing photo, whole body or upper body).
   **Expect:** the garment is placed on the person in the photo in a few seconds, the status reads `Fit ready — adjust Size and Position`, and the panel on the right shows **`Your size:`** a letter (XS…XXXL) with the measurements in centimetres under it.
   - Switch **T-shirt / Dress / Hoodie / Suit / Jacket** → the size follows the **chest**; switch **Pants** → it follows the **waist**; **Cap / Backpack** say **`One size`** (no body size for those).
   - A photo with no person, or only a face, is refused with a clear message — nothing is uploaded, the measuring happens on your device.

### Scenario 2 — العربية (بالدارجة)

1. افتح **http://localhost:8792/** → امشِ (**W A S D**) إلى محل **ATELIER** → **E**.
2. اكتب في المحادثة مع يانيس:
   `سلام! حاب تصميم نمر ذهبي على تيشيرت كحل`
   **المتوقع:** يجاوبك بالدارجة الجزائرية (بالعربية) والتصميم يظهر على التيشيرت تحت النظرة ثلاثية الأبعاد.
   و هادو شوية تصاميم زايدة تقدر تجرّبهم (بالإنجليزية مقبولة):
   - `a golden falcon on a black t-shirt`
   - `a blue hoodie with snow mountains and the word FREE`
   - `a white t-shirt with a cute cat and the name MILO`
   - `a neon tiger head, green and purple colours`

   **المتوقع:** كل تصميم يتطبع على القطعة اللي سمّاها (يانيس يبدّل تيشيرت ↔ هودي، واللي ما سمّاش قطعة — مثل النيون — يبقى على القطعة اللي عندك دروك)، والتمن = تمن القطعة + $5 للطبعة: تيشيرت `$24.90`، هودي `$49.90`.
3. اكتب:
   `قداش التمن تاعو؟`
   **المتوقع:** التمن بالدولار بالعربية، مثلاً: `التمن تاعي: $24.90 — يعني $19.90 تاع T-shirt و $5.00 للطبعة` (ماشي درهم).
4. دوس **✨ Let'sDo it.** → يتحل الاستوديو (بورت 5173) → صمّم حاجة → دوس **🎁 Give to customer**.
   **المتوقع:** ترجع للشارع، يتحل المحل ويانيس **يعطيك التمن بالعربية** (من اليمين إلى اليسار)، والتصميم **يتعلق في واجهة المحل**.
5. مشِ إلى **MODE** → **E** قدام رين.
6. اكتب:
   `حاب نحط لوغو تاعي على تيشيرت، شنو ندير؟`
   **المتوقع:** تجاوبك بالدارجة الجزائرية وتقول لك دوس على **✨ Let'sDo it.** (مثلاً: `إلا حاب تحط لوگو تاعك… دير كليك غير على ✨ Let'sDo it.`).
7. اكتب:
   `صاوب لوك صيفي مينيمال`
   **المتوقع:** تعطيك قائمة بالقطع (قميجة، سروال…) والمانكان يلبسها في النظرة ثلاثية الأبعاد.
8. دوس **Show my avatar** بعد ما تدخل قياساتك → **المتوقع:** وجه فيه عينين وحواجب وشفاه، والملابس **ما يدخلوش في الجلد**. دوس **Save** → اللوك يتحط على مانيكان قدام محل MODE.
9. حل الاستوديو (بورت 5173) من جديد ودوس **Wear it** → **Select an image** وختار صورة ليك (صورة واقف، الجسم كامل أو الفوقاني).
   **المتوقع:** اللبسة تتلبس على الشخص فالصورة في ثواني، والstatus يكتب `Fit ready — adjust Size and Position`، ويمين تلقى **`Your size:`** حرف (XS…XXXL) وفي تحتو القياسات بالسنتيمتر.
   - بدّل **T-shirt / Dress / Hoodie / Suit / Jacket** → التمن بالقياس يتبع **الصدر (chest)**؛ **Pants** → يتبع **الخصر (waist)**؛ **Cap / Backpack** يقولو **`One size`** (ما فيهش قياس جسم ليهم).
   - صورة بلا شخص، ولا غير الوجه، تترفض برسالة واضحة — والقياس كولو يدير في الجهاز ديالك، ما ترفع والو.

## Tests

```cmd
cd customizer
npm run test:tryon          :: 43 frontend tests
cd serveur && npm test      :: 41 backend tests
npx eslint src --ext .js,.jsx
```
