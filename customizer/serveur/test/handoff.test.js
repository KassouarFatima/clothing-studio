import assert from 'node:assert/strict';
import test from 'node:test';
import {
    MAX_DESIGN_CHARS,
    clearDesign,
    isValidDesign,
    readDesign,
    saveDesign,
} from '../services/handoff.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

test('a valid design is stored, read back and cleared', () => {
    clearDesign();
    assert.equal(saveDesign(PNG), true);
    assert.equal(readDesign(), PNG);
    clearDesign();
    assert.equal(readDesign(), null);
});

test('the last design saved wins (single slot)', () => {
    clearDesign();
    assert.equal(saveDesign(PNG), true);
    const second = 'data:image/webp;base64,UklGRg==';
    assert.equal(saveDesign(second), true);
    assert.equal(readDesign(), second);
    clearDesign();
});

test('malformed handoff payloads are rejected and the slot stays untouched', () => {
    clearDesign();
    const invalid = [
        undefined,
        null,
        42,
        {},
        [],
        'hello',
        'http://example.com/design.png',
        'data:text/html,<b>x</b>',
        'data:image/png;base64,' + 'a'.repeat(MAX_DESIGN_CHARS + 1),
    ];
    for (const design of invalid) {
        assert.equal(isValidDesign(design), false);
        assert.equal(saveDesign(design), false, String(design)?.slice(0, 40));
        assert.equal(readDesign(), null);
    }
});
