// Design assistant chat: answers in Darija, Modern Standard Arabic, English or
// French and can hand a concrete pattern description back to the designer.
//
// The primary provider is the free, keyless Pollinations text API. When it is
// unreachable, slow or rate limited, the same request is answered locally so
// the assistant keeps working without any credentials.

export class ChatError extends Error {
    constructor(message, status = 502) {
        super(message);
        this.status = status;
    }
}

export const MAX_MESSAGES = 14;
export const MAX_CONTENT = 1200;
export const DEFAULT_ENDPOINT = 'https://text.pollinations.ai/openai';

export const SYSTEM_PROMPT = [
    'You are the design assistant inside a 3D shirt customizing app.',
    'Help the user describe a full-shirt AI pattern: colors, motifs, style (sport, minimal, botanical, abstract).',
    'Language rules, strictly:',
    '- Always answer in the SAME language as the user last wrote.',
    '- If they write in Darija (Arabic script OR Latin letters like "kifach", "bghit", "rani", "habet"), answer in Darija.',
    '- The customers are Algerian: answer in ALGERIAN Darija (حاب، راني، لازمني، تاع، وين، شنيّة / "habet", "rani", "melih") — never Moroccan wording (بغيت، ديال، مزيان).',
    '- If they write formal Modern Standard Arabic (فصحى), answer in Modern Standard Arabic.',
    '- English in, English out. French in, French out.',
    'Style rules, strictly:',
    '- Short answers: 1 to 4 sentences. Plain text only, no markdown, no lists, no emoji walls.',
    '- If the user asks for a concrete design, end your reply with ONE line in exactly this format:',
    '#design: <one short English sentence describing the textile pattern>',
    '- The #design line must be plain English because the image model only understands English.',
    '- Never put anything else on the #design line, and never add a second one.',
].join('\n');

const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
// Greeting words count as Darija too: "salam" / "marhaba" alone must get the
// Darija greeting, not the English one.
// Maghrebi Darija wording in Arabic script — Moroccan (بغيت، ديال، مزيان) and
// Algerian (حاب، راني، لازمني، تاع، وين، شنيّة): these win over formal Arabic, so a
// mixed message stays Darija — exactly what real customers expect.
const DARIJA_ARABIC = /بغيتي?|بغا|عاوني|عاونيني|صاوب|كيفاش|واش|وش|ندير|نساوي|ديال|نتاع|تاع|هاد|هاذ|هكّ?ا|زوين|زوينة?|مزيان|مليح|صافي|يلاه|يالله|يهلا|علاش|شنو|شنيّ?ة|خاصني|لازم|لازمني|عندي|بزاف|بزّاف|حبيبتي|حاب|حابة|نبي|نحب|راني|راهي|تاني|مشي|زاد|بصح|راه|كاش|شحال|قدّ?اش|وين|منين|برك|باش|عيط/;
// Clear Modern Standard Arabic (فصحى) markers: Arabic script, none of the Darija
// words above, and one of these means the customer writes formal Arabic.
const MSA_ARABIC = /من فضلك|أرجوك|ارجو|شكرا|أريد|اريد|أريده|أفضل|افضل|لماذا|كيف يمكن|ما هي|ما هو|أين|اين|متى|أحسنت|احسنت|فستان|قميصا|ثوب|التصميم/;
const DARIJA_LATIN = /\b(?:kifach|kifah|kifa7|wach|waach|wa3sh|bghit|bghi|bghina|tbddl|tbdl|yakhdem|yakhdemch|mezian|mzyan|meziana|zwin|zwina|shwiya|chwia|shwiya|safi|yallah|3andi|3lik|3lach|hadchi|hada|hadi|se7a|yse7ek|khalas|bzzaf|nsawer|fashal|habet|habetek|habti|rani|rahi|lazemni|lazem|melih|mlih|quddesh|quddash|qdash|kdesh|tani|nta3|z3ma|kima|hakka|haka|chhal|ch7al|shniya|sheniya|bsa7|bse7|mnin|aya|salam(?:alaikum|ualaikum|oalaikum)?|slm|marhaba|ahlan|wsalam)\b/i;
// High-precision French markers only: shared words like "design" or "style"
// belong to English too, so they cannot decide the language.
const FRENCH = /\b(?:bonjour|bonsoir|salut|comment|pourquoi|merci|couleur|couleurs|voudrais|veux|dessine|plait|plaît|très)\b/i;

/** 'msa' (Modern Standard Arabic), 'ar' (Darija in Arabic script), 'darija' (Latin letters), 'fr' or 'en'. */
export function detectLanguage(text) {
    const value = String(text || '');
    if (ARABIC_SCRIPT.test(value)) {
        if (MSA_ARABIC.test(value) && !DARIJA_ARABIC.test(value)) return 'msa';
        return 'ar';
    }
    if (DARIJA_LATIN.test(value)) return 'darija';
    if (FRENCH.test(value)) return 'fr';
    return 'en';
}

/** Validates the chat history shared by the route, provider and tests. */
export function normalizeMessages(raw) {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new ChatError('Send at least one message.', 400);
    }
    if (raw.length > MAX_MESSAGES) {
        throw new ChatError(`Send at most ${MAX_MESSAGES} messages at a time.`, 400);
    }
    const messages = raw.map((entry) => {
        if (!entry || (entry.role !== 'user' && entry.role !== 'assistant')) {
            throw new ChatError('Each message needs a role of user or assistant.', 400);
        }
        if (typeof entry.content !== 'string' || !entry.content.trim()) {
            throw new ChatError('Each message needs nonempty text.', 400);
        }
        if (entry.content.length > MAX_CONTENT) {
            throw new ChatError(`Messages are limited to ${MAX_CONTENT} characters.`, 400);
        }
        return { role: entry.role, content: entry.content.trim() };
    });
    if (messages[messages.length - 1].role !== 'user') {
        throw new ChatError('The last message must be yours.', 400);
    }
    return messages;
}

const DESIGN_HINT = /\b(?:design|pattern|print|draw|drawing|shirt|t-?shirt|tee|couleur|color|couleurs|colors|style|styles|stylish|nsawer)\b|(?:تصميم|تيشيرت|تيشورت|قميص|قميجة|قميجات|لوغو|لوگو|لون|ألوان|الوان|باترن|رسم|رسمة|طبع)/i;
const GREETING = /^(?:salam(?:\s+alaikum)?|slm|salut|hello|hi|hey|bonjour|bonsoir|marhaba|ahlan|evening|morning)\b|^[\u0600-\u06FF\s]{0,12}(?:سلام|مرحبا|أهلا|هلا|صباح|مساء)/i;

const LOCAL_REPLIES = {
    en: {
        greeting: "Hi! I'm the design assistant. Tell me what you want on your shirt — colors, style, a motif — and I'll turn it into a pattern you can generate.",
        design: 'Great idea — I turned your description into a design brief. Press "Use this design" to send it to the AI designer:',
        fallback: 'I can help you pick colors, motifs and a full-shirt pattern. Describe what you want on your shirt, in Darija, English or French.',
    },
    darija: {
        greeting: "Salam! Ana m3awen f had l'app. Goul lia wach hab n-dir f t-shirt: l'couleurs, l'style wla chi motif, w n-saweb lik pattern.",
        design: 'Mlih! Hawa brief ta3 design kharej men chi tirahatk. Push 3la "Use this design" bach yemchi l AI designer:',
        fallback: "Nqdar n3awnek f l'couleurs, f l'motifs w f pattern kamla ta3 t-shirt. Sowel b darija (Arabic), English wla Français.",
    },
    ar: {
        greeting: 'سلام! أنا مساعد التصميم فهاد التطبيق. قول ليا شنيّة حاب ف التيشيرت: الألوان، الطراز ولا شي تصميم، ونصاوب ليك الباترن.',
        design: 'مليح! ها هو بريف التصميم خرج من شي اقتراح تاعك. دير كليك على "Use this design" باش يمشي للمصمم تاع AI:',
        fallback: 'نقدر نعاونك مع الألوان، والموتيفات، والباترن كامل تاع التيشيرت. اكتب بالدارجة (بالعربية)، الإنجليزية ولا الفرنسية.',
    },
    msa: {
        greeting: 'مرحباً! أنا مساعد التصميم داخل هذا التطبيق. أخبرني بما تريد على قميصك: الألوان، الطراز أو التصميم، وأُعدّ لك نموذجاً جاهزاً.',
        design: 'ممتاز! هذا نموذج التصميم الذي أعددته من طلبك. اضغط على "Use this design" لإرساله إلى المصمم الذكي:',
        fallback: 'أستطيع مساعدتك في اختيار الألوان والموتيفات وتصميم القميص كاملاً. اكتب بالعربية أو الإنجليزية أو الفرنسية.',
    },
    fr: {
        greeting: "Bonjour ! Je suis l'assistant design de l'application. Dis-moi ce que tu veux sur ton t-shirt : couleurs, style ou motif, et je prépare un pattern pour toi.",
        design: "Très bien ! Voici le brief de design tiré de ta demande. Clique sur \"Use this design\" pour l'envoyer au designer AI :",
        fallback: "Je peux t'aider avec les couleurs, les motifs et le pattern complet du t-shirt. Écris en français, en darija ou en anglais.",
    },
};

/**
 * Local reply used when the AI provider cannot answer. It detects Darija
 * (Arabic script or Latin letters) and English, and hands back a #design
 * description when the user is asking for one.
 */
export function fallbackReply(text) {
    const language = detectLanguage(text);
    const bundle = LOCAL_REPLIES[language];
    const trimmed = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (GREETING.test(trimmed)) return { reply: bundle.greeting, source: 'local' };
    if (DESIGN_HINT.test(trimmed)) return { reply: `${bundle.design}\n#design: ${trimmed}`, source: 'local' };
    return { reply: bundle.fallback, source: 'local' };
}

// A corrupted upstream reply (invalid UTF-8 decoded as U+FFFD, or a run of
// question marks standing in for lost words) is unusable, so it counts as a
// provider failure: the caller answers with the local assistant instead,
// whose replies are generated in-process and always clean.
const GARBLED_REPLY = /[\uFFFD]|\?{2,}/;

/**
 * Asks the AI provider for a reply. Throws ChatError when the provider fails;
 * callers that want availability over freshness use respondToChat instead.
 */
export async function askChat(messages, {
    fetchImpl = fetch,
    endpoint = process.env.CHAT_PROVIDER_URL || DEFAULT_ENDPOINT,
    signal,
    timeoutMs = 20_000,
} = {}) {
    const deadline = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let response;
    try {
        response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                model: 'openai',
                messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
            }),
            signal: requestSignal,
        });
    } catch (error) {
        if (signal?.aborted) throw new ChatError('The chat request was cancelled.', 499);
        throw new ChatError('The chat provider could not be reached.', 504);
    }
    if (!response?.ok) throw new ChatError(`The chat provider responded with ${response.status}.`, 502);
    const data = await response.json().catch(() => null);
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) {
        throw new ChatError('The chat provider returned an empty reply.', 502);
    }
    if (GARBLED_REPLY.test(reply)) {
        throw new ChatError('The chat provider returned garbled text.', 502);
    }
    return { reply: reply.trim(), source: 'ai' };
}

/** Answers with the AI provider, falling back to the local assistant. */
export async function respondToChat(messages, options = {}) {
    try {
        return await askChat(messages, options);
    } catch (error) {
        if (error instanceof ChatError && error.status === 499) throw error;
        return fallbackReply(messages[messages.length - 1].content);
    }
}
