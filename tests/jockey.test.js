// (round 13) The one defender of a trap scene (window.js: he jockeys) works his way in over the whole window: from about
// 1.6 m off the ball he closes in steps to about 0.9 m by the window's last second, makes one or two quick feint lunges
// on the way (window.js jockFeint, drawn by pro/motion.js), and goes in as the ring empties; he never has the ball
// before then. Measured as the child sees it: by real seconds of the window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { allScenarios } from '../js/skills.js';
import { jockFeint, JOCK } from '../js/window.js';
import { makeGame, drive } from './harness.js';

async function trap(skill, id, level) {
  const sc = allScenarios(skill).find(s => s.id === id); if (!sc) return null;
  const { g } = makeGame(); g.mode = 'lesson'; g.levelOf = () => level; g.load(sc);
  await drive(g, g.pre());
  const p = g.decide(), w = g.win, th = w?.threat?.id, path = w?.plan.paths[th], rec = []; let r0 = null;
  const o = await drive(g, p, { onFrame: gm => { if (!gm.win) return; const s = gm.sim, a = s.a(th); r0 ??= gm.realTime; rec.push({ real: gm.realTime - r0, t: s.time - gm.win.t0, d: Math.hypot(a.x - s.ball.x, a.y - s.ball.y), car: s.ball.carrier }); } });
  return { w, path, rec, o, R: w.R, f: w.f };
}

// (the two scenes the round found him shuffling in: see-the-trap at 3v3, take-him-on at 5v5; a scene's id is another
// scene at another size)
for (const [skill, id, size] of [['see-the-trap', 'gen-trap-one-108', 3], ['take-him-on', 'gen-trap-one-106', 5]]) for (const level of [1, 2, 3]) {
  test(`${id} at level ${level}: the defender works his way in, feints, and goes in as the ring empties`, { skip: (process.env.SOCCER_SIZE || '3v3') !== `${size}v${size}` && `a ${size}v${size} scene` }, async () => {
    const r = await trap(skill, id, level); if (!r) return;
    assert.equal(r.w.plan.cls, 'jockey', 'one defender already there: he jockeys');
    const { rec, R, path } = r, at = s => rec.reduce((b, x) => (Math.abs(x.real - s) < Math.abs(b.real - s) ? x : b));
    assert.ok(at(0).d > 1.35 && at(0).d < 1.75, `he starts about 1.6 m off the ball (${at(0).d.toFixed(2)})`);
    const late = at(R - 1).d; assert.ok(late > .85 && late < 1.06, `about 0.9 to 1 m off it by the last second (${late.toFixed(2)})`);
    // in steps: the way in has a settle between two surges (his closing speed, over half-second spans, drops and rises again)
    const sp = []; for (let s = .25; s < R - 1.25; s += .5) sp.push((at(s - .25).d - at(s + .25).d) / .5);
    const steps = sp.some((v, j) => v < .03 && sp.slice(0, j).some(u => u > .07) && sp.slice(j + 1).some(u => u > .07));
    assert.ok(steps, `he closes in steps: a surge, a settle, a surge (closing speeds ${sp.map(v => v.toFixed(2)).join(' ')} m/s)`);
    // the feints: two in a window of 5 s and more, one in a shorter one; each under 0.6 s on the screen
    assert.equal(path.feints.length, R >= 5 ? 2 : 1, 'feint lunges');
    for (const [c, hw] of path.feints) { assert.ok(2 * hw / r.f < .6 + 1e-9, `a feint lasts ${(2 * hw / r.f).toFixed(2)} s on the screen`); assert.ok(jockFeint(path, c - hw + .8 * hw) > .99, 'and goes all the way in'); }
    assert.ok(JOCK.feint <= .6, 'feint length');
    // never the ball before the ring is empty; the last lunge ends 0.5 to 0.75 m from it, and he takes it
    assert.ok(rec.every(x => x.car === 'hero'), 'the ball stays his while the ring runs');
    const end = rec.at(-1).d; assert.ok(end >= .5 && end <= .75, `the lunge lands ${end.toFixed(2)} m from the ball`);
    assert.equal(r.o, 'timeout');
  });
}
