import express from 'express'
import { clearDesign, isValidDesign, readDesign, readOptions, saveDesign } from '../services/handoff.js'
import { pushDesignToAtelier } from '../services/atelierBridge.js'

const router = express.Router()

// The designs are base64 images, usually far bigger than the 16kb the rest of
// the API allows, so this router parses its own body (mounted before the
// global express.json in index.js). The bulk /push carries the whole history.
const json = express.json({ limit: '8mb' })
const jsonBulk = express.json({ limit: '64mb' })

// POST /api/v1/handoff — the customizer hands the finished design over.
router.post('/', json, (req, res) => {
    const allOver = !!req.body?.allOver // a full-texture design prints the whole artwork on the shirt
    if (!saveDesign(req.body?.design, { allOver })) {
        return res.status(400).json({ message: 'A data:image design of at most 6 MB is expected.' })
    }
    res.status(201).json({ ok: true })
    // Save and publish it in the Atelier right away (the world hangs it in
    // the shop window), then release the slot so nothing else can take it.
    // Best effort: if Atelier is not running the slot stays, and the world
    // page picks the design up itself when it comes back into focus.
    const design = req.body?.design
    pushDesignToAtelier(design, { allOver })
        .then(() => { if (readDesign() === design) clearDesign() }) // last write wins
        .catch(() => {})
})

// POST /api/v1/push — the studio hands its WHOLE design history over, so the
// customer sees every design they made on the boutique walls, not only the
// last one. One request; the Atelier publishes them oldest first (the newest
// takes the shop window) and skips what its key already knows, so pressing
// "Give to customer" twice never duplicates anything. Answered straight away:
// the customer never waits for the publishing.
router.post('/push', jsonBulk, (req, res) => {
    const items = Array.isArray(req.body?.designs) ? req.body.designs : null
    const valid = (items || []).filter((it) => it && isValidDesign(it.design)).slice(0, 25)
    if (!valid.length) {
        return res.status(400).json({ message: 'designs[] with data:image entries of at most 6 MB each is expected.' })
    }
    res.status(202).json({ ok: true, queued: valid.length })
    valid.reverse() // the history is newest-first; publish the oldest first so the newest ends in the window
    ;(async () => {
        for (const it of valid) {
            try {
                await pushDesignToAtelier(it.design, { title: it.title, author: it.author, key: it.key, allOver: !!it.allOver })
            } catch { /* the Atelier may be restarting; the next Finish retries the missing ones by key */ }
        }
    })()
})

// GET /api/v1/handoff — Atelier reads the waiting design (kept until it
// confirms with DELETE, so a failed page load does not lose the design).
router.get('/', (req, res) => {
    res.status(200).json({ design: readDesign(), ...(readOptions() || {}) })
})

// DELETE /api/v1/handoff — Atelier confirms the design was received.
router.delete('/', (req, res) => {
    clearDesign()
    res.status(200).json({ ok: true })
})

export default router
