// Penalties (v87) in the 3D world: mini/pens.js says what each kick does; this plays it, on the keeper game's machinery
// (game/goalie.js: its own sim, real-time waits, slow motion while he chooses, the camera). No page here: the tests and
// the bots drive it (tick, choose), and mini/pens-ui.js puts it on the page.
// He is `hero`, behind the ball on the spot; their keeper is k2, in our goal (x = 0, the 5v5 goal at every size: ui/goalie.js
// sizeGoal). Each kick: a moment to set, then the window: the six targets show, the keeper steps to his side (the tell)
// while he walks up to the ball in slow motion, and he taps a target (the last tap counts); then the kick at full speed,
// the keeper's dive to his side, and the ball where he aimed.
import { Goalie } from '../game/goalie.js';
import { PITCH, clamp, dist } from '../geom.js';
import { faceTo } from '../game/shared.js';
import { GOAL } from '../saves.js';
import { DIVE_LEN } from '../game/keeper.js';
import { PEN_X, TARGETS, target, tellSteps, kickOf, sideU, other, PEN_SAID, PEN_WHY } from './pens.js';

const NONE = [];
const K_X = .15;                    // the keeper's line (just off it, as ours: saves.js START)
const RUN_T = .9;                   // game s: the window, in the game's time (slow motion: it lasts the level's `win` real s)
const RUN_AT = .5, WIND = .86;     // the share of the window when he sets off for the ball, and when he winds up (the kick at its end)
const SHOT_V = 15;                  // m/s: the kick
// The view: behind the ball, a little higher than his head, the goal in the top part of the picture with its targets
// large; the ball at the bottom, his run-up from the left. eye: [m behind the spot, m to the side, height]; tgt: where it looks
// ([x, m across, height]); Ff: the lens, as a share of the picture's height.
export const VIEW = { eye: [4.4, .3, 2], tgt: [0, 0, -.1], Ff: 2 };
export const AFTER = { goal: 2.6, save: 2.4 }; // real s the result stays before the next kick

export class Penalty extends Goalie {
  constructor(o) { super(o); this.kind = 'pens'; this.moves = []; }
  // The scene of one kick: the ball on the spot, him a few steps behind it, the keeper in the middle of his goal.
  setup() {
    const cy = this.cy = PITCH.W / 2, s = this.sim;
    s.setup({ hero: [PEN_X + 1.05, cy - .95], mates: [], opps: [], gk: { them: [K_X, cy] }, carrier: 'hero' }); // (his run-up from the left: he stands low on the left of the picture, clear of the goal)
    s.restores++; // (every body starts afresh: pro/motion.js, pro/keeper.js)
    Object.assign(s.a('k2'), { face: [1, 0], gkm: null });
    faceTo(s.a('hero'), PEN_X, cy);
    s.ball = { x: PEN_X, y: cy, z: 0, state: 'loose', carrier: null, move: null, h: Math.PI, got: -9 };
    this.cam = { eye: [PEN_X + VIEW.eye[0], cy + VIEW.eye[1], VIEW.eye[2]], tgt: [VIEW.tgt[0], cy + VIEW.tgt[1], VIEW.tgt[2]], Ff: VIEW.Ff, Fw: 0 };
    this.moves = [];
  }
  gameStep(dt) {
    const s = this.sim, k = s.a('k2'), m = k?.gkm;
    for (const mv of this.moves) if (!mv.done && s.time >= mv.t) { mv.done = true; s.go('k2', K_X, this.cy + mv.u, mv.spd); } // (his steps: the tell)
    if (m) { // his dive (pro/keeper.js draws it from k.gkm, as for the match keepers)
      if (m.body && !m.went && s.time >= m.t0) { m.went = true; s.go('k2', m.body.x, m.body.y, m.spd); }
      if (s.time > m.t0 + m.dur + (m.k === 'dive' ? 1.1 : .5)) { k.gkm = null; s.stop('k2'); }
    }
    s.step(dt);
    if (k) k.face = [1, 0];
  }

  // ---------- a run ----------
  // Kicks one after another, each from next(i) (mini/pens.js penKick), until next gives none (his second kick saved:
  // mini/rules.js). onKick(result, i) as each result happens. Resolves the results.
  async endless(next, { onKick, first = false } = {}) {
    this.on = true; this.results = [];
    try {
      for (let i = 0; ; i++) {
        const k = next(i); if (!k) break;
        this.onResult = r => onKick?.(r, i);
        this.results.push(await this.kickOne(k, { hint: first && i === 0 }));
      }
    } finally { this.onResult = null; }
    this.phase = 'idle';
    return this.results;
  }
  // One kick. Resolves { ...pens.js kickOf, tap (the target he picked, or null), kick, sec (when he tapped, real s
  // from the targets showing; -1: no tap) }.
  async kickOne(k, { hint = false } = {}) {
    this.setup(); this.kick = k; this.hint = hint; this.pick = null; this.result = null; this.spec = k;
    Object.assign(this.ui, { spots: NONE, aims: NONE, lines: NONE, timer: null, heroRing: true, tell: null, pick: null, hand: null });
    this.slow = 1; this.slowV = 0; this.win = null; this.phase = 'ready';
    await this.wait(.9);
    // The window: the targets show, he walks up to the ball, the keeper shows his side.
    const s = this.sim, cy = this.cy, T = RUN_T, h = s.a('hero'), plant = { x: PEN_X + .4, y: cy - .3 };
    this.ui.aims = TARGETS.map(id => this.w({ x: -.05, u: target(id).u }, target(id).z));
    this.phase = 'aim'; this.win = { t0: s.time, T, real: k.win }; this.aimAt0 = this.real; this.slow = T / k.win;
    const steps = tellSteps(k); let from = 0;
    for (const st of steps) { this.moves.push({ t: s.time + st.f * T, u: st.u, spd: Math.max(.5, Math.abs(st.u - from) / (k.stepT * T)), side: st.side }); from = st.u; }
    // His lean into his dive (pro/keeper.js: a guess leans before the kick), from his last step on.
    const last = steps.at(-1), tKick = s.time + T, lean = { k: 'dive', guess: true, pre: Math.max(.08, Math.min(.3, (1 - last.f) * T * .8)), t0: tKick + .02, dur: .45, side: sideU(k.side), low: true, high: false, save: false, keep: false };
    this.leanAt = s.time + last.f * T; this.lean = lean;
    // He waits, as a penalty taker waits for the keeper (and stands clear of the goal in the picture), then runs in at
    // the end of the window: RUN_AT to WIND, the wind-up, the kick.
    const lean0 = () => { if (this.leanAt != null && s.time >= this.leanAt) { s.a('k2').gkm = this.lean; this.leanAt = null; } };
    await this.wait(99, () => { lean0(); return s.time - this.win.t0 >= T * RUN_AT; });
    s.go('hero', plant.x, plant.y, dist(h, plant) / (T * (WIND - RUN_AT)));
    await this.wait(99, () => { lean0(); return s.time - this.win.t0 >= T * WIND; });
    faceTo(h, PEN_X - 1, cy + (this.pick ? target(this.pick).u * .3 : 0)); s.stop('hero'); s.windup('hero', 'shot', null);
    await this.wait(99, () => { if (this.leanAt != null && s.time >= this.leanAt) { s.a('k2').gkm = this.lean; this.leanAt = null; } return s.time - this.win.t0 >= T; });
    // The kick.
    this.win = null; this.phase = 'flight'; this.ui.aims = NONE; this.ui.timer = null; this.ui.tell = null; this.ui.lines = NONE; this.ui.hand = null;
    if (this.leanAt != null) { s.a('k2').gkm = this.lean; this.leanAt = null; }
    const r = kickOf(k, this.pick);
    this.result = { ...r, tap: this.pick, kick: k, sec: this.pick ? this.tapSec : -1 };
    const arrive = this.strike(k, r);
    await this.wait(99, () => s.time >= arrive);
    if (r.res === 'goal') this.scored(r); else this.stopped(r);
    this.onResult?.(this.result);
    await this.wait(AFTER[r.res]);
    this.hud.caption?.('');
    return this.result;
  }

  // ---------- his taps ----------
  // choose('aim:TL'): a target while the window is open. He can change his mind until the kick; the last tap counts.
  choose(opt) {
    const [kind, id] = String(opt).split(':');
    if (kind !== 'aim' || this.phase !== 'aim' || !TARGETS.includes(id)) return false;
    this.pick = id; this.tapSec = this.real - this.aimAt0; this.ui.pick = id; this.sfx('click');
    return true;
  }
  // A tap on the screen (CSS px): the nearest target, within reach of a finger.
  tapAt(x, y) {
    if (this.phase !== 'aim') return false;
    let best = null, bd = 110;
    this.ui.aims.forEach((p, i) => { const q = this.world.project(p.x, p.y, p.z || 0); if (!q) return; const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = i; } });
    return best != null && this.choose('aim:' + TARGETS[best]);
  }

  // ---------- the kick ----------
  // The ball goes where he aimed: past the keeper into the net, or to the keeper's hands (his side), or at his body (the
  // middle). The keeper dives to his side whatever happens (he chose before the kick); a ball down the middle he stops
  // with a step back and his hands. Returns the game time the ball gets to him or the line.
  strike(k, r) {
    const s = this.sim, b = s.ball, K = s.a('k2'), cy = this.cy, Z = target(r.zone), save = r.res === 'save', mid = r.why !== 'side' && save;
    const hx = save ? Math.max(.35, K.x + .3) : -.6, f = (PEN_X - hx) / PEN_X, y = cy + Z.u * f;
    const z = Z.top ? Z.z * f + .05 : Math.max(.2, Z.z * f), arc = Z.top ? .12 : .06, speed = r.why === 'late' ? 9 : SHOT_V;
    const lift = (zz, ff) => { const u = 1 - Math.pow(1 - clamp(ff, .05, 1), 2 / 3); return Math.max(0, (zz - arc * 4 * u * (1 - u)) / u); };
    b.carrier = null; b.state = 'loose'; s.kick(hx, y, { speed, arc, z1: lift(z, 1) });
    const tLine = Math.max(.2, Math.hypot(PEN_X - hx, cy - y) / speed);
    // His dive: to his side (his hands on the ball when it goes there), or a step back to the middle for one at him.
    const side = sideU(k.side), hand = save ? { x: hx, y, z } : { x: K_X + .1, y: cy + side * (GOAL.half - .7), z: Z.top ? 1.2 : .4 };
    const lo = cy - GOAL.half + DIVE_LEN, hi = cy + GOAL.half - DIVE_LEN, d = dist(K, hand) || .01;
    const mv = mid ? Math.max(0, d - .55) : Math.max(Math.min(d, .3), d - .95);
    let body = { x: K.x + (hand.x - K.x) / d * mv, y: K.y + (hand.y - K.y) / d * mv }; if (!mid) body.y = side > 0 ? Math.min(body.y, Math.max(K.y, hi)) : Math.max(body.y, Math.min(K.y, lo));
    const go = .03, dur = Math.max(.2, tLine - go);
    K.gkm = { k: mid ? 'reach' : 'dive', guess: !mid, pre: this.lean?.pre || .2, t0: s.time + go, dur, side: mid ? Math.sign(y - K.y) || side : side, hand: { x: hand.x, y: hand.y }, hz: z, low: z < .8, high: !mid && z > .9,
      save, keep: save && (mid || !Z.top), body, spd: Math.max(1, dist(K, body) / dur) };
    s.stop('k2');
    this.ballTo = { x: hx, y, z };
    return s.time + Math.max(.2, Math.hypot(hx - PEN_X, y - cy) / speed);
  }
  // In: the net bulges, our fans cheer, he celebrates.
  scored() {
    this.world.fx?.('goal'); this.sfx('net');
    this.hud.banner?.('GOAL!', 'goal'); this.say(PEN_SAID.goal);
    const h = this.sim.a('hero'); this.hud.pop?.(3, () => this.world.project?.(h.x, h.y, 1.9));
  }
  // Saved: in his hands (he holds it), or pushed away round the post; a kind word about what to look at.
  stopped(r) {
    const s = this.sim, b = s.ball, K = s.a('k2');
    if (K.gkm?.keep) Object.assign(b, { state: 'held', carrier: 'k2', move: null });
    else { b.carrier = 'k2'; s.kick(clamp(b.x + 2, .5, 4), this.cy + sideU(this.kick.side) * (GOAL.half + 1.2), { speed: 5.5, arc: .5, touch: true }); b.carrier = null; }
    this.sfx('tap'); this.world.fx?.('held');
    this.hud.banner?.('SAVED!', 'soft');
    const line = PEN_WHY[r.why] || PEN_WHY.side; this.hud.caption?.(line + (r.why === 'late' ? ' 👆' : ' 👀')); this.say(line);
  }

  // ---------- each frame: the highlights ----------
  // The ring at his feet drains with the window; the keeper's eyes (drawn over his head by mini/pens-ui.js) look to his
  // side after each step, for a while; on the first kicks a gold arrow on the grass points the way he goes.
  frame() {
    const s = this.sim, w = this.win, ui = this.ui, K = s.a('k2'), k = this.kick;
    ui.timer = w ? { left: clamp(1 - (s.time - w.t0) / w.T, 0, 1), wide: false, scale: .55 } : null;
    ui.heroRing = this.phase === 'ready'; ui.tell = null; ui.lines = NONE; ui.hand = null; ui.ghost = false;
    if (!w || !k || !K) return;
    const f = (s.time - w.t0) / w.T; let st = null; for (const m of this.moves) if (m.done) st = m;
    if (st) {
      if (st.at0 == null) st.at0 = this.ui.clock;
      const age = this.ui.clock - st.at0, a = k.eyes >= 99 ? 1 : clamp(k.eyes - age, 0, 1);
      // (v88) his eyes sit on the crossbar over his head, clear of the top-middle target; the arrow lies on the grass a
      // little in front of the goal line, long enough to see from the spot
      if (a > 0) ui.tell = { x: K.x, y: K.y, z: GOAL.gh, dx: sideU(st.side), dy: .7, big: k.big, alpha: a, side: st.side };
      if (k.arrow && st.side === k.side) { const u = sideU(st.side); ui.lines = [{ a: { x: K.x + 1, y: K.y + u * .2 }, b: { x: K.x + 1, y: K.y + u * 2.3 }, color: '#ffd23f' }]; }
    }
    // The teaching hand (his very first kick): over a target on the side the keeper leaves, once the keeper has shown it.
    if (this.hint && st && this.pick == null && f > k.at + .05) { const Z = target(other(k.side)); ui.hand = this.w({ x: 0, u: Z.u }, Z.z); }
  }
}
