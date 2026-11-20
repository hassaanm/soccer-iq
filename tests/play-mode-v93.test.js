// (v93, the owner) A lesson that does not exist in a mode is not offered in it: with Live on, PLAY starts a Live match
// (as Match does) and the lesson chip is hidden; with Classic (or nothing chosen) PLAY starts the lesson as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { playGoes } from '../js/ui/mode.js';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('PLAY: Live starts a match, Classic (or unset) a lesson', () => {
  assert.equal(playGoes({ mode: 'fast' }), 'match');
  for (const s of [{ mode: 'slow' }, {}, null, { mode: 'x' }]) assert.equal(playGoes(s), 'lesson');
});
test('PLAY goes where playGoes says, through the same flow as Match; the chip hides in Live at once', () => {
  assert.match(read('js/main.js'), /\$\('#playBtn'\)\.onclick = \(\) => \(playGoes\(P\.settings\) === 'match' \? gated\(runFreePlay\) : runSession\(\)\)/);
  assert.match(read('js/main.js'), /\$\('#freeBtn'\)\.onclick = \(\) => gated\(runFreePlay\)/, 'Match: the same flow');
  assert.match(read('js/ui/home.js'), /\$\('#home'\)\.classList\.toggle\('live', live\)/, 'renderMode (run on every toggle tap) marks the home screen');
  assert.match(read('css/app.css'), /#home\.live #lessonBtn\{display:none\}/);
});
