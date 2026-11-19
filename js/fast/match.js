// Fast mode's match: the rules and the computer's players, on the game's own sim (js/sim.js: bodies, the ball, the
// dribble), with no page. Grown from the Lab's engine (prototypes/lab/common/match.js), with what the owner asked for:
//  - A pass is a real ball (rules.js cutBy, bodyHit): a defender who can get a foot to its line takes it, and a ball that
//    meets a body is that player's. A pass never goes through anyone.
//  - Nobody stands still in front of a player standing on the ball: the nearest of theirs closes in, a warning comes
//    (on.warn) and, if he still stands there, the tackle (STAND_T s on him).
//  - Friends keep apart (a role each: wide on either side, ahead, behind; never within SPREAD m of each other) and
//    give the carrier lines to pass along; the computer's carrier passes to his player FAVOR to 1 over an equally open
//    friend, and never when a defender is on his line.
//  - Defending, his team rotates: the nearest of the rest presses, unless he is the nearest or has just lost it: then
//    it is his to go (they mark the others), for up to GO_T s.
//  - 5 v 5: two keepers (k1 ours, k2 theirs) who keep to their line, take loose balls near their goal and save shots as
//    js/shot.js says.
// Our team attacks +x (their goal at x = L). His player (`me`) moves only when he says so (the controller, fast.js).
import { clamp, dist, onLane, cutBy, bodyHit, pickPass, stealNow, REACH as FOOT_REACH } from './rules.js';
import { shotResult } from '../shot.js';

const SUPPORT_EVERY = .9, TACKLE_T = .55, LOOSE_R = .62, SPREAD = 5;
export const WARN_AT = .15, GO_T = 3.5, FAVOR = 3, LUNGE_T = 1;
// ---------- how good the other team is: one number ----------
// LEVEL, 0 (gentle) to 1 (as quick as his own friends), scales everything about them: how fast they dribble, close him
// down and mark, how long they need on a player to take the ball (from him standing on it: STAND), how quickly they get
// to a pass line, how hard they pass, how often and from how far they shoot, how often their first touch runs loose, and
// how well their keeper (5 v 5) follows the ball across his goal. The default makes his team win about two matches in
// three for a child who plays sensibly (the tuning runs, v84); later it can rise with his results.
export const LEVELS = { '3v3': .5, '4v4': .6, '5v5': .55 }, FIND = 16, FIND_P = .85; // (the default by team size: the tuning runs, v84)
export let LEVEL = .5;
export function oppOf(level = LEVEL) { // (LEVEL: one number; LEVELS: its default at each team size)
  const k = clamp(level, 0, 1);
  return { run: 2.2 + .8 * k, press: 2.8 + 1.3 * k, mark: 2.4 + .9 * k, markEvery: 1.1 - .6 * k, tackle: 1.2 - .5 * k, stand: 3.6 - 1.6 * k,
    cutRun: 3.3 + 1.5 * k, cutReact: .5 - .3 * k, passK: .82 + .18 * k, shootP: .4 + .45 * k, range: 8.5 + 3 * k, loose: .3 * (1 - k), keeper: .12 + .23 * k };
}

export class Match {
  // env: { sim, L, W, gy0, gy1, gh, n (outfield players a side), keepers, fx(ev), sfx(name), rnd }
  constructor(env) {
    Object.assign(this, { sim: env.sim, L: env.L, W: env.W, gy0: env.gy0, gy1: env.gy1, gh: env.gh, n: env.n || 4, keepers: !!env.keepers });
    this.fx = env.fx || (() => {}); this.sfx = env.sfx || (() => {}); this.rnd = env.rnd || Math.random;
    this.usIds = ['hero', 'm1', 'm2', 'm3'].slice(0, this.n); this.themIds = ['o1', 'o2', 'o3', 'o4'].slice(0, this.n);
    this.me = 'hero'; this.favor = 'hero'; this.favorW = FAVOR; this.favorP = .95; this.setLevel(env.level ?? LEVELS[env.size] ?? LEVEL);
    this.flight = null; this.jobs = []; this.cmd = new Map(); this.contact = new Map(); this.next = new Map(); this.warned = new Set();
    this.lastTeam = 'us'; this.score = { us: 0, them: 0 }; this.aiT = 0; this.dead = false; this.restart = null; this.roles = null;
    this.meMove = null; // what his player is doing: { kind: 'jog'|'sprint'|'near'|'push'|'stay', until }
    this.meGo = 0; // until when it is his to go to their carrier (game time)
    this.meAuto = true; // his player wins a tackle by standing on their carrier (off once the STEAL button plays: fast.js)
    this.tackleT.us = .9; this.aiSpeed.us = 3.1; // (his friends win it back more slowly than he can with STEAL: more of the ball is his to win)
    this.count = { touches: {}, passes: 0, arrived: 0, cut: 0, goals: 0, assists: 0, steals: 0, lost: 0, theirCut: 0 };
    this.on = { gain: () => {}, goal: () => {}, out: () => {}, lost: () => {}, warn: () => {}, shot: () => {}, theirShot: () => false };
  }
  setLevel(level) { this.level = level; const o = this.opp = oppOf(level); this.tackleT = { ...(this.tackleT || {}), them: o.tackle }; this.aiSpeed = { ...(this.aiSpeed || {}), them: o.run }; this.standT = o.stand; }
  // ---------- set-up ----------
  formation(team, kick) {
    const L = this.L, W = this.W, c = L / 2, s = team === 'us' ? -1 : 1, n = this.n, k = L / 32;
    const rows = n === 3 ? [[1.2, .5], [5, .22], [5, .78]] : [[1.2, .5], [5.5, .2], [5.5, .8], [10, .5]];
    return rows.map(([d, f], i) => [c + s * (i === 0 && kick === team ? .7 : (d + (kick !== team && i === 0 ? 3 : 0)) * k), W * f]);
  }
  keeperAt(team) { return [team === 'us' ? .7 : this.L - .7, this.W / 2]; }
  setup(kick = 'us') {
    const us = this.formation('us', kick), th = this.formation('them', kick);
    this.sim.setup({ hero: us[0], mates: us.slice(1), opps: th, carrier: 'hero', ...(this.keepers ? { gk: { us: this.keeperAt('us'), them: this.keeperAt('them') } } : {}) });
    for (const a of this.sim.agents.values()) a.face = [a.team === 'us' ? 1 : -1, 0];
    this.flight = null; this.jobs.length = 0; this.cmd.clear(); this.lastTeam = kick; this.dead = false;
  }
  taker(team) { return team === 'us' ? this.me : 'o1'; } // (he kicks off for his team)
  // Everyone walks back to his place for a kick-off: `team` kicks off once they are there.
  kickoff(team, done) {
    const us = this.formation('us', team), th = this.formation('them', team);
    const all = [...this.usIds.map((id, i) => [id, us[i]]), ...this.themIds.map((id, i) => [id, th[i]])];
    const tk = this.taker(team), ti = all.findIndex(([id]) => id === tk), ci = team === 'us' ? 0 : this.usIds.length;
    if (ti >= 0 && ti !== ci) { const p = all[ti][1]; all[ti][1] = all[ci][1]; all[ci][1] = p; } // (the taker takes the middle place)
    for (const [id, p] of all) if (this.sim.a(id)) { this.sim.go(id, p[0], p[1], 5); this.cmd.set(id, this.sim.time + 99); }
    for (const t of ['us', 'them']) { const k = this.keeper(t); if (k) { const p = this.keeperAt(t); this.sim.go(k.id, p[0], p[1], 4); } }
    const b = this.sim.ball; Object.assign(b, { state: 'loose', carrier: null, x: this.L / 2, y: this.W / 2, z: 0, move: null, hidden: false, reach: null });
    this.flight = null; this.dead = true; this.restart = null; this.meMove = null;
    this.after(1.9, () => { this.cmd.clear(); this.dead = false; this.giveTo(tk, 'kickoff'); done?.(); });
  }
  // ---------- small queries ----------
  team(id) { return id && (id[0] === 'o' || id === 'k2' ? 'them' : 'us'); }
  ids(team) { return (team === 'us' ? this.usIds : this.themIds).filter(id => this.sim.a(id)); }
  keeper(team) { return this.keepers ? this.sim.a(team === 'us' ? 'k1' : 'k2') || null : null; }
  foes(team) { return this.ids(team === 'us' ? 'them' : 'us').map(id => this.sim.a(id)); }
  allFoes(team) { const k = this.keeper(team === 'us' ? 'them' : 'us'); return k ? [...this.foes(team), k] : this.foes(team); }
  owner() { const b = this.sim.ball; return b.state === 'carried' ? b.carrier : null; }
  dir(team) { return team === 'us' ? 1 : -1; }
  goalX(team) { return team === 'us' ? this.L : 0; }
  after(t, f) { this.jobs.push({ at: this.sim.time + t, f }); }
  isAI(id) { return id !== this.me; }
  // How open the line a → b is: the defender nearest to it, how far along it he is, and the gap (m).
  lane(a, b, team) { let best = null; for (const o of this.allFoes(team)) { const c = onLane(o, a, b); if (!best || c.d < best.d) best = { ...c, o }; } return best || { d: 99, o: null }; }
  // A pass a → b is open when nobody of theirs is near its line (more room the farther along he is) or right on b.
  passCheck(fromId, toId) {
    const s = this.sim, a = s.a(fromId), b = s.a(toId), team = this.team(fromId), cr = this.cutPace(team);
    const ln = this.lane(a, b, team), need = .75 + .07 * ln.along;
    const mk = this.foes(team).map(o => ({ o, d: dist(o, b) })).sort((p, q) => p.d - q.d)[0];
    const markedBy = mk && mk.d < 1.35 && (mk.o.x - b.x) * (a.x - b.x) + (mk.o.y - b.y) * (a.y - b.y) > -.3 ? mk.o : null;
    if (ln.d < need && ln.t < .95) return { open: false, why: 'lane', by: ln.o.id, gap: ln.d };
    if (markedBy) return { open: false, why: 'marked', by: markedBy.id, gap: ln.d };
    const pt = this.passTarget(a, b), cut = cutBy({ x: a.x, y: a.y }, pt, pt.sp, this.allFoes(team), cr.run, cr.react); // (and the ball itself would get there)
    if (cut) return { open: false, why: 'lane', by: cut.id, gap: ln.d };
    return { open: true, gap: ln.d, fwd: (b.x - a.x) * this.dir(team) };
  }
  // How fast the side defending a pass of `team` gets to its line (their players: by the level).
  cutPace(team) { return team === 'us' ? { run: this.opp.cutRun, react: this.opp.cutReact } : { run: 4, react: .3 }; } // (his friends, a little slower than their best: he can cut out more himself)
  shotCheck(id) {
    const a = this.sim.a(id), team = this.team(id), gx = this.goalX(team), d = Math.hypot(gx - a.x, this.W / 2 - a.y), range = team === 'them' ? this.opp.range : 11.5;
    const ys = [this.gy0 + .6, (this.gy0 + this.gy1) / 2, this.gy1 - .6], lanes = ys.map(y => ({ y, ...this.lane(a, { x: gx, y }, team) })).filter(l => !this.keeper(team === 'us' ? 'them' : 'us') || l.o?.id[0] !== 'k').sort((p, q) => q.d - p.d);
    const best = lanes[0] || { d: 99, y: this.W / 2 };
    if (d > range) return { good: false, why: 'far', d };
    if (best.d < .6) return { good: false, why: 'blocked', by: best.o?.id, d, y: best.y };
    return { good: true, y: best.y, d };
  }
  // ---------- actions ----------
  giveTo(id, how) {
    const f = this.flight; if (f) for (const x of [f.to, f.cut, f.by]) if (x) this.cmd.delete(x);
    const was = this.lastOwner; this.looseT = null; this.cmd.delete(id); this.sim.give(id); this.flight = null; this.lastTeam = this.team(id); this.contact.clear(); this.warned.clear(); this.lastOwner = id;
    this.safeT = this.sim.time + (how === 'tackle' || how === 'steal' ? 1.4 : .5);
    if (this.team(id) === 'us' && !this.sim.a(id)?.gk) this.count.touches[id] = (this.count.touches[id] || 0) + 1;
    if (id === this.me && (how === 'tackle' || how === 'steal' || how === 'cut')) this.count.steals++;
    if (was === this.me && this.team(id) !== 'us' && how !== 'pass') { this.count.lost++; this.meGo = this.sim.time + GO_T; }
    if (id === this.me) this.meMove = null;
    if (how === 'pass') this.passTo = id; else { this.passFrom = null; this.passTo = null; }
    if (this.team(id) === 'them') { const me = this.sim.a(this.me), b = this.sim.ball, nearest = this.ids('us').map(x => this.sim.a(x)).sort((p, q) => dist(p, b) - dist(q, b))[0]; if (me && nearest === me) this.meGo = Math.max(this.meGo, this.sim.time + GO_T); }
    this.on.gain(id, how);
  }
  // A pass to a friend (or a friend's run): a real ball. The defender who can get to its line first runs to cut it out.
  // Where a pass a → b goes (ahead of a friend on the run) and how fast.
  passTarget(a, b) {
    const d = dist(a, b), sp = clamp(6 + d * .45, 8, 13.5) * (a.team === 'them' ? this.opp.passK : 1), lead = b.sp > .6 ? Math.min(1.6, b.sp * d / sp * .7) : 0;
    const lx = b.tx - b.x, ly = b.ty - b.y, ll = Math.hypot(lx, ly) || 1;
    return { x: clamp(b.x + lx / ll * lead, .8, this.L - .8), y: clamp(b.y + ly / ll * lead, .8, this.W - .8), sp, d };
  }
  pass(fromId, toId) {
    const s = this.sim, a = s.a(fromId), b = s.a(toId); if (!a || !b) return;
    const pt = this.passTarget(a, b), d = pt.d, sp = pt.sp, tx = pt.x, ty = pt.y;
    s.stop(fromId); s.windup(fromId, 'pass'); this.cmd.set(fromId, s.time + .7);
    s.go(toId, tx, ty, Math.max(2.5, b.sp)); this.cmd.set(toId, s.time + 9); s.open(toId, this.goalX(this.team(toId)), this.W / 2);
    const team = this.team(fromId), cr = this.cutPace(team), cut = cutBy({ x: a.x, y: a.y }, { x: tx, y: ty }, sp, this.allFoes(team), cr.run, cr.react);
    if (cut) { const c = s.a(cut.id); if (!c.gk || dist(c, cut) < 3) { s.go(cut.id, cut.x, cut.y, 5.2); this.cmd.set(cut.id, s.time + 9); } }
    this.flight = { kind: 'pass', from: fromId, to: toId, cut: cut?.id || null, team, t0: s.time, me: fromId === this.me };
    if (fromId === this.me) this.count.passes++;
    this.after(.13, () => { if (this.flight?.from === fromId && s.ball.carrier === fromId) { s.kick(tx, ty, { speed: sp, arc: d > 11 ? .45 : .1 }); this.lastTeam = team; } });
  }
  // A shot. res: what js/shot.js says it does ({ res, to, at, speed, arc, t, held }); the ball goes there.
  shoot(id, res, kind = 'shot') {
    const s = this.sim, team = this.team(id), gx = this.goalX(team), dx = this.dir(team);
    s.stop(id); s.windup(id, 'shot'); this.cmd.set(id, s.time + .8);
    let tx = gx + dx * .7, ty = res.to.y, z1 = res.to.z ?? .35;
    if (res.res === 'save' || res.res === 'cleared') { tx = res.at.x; ty = res.at.y; z1 = res.at.z ?? .3; }
    else if (res.res === 'over' || res.res === 'wide') { tx = gx + dx * 2.2; z1 = res.to.z; }
    this.flight = { kind, from: id, team, res, t0: s.time };
    this.on.shot(id, res);
    this.after(.15, () => { if (s.ball.carrier === id) { s.kick(tx, ty, { speed: res.speed || 15, arc: res.arc ?? .25, z1 }); this.lastTeam = team; } });
  }
  // The shot the computer plays for a carrier: placed in the biggest space, past the keeper or not as js/shot.js says.
  aiShot(id) {
    const a = this.sim.a(id), team = this.team(id), k = this.keeper(team === 'us' ? 'them' : 'us'), c = this.shotCheck(id);
    return shotResult({ from: { x: a.x, y: a.y }, y: c.y, foot: 'placed', k: k && { x: k.x, y: k.y }, gx: this.goalX(team), rand: this.rnd });
  }
  dribble(id, x, y, sp = 3.6, secs = 1.2) { this.sim.go(id, clamp(x, 1, this.L - 1), clamp(y, 1, this.W - 1), sp); this.cmd.set(id, this.sim.time + secs); }

  // ---------- his player ----------
  // Without the ball: jog (near spot) or sprint (far spot) there. With it: a close dribble (near) or a big push and run
  // (far: the ball goes ahead and he runs onto it; anyone who gets there first has it). 'stay': stop (with the ball: he
  // stands on it).
  meTo(x, y, ring) {
    const s = this.sim, a = s.a(this.me); if (!a || this.dead) return;
    x = clamp(x, .8, this.L - .8); y = clamp(y, .8, this.W - .8);
    const has = this.owner() === this.me, t = s.time;
    if (ring === 0) { s.stop(this.me); this.meMove = { kind: 'stay', until: t }; this.cmd.delete(this.me); return; }
    if (!has) {
      const sp = ring === 2 ? 6 : 3.6; s.go(this.me, x, y, sp); this.meMove = { kind: ring === 2 ? 'sprint' : 'jog', until: t + dist(a, { x, y }) / sp + .3 };
      if (this.flight?.to === this.me) this.cmd.delete(this.me); return;
    }
    if (ring === 1) { const d = dist(a, { x, y }); this.dribble(this.me, x, y, 3.2, d / 3.2 + .3); this.meMove = { kind: 'near', until: t + d / 3.2 + .3 }; return; }
    // a big push: the ball 1.5 m short of the spot, fast along the grass; he sprints onto it
    const ang = Math.atan2(y - a.y, x - a.x), bx = clamp(x - Math.cos(ang) * 1.2, .8, this.L - .8), by = clamp(y - Math.sin(ang) * 1.2, .8, this.W - .8);
    s.windup(this.me, 'pass'); this.cmd.set(this.me, t + .25);
    this.flight = { kind: 'push', from: this.me, to: this.me, team: 'us', t0: t };
    this.meMove = { kind: 'push', until: t + 2.2 };
    this.after(.1, () => { if (s.ball.carrier === this.me) { s.kick(bx, by, { speed: 7.5, arc: 0, touch: true }); s.go(this.me, x, y, 6); this.cmd.set(this.me, s.time + 2); } });
  }

  // ---------- a steal (his STEAL button) ----------
  // At the right time (the ball off the carrier's foot, within his reach: rules.js stealNow) he wins it. Any other time
  // he lunges and misses: he is slowed a moment (LUNGE_T s) and the carrier gets past him.
  steal() {
    const s = this.sim, c = this.owner(), me = s.a(this.me); if (!c || this.team(c) !== 'them' || !me || this.dead) return null;
    const ca = s.a(c), b = s.ball;
    if (stealNow(ca, b, me)) { this.fx('won'); this.giveTo(this.me, 'steal'); return 'won'; }
    // the lunge: at the ball, short of it; he stops there a moment, and the carrier goes on past, safe for a moment
    const dx = b.x - me.x, dy = b.y - me.y, l = Math.hypot(dx, dy) || 1, r = Math.min(l, 1.1);
    s.go(this.me, me.x + dx / l * r, me.y + dy / l * r, 3); this.cmd.set(this.me, s.time + LUNGE_T); this.meMove = { kind: 'lunge', until: s.time + LUNGE_T };
    this.safeT = s.time + LUNGE_T; this.contact.delete(this.me);
    const gx = this.goalX('them'), dir = this.dir('them'); s.go(c, clamp(ca.x + dir * 3.5, 1, this.L - 1), clamp(ca.y - dy / l * 1.5, 1.2, this.W - 1.2), 3.6); this.cmd.set(c, s.time + .9); void gx;
    return 'missed';
  }

  // ---------- one step ----------
  step(dt) {
    const s = this.sim, b = s.ball, t = s.time;
    for (let i = this.jobs.length - 1; i >= 0; i--) if (this.jobs[i].at <= t) { const j = this.jobs.splice(i, 1)[0]; try { j.f(); } catch (e) { console.error(e); } }
    for (const [id, until] of this.cmd) if (until <= t) this.cmd.delete(id);
    if ((b.state === 'flying' || b.state === 'loose') && !this.dead) {
      if (b.x > this.L - .05 && b.y > this.gy0 && b.y < this.gy1 && (b.z || 0) < this.gh) return this.goal('us');
      if (b.x < .05 && b.y > this.gy0 && b.y < this.gy1 && (b.z || 0) < this.gh) return this.goal('them');
      if (b.x < -.2 || b.x > this.L + .2 || b.y < -.2 || b.y > this.W + .2) return this.out();
    }
    if (this.dead) { this.moveKeepers(); return; }
    const f = this.flight;
    if (f && b.state === 'flying') {
      const u = b.t || 0, foes = this.allFoes(f.team);
      if (f.kind === 'pass' || f.kind === 'push') {
        if (f.cut) { const c = s.a(f.cut); if (c && Math.hypot(c.x - b.x, c.y - b.y) < FOOT_REACH && (b.z || 0) < 1.2 && u > .05) { this.cutOut(f, f.cut); return; } }
        const hit = bodyHit(b, foes); if (hit) { this.cutOut(f, hit.id); return; }
        const r = s.a(f.to); if (f.kind === 'pass' && r && u > .5 && Math.hypot(r.x - b.x, r.y - b.y) < .55) { this.arrive(f); return; }
      } else if (f.kind === 'shot') { // (a shot meets bodies too: a defender in its way blocks it)
        const hit = bodyHit(b, this.foes(f.team)); if (hit) { this.fx('stolen'); this.giveTo(hit.id, 'block'); return; }
      }
    }
    if (b.state === 'loose' && !this.dead) {
      if (f?.kind === 'pass' || f?.kind === 'push') {
        const r = s.a(f.to), near = this.allFoes(f.team).sort((p, q) => dist(p, b) - dist(q, b))[0];
        if (near && dist(near, b) < LOOSE_R && (!r || dist(near, b) < dist(r, b))) { this.cutOut(f, near.id); return; }
        if (r && dist(r, b) < (f.kind === 'push' ? LOOSE_R : 1.8)) { if (f.kind === 'push') this.giveTo(f.to, 'push'); else this.arrive(f); return; }
        if (f.cut) { const c = s.a(f.cut); if (c && dist(c, b) < 1.2) { this.cutOut(f, f.cut); return; } }
        if (f.kind === 'push' && s.time - f.t0 < 3) { this.chase(b); this.moveTeams(dt); return; }
      }
      if (f?.kind === 'shot' && f.res && (f.res.res === 'save' || f.res.res === 'cleared')) { const k = f.res.res === 'save' ? this.keeper(f.team === 'us' ? 'them' : 'us') : s.a(f.res.by?.id); if (k) { this.giveTo(k.id, 'save'); this.flight = null; return; } }
      if (f) for (const x of [f.cut, f.to]) if (x && x !== this.me) this.cmd.delete(x); // (a pass that ended loose: its runners go back to playing)
      this.flight = null;
      this.chase(b);
    }
    // tackles
    const c = this.owner();
    if (c && !b.reach) {
      const ca = s.a(c), safe = s.time < (this.safeT || 0);
      for (const o of this.foes(this.team(c))) {
        const d = dist(o, ca), k = o.id;
        if (d < .95 && !safe && (o.id !== this.me || this.meAuto)) {
          let need = this.tackleT[o.team] ?? TACKLE_T;
          if (c === this.me) {
            const mv = this.meMove, moving = mv && mv.kind === 'near' && t < mv.until, ahead = (o.x - ca.x) * (ca.tx - ca.x) + (o.y - ca.y) * (ca.ty - ca.y) > 0;
            if (moving && !ahead) { this.contact.delete(k); continue; } // dribbling away from him: he cannot get it
            need = moving ? TACKLE_T + .3 : this.standT; // standing on it: he closes in, a warning, then the tackle (by the level)
          }
          if (o.id === this.me) need = 1.2;
          const v = (this.contact.get(k) || 0) + dt; this.contact.set(k, v);
          if (c === this.me && v >= WARN_AT && !this.warned.has(k)) { this.warned.add(k); this.on.warn(k); }
          if (v > need) { this.fx('stolen'); this.sfx('down'); const was = c; this.giveTo(k, 'tackle'); this.on.lost(was, k); return; }
        } else this.contact.delete(k);
      }
    }
    if (c && this.sim.a(c)?.gk && this.isAI(c) && !this.cmd.has(c)) this.keeperBall(c, dt);
    this.moveTeams(dt);
    this.moveKeepers();
  }
  arrive(f) {
    if (f.me) this.count.arrived++;
    if (f.team === 'them' && this.rnd() < this.opp.loose) { // their first touch runs away from him: a loose ball for whoever gets there
      const s = this.sim, r = s.a(f.to), b = s.ball, dx = b.x - s.a(f.from).x, dy = b.y - s.a(f.from).y, l = Math.hypot(dx, dy) || 1;
      Object.assign(b, { state: 'loose', carrier: null, x: clamp(r.x + dx / l * 1.1, .5, this.L - .5), y: clamp(r.y + dy / l * 1.1, .5, this.W - .5), z: 0, move: null, reach: null });
      this.flight = null; this.lastTeam = 'them'; return;
    }
    this.passFrom = f.from; this.giveTo(f.to, 'pass');
  }
  cutOut(f, id) { if (f.me) this.count.cut++; else if (f.team === 'them' && id === this.me) { /* his own cut: counted in giveTo */ } if (f.team === 'us' && !f.me) this.count.theirCut++; this.fx('stolen'); this.giveTo(id, 'cut'); }
  // A loose ball: the nearest of each side (not his player: he goes when he says) runs to it; anyone within reach has it.
  chase(b) {
    const s = this.sim;
    for (const team of ['us', 'them']) {
      if (this.restart && this.restart.team !== team) continue;
      const all = [...this.ids(team).map(id => s.a(id)), ...(this.keeper(team) && dist(this.keeper(team), b) < 4 ? [this.keeper(team)] : [])].sort((p, q) => dist(p, b) - dist(q, b));
      if (all[0] && dist(all[0], b) < LOOSE_R) { this.giveTo(all[0].id, 'loose'); return; }
      const near = all.find(a => a.id !== this.me); if (!near) continue;
      const meA = team === 'us' && s.a(this.me); if (meA && dist(meA, b) < dist(near, b) + 1.5 && dist(meA, b) < 6 && !this.restart && (this.looseT = (this.looseT ?? s.time)) > s.time - 1.5) continue; // (a loose ball he is about as near to as any friend is his to go for, for a moment)
      if (!this.cmd.has(near.id) || this.restart?.id === near.id) s.go(near.id, b.x, b.y, this.restart?.team && this.restart.team !== team ? 0 : 4.6);
    }
  }
  goal(team) {
    this.dead = true; this.score[team]++; this.flight = null; this.meMove = null;
    if (team === 'us' && this.lastOwner === this.me) this.count.goals++;
    else if (team === 'us' && this.passFrom === this.me && this.passTo === this.lastOwner) this.count.assists++; // (his pass, and the friend he found scored)
    this.fx(team === 'us' ? 'goal' : 'goalAgainst');
    for (const a of this.sim.agents.values()) this.sim.stop(a.id);
    this.on.goal(team);
  }
  out() {
    const s = this.sim, b = s.ball, team = this.lastTeam === 'us' ? 'them' : 'us';
    const x = clamp(b.x, .6, this.L - .6), y = clamp(b.y, .4, this.W - .4);
    Object.assign(b, { state: 'loose', carrier: null, x, y, z: 0, move: null, reach: null }); this.flight = null;
    const near = this.ids(team).filter(id => id !== this.me).map(id => s.a(id)).sort((p, q) => dist(p, b) - dist(q, b))[0];
    this.restart = { team, id: near.id }; this.cmd.set(near.id, s.time + 6); s.go(near.id, x, y, 4.6);
    this.sfx('click'); this.on.out(team);
    this.after(6, () => { this.restart = null; });
  }
  // ---------- the keepers (5 v 5) ----------
  moveKeepers() {
    const s = this.sim, b = s.ball, gc = this.W / 2;
    for (const team of ['us', 'them']) {
      const k = this.keeper(team); if (!k || this.owner() === k.id || this.cmd.has(k.id)) continue;
      const [x0] = this.keeperAt(team), y = clamp(gc + (b.y - gc) * .35, this.gy0 + .5, this.gy1 - .5);
      const y2 = team === 'them' ? clamp(gc + (b.y - gc) * this.opp.keeper, this.gy0 + .5, this.gy1 - .5) : y; // (theirs follows the ball less: room in the corners)
      if (Math.hypot(k.tx - x0, k.ty - y2) > .15) s.go(k.id, x0, y2, 2.6);
    }
  }
  // A keeper with the ball: a moment, then a pass to the most open friend.
  keeperBall(id, dt) {
    if ((this.kT = (this.kT ?? 1.2) - dt) > 0) return; this.kT = 1.2;
    const team = this.team(id), opts = this.ids(team).map(m => ({ m, ...this.passCheck(id, m) })).filter(o => o.open);
    const to = (opts.length ? opts : this.ids(team).map(m => ({ m }))).sort((p, q) => (q.gap || 0) - (p.gap || 0))[0]?.m; if (to) this.pass(id, to);
  }
  // ---------- everyone nobody told what to do ----------
  moveTeams(dt) {
    const s = this.sim, b = s.ball, c = this.owner(), team = c ? this.team(c) : this.flight?.team || this.restart?.team || this.lastTeam, t = s.time;
    if (c && this.isAI(c) && !s.a(c).gk && !this.cmd.has(c) && !this.flight) this.aiCarrier(c, dt);
    // the side with the ball: support places
    for (const id of this.ids(team)) {
      if (id === c || this.cmd.has(id) || id === this.me || this.flight?.to === id) continue;
      if ((this.next.get(id) || 0) > t) continue;
      this.next.set(id, t + SUPPORT_EVERY * (.85 + .3 * this.rnd()));
      const p = this.supportSpot(id, team); s.go(id, p.x, p.y, 3.4);
    }
    // the other side: one presses the ball, the rest mark goal-side
    const def = team === 'us' ? 'them' : 'us', dx = this.dir(def), ownX = def === 'us' ? 0 : this.L;
    const free = this.ids(def).filter(id => !this.cmd.has(id) && id !== this.me && this.flight?.cut !== id);
    let presser = free.slice().sort((p, q) => dist(s.a(p), b) - dist(s.a(q), b))[0] || null;
    if (def === 'us' && presser) { // his: when he is the nearest, or has just lost it, it is his to go (for GO_T s at most)
      const me = s.a(this.me), md = me ? dist(me, b) : 99;
      if ((t < this.meGo && md < dist(s.a(presser), b) + 3) || md < 2.2) presser = null; // (and when he is on the ball already, nobody doubles up)
    }
    this.presser = presser;
    if (presser && b.state !== 'loose') {
      const ca = c ? s.a(c) : b, gx = ownX - ca.x, gy = this.W / 2 - ca.y, gl = Math.hypot(gx, gy) || 1;
      const meDrib = c === this.me && this.meMove?.kind === 'near' && t < this.meMove.until, off = c !== this.me ? .75 : meDrib ? .9 : .45; // (on a player standing on the ball he comes right in: the tackle comes after the warning)
      s.go(presser, ca.x + gx / gl * off, ca.y + gy / gl * off, def === 'us' ? 4.4 : this.opp.press);
    }
    // markers: each takes the attacker nearest his own goal that nobody has yet
    const att = this.ids(team).filter(id => id !== c).map(id => s.a(id)).sort((p, q) => (p.x - q.x) * -dx);
    const left = free.filter(id => id !== presser);
    for (const a of att) {
      if (!left.length) break;
      left.sort((p, q) => dist(s.a(p), a) - dist(s.a(q), a)); const m = left.shift();
      if ((this.next.get(m) || 0) > t) continue; this.next.set(m, t + (def === 'them' ? this.opp.markEvery : .5));
      const gx = ownX - a.x, gy = this.W / 2 - a.y, gl = Math.hypot(gx, gy) || 1;
      const tx = a.x + gx / gl * 1.5 + (b.x - a.x) * .18, ty = a.y + gy / gl * 1.5 + (b.y - a.y) * .18;
      s.go(m, clamp(tx, .8, this.L - .8), clamp(ty, .8, this.W - .8), def === 'them' ? this.opp.mark : 3.2);
    }
    for (const m of left) { if ((this.next.get(m) || 0) > t) continue; this.next.set(m, t + .8); const x = clamp(ownX + (b.x - ownX) * .45, 1, this.L - 1), y = clamp(this.W / 2 + (b.y - this.W / 2) * .5, 1, this.W - 1); s.go(m, x, y, 2.6); }
  }
  // A place for a friend of the ball: an anchor by his role (wide on either side, ahead, behind), then the most open
  // point near it: the clearest line from the ball, room from their players, and SPREAD m from his own team (his player
  // too, wherever he goes).
  supportSpot(id, team) {
    const s = this.sim, b = s.ball, dx = this.dir(team), L = this.L, W = this.W;
    const mates = this.ids(team).filter(x => x !== id && x !== this.owner()).map(x => s.a(x));
    const by = clamp(b.y, 3, W - 3), deep = (b.x - (team === 'us' ? 0 : L)) * dx > L * .6, wide = Math.min(7, W * .32);
    const anchors = [[b.x + dx * 3, by + wide], [b.x + dx * 3, by - wide], [b.x + dx * 9, W / 2 + (b.y < W / 2 ? 2.5 : -2.5)], [b.x - dx * 6, by]];
    const sup = this.ids(team).filter(x => x !== this.owner() && x !== this.me), use = sup.length <= 1 ? [b.y < W / 2 ? 0 : 1] : sup.length === 2 ? [0, 1] : deep ? [0, 1, 3] : [0, 1, 2];
    // (his player holds a place too: the role nearest him is his, so nobody runs to where he is)
    const meA = team === 'us' ? s.a(this.me) : null, mine = meA ? anchors.map((a, i) => [i, Math.hypot(meA.x - a[0], meA.y - a[1])]).sort((p, q) => p[1] - q[1])[0][0] : -1;
    const key = sup.join() + deep + mine;
    if (!this.roles || this.roles.team !== team || this.roles.key !== key) {
      const map = {}, left = new Set(sup), order = [...use.filter(i => i !== mine), ...[0, 1, 2, 3].filter(i => !use.includes(i) && i !== mine)];
      for (const i of order) { let pick = null, pd = 1e9; for (const x of left) { const q = s.a(x), d = Math.hypot(q.x - anchors[i][0], q.y - anchors[i][1]); if (d < pd) { pd = d; pick = x; } } if (pick) { map[pick] = i; left.delete(pick); } }
      for (const x of left) map[x] = 3;
      this.roles = { team, map, key };
    }
    const an = anchors[this.roles.map[id] ?? 0], anchor = [clamp(an[0], 2, L - 2), clamp(an[1], 1.5, W - 1.5)];
    const foes = this.allFoes(team), near = meA ? [...mates, meA] : mates; let best = null, bs = -1e9;
    for (let k = 0; k < 9; k++) {
      const r = k ? 2.6 : 0, a = k * Math.PI / 4, x = clamp(anchor[0] + Math.cos(a) * r, 1.3, L - 1.3), y = clamp(anchor[1] + Math.sin(a) * r, 1.3, W - 1.3), p = { x, y };
      let lane = 99, room = 99; for (const o of foes) { lane = Math.min(lane, onLane(o, b, p).d); room = Math.min(room, dist(o, p)); }
      const crowd = near.reduce((m, q) => Math.min(m, Math.hypot((q.id === this.me ? q.x : q.tx) - x, (q.id === this.me ? q.y : q.ty) - y)), 99);
      const sc = Math.min(lane, 3) * 1.2 + Math.min(room, 4) * .5 - Math.hypot(x - anchor[0], y - anchor[1]) * .15 - (crowd < SPREAD ? (SPREAD - crowd) * 1.2 : 0) - (Math.hypot(x - b.x, y - b.y) < 3.5 ? 2 : 0);
      if (sc > bs) { bs = sc; best = p; }
    }
    return best;
  }
  nearGoal(id) { const a = this.sim.a(id); return !!a && Math.hypot(this.L - a.x, this.W / 2 - a.y) < FIND; }
  // The computer's carrier: shoot when close and clear, pass when pressed (or to a friend well ahead in the clear; to his
  // player FAVOR to 1 when his line is open), else dribble at goal, away from the nearest defender.
  aiCarrier(id, dt) {
    const s = this.sim, a = s.a(id), team = this.team(id), dx = this.dir(team);
    if ((this.aiT -= dt) > 0) return; this.aiT = .45;
    // his friends look for him near goal: when his line is open and he is within FIND m of their goal, they pass to him
    // FIND_P of the time before they would shoot themselves
    if (team === 'us' && this.favor !== id && this.nearGoal(this.favor) && this.passCheck(id, this.favor).open && this.rnd() < FIND_P) { this.pass(id, this.favor); return; }
    const shot = this.shotCheck(id), sp = team === 'them' ? this.opp.shootP : .7; if ((shot.good && this.rnd() < sp) || (shot.why === 'blocked' && shot.d < 7 && this.rnd() < sp * .35)) { // (close in, now and then he tries it anyway: a body may block it)
      const res = this.aiShot(id);
      if (team === 'them' && this.on.theirShot(id, res)) return; // (the keeper turn: fast.js takes it from here)
      this.shoot(id, res); return;
    }
    const press = this.foes(team).some(o => dist(o, a) < 2.4);
    const opts = this.ids(team).filter(m => m !== id).map(m => ({ m, ...this.passCheck(id, m) })).filter(o => o.open).sort((p, q) => q.fwd - p.fwd);
    // his player: they count him open a little sooner than anyone else (a gap of 0.55 m on the line and 1.1 m of room),
    // but never with a defender on his line
    if (team === 'us' && this.favor && this.favor !== id && !opts.some(o => o.m === this.favor)) {
      const f = s.a(this.favor), ln = this.lane(a, f, team), room = Math.min(...this.foes(team).map(o => dist(o, f)));
      const pt = f && this.passTarget(a, f), cut = pt && cutBy({ x: a.x, y: a.y }, pt, pt.sp, this.allFoes(team));
      if (f && !cut && ln.d >= .55 && room >= 1.1 && dist(a, f) > 2.5) opts.push({ m: this.favor, open: true, fwd: (f.x - a.x) * dx, gap: ln.d });
    }
    const fav = team === 'us' && this.favor && opts.find(o => o.m === this.favor);
    // (his friends keep the ball moving through him: a friend passes to another friend only under pressure or to one far
    // ahead, otherwise he carries it on until his player is open)
    const ahead = opts[0] && opts[0].fwd > (team === 'us' ? 8 : 5);
    if (opts.length && (press || (ahead && this.rnd() < .35) || (fav && this.rnd() < this.favorP))) { this.pass(id, team === 'us' ? pickPass(opts, this.favor, this.favorW, this.rnd) : opts[0].m); return; }
    const near = this.foes(team).sort((p, q) => dist(p, a) - dist(q, a))[0], side = near && Math.abs(near.y - a.y) < 2.5 && (near.x - a.x) * dx > 0 ? (near.y > a.y ? -1 : 1) * 2.2 : 0;
    s.go(id, clamp(a.x + dx * 3, 1, this.L - 1), clamp(a.y + side + (this.W / 2 - a.y) * .15, 1.2, this.W - 1.2), this.aiSpeed[team] ?? 3.1);
  }
}
