// (v96) Live's variant E (js/fast/variant.js, js/fast/fast.js): Classic's stop-and-decide rhythm where the world never
// stops. At a decision point time crawls (CRAWL of real speed, never 0), the choices are worked out once and stay, a
// countdown ends in STAY, off-ball points come at least OFF_GAP s apart; A to D play as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sim } from '../js/sim.js';
import { PITCH, sizeOf } from '../js/geom.js';
import { Match } from '../js/fast/match.js';
import * as R from '../js/fast/rules.js';
import { VARIANTS, variantOf, Decision, Ramp, CRAWL, CRAWL_IN, CRAWL_OUT, CRAWL_S, CRAWL_MIN, crawlLen, DEC_UP, DEC_SLOW, DEC_MAX, offDue, offChoices, OFF_GAP, OFF_NEAR, OFF_SEP, OFF_MAX, PRESS_FAR, PLACE_KIND, STALE_M } from '../js/fast/variant.js';

const L = PITCH.L, W = PITCH.W, BASE = .75, read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const seeded = (seed = 7) => { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5) >>> 0) / 4294967296); };
function match(seed = 7) { const sim = new Sim(), sz = sizeOf(); const m = new Match({ sim, L, W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, n: sz.out, keepers: !!sz.keeper, rnd: seeded(seed) }); m.setup('us'); return { sim, m }; }
const fast = read('js/fast/fast.js'), body = name => { const i = fast.indexOf(`\n  ${name}(`); assert.ok(i > 0, name); const j = fast.indexOf('\n  }\n', i); return fast.slice(i, j); };

test('E is read from the settings, has its chip after A B C D, and its decision points are logged', () => {
  assert.equal(variantOf({ liveVariant: 'E' }), 'E');
  for (const s of [{}, null, { liveVariant: 'e' }, { liveVariant: 'F' }]) assert.equal(variantOf(s), 'A', 'the default is still A');
  assert.deepEqual(Object.keys(VARIANTS), ['A', 'B', 'C', 'D', 'E']);
  assert.match(read('index.html'), /data-v="D">D<\/button><button type="button" data-v="E">E<\/button><\/div>/);
  assert.match(fast, /is: 'decide', variant: 'E', side, why: E\.why, offered: E\.offered\.join\(' '\), chose: how, secs/);
  assert.match(fast, /is: 'start',[^}]*variant: this\.vid/);
});

test('A to D: the table and their decision moments as before', () => {
  assert.deepEqual({ A: VARIANTS.A, B: VARIANTS.B, C: VARIANTS.C, D: VARIANTS.D }, { A: { slow: DEC_SLOW, big: true, auto: true }, B: { slow: DEC_SLOW, big: false, auto: false }, C: { slow: null, big: true, auto: true }, D: { stop: true, big: true, auto: true } });
  for (const id of ['A', 'B']) { const d = new Decision(id); d.open(0, true, 99); assert.equal(d.len, DEC_MAX, 'E\'s length is E\'s only'); assert.equal(d.scale(), DEC_SLOW); }
  const d = new Decision('D'); d.open(0, true, 99); assert.equal(d.scale(), 0); assert.ok(d.len <= 5);
  assert.equal(new Decision('C').scale(), null);
  // (their easing, their decide(), their marks: the same lines, E beside them)
  assert.match(fast, /else \{\n {4}this\.slow \+= \(tgt - this\.slow\) \* \(1 - Math\.exp\(-dt \* \(tgt > this\.slow \? 3 \/ BACK_S : want === 0 \? 14 : 8\)\)\);/);
  assert.match(fast, /if \(this\.V\.crawl\) this\.decideE\(hh, !!hh && m\.owner\(\) === this\.me\); else this\.decide\(hh, !!hh && m\.owner\(\) === this\.me\);/);
  assert.match(fast, /\} else this\.marks\.big\(show && has \? h : null, show && has && !this\.bigChosen \? this\.big : null/);
});

test('the crawl: eased in over about CRAWL_IN s, then between 0.03 and 0.06 of real speed (never 0) until the point ends; eased out over CRAWL_OUT s', () => {
  assert.ok(CRAWL >= .03 && CRAWL <= .06);
  const d = new Decision('E'); d.open(0, true, crawlLen(0)); assert.equal(d.scale(), CRAWL, 'its scale while open');
  const r = new Ramp(BASE), dt = 1 / 60; let t = 0, min = 9;
  for (; t < CRAWL_IN + 1e-9; t += dt) { const v = r.step(d.scale(), dt, CRAWL_IN); assert.ok(v >= CRAWL - 1e-9 && v <= BASE + 1e-9); }
  for (; t < 5; t += dt) { const v = r.step(d.scale(), dt, CRAWL_IN); assert.ok(v >= .03 && v <= .06, `crawl at ${v}`); min = Math.min(min, v); }
  assert.ok(min > 0, 'never 0');
  d.close(true); assert.equal(d.scale(), null);
  let u = 0; for (; u < CRAWL_OUT + 1e-9; u += dt) r.step(BASE, dt, CRAWL_OUT); assert.ok(Math.abs(r.v - BASE) < 1e-6, 'real speed again');
  // halfway through the ease it is halfway (a smooth step, not a snap)
  const h = new Ramp(BASE); for (let k = 0; k < 9; k++) h.step(CRAWL, dt, CRAWL_IN); assert.ok(h.v < BASE - .2 && h.v > CRAWL + .2, `${h.v}`);
  assert.match(fast, /if \(this\.V\.crawl\) this\.slow = this\.ramp\.step\(tgt, dt, tgt < this\.slow \? CRAWL_IN : CRAWL_OUT\);/);
});

test('the countdown: CRAWL_S s at first, shorter as his level rises, never under CRAWL_MIN; it starts when his head is up (or DEC_UP s on); its end is STAY', () => {
  assert.equal(crawlLen(0), CRAWL_S); assert.equal(crawlLen(-1), CRAWL_S);
  let last = CRAWL_S; for (let k = 0; k <= 2; k += .05) { const l = crawlLen(k); assert.ok(l <= last + 1e-9 && l >= CRAWL_MIN); last = l; }
  assert.equal(crawlLen(5), CRAWL_MIN);
  const d = new Decision('E'); d.open(10, false, 4); d.tick(10 + DEC_UP - .01, false); assert.equal(d.clock, null, 'head down: it waits');
  d.tick(10 + DEC_UP, false); assert.ok(!d.expired(10 + DEC_UP + 3.99)); assert.ok(d.expired(10 + DEC_UP + 4), 'then it runs out');
  const e = new Decision('E'); e.open(0, true, 5); assert.equal(e.clock, 0, 'head up: at once');
  // when it runs out: endE('default'); with the ball he keeps it (and is asked again only later), off it he stays where he is
  assert.match(body('decideE'), /if \(d\.expired\(this\.real\)\) this\.endE\('default'\);/);
  const end = body('endE');
  assert.match(end, /if \(side === 'on'\) \{ this\.big = null; if \(how === 'default' \|\| how === 'stay'\) \{ E\.kept = true; E\.onAgain = this\.real \+ ON_AGAIN; \} \}/);
  assert.match(end, /else if \(how === 'default' \|\| how === 'stay'\) \{ this\.m\.meMove = null; this\.sim\.stop\(this\.me\);/);
  assert.match(fast, /this\.stats\.stays\+\+; this\.acted\('stay'\);/, 'STAY tapped is the same choice');
});

test('the choices are worked out once, as a point opens, and stay until it ends', () => {
  const open = body('openOn'), dec = body('decideE');
  assert.match(open, /this\.big = bigChoices\(/); assert.match(open, /E\.friends = m\.usIds\.filter\(id => id !== this\.me && s\.a\(id\) && m\.passCheck\(this\.me, id\)\.open\)/);
  assert.match(body('openOff'), /E\.places = places;/);
  for (const f of ['bigChoices', 'bigNow', 'offChoices', 'spotSet', 'E.places =', 'E.friends =']) assert.ok(!dec.includes(f), `decideE never redoes them (${f})`);
  assert.equal((fast.match(/E\.places = /g) || []).length, 2, 'set as it opens (and cleared on the ball) only'); // (openOn: null; openOff: the places)
  assert.match(fast, /const eF = this\.V\.crawl \? \(this\.dec\.on && this\.E\.side === 'on' \? this\.E\.friends : \[\]\) : null;/, 'lit: the friends worked out as it opened');
  assert.match(fast, /const moving = !!\(m\.meMove && s\.time < m\.meMove\.until\), list = moving \? \[\] : this\.big \|\| \[\];/, 'a tap picks from the same list');
});

test('off-ball points: when the ball changes hands or play moves on, never with the ball on its way to him, and at least OFF_GAP s apart', () => {
  const rnd = seeded(21), keys = ['ours:m1', 'ours:m2', 'theirs:o1', 'theirs:o2', 'loose', null];
  let lastOff = -9, lastEnd = -9, seen = null, ballAt = null, n = 0, stale = 0;
  for (let t = 0; t < 600; t += .1) {
    const key = rnd() < .08 ? keys[Math.floor(rnd() * keys.length)] : seen, ball = { x: rnd() * L, y: rnd() * W }, toMe = rnd() < .1;
    const why = offDue({ key, seen, now: t, lastOff, lastEnd, ball, ballAt, toMe });
    if (why) { assert.ok(t - lastOff >= OFF_GAP - 1e-9, `${(t - lastOff).toFixed(2)} s after the last`); assert.ok(!toMe && key); n++; if (why === 'stale') stale++; lastOff = t; lastEnd = t + 1 + rnd() * 4; t = lastEnd; seen = key; ballAt = ball; }
  }
  assert.ok(n > 20 && stale > 0, `${n} points, ${stale} stale`);
  assert.equal(offDue({ key: 'ours:m1', seen: 'ours:m1', now: 100, lastOff: 10, lastEnd: 10, ball: { x: 1, y: 1 }, ballAt: { x: 1 + STALE_M - .1, y: 1 }, toMe: false }), false, 'nothing new, play not moved on: none');
  assert.equal(offDue({ key: 'theirs:o1', seen: 'ours:m1', now: 100, lastOff: 97, lastEnd: 90, ball: {}, ballAt: null, toMe: false }), false, 'too soon after the last');
  assert.equal(offDue({ key: 'theirs:o1', seen: 'ours:m1', now: 100, lastOff: 90, lastEnd: 99.5, ball: {}, ballAt: null, toMe: false }), false, 'a moment of real play after any point first');
  assert.equal(offDue({ key: 'theirs:o1', seen: 'ours:m1', now: 100, lastOff: 90, lastEnd: 90, ball: {}, ballAt: null, toMe: false }), 'changed');
});

test('off-ball places: one to three, apart, none on top of him, the kinds his situation asks for', () => {
  const rnd = seeded(5); let n = 0, press = 0;
  for (let k = 0; k < 240; k++) {
    const { sim, m } = match(k + 1); m.dead = false;
    for (const a of sim.agents.values()) if (!a.gk) { const x = 3 + rnd() * (L - 6), y = 2 + rnd() * (W - 4); Object.assign(a, { x, y, tx: x, ty: y }); }
    const me = sim.a('hero'), state = ['ours', 'theirs', 'loose'][k % 3], c = state === 'ours' ? sim.a('m1') : state === 'theirs' ? sim.a('o1') : null;
    if (c) { Object.assign(sim.ball, { x: c.x + .4, y: c.y }); sim.give(c.id); } else Object.assign(sim.ball, { state: 'loose', carrier: null, x: me.x + 5, y: me.y });
    const spots = R.spotSet({ me, state, carrier: c, ball: sim.ball, mates: m.usIds.filter(id => id !== 'hero').map(id => sim.a(id)), foes: m.foes('us'), keeper: m.keeper('them'), L, W });
    const ps = offChoices(spots, state, me); n += ps.length;
    assert.ok(ps.length <= OFF_MAX);
    for (const p of ps) {
      assert.ok(Math.hypot(p.x - me.x, p.y - me.y) >= OFF_NEAR - 1e-9, 'STAY is the choice right where he is');
      for (const q of ps) if (q !== p) assert.ok(Math.hypot(q.x - p.x, q.y - p.y) >= OFF_SEP - 1e-9, 'apart');
      assert.ok(Object.values(PLACE_KIND).includes(p.kind));
      if (state === 'ours') assert.equal(p.kind, 'open', 'his team\'s ball: places to get open');
      if (state === 'theirs') assert.ok(p.kind === 'press' || p.kind === 'cover');
      if (p.kind === 'press') { press++; assert.ok(Math.hypot(c.x - me.x, c.y - me.y) <= PRESS_FAR + 1.5); }
    }
    if (state === 'theirs') assert.ok(ps.filter(p => p.kind === 'press').length <= 1);
  }
  assert.ok(n / 240 >= 1.8, `about two or three a point: ${(n / 240).toFixed(2)}`); assert.ok(press > 20);
});

test('E: his head goes down only with one of theirs near; after a skill move on a chosen run he goes on to where he chose', () => {
  assert.match(fast, /if \(R\.headDownOn\(id, this\.me, how\) && \(!this\.V\.crawl \|\| \(me && m\.foes\('us'\)\.some\(o => Math\.hypot\(o\.x - me\.x, o\.y - me\.y\) < PRESSED_R\)\)\)\)/);
  assert.match(fast, /if \(this\.V\.crawl && this\.bigChosen\) this\.E\.resume = this\.bigChosen;/);
  assert.match(body('decideE'), /if \(E\.resume && !moving && !m\.flight\) \{ const r = E\.resume; E\.resume = null; m\.meTo\(r\.x, r\.y\); this\.bigChosen = r; return; \}/);
  assert.match(fast, /lim = \(this\.V\?\.crawl && this\.dec\.on \? CRAWL_TURN : CAM_TURN\) \* dt/, 'the view drifts, never swings, in the crawl');
});

test('E\'s page: made before play, shown by class and opacity only', () => {
  const css = read('css/app.css');
  assert.match(fast, /<div id="fCrawl" aria-hidden="true"><\/div>/); assert.match(fast, /<button id="fStay" class="btn btn-blue btn-round"/);
  assert.match(css, /#fastHud\.crawl #fCrawl\{opacity:1\}/); assert.match(css, /#fastHud #fStay:not\(\.show\)\{opacity:0;pointer-events:none!important;animation:none\}/);
  const block = css.slice(css.indexOf('VARE worker (v96)')); assert.ok(!/filter\s*:/.test(block), 'no filter');
  assert.match(fast, /cls\(this\.dom\.box, 'crawl', on\); cls\(this\.dom\.stay, 'show', on\); cls\(this\.dom\.stay, 'run', on && this\.dec\.clock != null\);/);
});
