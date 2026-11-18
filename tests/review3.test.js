// Fixes after the v62 review: six chapters, what a wrong shot says, the friend the cue names in view, the praise for an
// equally good pass, the free friend at the far post in view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setSize, PITCH } from '../js/geom.js';
import { PATH, CHAPTERS } from '../js/skills.js';
import { generate } from '../js/generate.js';
import { makeGame, drive } from './harness.js';

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

test('six chapters, "Shoot!" second with the shot lessons, and no chapter longer than five lessons at any size', () => {
  assert.deepEqual(CHAPTERS, ['Me and the ball', 'Shoot!', 'Win it back', 'Me and my friends', 'Our team', 'Clever passes']);
  for (const size of ['3v3', '4v4', '5v5']) {
    setSize(size);
    const shoot = PATH.filter(s => s.ch === 1).map(s => s.id);
    assert.deepEqual(shoot, size === '5v5' ? ['shoot-close', 'inside-laces', 'shoot-space', 'follow-shot'] : ['shoot-close', 'inside-laces', 'follow-shot']);
    for (let ch = 0; ch < CHAPTERS.length; ch++) assert.ok(PATH.filter(s => s.ch === ch).length <= 5, `${size} chapter ${ch + 1}`);
  }
  setSize('3v3');
});

test('a wrong shot says what happened and why', () => {
  setSize('5v5');
  const { g } = makeGame(), close = generate('inside-laces', 1, { pattern: 'foot-close' }), edge = generate('inside-laces', 2, { pattern: 'foot-edge' }), aim = generate('shoot-space', 1, { pattern: 'aim-open' });
  g.load(close); assert.match(g.shotTip('shoot:*:las'), /^Goal! .*inside is safer/, 'laces from close (v72): in, only okay: the goal first, then the surer way');
  { g.load(aim); const z = ['TL', 'TM', 'TR'].find(t => g.shotPartGrades(`shoot:${t}:las`).space === false); assert.ok(z, 'a wrong high target'); assert.equal(g.shotOf(`shoot:${z}:las`).res, 'over'); assert.match(g.shotWhy(`shoot:${z}:las`), /high flies over.*Keep it low/); }
  g.load(edge); assert.match(g.shotWhy('shoot:*:in'), /Too slow.*Laces, for power/);
  const other = aim.best.split(':')[1] === 'L' ? 'R' : 'L'; g.load(aim); assert.match(g.shotWhy(`shoot:${other}:in`), /(right at him|near his hands).*big space/);
  setSize('3v3');
});

for (const size of ['3v3', '4v4', '5v5']) test(`${size}: in "Forward first", the friend the cue names is up the field, in view when he looks up`, () => {
  setSize(size);
  for (let seed = 1; seed <= 40; seed++) {
    const sc = generate('forward-first', seed, { pattern: 'two-open' }); if (!sc) continue;
    const m = sc.mates[+sc.best[5]], h = sc.heroTo;
    assert.ok(Math.abs(Math.atan2(m[1] - h[1], m[0] - h[0])) <= .6, `${sc.id}: ${sc.best}`);
  }
  setSize('3v3');
});

test('a pass as good as the best one: the praise names the friend he picked', async () => {
  setSize('4v4');
  let sc = null; for (let seed = 1; seed <= 60 && !sc; seed++) { const s = generate('forward-first', seed, { pattern: 'two-open' }); if (s?.ok.some(o => o.startsWith('pass:'))) sc = s; }
  assert.ok(sc, 'a scene with two good passes');
  const opt = sc.ok.find(o => o.startsWith('pass:')), { g, events } = makeGame();
  await drive(g, g.round(sc, { hint: false }), { pick: () => opt, maxSec: 60 });
  const card = events.find(e => e[0] === 'banner' && e[3]?.stars === 3);
  assert.ok(card && card[3].text.includes(g.name('m' + (+opt[5] + 1)) + ' was open too!'), card?.[3]?.text);
  setSize('3v3');
});

test('5v5, the pass across: after he looks up, the free friend at the far post is in view', () => {
  setSize('5v5');
  for (let seed = 1; seed <= 30; seed++) {
    const sc = generate('shoot-space', seed, { pattern: 'keeper-friend' }); if (!sc) continue;
    const { g } = makeGame(); g.mode = 'lesson'; g.load(sc);
    const m = sc.mates[+sc.best[5]], h = sc.heroTo, off = wrap(Math.atan2(m[1] - h[1], m[0] - h[0]) - g.yaw), goal = wrap(Math.atan2(PITCH.W / 2 - h[1], PITCH.L - h[0]) - g.yaw);
    assert.ok(Math.abs(off) < .65 && Math.abs(goal) < .65, `${sc.id}: friend ${off.toFixed(2)}, goal ${goal.toFixed(2)} rad off the view`);
  }
  setSize('3v3');
});
