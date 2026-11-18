// The shot as two choices, the keepers, and the lessons that come with them (v62), at every size.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setSize, SIZES, PITCH } from '../js/geom.js';
import { PATH, allScenarios } from '../js/skills.js';
import { generate } from '../js/generate.js';
import { resolve, spaces, CLOSE, FOOT, GK } from '../js/shot.js';
import { defaultProgress, catchUp, isOpen, nextSkill, graduated, finishSession, load, save } from '../js/progress.js';
import { optionsFor, playOption, judge, makeGame, drive } from './harness.js';

const SIZE_IDS = Object.keys(SIZES).filter(k => SIZES[k].offer), ids = () => PATH.map(s => s.id);
const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const reload = p => { const st = mem(); save(p, st); return catchUp(load(st), PATH); };
const at = id => PATH.findIndex(s => s.id === id);

test('the shot rule: close, the inside of the foot goes where it is aimed and low laces go in too; from the edge, the inside is slow', () => {
  setSize('5v5');
  const k = { x: PITCH.L - .7, y: 13 }, close = { x: PITCH.L - 6, y: 15 }, edge = { x: PITCH.L - 11, y: 13 };
  assert.equal(resolve(close, spaces()[1].y, 'in', k).res, 'save', 'at him: saved');
  assert.equal(resolve(close, spaces()[0].y, 'in', k).res, 'goal', 'the far space: in');
  assert.equal(resolve(close, spaces()[0].y, 'las', k).res, 'goal', 'low laces from close, away from him: in (v72; they used to fly over)');
  assert.equal(resolve(close, spaces()[1].y, 'las', k).res, 'save', 'low laces from close, at him: saved');
  assert.equal(resolve(edge, spaces()[0].y, 'las', k, { stray: .3 }).res, 'goal', 'laces from the edge: in');
  assert.equal(resolve(edge, spaces()[0].y, 'in', k).res, 'save', 'the inside from the edge: he gets across to it');
  assert.ok(FOOT.in.speed < FOOT.las.speed && CLOSE === 8 && GK.reach * 2 / (PITCH.gy1 - PITCH.gy0) > .3, 'he covers about a third of the goal');
  setSize('3v3');
});

for (const size of SIZE_IDS) test(`${size}: the shot lessons' scenes teach their part, and every shot ends as the scene says`, async () => {
  setSize(size);
  assert.equal(ids().includes('shoot-space'), size === '5v5', 'Shoot to the space! is only on the 5v5 path');
  assert.equal(ids()[at('shoot-close') + 1], 'inside-laces');
  for (const sk of size === '5v5' ? ['inside-laces', 'shoot-space'] : ['inside-laces']) {
    const scs = allScenarios(sk); assert.ok(scs.length >= 8, sk);
    for (const sc of scs.slice(0, 4)) {
      assert.ok(sc.best && sc.cue, sc.id);
      if (sc.pattern === 'foot-close') { assert.equal(sc.best, 'shoot:*:in', sc.id); assert.equal(sc.shots['shoot:*:las'], 'goal', `${sc.id}: low laces from close go in`); assert.ok(sc.safe.includes('shoot:*:las'), `${sc.id}: laces from close: only okay`); }
      if (sc.pattern === 'foot-edge') assert.equal(sc.best, 'shoot:*:las', sc.id);
      if (sc.pattern === 'aim-open') { assert.match(sc.best, /^shoot:[LMR]:in$/, sc.id); assert.ok(sc.safe.includes(sc.best.replace(':in', ':las')), 'the right space with laces: 2 stars'); }
      for (const opt of optionsFor(sc)) { const r = await playOption(sc, opt), j = judge(r); assert.deepEqual(j, [], `${sc.id} ${opt}: ${j.join('; ')}`); }
    }
  }
  setSize('3v3');
});

for (const size of SIZE_IDS) test(`${size}: saved games stay open; "Shoot to the space!" never holds up the lessons after it`, () => {
  setSize(size);
  const fresh = catchUp(defaultProgress(), PATH);
  assert.deepEqual(PATH.map((_, i) => isOpen(fresh, PATH, i)), PATH.map((_, i) => i === 0), 'a new player: the first lesson only');
  const mid = defaultProgress(); for (const id of ['look-up', 'dribble-to-space', 'take-him-on', 'shoot-close', 'inside-laces']) { finishSession(mid, id, 6, 6, 100); }
  const m = reload(mid);
  assert.ok(isOpen(m, PATH, at('follow-shot')), 'follow-shot opens after "Inside or laces?"');
  if (size === '5v5') assert.ok(isOpen(m, PATH, at('shoot-space')), 'and "Shoot to the space!" with it');
  const full = defaultProgress(); for (const id of ids().filter(id => id !== 'shoot-space')) { finishSession(full, id, 6, 6, 100); finishSession(full, id, 6, 6, 101); }
  const f = reload(full);
  assert.ok(PATH.every((_, i) => isOpen(f, PATH, i)), 'everything open');
  assert.equal(graduated(f, PATH), size !== '5v5', '5v5: its own lesson comes up first');
  if (size === '5v5') { assert.equal(nextSkill(f, PATH, 300), 'shoot-space'); finishSession(f, 'shoot-space', 6, 6, 300); assert.ok(graduated(f, PATH)); }
  // Back to 3v3 and on to 5v5 again: nothing he had open closes.
  for (const z of ['3v3', '5v5', size]) { setSize(z); const again = reload(f); assert.ok(PATH.every((_, i) => isOpen(again, PATH, i)), z); }
  setSize('3v3');
});

test('5v5: every scene has both keepers out of the play, and a match with keepers finishes', async () => {
  setSize('5v5');
  for (const sk of PATH) { const sc = generate(sk.id, 5); assert.ok(sc.gk?.us && sc.gk?.them, sk.id); }
  const { g } = makeGame(); g.skills = new Set(PATH.map(s => s.id));
  let seenK = 0;
  const score = await drive(g, g.match(PATH.map(s => s.id), [], 2, 'free'), { pick: gm => gm.sc.best || (gm.sc.spots ? 'spot:' + gm.sc.spots[0].id : 'drib:fwd'), maxSec: 1800,
    onFrame: gm => { if (gm.sim.a('k1') && gm.sim.a('k2')) seenK++; } });
  assert.ok(score.us >= 2 || score.them >= 2, JSON.stringify(score)); assert.ok(seenK > 100, 'the keepers play');
  setSize('3v3');
});
