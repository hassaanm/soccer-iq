// (v93 round 3) Live's four variants (js/fast/variant.js): the picker's setting, the decision moment's clock (slow, none,
// stopped with a ring), big choices that never offer a blocked friend, and his player moving by himself off the ball.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sim } from '../js/sim.js';
import { PITCH, sizeOf } from '../js/geom.js';
import { Match } from '../js/fast/match.js';
import * as R from '../js/fast/rules.js';
import { VARIANTS, variantOf, Decision, bigChoices, DEC_SLOW, DEC_MAX, DEC_UP, RING_S, BIG_MAX } from '../js/fast/variant.js';

const L = PITCH.L, W = PITCH.W, read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const seeded = (seed = 7) => { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5) >>> 0) / 4294967296); };
function match(seed = 7) { const sim = new Sim(), sz = sizeOf(); const m = new Match({ sim, L, W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, n: sz.out, keepers: !!sz.keeper, rnd: seeded(seed) }); m.setup('us'); return { sim, m }; }

test('the variant comes from the settings (A unless A B C D is chosen), reaches a Live match and its log line', () => {
  assert.equal(variantOf({ liveVariant: 'C' }), 'C'); assert.equal(variantOf({ liveVariant: 'D' }), 'D');
  for (const s of [{}, null, undefined, { liveVariant: 'x' }, { liveVariant: 'a' }]) assert.equal(variantOf(s), 'A');
  assert.deepEqual(Object.keys(VARIANTS), ['A', 'B', 'C', 'D']);
  const fast = read('js/fast/fast.js');
  assert.match(fast, /this\.vid = variantOf\(P\.settings\)/); assert.match(fast, /is: 'start',[^}]*variant: this\.vid/);
  assert.match(read('js/ui/home.js'), /P\.settings\.liveVariant = b\.dataset\.v; save\(\)/);
  assert.match(read('css/app.css'), /#home\.live \.livevar\{display:flex\}/, 'the chips only in Live');
});

test('the decision moment: A and B slow until he chooses (at most DEC_MAX s), C never slows, D stops and its ring ends it', () => {
  for (const id of ['A', 'B']) {
    const d = new Decision(id); d.open(10, false); assert.equal(d.scale(), DEC_SLOW);
    d.tick(10 + DEC_UP - .1, false); assert.equal(d.clock, null, 'head down: the clock waits'); d.tick(10 + DEC_UP, false); assert.equal(d.clock, 10 + DEC_UP, 'or starts after DEC_UP s');
    assert.ok(!d.expired(10 + DEC_UP + DEC_MAX - .1)); assert.ok(d.expired(10 + DEC_UP + DEC_MAX));
    d.close(false); assert.equal(d.scale(), null); assert.ok(d.spent, 'not again until he does something');
  }
  const c = new Decision('C'); c.open(0, true); c.tick(0, true); assert.equal(c.scale(), null); assert.ok(!c.expired(1e6));
  const d = new Decision('D'); d.open(5, false); assert.equal(d.scale(), 0, 'time is 0 at a decision moment'); d.tick(5.2, true); assert.equal(d.clock, 5.2, 'the clock starts as he looks up');
  assert.equal(d.left(5.2), 1); assert.ok(Math.abs(d.left(5.2 + RING_S / 2) - .5) < 1e-9); assert.ok(!d.expired(5.2 + RING_S - .01)); assert.ok(d.expired(5.2 + RING_S), 'the ring ends it');
  d.close(true); d.open(20, true); assert.ok(d.len < RING_S && d.len >= 3.5, 'a little shorter as he goes on');
  const fast = read('js/fast/fast.js');
  assert.match(fast, /if \(this\.V\.stop\) \{ const o = m\.foes\('us'\)/, 'D: the nearest of theirs comes for it');
  assert.match(fast, /if \(want === 0 && this\.slow < \.015\) this\.slow = 0/, 'D: the world stops');
});

test('big choices: at most three, apart, on the pitch, never through one of theirs; never none', () => {
  const rnd = seeded(11); let front = 0, all = 0;
  for (let k = 0; k < 400; k++) {
    const { sim, m } = match(k + 1); m.dead = false;
    for (const a of sim.agents.values()) if (!a.gk) { const x = 3 + rnd() * (L - 6), y = 2 + rnd() * (W - 4); Object.assign(a, { x, y, tx: x, ty: y }); }
    const me = sim.a('hero'), yaw = R.naturalYaw(me, sim.ball, true, L, W), foes = m.allFoes('us'), cs = bigChoices({ me, yaw, foes, L, W });
    assert.ok(cs.length >= 1 && cs.length <= BIG_MAX, `${cs.length} choices`);
    for (const c of cs) {
      assert.ok(c.x >= 1.5 - 1e-9 && c.x <= L - 1.5 + 1e-9 && c.y >= 1.5 - 1e-9 && c.y <= W - 1.5 + 1e-9, 'on the pitch');
      front += Math.abs(R.wrap(c.a - yaw)) <= 1.76 + .3 ? 1 : 0; all++;
      for (const q of cs) if (q !== c) assert.ok(Math.abs(R.wrap(q.a - c.a)) >= .6 - 1e-9, 'apart');
      for (const o of foes) { const q = R.onLane(o, me, c, 0); if (q.t > .08) assert.ok(q.d >= .8 - 1e-9, 'never through one of theirs'); }
    }
  }
  assert.ok(front / all > .99, `in front of the view: ${front} of ${all}`); // (only the last resort, a way squeezed by a line in a corner, may bend)
});

test('A, C, D: a friend whose lane is blocked is never offered, and a tap on him never passes', () => {
  const rnd = seeded(3); let blockedSeen = 0;
  for (let k = 0; k < 300; k++) {
    const { sim, m } = match(k + 9); m.dead = false;
    for (const a of sim.agents.values()) if (!a.gk) { const x = 3 + rnd() * (L - 6), y = 2 + rnd() * (W - 4); Object.assign(a, { x, y, tx: x, ty: y }); }
    const me = sim.a('hero'); Object.assign(sim.ball, { x: me.x + .4, y: me.y }); sim.give('hero');
    for (const id of m.usIds.filter(id => id !== 'hero')) { // (offered = lit = passCheck open: fast.js ui.glow, litFriends)
      const f = sim.a(id), onIt = m.allFoes('us').some(o => { const q = R.onLane(o, me, f, .12); return q.d < .4 && q.t > .1 && q.t < .9; });
      if (onIt) { blockedSeen++; assert.equal(m.passCheck('hero', id).open, false, 'a lane with one of theirs on it is not open'); }
    }
  }
  assert.ok(blockedSeen > 20);
  const fast = read('js/fast/fast.js');
  assert.match(fast, /if \(m\.passCheck\(this\.me, fb\)\.open\) \{ this\.passTo\(fb\); return \{ kind: 'pass', id: fb \}; \} this\.blocked\(fb\); return null;/, 'tapBig: open passes, blocked flashes');
  assert.match(fast, /if \(this\.V\.big && !this\.m\.passCheck\(this\.me, c\.id\)\.open\) \{ this\.blocked\(c\.id\); return; \}/, 'a chip too');
  assert.match(fast, /this\.ui\.glow\[id\] > 0/, 'lit: only friends the check calls open');
});

test('moving by himself: off the ball he is never left standing still more than 2 s while play goes on', () => {
  for (const seed of [1, 2, 3]) {
    const { sim, m } = match(seed); m.autoMe = true; m.on.goal = t => m.kickoff(t === 'us' ? 'them' : 'us');
    m.kickoff('us');
    let still = 0, worst = 0, at = null, offT = 0, decideAt = 0; const dt = 1 / 60;
    for (let t = 0; t < 90; t += dt) {
      const me = sim.a(m.me), has = m.owner() === m.me;
      if (has && sim.time > decideAt && !(m.meMove && sim.time < m.meMove.until)) { // (his choice, made at once: a pass if one is open, else a big choice)
        decideAt = sim.time + .8; const open = m.usIds.find(id => id !== m.me && m.passCheck(m.me, id).open);
        if (open && m.rnd() < .7) m.pass(m.me, open); else { const c = bigChoices({ me, yaw: R.naturalYaw(me, sim.ball, true, L, W), foes: m.allFoes('us'), L, W })[0]; m.meTo(c.x, c.y); }
      }
      if (!has && m.canSteal() && m.rnd() < .05) m.steal(); // (STEAL stays his one button on defence)
      m.step(dt); m.autoStep(); sim.step(dt);
      const live = !m.dead && m.owner() !== m.me && m.flight?.to !== m.me && !m.stumbling() && !m.cmd.has(m.me) && sim.ball.state !== 'held' && Math.hypot(me.x - sim.ball.x, me.y - sim.ball.y) > 2; // (right in their carrier's face is not standing about)
      if (!live) { still = 0; at = null; continue; }
      offT += dt;
      if (!at || Math.hypot(me.x - at.x, me.y - at.y) > .3) { at = { x: me.x, y: me.y }; still = 0; } else { still += dt; worst = Math.max(worst, still); }
    }
    assert.ok(offT > 5, `off the ball ${offT.toFixed(0)} s`);
    assert.ok(worst <= 2, `seed ${seed}: stood still ${worst.toFixed(2)} s`);
  }
});
