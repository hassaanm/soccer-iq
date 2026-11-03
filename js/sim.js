// Tiny match simulation: players walk toward targets, the ball is carried or flying,
// and outcomes run as generator scripts that yield seconds or "wait until" predicates.
import { lerp } from './geom.js';

export const SPACE = .75; // meters between two players' centers
const TURN = 9;            // radians per second a player can turn
// Turn a player's facing toward (fx, fy) at a limited speed, so direction changes look like real turns.
function turnToward(a, fx, fy, dt) {
  const cur = Math.atan2(a.face[1], a.face[0]), want = Math.atan2(fy, fx);
  const d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur)), step = Math.max(-TURN * dt, Math.min(TURN * dt, d));
  a.face = [Math.cos(cur + step), Math.sin(cur + step)];
}

export class Sim {
  constructor() { this.agents = new Map(); this.ball = {}; this.co = null; this.time = 0; this.on = () => {}; } // on(event, data): 'kick', 'touch', 'step'

  // Builds players for a scenario. Ids: hero, m1, m2 (our team), o1..o3 (them).
  setup(sc) {
    this.agents.clear();
    const add = (id, team, [x, y]) => this.agents.set(id, { id, team, x, y, tx: x, ty: y, speed: 0, sp: 0, dist: 0, kickAt: null, face: [team === 'us' ? 1 : -1, 0] });
    add('hero', 'us', sc.hero);
    sc.mates.forEach((p, i) => add('m' + (i + 1), 'us', p));
    sc.opps.forEach((p, i) => add('o' + (i + 1), 'them', p));
    const c = this.a(sc.carrier || 'hero'); // in defense lessons the other team starts with the ball
    this.ball = { x: c.x + c.face[0] * .5, y: c.y, z: 0, state: 'carried', carrier: c.id };
    this.co = null; this.wait = 0; this.until = null;
  }

  // Snapshot / restore so a play can be replayed from the decision moment.
  save() { return { agents: [...this.agents.values()].map(a => ({ ...a, face: [...a.face] })), ball: { ...this.ball } }; }
  restore(s) {
    this.agents.clear();
    for (const a of s.agents) this.agents.set(a.id, { ...a, face: [...a.face], tx: a.x, ty: a.y, speed: 0, sp: 0 });
    this.ball = { ...s.ball }; this.co = null; this.wait = 0; this.until = null;
  }

  a(id) { return this.agents.get(id); }
  team(t) { return [...this.agents.values()].filter(a => a.team === t); }
  go(id, x, y, speed = 4) { const a = this.a(id); a.tx = x; a.ty = y; a.speed = speed; }
  stop(id) { const a = this.a(id); a.tx = a.x; a.ty = a.y; }
  stopAll() { for (const a of this.agents.values()) { a.tx = a.x; a.ty = a.y; } }
  give(id) { Object.assign(this.ball, { state: 'carried', carrier: id, z: 0 }); }
  // Starts the kick animation; call it a moment before kick() so the foot meets the ball.
  windup(id) { const a = this.a(id); if (a) a.kickAt = this.time; }
  kick(x, y, { speed = 11, arc = 0.3, z1 = 0 } = {}) {
    const b = this.ball;
    this.on('kick', speed);
    Object.assign(b, { state: 'flying', carrier: null, fx: b.x, fy: b.y, tx: x, ty: y, t: 0, arc, z1,
      dur: Math.max(0.25, Math.hypot(x - b.x, y - b.y) / speed) });
  }
  run(gen) { this.co = gen; this.wait = 0; this.until = null; }

  step(dt) {
    this.time += dt;
    for (const a of this.agents.values()) {
      const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
      if (d > 0.02 && a.speed > 0) {
        const s = Math.min(a.speed * dt, d);
        const before = a.dist; a.x += dx / d * s; a.y += dy / d * s; turnToward(a, dx / d, dy / d, dt); a.dist += s;
        if (a.id === 'hero' && Math.floor(a.dist / .7) > Math.floor(before / .7)) this.on('step');
        if (this.ball.carrier === a.id && Math.floor(a.dist / 1.4) > Math.floor(before / 1.4)) this.on('touch');
        a.sp = lerp(a.sp, a.speed, Math.min(1, dt * 8));
      } else a.sp = lerp(a.sp, 0, Math.min(1, dt * 8));
    }
    // Bodies take up space: nudge apart any two players closer than SPACE so nobody walks through anyone.
    const list = [...this.agents.values()];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const p = list[i], q = list[j], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
      if (d < SPACE && d > 1e-6) { const push = (SPACE - d) / 2; p.x -= dx / d * push; p.y -= dy / d * push; q.x += dx / d * push; q.y += dy / d * push; }
    }
    const b = this.ball;
    if (b.state === 'carried') {
      // Dribbling: each touch (every 1.4 m, matching world.js) pushes the ball ahead, then the player
      // catches up. Touches cycle laces / inside / outside, nudging the ball sideways a little.
      const c = this.a(b.carrier), run = Math.min(1, c.sp / 2.5), k = (c.dist % 1.4) / 1.4, kind = Math.floor(c.dist / 1.4) % 3;
      const ahead = .34 + run * .55 * (1 - k), side = run * [0, .14, -.14][kind] * (1 - k);
      // The ball rolls toward its spot at his feet instead of jumping there when he turns or takes it over.
      const wx = c.x + c.face[0] * ahead - c.face[1] * side, wy = c.y + c.face[1] * ahead + c.face[0] * side, roll = Math.min(1, dt * 14);
      b.x += (wx - b.x) * roll; b.y += (wy - b.y) * roll; b.z = 0;
    } else if (b.state === 'flying') {
      b.t += dt / b.dur;
      const u = Math.min(1, b.t), e = 1 - Math.pow(1 - u, 1.5);
      b.x = lerp(b.fx, b.tx, e); b.y = lerp(b.fy, b.ty, e); b.z = b.arc * 4 * u * (1 - u) + b.z1 * u;
      if (u >= 1) b.state = 'loose';
    }
    // Players standing still turn to watch the ball.
    for (const a of this.agents.values()) {
      if (a.sp < 0.3 && b.carrier !== a.id) {
        const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
        if (l > 0.3) turnToward(a, dx / l, dy / l, dt);
      }
    }
    if (!this.co) return;
    if (this.wait > 0) { this.wait -= dt; return; }
    if (this.until && !this.until()) return;
    this.until = null;
    const r = this.co.next();
    if (r.done) this.co = null;
    else if (typeof r.value === 'number') this.wait = r.value;
    else if (typeof r.value === 'function') this.until = r.value;
  }
}
