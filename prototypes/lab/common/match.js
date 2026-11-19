// A small match engine for the lab, on top of the game's sim (players and ball). Our team attacks +x (the goal at
// x = L), theirs attacks -x. No keepers, no cuts: every stop ends in a real event (a goal, the ball out of play, a
// tackle, an interception), and play goes on from wherever everyone is.
//
// What it does each step: resolves a ball in flight (caught by whoever it was meant for, or cut out by the defender
// the pass was graded against), loose balls (the nearest of each side runs to it), the ball leaving the pitch (the
// other side restarts from the line), goals, tackles (a defender who stays on an unprotected carrier wins it), and moves
// everyone nobody has told what to do: the side with the ball spreads out to places where a pass can reach them (real
// runs, re-judged about once a second), the other side presses the ball with one player and marks the rest goal-side.
// A carrier the computer plays (`isAI`) shoots when close and clear, passes when pressed, and otherwise dribbles at goal.
import { clamp, dist, onLane } from './lab.js';

const SUPPORT_EVERY = .9, TACKLE_T = .55, REACH = .62;

export class Match {
  constructor(lab, opt = {}) {
    this.lab = lab; this.sim = lab.sim; this.L = lab.L; this.W = lab.W; this.gy0 = lab.gy0; this.gy1 = lab.gy1;
    this.n = opt.n || 4;
    this.usIds = ['hero', 'm1', 'm2', 'm3'].slice(0, this.n); this.themIds = ['o1', 'o2', 'o3', 'o4'].slice(0, opt.nThem || this.n);
    this.isAI = opt.isAI || (id => this.team(id) === 'them');
    this.flight = null; this.jobs = []; this.cmd = new Map(); this.contact = new Map(); this.next = new Map();
    this.hold = false; this.protect = null; this.pressUs = null; this.pressThem = null; this.freeze = false;
    this.lastTeam = 'us'; this.score = { us: 0, them: 0 }; this.aiT = 0; this.passes = 0;
    this.on = { gain: () => {}, goal: () => {}, out: () => {}, lost: () => {} };
  }
  // ---------- set-up ----------
  formation(team, kick) {
    const L = this.L, W = this.W, c = L / 2, s = team === 'us' ? -1 : 1, n = this.n;
    const rows = n === 3 ? [[1.2, .5], [5, .22], [5, .78]] : [[1.2, .5], [5, .2], [5, .8], [9, .5]];
    return rows.map(([d, f], i) => [c + s * (i === 0 && kick === team ? .7 : d + (kick !== team && i === 0 ? 3 : 0)), W * f]);
  }
  setup(kick = 'us') {
    const us = this.formation('us', kick), th = this.formation('them', kick);
    this.sim.setup({ hero: us[0], mates: us.slice(1), opps: th, carrier: kick === 'us' ? 'hero' : 'o1' });
    for (const a of this.sim.agents.values()) a.face = [a.team === 'us' ? 1 : -1, 0];
    this.flight = null; this.jobs.length = 0; this.cmd.clear(); this.lastTeam = kick;
  }
  // Everyone walks back to his place for a kick-off (no cut): `team` kicks off once they are there.
  kickoff(team, done) {
    const us = this.formation('us', team), th = this.formation('them', team);
    const all = [...this.usIds.map((id, i) => [id, us[i]]), ...this.themIds.map((id, i) => [id, th[i]])];
    for (const [id, p] of all) if (this.sim.a(id)) { this.sim.go(id, p[0], p[1], 5); this.cmd.set(id, 99); }
    const b = this.sim.ball; Object.assign(b, { state: 'loose', carrier: null, x: this.L / 2, y: this.W / 2, z: 0, move: null, hidden: false, reach: null });
    this.flight = null; this.dead = true; this.restart = null;
    this.after(1.9, () => { this.cmd.clear(); this.dead = false; const k = team === 'us' ? 'hero' : 'o1'; this.giveTo(k, 'kickoff'); done?.(); });
  }
  // ---------- small queries ----------
  team(id) { return id && (id[0] === 'o' ? 'them' : 'us'); }
  ids(team) { return (team === 'us' ? this.usIds : this.themIds).filter(id => this.sim.a(id)); }
  foes(team) { return this.ids(team === 'us' ? 'them' : 'us').map(id => this.sim.a(id)); }
  owner() { const b = this.sim.ball; return b.state === 'carried' ? b.carrier : null; }
  dir(team) { return team === 'us' ? 1 : -1; }
  goalX(team) { return team === 'us' ? this.L : 0; }
  after(t, f) { this.jobs.push({ at: this.sim.time + t, f }); }
  // How open the line from a to b is: the defender nearest to it (with how far along it he is), and the gap (m).
  lane(a, b, team) { let best = null; for (const o of this.foes(team)) { const c = onLane(o, a, b); if (!best || c.d < best.d) best = { ...c, o }; } return best || { d: 99, o: null }; }
  // A pass a → b is open when no defender of theirs is near its line (more room the farther along he is: he has
  // time to step in) and nobody of theirs is right on the receiver.
  passCheck(fromId, toId) {
    const s = this.sim, a = s.a(fromId), b = s.a(toId), team = this.team(fromId);
    const ln = this.lane(a, b, team), need = .75 + .07 * ln.along;
    const mk = this.foes(team).map(o => ({ o, d: dist(o, b) })).sort((p, q) => p.d - q.d)[0];
    const markedBy = mk && mk.d < 1.35 && (mk.o.x - b.x) * (a.x - b.x) + (mk.o.y - b.y) * (a.y - b.y) > -.3 ? mk.o : null; // (one behind him, on his far side, does not cut it out)
    if (ln.d < need && ln.t < .95) return { open: false, why: 'lane', by: ln.o.id, at: { x: ln.x, y: ln.y } };
    if (markedBy) return { open: false, why: 'marked', by: markedBy.id, at: { x: b.x, y: b.y } };
    return { open: true, gap: ln.d, fwd: (b.x - a.x) * this.dir(team) };
  }
  shotCheck(id) {
    const a = this.sim.a(id), team = this.team(id), gx = this.goalX(team), d = Math.hypot(gx - a.x, this.W / 2 - a.y);
    const ys = [this.gy0 + .6, (this.gy0 + this.gy1) / 2, this.gy1 - .6], lanes = ys.map(y => ({ y, ...this.lane(a, { x: gx, y }, team) })).sort((p, q) => q.d - p.d);
    const best = lanes[0];
    if (d > 10.5) return { good: false, why: 'far', d };
    if (best.d < .8) return { good: false, why: 'blocked', by: best.o?.id, d };
    return { good: true, y: best.y, d };
  }
  // Space to run with it toward (x, y): nobody of theirs within 3.2 m ahead of him in a 40° cone.
  runCheck(id, ang) {
    const a = this.sim.a(id), c = Math.cos(ang), s = Math.sin(ang);
    let worst = null;
    for (const o of this.foes(this.team(id))) { const f = (o.x - a.x) * c + (o.y - a.y) * s, l = Math.abs((o.y - a.y) * c - (o.x - a.x) * s); if (f > -.2 && f < 3.4 && l < .9 + f * .55) { if (!worst || f < worst.f) worst = { f, o }; } }
    const ex = a.x + c * 4, ey = a.y + s * 4, inside = ex > .8 && ex < this.L - .3 && ey > .8 && ey < this.W - .8;
    return worst ? { good: false, why: 'defender', by: worst.o.id } : inside ? { good: true } : { good: false, why: 'line' };
  }
  // ---------- actions ----------
  giveTo(id, how) { this.sim.give(id); this.flight = null; this.lastTeam = this.team(id); this.contact.clear(); this.on.gain(id, how); }
  // A pass. `cut`: the defender who will cut it out (the pass was graded closed), or null (it gets there).
  pass(fromId, toId, cut = null) {
    const s = this.sim, a = s.a(fromId), b = s.a(toId); if (!a || !b) return;
    const d = dist(a, b), sp = clamp(6 + d * .45, 8, 13.5), lead = b.sp > .6 ? Math.min(1.6, b.sp * d / sp * .7) : 0;
    const lx = b.tx - b.x, ly = b.ty - b.y, ll = Math.hypot(lx, ly) || 1;
    const tx = clamp(b.x + lx / ll * lead, .8, this.L - .8), ty = clamp(b.y + ly / ll * lead, .8, this.W - .8);
    s.stop(fromId); s.windup(fromId, 'pass'); this.cmd.set(fromId, s.time + .7);
    s.go(toId, tx, ty, Math.max(2.5, b.sp)); this.cmd.set(toId, s.time + 9); s.open(toId, this.goalX(this.team(toId)), this.W / 2);
    if (cut) { const c = s.a(cut), at = onLane(c, a, { x: tx, y: ty }); s.go(cut, at.x, at.y, 5.2); this.cmd.set(cut, s.time + 9); }
    this.flight = { kind: 'pass', from: fromId, to: toId, cut, team: this.team(fromId), t0: s.time };
    this.after(.13, () => { if (this.flight?.from === fromId && s.ball.carrier === fromId) { s.kick(tx, ty, { speed: sp, arc: d > 11 ? .45 : .1 }); this.lastTeam = this.team(fromId); this.passes++; } });
  }
  // A shot: in (the shot was a good choice), blocked by `by`, or wide (from too far).
  shoot(id, res) {
    const s = this.sim, a = s.a(id), team = this.team(id), gx = this.goalX(team), dx = this.dir(team);
    s.stop(id); s.windup(id, 'shot'); this.cmd.set(id, s.time + .8);
    let tx, ty, z1 = .35, sp = 15, kind = 'shot';
    if (res.good) { tx = gx + dx * .7; ty = res.y; z1 = .3 + Math.random() * .5; }
    else if (res.why === 'blocked' && res.by) { const o = s.a(res.by); tx = o.x; ty = o.y; s.go(res.by, o.x, o.y, 0); kind = 'blocked'; sp = 12; }
    else { tx = gx + dx * 2.2; ty = (a.y < this.W / 2 ? this.gy0 - 2.6 : this.gy1 + 2.6); sp = 11; z1 = 1.2; kind = 'wide'; }
    this.flight = { kind, from: id, team, by: res.by, t0: s.time };
    this.after(.15, () => { if (s.ball.carrier === id) { s.kick(tx, ty, { speed: sp, arc: kind === 'wide' ? .9 : .25, z1 }); this.lastTeam = team; } });
  }
  dribble(id, x, y, sp = 3.6, secs = 1.2) { this.sim.go(id, clamp(x, 1, this.L - 1), clamp(y, 1, this.W - 1), sp); this.cmd.set(id, this.sim.time + secs); }

  // ---------- one step ----------
  step(dt) {
    const s = this.sim, b = s.ball, t = s.time;
    for (let i = this.jobs.length - 1; i >= 0; i--) if (this.jobs[i].at <= t) { const j = this.jobs.splice(i, 1)[0]; try { j.f(); } catch (e) { console.error(e); } }
    for (const [id, until] of this.cmd) if (until <= t) this.cmd.delete(id);
    // goal or out
    if ((b.state === 'flying' || b.state === 'loose') && !this.dead) {
      if (b.x > this.L - .05 && b.y > this.gy0 && b.y < this.gy1 && (b.z || 0) < this.lab.gh) return this.goal('us');
      if (b.x < .05 && b.y > this.gy0 && b.y < this.gy1 && (b.z || 0) < this.lab.gh) return this.goal('them');
      if (b.x < -.2 || b.x > this.L + .2 || b.y < -.2 || b.y > this.W + .2) return this.out();
    }
    if (this.dead) return;
    // a ball in flight
    const f = this.flight;
    if (f && b.state === 'flying') {
      if (f.kind === 'pass') {
        const r = s.a(f.to), u = b.t || 0;
        if (f.cut) { const c = s.a(f.cut); if (c && Math.hypot(c.x - b.x, c.y - b.y) < .8 && (b.z || 0) < 1.4 && u > .15) { this.giveTo(f.cut, 'cut'); return; } }
        if (r && u > .55 && Math.hypot(r.x - b.x, r.y - b.y) < .55) { this.giveTo(f.to, 'pass'); return; }
      } else if (f.kind === 'blocked') { const o = s.a(f.by); if (o && Math.hypot(o.x - b.x, o.y - b.y) < .9) { this.giveTo(f.by, 'block'); return; } }
    }
    if (b.state === 'loose' && !this.dead) {
      if (f?.kind === 'pass') { const r = s.a(f.to); if (r && dist(r, b) < 1.8) { this.giveTo(f.to, 'pass'); return; } if (f.cut) { const c = s.a(f.cut); if (c && dist(c, b) < 2) { this.giveTo(f.cut, 'cut'); return; } } }
      if (f?.kind === 'blocked') { const o = s.a(f.by); if (o) { this.giveTo(f.by, 'block'); return; } }
      this.flight = null;
      // the nearest of each side runs to it; the first to get there has it
      for (const team of ['us', 'them']) {
        if (this.restart && this.restart.team !== team) continue;
        const near = this.ids(team).map(id => s.a(id)).sort((p, q) => dist(p, b) - dist(q, b))[0];
        if (!near) continue;
        if (dist(near, b) < REACH) { this.giveTo(near.id, 'loose'); return; }
        if (!this.cmd.has(near.id) || this.restart?.id === near.id) s.go(near.id, b.x, b.y, this.restart?.team && this.restart.team !== team ? 0 : 4.6);
      }
    }
    // tackles: a defender on an unprotected carrier for TACKLE_T s wins the ball
    const c = this.owner();
    if (c && !b.reach) {
      const ca = s.a(c), safe = this.protect === c || this.hold;
      for (const o of this.foes(this.team(c))) {
        const d = dist(o, ca), k = o.id;
        if (d < .95 && !safe && !b.move) { const v = (this.contact.get(k) || 0) + dt; this.contact.set(k, v); if (v > TACKLE_T) { this.lab.world.fx('stolen'); this.lab.sfx('down'); const was = c; this.giveTo(k, 'tackle'); this.on.lost?.(was, k); return; } }
        else this.contact.delete(k);
      }
    }
    this.moveTeams(dt);
  }
  goal(team) {
    this.dead = true; this.score[team]++; this.flight = null;
    this.lab.world.fx(team === 'us' ? 'goal' : 'goalAgainst'); this.lab.sfx(team === 'us' ? 'goal' : 'aww');
    for (const a of this.sim.agents.values()) this.sim.stop(a.id);
    this.on.goal(team);
  }
  out() {
    const s = this.sim, b = s.ball, team = this.lastTeam === 'us' ? 'them' : 'us';
    const x = clamp(b.x, .6, this.L - .6), y = clamp(b.y, .4, this.W - .4);
    Object.assign(b, { state: 'loose', carrier: null, x, y, z: 0, move: null, reach: null }); this.flight = null;
    const near = this.ids(team).map(id => s.a(id)).sort((p, q) => dist(p, b) - dist(q, b))[0];
    this.restart = { team, id: near.id }; this.cmd.set(near.id, s.time + 6); s.go(near.id, x, y, 4.6);
    this.lab.sfx('click'); this.on.out(team);
    this.after(6, () => { this.restart = null; });
  }
  // ---------- everyone nobody told what to do ----------
  moveTeams(dt) {
    const s = this.sim, b = s.ball, c = this.owner(), team = c ? this.team(c) : this.flight?.team || this.restart?.team || this.lastTeam;
    const t = s.time;
    if (c && this.isAI(c) && !this.cmd.has(c) && !this.flight) this.aiCarrier(c, dt);
    // the side with the ball: support places
    for (const id of this.ids(team)) {
      if (id === c || this.cmd.has(id) || (this.flight?.to === id)) continue;
      if ((this.next.get(id) || 0) > t) continue;
      this.next.set(id, t + SUPPORT_EVERY * (.85 + .3 * Math.random()));
      const p = this.supportSpot(id, team); s.go(id, p.x, p.y, this.hold ? 2.4 : 3.3);
    }
    // the other side: one presses the ball, the rest mark goal-side
    const def = team === 'us' ? 'them' : 'us', dx = this.dir(def), ownX = def === 'us' ? 0 : this.L;
    const free = this.ids(def).filter(id => !this.cmd.has(id) && this.flight?.cut !== id);
    let presser = def === 'us' ? this.pressUs : this.pressThem;
    if (presser === undefined || (presser && !free.includes(presser))) presser = null;
    if (presser === 'auto' || (def === 'them' && !presser)) presser = free.slice().sort((p, q) => dist(s.a(p), b) - dist(s.a(q), b))[0] || null;
    if (presser && b.state !== 'loose') {
      const ca = c ? s.a(c) : b, gx = ownX - ca.x, gy = this.W / 2 - ca.y, gl = Math.hypot(gx, gy) || 1;
      const off = this.hold || this.protect === c ? 1.8 : this.freeze ? 1.5 : .45;
      const tx = ca.x + gx / gl * off, ty = ca.y + gy / gl * off;
      s.go(presser, tx, ty, this.hold ? 1.6 : def === 'us' ? 4.4 : 3.9);
    }
    // markers: each takes the attacker nearest his own goal that nobody has yet
    const att = this.ids(team).filter(id => id !== c).map(id => s.a(id)).sort((p, q) => (p.x - q.x) * -dx);
    const left = free.filter(id => id !== presser);
    for (const a of att) {
      if (!left.length) break;
      left.sort((p, q) => dist(s.a(p), a) - dist(s.a(q), a)); const m = left.shift();
      if ((this.next.get(m) || 0) > t) continue; this.next.set(m, t + .5);
      const gx = ownX - a.x, gy = this.W / 2 - a.y, gl = Math.hypot(gx, gy) || 1;
      const tx = a.x + gx / gl * 1.5 + (b.x - a.x) * .18, ty = a.y + gy / gl * 1.5 + (b.y - a.y) * .18;
      s.go(m, clamp(tx, .8, this.L - .8), clamp(ty, .8, this.W - .8), this.hold ? 2 : 3.2);
    }
    for (const m of left) { if ((this.next.get(m) || 0) > t) continue; this.next.set(m, t + .8); const x = clamp(lerp(ownX, b.x, .45), 1, this.L - 1), y = clamp(lerp(this.W / 2, b.y, .5), 1, this.W - 1); s.go(m, x, y, 2.6); }
  }
  // A place for a friend of the ball: an anchor by his role (wide on either side, ahead, behind), then the most open
  // point near it (the clearest line from the ball, room from their players and from his own team).
  supportSpot(id, team) {
    const s = this.sim, b = s.ball, dx = this.dir(team), L = this.L, W = this.W, me = s.a(id);
    const mates = this.ids(team).filter(x => x !== id && x !== this.owner()).map(x => s.a(x));
    const by = clamp(b.y, 3, W - 3), deep = (b.x - (team === 'us' ? 0 : L)) * dx > L * .6;
    const anchors = [[b.x + dx * 3, by + 6.5], [b.x + dx * 3, by - 6.5], [b.x + dx * 8, W / 2 + (b.y < W / 2 ? 2.5 : -2.5)], [b.x - dx * 5, by]];
    // each friend keeps one role while his team has the ball (wide on one side, the other, ahead or behind), so two never go to one place
    const sup = this.ids(team).filter(x => x !== this.owner()), use = sup.length <= 2 ? [0, 1] : deep ? [0, 1, 3] : [0, 1, 2];
    if (!this.roles || this.roles.team !== team || sup.some(x => this.roles.map[x] == null) || this.roles.deep !== deep) {
      const map = {}, left = new Set(sup);
      for (const i of use) { let pick = null, pd = 1e9; for (const x of left) { const q = s.a(x), d = Math.hypot(q.x - anchors[i][0], q.y - anchors[i][1]); if (d < pd) { pd = d; pick = x; } } if (pick) { map[pick] = i; left.delete(pick); } }
      for (const x of left) map[x] = 3;
      this.roles = { team, map, deep };
    }
    const an = anchors[this.roles.map[id] ?? 0], anchor = [clamp(an[0], 2, L - 2), clamp(an[1], 1.5, W - 1.5)];
    const foes = this.foes(team); let best = null, bs = -1e9;
    for (let k = 0; k < 9; k++) {
      const r = k ? 2.6 : 0, a = k * Math.PI / 4, x = clamp(anchor[0] + Math.cos(a) * r, 1.3, L - 1.3), y = clamp(anchor[1] + Math.sin(a) * r, 1.3, W - 1.3), p = { x, y };
      let lane = 99, room = 99; for (const o of foes) { lane = Math.min(lane, onLane(o, b, p).d); room = Math.min(room, dist(o, p)); }
      const crowd = mates.reduce((m, q) => Math.min(m, Math.hypot(q.tx - x, q.ty - y)), 99);
      const sc = Math.min(lane, 3) * 1.2 + Math.min(room, 4) * .5 - Math.hypot(x - anchor[0], y - anchor[1]) * .15 - (crowd < 3 ? 3 - crowd : 0) - (Math.hypot(x - b.x, y - b.y) < 3 ? 2 : 0);
      if (sc > bs) { bs = sc; best = p; }
    }
    return best;
  }
  // The computer's carrier: shoot when close and clear, pass when pressed (or to a friend well ahead in the clear),
  // else dribble at goal, away from the nearest defender.
  aiCarrier(id, dt) {
    const s = this.sim, a = s.a(id), team = this.team(id), dx = this.dir(team);
    if ((this.aiT -= dt) > 0) return; this.aiT = .45;
    if (this.freeze || this.hold) { s.go(id, a.x + dx * .3, a.y, 1); return; }
    const shot = this.shotCheck(id); if (shot.good && Math.random() < .8) { this.shoot(id, shot); return; }
    const press = this.foes(team).some(o => dist(o, a) < 2.4);
    const opts = this.ids(team).filter(m => m !== id).map(m => ({ m, ...this.passCheck(id, m) })).filter(o => o.open).sort((p, q) => q.fwd - p.fwd);
    const pref = this.prefer?.(id, opts);
    if (pref) { this.pass(id, pref); return; }
    if (opts.length && (press || (opts[0].fwd > 5 && Math.random() < .35))) { this.pass(id, opts[0].m); return; }
    const near = this.foes(team).sort((p, q) => dist(p, a) - dist(q, a))[0], side = near && Math.abs(near.y - a.y) < 2.5 && (near.x - a.x) * dx > 0 ? (near.y > a.y ? -1 : 1) * 2.2 : 0;
    s.go(id, clamp(a.x + dx * 3, 1, this.L - 1), clamp(a.y + side + (this.W / 2 - a.y) * .15, 1.2, this.W - 1.2), 3.1);
  }
}
const lerp = (a, b, k) => a + (b - a) * k;
