// Score attack (v88), a mini game: short attacks on one goal, played the Fast mode way (js/fast/). Each attempt is a
// situation (2 against 1 up to 3 against 4) near their goal; he is one attacker the whole attempt. A goal scores; the
// defenders winning the ball, the ball going out, the keeper's save or the timer running out cost a life (mini/run.js).
// This file has no page: the situations (attackScene), how hard each level is (attackLevel), the match rules for one
// attempt (AttackMatch, on the Fast match: js/fast/match.js) and the right move at any moment (rightMove: the picture
// cue after a miss, and the bots). mini/attack-ui.js puts it on the page with the Fast controller.
//
// What the game rewards (coaching sources: see the v88 report): in a 2 against 1, dribble at the defender to draw him;
// pass as he commits to you (not before, and never through his reach); when he backs off, keep going and shoot. With
// more friends, find the free one. Outnumbered, be patient: move the ball, wait for the gap, switch sides.
import { Match, oppOf } from '../fast/match.js';
import { clamp, dist, onLane } from '../fast/rules.js';
import { shotResult, relations, rightFoot, zone as shotZone, EDGE as SHOT_EDGE } from '../shot.js';
import { PITCH } from '../geom.js';
import { ease, ramp } from './rules.js';

export const BASE = .75; // the Fast speed of play (fast.js BASE): game s per real s
// ---------- the situations, easiest first ----------
export const KINDS = [
  { id: '2v1', us: 2, them: 1 }, { id: '3v1', us: 3, them: 1 }, { id: '3v2', us: 3, them: 2 }, { id: '2v2', us: 2, them: 2 },
  { id: '3v3', us: 3, them: 3 }, { id: '2v3', us: 2, them: 3 }, { id: '3v4', us: 3, them: 4 },
];
export const kindById = id => KINDS.find(k => k.id === id);

// ---------- how hard, by level (a third of a level a goal: mini/rules.js) ----------
// The one place to tune it. Everything moves a little with each goal and never back:
//   centre  where the mix of situations sits on KINDS (0: 2v1 … 6: 3v4); mix: the share of each, a soft bump round the
//           centre leaning to the easier side, so a harder one comes now and then before it is the usual one
//   opp     the Fast level of their players (match.js oppOf: how fast they run, press and get to a pass line)
//   react   game s their players take to see a pass or a new carrier before they move to it (quicker later)
//   stand   game s on him while he stands on the ball before the tackle; boost: how much sooner a tackle comes;
//           into: and how much sooner still on a dribble straight into one of them
//   commit  m from goal at which a defender who holds off has to come to the ball
//   keeper  how well their keeper follows the ball across his goal; slip: the share of his saves he lets in (easy keeper)
//   friendSave the share of a free friend's shots their keeper saves
//   farSave the share of good shots from the edge (SHOT_EDGE m) he saves (less closer in, none from SURE_D m)
//   time    real s of the timer; startD: m from goal where he starts
export function attackLevel(L) {
  L = Math.max(0, L);
  const centre = 6 * (1 - Math.exp(-L / 7));
  const w = KINDS.map((k, i) => Math.exp(-(((i - centre) / 1.05) ** 2)) * (i > centre ? Math.exp(-(i - centre)) : 1)), sum = w.reduce((a, b) => a + b, 0);
  return {
    level: L, centre, mix: KINDS.map((k, i) => ({ id: k.id, w: w[i] / sum })),
    opp: 1 - Math.exp(-L / 10), react: ease(.8, .25, 7)(L), stand: ease(4.2, 2.2, 8)(L), boost: ramp(0, .06, .8)(L), into: .4 + ramp(0, .15, 1)(L),
    commit: ease(8.5, 11, 8)(L), farSave: ease(.55, .8, 8)(L), keeper: ease(.1, .55, 8)(L), slip: ease(.85, .1, 10)(L), friendSave: ease(.08, .35, 8)(L),
    time: ease(32, 20, 15)(L), startD: ease(15, 18, 10)(L),
  };
}
// The kind for a share u (0..1) of the mix.
const pickKind = (mix, u) => { let a = 0; for (const m of mix) { a += m.w; if (u < a) return m.id; } return mix.at(-1).id; };

// ---------- one situation ----------
// attackScene(level, r, n, last): r a stream 0..1 (shot.js stream); n: the attempt's number in the run (the first is
// always a 2 against 1); last: the kinds before, newest last (never three of a kind in a row while others are likely).
// Returns { kind, us, them, style, hero, mates, opps (each [x, y]), D (attackLevel), n }. style: how their players defend:
// 'press' (the one comes to the ball), 'drop' (he holds off between the ball and the goal, covering the pass, and comes
// only near the goal), 'mark' (he stays with the friend), 'zone' (2 or more: one presses, the rest hold a line goal-side
// and shift to the ball), 'man' (2 or more, later: one presses, the rest each stay with an attacker).
export function attackScene(level, r, n = 0, last = [], P = PITCH) {
  const D = attackLevel(level), { L, W } = P, cy = W / 2;
  let kind = n === 0 ? '2v1' : pickKind(D.mix, r());
  if (n > 0 && last.length >= 2 && last.slice(-2).every(k => k === kind)) { const k2 = pickKind(D.mix, r()); if (k2 !== kind) kind = k2; }
  const K = kindById(kind), u = r();
  const style = K.them === 1 ? (K.us === 3 ? (u < .6 ? 'press' : 'drop') : u < .5 ? 'press' : u < .8 ? 'drop' : 'mark') : (u < Math.min(.45, .1 + D.level * .03) ? 'man' : 'zone');
  const side = r() < .5 ? -1 : 1, sx = L - Math.min(D.startD, L * .62), j = () => r() * 2 - 1;
  // him: in the middle third across, or out on a side now and then
  const hy = clamp(cy + side * (r() < .3 ? W * .26 : W * .1 * r()) + j() * .6, 2, W - 2), hero = [sx + j() * 1.2, hy];
  // his friends: wide on the other side, and (three) one on his own side or ahead in the middle
  const wide = Math.min(7, W * .32), mates = [];
  mates.push([sx + j() * 2, clamp(hy - side * (wide + r() * 1.5), 1.5, W - 1.5)]);
  if (K.us === 3) mates.push(r() < .5 ? [sx + 3.5 + j(), clamp(cy + side * (W * .05 + r()), 2, W - 2)] : [sx - .5 + j(), clamp(hy + side * wide * .9, 1.5, W - 1.5)]);
  // theirs: between the ball and their goal, spread across; some a step out of place
  const opps = [], dx = L - sx, line = sx + dx * (.38 + .12 * r());
  if (K.them === 1) {
    const f = mates[0], aim = style === 'mark' ? [f[0] + 2.2, f[1] + (cy - f[1]) * .15] : [line, hy + (cy - hy) * .4 + (f[1] - hy) * .25];
    opps.push([aim[0] + j() * .8, clamp(aim[1] + j() * .8, 1.2, W - 1.2)]);
  } else {
    const span = Math.min(W * .62, 4 + K.them * 3.2), mid = cy + (hy - cy) * .35;
    for (let i = 0; i < K.them; i++) opps.push([line + j() * 1.4 + (i % 2) * .8, clamp(mid - span / 2 + span * i / (K.them - 1) + j() * 1.1, 1.2, W - 1.2)]);
  }
  return { kind, us: K.us, them: K.them, style, hero, mates, opps, D, n, level };
}

// ---------- one attempt on the Fast match ----------
// env: as Match's ({ sim, L, W, gy0, gy1, gh, fx, sfx, rnd }) plus scene (attackScene), real (a clock in real s; none:
// game time / BASE), pace (how fast the timer drains now: 1, less while he holds or aims), onEnd(result).
// The result: { goal, why: 'goal' | 'lost' | 'save' | 'out' | 'time', by (who scored or won it), sec (real s) }.
const SUPPORT_T = .7, FIRST_T = .45, GG_T = 1.8, BLOCK_D = 2.2, BLOCK_R = .6, SURE_D = 8, HURRY = .25; // (BLOCK: a body within BLOCK_R m of a shot's first BLOCK_D m blocks it)
export class AttackMatch extends Match {
  constructor(env) {
    const sc = env.scene, D = sc.D;
    super({ ...env, n: sc.us, keepers: true, level: D.opp });
    this.sc = sc; this.D = D; this.setLevel(D.opp);
    this.usIds = ['hero', 'm1', 'm2', 'm3'].slice(0, sc.us); this.themIds = ['o1', 'o2', 'o3', 'o4'].slice(0, sc.them);
    this.real = env.real || null; this.pace = env.pace || (() => 1); this.onEnd = env.onEnd || (() => {});
    this.total = D.time; this.left = D.time; this.sec = 0; this.res = null; this.plan = new Map(); this.presser = null; this.owner0 = undefined; this.gg = null;
    this.advice = null; this.adviceT = -9; this.meAuto = false;
  }
  setLevel(level) { super.setLevel(level); if (this.D) { this.standT = this.D.stand; this.opp.keeper = this.D.keeper; } }
  setup() {
    const sc = this.sc, s = this.sim, cy = this.W / 2;
    s.setup({ hero: sc.hero, mates: sc.mates, opps: sc.opps, gk: { them: [this.L - .7, cy] }, carrier: 'hero' });
    s.restores++; // (every body starts afresh: pro/motion.js)
    for (const a of s.agents.values()) a.face = [a.team === 'us' ? 1 : -1, 0];
    const h = s.a('hero'); Object.assign(s.ball, { x: h.x + .45, y: h.y, h: 0 });
    this.flight = null; this.jobs.length = 0; this.cmd.clear(); this.lastTeam = 'us'; this.dead = false; this.lastOwner = 'hero'; this.involved = true;
    this.safeT = s.time + 1.2; this.t0 = s.time; this.lastReal = null;
    for (const id of this.themIds) this.plan.set(id, { at: s.time + .25 + this.rnd() * .3 });
  }
  // ---------- the end of an attempt ----------
  end(goal, why, by = null) {
    if (this.res) return; this.dead = true; this.flight = null; this.meMove = null;
    this.res = { goal, why, by, sec: +this.sec.toFixed(1), kind: this.sc.kind, style: this.sc.style, left: +this.left.toFixed(1), advice: this.advice };
    this.sim.stopAll(); this.onEnd(this.res);
  }
  goal(team) { if (this.res) return; super.goal(team); this.end(team === 'us', team === 'us' ? 'goal' : 'lost', this.lastOwner); }
  out() { if (this.res) return; const b = this.sim.ball; Object.assign(b, { state: 'loose', carrier: null, move: null }); this.sfx('click'); this.on.out?.('them'); this.end(false, 'out'); }
  giveTo(id, how) {
    const shot = this.flight?.kind === 'shot' || (this.shotT != null && this.sim.time - this.shotT < 2.5);
    super.giveTo(id, how);
    if (this.team(id) === 'them' && !this.res) this.end(false, this.sim.a(id)?.gk && (shot || how === 'save') ? 'save' : 'lost', id);
  }
  // A shot: their keeper lets in `slip` of the saves he would make (an easy keeper early on).
  shoot(id, res, kind = 'shot') {
    // From far, or with one of theirs at him, their keeper gets to more of them (FAR_SAVE): the better chance is closer in.
    if (this.team(id) === 'us' && res.res === 'goal' && this.keeper('them')) {
      const a = this.sim.a(id), d = Math.hypot(this.L - a.x, this.W / 2 - a.y), near = this.foes('us').reduce((r, o) => Math.min(r, dist(o, a)), 99);
      const p = clamp((d - SURE_D) / (SHOT_EDGE - SURE_D), 0, 1) * this.D.farSave + (near < 1.8 ? HURRY : 0);
      if (this.rnd() < p) { const k = this.keeper('them'); Object.assign(res, shotResult({ from: { x: a.x, y: a.y }, zone: res.zone || null, y: res.zone ? null : res.to.y, z: res.to.z, foot: res.speed >= 18 ? 'las' : 'in', k: { x: k.x, y: k.y }, gx: this.L, force: 'save' }), { far: true }); }
    }
    if (this.team(id) === 'us' && res.res === 'save' && !res.far && this.rnd() < this.D.slip) {
      const a = this.sim.a(id), k = this.keeper('them');
      Object.assign(res, shotResult({ from: { x: a.x, y: a.y }, zone: res.zone || null, y: res.zone ? null : res.to.y, z: res.to.z, foot: res.speed >= 18 ? 'las' : res.speed >= 15 ? 'placed' : 'in', k: k && { x: k.x, y: k.y }, gx: this.L, down: true }), { slip: true });
    }
    // A defender right in front of the shooter (his body on the ball's first metres) blocks it: it is his.
    const a = this.sim.a(id), to = res.to || res.at;
    if (this.team(id) === 'us' && to && res.res !== 'cleared') {
      const blk = this.foes('us').find(o => { const c = onLane(o, a, to, 0); return c.along < BLOCK_D && c.d < BLOCK_R && dist(o, a) > .2; });
      if (blk) Object.assign(res, { res: 'cleared', at: { x: blk.x, y: blk.y, z: 0 }, by: { id: blk.id }, blocked: true });
    }
    this.shotT = this.sim.time;
    super.shoot(id, res, kind);
  }
  // ---------- one step ----------
  step(dt) {
    const s = this.sim;
    if (!this.dead && !this.res) {
      const now = this.real ? this.real() : null, rdt = now != null ? Math.max(0, now - (this.lastReal ?? now)) : dt / BASE; this.lastReal = now;
      this.sec += rdt; this.left = Math.max(0, this.left - rdt * this.pace());
      if (this.left <= 0 && this.flight?.kind !== 'shot') { this.end(false, 'time'); return; } // (a shot on its way still counts)
      if (s.time - this.adviceT > .4 && this.owner() === this.me) { this.adviceT = s.time; const a = rightMove(this); if (a.kind !== 'wait') this.advice = { kind: a.kind, id: a.id || null }; }
    }
    super.step(dt);
    // Their tackle comes sooner level by level (boost), and at once on a dribble straight into one of them: a player
    // who runs the ball at a defender's feet loses it (the Fast match only times a stand-off).
    if (!this.dead && this.owner() === this.me) { const me = s.a(this.me); for (const [k, v] of this.contact) { const o = s.a(k); if (!o || o.gk) continue; const into = this.meMove?.kind === 'near' && s.time < this.meMove.until && (o.x - me.x) * (me.tx - me.x) + (o.y - me.y) * (me.ty - me.y) > .3 * dist(o, me) * Math.hypot(me.tx - me.x, me.ty - me.y); this.contact.set(k, v + dt * (this.D.boost + (into ? this.D.into : 0))); } }
  }
  // Nobody of theirs restarts or shoots: the attempt ends as soon as they have it. His team: friends support and pass.
  moveTeams(dt) {
    const c = this.owner();
    if (c && this.team(c) === 'us' && c !== this.me && !this.cmd.has(c) && !this.flight) this.friendBall(c, dt);
    this.support();
    this.defend();
  }
  // ---------- his friends ----------
  // A friend with the ball: a moment to take it, then: shoot when close with a clear way (the best low corner away from
  // the keeper); give it back to him when he is open and better placed or the friend is pressed; to the other friend
  // when only he is open; otherwise run at goal, away from the nearest of theirs.
  friendBall(id, dt) {
    const s = this.sim, a = s.a(id), b = s.ball;
    if (s.time - (b.got ?? 0) < FIRST_T) return;
    if ((this.aiT -= dt) > 0) return; this.aiT = .35;
    const foes = this.foes('us'), near = foes.reduce((m, o) => Math.min(m, dist(o, a)), 99), gd = Math.hypot(this.L - a.x, this.W / 2 - a.y);
    const sh = shotFrom(this, a);
    if (sh && near > 1.2 && (gd < 7.2 || (gd < 9.5 && near < 2.6))) { this.shoot(id, friendShot(this, a, sh)); return; } // (close in, or a defender coming)
    const me = s.a(this.me), open = m => this.passCheck(id, m).open, pressed = near < 2.6;
    if (me && open(this.me) && (pressed ? roomOf(this, me) > 1.6 : roomOf(this, me) > 2.5 && Math.hypot(this.L - me.x, this.W / 2 - me.y) < gd - 3)) { this.pass(id, this.me); return; }
    const other = this.usIds.find(m => m !== id && m !== this.me && s.a(m) && open(m) && roomOf(this, s.a(m)) > 2);
    if (pressed && other) { this.pass(id, other); return; }
    const o = foes.sort((p, q) => dist(p, a) - dist(q, a))[0];
    if (pressed && o) { // no pass: away from him, toward his friend's side, to open a line (he keeps it)
      const ux = a.x - o.x, uy = a.y - o.y, l = Math.hypot(ux, uy) || 1, tm = me || a;
      s.go(id, clamp(a.x + ux / l * 2 + (tm.x - a.x) * .15, 1, this.L - 1.5), clamp(a.y + uy / l * 2 + (tm.y - a.y) * .15, 1.2, this.W - 1.2), 3.3); return;
    }
    const side = o && Math.abs(o.y - a.y) < 2.5 && o.x > a.x ? (o.y > a.y ? -1 : 1) * 2 : 0;
    s.go(id, clamp(a.x + 3, 1, this.L - 1.5), clamp(a.y + side + (this.W / 2 - a.y) * .2, 1.2, this.W - 1.2), 3.1);
  }
  // Friends without the ball: each to the most open place near his lane (wide left, wide right, or ahead), with a clear
  // line from the ball, room from their players, forward, apart from each other. A friend who just passed to him runs
  // on past his defender (pass and go: a ball back to him next).
  support() {
    const s = this.sim, b = s.ball, t = s.time, c = this.owner(), loose = b.state === 'loose';
    const chaser = loose ? this.usIds.filter(id => id !== this.me).map(id => s.a(id)).filter(Boolean).sort((p, q) => dist(p, b) - dist(q, b))[0]?.id : null;
    if (this.passFrom && this.passTo === this.me && c === this.me && this.passFrom !== this.me && (!this.gg || this.gg.id !== this.passFrom || this.gg.from !== b.got)) {
      const f = s.a(this.passFrom); if (f) { this.gg = { id: f.id, from: b.got, until: t + GG_T }; s.go(f.id, clamp(f.x + 5.5, 1, this.L - 2), clamp(f.y + (this.W / 2 - f.y) * .35, 1.5, this.W - 1.5), 4.6); }
    }
    for (const id of this.usIds) {
      if (id === this.me || id === c || id === chaser || this.cmd.has(id) || this.flight?.to === id) continue;
      if (this.gg?.id === id && t < this.gg.until) continue;
      if ((this.next.get(id) || 0) > t) continue;
      this.next.set(id, t + SUPPORT_T * (.8 + .4 * this.rnd()));
      const p = openSpot(this, id); s.go(id, p.x, p.y, p.far ? 4.2 : 3.4);
    }
  }
  // ---------- theirs ----------
  // Each of theirs makes a plan and keeps to it until his next one; when the ball changes hands (a pass, a new
  // carrier) nobody plans again for `react` s: the time it takes to see it. The one nearest the ball presses (as the
  // Fast match: in front of the carrier, goal-side; at a walk on a player standing on the ball, then the warning and
  // the tackle); the others cover by the scene's style.
  defend() {
    const s = this.sim, b = s.ball, t = s.time, D = this.D, c = this.owner(), key = c || (this.flight ? 'f' + this.flight.to : 'loose');
    if (key !== this.owner0) { this.owner0 = key; for (const id of this.themIds) { const p = this.plan.get(id); if (p) p.at = Math.max(p.at, t + D.react * (.8 + .4 * this.rnd())); } }
    const defs = this.themIds.map(id => s.a(id)).filter(o => o && !this.cmd.has(o.id)); if (!defs.length) return;
    const gx = this.L, gy = this.W / 2, ca = c ? s.a(c) : b, loose = b.state === 'loose' && !this.flight;
    // who presses: the nearest to the ball (kept unless another is clearly nearer)
    const by = defs.slice().sort((p, q) => dist(p, ca) - dist(q, ca)); let pr = by[0];
    if (this.presser && this.presser !== pr.id) { const old = s.a(this.presser); if (old && defs.includes(old) && dist(old, ca) < dist(pr, ca) + 1.5) pr = old; }
    this.presser = pr.id;
    const st = this.sc.style, carrierGd = Math.hypot(gx - ca.x, gy - ca.y), others = this.usIds.filter(id => id !== c).map(id => s.a(id)).filter(Boolean);
    for (const o of defs) {
      const p = this.plan.get(o.id) || {}; this.plan.set(o.id, p);
      const isP = o === pr, every = isP ? .15 : .45;
      if (t < (p.at ?? 0)) continue; p.at = t + every * (.8 + .4 * this.rnd());
      let tgt, sp = this.opp.mark;
      if (loose && isP) { tgt = { x: b.x, y: b.y }; sp = this.opp.press; }
      else if (isP && (defs.length > 1 || st === 'press' || carrierGd < D.commit || dist(o, ca) < 2.6)) {
        // press the carrier (a lone defender who holds off comes to him near the goal, or when he runs into him)
        const ux = gx - ca.x, uy = gy - ca.y, l = Math.hypot(ux, uy) || 1, meC = c === this.me, drib = meC && this.meMove?.kind === 'near' && t < this.meMove.until;
        const standing = meC && !(this.meMove && t < this.meMove.until), off = !meC ? .75 : drib ? .9 : .45;
        tgt = { x: ca.x + ux / l * off, y: ca.y + uy / l * off }; sp = standing ? Math.min(this.opp.press, 2) : this.opp.press;
      } else if (isP && st === 'mark' && others.length) {
        const f = others.sort((p2, q) => Math.hypot(gx - p2.x, gy - p2.y) - Math.hypot(gx - q.x, gy - q.y))[0]; tgt = goalSide(f, gx, gy, 1.3, ca, .15);
      } else if (isP) { // 'drop': between the ball and the goal, a few metres off, leaning to cover the pass
        const f = others.sort((p2, q) => dist(p2, ca) - dist(q, ca))[0], hold = clamp(carrierGd * .4, 2.6, 5), ux = gx - ca.x, uy = gy - ca.y, l = Math.hypot(ux, uy) || 1;
        tgt = { x: ca.x + ux / l * hold, y: ca.y + uy / l * hold }; if (f) { tgt.x += (f.x - tgt.x) * .12; tgt.y += (f.y - tgt.y) * .3; }
      } else tgt = this.coverSpot(o, defs, pr, ca, others);
      s.go(o.id, clamp(tgt.x, .8, this.L - 1), clamp(tgt.y, .8, this.W - .8), sp);
    }
  }
  // A covering player's place: 'man', goal-side of an attacker of his own (the one nearest him nobody else has); 'zone',
  // a place in a line between the ball and the goal, across the goal's width and shifted toward the ball.
  coverSpot(o, defs, pr, ca, others) {
    const gx = this.L, gy = this.W / 2, cover = defs.filter(d => d !== pr), i = cover.indexOf(o), n = cover.length;
    if (this.sc.style === 'man' && others.length) {
      const taken = new Set(), pairs = [];
      for (const d of cover) { const a = others.filter(x => !taken.has(x.id)).sort((p, q) => dist(p, d) - dist(q, d))[0]; if (a) { taken.add(a.id); pairs.push([d, a]); } }
      const mine = pairs.find(([d]) => d === o); if (mine) return goalSide(mine[1], gx, gy, 1.2, ca, .2);
    }
    // the line: its depth between the ball and the goal; its players across, the whole line shifted toward the ball
    const depth = clamp(ca.x + Math.max(2.5, (gx - ca.x) * .45), ca.x + 2, gx - 2.5), w = Math.min(this.W * .5, 3.4 + n * 2.6);
    const centre = gy + (ca.y - gy) * .55, ys = cover.map(d => d.y).sort((a, b) => a - b), k = ys.indexOf(o.y);
    let y = n === 1 ? centre : centre - w / 2 + w * (k < 0 ? i : k) / (n - 1);
    // a lone covering player stands between the two most dangerous free attackers (shaded to the one nearer goal)
    if (n === 1 && others.length) { const fr = others.slice().sort((p, q) => Math.hypot(gx - p.x, gy - p.y) - Math.hypot(gx - q.x, gy - q.y)).slice(0, 2); const tx = fr.length > 1 ? fr[0].y * .6 + fr[1].y * .4 : fr[0].y; y = y * .35 + tx * .65; }
    return { x: depth, y };
  }
}

// ---------- small helpers (the match, the bots and the cue use the same ones) ----------
const roomOf = (m, a) => m.foes('us').reduce((r, o) => Math.min(r, dist(o, a)), 99);
// Goal-side of attacker a by `off` m, shaded `k` toward the ball.
function goalSide(a, gx, gy, off, ball, k) { const ux = gx - a.x, uy = gy - a.y, l = Math.hypot(ux, uy) || 1; return { x: a.x + ux / l * off + (ball.x - a.x) * k, y: a.y + uy / l * off + (ball.y - a.y) * k }; }
// A clear shot from a: the low corner away from the keeper with nobody of theirs (outfield) on its line, or null.
export function shotFrom(m, a) {
  const k = m.keeper('them'), from = { x: a.x, y: a.y }, rel = k ? relations(from, k, m.L) : { L: 'away', M: 'away', R: 'away' };
  const cols = ['L', 'R', 'M'].filter(c => rel[c] !== 'at').sort((p, q) => (rel[p] === 'away' ? 0 : 1) - (rel[q] === 'away' ? 0 : 1));
  for (const c of cols) { const z = shotZone(c), ok = m.foes('us').every(o => { const c = onLane(o, from, { x: m.L, y: z.y }, .05); return c.d > (c.along < BLOCK_D ? BLOCK_R + .15 : .9); }); if (ok) return { zone: c, rel: rel[c] }; }
  return null;
}
// A friend's shot: in, unless the keeper gets to it (friendSave of the time: more as the keeper gets better).
const friendShot = (m, a, sh) => { const k = m.keeper('them'); return shotResult({ from: { x: a.x, y: a.y }, zone: sh.zone, foot: rightFoot(a), k: k && { x: k.x, y: k.y }, gx: m.L, force: m.rnd() < m.D.friendSave ? 'save' : 'goal' }); };
// His own shot, as fast.js shootWith plays it (the bots and the tests: a target and a foot).
export function heroShot(m, zone, foot, rnd = Math.random) {
  const a = m.sim.a(m.me), k = m.keeper('them');
  const res = shotResult({ from: { x: a.x, y: a.y }, zone, foot, k: k && { x: k.x, y: k.y }, gx: m.L, rand: rnd, defs: m.foes('us').map(o => ({ x: o.x, y: o.y, id: o.id })) });
  if (res.res === 'cleared' && res.by) res.by = { id: m.foes('us').reduce((p, o) => (Math.hypot(o.x - res.by.x, o.y - res.by.y) < Math.hypot(p.x - res.by.x, p.y - res.by.y) ? o : p)).id };
  m.shoot(m.me, res); return res;
}
// The most open place near a player's lane (his friends' runs, and the bots' run without the ball). far: a long run.
export function openSpot(m, id) {
  const s = m.sim, a = s.a(id), b = s.ball, c = m.owner(), from = c ? s.a(c) : b, L = m.L, W = m.W, gy = W / 2;
  const foes = m.allFoes('us'), mates = m.usIds.filter(x => x !== id && x !== c).map(x => s.a(x)).filter(Boolean);
  const lane = a.y < from.y - 2 ? -1 : a.y > from.y + 2 ? 1 : 0; let best = null, bs = -1e9;
  for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
    const x = clamp(from.x - 2 + i * 1.1, 1.5, L - 2), y = clamp(gy - W * .42 + j * W * .14, 1.3, W - 1.3), p = { x, y };
    let ln = 99, room = 99; for (const o of foes) { ln = Math.min(ln, onLane(o, from, p).d); room = Math.min(room, dist(o, p)); }
    const crowd = mates.reduce((r, q) => Math.min(r, Math.hypot(q.tx - x, q.ty - y)), 99), dc = dist(from, p), gd = Math.hypot(L - x, gy - y);
    const sc = Math.min(ln, 3) * 1.3 + Math.min(room, 4) * .6 + (x - from.x) * .12 - Math.max(0, gd - 6) * .05 - dist(a, p) * .1
      - (crowd < 4.5 ? (4.5 - crowd) * .9 : 0) - (dc < 3.5 ? 2 : 0) - (dc > 9 ? (dc - 9) * .5 : 0) - Math.abs(Math.abs(y - from.y) - 5.5) * .15 - (lane && Math.sign(y - from.y) === -lane ? 1.2 : 0);
    if (sc > bs) { bs = sc; best = p; }
  }
  return { ...best, far: dist(a, best) > 5 };
}

// ---------- the right move now ----------
// For him with the ball (the cue after a miss shows it; the bots make it): 'shoot' close with a clear way; 'pass' to a
// friend whose line is open and who has room, when a defender has come to him (committed) or the friend is clearly
// freer (never before: a defender still between them covers the pass); 'go' when nobody is in front of him (dribble
// at goal, going alone); else 'dodge': carry it across, away from the pressure, toward the bigger gap (be patient).
// Returns { kind, id (pass), zone + foot (shoot), x, y (go, dodge: where to tap) }; 'wait' when he does not have it.
export function rightMove(m) {
  const s = m.sim, me = s.a(m.me); if (!me || m.owner() !== m.me) return { kind: 'wait' };
  const L = m.L, gy = m.W / 2, foes = m.foes('us'), gd = Math.hypot(L - me.x, gy - me.y), near = foes.slice().sort((p, q) => dist(p, me) - dist(q, me))[0];
  const nd = near ? dist(near, me) : 99, ahead = foes.filter(o => { const dx = o.x - me.x, d = dist(o, me); return d < 3.4 && dx > -.3 && Math.abs(Math.atan2(o.y - me.y, dx) - Math.atan2(gy - me.y, L - me.x)) < .9; });
  const sh = gd <= Math.min(11, SHOT_EDGE) ? shotFrom(m, me) : null;
  const shoot = { kind: 'shoot', zone: sh?.zone, foot: rightFoot(me) };
  const between = o => (o.x - me.x) * (L - me.x) + (o.y - me.y) * (gy - me.y) > 0; // (in front of him, toward the goal)
  if (sh && gd <= 8.5 && (nd > 1.1 || !between(near))) return shoot;
  const committed = near && nd < 4.2 && near.x > me.x - .6, myRoom = nd;
  const friends = m.usIds.filter(id => id !== m.me).map(id => s.a(id)).filter(f => f && f.x > me.x - 5)
    .map(f => ({ f, pc: m.passCheck(m.me, f.id), room: roomOf(m, f), gd: Math.hypot(L - f.x, gy - f.y) })).filter(o => o.pc.open && o.room >= 2.6)
    .sort((p, q) => (q.room - q.gd * .35) - (p.room - p.gd * .35));
  const fr = friends[0];
  if (fr && (committed || fr.room > myRoom + 2.5 || (ahead.length && fr.room > myRoom))) return { kind: 'pass', id: fr.f.id };
  if (sh && nd > 1.5 && (ahead.length || nd < 3)) return shoot; // (a defender coming and nobody free: shoot now)
  if (!ahead.length) { const tx = Math.min(L - 3, me.x + 3.6), ty = me.y + (gy - me.y) * .35; return { kind: 'go', x: tx, y: clamp(ty, 1, m.W - 1) }; }
  // pressure in front and no free friend: across, to the side with more room
  const o = ahead[0], dir = o.y > me.y ? -1 : 1, open = [dir, -dir].find(d => me.y + d * 3 > 1.2 && me.y + d * 3 < m.W - 1.2) ?? dir;
  return { kind: 'dodge', x: clamp(me.x - 1.2, 1, L - 2), y: clamp(me.y + open * 3, 1.2, m.W - 1.2) };
}
