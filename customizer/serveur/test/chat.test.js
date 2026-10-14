import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ChatError,
    MAX_CONTENT,
    MAX_MESSAGES,
    SYSTEM_PROMPT,
    detectLanguage,
    fallbackReply,
    normalizeMessages,
    respondToChat,
} from '../services/chat.js';

const okResponse = (content) => new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { headers: { 'content-type': 'application/json' } },
);

test('normalizeMessages trims and keeps valid roles', () => {
    const messages = normalizeMessages([
        { role: 'user', content: '  hello  ' },
        { role: 'assistant', content: ' hi ' },
        { role: 'user', content: 'a design please' },
    ]);
    assert.deepEqual(messages, [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'a design please' },
    ]);
});

test('normalizeMessages rejects malformed histories with 400', () => {
    const invalid = [
        undefined,
        null,
        {},
        [],
        'hello',
        [{ role: 'system', content: 'hi' }],
        [{ role: 'user' }],
        [{ role: 'user', content: '   ' }],
        [{ role: 'user', content: 42 }],
        [{ role: 'user', content: 'x'.repeat(MAX_CONTENT + 1) }],
        [{ role: 'assistant', content: 'you first' }],
        Array.from({ length: MAX_MESSAGES + 1 }, () => ({ role: 'user', content: 'hi' })),
    ];
    for (const messages of invalid) {
        assert.throws(() => normalizeMessages(messages), (error) => {
            assert.ok(error instanceof ChatError);
            assert.equal(error.status, 400);
            return true;
        }, JSON.stringify(messages)?.slice(0, 80));
    }
});

test('detectLanguage separates Darija script, Latin Darija and English', () => {
    assert.equal(detectLanguage('صباح الخير'), 'ar');
    assert.equal(detectLanguage('kifach n-dir design?'), 'darija');
    assert.equal(detectLanguage('bghit t-shirt zwina'), 'darija');
    assert.equal(detectLanguage('a sporty pattern please'), 'en');
    assert.equal(detectLanguage(''), 'en');
});

test('fallback replies greet in the language the user wrote', () => {
    const english = fallbackReply('hello there');
    assert.equal(english.source, 'local');
    assert.match(english.reply, /design assistant/i);

    const darijaLatin = fallbackReply('salam, kifach n-dir design?');
    assert.equal(darijaLatin.source, 'local');
    assert.match(darijaLatin.reply, /m3awen/);

    const darijaArabic = fallbackReply('سلام، كيفاش نصمم؟');
    assert.equal(darijaArabic.source, 'local');
    assert.match(darijaArabic.reply, /مساعد/);

    for (const reply of [english.reply, darijaLatin.reply, darijaArabic.reply]) {
        assert.doesNotMatch(reply, /#design:/, 'greetings must not produce a design brief');
    }
});

test('a bare Darija hello gets the Darija greeting back', () => {
    assert.equal(detectLanguage('salam'), 'darija');
    assert.equal(detectLanguage('salamualaikum'), 'darija');
    assert.equal(detectLanguage('marhaba!'), 'darija');
    for (const hello of ['salam', 'slm', 'marhaba', 'ahlan']) {
        const { reply, source } = fallbackReply(hello);
        assert.equal(source, 'local');
        assert.match(reply, /m3awen/, `expected a Darija greeting for: ${hello}`);
    }
    // English stays English.
    assert.equal(detectLanguage('hello'), 'en');
    assert.match(fallbackReply('hello').reply, /design assistant/i);
});

test('fallback turns a design request into a usable #design brief', () => {
    for (const message of ['design a navy shirt with gold waves', 'n-dir design bghit loun zwin', 'صمم ليا تيشيرت أزرق']) {
        const { reply, source } = fallbackReply(message);
        assert.equal(source, 'local');
        const match = reply.match(/^#design:\s*(.+)$/mi);
        assert.ok(match, `missing #design line for: ${message}`);
        assert.ok(match[1].trim().length > 0);
    }
});

test('fallback never returns an oversized reply', () => {
    const { reply } = fallbackReply(`design ${'shirt '.repeat(400)}`);
    assert.ok(reply.length < MAX_CONTENT + 200);
});

test('the system prompt asks for a reply in the language the user wrote', () => {
    assert.match(SYSTEM_PROMPT, /SAME language as the user last wrote/);
    assert.match(SYSTEM_PROMPT, /answer in Darija/);
    assert.match(SYSTEM_PROMPT, /French in, French out/);
});

test('French input is detected and answered by the French local bundle', () => {
    assert.equal(detectLanguage('salut, comment ca va?'), 'fr');
    assert.equal(detectLanguage('bonjour, je veux un design bleu'), 'fr');
    assert.equal(detectLanguage('merci beaucoup'), 'fr');
    // Shared words stay English and Darija still wins over French.
    assert.equal(detectLanguage('a sporty pattern please'), 'en');
    assert.equal(detectLanguage('bghit loun zwin'), 'darija');

    const greeting = fallbackReply('bonjour');
    assert.equal(greeting.source, 'local');
    assert.match(greeting.reply, /assistant/i);
    assert.doesNotMatch(greeting.reply, /#design:/, 'greetings must not produce a design brief');

    const design = fallbackReply('je veux un design avec des couleurs');
    assert.equal(design.source, 'local');
    assert.match(design.reply, /#design:/, 'a French design request still produces a brief');
});

test('a corrupted provider reply falls back to a clean local reply', async () => {
    // Invalid UTF-8 arrives as U+FFFD; lost words can arrive as '?' runs.
    const garbledReplies = ['?????? ??????!', 'Bonjour?! Comment \uFFFDa va?'];
    for (const content of garbledReplies) {
        const result = await respondToChat(
            [{ role: 'user', content: 'salam' }],
            { fetchImpl: async () => okResponse(content) },
        );
        assert.equal(result.source, 'local');
        assert.doesNotMatch(result.reply, /\uFFFD/, `replacement char leaked for: ${content}`);
        assert.doesNotMatch(result.reply, /\?{2,}/, `question-mark runs leaked for: ${content}`);
    }

    // An Arabic-script user still gets a readable Arabic greeting.
    const arabic = await respondToChat(
        [{ role: 'user', content: 'سلام' }],
        { fetchImpl: async () => okResponse('?????? ??????') },
    );
    assert.equal(arabic.source, 'local');
    assert.match(arabic.reply, /مساعد/);
    assert.doesNotMatch(arabic.reply, /\?{2,}/);
});

test('respondToChat uses the AI provider and its system prompt when available', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        return okResponse('Salam! Here is a pattern you will like.\n#design: navy textile with gold waves');
    };
    const messages = [{ role: 'user', content: 'kifach dirou design?' }];
    const result = await respondToChat(messages, { fetchImpl, endpoint: 'https://example.test/chat' });

    assert.equal(result.source, 'ai');
    assert.match(result.reply, /Salam!/);
    assert.match(result.reply, /#design:/, 'the marker line travels to the client, which splits it off');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example.test/chat');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[0].content, SYSTEM_PROMPT);
    assert.deepEqual(body.messages.slice(1), messages);
    assert.equal(calls[0].init.headers['content-type'], 'application/json');
});

test('respondToChat falls back locally when the provider fails', async () => {
    const failures = [
        async () => { throw new TypeError('network down'); },
        async () => new Response('nope', { status: 503 }),
        async () => okResponse(''),
        async () => new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } }),
    ];
    for (const fetchImpl of failures) {
        const result = await respondToChat([{ role: 'user', content: 'hello' }], { fetchImpl });
        assert.equal(result.source, 'local');
        assert.ok(result.reply.length > 0);
    }
});

test('respondToChat times out to the local assistant instead of hanging', async () => {
    const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
        // A ref'd timer keeps this test's event loop alive until the abort.
        const timer = setTimeout(() => resolve(okResponse('too late')), 2000);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
    const result = await respondToChat([{ role: 'user', content: 'design me something' }], { fetchImpl, timeoutMs: 30 });
    assert.equal(result.source, 'local');
    assert.match(result.reply, /#design:/);
});

test('a cancelled client request is reported as 499 and is not answered locally', async () => {
    const controller = new AbortController();
    const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(okResponse('late')), 2000);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
    const pending = respondToChat([{ role: 'user', content: 'hi' }], { fetchImpl, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error) => {
        assert.ok(error instanceof ChatError);
        assert.equal(error.status, 499);
        return true;
    });
});
