// Team shape while the ball is live: who presses, covers and marks, and where the attackers without the ball run.
import { lerp, clamp, dist, closestOnLane } from '../geom.js';
import { L, W } from './shared.js';

export const team = {
  // Simple team shape while the ball is live: the nearest defender presses, the next covers
  // between the ball and goal, the last marks the most dangerous attacker. Attackers without
  // the ball run ahead into wide lanes to support. Scripted players (passer, shooter, tacklers) are left alone.
  teamAI() {
    const s = this.sim, b = s.ball, carrier = s.a(b.carrier);
    if (carrier) this.ballTeam = carrier.team;
    const atk = this.ballTeam, def = atk === 'us' ? 'them' : 'us';
    const goalX = def === 'them' ? L : 0, dir = atk === 'us' ? 1 : -1;
    const ball = b.state === 'flying' ? { x: b.tx, y: b.ty } : { x: b.x, y: b.y };
    const free = a => !this.scripted.has(a.id) && a.id !== b.carrier;
    const attackers = s.team(atk);
    if (def === 'us') { this.ourDefense(ball, attackers, free); }
    else {
    const defenders = s.team(def).filter(free).sort((p, q) => dist(p, ball) - dist(q, ball));
    defenders.forEach((d, i) => {
      if (i === 0) return s.go(d.id, ball.x + dir * 1.1, ball.y, 3.4); // stand goal-side, a step off the ball
      if (i === 1) return s.go(d.id, lerp(ball.x, goalX, .4), lerp(ball.y, W / 2, .5), 3.6);
      const danger = attackers.filter(a => a.id !== b.carrier).sort((p, q) => Math.abs(p.x - goalX) - Math.abs(q.x - goalX))[0] || ball;
      s.go(d.id, lerp(danger.x, goalX, .2), lerp(danger.y, W / 2, .2), 3.6);
    });
    }
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
    const spots = sup.map((a, i) => clearOf(i === 0 ? { x: clamp(fut.x + dir * 5, 2, L - 3), y: wide(side0) } : { x: clamp(fut.x - dir * 3, 2, L - 2), y: wide(-side0) }));
    if (spots.length === 2 && dist(spots[0], spots[1]) < 4) { spots[1].y = wide(spots[0].y > fut.y ? -1 : 1); clearOf(spots[1]); }
    sup.forEach((a, i) => s.go(a.id, spots[i].x, spots[i].y, i ? 3.4 : 3.8));
  },

  // Our team on defense does what the lessons teach: only one player (the closest) pressures the ball,
  // and everyone else guards an attacker, standing goal-side of him. Nobody leaves his player to chase.
  ourDefense(ball, attackers, free) {
    const s = this.sim, ours = s.team('us'), goal = { x: 0, y: W / 2 };
    const gs = (p, k) => { const dx = goal.x - p.x, dy = goal.y - p.y, l = Math.hypot(dx, dy) || 1; return { x: p.x + dx / l * k, y: p.y + dy / l * k }; };
    // Roles are picked once per possession and kept, so nobody swaps jobs (or leaves his player) mid-play.
    const key = s.ball.carrier || 'loose';
    if (this.roles?.key === key) { const kept = this.roles.jobs; for (const id in kept) { const job = kept[id], d = s.a(id); if (!free(d)) continue; const t = job === 'press' ? ball : s.a(job); const p = gs(t, job === 'press' ? 1 : 1.1); s.go(id, p.x, p.y, job === 'press' ? 3.6 : 3.8); } return; }
    const jobs = {};
    const others = attackers.filter(a => a.id !== s.ball.carrier), taken = new Set();
    // A scripted player (the child, or one making a tackle) already counts: near the ball = pressing; near an attacker = guarding him.
    let pressing = ours.some(d => !free(d) && dist(d, ball) < 2.5);
    for (const d of ours) if (!free(d)) { const near = others.find(a => dist(a, d) < 2.5); if (near) taken.add(near.id); }
    const freeOurs = ours.filter(free).sort((p, q) => dist(p, ball) - dist(q, ball));
    for (const d of freeOurs) {
      if (!pressing) { pressing = true; jobs[d.id] = 'press'; const p = gs(ball, 1); s.go(d.id, p.x, p.y, 3.6); continue; }
      const mark = others.filter(a => !taken.has(a.id)).sort((p, q) => dist(p, d) - dist(q, d))[0];
      if (mark) { taken.add(mark.id); jobs[d.id] = mark.id; const p = gs(mark, 1.1); s.go(d.id, p.x, p.y, 3.8); }
      else { const p = gs(ball, 4); s.go(d.id, p.x, p.y, 3.4); } // nobody left to guard: drop back and cover
    }
    this.roles = { key, jobs };
  },
};
