// The keeper game (v67) in the 3D world. saves.js says what each shot does; this plays it: its own small sim, camera and
// highlights, which main.js draws in place of the game's while a round is on (`on`). No page here: the tests drive it as
// they drive the game (tick, choose), and ui/goalie.js puts it on the page.
// He is `hero`, in goal (a keeper's body: pro/keeper.js); the shooter is o1, with a friend of each side about for life.
// Each shot: the run-up in slow motion while he picks where to stand (the gold spots, a ring draining at his feet), then
// the plant and the wind-up in slower motion while he picks where to dive (the six targets in his goal), then the kick
// at full speed: his dive, the ball where the shooter aimed, and his hands on it only if he could reach it.
import { Sim } from '../sim.js';
import { PITCH, clamp, dist } from '../geom.js';
import { GK } from '../shot.js';
import { ZONES, zoneAt, spotsFor, saveOf, tellOf, START, GOAL, SAVED, WHY } from '../saves.js';
import { faceTo } from './shared.js';
import { DIVE_LEN } from './keeper.js';

const STEP = 1 / 480; // game seconds per sim step (as game/skill.js): the same play at any frame rate
const NONE = [];
// The view: behind his goal and above it, looking out at the shooter, the frame round him. EYE: metres behind the line
// and eye height; LOOK: where it looks (metres out, height); FF: the focal length as a share of the screen's height.
// From up there the shooter stands above the crossbar in the picture and the six targets fill the goal mouth.
const EYE = [5.8, 4.5], LOOK = [5.5, 0], FF = 1.45; // (just inside the stadium's wall, high: the shooter stands clear above the bar from 5 m out)
const SIDE_STEP = 3.6;            // m/s: his side-step to the spot he chose (a quick shuffle)
const SPOT = .78;                  // the gold spots a little smaller than in matches, so three fit apart across the goal
const RUN = { in: 3.2, las: 3.9 }, DRIBBLE = 4.3; // the shooter's run-up (m/s), and a 1v1's dribble
const PLANT = .45, WIND = .2;      // game s: his last stride and plant, then the wind-up to the kick
const REACT = .05;                 // game s: he chose before the kick, so he goes as it is struck
const LIE = 1.1;                   // game s after his hands reach the ball that he stays down (then gets up: pro/keeper.js)
export const AFTER = { save: 2.3, goal: 2.6 }; // real s the result stays before the next shot

export class Goalie {
  constructor({ world, hud, say = () => null, sfx = () => {} }) {
    Object.assign(this, { world, hud, say, sfx, on: false, sim: new Sim(), jobs: [], slow: 1, slowV: 0, clock: 0 });
    this.sim.on = (ev, v) => { sfx(ev === 'kick' ? (v >= 15 ? 'shot' : 'kick') : ev === 'touch' ? 'tap' : 'step'); if (ev !== 'step') world.fx?.(ev, v); };
    this.ui = { glow: {}, arrows: {}, spots: NONE, spotScale: NONE, aims: NONE, lines: NONE, heroRing: false, timer: null, clock: 0, turnArrows: NONE, tell: null, pick: null };
    this.cam = { eye: [-EYE[0], 10, EYE[1]], tgt: [LOOK[0], 10, LOOK[1]], Ff: FF, Fw: 0 };
    this.phase = 'idle'; this.onFrame = null;
  }
  // From the goal's frame (x out from the line, u across) to the pitch, and back.
  w(p, z) { const q = { x: p.x, y: this.cy + p.u }; if (z != null) q.z = z; return q; }
  local(p) { return { x: p.x, u: p.y - this.cy }; }

  // ---------- time ----------
  // A wait on real time (the picture's: the result's words, the gaps between shots), or until `f` is true.
  wait(sec, f = null) { return new Promise(res => this.jobs.push({ t: 0, sec, f, res })); }
  // One frame. Real-time waits first, then game time in small even steps at the speed of play: slow while he chooses
  // (each window's own pace, so its play takes the window's real time), eased back to full speed after.
  tick(dt) {
    for (const j of this.jobs.splice(0)) { j.t += dt; if (j.t >= j.sec || j.f?.()) j.res(); else this.jobs.push(j); }
    if (!this.on) return;
    const w = this.win, want = w ? w.T / w.real : 1;
    const st = .14, k = 2 / st, e = k * dt, d = 1 / (1 + e + .48 * e * e + .235 * e * e * e), c = this.slow - want, q = (this.slowV + k * c) * dt;
    this.slowV = (this.slowV - k * q) * d; this.slow = clamp(want + (c + q) * d, .02, 1);
    this.acc = Math.min(.25, (this.acc || 0) + dt * this.slow);
    while (this.acc >= STEP) { this.acc -= STEP; this.gameStep(STEP); }
    this.ui.clock += dt * Math.max(this.slow, .35);
    this.frame();
    this.onFrame?.(this);
  }
  gameStep(dt) {
    const s = this.sim, k = s.a('hero');
    const m = k?.gkm;
    if (m) { // his dive: he sets off at t0 (game/keeper.js keeperMotion does the same for the match keepers)
      if (m.body && !m.went && s.time >= m.t0) { m.went = true; s.go('hero', m.body.x, m.body.y, m.spd); }
      if (s.time > m.t0 + m.dur + (m.k === 'dive' ? LIE : .5)) { k.gkm = null; s.stop('hero'); }
    }
    s.step(dt);
    if (k) k.face = [1, 0]; // (he faces out of his goal: the picture turns his head to the ball)
  }

  // ---------- a round ----------
  // Plays the shots of `plan` (saves.js roundPlan); after each, onShot(result, i). Resolves the results.
  async round(plan, { onShot, first = false } = {}) {
    this.on = true; this.results = [];
    this.hud.dots?.([], plan.length);
    for (const [i, spec] of plan.entries()) {
      const r = await this.shot(spec, { hint: first && i === 0 });
      this.results.push(r); this.hud.dots?.(this.results.map(x => x.res === 'save'), plan.length);
      onShot?.(r, i);
    }
    this.phase = 'idle';
    return this.results;
  }
  // The scene of one shot: him in the middle of his goal on the line, the shooter at the start of his run with the ball,
  // a friend coming across (too late to help) and one of theirs following the play.
  setup(spec) {
    this.cy = PITCH.W / 2;
    const side = Math.sign(spec.from.u) || 1, f = spec.from, st = spec.start;
    const pen = spec.kind === 'pen', v = spec.kind === '1v1';
    const mate = pen ? { x: 9.5, u: -2.2 } : v ? { x: st.x + 1.6, u: st.u - side * 1.2 } : { x: f.x + 2.6, u: f.u - side * 3 };
    const them = pen ? { x: 9.5, u: 2.4 } : { x: st.x + 4.5, u: -st.u * .4 };
    const P = q => { const p = this.w(q); return [p.x, p.y]; };
    this.sim.setup({ hero: P(START), mates: [P(mate)], opps: [P(st), P(them)], carrier: 'o1' });
    this.sim.restores++; // (every body starts afresh: pro/motion.js, pro/keeper.js)
    const k = this.sim.a('hero'); Object.assign(k, { gk: true, face: [1, 0] });
    const o = this.sim.a('o1'), b = this.sim.ball; faceTo(o, 0, this.cy); b.h = Math.atan2(o.face[1], o.face[0]); b.x = o.x + o.face[0] * .4; b.y = o.y + o.face[1] * .4;
    for (const id of ['m1', 'o2']) faceTo(this.sim.a(id), f.x, this.cy + f.u);
    // The view looks a little toward the side the shot comes from, so the shooter is never at the edge.
    this.cam = { eye: [-EYE[0], this.cy + f.u * .12, EYE[1]], tgt: [LOOK[0], this.cy + f.u * .3, LOOK[1]], Ff: FF, Fw: 0 };
  }
  // One shot. Resolves { ...saves.js saveOf, spot (the one he tapped, or null), tap, spec }.
  async shot(spec, { hint = false } = {}) {
    const s = this.sim;
    this.setup(spec); this.spec = spec; this.pickSpot = null; this.pickZone = null; this.result = null; this.hint = hint;
    Object.assign(this.ui, { spots: NONE, aims: NONE, lines: NONE, timer: null, heroRing: true, tell: null, pick: null });
    this.slow = 1; this.slowV = 0; this.win = null; this.phase = 'ready';
    await this.wait(.8);
    // The run-up: he picks where to stand.
    const spots = this.spots = spotsFor(spec), o = s.a('o1'), dir = this.aimDir(spec);
    const plant = this.w({ x: spec.from.x - dir.x * .42, u: spec.from.u - dir.u * .42 });
    const v = spec.kind === '1v1' ? DRIBBLE : RUN[spec.foot], T = dist(o, plant) / v;
    this.ui.spots = spots.map(p => this.w(p)); this.ui.spotScale = spots.map(() => SPOT);
    this.phase = 'stand'; this.win = { t0: s.time, T, real: spec.stand }; this.slow = T / spec.stand; // (he is standing still as it starts: the slow motion is there at once)
    s.go('o1', plant.x, plant.y, v);
    if (spec.kind !== 'pen') for (const id of ['m1', 'o2']) { const a = s.a(id); s.go(id, a.x - (a.x - plant.x) * .25, a.y - (a.y - plant.y) * .15, 2.4); } // (they come in too, slower)
    await this.wait(99, () => dist(o, plant) < .06 || s.time - this.win.t0 > T + .5);
    // The plant and the wind-up: he picks where to dive. The shooter turns to where he will shoot (his body, his
    // standing foot) and looks at it (tells).
    s.stop('o1'); for (const id of ['m1', 'o2']) s.stop(id);
    const aim = this.w({ x: 0, u: zoneAt(spec.zone).u }); faceTo(o, aim.x, aim.y);
    this.ui.spots = NONE; this.ui.aims = ZONES.map(id => this.w({ x: -.05, u: zoneAt(id).u }, zoneAt(id).z));
    this.phase = 'dive'; this.win = { t0: s.time, T: PLANT + WIND, real: spec.dive };
    this.tell = tellOf(spec); this.diveT0 = this.ui.clock;
    await this.wait(99, () => s.time - this.win.t0 >= PLANT);
    s.windup('o1', spec.foot === 'in' ? 'pass' : 'shot', null);
    await this.wait(99, () => s.time - this.win.t0 >= PLANT + WIND);
    // The kick: what happens follows from where he stood and what he chose (saves.js).
    this.win = null; this.phase = 'flight'; this.ui.aims = NONE; this.ui.timer = null; this.tell = null;
    const at = this.pickSpot != null ? spots[this.pickSpot] : START, r = saveOf(spec, at, this.pickZone);
    this.result = { ...r, spot: this.pickSpot, tap: this.pickZone, spec };
    const arrive = this.strike(spec, r, at);
    await this.wait(99, () => s.time >= arrive);
    if (r.res === 'save') this.saved(r); else this.conceded(r);
    await this.wait(AFTER[r.res]);
    this.hud.caption?.('');
    return this.result;
  }
  // From where the ball is struck to the target, along the grass (a unit vector in the goal's frame).
  aimDir(spec) { const Z = zoneAt(spec.zone), dx = -spec.from.x, du = Z.u - spec.from.u, l = Math.hypot(dx, du); return { x: dx / l, u: du / l }; }

  // ---------- his taps ----------
  // choose('spot:1') or choose('zone:TL'): a gold spot while the shooter runs in, a target while he winds up. He can
  // change his mind until the window closes; the last tap counts.
  choose(opt) {
    const [kind, id] = opt.split(':');
    if (kind === 'spot' && this.phase === 'stand' && this.spots[+id]) {
      this.pickSpot = +id; const p = this.w(this.spots[+id]);
      this.sim.go('hero', p.x, p.y, SIDE_STEP); this.sfx('click');
      this.ui.spotScale = this.spots.map((_, i) => (i === +id ? 1 : SPOT * .85));
      return true;
    }
    if (kind === 'zone' && this.phase === 'dive' && ZONES.includes(id)) { this.pickZone = id; this.ui.pick = id; this.sfx('click'); return true; }
    return false;
  }
  // A tap on the screen (CSS px): the nearest spot or target to it, within reach of a finger.
  tapAt(x, y) {
    const near = (pts, r) => { let best = null, bd = r; pts.forEach((p, i) => { const q = this.world.project(p.x, p.y, p.z || 0); if (!q) return; const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = i; } }); return best; };
    if (this.phase === 'stand') { const i = near(this.ui.spots, 90); if (i != null) return this.choose('spot:' + i); }
    if (this.phase === 'dive') { const i = near(this.ui.aims, 110); if (i != null) return this.choose('zone:' + ZONES[i]); }
    return false;
  }

  // ---------- the kick ----------
  // The ball goes where he aimed: to the keeper's hands (a save) or past him into the net. The keeper goes as he chose,
  // so his hands arrive with the ball, or where the ball is not. Returns the game time the ball gets to his line.
  strike(spec, r, at) {
    const s = this.sim, b = s.ball, k = s.a('hero'), from = this.w(spec.from), Z = zoneAt(spec.zone);
    Object.assign(b, { x: from.x, y: from.y, z: 0, move: null }); // (the ball where it is struck: a few cm at most)
    const save = r.res === 'save', kx = k.x, hx = save ? Math.max(.25, kx + .3) : -.6; // a save: in front of him; a goal: in the net
    const f = (from.x - hx) / from.x, y = from.y + (this.cy + Z.u - from.y) * f, z = save ? r.hand.z : Z.z * (from.x - hx) / from.x * 1;
    const arc = spec.foot === 'in' ? .06 : Z.top ? .12 : .2, speed = spec.speed;
    const lineF = (from.x - 0) / (from.x - hx), lift = (zz, ff) => { const u = 1 - Math.pow(1 - clamp(ff, .05, 1), 2 / 3); return Math.max(0, (zz - arc * 4 * u * (1 - u)) / u); };
    const z1 = save ? lift(r.hand.z, 1) : Z.top ? lift(Z.z, lineF) : lift(Z.z * .6, lineF);
    s.kick(hx, y, { speed, arc, z1 });
    const tLine = Math.hypot(from.x - kx, from.y - y) / speed;
    this.dive(r, { x: kx, y: this.cy + r.hand.u }, tLine, save);
    this.ballTo = { x: hx, y, z };
    return s.time + Math.max(.25, Math.hypot(hx - from.x, y - from.y) / speed);
  }
  // His dive (pro/keeper.js draws it from k.gkm, as for the match keepers: game/keeper.js keeperReact): where his hands go,
  // where his body goes, when he sets off. Late (no dive chosen): a moment after the kick, and short.
  dive(r, hand, tLine, save) {
    const s = this.sim, k = s.a('hero'), d = dist(k, hand) || .01, ux = (hand.x - k.x) / d, uy = (hand.y - k.y) / d, dy = hand.y - k.y;
    const go = r.act === 'late' ? GK.react : REACT, dur = Math.max(.2, tLine - go), side = Math.sign(dy) || 1;
    const lo = this.cy - GOAL.half, hi = this.cy + GOAL.half;
    const inPosts = y => (side > 0 ? Math.min(y, Math.max(k.y, hi - DIVE_LEN)) : Math.max(y, Math.min(k.y, lo + DIVE_LEN)));
    const dive = r.act === 'low' || r.act === 'high';
    const mv = r.act === 'stay' ? 0 : r.act === 'late' ? Math.min(.35, Math.max(0, d - 1)) : dive ? Math.max(Math.min(d, .3), d - .95) : Math.max(0, d - .55);
    let body = { x: k.x + ux * mv, y: k.y + uy * mv }; if (dive) body.y = inPosts(body.y);
    const handAt = save ? hand : { x: k.x + ux * Math.min(d, mv + .9), y: k.y + uy * Math.min(d, mv + .9) };
    k.gkm = { k: dive ? 'dive' : 'reach', t0: s.time + go, dur, side, hand: handAt, hz: r.hand.z, low: r.hand.z < .8, high: r.act === 'high', save, keep: save && r.held,
      body, spd: Math.max(1, dist(k, body) / dur) };
    s.stop('hero');
  }
  // Saved: in his hands (he holds it; down with it after a dive, up with it as he gets up), or pushed away round the post.
  saved(r) {
    const s = this.sim, b = s.ball, k = s.a('hero');
    if (r.held) Object.assign(b, { state: 'held', carrier: 'hero', move: null });
    else { b.carrier = 'hero'; s.kick(clamp(b.x + 2.2, .5, 4), this.cy + r.dir * (GOAL.half + 1.2), { speed: 5.5, arc: .5, touch: true }); b.carrier = null; }
    this.sfx(r.held ? 'tap' : 'kick');
    this.world.fx?.('held'); if (this.world) { this.world.excite = 1; this.world.punch = .6; this.world.mood = { team: 'us', t: 0, hero: k }; }
    this.hud.banner?.('SAVED!', 'goal'); this.say(SAVED);
    this.hud.pop?.(3, () => this.world.project?.(k.x, k.y, 1.9));
  }
  // In: the net bulges, their fans cheer, and a kind word about what to look at next time.
  conceded(r) {
    this.world.fx?.('goalAgainst'); this.sfx('net');
    const line = WHY[r.why] || WHY.dive;
    this.hud.caption?.(line + (r.why === 'dive' ? ' 👀' : r.why === 'spot' ? ' ⚽ 🧍 🥅' : ' 🧤')); this.say(line);
  }

  // ---------- each frame: the highlights ----------
  // The ring at his feet drains with the window; the tells show while he picks where to dive.
  frame() {
    const s = this.sim, w = this.win, ui = this.ui, o = s.a('o1');
    ui.timer = w ? { left: clamp(1 - (s.time - w.t0) / w.T, 0, 1), wide: false } : null;
    ui.heroRing = this.phase === 'ready'; // (not while he chooses: the gold is for the spots and targets; the ring that drains is round his feet)
    const t = this.tell; ui.tell = null; ui.lines = NONE;
    if (t && o) {
      // His eyes (drawn over his head by ui/goalie.js): clear on the first shots, a moment only later, none at the end.
      const age = this.ui.clock - this.diveT0, show = t.level >= 2 ? 1 : t.level === 1 ? clamp(1.6 - age, 0, 1) : 0;
      if (show > 0) ui.tell = { x: o.x, y: o.y, z: 1.75, dx: t.col === 'L' ? -1 : t.col === 'R' ? 1 : 0, dy: t.top ? -1 : .7, big: t.level >= 3, alpha: show };
      // His standing foot points at it (level 3: an arrow on the grass from his foot, so the first shots teach what to watch).
      if (t.level >= 3) { const a = this.w({ x: 0, u: t.at.u }), dx = a.x - o.x, dy = a.y - o.y, l = Math.hypot(dx, dy); ui.lines = [{ a: { x: o.x + dx / l * .5, y: o.y + dy / l * .5 }, b: { x: o.x + dx / l * 2.6, y: o.y + dy / l * 2.6 }, color: '#ffd23f' }]; }
    }
    // The teaching hand (his very first shot): over the right spot, then over the target his eyes show.
    ui.hand = null;
    if (this.hint && this.phase === 'stand' && this.pickSpot == null) { const p = this.spots.find(q => q.right); ui.hand = this.w(p, 0); }
    if (this.hint && this.phase === 'dive' && this.pickZone == null) { const Z = zoneAt(this.spec.zone); ui.hand = this.w({ x: 0, u: Z.u }, Z.z); }
  }
}
