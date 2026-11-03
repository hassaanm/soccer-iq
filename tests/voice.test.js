// The recorded voice must cover every line the game says; if this fails, run `npm run voice` to record new clips.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pieces, clipKey, NAMES } from '../js/voice.js';
import { spokenLines, clean } from './spoken.js';
import { makeGame, drive } from './harness.js';
import { PATH } from '../js/skills.js';

const index = JSON.parse(readFileSync('audio/voice/index.json', 'utf8')).clips;
const missing = line => pieces(clean(line)).map(clipKey).filter(k => !index[k] || !existsSync('audio/voice/' + index[k]));

test('every name and listed line has a recorded clip', () => {
  for (const n of NAMES) assert.deepEqual(missing(n), [], n);
  for (const l of spokenLines()) assert.deepEqual(missing(l), [], l);
});

test('everything said in demos and lessons has a recorded clip', async () => {
  const said = [];
  for (const sk of PATH) {
    const { g } = makeGame(); g.say = t => said.push(t);
    await drive(g, g.demo(sk.id), { maxSec: 60 });
  }
  const { g } = makeGame(); g.say = t => said.push(t);
  const { generate } = await import('../js/generate.js');
  for (const sk of PATH) for (let seed = 1; seed < 6; seed++) {
    const sc = generate(sk.id, seed), opts = sc.kind === 'defense' ? sc.spots.map(s => 'spot:' + s.id) : ['pass:0', 'pass:1', 'drib:back', 'drib:fwd'];
    let n = 0; await drive(g, g.round(sc, { hint: false }), { maxSec: 120, pick: gm => (n++ < 1 ? opts.find(o => gm.rating(o) !== 'best') : null) || gm.sc.best });
  }
  for (const t of said) assert.deepEqual(missing(t), [], t);
  assert.ok(said.length > 20);
});
