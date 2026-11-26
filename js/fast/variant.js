// (v93 round 3, the owner: "a few buttons I can press between like A B C D ... I'll try them and give you feedback")
// Four ways to play a Live match, picked on the home screen (settings.liveVariant), unpolished, to compare by feel:
//   A  at a decision moment the world goes slow (DEC_SLOW) until he chooses (DEC_MAX real s at most); big choices;
//      he moves by himself off the ball
//   B  the same slow motion, with the fixed spots as built (5 to 7) and moving by taps, as built
//   C  big choices and moving by himself, at full speed (no slowing)
//   D  big choices and moving by himself; at a decision moment the world STOPS and a ring drains (RING_S real s at
//      first); when it is empty the nearest of theirs comes and takes the ball
// A decision moment: he has the ball and has not chosen (he just got it, or got where he was going). Its clock starts
// when he looks up, or DEC_UP s after it began. No page here: the tests load it.
import { clamp, dist, wrap, onLane } from './rules.js';

//   E  (v96, the owner's own idea) Classic's stop-and-decide rhythm, but the world never stops: at each decision point,
//      on the ball AND off it, time eases into a crawl (CRAWL of real speed) with its own look and a countdown; he picks
//      from a few choices worked out once (they never move), STAY among them; when the countdown ends STAY happens. Off
//      the ball he moves only where he chose (see the E section below).
export const DEC_SLOW = .12, DEC_MAX = 6, DEC_UP = 1.5, RING_S = 5, RING_MIN = 3.5, RING_STEP = .1;
export const CRAWL = .04; // (E: of real speed: slow enough that 5 s of thinking does not change what the picture means, fast enough that legs and ball still move)
export const VARIANTS = {
  A: { slow: DEC_SLOW, big: true, auto: true },
  B: { slow: DEC_SLOW, big: false, auto: false },
  C: { slow: null, big: true, auto: true },
  D: { stop: true, big: true, auto: true },
  E: { crawl: CRAWL, big: true, auto: false },
};
export const VARIANT_IDS = Object.keys(VARIANTS);
export const variantOf = settings => (VARIANTS[settings?.liveVariant] ? settings.liveVariant : 'A');

// The decision moment's clock, in real seconds (now: the controller's real clock).
export class Decision {
  constructor(id = 'A') { this.id = VARIANTS[id] ? id : 'A'; this.v = VARIANTS[this.id]; this.on = false; this.n = 0; this.spent = false; }
  open(now, up, len) { this.on = true; this.t0 = now; this.clock = up ? now : null; this.spent = false; this.len = this.v.crawl ? len ?? CRAWL_S : this.v.stop ? Math.max(RING_MIN, RING_S - RING_STEP * this.n) : DEC_MAX; } // (len: E's countdown, by his level: crawlLen)
  // he chose: the moment ends (a new one may open when he next has the ball and stands with it)
  close(chose = true) { if (this.on && chose) this.n++; this.on = false; this.spent = !chose; }
  reset() { this.on = false; this.spent = false; }
  tick(now, up) { if (this.on && this.clock == null && (up || now - this.t0 >= DEC_UP)) this.clock = now; }
  // the time scale the moment wants (of real time), or null: none
  scale() { if (!this.on) return null; if (this.v.crawl) return this.v.crawl; if (this.v.stop) return 0; return this.v.slow ?? null; }
  // how much of the ring is left, 1 … 0 (before the clock starts: full)
  left(now) { if (!this.on) return 0; if (this.clock == null) return 1; return clamp(1 - (now - this.clock) / this.len, 0, 1); }
  // the moment ran out: A and B ease back to speed, D: they take it, E: STAY. C has no clock.
  expired(now) { return this.on && this.v.slow !== null && this.clock != null && now - this.clock >= this.len - 1e-9; }
}

// ---------- big choices ----------
// At most BIG_MAX ways to go from his feet, all in front of the view (yaw: where the view looks, at his opponents'
// goal with the ball): forward into space, wide (away from pressure when one of theirs is near), back to safety (only
// under pressure, or when there is little else). A way through or right next to one of theirs is no way, nor one that
// ends with one of theirs on it, nor one off the pitch. Never none while there is any free grass round him.
export const BIG_MAX = 3, BIG_LEN = { fwd: 6.5, wide: 5.5, back: 3.8 }, BIG_ANG = { fwd: .45, wide: 1.35, back: 1.75 }, BIG_PATH = 1.3, BIG_ROOM = 2, BIG_SEP = .6, PRESS_R = 3.5;
export function bigChoices({ me, yaw, foes = [], L, W }) {
  const goal = { x: L, y: W / 2 }, gd0 = dist(me, goal), near = foes.reduce((m, o) => (dist(o, me) < dist(m || { x: 1e9, y: 1e9 }, me) ? o : m), null), pressed = !!near && dist(near, me) < PRESS_R;
  const awaySide = near ? -Math.sign(wrap(Math.atan2(near.y - me.y, near.x - me.x) - yaw)) || 1 : 0;
  const cands = [];
  for (let r = -BIG_ANG.back; r <= BIG_ANG.back + 1e-9; r += .25) {
    const ar = Math.abs(r), kind = ar <= BIG_ANG.fwd ? 'fwd' : ar <= BIG_ANG.wide ? 'wide' : 'back', a = yaw + r;
    const x = clamp(me.x + Math.cos(a) * BIG_LEN[kind], 1.5, L - 1.5), y = clamp(me.y + Math.sin(a) * BIG_LEN[kind], 1.5, W - 1.5), d = Math.hypot(x - me.x, y - me.y);
    if (d < 3) continue;
    const bent = Math.abs(wrap(Math.atan2(y - me.y, x - me.x) - a)) > .3; // (squeezed by a line: no longer the way it was meant)
    const tip = { x, y };
    let path = 99; for (const o of foes) { const q = onLane(o, me, tip, 0); if (q.t > .08) path = Math.min(path, q.d); }
    const room = foes.reduce((m, o) => Math.min(m, dist(o, tip)), 99);
    const side = Math.sign(r) || 0, s = (gd0 - dist(tip, goal)) * .35 + Math.min(room, 5) * .6 + Math.min(path, 3) * .4 + (pressed && side === awaySide ? 1.5 : 0) + (kind === 'back' && pressed ? 1 : 0);
    cands.push({ x, y, a: Math.atan2(y - me.y, x - me.x), rel: r, d, kind, path, room, s, bent });
  }
  const pick = (ok, out) => { for (const kind of ['fwd', 'wide', 'back']) { if (out.length >= BIG_MAX) break; if (kind === 'back' && !pressed && out.length >= 2) continue; const c = cands.filter(c => c.kind === kind && ok(c) && out.every(o => Math.abs(wrap(o.a - c.a)) >= BIG_SEP)).sort((p, q) => q.s - p.s)[0]; if (c) out.push(c); }
    if (out.length < 2) for (const c of cands.filter(ok).sort((p, q) => q.s - p.s)) { if (out.length >= 2) break; if (out.every(o => Math.abs(wrap(o.a - c.a)) >= BIG_SEP * 1.5)) out.push(c); } // (a second way of the same kind, well apart, when only one kind is open)
    return out; };
  let out = pick(c => !c.bent && c.path >= BIG_PATH && c.room >= BIG_ROOM, []);
  if (!out.length) out = pick(c => !c.bent && c.path >= .8 && c.room >= 1.2, []);
  if (!out.length && cands.length) out = [cands.slice().sort((p, q) => q.room - p.room)[0]]; // (never none: the freest way)
  out.sort((p, q) => p.rel - q.rel);
  return out.map(({ x, y, a, d, kind }) => ({ x, y, a, d, kind }));
}
// The choice a tap means: the nearest tip or middle of an arrow on screen within reach, or a tap on the grass along one
// (within BIG_TAP_A rad of it, more than a metre from him). choices: [{ ..., q: tip on screen, qm: middle on screen }];
// g: the grass under the tap (or null).
export const BIG_TAP_A = .4;
export function bigAt(choices, me, x, y, g, h) {
  let best = null, bd = 1e9;
  for (const c of choices) for (const q of [c.q, c.qm]) { if (!q) continue; const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = c; } }
  if (best && bd <= Math.max(80, h * .22)) return best;
  if (g && me && Math.hypot(g.x - me.x, g.y - me.y) > 1) { const a = Math.atan2(g.y - me.y, g.x - me.x); let gb = null, ga = 1e9; for (const c of choices) { const d = Math.abs(wrap(c.a - a)); if (d < ga) { ga = d; gb = c; } } if (gb && ga <= BIG_TAP_A) return gb; }
  return null;
}

// ---------- variant E: the crawl (v96) ----------
// A decision point opens on the ball when he stands with it (he just got it, or got where he chose to go), and off the
// ball when the situation asks something of him (offDue). The world eases into the crawl over CRAWL_IN real s (a smooth
// step: Ramp) and back over CRAWL_OUT s when he chooses or the countdown ends. The countdown (crawlLen real s, CRAWL_S at
// first, a little shorter as his level rises, never under CRAWL_MIN) starts when his head is up (or DEC_UP s on); when it
// ends, STAY happens: with the ball he keeps it where he is (a defender who gets to him then tackles in real time), off it
// he stays where he is. The choices are worked out once, as the point opens, and do not change until it ends.
export const CRAWL_IN = .3, CRAWL_OUT = .3, CRAWL_S = 5, CRAWL_MIN = 3, CRAWL_PER = 2.5; // (CRAWL_PER: s less per level step of 1 he has risen: 0.4 s less for every eight stars)
export const OFF_GAP = 4, OFF_REAL = 1, ON_AGAIN = 2.5, STALE_S = 8, STALE_M = 8, PRESSED_R = 3, ON_PRESSED = 2.2;
// (OFF_GAP: real s at least between two off-ball points; OFF_REAL: real s of play at least since the last point of any
// kind; ON_AGAIN: real s after he kept the ball (STAY or the countdown) before he is asked again with it, and not while
// one of theirs is within ON_PRESSED m of him (the tackle plays out); STALE_*: play has moved on: STALE_M m of ball
// travel and STALE_S s since his last off-ball point; PRESSED_R: one of theirs this near as the ball comes to him puts his
// head down)
export const crawlLen = rise => clamp(CRAWL_S - Math.max(0, rise || 0) * CRAWL_PER, CRAWL_MIN, CRAWL_S);
// The world's speed, eased from where it is to a new target along a smooth step over `len` s (restarted when the target
// changes). E only: A to D keep their own easing (fast.js tick).
export class Ramp {
  constructor(v) { this.v = this.from = this.to = v; this.t = 0; this.len = 0; }
  step(to, dt, len) {
    if (to !== this.to) { this.from = this.v; this.to = to; this.t = 0; this.len = len; }
    this.t += dt; const k = this.len > 0 ? clamp(this.t / this.len, 0, 1) : 1;
    this.v = this.from + (this.to - this.from) * k * k * (3 - 2 * k); return this.v;
  }
}
// What a place off the ball is for, by the spot it came from (rules.js spotSet kinds), and its picture: an open hand (get
// open here), a shield (get goal-side or cover here), a foot (go to the ball: press their carrier or win the loose ball).
export const PLACE_KIND = { behind: 'open', open: 'open', wide: 'open', support: 'open', goalside: 'cover', mark: 'cover', lane: 'cover', cover: 'cover', press: 'press', ball: 'ball' };
export const PLACE_PIC = { open: '🖐', cover: '🛡', press: '🦶', ball: '🦶' };
export const OFF_MAX = 3, OFF_NEAR = 2.5, OFF_SEP = 3.2, PRESS_FAR = 14;
// Two or three places off the ball, of different kinds where it can be, from the spots the other variants use
// (rules.js spotSet, passed in as `spots`, best first by their score): his team's ball: places to get open (a run in
// behind first, then open grass, then support); theirs: press their carrier (when he is within PRESS_FAR m) and one or
// two places goal-side or covering; a loose ball: go for it, goal-side, open. None within OFF_NEAR m of him (STAY is that
// choice), none within OFF_SEP m of another. [] when there is nothing worth asking.
export function offChoices(spots, state, me) {
  const want = state === 'ours' ? ['behind', 'open', 'wide', 'support'] : state === 'theirs' ? ['press', 'goalside', 'mark', 'lane', 'cover'] : ['ball', 'goalside', 'open', 'cover'];
  const ok = p => dist(p, me) >= OFF_NEAR && !(p.kind === 'press' && dist(p, me) > PRESS_FAR); // (their carrier right by him: that is STEAL, not a run)
  const out = [], sorted = spots.filter(p => PLACE_KIND[p.kind] && ok(p)).sort((p, q) => (q.s ?? 0) - (p.s ?? 0));
  const add = p => { if (out.length < OFF_MAX && !out.includes(p) && out.every(q => dist(q, p) >= OFF_SEP)) out.push(p); };
  for (const k of want) { const p = sorted.find(q => q.kind === k && !out.some(o => PLACE_KIND[o.kind] === PLACE_KIND[k] && PLACE_KIND[k] !== 'open')); if (p) add(p); } // (one of each kind; places to get open may be two or three)
  for (const p of sorted) add(p);
  return out.map(p => ({ x: p.x, y: p.y, kind: PLACE_KIND[p.kind], from: p.kind, follow: p.follow || null }));
}
// Whether an off-ball decision point is due now. key: who has the ball ('ours:m1', 'theirs:o2', 'loose'; null while it
// is on its way, out of play, in a keeper's hands, or his own); seen: the key at his last off-ball point (or as he last
// had the ball); now, lastOff, lastEnd: real s (now; his last off-ball point opening; any point ending); ball, ballAt:
// the ball now and at his last off-ball point; toMe: a pass on its way to him.
export function offDue({ key, seen, now, lastOff, lastEnd, ball, ballAt, toMe }) {
  if (!key || toMe || now - lastOff < OFF_GAP || now - lastEnd < OFF_REAL) return false;
  if (key !== seen) return 'changed';
  if (now - lastOff >= STALE_S && ballAt && dist(ball, ballAt) >= STALE_M) return 'stale';
  return false;
}
