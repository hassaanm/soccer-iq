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

export const DEC_SLOW = .12, DEC_MAX = 6, DEC_UP = 1.5, RING_S = 5, RING_MIN = 3.5, RING_STEP = .1;
export const VARIANTS = {
  A: { slow: DEC_SLOW, big: true, auto: true },
  B: { slow: DEC_SLOW, big: false, auto: false },
  C: { slow: null, big: true, auto: true },
  D: { stop: true, big: true, auto: true },
};
export const VARIANT_IDS = Object.keys(VARIANTS);
export const variantOf = settings => (VARIANTS[settings?.liveVariant] ? settings.liveVariant : 'A');

// The decision moment's clock, in real seconds (now: the controller's real clock).
export class Decision {
  constructor(id = 'A') { this.id = VARIANTS[id] ? id : 'A'; this.v = VARIANTS[this.id]; this.on = false; this.n = 0; this.spent = false; }
  open(now, up) { this.on = true; this.t0 = now; this.clock = up ? now : null; this.spent = false; this.len = this.v.stop ? Math.max(RING_MIN, RING_S - RING_STEP * this.n) : DEC_MAX; }
  // he chose: the moment ends (a new one may open when he next has the ball and stands with it)
  close(chose = true) { if (this.on && chose) this.n++; this.on = false; this.spent = !chose; }
  reset() { this.on = false; this.spent = false; }
  tick(now, up) { if (this.on && this.clock == null && (up || now - this.t0 >= DEC_UP)) this.clock = now; }
  // the time scale the moment wants (of real time), or null: none
  scale() { if (!this.on) return null; if (this.v.stop) return 0; return this.v.slow ?? null; }
  // how much of the ring is left, 1 … 0 (before the clock starts: full)
  left(now) { if (!this.on) return 0; if (this.clock == null) return 1; return clamp(1 - (now - this.clock) / this.len, 0, 1); }
  // the moment ran out: A and B ease back to speed, D: they take it. C has no clock.
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
