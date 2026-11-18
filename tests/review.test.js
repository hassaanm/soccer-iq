// The review page's burn list (dev/review-list.js): every entry is well formed, and every situation it starts can be
// made at each team size the page lets it run at. Also: the page loads three.js exactly as the game does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENTRIES, GROUPS } from '../dev/review-list.js';
import { ALL_LESSONS } from '../js/skills.js';
import { generate } from '../js/generate.js';
import { setSize, sizeOf, PITCH, SIZES } from '../js/geom.js';
import { CLOSE } from '../js/shot.js';

const KINDS = ['round', 'match', 'screen', 'results', 'keeper'];
const lesson = id => ALL_LESSONS.some(s => s.id === id);

test('every entry is well formed', () => {
  const ids = new Set();
  for (const e of ENTRIES) {
    assert.ok(/^[a-z0-9-]+$/.test(e.id) && !ids.has(e.id), `${e.id}: a unique id`); ids.add(e.id);
    assert.ok(GROUPS.includes(e.group), `${e.id}: a known group`);
    assert.ok(e.title && e.look, `${e.id}: a title and a line on what to look at`);
    assert.equal(KINDS.filter(k => e[k]).length, 1, `${e.id}: exactly one way to start`);
    for (const p of e.pick || []) assert.ok(['size', 'level', 'think', 'seed'].includes(p), `${e.id}: chooser ${p}`);
    if (e.size) assert.ok(SIZES[e.size] && !e.pick?.includes('size'), `${e.id}: a fixed size has no size chooser`);
    const spec = e.round || e.match?.first;
    if (spec) assert.ok(lesson(spec.lesson), `${e.id}: lesson ${spec.lesson}`);
    for (const id of e.match?.without || []) assert.ok(lesson(id), `${e.id}: lesson ${id}`);
  }
  assert.ok(GROUPS.every(g => ENTRIES.some(e => e.group === g)), 'every group has an entry');
});

// As the page finds a scene (dev/review.js scene): from the entry's seed on, the first that makes its pattern.
const fits = (sc, where) => { const d = Math.hypot(PITCH.L - sc.heroTo[0], PITCH.W / 2 - sc.heroTo[1]);
  return where === 'close' ? d <= CLOSE : where === 'far' ? d > CLOSE : where === 'midfield' ? Math.abs(sc.heroTo[0] - PITCH.L / 2) < 4 : true; };
test('every situation can be made at the sizes its entry runs at', () => {
  for (const e of ENTRIES) {
    const spec = e.round || e.match?.first; if (!spec) continue;
    const sizes = e.size ? [e.size] : e.pick?.includes('size') ? Object.keys(SIZES).filter(k => SIZES[k].offer) : ['3v3'];
    for (const size of sizes) {
      setSize(size);
      let found = null;
      for (let s = e.seed || 1; s < (e.seed || 1) + 80 && !found; s++) { const sc = generate(spec.lesson, s, { pattern: spec.pattern }); if (sc?.pattern === spec.pattern && fits(sc, spec.where)) found = sc; }
      assert.ok(found, `${e.id}: ${spec.lesson} / ${spec.pattern} at ${size}`);
      if (spec.pattern === 'aim-open' || e.id === 'keeper-guess') assert.ok(sizeOf().keeper && found.gk, `${e.id}: a keeper in goal`);
    }
  }
  setSize(process.env.SOCCER_SIZE || '3v3');
});

test('the review page loads three.js and the game as index.html does', () => {
  const page = readFileSync(new URL('../dev/review.html', import.meta.url), 'utf8'), index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const map = t => t.match(/<script type="importmap">([^<]*)<\/script>/)?.[1].trim();
  assert.equal(map(page), map(index), 'the same import map');
  assert.match(page, /<base href="\.\.\/">/, 'paths resolve from the project folder');
  assert.ok(!/href="dev\/review/.test(index), 'the game does not link the page');
});
