// The rondos on the game's own sim (js/sim.js: bodies, the ball, the dribble), with no page: mini/rondo.js says where
// players may stand, when a line is open and how hard each level is; this plays a round, with the computer's players.
// The tests and the bots drive it as it is (tick, moveTo, passTo, steal); mini/rondo-ui.js puts it on the page.
//
// The ball is a real object, as in Fast mode (fast/rules.js cutBy, bodyHit): a pass that comes within a defender's
// reach is his (in 'win', within his body; within his reach it glows, and STEAL takes it), and a pass never goes
// through anyone. Ids: 'keep': hero (the near side), m1 (left), m2 (far), m3 (right); defenders o1, o2. 'win': hero
// (the defender, in the middle); passers o1 (far), o2 (left), o3 (right), o4 (near).
import { Sim } from '../sim.js';
import { clamp, dist, cutBy, bodyHit, stealNow, REACH as FOOT, BODY_R, STEAL_R } from '../fast/rules.js';
import * as K from './rondo.js';

const PASS_R = 1.1, FREE = 3, PROTECT = 2.4, LOOK = .4, OFF_MAX = 2, LOOSE_R = .62, TACKLE_R = .95, WARN_AT = .15, SAFE = .5, FAVOR = .9, TAKE = 1;
const SIDE = { keep: { hero: 'near', m1: 'left', m2: 'far', m3: 'right' }, win: { o1: 'far', o2: 'left', o3: 'right', o4: 'near' } };
const unit = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l, l }; };

export class Rondo {
  // o: { mode: 'keep' | 'win', cx, cy (the box's middle), rnd, fx(ev), sfx(name) }
  constructor({ mode = 'keep', cx = 15, cy = 10, rnd = Math.random, fx = () => {}, sfx = () => {} } = {}) {
    Object.assign(this, { mode, cx, cy, rnd, fx, sfx });
    this.sim = new Sim(); this.phase = 'idle'; this.on = false; this.slow = this.slowTo = K.SPEED; this.holding = false; this.real = 0;
    this.ui = { glow: {}, clock: 0, lines: null, aims: null, timer: null, ballGlow: false, heroRing: false };
    this.hooks = {}; // go(), pass(from, to, open), gain(id, how), warn(id), lunge(), glow(on), end(result)
    this.jobs = []; this.off = new Set(); this.busy = new Map(); this.next = new Map(); this.contact = new Map(); this.flight = null; this.done = null; this.box = null; this.D = null;
  }
  // ---------- who is who ----------
  sideOf(id) { return SIDE[this.mode][id] || null; }
  keeperIds() { return this.mode === 'keep' ? ['hero', 'm1', 'm2', 'm3'].filter(id => this.sim.a(id)) : ['o1', 'o2', 'o3', 'o4'].filter(id => this.sim.a(id)); } // (the side that keeps the ball)
  takerIds() { return this.mode === 'keep' ? ['o1', 'o2'].filter(id => this.sim.a(id)) : ['hero']; } // (the side in the middle)
  takers() { return this.takerIds().map(id => this.sim.a(id)); }
  // The middle as a line sees it: where each is, and where he will be in LOOK s on his way (a defender running across a
  // line shuts it, though he is not on it yet). For every 'is it open' (his friends' passes, the gold on friends, hints).
  watch() { const out = []; for (const o of this.takers()) { out.push(o); const d = Math.hypot(o.tx - o.x, o.ty - o.y), k = d > .05 ? Math.min(d, (o.speed || 0) * LOOK) / d : 0; if (k) out.push({ id: o.id, x: o.x + (o.tx - o.x) * k, y: o.y + (o.ty - o.y) * k }); } return out; }
  // Whether a pass from → to (ids) is open now (margin m to spare).
  openLine(from, to, speed, margin = 0) { const a = this.sim.a(from), pc = this.pace(); return K.lineOpen(a, this.passPoint(from, to), speed, this.watch(), pc.run, pc.react, margin); }
  keeps(id) { return this.keeperIds().includes(id); }
  owner() { const b = this.sim.ball; return b.state === 'carried' ? b.carrier : null; }
  after(t, f) { this.jobs.push({ at: this.sim.time + t, f }); }
  // How fast the middle gets to a pass line: their defenders by the level ('keep'); him ('win').
  pace() { return this.mode === 'keep' ? { run: this.D.cutRun, react: this.D.cutReact } : { run: K.ME.run, react: K.ME.react }; }

  // ---------- a round ----------
  // Sets up a round at level L and plays it: resolves its result ({ res: 'kept' | 'lost' (keep), 'won' | 'time' (win),
  // why, level, sec, ... }) once the moment after it is over.
  round(L) { this.setup(L); return new Promise(res => { this.done = res; }); }
  setup(L) {
    const D = this.D = this.mode === 'keep' ? K.keepLevel(L) : K.winLevel(L), b = this.box = K.makeBox(this.cx, this.cy, D.size), s = this.sim, c = { x: b.cx, y: b.cy };
    this.level = L;
    const at = id => K.sideAt(b, this.sideOf(id), (this.rnd() - .5) * b.h * .5);
    if (this.mode === 'keep') {
      const defs = D.two ? [[b.cx + .3, b.cy - .8], [b.cx + 1.6, b.cy + .9]] : [[b.cx + .3, b.cy]];
      const p = id => { const q = at(id); return [q.x, q.y]; };
      s.setup({ hero: p('hero'), mates: [p('m1'), p('m2'), p('m3')], opps: defs, carrier: 'hero' });
    } else {
      const ids = ['o1', 'o2', 'o3', 'o4'].slice(0, D.n);
      s.setup({ hero: [b.cx - .6, b.cy], mates: [], opps: ids.map(id => { const q = at(id); return [q.x, q.y]; }), carrier: 'o1' });
    }
    s.restores++; // (every body starts afresh: pro/motion.js)
    for (const a of s.agents.values()) { const u = unit(a, c); a.face = [u.x, u.y]; }
    const cr = s.a(this.mode === 'keep' ? 'hero' : 'o1'), u = unit(cr, c);
    Object.assign(s.ball, { x: cr.x + u.x * .4, y: cr.y + u.y * .4, z: 0, state: 'carried', carrier: cr.id, h: Math.atan2(u.y, u.x), move: null, reach: null, got: -9 });
    this.flight = null; this.jobs.length = 0; this.off.clear(); this.busy.clear(); this.next.clear(); this.contact.clear(); this.warned = false; this.goAt = null;
    this.gotAt = s.time; this.safeT = s.time + 1; this.left = this.len = K.ROUND[this.mode]; this.phase = 'ready'; this.readyEnd = s.time + K.READY_S; this.result = null;
    this.defT = 0; this.aiT = 0; this.shadow = null; this.coverOf = null; this.glowUntil = -9; this.glowNext = -9; this.glowWin = null; this.lungeT = -9; this.wasGlow = false;
    this.slowTo = K.SPEED; this.t0 = s.time; this.real0 = this.real;
    this.stats = { passes: 0, myPasses: 0, myTouches: 0, toMe: 0, toMeClosed: 0, moves: 0, steals: 0, lunges: 0, glows: 0, glowS: 0 };
    this.ui.glow = {}; this.ui.ballGlow = false;
  }
  end(res, why, by = null) {
    if (this.phase !== 'play') return;
    const s = this.sim; this.phase = 'after'; this.afterEnd = s.time + K.AFTER_S; this.flight = null;
    for (const a of s.agents.values()) if (a.id !== by) s.stop(a.id);
    this.result = { res, why, by, fault: res === 'lost' ? this.fault : null, level: this.level, sec: +(s.time - this.t0).toFixed(2), real: +(this.real - this.real0).toFixed(2), ...this.stats };
    this.ui.ballGlow = false; this.slowTo = K.SPEED;
    this.hooks.end?.(this.result);
  }

  // ---------- his taps ----------
  // A tap on the grass at p: 'keep' along his side (the nearest point of it), 'win' anywhere in the box. With the ball
  // a touch along the line; without it a jog, or a sprint when it is far. Returns where he goes (null: he cannot now).
  moveTo(p) {
    if (this.phase !== 'play' && this.phase !== 'ready') return null;
    const s = this.sim, me = s.a('hero'); if (!me) return null;
    if (this.mode === 'win' && s.time < this.lungeT) return null; // (after a lunge he is slow a moment)
    const q = this.mode === 'keep' ? K.toSide(this.box, 'near', p) : K.inBox(this.box, p, .35), d = dist(me, q);
    this.stats.moves++;
    if (d < .3) { s.stop('hero'); this.goAt = null; return { ...q, stay: true }; }
    const has = this.owner() === 'hero';
    s.go('hero', q.x, q.y, has ? K.ME.dribble : d > K.ME.far ? K.ME.sprint : K.ME.jog); this.goAt = q;
    if (this.flight?.to === 'hero') this.flight.heroMoved = true; // (he left a pass coming to him)
    return q;
  }
  // A tap on a friend: a pass ('keep', with the ball). Returns whether it went.
  passTo(id) {
    if (this.mode !== 'keep' || this.phase !== 'play' || this.owner() !== 'hero' || !this.keeps(id) || id === 'hero') return false;
    return this.pass('hero', id, K.ME.pass);
  }
  // STEAL ('win'): in the glow it is his; at any other time he lunges, is slow a moment, and they play round him.
  steal() {
    if (this.mode !== 'win' || this.phase !== 'play') return null;
    const s = this.sim, me = s.a('hero'), b = s.ball; if (s.time < this.lungeT) return null;
    if (this.glowing()) { this.stats.steals++; this.take('hero', 'steal'); return 'won'; }
    const u = unit(me, b), r = Math.min(u.l, 1); s.go('hero', me.x + u.x * r, me.y + u.y * r, 3);
    this.lungeT = s.time + K.ME.lunge; this.glowNext = this.lungeT; this.glowWin = null; this.stats.lunges++;
    const c = this.owner(); if (c) { this.dribbleAway(c, 3.2); this.busy.set(c, s.time + .8); } // (the carrier goes on past him)
    this.hooks.lunge?.();
    return 'missed';
  }
  // Whether the ball glows now: it can be won with STEAL ('win').
  glowing() { return this.mode === 'win' && this.phase === 'play' && this.sim.time < this.glowUntil && this.sim.time >= this.lungeT; }

  // ---------- the ball ----------
  // Where a pass a → b goes: his feet, or a little ahead of where he is going on his side.
  passPoint(from, to) {
    const s = this.sim, r = s.a(to), side = this.sideOf(to), d = Math.hypot(r.tx - r.x, r.ty - r.y), lead = d > .3 ? Math.min(1, d) : 0;
    const p = { x: r.x + (r.tx - r.x) / (d || 1) * lead, y: r.y + (r.ty - r.y) / (d || 1) * lead };
    return side ? K.toSide(this.box, side, p) : p;
  }
  pass(from, to, speed) {
    const s = this.sim, a = s.a(from), r = s.a(to); if (!a || !r || this.owner() !== from || this.flight) return false;
    const tgt = this.passPoint(from, to), pc = this.pace(), open = this.openLine(from, to, speed);
    s.stop(from); s.windup(from, 'pass'); this.busy.set(from, s.time + .5);
    s.go(to, tgt.x, tgt.y, Math.max(2.5, Math.min(4, r.speed || 0))); this.goAt = to === 'hero' ? null : this.goAt; if (to !== 'hero') this.busy.set(to, s.time + 9); // (he goes to meet it too, as in Fast mode; a tap of his still sends him elsewhere)
    const cut = this.mode === 'keep' ? cutBy(a, tgt, speed, this.takers(), pc.run, pc.react) : null; // (their defender who can get to its line runs there)
    if (cut) { const q = K.inBox(this.box, cut, .3); s.go(cut.id, q.x, q.y, pc.run * 1.05); this.busy.set(cut.id, s.time + 2.5); }
    this.flight = { kind: 'pass', from, to, t0: s.time, speed, tgt, cut: cut?.id || null, kicked: false };
    this.stats.passes++; if (from === 'hero') this.stats.myPasses++;
    if (to === 'hero') { this.stats.toMe++; if (!open) this.stats.toMeClosed++; }
    this.after(.13, () => { const f = this.flight; if (!f || f.from !== from || s.ball.carrier !== from) return;
      if (this.mode === 'keep' && from !== 'hero' && !this.openLine(from, to, speed, 0)) { this.flight = null; this.busy.delete(to); if (f.cut) this.busy.delete(f.cut); return; } // (a friend sees the line close as he shapes to pass: he keeps it)
      s.kick(tgt.x, tgt.y, { speed, arc: .05 }); f.kicked = true; });
    this.hooks.pass?.(from, to, open);
    return true;
  }
  // The ball is his (one of the keeping side): a pass got there, a loose ball, a heavy touch gathered.
  give(id, how) {
    const s = this.sim, f = this.flight; if (f) for (const x of [f.cut, f.to]) if (x) this.busy.delete(x);
    this.flight = null; s.give(id); this.contact.clear(); this.warned = false; this.gotAt = s.time; this.safeT = s.time + SAFE; this.busy.delete(id); this.shut = { none: null, me: null };
    if (id !== 'hero' && this.keeps(id)) { if (this.off.has(id)) { const q = this.onLine(id, s.a(id)); s.go(id, q[0], q[1], 2.2); this.busy.set(id, s.time + .9); } else s.stop(id); } // (off his line for a loose ball: back onto it)
    if (id === 'hero') this.stats.myTouches++;
    this.hooks.gain?.(id, how);
  }
  // The middle wins it: in 'keep' the round is lost; in 'win' it is won.
  take(id, how) {
    const s = this.sim, f = this.flight, c = this.owner();
    // whose doing it was ('keep'): his pass, a pass to him he left, him standing on it, or a friend left with no line
    // because his own stayed shut (the only way a friend loses it: tackles)
    this.fault = this.mode !== 'keep' ? null : how === 'tackle' ? (c === 'hero' || this.shutFor(this.shut?.me) >= PROTECT ? 'his' : 'team') : f && (f.from === 'hero' || (f.to === 'hero' && (f.heroMoved || how === 'loose'))) ? 'his' : 'team';
    this.flight = null; s.give(id); this.contact.clear(); if (this.mode === 'win') this.slowMoment = s.time + .9; // (his steal, a little slow, so he sees it)
    this.fx(this.mode === 'keep' ? 'stolen' : 'won'); this.sfx(this.mode === 'keep' ? 'down' : 'star');
    this.hooks.gain?.(id, how);
    this.end(this.mode === 'keep' ? 'lost' : 'won', how, id);
  }
  // A pass that reached its man; in 'win' a first touch may run loose (a heavy touch: toward the middle, where he is).
  arrive(f) {
    const s = this.sim, r = s.a(f.to);
    if (this.mode === 'win' && f.kind === 'pass' && this.rnd() < this.D.heavy) {
      const u = unit(r, { x: this.box.cx, y: this.box.cy }), d = 1.2 + this.rnd() * .5, tx = r.x + u.x * d, ty = r.y + u.y * d, b = s.ball;
      Object.assign(b, { x: r.x + u.x * .3, y: r.y + u.y * .3, z: 0, state: 'loose', carrier: null, move: null, reach: null }); s.kick(tx, ty, { speed: 2.6, arc: 0, touch: true });
      this.flight = { kind: 'heavy', from: f.to, to: f.to, t0: s.time, tgt: { x: tx, y: ty }, cut: null };
      this.off.add(f.to); s.go(f.to, tx, ty, 1.8); this.busy.set(f.to, s.time + 3); // (he steps in off his line for it, at a walk: a moment for STEAL)
      this.fx('touch'); return;
    }
    this.give(f.to, f.kind === 'heavy' ? 'gather' : 'pass');
  }
  onLine(id, p) { const side = this.sideOf(id), q = side ? K.toSide(this.box, side, p) : p; return [q.x, q.y]; }
  dribbleAway(id, sp = 2.6) { // along his side, away from the nearest of the middle
    const s = this.sim, a = s.a(id), side = this.sideOf(id); if (!side) return;
    const o = this.takers().sort((p, q) => dist(p, a) - dist(q, a))[0], t = K.along(this.box, side, a), to = o ? (K.along(this.box, side, o) > t ? -1 : 1) : 1, lim = K.reachOf(this.box);
    const q = K.sideAt(this.box, side, clamp(t + to * 3, -lim, lim)); s.go(id, q.x, q.y, sp);
  }

  // ---------- one frame ----------
  // dt: real seconds (none while paused). Play runs at SPEED of real time, HOLD while a finger is held down.
  tick(dt) {
    if (!dt || this.phase === 'idle') return;
    this.real += dt;
    this.slowTo = this.holding ? K.HOLD : this.slowMoment > this.sim.time ? .35 : K.SPEED;
    this.slow += (this.slowTo - this.slow) * (1 - Math.exp(-dt * (this.slowTo > this.slow ? 5 : 8)));
    this.step(dt * this.slow);
  }
  step(dt) {
    const s = this.sim; if (this.phase === 'idle' || !dt) return;
    for (let i = this.jobs.length - 1; i >= 0; i--) if (this.jobs[i].at <= s.time) { const j = this.jobs.splice(i, 1)[0]; try { j.f(); } catch (e) { console.error(e); } }
    for (const [id, until] of this.busy) if (until <= s.time) this.busy.delete(id);
    if (this.phase === 'play') { if (this.mode === 'keep') this.aiKeep(dt); else this.aiWin(dt); }
    const n = Math.max(1, Math.ceil(dt / (1 / 60))); for (let i = 0; i < n; i++) s.step(dt / n);
    this.hold();
    this.ui.clock += dt;
    if (this.phase === 'ready') { if (s.time >= this.readyEnd) { this.phase = 'play'; this.hooks.go?.(); } }
    else if (this.phase === 'play') {
      this.ballCheck(); if (this.phase === 'play') this.tackles(dt);
      if (this.mode === 'win') this.glowStep(dt);
      this.left -= dt; if (this.phase === 'play' && this.left <= 0) this.end(this.mode === 'keep' ? 'kept' : 'time', 'time');
    } else if (this.phase === 'after' && s.time >= this.afterEnd) { this.phase = 'idle'; const d = this.done; this.done = null; d?.(this.result); }
    this.ui.timer = this.phase === 'play' || this.phase === 'ready' ? { left: clamp(this.left / this.len, 0, 1), wide: false, scale: .62 } : null;
    this.ui.ballGlow = this.glowing();
  }
  // Everyone where he may be: the outside players on their side, the middle in the box (and the ball, at rest, in it).
  hold() {
    const s = this.sim, b = this.box;
    for (const a of s.agents.values()) {
      const side = this.sideOf(a.id); let q = side ? K.toSide(b, side, a) : K.inBox(b, a, .3);
      if (side && this.off.has(a.id)) { const d = dist(a, q); if (d < .05 && this.owner() !== a.id && this.flight?.to !== a.id) this.off.delete(a.id); else { const p = K.inBox(b, a, 0), k = Math.min(1, OFF_MAX / (dist(p, q) || 1)); q = { x: q.x + (p.x - q.x) * k, y: q.y + (p.y - q.y) * k }; } }
      a.x = q.x; a.y = q.y;
    }
    const ball = s.ball; if (ball.state === 'loose' && !K.isIn(b, ball)) { const q = K.inBox(b, ball, 0); ball.x = q.x; ball.y = q.y; }
  }
  // The ball on its way: a foot or a body of the middle on its line takes it; anyone else's body in its way takes it
  // (it never goes through anyone); at its man it is his. At rest (loose): whoever gets there first.
  ballCheck() {
    const s = this.sim, b = s.ball, f = this.flight;
    if (f && b.state === 'flying') {
      const low = (b.z || 0) < 1.2, away = Math.hypot(b.x - b.fx, b.y - b.fy) > .9;
      if (low && away) for (const o of this.takers()) if (dist(o, b) < (this.mode === 'keep' ? FOOT : BODY_R)) { this.take(o.id, f.kind === 'heavy' ? 'loose' : 'cut'); return; }
      const mate = f.kind === 'pass' ? bodyHit(b, this.keeperIds().filter(id => id !== f.from && id !== f.to).map(id => s.a(id))) : null; if (mate) { this.give(mate.id, 'pass'); return; }
      const r = s.a(f.to); if (f.kind === 'pass' && r && b.t > .5 && dist(r, b) < .55) { this.arrive(f); return; }
    }
    if (b.state !== 'loose') return;
    const near = [...s.agents.values()].sort((p, q) => dist(p, b) - dist(q, b)), first = near[0];
    if (first && dist(first, b) < LOOSE_R) { if (this.keeps(first.id)) { if (f && f.to === first.id) this.arrive({ ...f, kind: f.kind === 'heavy' ? 'heavy' : 'pass' }); else this.give(first.id, 'loose'); } else this.take(first.id, 'loose'); return; }
    // nobody on it yet: the nearest of the keeping side goes for it (along his line), and the middle's nearest
    const k = near.find(a => this.keeps(a.id) && a.id !== 'hero'); if (k && dist(k, b) < OFF_MAX + .5) { this.off.add(k.id); s.go(k.id, b.x, b.y, f?.kind === 'heavy' ? 1.8 : 3.4); } else if (k && !(k.id === f?.to && this.busy.has(k.id))) s.go(k.id, ...this.onLine(k.id, b), 3.4); // (a ball just inside the box: he steps in for it)
    if (this.mode === 'keep') { const o = near.find(a => !this.keeps(a.id)); if (o) s.go(o.id, b.x, b.y, this.D.press); }
  }
  // A defender on a carrier ('keep'): he closes in; standing on the ball, the carrier loses it after `stand` s (moving
  // away along his line, not at all); a warning first when it is his (hooks.warn). In 'win' he wins it only with STEAL.
  tackles(dt) {
    if (this.mode !== 'keep') return;
    const s = this.sim, c = this.owner(); if (!c || !this.keeps(c) || s.ball.reach) return;
    const ca = s.a(c), t = s.time, sh = this.shut ||= { none: null, me: null };
    // A friend on the ball protects it (turns away along his side, shields it): he can lose it only when he has had no
    // open line for PROTECT s AND his line to him has been shut all that time ("move to open the line" stays the lesson).
    if (c !== 'hero') {
      const D = this.D, others = this.keeperIds().filter(m => m !== c), me = this.openLine(c, 'hero', D.fPass, 0), any = me || others.some(m => m !== 'hero' && this.openLine(c, m, D.fPass, 0));
      sh.me = me ? null : sh.me ?? t; sh.none = any ? null : sh.none ?? t;
      if (this.shutFor(sh.none) < PROTECT || this.shutFor(sh.me) < PROTECT) { this.contact.clear(); return; }
    }
    if (t < this.safeT) return;
    for (const o of this.takers()) {
      if (dist(o, ca) >= TACKLE_R) { this.contact.delete(o.id); continue; }
      const moving = (ca.sp || 0) > .8 && Math.hypot(ca.tx - ca.x, ca.ty - ca.y) > .15, ahead = (o.x - ca.x) * (ca.tx - ca.x) + (o.y - ca.y) * (ca.ty - ca.y) > 0;
      if (moving && !ahead) { this.contact.delete(o.id); continue; }
      const need = moving ? .9 + this.D.stand * .5 : this.D.stand, v = (this.contact.get(o.id) || 0) + dt; this.contact.set(o.id, v);
      if (c === 'hero' && v >= WARN_AT && !this.warned) { this.warned = true; this.hooks.warn?.(o.id); }
      if (v > need) { this.take(o.id, 'tackle'); return; }
    }
  }
  shutFor(since) { return since == null ? 0 : this.sim.time - since; }
  // ---------- the glow ('win') ----------
  // The ball can be won: a pass (slow or not) within his reach, a heavy touch rolling within it, or (Fast mode's rule)
  // a carrier's touch off his foot with him close. Once open it stays at least `glow` s; a carrier's window then waits
  // `gap` s before the next.
  glowStep(dt) {
    const s = this.sim, b = s.ball, me = s.a('hero'), t = s.time, c = this.owner();
    if (t < this.lungeT) { this.glowUntil = -9; return; }
    const d = dist(me, b), low = (b.z || 0) < 1.2, near = d <= STEAL_R && low, f = this.flight;
    const reach = f?.kind === 'pass' && b.state === 'flying' ? PASS_R + Math.max(0, 7 - (f.speed || 7)) * .12 : STEAL_R; // (a pass: within his reach and a step, more for a slow one; a loose ball: within STEAL_R)
    const moving = (b.state === 'flying' || b.state === 'loose') && d <= reach && low, foot = c && c !== 'hero' && t >= this.glowNext && stealNow(s.a(c), b, me);
    if (moving) this.glowUntil = Math.max(this.glowUntil, t + this.D.glow); // (in his reach, and `glow` s after: time for a child's press)
    if (foot && !(this.glowWin && this.glowWin.c === c)) { this.glowWin = { c, until: t + this.D.glow + .25 }; this.glowUntil = Math.max(this.glowUntil, this.glowWin.until); }
    if (this.glowWin && (this.glowWin.c !== c || t >= this.glowWin.until)) { this.glowWin = null; this.glowNext = t + this.D.gap; }
    if (c && c !== 'hero' && !near) this.glowUntil = Math.min(this.glowUntil, t); // (a carrier's ball: only within his reach)
    const on = this.glowing(); if (on) this.stats.glowS += dt;
    if (on && !this.wasGlow) { this.stats.glows++; this.hooks.glow?.(true); } else if (!on && this.wasGlow) this.hooks.glow?.(false);
    this.wasGlow = on;
  }

  // ---------- the computer's players: keep the ball ----------
  aiKeep(dt) {
    const s = this.sim, D = this.D, c = this.owner(), t = s.time, box = this.box, defs = this.takers(), f = this.flight;
    const from = c ? s.a(c) : f ? f.tgt : s.ball;
    // his friends: on their line, at the place with the most open line from the ball (now and then a worse one)
    for (const id of ['m1', 'm2', 'm3']) {
      const a = s.a(id); if (!a) continue;
      if (id === c) { this.friendBall(id, dt); continue; }
      if (this.busy.has(id) || f?.to === id || (this.next.get(id) || 0) > t) continue;
      this.next.set(id, t + D.fMove * (c === 'hero' ? .7 : 1) * (.8 + .4 * this.rnd())); // (quicker to give him a line when he has it)
      const side = this.sideOf(id), p = this.rnd() < .85 ? K.bestSpot(box, side, from, defs, { speed: D.fPass, run: D.cutRun, react: D.cutReact, margin: .2 }) : K.sideAt(box, side, (this.rnd() * 2 - 1) * K.reachOf(box));
      s.go(id, p.x, p.y, 3.2);
    }
    // the defenders: one presses the ball on a curve that shuts one friend out (the cover shadow); the second cuts the
    // best line left. Each choice every `think` s; right `smart` of the time.
    const ball = c ? s.a(c) : f ? f.tgt : s.ball, recv = this.keeperIds().filter(id => id !== c && (!f || id !== f.from || !f.kicked)).map(id => s.a(id));
    if (f && s.time - f.t0 < .45) return; // (a pass just played: they go on as they were a moment, so what looked open was open)
    if ((this.defT -= dt) <= 0 && recv.length) {
      this.defT = D.think * (.8 + .4 * this.rnd());
      const order = defs.slice().sort((p, q) => dist(p, ball) - dist(q, ball)), lines = recv.map(r => ({ id: r.id, gap: K.laneGap(ball, r, defs) })).sort((p, q) => q.gap - p.gap);
      const pick = list => (this.rnd() < D.smart ? list[0] : list[Math.floor(this.rnd() * list.length)])?.id || null;
      this.presser = order[0]?.id || null; this.cover = order[1]?.id || null;
      this.shadow = pick(lines); const rest = lines.filter(l => l.id !== this.shadow); this.coverOf = (this.rnd() < D.smart * (D.two || 1) ? rest[0] : rest[Math.floor(this.rnd() * rest.length)])?.id || null; // (the second: as sharp as his share)
    }
    const P = this.presser && s.a(this.presser), C = this.cover && s.a(this.cover);
    if (P && !this.busy.has(P.id)) {
      const sh = this.shadow && s.a(this.shadow), u = sh ? unit(ball, sh) : unit(ball, box), off = c ? (s.time - this.gotAt < D.stand * .5 ? 1.1 : .6) : 1.4, q = K.inBox(box, { x: ball.x + u.x * off, y: ball.y + u.y * off }, .3);
      s.go(P.id, q.x, q.y, D.press);
    }
    if (C && !this.busy.has(C.id)) {
      const r = this.coverOf && s.a(this.coverOf), q = K.inBox(box, r ? { x: ball.x + (r.x - ball.x) * .5, y: ball.y + (r.y - ball.y) * .5 } : box, .6);
      s.go(C.id, q.x, q.y, D.cover);
    }
  }
  // A friend with the ball: a touch to control it (fHold s), then a pass to an open friend (him, FAVOR of the time when
  // his line is open; never when it is shut), else along his line away from the press.
  friendBall(id, dt) {
    const s = this.sim, D = this.D; if (this.busy.has(id) || this.flight || s.time - this.gotAt < D.fHold) return;
    if ((this.aiT -= dt) > 0) return; this.aiT = .3;
    const a = s.a(id), defs = this.watch(), opts = this.keeperIds().filter(m => m !== id).map(m => ({ m, open: this.openLine(id, m, D.fPass, D.fMargin), gap: K.laneGap(a, this.passPoint(id, m), defs) })).filter(o => o.open);
    const mp = this.passPoint(id, 'hero'), free = defs.every(o => dist(o, mp) >= FREE); // (and only when he will have time to look before a defender is on him)
    const me = free && opts.find(o => o.m === 'hero'), others = opts.filter(o => o.m !== 'hero').sort((p, q) => q.gap - p.gap);
    if (me && (!others.length || this.rnd() < FAVOR)) { this.pass(id, 'hero', D.fPass); return; }
    if (others.length) { this.pass(id, others[0].m, D.fPass); return; }
    this.dribbleAway(id);
  }

  // ---------- the computer's players: win the ball (they pass round him) ----------
  aiWin(dt) {
    const s = this.sim, D = this.D, c = this.owner(), t = s.time, box = this.box, me = s.a('hero'), f = this.flight;
    const from = c ? s.a(c) : f ? f.tgt : s.ball;
    for (const id of this.keeperIds()) {
      if (id === c) { this.passerBall(id, dt); continue; }
      if (this.busy.has(id) || f?.to === id || (this.next.get(id) || 0) > t) continue;
      this.next.set(id, t + 1 + .5 * this.rnd());
      const side = this.sideOf(id), p = this.rnd() < D.move ? K.bestSpot(box, side, from, [me], { speed: D.pass, run: K.ME.run, react: K.ME.react, margin: D.margin }) : K.sideAt(box, side, K.along(box, side, s.a(id)) + (this.rnd() - .5) * 2);
      s.go(id, p.x, p.y, 2.6);
    }
  }
  passerBall(id, dt) {
    const s = this.sim, D = this.D, a = s.a(id), me = s.a('hero'), held = s.time - this.gotAt; if (this.busy.has(id) || this.flight) return;
    const close = dist(me, a) < 2.6;
    if (held < D.hold) { if (close && (this.aiT -= dt) <= 0) { this.aiT = .5; if (this.rnd() < D.loose) this.dribbleAway(id, 2.8); else s.stop(id); } return; } // (a touch, a look; pressed, he dribbles away along his line, or shields it)
    if ((this.aiT -= dt) > 0) return; this.aiT = .3;
    const opts = this.keeperIds().filter(m => m !== id).map(m => { const p = this.passPoint(id, m); return { m, open: K.lineOpen(a, p, D.pass, [me], K.ME.run, K.ME.react, D.margin), gap: K.laneGap(a, p, [me]) }; });
    if (this.rnd() < D.careless) { this.pass(id, opts[Math.floor(this.rnd() * opts.length)].m, D.pass); return; } // (he passes without looking at him)
    const open = opts.filter(o => o.open).sort((p, q) => q.gap - p.gap);
    if (open.length) { this.pass(id, open[0].m, D.pass); return; }
    if (held > D.hold + 2.2) { this.pass(id, opts.sort((p, q) => q.gap - p.gap)[0].m, D.pass); return; } // (pressed too long: the least shut line)
    if (close && this.rnd() < D.loose) this.dribbleAway(id, 2.8);
  }
}
