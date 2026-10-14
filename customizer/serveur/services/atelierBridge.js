// Push a finished design straight into the Atelier (the other site of
// clothing-studio) the moment the customer presses "Give to customer":
// saved as a real design and published to the store — the newest customer
// design takes the shop window — server to server, so no browser tab (a
// stale one with an old poller used to steal the handoff slot) can stop it.
// Zero budget: plain fetch to the local Atelier server, best effort — when
// it fails, the handoff slot stays and the world page picks it up itself.

const ATELIER = process.env.ATELIER_URL || 'http://localhost:8792'

async function post(url, body) {
    const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) throw new Error(`${url} answered ${r.status}`)
    return r.json()
}

// Returns the id of the design created in the Atelier (or of the design its
// key already stands for, so pushing the same history again never duplicates).
export async function pushDesignToAtelier(design, { title, author, key, allOver } = {}) {
    const created = await post(`${ATELIER}/api/studio/push`, {
        artwork: design,
        shirtColor: 'white',
        placement: 'front-center',
        summary: 'Finished in “Let’sDo it.”',
        allOver: !!allOver, // a full-texture design: the whole artwork prints on the shirt (front and back)
        key: typeof key === 'string' ? key.slice(0, 64) : null,
        title: title || 'From “Let’sDo it.”',
        author: author || 'You',
    })
    if (!created?.id) throw new Error('Atelier did not accept the design')
    return created.id
}

// The studio's AI tab falls back here when the free image sources are quota-blocked
// (Hugging Face GPU, Gemini image): the Atelier's vector artist uses the free text
// models (no GPU quota) and answers with a ready-to-use PNG data URL.
export async function generateArtViaAtelier(prompt, { background = '#f2eee6', signal, timeoutMs = 90_000 } = {}) {
    const r = await fetch(`${ATELIER}/api/art`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, background }),
        signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
    })
    if (!r.ok) throw new Error(`Atelier answered ${r.status}`)
    const data = await r.json()
    if (typeof data?.artwork !== 'string') throw new Error('Atelier returned no artwork')
    return data // { artwork: 'data:image/png;base64,...', engine }
}
