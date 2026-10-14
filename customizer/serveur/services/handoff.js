// One-slot handoff between the two sites of clothing-studio: the customizer
// ("Let'sDo it.") stores the finished design here when the customer presses
// "Give to customer", and Atelier picks it up when its tab comes back into
// focus. In memory, single slot, last write wins — local and zero budget.

export const MAX_DESIGN_CHARS = 6_000_000; // ~4.5 MB image as base64 text

export function isValidDesign(design) {
    return typeof design === 'string'
        && design.startsWith('data:image/')
        && design.length <= MAX_DESIGN_CHARS;
}

let slot = null;
let slotOpts = null; // small options travelling with the design ({ allOver }), not part of the image slot

export function saveDesign(design, opts) {
    if (!isValidDesign(design)) return false;
    slot = design;
    slotOpts = opts && typeof opts === 'object' ? opts : null;
    return true;
}

export function readDesign() {
    return slot;
}

export function readOptions() {
    return slotOpts;
}

export function clearDesign() {
    slot = null;
    slotOpts = null;
}
