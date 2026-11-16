// The goalkeepers (5v5, v62): where they stand, how they move, what they stop and what they do with the ball after.
// Both are recreational keepers aged 6 to 8 (v62 research, section 7): on the line or up to a metre off it, side-steps
// toward the line from the ball to the goal's middle, late (the spot he heads for is renewed only every LAG seconds)
// and short of it (only part `f` of the way), and never out of the area. What a shot does against him is decided by
// shot.js (the same rule the lessons are graded with); here he acts it out.
import { clamp, dist, closestOnLane } from '../geom.js';
import { L, W, gy0, gy1 } from './shared.js';
import { GK, spill } from '../shot.js';
import { sizeOf } from '../geom.js';

const LAG = .4, STEP = 2.5; // seconds between looks at the ball; side-step speed (m/s)
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
    if (m.body && !m.went && t >= 0) { m.went = true; this.sim.go(k.id, m.body.x, m.body.y, m.spd); }
    if ((m.k === 'dive' || m.k === 'reach') && t > m.dur + (m.k === 'dive' ? 1.1 : .4) && !m.keep) { k.gkm = null; this.scripted.delete(k.id); } // (a held ball: the script that plays the save takes it from there)
  },
  // His reaction to a shot (shot.js resolve's result `r`, struck from `from`): a step and reach, or a fall to the side,
  // to where it is stopped, or after a ball that goes past him (he gets there short of it). He goes after it once he
  // has reacted, at his speed: so a save arrives with the ball, and a goal goes by just beyond his hands.
  keeperReact(k, r, from, lead = .2) { // lead: seconds until the kick
    if (!k || !r) return;
    const s = this.sim, gx = k.team === 'us' ? 0 : L, line = r.at || r.to;
    // where his hands go: the point on the ball's way nearest him (a goal: as far toward it as he gets in time)
    const c = r.res === 'save' ? { x: line.x, y: line.y } : closestOnLane(k, from, line, 0), d = dist(k, c) || .01, u = { x: (c.x - k.x) / d, y: (c.y - k.y) / d };
    const reach = GK.reach + Math.max(0, r.t - GK.react) * GK.speed, save = r.res === 'save';
    // his middle: a save, close enough for his hands to be on the ball; a goal, after it, but never nearer its way than a
    // metre (it goes past his fingertips)
    const mv = save ? Math.max(0, d - .55) : Math.max(0, Math.min(d - 1.1, reach - .75)), body = { x: k.x + u.x * mv, y: k.y + u.y * mv };
    const k2 = { x: k.x + u.x * Math.min(d, mv + .8), y: k.y + u.y * Math.min(d, mv + .8) };
    const dive = Math.abs(c.y - k.y) > GK.reach + .1, side = Math.sign((c.y - k.y) * (gx ? -1 : 1)) || 1; // side: +1 his left
    const go = Math.min(GK.react, r.t * .6), dur = Math.max(.2, r.t - go);
    k.gkm = { k: dive ? 'dive' : 'reach', t0: s.time + lead + go, dur, side, hand: k2, low: (r.arc ?? .3) < .2, save: r.res === 'save', keep: r.res === 'save' && !r.parry,
      body: { x: body.x, y: clamp(body.y, gy0 - 1, gy1 + 1) }, spd: Math.max(1, dist(k, body) / dur) };
    this.scripted.add(k.id); s.stop(k.id);
    void from;
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
    Object.assign(b, { state: 'carried', carrier: k.id, x: k.x + k.face[0] * .4, y: k.y + k.face[1] * .4, z: 0 });
    s.kick(to.x - (to.x - k.x) / (dist(to, k) || 1) * .4, to.y - (to.y - k.y) / (dist(to, k) || 1) * .4, { speed: 9, arc: 0 });
    yield () => b.state === 'loose';
    s.give(to.id); k.gkm = null; this.scripted.delete(k.id);
    return to;
  },
  // Where a save that spills ends up (shot.js spill), fixed by where it happened (so a replay is the same).
  spillOf(r, from) { const h = Math.abs(Math.round(r.at.x * 7 + r.at.y * 13 + from.x * 3)) % 7; return spill(r.at, from, 2 + h / 3, (h % 2 ? 1 : -1) * .35); },
};
// A number from 0 to 1 that is the same for the same place (a match's seeded rules).
export const seeded = (...v) => { let h = 2166136261; for (const x of v) h = Math.imul(h ^ Math.round(x * 100), 16777619); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
