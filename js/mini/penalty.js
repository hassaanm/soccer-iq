// Penalties (v87; v93 a timing game) in the 3D world: mini/pens.js says what each kick does; this plays it, on the
// keeper game's machinery (game/goalie.js: its own sim, real-time waits, slow motion while he chooses, the camera). No
// page here: the tests and the bots drive it (tick, choose), and mini/pens-ui.js puts it on the page.
// He is `hero`, a few steps back and to the left of the ball on the spot; their keeper is k2, in our goal (x = 0, the
// 5v5 goal at every size: ui/goalie.js sizeGoal). One kick is one continuous motion: a moment to set (the keeper alive
// on his line), the run-up in slow motion (the six targets show; a tap turns his body and his eyes to that corner), the
// last moment (he plants, the ball flashes: a tap now cannot be read), the strike, the keeper's dive as it is struck,
// the ball in the net, in his hands or off the post, and then the result's word.
import { Goalie } from '../game/goalie.js';
import { PITCH, clamp, dist } from '../geom.js';
import { faceTo } from '../game/shared.js';
import { GOAL } from '../saves.js';
import { DIVE_LEN } from '../game/keeper.js';
import { PEN_X, TARGETS, target, kickOf, sideU, PEN_SAID, PEN_WHY, PEN_PIC } from './pens.js';

const NONE = [];
const K_X = .15;                    // the keeper's line (just off it, as ours: saves.js START)
const RUN_G = .72, FLASH_G = .2;    // game s: his run-up to the plant; the plant and swing to the strike (the last moment: pro/motion.js swings through the ball .2 s after the wind-up)
const START = { x: PEN_X + 2.2, y: -.9 }, PLANT = { x: .38, y: -.3 }; // where his run starts and where he plants, from the spot (y: across, + his right)
const SHOT_V = 16, SOFT_V = 8;      // m/s: the kick; no tap, a soft one
const READY = .5;                   // real s before the run-up: the keeper sets on his line
// The view: behind the ball and a little to its right, higher than his head, so the ball's flight is clear of his body
// and the goal with its targets fills the top half. eye: [m behind the spot, m to the side, height]; tgt: where it looks
// ([x, m across, height]); Ff: the lens, as a share of the picture's height.
export const VIEW = { eye: [5.2, .4, 2.3], tgt: [0, .1, -.7], Ff: 2.3 };
export const AFTER = { goal: 2.2, save: 2.7, post: 2.7 }; // real s the result stays before the next kick (a miss: its kind line shows after the big word: ui/hud.js)

export class Penalty extends Goalie {
  constructor(o) { super(o); this.kind = 'pens'; this.flash = false; }
  // The scene of one kick: the ball on the spot, him at the start of his run-up, the keeper in the middle of his goal.
  setup() {
    const cy = this.cy = PITCH.W / 2, s = this.sim;
    s.setup({ hero: [START.x, cy + START.y], mates: [], opps: [], gk: { them: [K_X, cy] }, carrier: 'hero' });
    s.restores++; // (every body starts afresh: pro/motion.js, pro/keeper.js)
    Object.assign(s.a('k2'), { face: [1, 0], gkm: null });
    faceTo(s.a('hero'), PEN_X, cy);
    s.ball = { x: PEN_X, y: cy, z: 0, state: 'loose', carrier: null, move: null, h: Math.PI, got: -9 };
    this.cam = { eye: [PEN_X + VIEW.eye[0], cy + VIEW.eye[1], VIEW.eye[2]], tgt: [VIEW.tgt[0], cy + VIEW.tgt[1], VIEW.tgt[2]], Ff: VIEW.Ff, Fw: 0 };
    this.flash = false; this.feint = null; this.alive = null;
  }
  // ---------- the keeper on his line ----------
  // Alive: a small shuffle now and then (never far: he is back in the middle, set, for the last moment). A feint (from
  // two goals): a quick step and a lean to one side and back, in the run-up. Neither says where he will go: he decides
  // as it is struck (mini/pens.js keeperGoes).
  keeperLife() {
    const s = this.sim, k = this.kick, K = s.a('k2'), cy = this.cy; if (!K || !k || K.gkm?.k === 'reach' || this.phase === 'flight') return;
    if (this.feint) { const f = this.feint; if (!f.back && s.time >= f.back0) { f.back = true; K.gkm = null; s.go('k2', K_X, cy, 1.8); } if (s.time >= f.end) this.feint = null; return; }
    if (this.flash) return;
    const a = this.alive ||= { next: s.time + .15, n: 0, u: 0 }, r = (x => x - Math.floor(x))((k.u.alive + 1) * (a.n + 1) * 7.31);
    if (this.phase === 'aim' && k.fake && !k.feintDone && (s.time - this.win.t0) / RUN_G >= k.fakeAt) { // the feint
      k.feintDone = true; const sg = sideU(k.fake);
      s.go('k2', K_X, cy + sg * .65, 3.2);
      K.gkm = { k: 'dive', guess: true, pre: .22, t0: s.time + .3, dur: .45, side: sg, low: true, high: false, save: false, keep: false }; // (pro/keeper.js: a lean that way before a dive; called off before it starts)
      this.feint = { back0: s.time + .26, end: s.time + .5, back: false };
      return;
    }
    if (s.time < a.next) return;
    a.n++; a.u = (a.u > 0 ? -1 : 1) * (.08 + .16 * r); a.next = s.time + .28 + .3 * r;
    s.go('k2', K_X, cy + a.u, 1.1);
  }
  gameStep(dt) {
    const s = this.sim, k = s.a('k2'), m = k?.gkm;
    this.keeperLife();
    if (m && m.body) { // his dive (pro/keeper.js draws it from k.gkm, as for the match keepers)
      if (!m.went && s.time >= m.t0) { m.went = true; s.go('k2', m.body.x, m.body.y, m.spd); }
      if (s.time > m.t0 + m.dur + (m.k === 'dive' ? 1.1 : .5)) { k.gkm = null; s.stop('k2'); }
    }
    s.step(dt);
    if (k) k.face = [1, 0];
    this.hips();
  }
  // His body as he runs up: once he has picked a target, his hips and chest open toward it over a moment (the tell the
  // keeper reads; the eyes over his head show it too: ui.tell).
  hips() {
    const h = this.sim.a('hero'); if (!h || this.phase !== 'aim' || this.flash || !this.pick) return;
    const T = target(this.pick), open = clamp((this.real - this.pickReal) / .35, 0, 1) * .6, run = Math.atan2(this.cy + PLANT.y - h.y, PEN_X + PLANT.x - h.x);
    const to = Math.atan2(this.cy + T.u - h.y, -h.x), d = Math.atan2(Math.sin(to - run), Math.cos(to - run)), a = run + d * open;
    h.face = [Math.cos(a), Math.sin(a)];
  }

  // ---------- a run ----------
  // Kicks one after another, each from next(i) (mini/pens.js penKick), until next gives none (his second miss:
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
  // One kick. Resolves { ...pens.js kickOf, tap (the target he picked, or null), when ('early' | 'late' | null), shown
  // (real s his pick showed before the kick), kick, sec (when he tapped, real s from the run-up's start; -1: no tap) }.
  async kickOne(k, { hint = false } = {}) {
    this.setup(); this.kick = { ...k }; this.hint = hint; this.pick = null; this.pickReal = 0; this.pickWhen = null; this.result = null; this.spec = this.kick;
    Object.assign(this.ui, { spots: NONE, aims: NONE, lines: NONE, timer: null, heroRing: false, tell: null, pick: null, hand: null, ballGlow: false });
    this.slow = 1; this.slowV = 0; this.win = null; this.phase = 'ready';
    await this.wait(READY);
    // The run-up: the targets show, he runs in (slow motion: it lasts the level's `run` real s).
    const s = this.sim, cy = this.cy, h = s.a('hero'), plant = { x: PEN_X + PLANT.x, y: cy + PLANT.y };
    this.ui.aims = TARGETS.map(id => this.w({ x: -.05, u: target(id).u }, target(id).z));
    this.phase = 'aim'; this.win = { t0: s.time, T: RUN_G, real: k.run }; this.aimAt0 = this.real; this.slow = RUN_G / k.run;
    s.go('hero', plant.x, plant.y, dist(h, plant) / RUN_G);
    await this.wait(99, () => s.time - this.win.t0 >= RUN_G);
    // The last moment: he plants and swings; the ball flashes; the keeper sets in the middle of his goal.
    this.flash = true; this.ui.ballGlow = true; this.world.fx?.('skill'); this.feint = null; if (s.a('k2')?.gkm?.guess) s.a('k2').gkm = null;
    s.stop('hero'); this.aimFoot(); s.windup('hero', 'shot', null); s.go('k2', K_X, cy, 1.6);
    this.win = { t0: s.time, T: FLASH_G, real: k.late };
    await this.wait(99, () => s.time - this.win.t0 >= FLASH_G);
    // The kick: the keeper decides now (mini/pens.js), and goes as it is struck.
    this.win = null; this.flash = false; this.phase = 'flight'; this.ui.aims = NONE; this.ui.ballGlow = false; this.ui.hand = null;
    const when = this.pick ? this.pickWhen : null, shown = this.pick ? this.real - this.pickReal : 0, r = kickOf(this.kick, this.pick, when || 'late', shown);
    this.result = { ...r, tap: this.pick, when, shown, kick: this.kick, sec: this.pick ? this.tapSec : -1 };
    this.aimFoot();
    const arrive = this.strike(this.kick, r);
    await this.wait(99, () => s.time >= arrive);
    if (r.res === 'goal') this.scored(r); else if (r.res === 'post') this.offPost(r); else this.stopped(r);
    this.onResult?.(this.result);
    await this.wait(AFTER[r.res]);
    this.hud.caption?.('');
    this.ui.tell = null;
    return this.result;
  }
  // He faces the way he will kick (his standing foot points there): the target he picked, or the middle.
  aimFoot() { const h = this.sim.a('hero'); faceTo(h, PEN_X - 1, this.cy + (this.pick ? target(this.pick).u * .3 : 0)); }

  // ---------- his taps ----------
  // choose('aim:TL'): a target while he runs up or plants. He can change his mind until the kick; the last tap counts,
  // and its time is when he picked that target (a tap on the one he already has changes nothing).
  choose(opt) {
    const [kind, id] = String(opt).split(':');
    if (kind !== 'aim' || this.phase !== 'aim' || !TARGETS.includes(id)) return false;
    if (id === this.pick) return true;
    this.pick = id; this.pickReal = this.real; this.pickWhen = this.flash ? 'late' : 'early'; this.tapSec = this.real - this.aimAt0; this.ui.pick = id; this.sfx('click');
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
  // The ball goes where he aimed: into the net, into the keeper's hands, or onto the post. The keeper goes the way he
  // decided as it is struck (r.dive): his hands on the ball when he gets there, just short of it when it beats him the
  // way he went, the other way when he went wrong; a ball at the middle he takes with a step and his hands. Returns the
  // game time the ball gets to him, the line or the post.
  strike(k, r) {
    const s = this.sim, K = s.a('k2'), cy = this.cy, Z = target(r.zone), save = r.res === 'save', post = r.res === 'post', soft = r.why === 'none';
    const speed = soft ? SOFT_V : SHOT_V + (Z.top ? 1 : 0), arc = Z.top ? .12 : .06;
    const hx = post ? .03 : save ? Math.max(.38, K.x + .25) : -.6, f = (PEN_X - hx) / PEN_X;
    const y = post ? cy + Math.sign(Z.u) * (GOAL.half - .14) : cy + Z.u * f, z = post ? 1.25 : Z.top ? Z.z * f + .05 : Math.max(.2, Z.z * f);
    const lift = (zz, ff) => { const u = 1 - Math.pow(1 - clamp(ff, .05, 1), 2 / 3); return Math.max(0, (zz - arc * 4 * u * (1 - u)) / u); };
    const b = s.ball; b.carrier = null; b.state = 'loose'; s.kick(hx, y, { speed, arc, z1: lift(z, 1) });
    const tLine = Math.max(.2, Math.hypot(PEN_X - hx, cy - y) / speed);
    // His hands: on the ball (a save); just short of it (the right way, beaten); toward the corner he went for (wrong).
    const mid = r.dive === 'M', sg = sideU(r.dive), toBall = { x: Math.max(.3, hx), y, z };
    let hand;
    if (save) hand = toBall;
    else if (mid) hand = { x: K_X + .2, y: cy + Math.sign(y - cy) * .55, z: Math.min(z, 1.1) };
    else if (sg === Math.sign(Z.u)) { const d = y - cy; hand = { x: K_X + .15, y: cy + d - Math.sign(d) * .45, z: Z.top ? Math.min(z, 1.45) : .35 }; }
    else hand = { x: K_X + .1, y: cy + sg * (GOAL.half - .7), z: Z.top ? 1.2 : .4 };
    const reach = mid || (save && Math.abs(hand.y - K.y) < .9);
    const lo = cy - GOAL.half + DIVE_LEN, hi = cy + GOAL.half - DIVE_LEN, d = dist(K, hand) || .01;
    const mv = reach ? Math.max(0, d - .55) : Math.max(Math.min(d, .3), d - .95);
    const body = { x: K.x + (hand.x - K.x) / d * mv, y: K.y + (hand.y - K.y) / d * mv }; if (!reach) body.y = sg > 0 ? Math.min(body.y, Math.max(K.y, hi)) : Math.max(body.y, Math.min(K.y, lo));
    const go = r.read ? .01 : .04, dur = Math.max(.2, tLine - go), side = reach ? Math.sign(hand.y - K.y) || 1 : sg || 1;
    K.gkm = { k: reach ? 'reach' : 'dive', guess: false, pre: .1, t0: s.time + go, dur, side, hand: { x: hand.x, y: hand.y }, hz: hand.z, low: hand.z < .8, high: !reach && hand.z > .9,
      save, keep: save && (reach || !Z.top), body, spd: Math.max(1, dist(K, body) / dur) };
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
  // Saved: in his hands (he holds it), or pushed away round the post; a kind word with a picture of why.
  stopped(r) {
    const s = this.sim, b = s.ball, K = s.a('k2');
    if (K.gkm?.keep) Object.assign(b, { state: 'held', carrier: 'k2', move: null });
    else { b.carrier = 'k2'; s.kick(clamp(b.x + 2, .5, 4), this.cy + (Math.sign(b.y - this.cy) || 1) * (GOAL.half + 1.2), { speed: 5.5, arc: .5, touch: true }); b.carrier = null; }
    this.sfx('tap'); this.world.fx?.('held');
    this.hud.banner?.('SAVED!', 'soft'); this.why(r);
  }
  // A top corner in the very last moment: it hits the post and goes wide.
  offPost(r) {
    const s = this.sim, b = s.ball, sg = Math.sign(b.y - this.cy) || 1;
    b.carrier = null; s.kick(3.2, this.cy + sg * (GOAL.half + 2.6), { speed: 6, arc: .45, touch: true });
    this.sfx('kick'); this.world.fx?.('kept');
    this.hud.banner?.('POST!', 'soft'); this.why(r);
  }
  why(r) { const line = PEN_WHY[r.why] || PEN_WHY.guess; this.hud.caption?.(line + ' ' + (PEN_PIC[r.why] || '')); this.say(line); }

  // ---------- each frame: the highlights ----------
  // His eyes over his head (mini/pens-ui.js draws them in the 3D scene) look at the target he picked, from his tap to
  // the result; the ball glows in the last moment (ui.ballGlow, set above); on his very first kick a hand points at a
  // corner in the last moment.
  frame() {
    const s = this.sim, ui = this.ui, h = s.a('hero');
    ui.timer = null; ui.heroRing = false; ui.lines = NONE; ui.ghost = false;
    ui.tell = this.pick && h && this.phase !== 'ready' ? { x: h.x, y: h.y, dx: sideU(target(this.pick).col), dy: target(this.pick).top ? -1 : .8, top: target(this.pick).top, id: this.pick } : null;
    ui.hand = this.hint && this.flash && !this.pick ? this.w({ x: 0, u: target('R').u }, target('R').z) : null;
  }
}
