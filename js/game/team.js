// Team shape while the ball is live: who presses, covers and marks, and where the attackers without the ball run.
import { lerp, clamp, dist, closestOnLane } from '../geom.js';
import { L, W } from './shared.js';
import { longLead, touchAt } from '../sim.js';

const PRESS_OFF = 1.9; // (round 6) the one on the ball holds him up from two steps off, goal-side: nearer than a step and a half he must go in for it
const COMMIT = { ball: 2, t: .8, react: [.1, .4] }; // (see aiGo)

export const team = {
  // Simple team shape while the ball is live: the nearest defender presses, the next covers
  // between the ball and goal, the last marks the most dangerous attacker. Attackers without
  // the ball run ahead into wide lanes to support. Scripted players (passer, shooter, tacklers) are left alone.
  teamAI() {
    const s = this.sim, b = s.ball, carrier = s.a(b.carrier);
    if (carrier) this.ballTeam = carrier.team;
    const atk = this.ballTeam, def = atk === 'us' ? 'them' : 'us';
    const dir = atk === 'us' ? 1 : -1;
    // Where the ball is for them: where a pass is going; in a long touch in open space (sim.js touchLen), where a close
    // touch would have it, so pushing it ahead does not pull anyone out of place.
    const lead = carrier && b.state === 'carried' && !b.move && !b.reach ? longLead(carrier.tL || 1.4, touchAt(carrier) % 1) : 0;
    const ball = b.state === 'flying' ? { x: b.tx, y: b.ty } : { x: b.x - Math.cos(b.h) * lead, y: b.y - Math.sin(b.h) * lead };
    const free = a => !this.scripted.has(a.id) && a.id !== b.carrier;
    const attackers = s.team(atk);
    // (v66) Both teams defend by the same common-sense rule: the nearest free defender goes to the ball, each of the
    // others takes one attacker (goal-side of him), and anyone left over covers behind the ball.
    this.defend(def, ball, attackers, free);
    // Support shape: spread out. The attacker nearer the goal gives a target ahead and wide; the other is an
    // outlet a little behind, on the other side. Both stay out of the dribbler's path, at least 4.5 m from where
    // he is going, and apart from each other, so nobody runs into him or takes his space (what the AI players do
    // teaches too: space means nobody there, not even a friend).
    const goalAhead = (p, q) => (q.x - p.x) * dir, mover = carrier && carrier.team === atk ? carrier : null;
    const from = mover ? { x: mover.x, y: mover.y } : ball, fut = mover ? { x: mover.tx, y: mover.ty } : ball;
    const clearOf = p => {
      for (let k = 0; k < 3; k++) {
        const c = closestOnLane(p, from, fut, 0);
        if (c.d < 2.5) { const dx = p.x - c.x, dy = p.y - c.y, l = Math.hypot(dx, dy); const ny = l > .05 ? dy / l : (p.y < W / 2 ? -1 : 1), nx = l > .05 ? dx / l : 0; p.x = c.x + nx * 2.5; p.y = c.y + ny * 2.5; }
        const d = dist(p, fut); if (d < 4.5) { const l = d || 1; p.x = fut.x + (p.x - fut.x) / l * 4.5; p.y = fut.y + (p.y - fut.y) / l * 4.5; }
        p.x = clamp(p.x, 2, L - 2); p.y = clamp(p.y, 1.5, W - 1.5);
      }
      return p;
    };
    const sup = attackers.filter(free).sort(goalAhead), side0 = sup[0] && sup[0].y < fut.y ? -1 : 1;
    const wide = sgn => { const y = clamp(fut.y + sgn * 5, 2, W - 2); return Math.abs(y - fut.y) < 3.5 ? clamp(fut.y - sgn * 5, 2, W - 2) : y; };
    const spots = sup.slice(0, 2).map((a, i) => clearOf(i === 0 ? { x: clamp(fut.x + dir * 5, 2, L - 3), y: wide(side0) } : { x: clamp(fut.x - dir * 3, 2, L - 2), y: wide(-side0) }));
    if (spots.length === 2 && dist(spots[0], spots[1]) < 4) { spots[1].y = wide(spots[0].y > fut.y ? -1 : 1); clearOf(spots[1]); }
    // Four a side: the third free attacker makes the diamond round the ball, where there is the most room: deep up the
    // middle, out wide on the far side, or back in the middle.
    if (sup.length > 2) {
      const room = p => Math.min(...spots.map(q => dist(p, q)), ...attackers.filter(a => !free(a)).map(a => dist(p, a)));
      const cand = [{ x: fut.x + dir * 9, y: lerp(fut.y, W / 2, .7) }, { x: fut.x + dir * 2, y: wide(-side0) }, { x: fut.x - dir * 6, y: W / 2 }].map(p => clearOf({ x: clamp(p.x, 2, L - 3), y: clamp(p.y, 2, W - 2) }));
      while (spots.length < sup.length) spots.push(cand.sort((p, q) => room(q) - room(p))[0] && cand.splice(0, 1)[0] || spots[spots.length - 1]); // (no one has the ball, a keeper holding it: every attacker gets a place)
    }
    // (v66) Never two friends sent to one place (the clamps at the lines, or the carrier's way, can push two places
    // together): the later one goes a few steps off it, back and toward the middle.
    for (let i = 1; i < spots.length; i++) for (let n = 0; n < 3 && spots.slice(0, i).some(q => dist(q, spots[i]) < 2); n++) spots[i] = { x: clamp(spots[i].x - dir * 2.5, 2, L - 2), y: clamp(spots[i].y + (spots[i].y > W / 2 ? -3 : 3), 2, W - 2) };
    sup.forEach((a, i) => this.aiGo(a, spots[i].x, spots[i].y, i ? 3.4 : 3.8));
    for (const a of s.list) if (!free(a)) a.ease = false; // (players the play's script moves go as it says)
  },
  // (v64, research Q1) Every player the team AI moves sticks with where he is going, as a child does: he changes his mind
  // only when the ball has moved more than COMMIT.ball metres, when the other team gets it (then each reacts a moment
  // apart, COMMIT.react seconds, so nobody moves on the same frame as everyone else), or after COMMIT.t seconds. And he
  // speeds up and slows down as a child can (sim.js: a.ease). Without this rule a target that changes every frame makes
  // him go toward, away and toward again.
  // `track`: the one pressing the ball goes after it as it moves (his job is the ball), with no wait to change his mind.
  aiGo(a, x, y, speed, track = false) {
    const s = this.sim, b = s.ball, now = s.time, poss = b.carrier ? s.a(b.carrier)?.team || null : null, c = a.aic;
    a.ease = true;
    if (track && c && c.poss === poss && now >= c.ready) { s.go(a.id, x, y, speed); return; }
    if (c && c.poss === poss) {
      if (now < c.ready) return; // still reacting: he goes on as he was
      if (now - c.t < COMMIT.t && Math.hypot(b.x - c.bx, b.y - c.by) < COMMIT.ball) { s.go(a.id, c.x, c.y, c.sp); return; }
    }
    const lag = c && c.poss !== poss ? COMMIT.react[0] + (COMMIT.react[1] - COMMIT.react[0]) * ((a.id.charCodeAt(1) * 7 + (a.team === 'us' ? 3 : 0)) % 10) / 9 : 0;
    // (round 5) A new place a step or two behind a player on the move: he is there already. He slows to a stop going on
    // (half a step), instead of turning round for it.
    if (!track && !lag) { const lv = a.mom && a.momT > now ? a.mom : a.lv, ls = lv ? Math.hypot(lv[0], lv[1]) : 0, dx = x - a.x, dy = y - a.y, d = Math.hypot(dx, dy);
      if (ls > .8 && d > .05 && d < 1.5 && (lv[0] * dx + lv[1] * dy) / (ls * d) < -.17) { const k = Math.min(.5, ls * .3); x = a.x + lv[0] / ls * k; y = a.y + lv[1] / ls * k; } }
    a.aic = { x, y, sp: speed, t: now + lag, bx: b.x, by: b.y, poss, ready: now + lag };
    if (!lag) s.go(a.id, x, y, speed);
  },

  // (round 6) The rule of live play, whatever moves the players (the team's shape, a play's script, the moments before
  // a choice): nobody stays within a step and a half of the other team's player on the ball. One who has been there for
  // a third of a second without going in for it goes in now: he lunges at the ball, misses as it is moved on, and is
  // carried past, off balance (a.tk, a.beat). Not while a choice is open (there the one who is already there jockeys,
  // by the window's plan), not his own player on the ball's side of a choice of his own (a 1v1: when to go in is his
  // choice), not keepers. His own player in a defending play he has chosen is held to it like anyone.
  noHover(dt) {
    const s = this.sim, c = s.ball.carrier && s.ball.state !== 'flying' ? s.a(s.ball.carrier) : null;
    if (!c || c.gk || this.win || (this.mode !== 'match' && this.mode !== 'free') || this.phase === 'feedback' || this.sc?.kind === 'tackle') { for (const a of s.agents.values()) a.hov = 0; return; }
    for (const d of s.agents.values()) {
      if (d.gk || d.team === c.team || (d.id === 'hero' && !(this.sc?.kind === 'defense' && this.phase === 'outcome')) || d.beat > s.time || d.tk > s.time - .5 || Math.min(dist(d, c), dist(d, s.ball)) >= 1.5) { d.hov = 0; continue; }
      if (this.leaving(d)) { d.hov = 0; continue; } // (a friend whose job is one of their other players: he is on his way off the ball)
      d.hov = (d.hov || 0) + dt; if (d.hov < .3) continue;
      const b = s.ball, dx = b.x - d.x, dy = b.y - d.y, l = Math.hypot(dx, dy) || 1, sd = Math.sign(dx * (c.ty - c.y) - dy * (c.tx - c.x)) || 1; // (past it on the side the player on it is not going to)
      d.hov = 0; d.tk = s.time; d.beat = s.time + 1; d.mom = null; d.aic = null; d.track = null;
      s.go(d.id, clamp(b.x + dx / l * 1.3 + dy / l * sd * .5, .5, L - .5), clamp(b.y + dy / l * 1.3 - dx / l * sd * .5, .5, W - .5), 5);
    }
  },
  // A team on defense does what the lessons teach: only one player (the nearest who is free) pressures the ball, and
  // everyone else guards an attacker, standing goal-side of him: nobody leaves his player to chase, and no attacker is
  // left to two while another stands free. One with nobody left to guard drops back and covers.
  defend(def, ball, attackers, free) {
    const s = this.sim, mine = s.team(def), goal = { x: def === 'us' ? 0 : L, y: W / 2 };
    const gs = (p, k) => { const dx = goal.x - p.x, dy = goal.y - p.y, l = Math.hypot(dx, dy) || 1; return { x: p.x + dx / l * k, y: p.y + dy / l * k }; };
    const cover = () => ({ x: lerp(ball.x, goal.x, .4), y: lerp(ball.y, W / 2, .5) });
    // (round 6) How far off the ball the one pressing holds: two steps, goal-side (he holds him up; nearer than a step and a half he must go in).
    const standOff = () => PRESS_OFF;
    // (round 6) One going to the player he guards goes round the ball, not through it (two and a half metres off it).
    // (round 7) And the place he guards from is never at the shoulder of the player on the ball: two steps and more off it.
    const off2 = p => { const dx = p.x - ball.x, dy = p.y - ball.y, l = Math.hypot(dx, dy); return l >= 2.4 || l < .05 ? p : { x: clamp(ball.x + dx / l * 2.4, 1, L - 1), y: clamp(ball.y + dy / l * 2.4, 1, W - 1) }; };
    const round = (d, p0) => { const p = off2(p0);
      // (and one who is nearer the ball than that himself gets out to that distance first, round toward his place: he never runs by its shoulder)
      { const rx = d.x - ball.x, ry = d.y - ball.y, rb = Math.hypot(rx, ry); if (rb < 2.7 && rb > .05 && Math.hypot(p.x - d.x, p.y - d.y) > 1) { const sd = Math.sign(rx * (p.y - ball.y) - ry * (p.x - ball.x)) || 1, c = Math.cos(sd * .9), sn = Math.sin(sd * .9), wx = (rx * c - ry * sn) / rb, wy = (rx * sn + ry * c) / rb; return { x: clamp(ball.x + wx * 3.3, 1, L - 1), y: clamp(ball.y + wy * 3.3, 1, W - 1), now: true }; } } const c = closestOnLane(ball, d, p, 0); if (c.d >= 2.3 || c.t <= .05 || c.t >= .95) return p; const nx = c.x - ball.x, ny = c.y - ball.y, l = Math.hypot(nx, ny); return l < .05 ? p : { x: clamp(ball.x + nx / l * 2.8, 1, L - 1), y: clamp(ball.y + ny / l * 2.8, 1, W - 1) }; };
    // Roles are picked once per possession and kept, so nobody swaps jobs (or leaves his player) mid-play.
    const key = def + ':' + (s.ball.carrier || 'loose');
    // (v66) Unless the one pressing has been beaten (the ball is past him, on its way to his goal): then the jobs are
    // picked afresh, so the nearest one left steps across to it and he picks up the player left free: nobody is left to
    // walk in on goal, and still only one goes to the ball.
    // (round 6) One who went in for the ball and missed is off balance (a.beat): nothing steers him until he has his
    // feet again. And nobody stands or jogs within a step and a half of the player on the ball: one who finds himself
    // there, with no play's script deciding it (this.challenge: outcomes.js finish does), goes in for it, and is beaten.
    const car = s.ball.carrier && s.a(s.ball.carrier), off = d => d.beat > s.time, free0 = free; free = d => free0(d) && !off(d);
    // (round 7: live play only; a lesson's scene plays as it was written)
    if (car && car.team !== def && !this.inFinish && !this.win && (this.mode === 'match' || this.mode === 'free')) for (const d of mine) if (free(d) && !d.gk && !this.leaving(d) && dist(d, car) < 1.5) {
      const dx = s.ball.x - d.x, dy = s.ball.y - d.y, l = Math.hypot(dx, dy) || 1; d.tk = s.time; d.beat = s.time + .9; d.mom = null; d.aic = null;
      s.go(d.id, clamp(s.ball.x + dx / l * 1.3, .5, L - .5), clamp(s.ball.y + dy / l * 1.3, .5, W - .5), 5); this.beatenId = d.id; if (this.roles) { this.roles = null; } this.wasBeaten = d.id; this.wasBeatenT = s.time; }
    let beaten = false;
    if (this.roles?.key === key && s.time - this.roles.t > .35) { const pid = Object.keys(this.roles.jobs).find(id => this.roles.jobs[id] === 'press'), pr = pid && s.a(pid); if (pr && free(pr) && dist(ball, goal) < dist(pr, goal) - .4 && dist(pr, ball) > 1.2) { this.roles = null; beaten = true; this.beatenId = pid; } }
    // (round 5) The one who was beaten does not give up: he turns and chases the ball for a moment (to challenge again
    // from behind or the side if he can catch it), then the jobs are picked afresh and he takes the player left free.
    if (this.roles?.key === key && this.roles.chase && s.time - this.roles.t > 1.6) this.roles = null;
    // (round 6: one who had no job when they were picked, off balance then, gets one now: the jobs are picked again)
    if (this.roles?.key === key && mine.some(d => free(d) && !d.gk && !(d.id in this.roles.jobs))) this.roles = null;
    if (this.roles?.key === key) { const kept = this.roles.jobs, R = this.roles; for (const id in kept) { const job = kept[id], d = s.a(id); if (!d || !free(d)) continue;
      if (job === 'chase') { this.aiGo(d, ball.x, ball.y, 4.5, true); continue; }
      const t = job === 'press' ? ball : job === 'cover' ? null : s.a(job);
      // The one on the ball: goal-side of it, a step off; stepping across to a ball that is past the first presser, he
      // goes to meet it on its way to goal; and with the ball within reach while its carrier runs at goal (this.challenge:
      // outcomes.js finish), he goes for the ball itself: a defender within reach always challenges, he never jogs alongside.
      const reach = false;
      const p0 = reach ? ball : t ? gs(t, job === 'press' ? (R.across ? Math.min(2.4, dist(d, ball) * .6) : Math.min(standOff(), Math.max(1, dist(d, ball)))) : R.across ? 2 : 1.1) : cover(), p = job === 'press' ? p0 : job === 'cover' ? off2(p0) : round(d, p0); // (never backing off to his stand-off: one already nearer holds where he is)
      this.aiGo(d, p.x, p.y, reach ? 4.4 : job === 'press' ? (R.across ? 4.6 : 3.6) : job === 'cover' ? 3.6 : p.now ? 4.4 : 3.8, job === 'press' || !!p.now); } return; }
    // (round 6) His own choice in a defending play comes first, and his friends take the other jobs (live.js teamJobs:
    // this.teamJob): if he goes to the ball nobody else does; if he guards, the friend nearest the ball goes.
    const tj = def === 'us' && this.sc?.kind === 'defense' ? this.teamJob : null;
    const jobs = {}; let covering = false; if (this.wasBeaten && (s.time - this.wasBeatenT > 2.5 || s.a(this.wasBeaten)?.team !== def || (tj && tj[this.wasBeaten]))) this.wasBeaten = null; // (the chase is for the moments after he was beaten, in that play)
    const was = (beaten && this.beatenId) || (this.wasBeaten && s.a(this.wasBeaten) && free(s.a(this.wasBeaten)) ? this.wasBeaten : null); if (was === this.wasBeaten) { this.wasBeaten = null; beaten = true; }
    const others = attackers.filter(a => a.id !== s.ball.carrier), taken = new Set();
    // A scripted player (the child, or one making a tackle) already counts: near the ball = pressing; near an attacker = guarding him.
    let pressing = mine.some(d => !free(d) && dist(d, ball) < 2.5) || !!(tj && tj.hero === 'press');
    for (const d of mine) if (!free(d) && !d.gk && !(tj && d.id === 'hero')) { const near = others.find(a => dist(a, d) < 2.5); if (near) taken.add(near.id); }
    if (tj && tj.hero !== 'press' && tj.hero) taken.add(tj.hero);
    if (tj) for (const d of mine) { const j = free(d) && tj[d.id]; if (!j) continue;
      if (j.job === 'press' && !pressing) { pressing = true; jobs[d.id] = 'press'; const p = gs(ball, Math.min(standOff(), Math.max(1, dist(d, ball)))); this.aiGo(d, p.x, p.y, 4.2, true); }
      else if (j.job !== 'press' && s.a(j.job) && !taken.has(j.job)) { taken.add(j.job); jobs[d.id] = j.job; const p = round(d, gs(s.a(j.job), 1.1)); this.aiGo(d, p.x, p.y, p.now ? 4.4 : 3.8, !!p.now); } }
    // (the ball is past the one who pressed: the nearest of those still between it and their goal goes to it)
    const side = d => (beaten && dist(d, goal) > dist(ball, goal) ? 100 : 0), freeMine = mine.filter(free).sort((p, q) => dist(p, ball) + side(p) - dist(q, ball) - side(q));
    for (const d of freeMine) {
      if (jobs[d.id]) continue;
      if (was && d.id === was) { jobs[d.id] = 'chase'; this.aiGo(d, ball.x, ball.y, 4.5, true); continue; }
      if (!pressing) { pressing = true; jobs[d.id] = 'press'; const p = gs(ball, Math.min(standOff(), Math.max(1, dist(d, ball)))); this.aiGo(d, p.x, p.y, 3.6, true); continue; }
      const mark = others.filter(a => !taken.has(a.id)).sort((p, q) => dist(p, d) - dist(q, d))[0];
      // (an attacker behind the ball is no danger yet: rather than stand by him, one defender covers the way to goal)
      const harmless = mark && dist(mark, goal) > dist(ball, goal) - 2.5;
      if (mark && (tj || !(harmless && !covering))) { taken.add(mark.id); jobs[d.id] = mark.id; const p = round(d, gs(mark, 1.1)); this.aiGo(d, p.x, p.y, p.now ? 4.4 : 3.8, !!p.now); }
      else { covering = true; jobs[d.id] = 'cover'; const p = off2(cover()); this.aiGo(d, p.x, p.y, 3.6); } // nobody (dangerous) left to guard: cover between the ball and the goal
    }
    this.roles = { key, jobs, t: s.time, across: beaten, chase: !!was }; // (across: the one stepping across to a ball that is past the first presser sprints to get in front of it)
  },
};
