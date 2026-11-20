// (v76 SL) How often the skill moment comes (game/skill.js, outcomes.js stepUp, sim.js turnAhead 'any'). Before v76 it
// came 0.3 to 0.7 times a 3-goal match (the defender was usually already at him as a dribble play started, the one he
// beat at his back, a second one coming in) and in a third of the take-him-on lesson's scenes. Now the next defender
// steps up to hold him up in his run at goal, the others give the two of them room, and any turn past a defender close
// by can be a skill turn. Measured with a child-paced bot (1 to 5 s to choose, a wrong option one time in five; the
// better move tapped a second into each offer), seeded: offers a match, the shortest gap between two (20 s or more), and
// the lesson's scenes as they are made (its best choice, picked at a child's moment), the share that offer it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, optionsFor, pictureU } from './harness.js';
import { PATH } from '../js/skills.js';
import { generate } from '../js/generate.js';
import { TEAM } from '../js/geom.js';

const size = TEAM.size;
const WANT = { '3v3': .55, '4v4': .6, '5v5': .7 }; // (offers a 3-goal match, at the least, over these seeds; before v76: 0.33, 0.42, 0.68)
const away = [], short = []; let duelF = 0; // (frames of a step-up's offer with the defender turned more than 110° from him)
async function matchOffers(seed) {
  let x = seed * 7907; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647;
  let y = seed * 31337; const rnd = () => (y = (y * 48271) % 2147483647) / 2147483647;
  const { g } = makeGame(); g.skills = new Set(PATH.map(k => k.id)); const at = []; let cur = null, done = false, last = null, delay = 0, openT = 0, T = 0;
  g.match(PATH.map(k => k.id), [], 3, 'free').then(() => { done = true; });
  for (let k = 0; k < 30 * 900 && !done; k++) { T += 1 / 30; g.tick(1 / 30, T);
    if (g.sk && g.sk !== cur) { cur = g.sk; at.push(g.realTime); cur.r0 = g.realTime; }
    if (g.duel && (g.sk?.phase === 'offer' || g.sk?.phase === 'armed')) { const o = g.sim.a(g.duel), h = g.sim.a('hero'), dx = h.x - o.x, dy = h.y - o.y, d = Math.hypot(dx, dy) || 1; duelF++; if ((o.face[0] * dx + o.face[1] * dy) / d < -.34) away.push(`seed ${seed} t ${g.sim.time.toFixed(2)}`); } // (review: he faces the dribbler as he gives ground)
    if (cur && !cur.seenOut && cur.phase !== 'offer') { cur.seenOut = true; if (!cur.tapped && g.realTime - cur.r0 < 1.5) short.push(`seed ${seed}: ${(g.realTime - cur.r0).toFixed(2)} s`); } // (review: shown, it stays 1.5 s or more unless he taps)
    if (g.sk?.phase === 'offer' && g.realTime - g.sk.r0 > 1.6) { g.sk.tapped = true; g.skillTap(g.sk.alts.findIndex(a => a.good)); }
    if (g.canAct && g._choose) { const sc = g.sc; if (g._choose !== last) { last = g._choose; delay = 1 + rnd() * 4; openT = T; }
      let o = null; if (sc.kind === 'tackle') o = g.tackleState() === 'good' ? sc.best : null;
      else if (T - openT >= delay) { const all = optionsFor(sc).filter(q => q !== sc.best); o = all.length && rnd() < .2 ? all[Math.floor(rnd() * all.length)] : sc.best || (sc.spots ? 'spot:' + sc.spots[0].id : 'drib:back'); }
      if (o) { g.seen.add('m1'); g.seen.add('m2'); if (g.sim.a('m3')) g.seen.add('m3'); try { g.choose(o); } catch {} } }
    if (k % 8 === 0) await new Promise(r => setImmediate(r)); else await null; }
  return at;
}
test('the skill moment comes about once a match, never more than once in 20 s, and in most take-him-on lesson scenes', async () => {
  const real = Math.random; let n = 0; const N = 12;
  try { for (let seed = 1; seed <= N; seed++) { const at = await matchOffers(seed); n += at.length; for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 20, `seed ${seed}: offers ${(at[i] - at[i - 1]).toFixed(1)} s apart`); } }
  finally { Math.random = real; }
  assert.deepEqual(short, [], 'offers that went under 1.5 s with no tap');
  assert.ok(duelF > 0, 'step-ups were offered'); assert.deepEqual(away.slice(0, 5), [], `the one who steps up keeps facing him (${away.length} of ${duelF} frames turned away)`);
  assert.ok(n / N >= WANT[size], `${(n / N).toFixed(2)} offers a match at ${size} (at least ${WANT[size]} wanted)`);
  let x = 777; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647; let plays = 0, offered = 0;
  try {
    for (let i = 0; i < 24; i++) { const sc = generate('take-him-on', 5000 + i * 13); if (!sc) continue; plays++;
      const { g } = makeGame(); g.mode = 'lesson'; g.load(sc); let seen = false;
      const run = async (p, f) => { let d = false; p.then(() => { d = true; }); for (let k = 0; k < 6000 && !d; k++) { g.tick(1 / 60, 100 + k / 60); f?.(); await null; } };
      await run(g.pre()); g.decide(); if (g.win) { const u = pictureU(g.win) * (.4 + Math.random() * .6); for (let k = 0; k < 6000 && g.win && (g.win.u ?? 0) < u; k++) g.tick(1 / 60, 0); }
      g.rated = { stars: 3, text: 'x' }; await run(g.outcome(sc.best, g.isGood(sc.best)), () => { if (g.sk) seen = true; }); if (seen) offered++; }
  } finally { Math.random = real; }
  assert.ok(offered / plays >= .45, `${offered} of ${plays} take-him-on scenes offer it (a pass is the answer in one scene in four)`);
});
