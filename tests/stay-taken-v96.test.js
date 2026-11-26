// (v96 integration) Live E: when STAY happens (the countdown ran out, or he tapped it) the button pops for about 0.3 s
// by classes alone (transform and opacity), then goes; the next decision point clears it at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('STAY taken: set by endE for the default and his tap, cleared after 0.35 s or as a point opens, drawn by transform and opacity only', () => {
  const fast = read('js/fast/fast.js'), css = read('css/app.css');
  assert.match(fast, /if \(how === 'default' \|\| how === 'stay'\) \{ E\.tk = !E\.tk; cls\(this\.dom\.stay, 'taken', E\.tk\); cls\(this\.dom\.stay, 'taken2', !E\.tk\); E\.takenAt = this\.real; \}/);
  assert.match(fast, /\n {4}if \(this\.V\.crawl && this\.E\.takenAt != null && \(this\.dec\.on \|\| this\.real - this\.E\.takenAt > \.35\)\)/);
  const block = css.slice(css.indexOf('INT (v96): Live E, STAY taken'));
  for (const k of ['fStayTaken', 'fStayTaken2']) { const kf = block.match(new RegExp(`@keyframes ${k}\\{(.*?)\\}\\}`))[1]; assert.doesNotMatch(kf.replace(/transform|opacity/g, ''), /[a-z-]+:/, k + ': transform and opacity only'); }
  assert.match(block, /#fastHud #fStay\.taken,#fastHud #fStay\.taken2\{opacity:1;animation:fStayTaken \.32s/);
});
