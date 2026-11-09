// Input: looking around, the PASS / DRIBBLE / SHOOT / STEAL buttons, taps on the pitch, and what can be tapped
// right now.
import { lerp, clamp, smooth, dribbleEnd, DRIBBLE_DIRS } from '../geom.js';
import { L, W, MATE, facesBall, wrap } from './shared.js';

const segDist = (x, y, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
};

export const input = {
  get canAct() { return this.phase === 'decide' && this.mode !== 'demo' && !this.showing; },
  get canLook() { return (this.phase === 'pre' || this.phase === 'decide') && this.mode !== 'demo' && !this.showing; },
  // LOOK is a toggle: head up to see the field, head down to watch the ball.
  toggleLook() { if (!this.canLook) return; this.lookUp = !this.lookUp; this.sfx(this.lookUp ? 'up' : 'down'); if (this.lookUp) this.scanned = true; },
  // Turning stays where he leaves it, so he can turn all the way around to find someone behind him.
  lookStart(x, width) { if (this.canLook && this.step !== 'dribble') { this.cancel(this.swing); this.drag = { x0: x, yaw0: this.yaw, w: width }; } },
  lookMove(x) {
    if (!this.drag) return;
    const dx = x - this.drag.x0;
    if (Math.abs(dx) > 12) { if (!this.lookUp) this.sfx('up'); this.lookUp = true; this.scanned = true; this.yaw = wrap(this.drag.yaw0 - dx / this.drag.w * 3.2); }
  },
  // On a receive, a peek is a quick glance: when he lets go, his head turns back to the ball. This is called for
  // every finger that lifts anywhere (button taps too), so it only acts when a drag on the field was under way.
  lookEnd() {
    if (!this.drag) return;
    this.drag = null;
    if (this.sc?.kind === 'receive' && this.phase === 'decide' && this.yaw0 != null) this.swingTo(this.yaw0);
  },
  // On a pass to him, he faces the passer, wherever he was looking before the kick, and the turn arrows go around
  // his body from there (yaw0). They used to follow the camera, so a look around before the pass left one arrow a
  // stub. The view swings back to the ball if he was looking away.
  facePasser() {
    const h = this.sim.a('hero'), c = this.sim.a(this.sc.carrier), f = h && c ? Math.atan2(c.y - h.y, c.x - h.x) : this.yaw;
    this.yaw0 = f; if (h) h.face = [Math.cos(f), Math.sin(f)];
    this.swingTo(f);
  },
  // Swings the view around to `to` in a third of a second. Only one swing runs at a time: a new one replaces it,
  // and a new drag or his choice stops it, so an old swing never pulls against his finger or the next play.
  swingTo(to) {
    this.cancel(this.swing); this.swing = null;
    const y0 = this.yaw, d = wrap(to - y0);
    if (Math.abs(d) <= .02) return;
    if (this.skipping) this.yaw = y0 + d; else this.swing = this.job(.35, t => { this.yaw = y0 + d * smooth(t); });
  },

  // Shooting is offered when he is close enough to goal to have a real chance.
  get canShoot() { const h = this.sim.a('hero'); return this.phase === 'decide' && !facesBall(this.sc) && !!h && h.x > L - (this.sc?.skill === 'shoot-close' ? 18 : 13); },
  shoot() { if (this.canAct && this.canShoot && !this.locked) this.choose('shoot'); },
  // The two turns as curved arrows around his feet: each starts just to one side of facing the ball and sweeps
  // around through that shoulder to the way the turn takes him (sc.turns). The facing is fixed for the round
  // (yaw0), so the arrows stay put while he peeks. The list is kept until the facing or the turns change, so
  // asking every frame builds nothing new.
  turnArcs() {
    const f = this.yaw0 ?? this.yaw, turns = this.sc.turns, kept = this.arcs;
    if (kept && kept.f === f && kept.turns === turns) return kept.out;
    const out = [];
    for (const [id, d] of Object.entries(turns || {})) {
      // His left is counterclockwise from where he faces (the pitch's y axis points to the left of +x).
      const to = DRIBBLE_DIRS[d], left = id === 'L', T = 2 * Math.PI, mod = v => ((v % T) + T) % T;
      const sweep = left ? mod(to - f) : -mod(f - to);
      out.push({ id, a0: f + (left ? .4 : -.4), a1: f + (left ? Math.max(1.4, sweep) : Math.min(-1.4, sweep)) }); // never a stub
    }
    this.arcs = { f, turns, out };
    return out;
  },
  // A tap up to a third of a second after the ball was loose still counts: that is about a child's reaction time.
  stealTap() {
    if (!this.canAct || this.sc?.kind !== 'tackle') return;
    const st = this.tackleState(), late = this.tk?.lastGood != null && this.sim.time - this.tk.lastGood < .35;
    if (late && st !== 'good') this.tk.graceTap = true; // steal right away, don't wait for the next loose touch
    this.choose('tackle:' + (late ? 'good' : st));
  },
  // PASS and DRIBBLE are always on screen; tapping one switches to it, tapping it again un-picks it.
  pass() {
    if (!this.canAct) return;
    this.pendingDir = null;
    if (this.step === 'pass') { this.step = null; return; }
    if (this.locked) return this.lookFirst();
    this.step = 'pass';
    if (!this.seen.size) this.hud.toast('Find a friend first! 👀', true);
  },
  dribble() { if (!this.canAct) return; if (this.locked) return this.lookFirst(); this.step = this.step === 'dribble' ? null : 'dribble'; this.pendingDir = null; },
  // After picking an arrow in the dribble lesson: keep it close, or knock it ahead and race for it.
  touch(kind) { if (!this.pendingDir) return; const d = this.pendingDir; this.pendingDir = null; this.choose((kind === 'big' ? 'push:' : 'drib:') + d); },
  // In the "Look up" lesson he has to look up before he can pass or dribble.
  get locked() { return this.mode === 'lesson' && this.sc?.skill === 'look-up' && !this.scanned; },
  lookFirst() { this.hud.toast('Look up first! 👀', true); },
  choose(opt) { if (this.canAct && this._choose) { const f = this._choose; this._choose = null; f(opt); } },
  // Returns true when the tap picked a pass target or dribble arrow.
  tap(x, y) {
    if (!this.canAct || !this.step) return false;
    // Players: near their body. Arrows: anywhere along the arrow.
    let best = null, bd = 64;
    const h = this.sim.a('hero');
    for (const t of this.targets()) {
      const q = this.world.project(t.x, t.y, t.z); if (!q) continue;
      let d = Math.hypot(q[0] - x, q[1] - y);
      if (this.step === 'dribble') {
        const p0 = this.world.project(lerp(h.x, t.x, .3), lerp(h.y, t.y, .3), 0);
        if (p0) d = Math.min(d, segDist(x, y, p0, q));
      }
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) return false;
    if (this.step === 'dribble' && this.pushAllowed) { this.pendingDir = best.opt.slice(5); return true; } // then: small touches or big push?
    this.choose(best.opt); return true;
  },
  targets() {
    const h = this.sim.a('hero');
    if (this.step === 'spot') return this.sc.spots.map(sp => ({ opt: 'spot:' + sp.id, x: sp.x, y: sp.y, z: 0 }));
    if (this.step === 'pass') return Object.entries(MATE).filter(([, id]) => this.seen.has(id)).map(([opt, id]) => ({ opt, ...this.sim.a(id), z: .8 }));
    if (this.step === 'dribble') return Object.keys(DRIBBLE_DIRS).map(d => { const e = dribbleEnd(h, d, L, W); return { opt: 'drib:' + d, x: lerp(h.x, e.x, .8), y: lerp(h.y, e.y, .8), z: 0 }; });
    if (this.step === 'turn') return this.turnArcs().flatMap(t => [t.a0 + (t.a1 - t.a0) * .5, t.a1].map(a => ({ opt: 'turn:' + t.id, x: h.x + Math.cos(a) * 1.35, y: h.y + Math.sin(a) * 1.35, z: 0 })));
    return [];
  },
};
