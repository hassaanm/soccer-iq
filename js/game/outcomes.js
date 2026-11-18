// Outcome scripts: what happens on the pitch after his choice (pass, dribble, push, shot, run, steal), up to the
// banner that ends the play. The scripts move the players in `scripted`; the team AI moves everyone else.
import { lerp, clamp, dist, interceptor, dribbleEnd, closestOnLane, BACKWARD, PITCH } from '../geom.js';
import { pushEnd, DEF_RUN, takeOn, LEAD, SHOT, leadPoint, legBounce, grade, exploit as exploitOf } from '../generate.js';
import { L, W, gy0, gy1, MATE, ROSTER, faceTo } from './shared.js';
import { flairOf } from '../flair.js';
import { placedAim, rightFoot, shotResult, zone, zoneGrade, bestZone, stream, DUEL, GUESS_T, LOW_Z } from '../shot.js';

const GUESS_PLACED = .1; // (see guessWrong)
import { seeded, OUR_SAVE } from './keeper.js';
import { kindOf, ACC, SPEED, goAt, PACE } from '../window.js';

const TIMEOUT_TITLE = 'He got there!'; // (v64: the defender got to the ball before he chose; rounds.js TIMEOUT)
const FINISH_RUN = 4.65; // (round 5) his run at goal with the ball: a child's sprint with a ball at his feet, no faster than a defender chasing him
const THEIR_SAVE = .33; // (see finish)
const MATCH_HOLD = { timeout: .7, kept: .5, held: .7, won: .7, goal: 1.2, goalAgainst: 1.1 }; // seconds on the result in a match (see hold)
const LOOSE = 1.05, REACH = 2; // steal: the ball is this far from the attacker's feet, and this close to him
// Whether a well-defended play ends with the attackers stopped (true, about 2 in 3) or losing the ball.
// Fixed per scenario, so the replay of the right answer looks the same.
const holds = sc => ([...String(sc.id)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7) >>> 4) % 3 !== 0;
// A shot is on only if no defender is within a body-width of the line from the shooter to the goal.
const shotClear = (a, aim, opps) => opps.every(o => closestOnLane(o, a, aim, 0).d > .9);
// The first defender along a kick's path (not just the nearest to it) who stands within `reach` of it, with the
// point where he meets it. Nothing when the path is clear.
const firstInLane = (opps, from, to, t0, reach) => opps.map(o => ({ opp: o, ...closestOnLane(o, from, to, t0) })).filter(c => c.d < reach).sort((a, b) => a.t - b.t)[0];

// Which foot strikes the ball (1 his left, 0 his right), as coaches teach it. Both feet, chosen by the play:
// - a shot from one side of the goal: the foot on that side (left of the goal, left foot). In the middle, as below.
// - a pass to his left: the inside of his right foot (the inside of that foot faces left), and to his right the left foot.
// - straight on: the foot farther from the nearest defender, so his body is between the defender and the ball.
// `a.face` is still the way he faced before he turns to the target.
export function pickFoot(a, x, y, kind, opps = []) {
  const dx = x - a.x, dy = y - a.y, [fx, fy] = a.face;
  if (kind === 'shot' && (x > L - .5 || x < .5)) { const off = (a.y - W / 2) * (x > L / 2 ? 1 : -1); if (Math.abs(off) > .8) return +(off > 0); } // off: + when he is left of the goal's middle
  else { const turn = Math.atan2(fx * dy - fy * dx, fx * dx + fy * dy); if (Math.abs(turn) > .3) return +(turn < 0); }
  const o = opps.filter(o => dist(o, a) < 5).sort((p, q) => dist(p, a) - dist(q, a))[0];
  if (o) return +(dx * (o.y - a.y) - dy * (o.x - a.x) < 0); // a defender on his left: the right foot
  return Math.floor((a.x + a.y) * 1.7) & 1;                    // nobody near: either foot
}

export const outcomes = {
  // How a play ends: note the result, stop everyone where they stand, show the banner and hold on it for `wait` seconds
  // (shorter in a match: see hold).
  // (round 6) Nobody ends a play standing at the shoulder of the player on the ball: one of the other team within a
  // step and a half of him goes in for it first, and misses (this.challenge): the play ends with him beaten, going past.
  *end(result, wait) {
    const s = this.sim, c = s.ball.carrier && s.ball.state !== 'flying' ? s.a(s.ball.carrier) : null, o = c && !c.gk && (this.mode === 'match' || this.mode === 'free') ? this.onHim(c) : null;
    if (o && result !== 'goal' && result !== 'goalAgainst') { yield* this.challenge(o, c); s.stop(c.id); }
    // (One who went in a moment ago and is still at his shoulder is carried on past him, off balance, and turns: he does not stand there.)
    for (const a of s.agents.values()) a.bx = null;
    if (c && !c.gk) for (const f of s.team(c.team === 'us' ? 'them' : 'us')) { const d = dist(f, c); if (f.gk || d > 1.8 || !(f.tk > s.time - 2)) continue;
      const ux = (c.x - f.x) / (d || 1), uy = (c.y - f.y) / (d || 1), sd = Math.sign(ux * (f.ty - f.y) - uy * (f.tx - f.x)) || 1;
      f.beat = s.time + 1.3; f.bx = clamp(f.x + ux * (d + .9) - uy * sd * 1.3, .5, L - .5); f.by = clamp(f.y + uy * (d + .9) + ux * sd * 1.3, .5, W - .5); }
    this.result = result; this.ai = false; const live = this.mode === 'match' || this.mode === 'free', goOn = live && c ? [...s.agents.values()].filter(a => this.leaving(a) && dist(a, c) < 2.2).map(a => [a.id, a.tx, a.ty]) : []; s.stopAll(); for (const [id, x, y] of goOn) s.go(id, x, y, 3); // (a friend on his way round the ball to his player goes on: he does not stop at its shoulder)
     if (live) for (const a of s.agents.values()) if (a.beat > s.time && a.bx != null) s.go(a.id, a.bx, a.by, 2.6); this.emit(result); yield this.hold(result, wait); },
  // In a match the next decision opens sooner once the picture has shown how the play ended: everyone stands still
  // here, so a shorter hold changes nothing on the pitch. A goal keeps a short celebration. Lessons keep their holds.
  hold(result, wait) { return this.mode === 'match' || this.mode === 'free' ? Math.min(wait, MATCH_HOLD[result] ?? wait) : wait; },
  // (round 6) A tackle the player on the ball survives. In live play nobody stands or jogs beside the ball: one of the
  // other team within a step and a half of it goes in for it, now. Here he misses: he lunges at where the ball is, the
  // player on it takes it a step aside, and the lunge carries him past (off balance for a second: a.beat, until then
  // nothing steers him). After that he turns and chases (team.js defend). a.tk: when he went in.
  *challenge(o, a) {
    const s = this.sim, b = s.ball, dx = b.x - o.x, dy = b.y - o.y, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    o.tk = s.time; o.beat = s.time + 1; o.mom = null; this.scripted.add(o.id);
    s.go(o.id, clamp(b.x + ux * 1.4, .5, L - .5), clamp(b.y + uy * 1.4, .5, W - .5), 5.2);
    // (on the way he is going, and a step to the side away from the one coming in: his body between him and the ball)
    const v = a.lv && Math.hypot(a.lv[0], a.lv[1]) > .5 ? a.lv : a.face, vl = Math.hypot(v[0], v[1]) || 1, fx = v[0] / vl, fy = v[1] / vl, sd = -Math.sign(fx * (o.y - a.y) - fy * (o.x - a.x)) || 1, nx = -fy * sd, ny = fx * sd;
    // (running, he just goes on: the lunge comes in behind him; nearly still, he takes that step)
    if (Math.hypot(a.tx - a.x, a.ty - a.y) < .5) { this.scripted.add(a.id); s.go(a.id, clamp(a.x + nx * .8 + fx * .6, 1, L - 1), clamp(a.y + ny * .8 + fy * .6, 1, W - 1), 3.2); }
    yield .45;
    this.scripted.delete(o.id);
  },
  // Everyone of the other team within a step and a half of the player on the ball steps in at it, now (to a short step
  // off it), as it is played away from him: too late, and off balance for a moment.
  stepIn(c, r = 1.6) { const s = this.sim, b = s.ball; for (const d of s.team(c.team === 'us' ? 'them' : 'us')) { if (d.gk || dist(d, c) >= r || d.beat > s.time || this.leaving(d)) continue; const l = dist(d, b) || 1; d.tk = s.time; d.beat = s.time + .9;
    if (l > .9) { this.scripted.add(d.id); s.go(d.id, b.x + (d.x - b.x) / l * .8, b.y + (d.y - b.y) / l * .8, 3.4); } } },
  // A friend whose job in this defending play is one of their other players (team.js defend, this.teamJob): he is on his way off the ball.
  leaving(d) { return d.team === 'us' && d.id !== 'hero' && !!this.teamJob?.[d.id] && this.teamJob[d.id].job !== 'press'; },
  // The nearest of theirs within a step and a half of him who has not just been beaten.
  onHim(a, r = 1.5) { const s = this.sim; return s.team(a.team === 'us' ? 'them' : 'us').filter(o => !o.gk && !(o.beat > s.time) && !this.leaving(o) && dist(o, a) < r).sort((p, q) => dist(p, a) - dist(q, a))[0] || null; },
  // After a good choice the player runs at goal, but only shoots when nobody blocks the path or the shot.
  // If a defender steps in front, he stops and keeps the ball: that is the real reward for a safe choice.
  *finish(id) {
    const s = this.sim, a = s.a(id), tx = L - 3.5, opps = s.team('them');
    this.spice('finish', [id], .9);
    const room = y => Math.min(...opps.map(o => closestOnLane(o, a, { x: tx, y }, 0).d));
    const ty = [W / 2 - 2.5, W / 2, W / 2 + 2.5].map(y => ({ y, r: room(y) - Math.abs(y - a.y) * .08 })).sort((p, q) => q.r - p.r)[0].y;
    this.scripted.add(id); s.go(id, tx, ty, FINISH_RUN);
    const t0 = s.time;
    let blocked = false, near = null;
    this.inFinish = true; // (round 5: a defender within reach of the ball goes for it, team.js defend)
    for (;;) {
      yield 1 / 30;
      // (round 5) One of theirs within reach of him, from any side: a challenge. He cannot run on through it: he puts
      // his body between and keeps the ball (the result a right choice gives), and the next choice comes under pressure.
      // (round 6: within a step and a half he goes in for it at once, and misses: this.challenge)
      { const o = this.onHim(a); if (o) { yield* this.challenge(o, a); blocked = true; break; } }
      // The one he just beat (the presser his dribble took him past, the one he raced to a big push) recovers: after the
      // moment it takes him to turn he chases, for a second and a half, and challenges if he catches him.
      const ch = this.chaser, co = ch && s.a(ch.id);
      if (co) { if (s.time - ch.t > 1.9) { this.scripted.delete(ch.id); this.chaser = null; } else if (s.time - ch.t > (ch.turn || 0)) { this.scripted.add(ch.id); s.go(ch.id, a.x, a.y, 4.8); } }
      const aim = { x: L, y: clamp(a.y, gy0 + .8, gy1 - .8) };
      if (dist(a, aim) < 8 && shotClear(s.ball, aim, opps)) { if (opps.some(o => !o.gk && dist(o, a) < 1.7)) { const o = this.onHim(a, 1.9); if (o) yield* this.challenge(o, a); blocked = true; } break; } // close (5–10 yards) with a clear look: shoot; (round 5) unless one of theirs is a step away: he would be on him before his foot came through, so he keeps it
      const fx = tx - a.x, fy = ty - a.y, fl = Math.hypot(fx, fy) || 1;
      if (opps.some(o => dist(o, a) < 1.7 && ((o.x - a.x) * fx + (o.y - a.y) * fy) / fl > .2)) { const o = this.onHim(a, 1.9); if (o) yield* this.challenge(o, a); blocked = true; break; } // defender in front (round 6: he goes in for it)
      if (Math.hypot(fx, fy) < .3 || s.time - t0 > 4) { blocked = !shotClear(s.ball, aim, opps); break; }
    }
    s.stop(id); this.spice(null); this.inFinish = false; if (this.chaser) { this.scripted.delete(this.chaser.id); this.chaser = null; }
    if (blocked) { yield* this.end('kept', 1.1); return; }
    // Wind up facing the goal, then check the shot line once more at the moment of the kick.
    this.ai = false; s.stopAll();
    const gk = s.keeper('them'), shot = { x: L + .7, y: gk ? placedAim(s.ball, gk) : clamp(a.y, gy0 + .8, gy1 - .8) }; // (a keeper: the bigger space)
    const foot = pickFoot(a, shot.x, shot.y, 'shot', opps);
    faceTo(a, shot.x, shot.y);
    let inWay = false;
    for (const p of s.team('us')) if (p.id !== id && closestOnLane(p, s.ball, shot, 0).d < 1.2) { inWay ||= closestOnLane(p, s.ball, shot, 0).d < .7; this.scripted.add(p.id); this.frozen.push(p.id); this.giveWay(p, s.ball, shot); }
    if (inWay) yield .25; // (v66: a friend right on the shot's line has a moment to step off it before the wind-up: play moves on while he chooses, so one can be there)
    s.windup(id, 'shot', foot); yield .2;
    if (!shotClear(s.ball, shot, opps)) { yield* this.end('kept', 1.1); return; }
    // (round 6) A match with keepers: a shot at the end of a run (not one he aimed himself) is now and then struck too
    // near their keeper, and he holds it (seeded, THEIR_SAVE of them, as our keeper stops theirs): their ball.
    if (gk && (this.mode === 'match' || this.mode === 'free') && seeded(a.x, a.y, s.time, this.score?.us ?? 0, 5) < THEIR_SAVE) {
      const at = this.inFront(gk, { x: gk.x, y: gk.y, z: .8 }); s.kick(at.x, at.y, { speed: 15, arc: .15 }); this.kicked = true;
      yield () => s.ball.state === 'loose';
      Object.assign(s.ball, { state: 'held', carrier: gk.id }); yield .15; yield* this.savedShot(gk); return;
    }
    const wrong = gk && this.guessWrong(gk, shot.y); this.keeperReact(gk, gk && (wrong || shotResult({ from: s.ball, y: shot.y, foot: 'placed', k: gk, force: 'goal' })), s.ball, wrong ? GUESS_T : 0);
    if (wrong) yield GUESS_T; // (his lean and step show before the kick)
    s.kick(shot.x, shot.y, { speed: 17, arc: .5 }); this.kicked = true;
    yield () => s.ball.state === 'loose';
    yield* this.end('goal', 1.4);
  },
  // Turn to face the target, wind up, then the ball leaves the foot at contact. Players the scripts aren't
  // moving freeze if they stand near the ball's path, so the team AI never walks anyone into (or through) it.
  // A player near the path of a kick stops; one right in it steps out of the way, to the side he is already on.
  giveWay(p, from, to, low = true) {
    const c = closestOnLane(p, from, to, 0);
    if (c.d < 1.1) p.mom = null; p.momOff = this.sim.time + 1.5; // (on its line or nearly: he gets out of its way at once, whatever he was doing)
    if (!low || c.d >= .8) { this.sim.stop(p.id); return; }
    const dx = p.x - c.x, dy = p.y - c.y, l = Math.hypot(dx, dy);
    let nx = l > .05 ? dx / l : -(to.y - from.y), ny = l > .05 ? dy / l : to.x - from.x; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    // (v66) Someone standing on that side, in his way (a defender marking him close): he steps off it to the other side.
    const at = k => ({ x: clamp(c.x + nx * 1.3 * k, .5, L - .5), y: clamp(c.y + ny * 1.3 * k, .5, W - .5) });
    const shut = q => [...this.sim.agents.values()].some(o => { if (o === p) return false; const k = closestOnLane(o, p, q, 0); return k.d < .8 && k.t > .15; }); // (on his way there, not merely beside him)
    const q = shut(at(1)) && !shut(at(-1)) ? at(-1) : at(1);
    this.sim.go(p.id, q.x, q.y, 4.5);
  },
  // Facing well away from where he will play the ball (more than about 60°), he first turns with it (a cut, a hook or
  // a pull back, see sim.js). Less than that he passes across his body from where the ball is. Players close to him
  // that the scripts aren't moving hold still meanwhile, so nobody walks into the pass.
  *turnTo(id, x, y) {
    const s = this.sim, a = s.a(id), t = s.ball.carrier === id ? s.turn(id, x, y, 1.05) : 0;
    if (!t) return;
    const held = [...s.agents.values()].filter(p => p.id !== id && !this.scripted.has(p.id) && dist(p, a) < 4 && !(p.lv && Math.hypot(p.lv[0], p.lv[1]) > 2 && dist(p, a) > 1.5)); // (v66: one coming at a run from a few steps off is not frozen in his stride: the kick's own check clears its line)
    for (const p of held) { this.scripted.add(p.id); s.stop(p.id); }
    yield t;
    for (const p of held) this.scripted.delete(p.id); // free again: the kick's own check moves anyone in its path
  },
  *strike(id, x, y, opts) {
    const s = this.sim, a = s.a(id), to = { x, y };
    yield* this.turnTo(id, x, y);
    for (const p of s.agents.values()) if (p.id !== id && !p.gk && !this.scripted.has(p.id) && closestOnLane(p, s.ball, to, .02).d < 1.2) { this.scripted.add(p.id); this.frozen.push(p.id); this.giveWay(p, s.ball, to, (opts?.arc ?? .3) < .4); }
    // (v66) One of the other team the play's script has coming at the kicker (the one who was running in) may be on the
    // ball's line near its start: he too steps off it. (Not one waiting where it is going: he is there to cut it out.)
    for (const p of s.agents.values()) if (p.id !== id && !p.gk && this.scripted.has(p.id) && !this.frozen.includes(p.id) && dist(p, to) > 1.5 && (p.team === a.team || dist(p, s.ball) < 3) && closestOnLane(p, s.ball, to, .02).d < .9) this.giveWay(p, s.ball, to, (opts?.arc ?? .3) < .4); // (and a friend who has drifted onto it, anywhere along it)
    // The foot follows the way the ball lies from him (his body may already face the target after a look around).
    const line = s.ball.carrier === id ? { x: a.x, y: a.y, face: [Math.cos(s.ball.h), Math.sin(s.ball.h)] } : a;
    const kind = (opts?.speed ?? 11) > 14 ? 'shot' : 'pass', foot = pickFoot(line, x, y, x > L - .5 || x < .5 ? 'shot' : kind, [...s.agents.values()].filter(o => o.team !== a.team)); // (at goal, the side's foot, also for a placed inside-foot shot: v64, he may come to it from any way he was carrying the ball)
    faceTo(a, x, y); s.windup(id, kind, foot); yield .2;
    s.kick(x, y, opts); this.kicked = true;
  },
  *passGood(id) {
    const s = this.sim, t = s.a(id);
    this.scripted.add(id); s.stop(id); yield* this.turnTo('hero', t.x, t.y);
    s.open(id, L - 3.5, W / 2); // he will turn with it toward goal (finish)
    yield* this.strike('hero', t.x, t.y, { speed: 13, arc: .2 });
    this.scripted.delete('hero'); // after passing he runs to support
    yield () => s.ball.state === 'loose';
    s.give(id); this.scripted.delete(id); yield .15;
  },
  // `ev`: the banner; 'lost' when it was a loose ball they got to first ("They got it!": he never had it).
  *steal(opp, ev = 'stolen') {
    const s = this.sim; this.spice(null);
    // He has to actually reach the ball before it's his.
    const t0 = s.time; yield () => { s.go(opp.id, s.ball.x, s.ball.y, 5); return dist(opp, s.ball) < .75 || s.time - t0 > .7; };
    { const c0 = s.ball.carrier && s.a(s.ball.carrier); if (c0 && c0.team !== opp.team) c0.beat = s.time + .6; } // (round 6: the one it is taken from is beaten: off balance for a moment)
    opp.tk = s.time; s.give(opp.id); s.stop('hero'); this.result = 'stolen'; this.emit(ev);
    this.scripted.add(opp.id);
    const to = { x: Math.max(2.5, opp.x - 4), y: clamp(lerp(opp.y, W / 2, .4), 1.5, W - 1.5) }, lv = opp.lv, ls = lv ? Math.hypot(lv[0], lv[1]) : 0;
    // (round 5) Running the other way as he wins it (he came in from behind, or was carried past): he takes it on a
    // curve, half a second round, not straight back on himself.
    if (ls > 2 && ls < 6 && (lv[0] * (to.x - opp.x) + lv[1] * (to.y - opp.y)) < 0) {
      // (round 6: in three bends, each under 70°, so no step of it is a snap)
      const ux = lv[0] / ls, uy = lv[1] / ls, sd = Math.sign(ux * (to.y - opp.y) - uy * (to.x - opp.x)) || 1, A = Math.acos(clamp((ux * (to.x - opp.x) + uy * (to.y - opp.y)) / (Math.hypot(to.x - opp.x, to.y - opp.y) || 1), -1, 1));
      for (const f of [.34, .67]) { const c = Math.cos(A * f * sd), sn = Math.sin(A * f * sd); s.go(opp.id, clamp(opp.x + (ux * c - uy * sn) * 1.4, 1, L - 1), clamp(opp.y + (ux * sn + uy * c) * 1.4, 1, W - 1), Math.max(2.4, ls * .7)); yield .3; }
      s.go(opp.id, to.x, to.y, 4.8); yield .4; return;
    }
    s.go(opp.id, to.x, to.y, 4.8); yield .8;
  },
  *passBad(id) {
    const s = this.sim, m = s.a(id), them = s.team('them');
    yield* this.turnTo('hero', m.x, m.y); // facing away, he turns with the ball first
    // The defender who cuts it out is the first one along the path (not just the nearest to it).
    const along = firstInLane(them, s.ball, m, .02, .9);
    const ic = along || interceptor(s.ball, m, them);
    let marker = s.team('them').sort((a, b) => dist(a, m) - dist(b, m))[0];
    // If the cut-off point is past where he'll meet the ball, the ball reaches him first: then it's a tackle, not an interception.
    const meetD = dist(s.ball, { x: lerp(m.x, s.ball.x, .3), y: lerp(m.y, s.ball.y, .3) }), late = dist(s.ball, ic) > meetD + .2;
    if (late) marker = ic.opp;
    if ((ic.d > .9 && dist(marker, m) < 1.8) || late) { // lane was open but a defender was right on him: he gets the ball and loses it straight away
      this.scripted.add(id); this.scripted.add(marker.id);
      const meet = { x: lerp(m.x, s.ball.x, .2), y: lerp(m.y, s.ball.y, .2) }; s.go(id, meet.x, meet.y, 3.5); // he comes to meet it
      yield* this.strike('hero', meet.x, meet.y, { speed: 13, arc: .2 });
      s.go(marker.id, meet.x, meet.y, 4.5);
      yield () => s.ball.state === 'loose';
      // He controls it, but the defender is right there: the steal only happens once the defender reaches him.
      s.give(id); s.stop(id);
      const t0 = s.time; yield () => { s.go(marker.id, m.x, m.y, 4.5); return dist(marker, m) < .8 || s.time - t0 > 1.5; };
      yield* this.steal(marker); return;
    }
    // The receiver steps toward the ball to meet it; the defender in the lane gets there first.
    this.scripted.add(id); s.go(id, lerp(m.x, s.ball.x, .3), lerp(m.y, s.ball.y, .3), 4.2);
    this.scripted.add(ic.opp.id); ic.opp.mom = null; ic.opp.momOff = this.sim.time + 1.5; s.go(ic.opp.id, ic.x, ic.y, 6); // (he steps into its line at once)
    yield* this.strike('hero', ic.x, ic.y, { speed: 13, arc: .15 });
    yield () => s.ball.state === 'loose';
    const t0 = s.time; yield () => { s.go(ic.opp.id, s.ball.x, s.ball.y, 6); return dist(ic.opp, s.ball) < .7 || s.time - t0 > 1; };
    yield* this.steal(ic.opp);
  },
  *dribbleGen(dir, good, aim = null) {
    const s = this.sim, h = s.a('hero'), end = aim || dribbleEnd(h, dir, L, W), gkOut = this.sc?.gk?.out && s.keeper('them');
    if (gkOut && (dir === 'fwd' || dir === 'fl' || dir === 'fr')) { yield* this.roundKeeper(dir, good, gkOut); return; } // (at him, or round him)
    const cut = good && takeOn(h, dir, s.team('them'));
    // A good dribble with a defender near his way: he beats him with a skill (the reward for the right choice).
    const near = good && s.team('them').some(o => closestOnLane(o, h, end, 0).d < 2.5 && dist(o, h) > 1.2);
    this.scripted.add('hero'); this.spice(good && (cut?.good ? 'take-on' : 'dribble'), ['hero'], cut?.good || near ? 1 : .95, !!(cut?.good || near)); s.go('hero', end.x, end.y, 4.4);
    const t0 = s.time;
    // A take-on: the defender bites, stepping in toward where the ball was, and he cuts past him on the open side.
    if (cut?.good) { const f = cut.foe; f.tk = s.time; f.beat = s.time + .9; this.scripted.add(f.id); s.go(f.id, lerp(f.x, h.x, .5), lerp(f.y, h.y, .5), 3); yield .45; this.scripted.delete(f.id); }
    // (round 6) One of theirs on him as he sets off the right way (a late tap): he goes in for where the ball was, and is beaten.
    else if (good) for (const f of s.team('them')) if (!f.gk && dist(f, h) < 1.5 && !(f.beat > s.time)) { f.tk = s.time; f.beat = s.time + .9; this.scripted.add(f.id); s.go(f.id, lerp(f.x, s.ball.x, .8), lerp(f.y, s.ball.y, .8), 3.6); this.bit = f.id; }
    if (good) {
      const th = this.lastThreat && s.a(this.lastThreat); if (th && th.team === 'them' && !th.gk && dist(th, h) < 4.5 && !cut?.good) this.chaser = { id: th.id, t: s.time, turn: .5 }; // (round 5: the one who was coming turns (half a second) and chases)
      // (round 5) One of theirs who stays within reach of him as he goes (he was on him as he set off, and is not left
      // behind) challenges: nobody jogs alongside. He puts his body between and keeps it: the right choice's result.
      let on = null, met = false;
      // (round 6: within a step and a half, once he is under way, that one goes in for it at once, and misses)
      yield () => { if (s.time - t0 > .35 && this.onHim(h)) met = true; return met || dist(h, end) < (aim ? 1.2 : .3) || s.time - t0 > 2.5; }; // (after a turn: on toward goal once he is nearly there, not a last steer onto the exact point)
      if (met) { const o = this.onHim(h); if (o) yield* this.challenge(o, h); s.stop('hero'); if (this.chaser) { this.scripted.delete(this.chaser.id); this.chaser = null; } yield* this.end('kept', 1.1); return; }
      if (BACKWARD.has(dir) || this.keepOnly) { s.stop('hero'); yield* this.end('kept', 1.1); return; }
      yield* this.finish('hero');
    } else {
      const opps = s.team('them').sort((a, b) => dist(a, end) - dist(b, end)).slice(0, 2);
      // (v66) One already running in whom the dribble comes toward (its end is behind where he is heading) keeps coming and
      // meets it: he goes at the dribbler, he does not hop back to where the dribble would have ended.
      const meets = new Set(opps.filter(o => o.lv && Math.hypot(o.lv[0], o.lv[1]) > 2 && o.lv[0] * (end.x - o.x) + o.lv[1] * (end.y - o.y) < 0).map(o => o.id));
      for (const o of opps) { this.scripted.add(o.id); if (meets.has(o.id)) s.go(o.id, h.x, h.y, 5); else s.go(o.id, end.x, end.y, 5); }
      // Taking a pass with a turn into him: the turn is seen first (the defender takes it as the touch ends), so the
      // picture shows the turn he picked, then what it cost.
      const turning = () => this.sc.kind === 'receive' && s.ball.carrier === 'hero' && s.ball.move;
      const rec = this.sc.kind === 'receive'; // (v64) turning into a defender: he steps in on him, not to where the turn was going
      // (round 6: one who would be at the dribble's end before him goes at him from there on: he does not run on to the spot, stop dead and come back)
      yield () => { for (const o of opps) if (rec || meets.has(o.id) || dist(o, end) < dist(h, end) + .6) s.go(o.id, h.x, h.y, 5); return (opps.some(o => dist(o, h) < .9) && !turning()) || s.time - t0 > 2.5; };
      yield* this.steal(opps.find(o => dist(o, h) < 1.2) || opps[0]);
    }
  },
  // The keeper rushed out at him (v62, "Shoot to the space!"): a cut past him on his open side, and the keeper goes down
  // at the ball where it was, too late; then the empty goal. At him, or round his other side: he smothers it.
  *roundKeeper(dir, good, k) {
    const s = this.sim, h = s.a('hero'), end = dribbleEnd(h, dir, L, W), cut = good && (dir === 'fl' || dir === 'fr');
    this.scripted.add('hero'); this.scripted.add(k.id);
    if (cut) {
      this.spice('take-on', ['hero'], 1, true); s.go('hero', end.x, end.y, 4.4);
      const at = { x: h.x + .6, y: h.y }; // he goes for the ball where it was
      this.keeperReact(k, { res: 'goal', to: at, at, t: .45, arc: .1 }, { x: h.x, y: h.y }, 0); k.gkm.k = 'dive';
      const t0 = s.time; yield () => Math.hypot(h.x - end.x, h.y - end.y) < .3 || s.time - t0 > 2.5;
      yield* this.finish('hero'); return;
    }
    if (!good) { // he dives at the ball and gathers it
      const t0 = s.time; s.go('hero', end.x, end.y, 4.4); yield .25;
      this.keeperReact(k, { res: 'save', at: { x: s.ball.x, y: s.ball.y }, t: .35, arc: .05 }, { x: h.x, y: h.y }, 0);
      Object.assign(k.gkm, { k: 'dive', low: true, side: Math.sign((s.ball.y - k.y) * -1) || 1 }); // down at his feet
      yield () => { if (Math.hypot(k.x - s.ball.x, k.y - s.ball.y) < 1.6) s.stop('hero'); return Math.hypot(k.x - s.ball.x, k.y - s.ball.y) < 1 || s.time - t0 > 1.6; };
      s.stop('hero'); Object.assign(s.ball, { state: 'held', carrier: k.id, move: null, reach: null }); yield .2;
      yield* this.savedShot(k); return;
    }
  },
  // Big push: knock the ball 7 m ahead and race for it. Whoever gets there first wins it.
  *pushGen(dir, good) {
    const s = this.sim, h = s.a('hero'), end = pushEnd(h, dir), opps = s.team('them');
    this.scripted.add('hero');
    // Defenders hold still for the moment of the kick (they rejoin the team AI once the ball lands).
    for (const o of opps) if (!this.scripted.has(o.id)) { this.scripted.add(o.id); s.stop(o.id); this.frozen.push(o.id); }
    // A bad push straight at a defender is his ball: he stops it where it reaches him.
    const inLane = !good && firstInLane(opps, s.ball, end, .05, 1);
    if (inLane) {
      const o = inLane.opp; this.scripted.add(o.id); o.mom = null; o.momOff = this.sim.time + 1.5; s.go(o.id, inLane.x, inLane.y, 4);
      yield* this.strike('hero', inLane.x, inLane.y, { speed: 8.5, arc: .1 });
      yield () => s.ball.state === 'loose';
      const t0 = s.time; yield () => dist(o, s.ball) < .7 || s.time - t0 > .8;
      yield* this.steal(o); return;
    }
    yield* this.strike('hero', end.x, end.y, { speed: 8.5, arc: .15 });
    s.go('hero', end.x, end.y, 5.4);
    // The nearest defender always races for it too. A push is only "good" when he clearly gets there first,
    // so the defender arrives a step late (and pulls up instead of running into him).
    const racer = opps.sort((a, b) => dist(a, end) - dist(b, end))[0];
    // He runs to just beside where it stops, on his own side of its line, so he chases it instead of running down the ball's path.
    const ex = end.x - s.ball.x, ey = end.y - s.ball.y, el = Math.hypot(ex, ey) || 1, rs = Math.sign(ex * (racer.y - s.ball.y) - ey * (racer.x - s.ball.x)) || 1;
    this.scripted.add(racer.id); s.go(racer.id, end.x - ey / el * .6 * rs, end.y + ex / el * .6 * rs, good ? DEF_RUN : 5);
    const t0 = s.time; yield () => s.ball.state === 'loose' && (dist(h, end) < .6 || (!good && dist(racer, end) < .6)) || s.time - t0 > 3;
    if (good) {
      s.give('hero');
      // (round 5) The one who raced him for it is a step late, and keeps coming: he challenges if he gets there (finish).
      yield .1; this.chaser = { id: racer.id, t: s.time };
      if (this.keepOnly) { yield* this.end('kept', 1.1); return; }
      yield* this.finish('hero');
    } else yield* this.steal(racer);
  },
  // Defense: he runs to the spot he picked. The right spot closes every way through: usually the attackers
  // just get stopped and have to pass back (no steal needed), sometimes they try anyway and lose the ball.
  // A wrong spot leaves a gap.
  *defendGen(spotId, good) {
    const s = this.sim, sc = this.sc, sp = sc.spots.find(x => x.id === spotId), c = s.a(sc.carrier || 'o1'), h = s.a('hero');
    this.scripted.add('hero'); s.go('hero', sp.x, sp.y, 5.2);
    // (round 6) His friends take the other jobs (team.js defend): he goes to the ball, they stay with their players; he guards, the nearest of them goes.
    this.teamJob = { hero: spotId === 'home' || spotId === 'chase' ? 'press' : s.a(spotId) ? spotId : null, ...(sc.jobs?.[spotId] || {}) }; this.roles = null;
    const defenders = () => s.team('us');
    yield .55;
    const toGoal = (a) => { const dx = 0 - a.x, dy = W / 2 - a.y, l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
    if (good && holds(sc)) {
      // He's in the way: the carrier slows down when a defender is in front of him, finds no way through and passes away.
      const [gx, gy] = toGoal(c);
      this.spice('held', [c.id], .8); // running at him he may try a skill (it gets him nowhere: he is in the way)
      this.scripted.add(c.id); s.go(c.id, c.x + gx * 3, c.y + gy * 3, 2.4);
      const t0 = s.time;
      yield () => defenders().some(d => ((d.x - c.x) * gx + (d.y - c.y) * gy > .3 && dist(d, c) < 2.4) || (!d.gk && !this.leaving(d) && dist(d, c) < 1.8)) || s.time - t0 > 2.5;
      s.stop(c.id); this.spice(null); this.stepIn(c); yield .3;
      // (round 6) One of ours within a step and a half of him steps in for it as he gets rid of it: nobody stands at his shoulder.
      this.stepIn(c);
      yield .1;
      const mates = s.team('them').filter(o => o.id !== c.id), us = s.team('us');
      const lane = o => Math.min(...us.map(d => closestOnLane(d, s.ball, o, .05).d));
      const to = mates.filter(o => lane(o) > 1).sort((a, b) => lane(b) - lane(a))[0];
      if (to) { // he passes away to a teammate; with no open pass at all, he just turns away and holds it up
        this.scripted.add(to.id); s.stop(to.id);
        yield* this.strike(c.id, to.x, to.y, { speed: 10, arc: .15 });
        yield () => s.ball.state === 'loose';
        s.give(to.id);
      } else { const [hx, hy] = toGoal(c); yield Math.max(.5, s.turn(c.id, c.x - hx * 3, c.y - hy * 3)); } // he turns away with the ball (a pull back or a hook)
      yield* this.end('held', 1.3); return;
    }
    if (good) {
      let guarded = spotId.startsWith('o') ? s.a(spotId) : null;
      if (guarded && s.team('us').some(d => d.id !== 'hero' && closestOnLane(d, c, guarded, .05).d < .7)) guarded = null; // a friend is in the way: he wins it in front instead
      if (guarded) { // the carrier tries the pass he was guarding; he steps in and takes it
        this.scripted.add(c.id); this.scripted.add(guarded.id);
        const cut = { x: lerp(c.x, guarded.x, .75), y: lerp(c.y, guarded.y, .75) };
        yield .35; s.go('hero', cut.x, cut.y, 5.4);
        yield* this.strike(c.id, cut.x, cut.y, { speed: 10, arc: .1 });
        yield () => s.ball.state === 'loose' || (s.ball.z < .9 && dist(h, s.ball) < .5); // he takes it the moment it reaches him
        s.give('hero');
      } else if (this.duelOK) { // in a match, once he has "Steal it!": now it's 1v1, and he picks the moment
        this.duelOK = false; this.result = 'duel'; return;
      } else { // pressure or recovery: he is now in front of the ball, so the carrier runs into him and loses it
        const [gx, gy] = toGoal(c);
        this.spice('press', [c.id], .8); // he may try a skill on the way, and still runs into the tackle
        this.scripted.add(c.id); s.go(c.id, c.x + gx * 3, c.y + gy * 3, 2.8);          // keeps going at goal, facing it
        // The tackle comes from a defender who is goal-side of the ball (in front of him), never from behind.
        const front = [...defenders()].filter(d => (d.x - c.x) * gx + (d.y - c.y) * gy > .3).sort((a, b) => dist(a, c) - dist(b, c));
        const tackler = front.includes(h) ? h : front[0] || h; // he made the right run, so he makes the tackle
        this.scripted.add(tackler.id);
        const t0 = s.time;
        yield () => { s.go(tackler.id, c.x + gx * .7, c.y + gy * .7, 4.6); return dist(tackler, c) < 1 || s.time - t0 > 3; };
        this.spice(null); c.face = [gx, gy];
        tackler.face = [-gx, -gy]; s.give(tackler.id);                                     // he pokes it away, facing upfield
        s.go(tackler.id, tackler.x - gx * 2.5, tackler.y - gy * 2.5, 3.6);
        c.beat = s.time + 1.7; s.go(c.id, clamp(c.x + gx * 1.4, 1, L - 1), clamp(c.y + gy * 1.4 + (c.y >= tackler.y ? .6 : -.6), 1, W - 1), 2.4); // (round 6: the one who lost it stumbles on the way he was going, beaten)
        yield .6;
      }
      yield* this.end('won', 1.3); return;
    }
    // Wrong spot: the attackers use the gap he left — an open run at goal, or a pass to the unmarked attacker.
    const plan = sc.exploits?.[spotId] || { kind: 'dribble', who: c.id, to: [4.5, W / 2] };
    let shooter = c;
    this.ai = false; for (const d of s.team('us')) if (d.id !== 'hero') s.stop(d.id);
    if (plan.kind === 'pass') {
      const t1 = s.time; yield () => dist(h, sp) < .4 || s.time - t1 > 1 || (s.time - t1 > .3 && dist(h, c) < 1.5);
      this.stepIn(c); // (round 6: one of ours at his shoulder goes in for it as he plays it past him)
      const free = s.a(plan.who);
      this.scripted.add(c.id); this.scripted.add(free.id); s.stop(free.id);
      yield* this.strike(c.id, free.x, free.y, { speed: 11, arc: .2 });
      yield () => s.ball.state === 'loose';
      s.give(free.id); shooter = free;
    }
    this.scripted.add(shooter.id); this.spice('exploit', [shooter.id], .85); // through the gap he left: a skill shows he got past
    const spot = { x: plan.to[0], y: plan.to[1] };
    s.go(shooter.id, spot.x, spot.y, 5.2);
    // He got past them: the beaten defenders chase from behind (slower), so nobody magically appears in the shot.
    this.ai = false;
    // Only the beaten player (him) chases from behind; teammates stay with their own players.
    for (const d of s.team('us')) if (d.id !== 'hero') s.stop(d.id);
    const t0 = s.time; yield () => { s.go('hero', shooter.x + 1.4, shooter.y + (h.y > shooter.y ? 1 : -1), 3.4); return dist(shooter, spot) < .4 || s.time - t0 > 3.5; };
    yield* this.concede(shooter);
  },
  // Their player is through: everyone stops, and he shoots into our goal.
  *concede(shooter) {
    if (this.keeperTurn?.(shooter)) { this.spice(null); yield* this.keeperShot(shooter); return; } // (v67: now and then he is our keeper for it: game/handover.js)
    const s = this.sim; this.spice(null);
    this.ai = false; s.stopAll();
    const gk = s.keeper('us'), y = gk ? placedAim(shooter, gk, 0) : clamp(shooter.y, gy0 + .8, gy1 - .8); // (our keeper: past him, in the bigger space)
    if (gk && (this.mode === 'match' || this.mode === 'free') && seeded(shooter.x, shooter.y, s.time, this.score?.them ?? 0) < OUR_SAVE) { yield* this.ourSave(shooter, gk); return; } // (a match: now and then our keeper stops it)
    if (gk) { // past our keeper: he dives and misses, or now and then he went early the wrong way (seeded)
      this.scripted.add(gk.id); s.stop(gk.id); yield* this.turnTo(shooter.id, -.7, y);
      const r = shotResult({ from: s.ball, y, foot: 'placed', k: gk, gx: 0, force: 'goal' }), wrong = seeded(shooter.x, shooter.y, 23) < .25;
      this.keeperReact(gk, wrong ? { ...r, act: 'wrong', dir: -Math.sign(y - gk.y) || 1 } : r, s.ball);
    }
    yield* this.strike(shooter.id, -.7, y, { speed: 17, arc: .5 });
    yield () => s.ball.state === 'loose';
    yield* this.end('goalAgainst', 1.3);
  },
  // A match (v62): their shot is at our keeper, and he stops it (a seeded rule, OUR_SAVE of their shots: lessons and our
  // own shots never use it). He holds it, or it comes off him and he gathers it; then he rolls it out to a friend, and play
  // goes on with our ball.
  *ourSave(shooter, gk) {
    // (v64) Where their shot goes is seeded: a ball at him he blocks, one beside him he reaches, low or high a little
    // farther he dives to; what he does follows from the picture (shot.js shotResult, made a save).
    const s = this.sim, sh = { x: shooter.x, y: shooter.y }, u = seeded(sh.y, sh.x, 7), off = u < .3 ? .2 : u < .55 ? .7 : 1.25, way = seeded(sh.x, sh.y, 13) < .5 ? 1 : -1;
    const y = clamp(gk.y + way * off, gy0 + .4, gy1 - .4), z = seeded(sh.x, sh.y, 17) < .4 ? 1.25 : LOW_Z;
    this.scripted.add(gk.id); s.stop(gk.id);
    yield* this.turnTo(shooter.id, -.7, y);
    const r = shotResult({ from: s.ball, y, z, foot: 'placed', k: gk, gx: 0, force: 'save' }), spill = seeded(sh.x, sh.y, 11) < .5;
    this.keeperReact(gk, { ...r, held: !spill }, s.ball);
    const at = this.inFront(gk, r.at); yield* this.strike(shooter.id, at.x, at.y, { speed: 17, arc: .1, z1: r.at.z });
    yield () => s.ball.state === 'loose';
    this.result = 'keeperSave'; this.emit('keeperSave');
    if (spill) { const sp = this.spillOf(r, sh); s.ball.carrier = gk.id; s.kick(sp.x, sp.y, { speed: 4.5, arc: .25 }); yield () => s.ball.state === 'loose'; yield () => !gk.gkm || s.time - gk.gkm.t0 > gk.gkm.dur + .9; gk.gkm = null; const t0 = s.time; yield () => { s.go(gk.id, s.ball.x, s.ball.y, 3); return Math.hypot(gk.x - s.ball.x, gk.y - s.ball.y) < .6 || s.time - t0 > 2; }; }
    else { Object.assign(s.ball, { state: 'held', carrier: gk.id }); yield .3; }
    this.ai = false; s.stopAll(); yield* this.rollOut(gk); this.result = 'keeperSave';
  },
  // Getting open: he runs to his spot while his defender follows a step behind. Open space: his friend passes
  // and he plays on. Behind a defender: the pass gets cut out. Next to the ball: both defenders close in and win it.
  // (round 6) What a sensible player does with the ball his player has just passed him, in this order: shoot, with a
  // clear shot from scoring range; carry it on, with open space ahead; pass forward to a friend who is open and nearer
  // the goal than both of them; and only then give it back. { act: 'shoot' | 'carry' | 'forward' | 'back', to }
  friendPlan(c, h, sp) {
    const s = this.sim, opps = s.team('them'), outs = opps.filter(o => !o.gk), aim = { x: L, y: clamp(c.y, gy0 + .8, gy1 - .8) };
    const shot = dist(c, aim) < 9 && shotClear(s.ball, aim, opps) && !outs.some(o => dist(o, c) < 1.7);
    const g = { x: L - 3.5, y: W / 2 }, gl = dist(c, g) || 1, ahead = { x: c.x + (g.x - c.x) / gl * 5, y: c.y + (g.y - c.y) / gl * 5 };
    const space = gl > 2.5 && outs.every(o => closestOnLane(o, c, ahead, 0).d > 2.4);
    const fwd = s.team('us').filter(m => m !== c && m.id !== 'hero' && !m.gk && m.x > c.x + 2 && m.x > Math.max(h.x, sp?.x ?? 0) + 1 && interceptor(s.ball, m, outs).d > 1.1 && !outs.some(o => dist(o, m) < 1.8)).sort((p, q) => q.x - p.x)[0] || null;
    return { act: shot ? 'shoot' : space ? 'carry' : fwd ? 'forward' : 'back', to: fwd, shot, space };
  },
  *supportGen(spotId, good) {
    const s = this.sim, sp = this.sc.spots.find(x => x.id === spotId), h = s.a('hero'), c = s.a(this.sc.carrier || 'm1');
    const o1 = s.a(this.sc.pressId || 'o1'), o2 = s.a(this.sc.markId || 'o2'), o2id = o2.id;
    // (round 6) In a match the friend does the sensible thing with it (friendPlan) while his player makes his run: he
    // shoots, carries it on or plays it forward when he can, and gives it back only when that is what is left, and at
    // most once in a move (this.returns): no passing it back and forth. A lesson's scene plays as it was written.
    if (this.sc.live && !this.sc.restart && (this.mode === 'match' || this.mode === 'free') && c.id !== 'hero' && s.ball.carrier === c.id && !c.gk) {
      const fp = this.friendPlan(c, h, sp), back = fp.act === 'back' && !(this.returns >= 1);
      (this.friendLog ||= []).push({ act: back ? 'back' : fp.act === 'back' ? 'carry' : fp.act, shot: fp.shot, space: fp.space, good, returns: this.returns || 0 });
      if (!back) {
        this.scripted = new Set(['hero', c.id]); s.go('hero', sp.x, sp.y, 5); this.ai = true;
        if (fp.act === 'forward') { const m = fp.to; this.scripted.add(m.id); s.stop(m.id); yield* this.strike(c.id, m.x, m.y, { speed: 11, arc: .15 }); yield () => s.ball.state === 'loose' || dist(m, s.ball) < .5; s.give(m.id); this.scripted = new Set(['hero', m.id]); this.ai = true; yield* this.finish(m.id); return; }
        yield* this.finish(c.id); return;
      }
      if (good) this.returns = (this.returns || 0) + 1;
    }
    this.ai = false; s.stopAll(); for (const a of s.agents.values()) this.scripted.add(a.id);
    s.go('hero', sp.x, sp.y, 5);
    const t0 = s.time, alive = this.sc.even && !this.sc.restart ? this.underPressure(c, o1) : null; // (a restart: the ball stays still on its line)
    const trails = !(this.sc.pattern === 'crowd' && sp.why === 'behind'); // (v64: running up past their player, his defender lets him go: the one in front will cut it out)
    yield () => { if (trails) s.go(o2id, h.x + (c.x - h.x) * .12, h.y + (c.y - h.y) * .12, 2.6); alive?.(); return dist(h, sp) < .4 || s.time - t0 > (this.sc.even ? 2.6 : 1.8); }; // (v60 rings can be up to 10 m away)
    s.stop('hero'); s.stop(o2id);
    if (sp.crowd && this.sc.restart && Math.min(...s.team('them').map(o => dist(o, c))) > 5) { // (v64) a restart with their team far off: nobody to pass to, so he kicks it long, to them
      const o = s.team('them').sort((p, q) => dist(p, c) - dist(q, c))[0]; this.scripted.add(o.id);
      yield* this.passFrom(c, o.x - 1, o.y, { speed: 13, arc: .35 });
      yield () => s.ball.state === 'loose';
      yield* this.steal(o, 'lost'); return;
    }
    if (sp.crowd) { // two defenders on two players right together: they win it
      const t1 = s.time; yield () => { s.go(o1.id, c.x, c.y, 4); s.go(o2id, lerp(h.x, c.x, .5), lerp(h.y, c.y, .5), 3.5); return dist(o1, c) < .9 || s.time - t1 > 1.5; };
      yield* this.steal(o1); return;
    }
    faceTo(h, c.x, c.y);
    if (alive) { const tp = s.time; yield () => { alive(); return s.time - tp > .25; }; } else yield .25;
    if (good) {
      // He'll peek and turn, but only when the pass comes from behind him (otherwise he already faces the goal).
      if (this.has('peek-and-turn') && Math.abs(Math.atan2(c.y - h.y, c.x - h.x)) > 2) { const k = .3 / (dist(c, h) || 1); yield* this.strike(c.id, h.x + (c.x - h.x) * k, h.y + (c.y - h.y) * k, { speed: clamp(dist(c, h) / (PACE * (this.windowMin() - .1) + .2), 4.5, 8), arc: .05 }); this.result = 'incoming'; return; } // to his feet on the side the pass comes from, so it comes straight at him
      s.open('hero', L - 3.5, W / 2); // he opens his body toward goal as the pass comes, and turns with his first touch
      yield* this.passFrom(c, h.x, h.y, { speed: 11, arc: .15 });
      yield () => s.ball.state === 'loose' || dist(h, s.ball) < .5;
      s.give('hero');
      if (this.rating('spot:' + spotId) === 'safe') { yield* this.closedDown(); return; } // only okay: he has it, but going nowhere
      this.scripted = new Set(['hero']); this.ai = true;
      yield* this.finish('hero'); return;
    }
    // The pass goes, but the defender standing in its path cuts it out.
    const them = s.team('them'), cut = them.map(o => ({ opp: o, ...closestOnLane(o, s.ball, h, .05) })).sort((a, b) => a.d - b.d)[0];
    if (this.sc.restart && cut.d > 2.5) { // (v64) their team stands far off, so the pass gets to him; but there (in front of our goal, or on top of a friend) their nearest player runs in and takes it
      yield* this.passFrom(c, h.x, h.y, { speed: 11, arc: .15 });
      yield () => s.ball.state === 'loose' || dist(h, s.ball) < .5;
      s.give('hero'); faceTo(h, c.x, c.y);
      const o = them.sort((p, q) => dist(p, h) - dist(q, h))[0], t1 = s.time;
      yield () => { s.go(o.id, h.x, h.y, 5.2); return dist(o, h) < .9 || s.time - t1 > 4; };
      yield* this.steal(o); return;
    }
    s.go(cut.opp.id, cut.x, cut.y, 4);
    yield* this.passFrom(c, cut.x, cut.y, { speed: 11, arc: .1 });
    yield () => s.ball.state === 'loose';
    yield* this.steal(cut.opp, this.sc.even ? 'cut' : 'stolen'); // (he never had it: "Cut out!")
  },
  // A pass from the friend on the ball, or (v64, the keeper's ball) our keeper rolling it out of his hands.
  *passFrom(c, x, y, opts) {
    const s = this.sim, b = s.ball;
    if (!c.gk || b.carrier !== c.id) { yield* this.strike(c.id, x, y, opts); return; }
    const l = Math.hypot(x - c.x, y - c.y) || 1; c.face = [(x - c.x) / l, (y - c.y) / l];
    c.gkm = { k: 'roll', t0: s.time, low: true }; yield .45;
    const t0 = s.time; yield () => (Math.hypot(b.x - (c.x + c.face[0] * .45), b.y - (c.y + c.face[1] * .45)) < .05 && b.z < .2) || s.time - t0 > 1; // (his hands bring it down to the grass)
    Object.assign(b, { state: 'carried', carrier: c.id, z: 0 });
    s.kick(x, y, { ...opts, arc: 0 }); this.kicked = true; c.gkm = null;
  },
  // While he runs to his spot (v60): his friend on the ball keeps it under pressure, shielding it with small touches from
  // side to side, and the defender in front of him jockeys, staying goal-side about 1.3 m off him. Nobody wins or loses
  // the ball here, and nobody moves more than a step. Returns a function to call every step.
  underPressure(c, o) {
    const s = this.sim, base = { x: c.x, y: c.y }, ob = o && { x: o.x, y: o.y }, t0 = s.time, gl = Math.hypot(L - c.x, W / 2 - c.y) || 1, g = { x: (L - c.x) / gl, y: (W / 2 - c.y) / gl };
    const ol = ob && (Math.hypot(c.x - ob.x, c.y - ob.y) || 1), u = ob && { x: (c.x - ob.x) / ol, y: (c.y - ob.y) / ol }; // the defender toward him
    return () => {
      const t = s.time - t0, k = Math.sin(t * 2.3) * .3;
      if (s.ball.carrier === c.id) s.go(c.id, base.x - g.y * k - g.x * .1, base.y + g.x * k - g.y * .1, 1.1);
      if (ob && o.id !== c.id) { const j = .3 * Math.sin(t * 3.1 + .6); s.go(o.id, ob.x + u.x * j - g.y * k * .8, ob.y + u.y * j + g.x * k * .8, 1.8); } // around his own place: in a step, back a step, across with him
    };
  },
  // An "okay" run (v60, generate.js moreSpots): he has the ball, but their nearest player gets to him, goal-side, and
  // there is nothing on: he keeps it, and the play ends there.
  *closedDown(ev = 'kept') {
    const s = this.sim, h = s.a('hero'), o = s.team('them').sort((p, q) => dist(p, h) - dist(q, h))[0];
    const gl = Math.hypot(L - h.x, W / 2 - h.y) || 1, to = { x: h.x + (L - h.x) / gl * 1.4, y: h.y + (W / 2 - h.y) / gl * 1.4 };
    this.scripted.add(o.id); s.go(o.id, to.x, to.y, 4.2); s.stop('hero'); faceTo(h, o.x, o.y);
    const t0 = s.time; yield () => dist(o, to) < .3 || s.time - t0 > 1.6;
    yield* this.end(ev, 1.1);
  },
  // He shoots: a clear shot goes in; a blocked one is stopped by the defender in the way.
  *shootGen(good) {
    const s = this.sim, h = s.a('hero'), gk = s.keeper('them'), aim = { x: L + .7, y: gk ? placedAim(s.ball, gk) : clamp(h.y, gy0 + .8, gy1 - .8) };
    this.scripted.add('hero'); this.ai = false; s.stopAll();
    if (good) { if (gk) { yield* this.turnTo('hero', aim.x, aim.y); const wrong = this.guessWrong(gk, aim.y); this.keeperReact(gk, wrong || shotResult({ from: s.ball, y: aim.y, foot: 'placed', k: gk, force: 'goal' }), s.ball, wrong ? GUESS_T + .2 : .2); if (wrong) yield GUESS_T; } yield* this.strike('hero', aim.x, aim.y, { speed: 17, arc: .5 }); yield () => s.ball.state === 'loose'; this.result = 'goal'; this.emit('goal'); yield this.hold('goal', 1.4); return; }
    const block = interceptor(s.ball, aim, s.team('them'));
    // In a match, once he has "Follow your shot!": the block sends it loose, if he could get there first (live.js toRebound).
    const sh = this.reboundOK && this.reboundFrom(block.opp);
    if (sh) { this.rebound = sh; yield* this.shotOut(sh); this.hud.caption('Blocked!'); this.say('Blocked!'); this.scripted.add(block.opp.id); yield () => s.ball.state === 'loose'; this.result = 'rebound'; return; }
    this.scripted.add(block.opp.id); block.opp.mom = null; block.opp.momOff = this.sim.time + 1.5; s.go(block.opp.id, block.x, block.y, 5); // (he steps into its line at once)
    yield* this.strike('hero', block.x, block.y, { speed: 15, arc: .2 });
    yield () => s.ball.state === 'loose';
    yield* this.steal(block.opp);
  },
  // ---------- his shot, as two choices (v62; six targets since v64): a target in the goal and a foot ----------
  // `opt` 'shoot:<target>:<foot>' (target TL, TM, TR, L, M, R or * for the best low one; foot in, las or * for the one the
  // rule says). It ends as shot.js shotResult says: in the net; saved (held, or spilled out: a rebound); over the bar;
  // wide; or, slow, cleared by a defender running back. In a lesson nothing is left to chance (the scene's table,
  // generate.js finishShots, says the same); in a match the chances are seeded by the play, so asking twice gives the
  // same answer. Too far, or a defender in the way: blocked, as SHOOT always was.
  shotOf(opt) {
    const s = this.sim, sc = this.sc, h = s.a('hero'), [, sp, ft] = opt.split(':'), K = s.keeper('them'), lesson = !!sc.shots;
    const from = lesson ? { x: sc.heroTo[0] + .5, y: sc.heroTo[1] } : { x: s.ball.x, y: s.ball.y }; // (a lesson: from where the scene says)
    // (round 2: a lesson's keeper shifts with the ball while he chooses, and is set as he shoots: the shot is worked out
    // from where the scene sets him, like the shooter and the defenders)
    const Ks = lesson && K && sc.gk?.them ? { ...K, x: sc.gk.them[0], y: sc.gk.them[1] } : K;
    const foot = ft === '*' || !ft ? rightFoot(from) : ft, zid = !sp || sp === '*' ? (Ks ? bestZone(from, Ks) : null) : sp;
    const aim = zid ? {} : { y: clamp(from.y, gy0 + .8, gy1 - .8) };
    const defs = lesson ? sc.oppsTo.map(([x, y]) => ({ x, y })) : s.team('them'), mid = (gy0 + gy1) / 2;
    const duel = !lesson && !!K && Math.hypot(L - from.x, mid - from.y) <= DUEL && s.team('them').every(o => closestOnLane(o, from, { x: L, y: mid }, 0).d > 1); // a close 1v1 with the keeper
    const rand = lesson ? null : stream(seeded(h.x, h.y, this.decideAt ?? 0, 5)), spill = sc.spill ?? seeded(h.y, h.x, 3) < .5;
    const r = shotResult({ from, zone: zid, ...aim, foot, k: Ks, rand, duel, stray: sc.stray ?? .35, defs, spill });
    return { ...r, from, foot, K, zid, aimY: zid ? zone(zid).y : aim.y, spill: !r.held };
  },
  // The two parts of a shot he picked, each graded on its own: the target ("Shoot to the space!", v64 grades: low and
  // away from the keeper true, high and away or low beside him 'okay', at him or high beside him false) and the foot
  // (the rule of "Inside or laces?": close, inside; the edge, laces). null for a part he did not pick.
  shotPartGrades(opt) {
    if (!opt?.startsWith('shoot:')) return null;
    const [, sp, ft] = opt.split(':'), r = this.shotOf(opt), right = rightFoot(r.from), sc = this.sc;
    const g = sp === '*' || !r.K ? null : zoneGrade(r.from, sp, r.K, { stray: sc.stray ?? .35, defs: sc.shots ? sc.oppsTo.map(([x, y]) => ({ x, y })) : [] });
    return { space: g == null ? null : g === 'best' ? true : g === 'okay' ? 'okay' : false, foot: ft === '*' ? null : ft === right, zone: sp };
  },
  // Where a shot he saves comes into his hands: never behind him (it would go through his legs to get there), at least a
  // step in front of where his save takes him.
  inFront(k, at) {
    const b = k.gkm?.body || k, f = k.face, ahead = (at.x - b.x) * f[0] + (at.y - b.y) * f[1];
    return ahead >= .35 ? at : { x: at.x + f[0] * (.35 - ahead), y: at.y + f[1] * (.35 - ahead) };
  },
  // Why a shot he picked did not go in, for the card under its banner ("Over the bar!", "Saved!", "Cleared!", "Stolen!").
  shotWhy(opt) {
    const sc = this.sc, g = this.shotPartGrades(opt), r = this.shotOf(opt);
    if (sc.shots?.[opt] === 'blocked') return 'Too far to shoot. Get closer first!';
    if (sc.pattern === 'keeper-out') return 'The keeper came out! Go around him!';
    if (sc.pattern === 'keeper-friend') return 'No space to shoot. Pass it across!';
    if (g?.space === false) return r.rel === 'at' ? "That's right at him! Shoot low, to the big space!" : "That's near his hands. Shoot low, to the big space!";
    if (r.res === 'over') return 'Laces from close fly high. Close? Inside, for control!';
    if (r.res === 'save' || r.res === 'cleared') return 'Too slow from out here. Far? Laces, for power!';
    return this.cue();
  },
  // (v64 round 3) Now and then (GUESS_PLACED of the shots that go in anyway: his run on goal, his one-tap SHOOT) the keeper
  // guesses and goes the wrong way early: the owner asked to see a keeper who guesses wrong now and then, and these shots
  // score whatever he does. Seeded by the play. Returns the result to act out, or null.
  guessWrong(gk, y) {
    const s = this.sim, b = s.ball; if (!gk || !(this.mode === 'match' || this.mode === 'free') || (!this.forceGuess && seeded(b.x, b.y, s.time, 29) >= GUESS_PLACED)) return null; // (forceGuess: every time, for the review page dev/review.html)
    return { ...shotResult({ from: b, y, foot: 'placed', k: gk, force: 'goal' }), act: 'wrong', dir: -Math.sign(y - gk.y) || 1, guess: -Math.sign(y - gk.y) || 1 };
  },
  // A shot he picked that does not go in (it may still be only okay as a choice: then 1 star, never 2; v64 round 3).
  shotMissed(opt) { return !!opt?.startsWith('shoot:') && (this.sc.shots?.[opt] ?? this.shotOf(opt).res) !== 'goal'; },
  // The tip for a shot that was only okay (2 stars): the target was not the best one, or the foot was wrong.
  shotTip(opt) {
    const g = this.shotPartGrades(opt);
    if (g?.space === 'okay') return zone(g.zone).top ? 'Right side! But high can go over. Keep it low.' : 'He can reach that one. Find the big space.';
    return 'Good space! ' + (this.shotOf(opt).res === 'over' ? 'Close? Inside, for control.' : 'Far? Laces, for power!');
  },
  // The lesson a missed shot belongs to (a match's miss count and its one spoken name): the target, else the foot.
  missIdea(opt) { const g = this.shotPartGrades(opt); return !g ? null : g.space === false ? 'shoot-space' : g.foot === false ? 'inside-laces' : null; },
  // The decision log for a shot with picked parts: each part under its own lesson ("Shoot to the space!" timed from the
  // decision opening to the target tap, best / okay / miss as graded above; "Inside or laces?" from then to the foot
  // tap), and the whole decision under its own idea only when that is neither of them (the two shot lessons' own scenes
  // are logged by their part).
  shotLog(opt, whole) {
    const g = this.shotPartGrades(opt); if (!g || (g.space == null && g.foot == null)) return null;
    const out = [], end = this.realTime || 0, mid = this.shotT ?? this.decideReal ?? 0;
    if (g.space != null) out.push({ ...whole, id: 'shoot-space', grade: g.space === true ? 'best' : g.space === 'okay' ? 'okay' : 'miss', sec: mid - (this.decideReal ?? 0) });
    if (g.foot != null) out.push({ ...whole, id: 'inside-laces', grade: g.foot ? 'best' : 'miss', sec: end - mid, looked: g.space != null ? null : whole.looked });
    if (!['shoot-space', 'inside-laces'].includes(whole.id)) out.push(whole);
    return out;
  },
  // How high to send the ball (kick's z1, at the end of its flight) so it crosses the point `p` (on its way, `f` of the
  // way along) at height `z`: the sim's ball rises along its flight as z1 * u (u: the share of the flight's time).
  liftFor(z, f, arc) { const u = 1 - Math.pow(1 - clamp(f, .05, 1), 2 / 3); return Math.max(0, (z - arc * 4 * u * (1 - u)) / u); },
  *shotGen(opt) {
    const s = this.sim, sc = this.sc;
    if (sc.shots?.[opt] === 'blocked' || (!sc.shots && (this.grades ||= sc.grades || grade(sc)).shoot === 'bad')) { yield* this.shootGen(false); return; }
    const r = this.shotOf(opt), K = r.K, { from, to } = r;
    this.scripted.add('hero'); this.ai = false; s.stopAll();
    if (K) { this.aimFrom = { x: s.a('hero').x, y: s.a('hero').y }; this.camMode = 'aim'; } // (the shot is seen as he aimed it: the keeper big; view.js aimView)
    const tx = L + .7, ty = to.y + (to.y - from.y) / Math.max(.5, L - from.x) * .7; // on through the line, into the net
    yield* this.turnTo('hero', tx, ty);
    if (K) this.keeperReact(K, r, from, r.guess ? GUESS_T + .2 : .2);
    if (r.guess) yield GUESS_T; // (his guess shows a moment before the kick: the kick comes a little later)
    const high = r.top || to.z > .8, arc = high ? .12 : r.arc, lift = (x, y, z) => (high ? this.liftFor(z, Math.hypot(to.x - from.x, to.y - from.y) / (Math.hypot(x - from.x, y - from.y) || 1), arc) : 0);
    if (r.res === 'goal') { yield* this.strike('hero', tx, ty, { speed: r.speed, arc, z1: lift(tx, ty, to.z) }); yield () => s.ball.state === 'loose'; yield* this.end('goal', 1.4); return; }
    if (r.res === 'over') { const f = Math.hypot(L - from.x, to.y - from.y) / (Math.hypot(L + 3 - from.x, to.y - from.y) || 1); yield* this.strike('hero', L + 3, to.y, { speed: 17, arc: .3, z1: this.liftFor(PITCH.gh + .45, f, .3) }); yield () => s.ball.state === 'loose'; yield* this.missedShot('over'); return; } // (just over the bar, so the picture shows it)
    if (r.res === 'wide') { const wx = L + 2.2, wy = to.y + (to.y - from.y) / Math.max(.5, L - from.x) * 2.2; yield* this.strike('hero', wx, wy, { speed: r.speed, arc, z1: lift(wx, wy, to.z) }); yield () => s.ball.state === 'loose'; yield* this.missedShot('wide'); return; }
    if (r.res === 'cleared') { // the defender running back meets it on its way in, and knocks it out to the side
      const d = s.team('them').sort((p, q) => Math.hypot(p.x - r.by.x, p.y - r.by.y) - Math.hypot(q.x - r.by.x, q.y - r.by.y))[0];
      this.scripted.add(d.id); s.go(d.id, r.at.x, r.at.y, Math.max(2, Math.hypot(d.x - r.at.x, d.y - r.at.y) / Math.max(.3, r.t + .1)));
      yield* this.strike('hero', tx, ty, { speed: r.speed, arc: r.arc });
      yield () => (s.ball.state === 'flying' && Math.hypot(s.ball.x - d.x, s.ball.y - d.y) < .6) || s.ball.state === 'loose';
      s.give(d.id); s.stop(d.id); yield .15; if (this.camMode === 'aim') this.camMode = 'follow';
      const out = d.y > W / 2 ? 1 : -1; s.windup(d.id, 'pass'); yield .2; s.kick(clamp(d.x - 6, 1, L - 1), clamp(d.y + out * 5, 1, W - 1), { speed: 12, arc: .4 });
      yield* this.end('cleared', 1.3); return;
    }
    // Saved: the ball goes to his hands (up high, for a high one); he holds it, or it spills out in front of him.
    const at = this.inFront(K, r.at); yield* this.strike('hero', at.x, at.y, { speed: r.speed, arc: high ? .08 : r.arc * .6, z1: high ? r.at.z : 0 });
    yield () => s.ball.state === 'loose';
    if (!r.spill) { Object.assign(s.ball, { state: 'held', carrier: K.id }); yield .15; yield* this.savedShot(K); return; }
    const sp = this.spillOf(r, from); s.ball.carrier = K.id; s.kick(sp.x, sp.y, { speed: 4.5, arc: .25 }); // (off his hands)
    this.sfx?.('tap');
    if (this.reboundOK) { this.camMode = 'follow'; this.rebound = { by: 'hero', hit: [r.at.x, r.at.y], loose: [sp.x, sp.y], block: K.id }; this.hud.caption('Saved!'); this.say('Saved!'); yield () => s.ball.state === 'loose'; this.result = 'rebound'; return; }
    yield () => s.ball.state === 'loose';
    yield* this.savedShot(K, sp);
  },
  // He missed (over the bar, wide): the banner; in a match their keeper then rolls it out (a goal kick).
  *missedShot(kind) {
    const s = this.sim, K = s.keeper('them');
    this.result = kind; this.ai = false; s.stopAll(); this.emit(kind); yield 1.2;
    if (this.camMode === 'aim' && (this.mode === 'match' || this.mode === 'free')) this.camMode = 'follow'; // (play goes on: the match's own view again)
    if (K && (this.mode === 'match' || this.mode === 'free')) { // a goal kick: out of sight behind the goal, the ball is his (no ball flies back), then he rolls it out
      s.ball.hidden = true; yield .2; Object.assign(s.ball, { x: K.x + K.face[0] * .3, y: K.y + K.face[1] * .3, z: .85, state: 'held', carrier: K.id, move: null, reach: null }); yield .2; s.ball.hidden = false;
      yield* this.rollOut(K);
    }
  },
  // Saved: in a lesson the play ends there; in a match the keeper gathers a spilled ball (when he gets there first) and
  // rolls it out to a friend.
  *savedShot(K, loose = null) {
    const s = this.sim;
    this.result = 'saved'; this.emit('saved');
    if (this.mode !== 'match' && this.mode !== 'free') { this.ai = false; s.stopAll(); yield 1.2; return; }
    if (this.camMode === 'aim') this.camMode = 'follow'; // (play goes on: the match's own view again)
    if (loose) { this.scripted.add(K.id); yield () => !K.gkm || K.gkm.k !== 'dive' || s.time - K.gkm.t0 > K.gkm.dur + 1; K.gkm = null; // (after a dive: up first, then after it)
      const t0 = s.time; yield () => { s.go(K.id, loose.x, loose.y, 3); return Math.hypot(K.x - s.ball.x, K.y - s.ball.y) < .6 || s.time - t0 > 2; }; }
    yield .3; yield* this.rollOut(K);
  },
  // Where a blocked shot from here would go off the blocker's leg, if it would be a fair race (he clearly first, the way
  // to it and the finish clear; see generate.js followShot). null if no way is.
  reboundFrom(o) {
    const s = this.sim, h = s.a('hero'), b = s.ball, from = [b.x, b.y], people = [...s.agents.values()];
    for (const sd of [1, -1]) for (const th of [.6, .72]) {
      const { hit, loose } = legBounce(from, [o.x, o.y], sd, th, 3.4), q = { x: loose[0], y: loose[1] };
      if (q.x < L - 8 || q.x > L - 1.6 || q.y < 2 || q.y > W - 2 || people.some(p => dist(p, q) < 2.2)) continue; // (nobody standing on the ball's ring)
      const tH = dist(h, q) / 5.2 + .15, tO = Math.min(...s.team('them').map(p => dist(p, q) / DEF_RUN + (p === o ? .75 : .3)));
      if (tO < tH + .45 || dist(h, q) < 2.2) continue;
      if (people.some(p => p !== h && p !== o && closestOnLane(p, { x: hit[0], y: hit[1] }, q, .05).d < 1)) continue;
      if (s.team('them').some(p => p.x > q.x - 1 && closestOnLane(p, q, { x: L, y: clamp(q.y, gy0 + .8, gy1 - .8) }, 0).d < 1.6)) continue;
      return { by: 'hero', hit, loose, block: o.id };
    }
    return null;
  },
  // ---------- out of time (v64) ----------
  // He did not choose before the window ended: the threat gets there, and play goes on as it would (window.js says who
  // the threat is). With the ball (his, or a friend's he was to help): the threat steps in and pokes it away, and their
  // team has it. Defending: the attacker goes through the gap, as if he had stayed where he was. Running in for a loose
  // ball, or to the goal: they get there first, as if he had stayed.
  *timeoutGen() {
    const s = this.sim, sc = this.sc, k = kindOf(sc), th = this.lastThreat;
    if (k === 'goal') { yield* this.goalRunGen('stay', false); return; }
    // A restart (round 2): a dead ball, nobody tackles. The taker plays it as the window ends, to where he is: his place
    // gets the result the scene gives the spot he stands on (staying, or the nearest).
    if (sc.restart && sc.spots?.length) {
      const h = s.a('hero'), sp = sc.spots.find(x => x.id === 'stay') || [...sc.spots].sort((p, q) => dist(p, h) - dist(q, h))[0];
      yield* this.supportGen(sp.id, this.isGood('spot:' + sp.id)); return;
    }
    if (k === 'follow') { const r = s.team('them').sort((p, q) => dist(p, s.ball) - dist(q, s.ball))[0]; this.scripted.add(r.id); yield* this.raceForIt(sc.spots.some(x => x.id === 'watch') ? 'watch' : sc.spots[0].id, false, s.time - 1); return; }
    if (k === 'defense') {
      const h = s.a('hero'), stay = { id: 'stay', x: h.x, y: h.y }, live = { ...sc, spots: [...sc.spots, stay], oppsTo: (sc.oppIds || s.team('them').map(o => o.id)).map(id => [s.a(id).x, s.a(id).y]), mates: s.team('us').filter(a => a.id !== 'hero').map(a => [a.x, a.y]) };
      const keep = this.sc; this.sc = { ...live, exploits: { ...sc.exploits, stay: exploitOf(live, 'stay') } };
      try { yield* this.defendGen('stay', false); } finally { this.sc = keep; }
      return;
    }
    if (k === 'receive') { // the ball gets to him and he takes it facing back: the defender behind him takes it off him, or (nobody near) they get back in front of him
      yield () => s.ball.state !== 'flying'; if (s.ball.state === 'loose') s.give('hero');
      const h = s.a('hero'), near = th && s.a(th) && dist(s.a(th), h) < 4;
      if (!near) { yield* this.closedDown('timeout'); return; }
    }
    const c = s.ball.carrier && s.a(s.ball.carrier), o = (th && s.a(th)) || (c && s.team(c.team === 'us' ? 'them' : 'us').sort((p, q) => dist(p, c) - dist(q, c))[0]);
    if (!c || !o) { yield* this.end('timeout', 1.1); return; }
    yield* this.pokeAway(o, c);
  },
  // The defender gets to the ball on his run (v66: he arrives running, as the ring empties; from farther off he speeds
  // up at ACC to a run) and pokes it on past the player on it: the way he is running, and off to the side away from that
  // player, so neither the ball nor he goes through him. He runs on after it; the nearest of his team gets it. No crash,
  // no fall, and nobody turns round: the player who had it goes on a step and pulls up.
  *pokeAway(o, c) {
    const s = this.sim, b = s.ball, t0 = s.time;
    this.scripted.add(o.id); this.scripted.add(c.id); this.spice(null);
    const mv = o.mom ? [...o.mom] : [(o.tx - o.x), (o.ty - o.y)]; o.mom = null; o.momOff = this.sim.time + 1.5; // (he is on the ball: straight in)
    let v = Math.max(1, Math.min(o.speed || 1, SPEED.sprint[1])), last = s.time;
    s.go(c.id, c.x + (c.tx - c.x) * .5, c.y + (c.ty - c.y) * .5, Math.min(1.2, c.speed || .5)); // he slows, shielding it
    yield () => { const dt = s.time - last; last = s.time; v = Math.min(SPEED.sprint[1], v + ACC * dt); s.go(o.id, b.x, b.y, v); return dist(o, b) < .62 || s.time - t0 > 2.5; };
    s.windup(o.id, 'touch'); yield .12;
    let ux = mv[0], uy = mv[1]; const ul = Math.hypot(ux, uy); if (ul > .3) { ux /= ul; uy /= ul; } else { const l = dist(o, b) || 1; ux = (b.x - o.x) / l; uy = (b.y - o.y) / l; }
    const sd = Math.sign(ux * (b.y - c.y) - uy * (b.x - c.x)) || 1, dx = ux - uy * sd * .9, dy = uy + ux * sd * .9, dl = Math.hypot(dx, dy) || 1;
    const to = { x: clamp(b.x + dx / dl * 1.9, 1, L - 1), y: clamp(b.y + dy / dl * 1.9, 1, W - 1) };
    s.kick(to.x, to.y, { speed: 3.6, arc: 0, touch: true }); this.kicked = true;
    s.go(o.id, to.x, to.y, Math.max(2, v * .8));
    yield () => s.ball.state === 'loose' || s.time - t0 > 4;
    const taker = s.team(o.team).sort((p, q) => dist(p, s.ball) - dist(q, s.ball))[0] || o;
    yield* this.steal(taker, 'timeout');
  },
  // ---------- 1v1: steal it ----------
  // 'good' when the ball is away from the attacker's feet and close enough to reach; 'early' when it is too far
  // away to reach; 'tight' when it is at his feet.
  tackleState() {
    const s = this.sim, c = s.a(this.sc.carrier), b = s.ball, h = s.a('hero');
    const loose = dist(b, c) > LOOSE, reach = dist(h, b) < REACH;
    return loose && reach ? 'good' : !reach ? 'early' : 'tight';
  },
  // The attacker dribbles at him with the scenario's touches while he backs off, staying in front, between the
  // ball and the goal. Returns true when a steal moment comes (if `untilWindow`), false once the attacker is past.
  *approach(untilWindow) {
    const s = this.sim, sc = this.sc, c = s.a(sc.carrier), h = s.a('hero'), b = s.ball, tk = this.tk ||= { i: 0, wait: 0 };
    this.ai = false; for (const a of s.agents.values()) this.scripted.add(a.id);
    for (const a of s.agents.values()) if (a.id !== c.id && a.id !== 'hero') s.stop(a.id);
    for (;;) {
      if (this.tackleState() === 'good') { tk.lastGood = s.time; if (untilWindow) return true; }
      if (c.x < h.x - .5 && b.carrier === c.id) return false;        // he's past
      // Jockey: stand about 1.8 m from the ball on its goal side, backing off a little slower than he comes.
      const gl = Math.hypot(b.x, b.y - W / 2) || 1, jx = b.x - b.x / gl * 1.8, jy = b.y + (W / 2 - b.y) / gl * 1.8;
      s.go('hero', jx, jy, 1.9);
      if (b.carrier === c.id) {
        if (tk.wait > 0) tk.wait -= 1 / 30;
        else {
          if (tk.i >= sc.touches.length) return false;
          const len = sc.touches[tk.i++], last = tk.i === sc.touches.length;
          // Every touch goes toward our goal; big ones drift a little to the side, the last one goes past him.
          let ax = -b.x, ay = W / 2 - b.y; const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
          const tilt = last ? .75 : len > 1.2 ? .35 : 0, sd = sc.passSide * (tk.i % 2 ? 1 : -1) * (last ? 1 : .6);
          const dx = ax * Math.cos(tilt * sd) - ay * Math.sin(tilt * sd), dy = ax * Math.sin(tilt * sd) + ay * Math.cos(tilt * sd);
          const to = { x: clamp(b.x + dx * len * (last ? 2.2 : 1), 1, L - 1), y: clamp(b.y + dy * len * (last ? 2.2 : 1), 1, W - 1) };
          for (const a of s.agents.values()) if (a.id !== c.id && a.id !== 'hero' && closestOnLane(a, b, to, 0).d < 1) this.giveWay(a, b, to); // nobody stands in its path
          s.windup(c.id, 'touch'); yield .1; // his foot comes to the ball (pro/motion.js), then the ball goes
          s.kick(to.x, to.y, { speed: len > 1.2 ? 3.4 : 2.4, arc: 0, touch: true });
          tk.to = to; tk.wait = len > 1.2 ? .05 : .25; tk.big = len > 1.2;
        }
      } else if (b.state !== 'carried') {
        s.go(c.id, tk.to.x, tk.to.y, tk.big ? sc.speed * .7 : sc.speed); // after a big touch he has to reach for it
        if (b.state === 'loose' && dist(c, b) < .45) s.give(c.id);
      }
      yield 1 / 30;
    }
  },
  *tackleGen(opt) {
    const s = this.sim, sc = this.sc, c = s.a(sc.carrier), h = s.a('hero');
    this.ai = false; for (const a of s.agents.values()) { this.scripted.add(a.id); if (a.id !== c.id && a.id !== 'hero') s.stop(a.id); } // the others stay with their players
    if (opt === 'tackle:good') {
      const got = this.tk?.graceTap || (yield* this.approach(true));
      if (got !== false) {
        if (this.showing) { this.handTap = (this.handTap || 0) + 1; this.sfx('click'); } // the hand taps STEAL now
        // He pokes it away from the attacker, then turns with it, facing up the field.
        s.stop(c.id); const t0 = s.time;
        yield () => { s.go('hero', s.ball.x, s.ball.y, 5); return dist(h, s.ball) < .5 || s.time - t0 > .8; };
        s.give('hero'); h.face = [1, 0]; s.go('hero', h.x + 2.5, lerp(h.y, W / 2, .2), 3.4);
        // (round 6) The one he took it from is beaten: he stumbles on the way he was running, off balance, as his player goes the other way with it.
        c.beat = s.time + 1.7; s.go(c.id, Math.max(1, c.x - 1.5), clamp(c.y + (c.y >= h.y ? .5 : -.5), 1, W - 1), 2.4);
        this.result = 'won'; this.emit('won'); yield 1.3; s.stopAll(); return;
      }
    } else if (opt !== 'tackle:none') {
      // He dives in. The attacker gets there first and takes it around him; he lands where the ball was.
      const at = { x: s.ball.x, y: s.ball.y };
      s.go('hero', at.x, at.y, 4.5); yield .35; s.go('hero', h.x, h.y, 0);
      if (s.ball.carrier !== c.id) { const t0 = s.time; yield () => { s.go(c.id, s.ball.x, s.ball.y, sc.speed + .6); return dist(c, s.ball) < .5 || s.time - t0 > 1; }; s.give(c.id); }
      const side = c.y > h.y ? 1 : -1; this.spice('beat-1v1', [c.id], .85); s.go(c.id, Math.max(2, h.x - 1.2), clamp(h.y + side * 1.6, 1.5, W - 1.5), 4.2);
      yield () => c.x < h.x - .8 || dist(c, { x: c.tx, y: c.ty }) < .2;
    }
    // He's past: he runs in and scores, from a spot where none of our players stands in the way of the shot.
    const ours = s.team('us').filter(d => d.id !== 'hero');
    const clear = y => Math.min(9, ...ours.map(d => Math.min(closestOnLane(d, c, { x: 4.5, y }, 0).d, closestOnLane(d, { x: 4.5, y }, { x: -.7, y: clamp(y, gy0 + .8, gy1 - .8) }, 0).d)));
    const spot = { x: 4.5, y: [lerp(c.y, W / 2, .6), W / 2 - 2.5, W / 2, W / 2 + 2.5].sort((a, b) => clear(b) - clear(a))[0] };
    this.spice('past-1v1', [c.id], .85); s.go(c.id, spot.x, spot.y, 4.6);
    const t1 = s.time; yield () => { s.go('hero', c.x + 1.4, c.y + (h.y > c.y ? 1 : -1), 3.2); return dist(c, spot) < .4 || s.time - t1 > 3; }; // he chases from behind
    yield* this.concede(c);
  },
  // ---------- shots that come back out, and the runs that go with them ----------
  // A shot that hits the post or a defender's leg (generate.js postBounce, legBounce). It is struck at a point just past
  // where it hits, so it is still going fast when it gets there; there it goes off on its new way, slower, and rolls
  // out to rest. `follow`: where the shooter carries on to after the kick.
  *shotOut(sh, follow = null, open = false) {
    const s = this.sim, b = s.ball, hit = { x: sh.hit[0], y: sh.hit[1] };
    const from = { x: b.x, y: b.y }, l = dist(from, hit) || 1, d = { x: (hit.x - from.x) / l, y: (hit.y - from.y) / l };
    if (open) { // (round 2: the choice opens as he winds up to strike it; the strike and the bounce are jobs on game time)
      const tx = hit.x + d.x * 1.2, ty = hit.y + d.y * 1.2, a = s.a(sh.by);
      yield* this.turnTo(sh.by, tx, ty);
      for (const p of s.agents.values()) if (p.id !== sh.by && !p.gk && !this.scripted.has(p.id) && closestOnLane(p, s.ball, { x: tx, y: ty }, .02).d < 1.2) { this.scripted.add(p.id); this.frozen.push(p.id); this.giveWay(p, s.ball, { x: tx, y: ty }, true); }
      const line = s.ball.carrier === sh.by ? { x: a.x, y: a.y, face: [Math.cos(s.ball.h), Math.sin(s.ball.h)] } : a;
      faceTo(a, tx, ty); const foot = pickFoot(line, tx, ty, 'shot', [...s.agents.values()].filter(o => o.team !== a.team));
      // (kept: a retry puts play back where the window opens, and the shot is struck again from there)
      this.reshoot = () => {
        this.bounced = null; s.windup(sh.by, 'shot', foot); let struck = false;
        this.job(.2, u => { if (u < 1 || struck) return; struck = true; s.kick(tx, ty, { speed: SHOT.speed, arc: SHOT.arc }); this.kicked = true; if (follow) s.go(sh.by, follow.x, follow.y, follow.speed || 2.2); this.shotBounce(sh, from); });
      };
      this.reshoot();
      return;
    }
    yield* this.strike(sh.by, hit.x + d.x * 1.2, hit.y + d.y * 1.2, { speed: SHOT.speed, arc: SHOT.arc });
    if (follow) s.go(sh.by, follow.x, follow.y, follow.speed || 2.2);
    yield () => b.state !== 'flying' || (b.x - from.x) * d.x + (b.y - from.y) * d.y >= l;
    Object.assign(b, { x: hit.x, y: hit.y }); // (the step can carry it a few cm past the post: it bounces off where it touched)
    s.kick(sh.loose[0], sh.loose[1], { speed: SHOT.out, arc: .12 });
    // The defender it hit is knocked off balance: half a step back, away from where it went.
    if (sh.block) { const o = s.a(sh.block), k = Math.sign((sh.loose[0] - hit.x) * -d.y + (sh.loose[1] - hit.y) * d.x) || 1; s.go(o.id, o.x - d.x * .2 + d.y * k * .15, o.y - d.y * .2 - d.x * k * .15, .8); }
  },
  // A loose ball after a shot: he runs to the spot he picked (or stays). Their player who can get there soonest goes for
  // it a moment later (one who just blocked it is off balance a moment longer, see generate.js followShot). If he is
  // first, he takes it and scores. If not, they take it away. `t0`: when the ball came loose.
  *raceForIt(spotId, good, t0) {
    const s = this.sim, sc = this.sc, sp = sc.spots.find(x => x.id === spotId), h = s.a('hero'), b = s.ball, loose = { x: sc.shot.loose[0], y: sc.shot.loose[1] };
    const late = o => (o.id === sc.shot.block ? .75 : .3), when = o => dist(o, loose) / DEF_RUN + late(o);
    const racer = s.team('them').sort((p, q) => when(p) - when(q))[0];
    // (round 2: tapped while the shot is still on its way, they set off only once it comes back out: this.bounced)
    const out0 = () => (this.bounced === null ? null : Math.max(t0, this.bounced ?? t0));
    let gone = false, toBall = false;
    yield () => {
      if (!gone && out0() != null && s.time - out0() >= late(racer)) { gone = true; s.go(racer.id, loose.x, loose.y, DEF_RUN); }
      // He goes on to it, to meet it where it rolls: the nearest point on its way still to come.
      if (good && (toBall ||= spotId === 'in' || dist(h, sp) < 1.2 || b.state === 'loose')) { const m = b.state === 'flying' ? closestOnLane(h, b, loose, 0) : b; s.go('hero', m.x, m.y, 5.2); }
      return (good && out0() != null && dist(h, b) < .45) || (gone && dist(racer, b) < .7) || s.time - (out0() ?? s.time) > 4; // (the ball going past the one it hits is not his yet)
    };
    if (good && dist(h, b) < .6) {
      s.give('hero');
      if (this.rating('spot:' + spotId) === 'safe') { yield* this.closedDown(); return; } // only just first: he keeps it, but no shot
      const k = dist(racer, h) || 1; s.go(racer.id, racer.x + (h.x - racer.x) / k * Math.min(.6, Math.max(0, k - 1.5)), racer.y + (h.y - racer.y) / k * Math.min(.6, Math.max(0, k - 1.5)), 2); // too late: he pulls up
      yield* this.finish('hero'); return;
    }
    s.stop('hero'); yield* this.steal(racer, 'lost');
  },
  // "Follow your shot!": the play froze with the ball loose in front of the goal after the shot came back out.
  *followGen(spotId, good) {
    const s = this.sim, sc = this.sc, sp = sc.spots.find(x => x.id === spotId), them = s.team('them');
    yield () => s.ball.state !== 'carried' || this.bounced !== null; // (round 2: he chose as he wound up: the shot goes first)
    this.ai = false; s.stopAll(); for (const a of s.agents.values()) this.scripted.add(a.id);
    if (spotId !== 'watch') s.go('hero', sp.x, sp.y, spotId === 'in' ? 5.2 : 3.4);
    // Everyone else goes on with play: his friends jog up toward the box, their players step back toward their goal.
    // (A defender marking one of his friends goes with him, staying goal-side.)
    const marked = new Set();
    for (const m of s.team('us')) if (m.id !== 'hero') {
      const o = them.find(o => !marked.has(o) && o.id !== sc.shot.block && dist(o, m) < 2.5 && o.x > m.x);
      // Up the field, or a little to one side if someone stands in the way (else he stays and watches).
      const way = [[2, lerp(m.y, W / 2, .2) - m.y], [1.4, 1.4], [1.4, -1.4]].map(([dx, dy]) => ({ x: Math.min(L - 6, m.x + dx), y: clamp(m.y + dy, 1.5, W - 1.5) }))
        .find(t => [...s.agents.values()].every(a => a === m || a === o || closestOnLane(a, m, t, 0).d > 1.4) && closestOnLane(t, s.a('hero'), sp, 0).d > 2);
      if (!way) continue;
      s.go(m.id, way.x, way.y, 2.4); if (o) { marked.add(o); s.go(o.id, o.x + way.x - m.x, o.y + way.y - m.y, 2.4); }
    }
    for (const o of them) if (!marked.has(o) && o.id !== sc.shot.block) s.go(o.id, Math.min(L - 1.5, o.x + .6), o.y, 1.2);
    yield* this.raceForIt(spotId, good, s.time);
  },
  // "Run to the goal too!": m1 dribbles at goal with one defender in front of him; he runs to the spot he picked.
  // In front of goal on the open side: the defender has to stay with the ball, so m1 passes in front of him as he runs
  // on, and he scores. Beside a defender: the pass is cut out. Next to the ball, or staying back: two of them close in
  // on m1 and take it (his own defender follows him over, or leaves him, since he is no danger back there).
  *goalRunGen(spotId, good) {
    const s = this.sim, sc = this.sc, sp = sc.spots.find(x => x.id === spotId), h = s.a('hero'), m = s.a('m1'), o1 = s.a('o1'), o2 = s.a('o2');
    this.ai = false; s.stopAll(); for (const a of s.agents.values()) this.scripted.add(a.id);
    const P = { x: sp.x, y: sp.y }, gl = Math.hypot(L - m.x, W / 2 - m.y) || 1, g = { x: (L - m.x) / gl, y: (W / 2 - m.y) / gl };
    // Across from him, he runs round behind m1, never through him.
    let via = !sp.crowd && closestOnLane(m, h, P, 0).d < 1.6 ? { x: m.x - 1.3, y: m.y + Math.sign(P.y - m.y) * 1.5 } : null;
    if (spotId === 'stay') s.stop('hero'); else s.go('hero', ...(via ? [via.x, via.y] : [P.x, P.y]), 5.2);
    const t0 = s.time;
    if (sc.shot) { // he has a clear shot: he takes it at once, and it comes back off the post
      if (via) s.go('hero', P.x, P.y, 5.2); // (his spots there are never across from m1)
      s.go('o1', o1.x + g.x * 2, o1.y + g.y * 2, 3.4);
      yield* this.shotOut(sc.shot, { x: m.x + g.x * 1.2, y: m.y + g.y * 1.2 });
      yield* this.raceForIt(spotId, good, s.time); return;
    }
    // m1 drives at the defender, who steps up to stay with the ball (he can't leave it to him).
    s.go('m1', m.x + g.x * .8, m.y + g.y * .8, 2.4); s.go('o1', o1.x - g.x * .3, o1.y - g.y * .3, 1.4);
    // His defender: behind him, he chases him (a step behind, and slower). Standing in his way on the other side
    // ('go-far'), he holds his place, edging toward the ball.
    const o2at = { x: o2.x, y: o2.y }, behind = o2.x < h.x;
    const follows = () => { if (!behind) { s.go('o2', lerp(o2at.x, m.x, .12), lerp(o2at.y, m.y, .12), 1.5); return; } const k = dist(o2, h) || 1; s.go('o2', h.x + (o2.x - h.x) / k * 1.6, h.y + (o2.y - h.y) / k * 1.6, 4.2); };
    let alive = null;
    yield () => {
      if (via && dist(h, via) < .5) { s.go('hero', P.x, P.y, 5.2); via = null; }
      if (!alive && s.time - t0 > .5 && spotId !== 'stay') alive = this.underPressure(m, o1); // once he has driven at him: shielding, the defender jockeying
      alive?.();
      if (spotId === 'stay') s.go('o2', m.x - g.x * .6 - g.y * sc.side * 1.2, m.y - g.y * .6 + g.x * sc.side * 1.2, 4.4); else follows();
      return (good ? dist(h, P) < 1.5 : spotId === 'stay' ? dist(o2, m) < 2.2 : dist(h, P) < .4) || s.time - t0 > 3;
    };
    if (good && this.rating('spot:' + spotId) === 'safe') { // only okay: the pass reaches him there, but it goes nowhere
      const t1 = s.time; yield () => { alive?.(); return dist(h, P) < .4 || s.time - t1 > 1.5; };
      s.stop('hero'); faceTo(h, m.x, m.y);
      yield* this.strike('m1', h.x, h.y, { speed: 11, arc: .15 });
      yield () => s.ball.state === 'loose' || dist(h, s.ball) < .5;
      s.give('hero'); yield* this.closedDown(); return;
    }
    if (good) {
      const T = { x: L - 4.5, y: lerp(P.y, W / 2, .55) }, tl = Math.hypot(T.x - h.x, T.y - h.y) || 1, d = { x: (T.x - h.x) / tl, y: (T.y - h.y) / tl };
      s.go('hero', T.x, T.y, 5.2);
      const at = leadPoint(m, h, d, 5.2);
      yield* this.strike('m1', at.x, at.y, { speed: LEAD.speed, arc: .1 });
      const away = Math.sign(m.y - P.y) || 1; s.go('m1', m.x + g.x * 1.6, m.y + g.y * 1.6 + away * 1.6, 3.2); // he goes on, out to the side away from the pass
      s.go('o1', o1.x + d.x * 2.5, o1.y + d.y * 2.5, 3.6); follows();                       // the defender turns, too late
      yield () => s.ball.state === 'loose' || (s.ball.z < .5 && dist(h, s.ball) < .55);
      s.give('hero');
      yield* this.finish('hero'); return;
    }
    if (!sp.crowd && spotId !== 'stay') { // beside a defender: m1 passes, and the defender steps across and cuts it out
      const cut = s.team('them').map(o => ({ opp: o, ...closestOnLane(o, s.ball, h, .05) })).sort((p, q) => p.d - q.d)[0];
      s.go(cut.opp.id, cut.x, cut.y, 4);
      yield* this.strike('m1', cut.x, cut.y, { speed: 11, arc: .1 });
      yield () => s.ball.state === 'loose';
      yield* this.steal(cut.opp, 'cut'); return;
    }
    const t1 = s.time; yield () => { s.go('o1', m.x, m.y, 3.6); if (spotId !== 'stay') follows(); return dist(o1, m) < .9 || s.time - t1 > 1.5; };
    yield* this.steal(o1);
  },
  // "Peek, then turn" (v64): he does not turn, he passes it straight back to the friend who passed it (first time). Kept;
  // or, with a defender in the way, cut out.
  *backPass(good) {
    const s = this.sim, h = s.a('hero'), m = s.a(this.sc.carrier || 'm1');
    this.scripted.add(m.id); s.stop('hero'); s.stop(m.id);
    const t0 = s.time; yield () => s.ball.state !== 'flying' || s.time - t0 > 1.5;
    s.give('hero');
    if (!good) { yield* this.passBad(m.id); return; }
    yield* this.strike('hero', m.x, m.y, { speed: 9, arc: .05 });
    yield () => s.ball.state === 'loose' || dist(m, s.ball) < .5;
    s.give(m.id); faceTo(m, L, W / 2);
    yield* this.end('kept', 1.1);
  },
  // Give-and-go, step 1: the pass to the wall friend. He stays where he is; step 2 asks where to run.
  *passOnly(id) {
    const s = this.sim, t = s.a(id);
    this.ai = false; s.stopAll(); this.scripted.add(id);
    yield* this.strike('hero', t.x, t.y, { speed: 13, arc: .2 });
    yield () => s.ball.state === 'loose';
    s.give(id); this.result = 'passed'; yield .2;
  },

  // "Pass in front!": everyone goes on from the freeze, and the pass goes to the spot he tapped (see generate.js lead()).
  // In front: his friend runs onto it without slowing down and goes on to goal. To his feet: by the time it
  // arrives he is past it, so he stops and comes back; a defender chasing him gets there first, else he keeps it
  // but the defenders are back. Far ahead: it runs away from him to their last defender.
  *leadGen(spotId) {
    const s = this.sim, sp = this.sc.spots.find(x => x.id === spotId), m = s.a('m1'), [dx, dy] = this.sc.dir, chaser = this.sc.moves.o2 && s.a('o2');
    this.ai = false; for (const a of s.agents.values()) this.scripted.add(a.id);
    s.stopAll(); this.leadRun();
    yield* this.strike('hero', sp.x, sp.y, { speed: LEAD.speed, arc: .1 });
    if (spotId === 'lead') {
      yield () => s.ball.state === 'loose' || (s.ball.z < .5 && dist(m, s.ball) < .55);
      // Caught out by the run: their deep defender holds his spot, and the chaser keeps chasing a step behind.
      s.give('m1'); if (chaser) s.go(chaser.id, L - 4, W / 2, this.sc.moves.o2.speed);
      yield* this.finish('m1'); return;
    }
    // He only sees where it is going once it is on its way: he runs on a moment, then pulls up.
    if (chaser && spotId === 'feet') s.go(chaser.id, sp.x, sp.y, 5);
    const deep = s.a('o3'); if (spotId === 'far') s.go(deep.id, sp.x, sp.y, DEF_RUN);
    yield .25; s.go('m1', m.x + dx * .8, m.y + dy * .8, 2.4);
    if (chaser && spotId === 'far') { const k = Math.max(0, (m.x - chaser.x) * dx + (m.y - chaser.y) * dy - .4); s.go(chaser.id, chaser.x + dx * k, chaser.y + dy * k, 2.4); } // he pulls up a step behind him
    yield .3;
    if (spotId === 'far') {
      s.stop('m1'); yield () => s.ball.state === 'loose';
      const t0 = s.time; yield () => dist(deep, s.ball) < .7 || s.time - t0 > 1;
      yield* this.steal(deep); return;
    }
    // To his feet: he turns and comes back for it.
    s.go('m1', sp.x + dx * (chaser ? 1.6 : .5), sp.y + dy * (chaser ? 1.6 : .5), chaser ? 3 : 4);
    if (chaser) {
      yield () => s.ball.state === 'loose';
      const t0 = s.time; yield () => dist(chaser, s.ball) < .7 || s.time - t0 > 1;
      s.stop('m1'); yield* this.steal(chaser); return;
    }
    const t0 = s.time; yield () => (s.ball.state !== 'flying' && dist(m, s.ball) < .7) || s.time - t0 > 2.5;
    s.give('m1'); s.stop('m1'); if (!s.turn('m1', L, W / 2)) faceTo(m, L, W / 2); // he turns with it toward goal
    // He has it, but standing still now: the nearest defender gets back in front of him.
    const o = s.team('them').sort((a, b) => dist(a, m) - dist(b, m))[0], gx = L - m.x, gy = W / 2 - m.y, gl = Math.hypot(gx, gy) || 1;
    s.go(o.id, m.x + gx / gl * 1.4, m.y + gy / gl * 1.4, 4.6);
    const t1 = s.time; yield () => dist(o, m) < 1.8 || s.time - t1 > 1.6;
    yield* this.end('kept', 1.1);
  },
  // Skill moves (sim.js, flair.js): who may use one in this part of the play (`ids`, each with his own flair), and
  // which part it is (`ctx`, for the counts); a falsy ctx: nobody. Only players who keep the ball in the script get
  // one: never on a choice that loses it, never just before a defender wins it, never while the child decides. While
  // the team AI moves players after the ball, or the script watches the ball (the run at goal waits for a clear shot), a
  // skill turn keeps the ball on the plain turn's way (`own` false), so nobody moves differently and the play ends the same.
  // `p`: how often he takes a chance here instead of his own flair's (a lesson rewards the right dribble with a skill).
  // `sure`: a defender is near the way he goes, so he takes the first chance with one beside him too (sim.js dribbleSkill).
  spice(ctx, ids, p, sure = false) { this.sim.flair = ctx ? { ctx, own: !this.ai && ctx !== 'finish', by: Object.fromEntries(ids.map(id => { const f = this.flairOf(id); return [id, p ? { ...f, p: Math.max(f.p, p), sure } : f]; })) } : null; },
  flairOf(id) { const p = id[0] === 'o' ? this.them?.players[+id[1] - 1] : this.us?.players[(this.roster || ROSTER)[id]]; return flairOf(p?.name); },
  // Picks the script for his choice and runs it. However the play ends, the team AI stops moving players.
  *outcomeGen(opt, good) {
    try {
      if (opt === 'timeout') yield* this.timeoutGen();
      else if (opt.startsWith('tackle:')) yield* this.tackleGen(opt);
      else if (opt === 'turn:B') yield* this.backPass(good);
      else if (opt.startsWith('turn:')) { // the ball arrives, and his first touch turns him that way: round his left (L) or right (R) shoulder, as the arrow he tapped goes
        const s = this.sim, h = s.a('hero'), to = dribbleEnd(h, this.sc.turns[opt[5]], L, W); this.scripted.add('hero'); s.stop('hero'); s.open('hero', to.x, to.y, opt[5] === 'L' ? 1 : -1);
        if (this.sc.cut) { const c = s.a('o3'), k = good ? .25 : .55; this.scripted.add(c.id); s.go(c.id, h.x - (h.x - c.x) * k, h.y - (h.y - c.y) * k, 5); } // (v64) the one who pressed the passer follows the ball toward him
        // (round 2: tapped while the pass is still coming, and he still on his way to meet it: he steps on to where it
        // stops, eyes on it, and is there as it comes, so his first touch is the turn, not a step after the ball)
        const b = s.ball;
        if (b.state === 'flying') { const dx = b.tx - b.fx, dy = b.ty - b.fy, l = Math.hypot(dx, dy) || 1, E = [b.tx + dx / l * .45, b.ty + dy / l * .45];
          if (Math.hypot(E[0] - h.x, E[1] - h.y) > .15 && Math.hypot(E[0] - h.x, E[1] - h.y) < 2.5) h.track = { at: t => goAt({ S: [h.x, h.y], E, a: 3, vMax: 2.6 }, t), t0: s.time, watch: true }; }
        const t0 = s.time; yield () => s.ball.state !== 'flying' || s.time - t0 > 1.5;
        if (h.track) { s.untrack('hero'); s.stop('hero'); }
        s.give('hero'); yield* this.dribbleGen(this.sc.turns[opt[5]], good, good ? to : null); // (v64: on to where the turn was aimed, not a new point from where the first touch left him, which made him steer back the other way)
      }
      else if (good && this.sc.then && opt === this.sc.best) yield* this.passOnly(MATE[opt]);
      else if (good && this.offBall && MATE[opt]) { this.offBall = false; yield* this.passOnly(MATE[opt]); this.result = 'support'; }
      else if (opt === 'shoot') { this.ai = true; yield* this.shootGen(good); }
      else if (opt.startsWith('shoot:')) { this.ai = true; yield* this.shotGen(opt); }
      else if (opt.startsWith('spot:') && this.sc.kind === 'lead') yield* this.leadGen(opt.slice(5));
      else if (opt.startsWith('spot:') && this.sc.run) yield* (this.sc.run === 'follow' ? this.followGen(opt.slice(5), good) : this.goalRunGen(opt.slice(5), good));
      else if (opt.startsWith('spot:')) yield* (this.sc.kind === 'support' ? this.supportGen(opt.slice(5), good) : this.defendGen(opt.slice(5), good));
      else if (opt.startsWith('push:')) yield* this.pushGen(opt.slice(5), good);
      else if (MATE[opt]) {
        if (good) { yield* this.passGood(MATE[opt]); yield* this.finish(MATE[opt]); }
        else yield* this.passBad(MATE[opt]);
      } else yield* this.dribbleGen(opt.slice(5), good);
    } finally { this.ai = false; this.spice(null); }
  },
  async outcome(opt, good) {
    this.closeWindow?.(); // (v64: the window's planned ways end; everyone goes on as he was going until the play moves him)
    for (const a of this.sim.agents.values()) { a.ease = false; a.aic = null; } // (the team AI's own easing and commitments start afresh with the play)
    const h = this.sim.a('hero');
    if (this.sc?.kind !== 'tackle') this.handAt = null;
    this.cancel(this.swing); // the play starts: nothing turns the view any more
    // A "safe" dribble or push forward (onto a friend) keeps the ball and stops there; it doesn't run on to score.
    this.keepOnly = good && (opt.startsWith('drib:') || opt.startsWith('push:')) && this.sc.kind !== 'receive' && this.rating(opt) === 'safe';
    const aimed = opt.startsWith('shoot:') && !!this.sim.keeper('them') && (this.step === 'aim' || this.step === 'foot'); // (he aimed in the aim view: his shot is seen from there, view.js aimView)
    if (aimed) this.aimFrom = { x: h.x, y: h.y };
    Object.assign(this, { roles: null, teamJob: null, playGood: good, result: null, phase: 'outcome', step: null, pendingDir: null, drag: null, camMode: this.sc?.kind === 'tackle' ? 'player' : aimed ? 'aim' : 'follow', ai: true, scripted: new Set(['hero']), ballTeam: 'us' });
    this.follow = { x: h.x + 2, y: lerp(h.y, W / 2, .4), yaw: 0, yawT: 0 };
    // (round 6) One of theirs within a step and a half of him as he plays the right thing goes in for it, now, and is
    // too late: he steps in at the ball (to a short step off it) as it is played, and is left off balance. (A dribble
    // does its own: dribbleGen. A wrong choice: the play's script has him take it.)
    if (good && opt !== 'timeout' && !opt.startsWith('drib:') && !opt.startsWith('turn:') && this.sim.ball.carrier === 'hero') { const s = this.sim, b = s.ball;
      for (const f of s.team('them')) { const d = dist(f, b); if (f.gk || dist(f, h) >= 1.5 || f.beat > s.time) continue; f.tk = s.time; f.beat = s.time + .9;
        if (d > .9) { this.scripted.add(f.id); s.go(f.id, b.x + (f.x - b.x) / d * .8, b.y + (f.y - b.y) / d * .8, 3.4); } } }
    await this.play(this.outcomeGen(opt, good));
  },
  // Shows how the play ended. In a lesson round the stars and tip (set in `this.rated` before the play) come in
  // the same card, at the same moment.
  emit(ev) {
    const [title, kind] = { timeout: [TIMEOUT_TITLE, 'soft'], keeperSave: ['Great save!', 'goal'], saved: ['Saved!', 'bad'], over: ['Over the bar!', 'bad'], wide: ['Wide!', 'bad'], cleared: ['Cleared!', 'bad'], goal: ['GOAL!', 'goal'], goalAgainst: ['They scored', 'bad'], stolen: ['Stolen!', 'bad'], won: ['Stole it!', 'goal'], held: ['Stopped him!', 'goal'], kept: ['Kept the ball!', 'goal'], lost: ['They got it!', 'bad'], cut: ['Cut out!', 'bad'] }[ev];
    if (ev === 'goal') this.sfx('net');
    const rated = this.rated; this.rated = null;
    // (v66: out of time and they score: the net moves, and nothing celebrates)
    this.fx(rated?.soft && ev === 'goalAgainst' ? 'goalQuiet' : ev === 'keeperSave' ? 'held' : ev === 'lost' || ev === 'cut' || ev === 'saved' || ev === 'over' || ev === 'wide' || ev === 'cleared' ? 'stolen' : ev);
    if (rated?.soft) { this.card = this.hud.banner(rated.title || TIMEOUT_TITLE, 'soft', rated); this.say(rated.said); return; } // (v64: out of time: whatever the play did, the card says it kindly)
    // A light result (a lesson round right on the first try, Level 2 and up: rounds.js attempt): the big words, stars
    // over his player and the praise said, then on to the next round with no card.
    if (rated?.light) { this.card = this.hud.banner(title, kind); this.hud.pop?.(3); this.say(rated.said); return; }
    this.card = this.hud.banner(title, kind, rated);
    if (rated?.say) this.say(rated.text); else if (rated?.said) this.say(rated.said);
    this.resultCue?.(); // a match: the idea's name after a miss (live.js)
  },
};
