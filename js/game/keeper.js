// The goalkeepers (5v5, v62): where they stand, how they move, what they stop and what they do with the ball after.
// Both are recreational keepers aged 6 to 8 (v62 research, section 7): on the line or up to a metre off it, side-steps
// toward the line from the ball to the goal's middle, late (the spot he heads for is renewed only every LAG seconds)
// and short of it (only part `f` of the way), and never out of the area. What a shot does against him is decided by
// shot.js (the same rule the lessons are graded with); here he acts it out.
import { clamp, dist, closestOnLane } from '../geom.js';
import { L, W, gy0, gy1 } from './shared.js';
import { GK, GUESS_T, spill } from '../shot.js';
import { sizeOf } from '../geom.js';

const LAG = .4, STEP = 2.5;
// Lying on his side after a dive he is about DIVE_LEN m long from his feet; he is up again GET_UP s after his hands meet
// the ball (pro/keeper.js: he lies a moment, then gets up through a kneel).
export const DIVE_LEN = 1.8, GET_UP = 1.6; // seconds between looks at the ball; side-step speed (m/s)
// The keeper area (m): its depth from the line and its width (sizes with a keeper; geom.js SIZES).
export const AREA = () => sizeOf().area || { d: 8, w: 14 };
export const inArea = (k, p) => { const A = AREA(), gx = k.team === 'us' ? 0 : L; return Math.abs(p.x - gx) <= A.d && Math.abs(p.y - W / 2) <= A.w / 2; };

export const keeper = {
  get keepersOn() { return this.sim.agents.has('k1') || this.sim.agents.has('k2'); },
  // Every frame: each keeper not acting out a save or holding the ball takes up his spot (see above). In a lesson he
  // stands where the scene put him until play goes on after the choice (the shot is graded against that place).
  keepers(dt) {
    const s = this.sim, b = s.ball, now = s.time;
    for (const id of ['k1', 'k2']) {
      const k = s.a(id); if (!k) continue;
      if (k.gkm) { this.keeperMotion(k); continue; }
      if (k.upUntil > now) { s.stop(id); continue; } // (getting up after a dive: no steps meanwhile)
      if (this.phase !== 'outcome' || this.scripted.has(id) || b.state === 'held') continue;
      const gx = k.team === 'us' ? 0 : L, out = gx ? -1 : 1, far = Math.hypot(b.x - gx, b.y - W / 2) > 15;
      if (k.look == null || now - k.look >= LAG) { // a look at the ball: where he heads for, until the next look
        k.look = now; const f = k.f ?? this.sc?.gk?.f ?? .3;
        k.spot = far ? { x: gx + out * (GK.off * .5 + .5), y: W / 2 } : { x: gx + out * (k.off ?? this.sc?.gk?.off ?? .6), y: clamp(W / 2 + (b.y - W / 2) * f, gy0 + .35, gy1 - .35) };
      }
      if (dist(k, k.spot) > .05) s.go(id, k.spot.x, k.spot.y, STEP); else s.stop(id);
      k.face = [out, 0];
    }
  },
  // A save, a dive at a shot that goes past him, picking up, holding, rolling out: k.gkm = { k, t0, ... } (the picture
  // reads it: pro/keeper.js). Here only what moves him.
  keeperMotion(k) {
    const m = k.gkm, t = this.sim.time - m.t0;
    if (m.step && !m.stepped && t >= -m.pre) { m.stepped = true; this.sim.go(k.id, m.step.x, m.step.y, Math.max(.5, dist(k, m.step) / m.pre)); } // (a guess: one step before the kick)
    if (m.body && !m.went && t >= 0) { m.went = true; this.sim.go(k.id, m.body.x, m.body.y, m.spd); }
    if ((m.k === 'dive' || m.k === 'reach' || m.k === 'watch') && t > m.dur + (m.k === 'dive' ? 1.1 : .4) && !m.keep) { if (m.k === 'dive') k.upUntil = m.t0 + m.dur + GET_UP; k.gkm = null; this.scripted.delete(k.id); } // (a held ball: the script that plays the save takes it from there; after a dive he stays where he is until he is up: pro/keeper.js)
    if (m.keep && m.k === 'reach' && t > m.dur + .7 && this.sim.ball.state === 'held' && this.sim.ball.carrier === k.id) k.gkm = { k: 'hold', t0: this.sim.time }; // gathered: he stands up with it at his chest
  },
  // His reaction to a shot (shot.js shotResult's result `r`, struck from `from`), as r.act says (v64): 'stay' he blocks it
  // with his body (hands to it where he stands), 'reach' a step and both hands, 'low' down to it along the grass (late:
  // getting down is hard for him), 'high' a dive up to it, 'wrong' a guess: he leans and goes early to the other side,
  // 'watch' (over, wide) a half step and his eyes on it. He goes once he has reacted, at his speed, so a save arrives
  // with the ball and a goal goes by beyond his hands. (Older callers pass only res, at or to, t: the act follows from
  // where it goes.) lead: seconds until the kick.
  keeperReact(k, r, from, lead = .2) {
    if (!k || !r) return;
    const s = this.sim, gx = k.team === 'us' ? 0 : L, line = r.at || r.to, save = r.res === 'save';
    // where his hands go: the point on the ball's way nearest him (a goal: as far toward it as he gets in time)
    const c = save ? { x: line.x, y: line.y } : closestOnLane(k, from, r.to || line, 0), d = dist(k, c) || .01, u = { x: (c.x - k.x) / d, y: (c.y - k.y) / d };
    const dy = c.y - k.y, act = r.act || (Math.abs(dy) <= GK.catchR && save ? 'stay' : Math.abs(dy) <= GK.reach + .15 ? 'reach' : r.top ? 'high' : 'low');
    if (act === 'none') return;
    const wsign = gx ? -1 : 1; // (his left is +y in our goal, -y in theirs)
    if (act === 'watch') { // over or wide: a half step toward its side, standing
      const to = { x: k.x, y: clamp(k.y + Math.sign(r.to.y - k.y) * .35, gy0 + .3, gy1 - .3) };
      k.gkm = { k: 'watch', t0: s.time + lead + GK.react, dur: .4, side: Math.sign((to.y - k.y) * wsign) || 1, body: to, spd: 1.2 };
      this.scripted.add(k.id); s.stop(k.id); return;
    }
    // (v64 round 3) His whole body stays between the posts in every dive: lying on his side he is about DIVE_LEN m long
    // from his feet, so his feet stop that far inside the post he dives toward (never farther out than he stood).
    const inPosts = (y, dir) => (dir > 0 ? Math.min(y, Math.max(k.y, gy1 - DIVE_LEN)) : Math.max(y, Math.min(k.y, gy0 + DIVE_LEN)));
    if (act === 'wrong') { // he guessed: before the kick only a lean and one step that way (GUESS_T s), then at the kick the dive (it goes elsewhere)
      const dir = r.dir || 1, step = { x: k.x, y: inPosts(k.y + dir * .35, dir) }, body = { x: k.x, y: inPosts(k.y + dir * 1.0, dir) }, dur = .45;
      k.gkm = { k: 'dive', guess: true, pre: GUESS_T, t0: s.time + lead, dur, side: Math.sign(dir * wsign) || 1, hand: { x: body.x, y: body.y + dir * .9 }, low: !r.top, high: false, save: false, keep: false, step, body, spd: dist(step, body) / dur };
      this.scripted.add(k.id); s.stop(k.id); return;
    }
    const reach = GK.reach + Math.max(0, r.t - GK.react) * GK.speed;
    // his middle: a save, close enough for his hands to be on the ball (a dive: his arms are out past his head); a goal, after it, but never nearer its way than a
    // metre (it goes past his fingertips). A ball at his body: he stays where he is.
    const mv = act === 'stay' ? 0 : save ? Math.max(Math.min(d, .3), d - (act === 'low' || act === 'high' ? .95 : .55)) : Math.max(0, Math.min(d - 1.1, reach - .75)), body = { x: k.x + u.x * mv, y: k.y + u.y * mv };
    const k2 = { x: k.x + u.x * Math.min(d, mv + .8), y: k.y + u.y * Math.min(d, mv + .8) };
    const dive = act === 'low' || act === 'high', side = Math.sign(dy * wsign) || 1; // side: +1 his left
    // He sets off once he has reacted (later for a low ball beside him: he has to get down to it).
    const go = Math.min(GK.react + (act === 'low' ? GK.down * .5 : 0), r.t * .6), dur = Math.max(.2, r.t - go);
    k.gkm = { k: dive ? 'dive' : 'reach', t0: s.time + lead + go, dur, side, hand: k2, hz: line.z ?? (r.top ? 1.3 : .2), low: !r.top && (save || (r.arc ?? .3) < .2 || act === 'low'), high: act === 'high', save, keep: save && (r.held ?? !r.parry),
      body: dive ? { x: body.x, y: inPosts(body.y, Math.sign(dy) || 1) } : { x: body.x, y: clamp(body.y, gy0 - 1, gy1 + 1) }, spd: Math.max(1, dist(k, body) / dur) };
    k.gkm.spd = Math.max(1, dist(k, k.gkm.body) / dur);
    if (r.guess && dive) { const dir = Math.sign(dy) || 1; Object.assign(k.gkm, { guess: true, pre: GUESS_T, step: { x: k.x, y: inPosts(k.y + dir * .35, dir) } }); } // (he guessed this way: the same lean and step before the kick)
    this.scripted.add(k.id); s.stop(k.id);
  },
  // He has the ball in his hands (a catch, or one he picked up): he holds it a moment, then rolls it out to a friend
  // out to the side who has nobody near him (the nearest such; or the friend most free). Resolves when the friend has it.
  *rollOut(k) {
    const s = this.sim, b = s.ball, gx = k.team === 'us' ? 0 : L, them = k.team === 'us' ? 'them' : 'us';
    Object.assign(b, { state: 'held', carrier: k.id, move: null, reach: null }); k.gkm = { k: 'hold', t0: s.time, low: false }; s.stop(k.id);
    yield .6;
    const free = p => Math.min(9, ...s.team(them).map(o => dist(o, p)));
    const mine = s.team(k.team), near = mine.filter(p => Math.abs(p.x - gx) < 18);
    const to = (near.length ? near : mine).sort((p, q) => (free(q) > 2.5) - (free(p) > 2.5) || dist(p, k) - dist(q, k))[0];
    k.face = [to.x - k.x, to.y - k.y].map(v => v / (dist(to, k) || 1)); this.scripted.add(to.id); s.stop(to.id);
    k.gkm = { k: 'roll', t0: s.time, low: true }; yield .45;
    yield () => Math.hypot(b.x - (k.x + k.face[0] * .45), b.y - (k.y + k.face[1] * .45)) < .05 && b.z < .2; // (his hands bring it down to the grass)
    Object.assign(b, { state: 'carried', carrier: k.id });
    s.kick(to.x - (to.x - k.x) / (dist(to, k) || 1) * .4, to.y - (to.y - k.y) / (dist(to, k) || 1) * .4, { speed: 9, arc: 0 });
    yield () => b.state === 'loose';
    s.give(to.id); k.gkm = null; this.scripted.delete(k.id);
    return to;
  },
  // Where a save that spills ends up (shot.js spill), fixed by where it happened (so a replay is the same).
  spillOf(r, from) { const h = Math.abs(Math.round(r.at.x * 7 + r.at.y * 13 + from.x * 3)) % 7; return spill(r.at, from, 2 + h / 3, (h % 2 ? 1 : -1) * .35); },
};
// In a match, how often our keeper stops their shot at our goal (outcomes.js ourSave; seeded by where it is struck).
export const OUR_SAVE = .33;
// A number from 0 to 1 that is the same for the same place (a match's seeded rules).
export const seeded = (...v) => { let h = 2166136261; for (const x of v) h = Math.imul(h ^ Math.round(x * 100), 16777619); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
