// The skill moves' pictures (v93, redrawn in the mini game tiles' style): plain shapes, no thin dashed lines, his blue
// legs and one bold white arrow in each, the defender a chunky figure in their shirt colour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sym = id => (html.match(new RegExp(`<symbol id="${id}"[^>]*>([\\s\\S]*?)</symbol>`)) || [])[1];
const MOVES = ['stepover', 'scissors', 'feint', 'fakeshot', 'double', 'croqueta', 'chop', 'roll', 'cruyff'];

test('nine move pictures: plain shapes, his legs, one bold white arrow, no dashes', () => {
  for (const k of MOVES) {
    const s = sym('mv-' + k); assert.ok(s, k);
    assert.doesNotMatch(s, /<use|filter|dasharray|<text|<image/, `${k}: plain shapes only`);
    assert.match(s, /#4f8dff/, `${k}: his blue legs`);
    assert.equal((s.match(/stroke="#fff" stroke-width="7"/g) || []).length, 1, `${k}: one bold arrow`);
  }
  assert.match(sym('mvDef'), /var\(--def/); assert.doesNotMatch(sym('mvDef') + sym('mvCrowd'), /<use/);
  assert.equal(sym('mvArrow').trim(), '', 'each move draws its own arrow');
});
