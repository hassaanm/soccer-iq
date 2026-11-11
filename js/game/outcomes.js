// Outcome scripts: what happens on the pitch after his choice (pass, dribble, push, shot, run, steal), up to the
// banner that ends the play. The scripts move the players in `scripted`; the team AI moves everyone else.
import { lerp, clamp, dist, interceptor, dribbleEnd, closestOnLane, BACKWARD } from '../geom.js';
import { pushEnd, DEF_RUN, takeOn, LEAD } from '../generate.js';
import { L, W, gy0, gy1, MATE, faceTo } from './shared.js';

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
  // How a play ends: note the result, stop everyone where they stand, show the banner and hold on it for `wait` seconds.
  *end(result, wait) { this.result = result; this.ai = false; this.sim.stopAll(); this.emit(result); yield wait; },
  // After a good choice the player runs at goal, but only shoots when nobody blocks the path or the shot.
  // If a defender steps in front, he stops and keeps the ball: that is the real reward for a safe choice.
  *finish(id) {
    const s = this.sim, a = s.a(id), tx = L - 3.5, opps = s.team('them');
    const room = y => Math.min(...opps.map(o => closestOnLane(o, a, { x: tx, y }, 0).d));
    const ty = [W / 2 - 2.5, W / 2, W / 2 + 2.5].map(y => ({ y, r: room(y) - Math.abs(y - a.y) * .08 })).sort((p, q) => q.r - p.r)[0].y;
    this.scripted.add(id); s.go(id, tx, ty, 5.2);
    const t0 = s.time;
    let blocked = false;
    for (;;) {
      yield 1 / 30;
      const aim = { x: L, y: clamp(a.y, gy0 + .8, gy1 - .8) };
      if (dist(a, aim) < 8 && shotClear(s.ball, aim, opps)) break;            // close (5–10 yards) with a clear look: shoot
      const fx = tx - a.x, fy = ty - a.y, fl = Math.hypot(fx, fy) || 1;
      if (opps.some(o => dist(o, a) < 1.7 && ((o.x - a.x) * fx + (o.y - a.y) * fy) / fl > .2)) { blocked = true; break; } // defender in front
      if (Math.hypot(fx, fy) < .3 || s.time - t0 > 4) { blocked = !shotClear(s.ball, aim, opps); break; }
    }
    s.stop(id);
    if (blocked) { yield* this.end('kept', 1.1); return; }
    // Wind up facing the goal, then check the shot line once more at the moment of the kick.
    this.ai = false; s.stopAll();
    const shot = { x: L + .7, y: clamp(a.y, gy0 + .8, gy1 - .8) };
    const foot = pickFoot(a, shot.x, shot.y, 'shot', opps);
    faceTo(a, shot.x, shot.y);
    for (const p of s.team('us')) if (p.id !== id && closestOnLane(p, s.ball, shot, 0).d < 1.2) { this.scripted.add(p.id); this.frozen.push(p.id); this.giveWay(p, s.ball, shot); }
    s.windup(id, 'shot', foot); yield .2;
    if (!shotClear(s.ball, shot, opps)) { yield* this.end('kept', 1.1); return; }
    s.kick(shot.x, shot.y, { speed: 17, arc: .5 }); this.kicked = true;
    yield () => s.ball.state === 'loose';
    yield* this.end('goal', 1.4);
  },
  // Turn to face the target, wind up, then the ball leaves the foot at contact. Players the scripts aren't
  // moving freeze if they stand near the ball's path, so the team AI never walks anyone into (or through) it.
  // A player near the path of a kick stops; one right in it steps out of the way, to the side he is already on.
  giveWay(p, from, to, low = true) {
    const c = closestOnLane(p, from, to, 0);
    if (!low || c.d >= .8) { this.sim.stop(p.id); return; }
    const dx = p.x - c.x, dy = p.y - c.y, l = Math.hypot(dx, dy);
    let nx = l > .05 ? dx / l : -(to.y - from.y), ny = l > .05 ? dy / l : to.x - from.x; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    this.sim.go(p.id, clamp(c.x + nx * 1.3, .5, L - .5), clamp(c.y + ny * 1.3, .5, W - .5), 4.5);
  },
  *strike(id, x, y, opts) {
    const s = this.sim, a = s.a(id), to = { x, y };
    for (const p of s.agents.values()) if (p.id !== id && !this.scripted.has(p.id) && closestOnLane(p, s.ball, to, .02).d < 1.2) { this.scripted.add(p.id); this.frozen.push(p.id); this.giveWay(p, s.ball, to, (opts?.arc ?? .3) < .4); }
    const kind = (opts?.speed ?? 11) > 14 ? 'shot' : 'pass', foot = pickFoot(a, x, y, kind, [...s.agents.values()].filter(o => o.team !== a.team));
    faceTo(a, x, y); s.windup(id, kind, foot); yield .2;
    s.kick(x, y, opts); this.kicked = true;
  },
  *passGood(id) {
    const s = this.sim, t = s.a(id);
    this.scripted.add(id); s.stop(id);
    yield* this.strike('hero', t.x, t.y, { speed: 13, arc: .2 });
    this.scripted.delete('hero'); // after passing he runs to support
    yield () => s.ball.state === 'loose';
    s.give(id); this.scripted.delete(id); yield .15;
  },
  *steal(opp) {
    const s = this.sim;
    // He has to actually reach the ball before it's his.
    const t0 = s.time; yield () => { s.go(opp.id, s.ball.x, s.ball.y, 5); return dist(opp, s.ball) < .75 || s.time - t0 > .7; };
    s.give(opp.id); s.stop('hero'); this.result = 'stolen'; this.emit('stolen');
    this.scripted.add(opp.id); s.go(opp.id, Math.max(2.5, opp.x - 4), clamp(lerp(opp.y, W / 2, .4), 1.5, W - 1.5), 4.8); yield .8;
  },
  *passBad(id) {
    const s = this.sim, m = s.a(id), them = s.team('them');
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
    this.scripted.add(ic.opp.id); s.go(ic.opp.id, ic.x, ic.y, 6);
    yield* this.strike('hero', ic.x, ic.y, { speed: 13, arc: .15 });
    yield () => s.ball.state === 'loose';
    const t0 = s.time; yield () => { s.go(ic.opp.id, s.ball.x, s.ball.y, 6); return dist(ic.opp, s.ball) < .7 || s.time - t0 > 1; };
    yield* this.steal(ic.opp);
  },
  *dribbleGen(dir, good) {
    const s = this.sim, h = s.a('hero'), end = dribbleEnd(h, dir, L, W), cut = good && takeOn(h, dir, s.team('them'));
    this.scripted.add('hero'); s.go('hero', end.x, end.y, 4.4);
    const t0 = s.time;
    // A take-on: the defender bites, stepping in toward where the ball was, and he cuts past him on the open side.
    if (cut?.good) { const f = cut.foe; this.scripted.add(f.id); s.go(f.id, lerp(f.x, h.x, .5), lerp(f.y, h.y, .5), 3); yield .45; this.scripted.delete(f.id); }
    if (good) {
      yield () => dist(h, end) < .3 || s.time - t0 > 2.5;
      if (BACKWARD.has(dir) || this.keepOnly) { s.stop('hero'); yield* this.end('kept', 1.1); return; }
      yield* this.finish('hero');
    } else {
      const opps = s.team('them').sort((a, b) => dist(a, end) - dist(b, end)).slice(0, 2);
      for (const o of opps) { this.scripted.add(o.id); s.go(o.id, end.x, end.y, 5); }
      yield () => opps.some(o => dist(o, h) < .9) || s.time - t0 > 2.5;
      yield* this.steal(opps.find(o => dist(o, h) < 1.2) || opps[0]);
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
      const o = inLane.opp; this.scripted.add(o.id); s.go(o.id, inLane.x, inLane.y, 4);
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
      const back = Math.max(1.4, dist(racer, h)); s.go(racer.id, h.x + (racer.x - h.x) / (dist(racer, h) || 1) * back, h.y + (racer.y - h.y) / (dist(racer, h) || 1) * back, 2);
      yield .1; this.scripted.delete(racer.id);
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
    const defenders = () => s.team('us');
    yield .55;
    const toGoal = (a) => { const dx = 0 - a.x, dy = W / 2 - a.y, l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
    if (good && holds(sc)) {
      // He's in the way: the carrier slows down when a defender is in front of him, finds no way through and passes away.
      const [gx, gy] = toGoal(c);
      this.scripted.add(c.id); s.go(c.id, c.x + gx * 3, c.y + gy * 3, 2.4);
      const t0 = s.time;
      yield () => defenders().some(d => (d.x - c.x) * gx + (d.y - c.y) * gy > .3 && dist(d, c) < 2) || s.time - t0 > 2.5;
      s.stop(c.id); yield .4;
      const mates = s.team('them').filter(o => o.id !== c.id), us = s.team('us');
      const lane = o => Math.min(...us.map(d => closestOnLane(d, s.ball, o, .05).d));
      const to = mates.filter(o => lane(o) > 1).sort((a, b) => lane(b) - lane(a))[0];
      if (to) { // he passes away to a teammate; with no open pass at all, he just turns away and holds it up
        this.scripted.add(to.id); s.stop(to.id);
        yield* this.strike(c.id, to.x, to.y, { speed: 10, arc: .15 });
        yield () => s.ball.state === 'loose';
        s.give(to.id);
      } else { const [hx, hy] = toGoal(c); c.face = [-hx, -hy]; yield .5; }
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
        this.scripted.add(c.id); s.go(c.id, c.x + gx * 3, c.y + gy * 3, 2.8);          // keeps going at goal, facing it
        // The tackle comes from a defender who is goal-side of the ball (in front of him), never from behind.
        const front = [...defenders()].filter(d => (d.x - c.x) * gx + (d.y - c.y) * gy > .3).sort((a, b) => dist(a, c) - dist(b, c));
        const tackler = front.includes(h) ? h : front[0] || h; // he made the right run, so he makes the tackle
        this.scripted.add(tackler.id);
        const t0 = s.time;
        yield () => { s.go(tackler.id, c.x + gx * .7, c.y + gy * .7, 4.6); return dist(tackler, c) < 1 || s.time - t0 > 3; };
        s.stop(c.id); c.face = [gx, gy];
        tackler.face = [-gx, -gy]; s.give(tackler.id);                                     // he pokes it away, facing upfield
        s.go(tackler.id, tackler.x - gx * 2.5, tackler.y - gy * 2.5, 3.6);
        yield .4;
      }
      yield* this.end('won', 1.3); return;
    }
    // Wrong spot: the attackers use the gap he left — an open run at goal, or a pass to the unmarked attacker.
    const plan = sc.exploits?.[spotId] || { kind: 'dribble', who: c.id, to: [4.5, W / 2] };
    let shooter = c;
    this.ai = false; for (const d of s.team('us')) if (d.id !== 'hero') s.stop(d.id);
    if (plan.kind === 'pass') {
      const t1 = s.time; yield () => dist(h, sp) < .4 || s.time - t1 > 1;
      const free = s.a(plan.who);
      this.scripted.add(c.id); this.scripted.add(free.id); s.stop(free.id);
      yield* this.strike(c.id, free.x, free.y, { speed: 11, arc: .2 });
      yield () => s.ball.state === 'loose';
      s.give(free.id); shooter = free;
    }
    this.scripted.add(shooter.id);
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
    const s = this.sim;
    this.ai = false; s.stopAll();
    yield* this.strike(shooter.id, -.7, clamp(shooter.y, gy0 + .8, gy1 - .8), { speed: 17, arc: .5 });
    yield () => s.ball.state === 'loose';
    yield* this.end('goalAgainst', 1.3);
  },
  // Getting open: he runs to his spot while his defender follows a step behind. Open space: his friend passes
  // and he plays on. Behind a defender: the pass gets cut out. Next to the ball: both defenders close in and win it.
  *supportGen(spotId, good) {
    const s = this.sim, sp = this.sc.spots.find(x => x.id === spotId), h = s.a('hero'), c = s.a(this.sc.carrier || 'm1');
    const o1 = s.a(this.sc.pressId || 'o1'), o2 = s.a(this.sc.markId || 'o2'), o2id = o2.id;
    this.ai = false; s.stopAll(); for (const a of s.agents.values()) this.scripted.add(a.id);
    s.go('hero', sp.x, sp.y, 5);
    const t0 = s.time;
    yield () => { s.go(o2id, h.x + (c.x - h.x) * .12, h.y + (c.y - h.y) * .12, 2.6); return dist(h, sp) < .4 || s.time - t0 > 1.8; };
    s.stop('hero'); s.stop(o2id);
    if (sp.crowd) { // two defenders on two players right together: they win it
      const t1 = s.time; yield () => { s.go(o1.id, c.x, c.y, 4); s.go(o2id, lerp(h.x, c.x, .5), lerp(h.y, c.y, .5), 3.5); return dist(o1, c) < .9 || s.time - t1 > 1.5; };
      yield* this.steal(o1); return;
    }
    faceTo(h, c.x, c.y); yield .25;
    if (good) {
      // He'll peek and turn, but only when the pass comes from behind him (otherwise he already faces the goal).
      if (this.has('peek-and-turn') && Math.abs(Math.atan2(c.y - h.y, c.x - h.x)) > 2) { yield* this.strike(c.id, h.x - .3, h.y, { speed: 8, arc: .05 }); this.result = 'incoming'; return; }
      yield* this.strike(c.id, h.x, h.y, { speed: 11, arc: .15 });
      yield () => s.ball.state === 'loose' || dist(h, s.ball) < .5;
      s.give('hero'); this.scripted = new Set(['hero']); this.ai = true; yield .2;
      yield* this.finish('hero'); return;
    }
    // The pass goes, but the defender standing in its path cuts it out.
    const them = s.team('them'), cut = them.map(o => ({ opp: o, ...closestOnLane(o, s.ball, h, .05) })).sort((a, b) => a.d - b.d)[0];
    s.go(cut.opp.id, cut.x, cut.y, 4);
    yield* this.strike(c.id, cut.x, cut.y, { speed: 11, arc: .1 });
    yield () => s.ball.state === 'loose';
    yield* this.steal(cut.opp);
  },
  // He shoots: a clear shot goes in; a blocked one is stopped by the defender in the way.
  *shootGen(good) {
    const s = this.sim, h = s.a('hero'), aim = { x: L + .7, y: clamp(h.y, gy0 + .8, gy1 - .8) };
    this.scripted.add('hero'); this.ai = false; s.stopAll();
    if (good) { yield* this.strike('hero', aim.x, aim.y, { speed: 17, arc: .5 }); yield () => s.ball.state === 'loose'; this.result = 'goal'; this.emit('goal'); yield 1.4; return; }
    const block = interceptor(s.ball, aim, s.team('them'));
    this.scripted.add(block.opp.id); s.go(block.opp.id, block.x, block.y, 5);
    yield* this.strike('hero', block.x, block.y, { speed: 15, arc: .2 });
    yield () => s.ball.state === 'loose';
    yield* this.steal(block.opp);
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
        s.give('hero'); h.face = [1, 0]; s.go('hero', h.x + 2.5, lerp(h.y, W / 2, .2), 3.4); s.go(c.id, c.x + .6, c.y, 1.5);
        this.result = 'won'; this.emit('won'); yield 1.3; s.stopAll(); return;
      }
    } else if (opt !== 'tackle:none') {
      // He dives in. The attacker gets there first and takes it around him; he lands where the ball was.
      const at = { x: s.ball.x, y: s.ball.y };
      s.go('hero', at.x, at.y, 4.5); yield .35; s.go('hero', h.x, h.y, 0);
      if (s.ball.carrier !== c.id) { const t0 = s.time; yield () => { s.go(c.id, s.ball.x, s.ball.y, sc.speed + .6); return dist(c, s.ball) < .5 || s.time - t0 > 1; }; s.give(c.id); }
      const side = c.y > h.y ? 1 : -1; s.go(c.id, Math.max(2, h.x - 1.2), clamp(h.y + side * 1.6, 1.5, W - 1.5), 4.2);
      yield () => c.x < h.x - .8 || dist(c, { x: c.tx, y: c.ty }) < .2;
    }
    // He's past: he runs in and scores, from a spot where none of our players stands in the way of the shot.
    const ours = s.team('us').filter(d => d.id !== 'hero');
    const clear = y => Math.min(9, ...ours.map(d => Math.min(closestOnLane(d, c, { x: 4.5, y }, 0).d, closestOnLane(d, { x: 4.5, y }, { x: -.7, y: clamp(y, gy0 + .8, gy1 - .8) }, 0).d)));
    const spot = { x: 4.5, y: [lerp(c.y, W / 2, .6), W / 2 - 2.5, W / 2, W / 2 + 2.5].sort((a, b) => clear(b) - clear(a))[0] };
    s.go(c.id, spot.x, spot.y, 4.6);
    const t1 = s.time; yield () => { s.go('hero', c.x + 1.4, c.y + (h.y > c.y ? 1 : -1), 3.2); return dist(c, spot) < .4 || s.time - t1 > 3; }; // he chases from behind
    yield* this.concede(c);
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
    s.give('m1'); s.stop('m1'); faceTo(m, L, W / 2);
    // He has it, but standing still now: the nearest defender gets back in front of him.
    const o = s.team('them').sort((a, b) => dist(a, m) - dist(b, m))[0], gx = L - m.x, gy = W / 2 - m.y, gl = Math.hypot(gx, gy) || 1;
    s.go(o.id, m.x + gx / gl * 1.4, m.y + gy / gl * 1.4, 4.6);
    const t1 = s.time; yield () => dist(o, m) < 1.8 || s.time - t1 > 1.6;
    yield* this.end('kept', 1.1);
  },
  // Picks the script for his choice and runs it. However the play ends, the team AI stops moving players.
  *outcomeGen(opt, good) {
    try {
      if (opt.startsWith('tackle:')) yield* this.tackleGen(opt);
      else if (opt.startsWith('turn:')) { // the ball arrives, and his first touch turns him that way
        const s = this.sim; this.scripted.add('hero'); s.stop('hero');
        const t0 = s.time; yield () => s.ball.state !== 'flying' || s.time - t0 > 1.5;
        s.give('hero'); yield* this.dribbleGen(this.sc.turns[opt[5]], good);
      }
      else if (good && this.sc.then && opt === this.sc.best) yield* this.passOnly(MATE[opt]);
      else if (good && this.offBall && MATE[opt]) { this.offBall = false; yield* this.passOnly(MATE[opt]); this.result = 'support'; }
      else if (opt === 'shoot') { this.ai = true; yield* this.shootGen(good); }
      else if (opt.startsWith('spot:') && this.sc.kind === 'lead') yield* this.leadGen(opt.slice(5));
      else if (opt.startsWith('spot:')) yield* (this.sc.kind === 'support' ? this.supportGen(opt.slice(5), good) : this.defendGen(opt.slice(5), good));
      else if (opt.startsWith('push:')) yield* this.pushGen(opt.slice(5), good);
      else if (MATE[opt]) {
        if (good) { yield* this.passGood(MATE[opt]); yield* this.finish(MATE[opt]); }
        else yield* this.passBad(MATE[opt]);
      } else yield* this.dribbleGen(opt.slice(5), good);
    } finally { this.ai = false; }
  },
  async outcome(opt, good) {
    const h = this.sim.a('hero');
    if (this.sc?.kind !== 'tackle') this.handAt = null;
    this.cancel(this.swing); // the play starts: nothing turns the view any more
    // A "safe" dribble or push forward (onto a friend) keeps the ball and stops there; it doesn't run on to score.
    this.keepOnly = good && (opt.startsWith('drib:') || opt.startsWith('push:')) && this.sc.kind !== 'receive' && this.rating(opt) === 'safe';
    Object.assign(this, { roles: null, result: null, phase: 'outcome', step: null, pendingDir: null, drag: null, camMode: this.sc?.kind === 'tackle' ? 'player' : 'follow', ai: true, scripted: new Set(['hero']), ballTeam: 'us' });
    this.follow = { x: h.x + 2, y: lerp(h.y, W / 2, .4), yaw: 0, yawT: 0 };
    await this.play(this.outcomeGen(opt, good));
  },
  // Shows how the play ended. In a lesson round the stars and tip (set in `this.rated` before the play) come in
  // the same card, at the same moment.
  emit(ev) {
    const [title, kind] = { goal: ['GOAL!', 'goal'], goalAgainst: ['They scored', 'bad'], stolen: ['Stolen!', 'bad'], won: ['Stole it!', 'goal'], held: ['Stopped him!', 'goal'], kept: ['Kept the ball!', 'goal'] }[ev];
    if (ev === 'goal') this.sfx('net');
    this.fx(ev);
    const rated = this.rated; this.rated = null;
    this.card = this.hud.banner(title, kind, rated);
    if (rated?.say) this.say(rated.text); else if (rated?.said) this.say(rated.said);
  },
};
