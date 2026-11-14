// What each frame shows: the camera, the HUD state and prompt, the teaching hand, and the highlights in the 3D scene.
import { lerp, smooth, rot, clamp } from '../geom.js';
import { L, W, MATES, DIRS, NONE, facesBall } from './shared.js';

export const view = {
  // The canvas size in CSS pixels. Asking the DOM for it can force a layout, so it is asked at most twice a second.
  viewSize() {
    const v = this.view;
    if (!(Math.abs(this.clock - v.at) < .5)) { const cv = this.world.canvas; v.w = cv.clientWidth; v.h = cv.clientHeight; v.at = this.clock; }
    return v;
  },

  camSpec(time) {
    const s = this.sim, h = s.a('hero'), b = s.ball;
    if (this.camMode === 'orbit') { const a = time * .08; return { eye: [L / 2 + Math.cos(a) * 24, W / 2 + Math.sin(a) * 24, 10], tgt: [L / 2, W / 2, 0], Ff: .9, Fw: .4 }; }
    if (this.camMode === 'overview') {
      const p = this.aimAt || h, mx = (h.x + p.x) / 2, my = (h.y + p.y) / 2;
      return { eye: [mx - 8, my, 9], tgt: [mx + 1.5, my, 0], Ff: .85, Fw: .42 };
    }
    if (this.camMode === 'follow') {
      // Our goal, as on TV: the net first, then the camera swings round to the scorer (our player nearest the
      // ball when it went in), low and in front of him so his cheer and face show, and drifts slowly round.
      const m = this.world.mood;
      if (m?.team === 'us' && m.t > .6) {
        if (this.celeb?.m !== m) { let id = 'hero', d = 1e9; for (const p of s.team('us')) { const k = Math.hypot(p.x - b.x, p.y - b.y); if (k < d) { d = k; id = p.id; } } this.celeb = { m, id }; }
        const p = s.a(this.celeb.id) || h;
        if (p) {
          const at = a => [p.x + Math.cos(a) * 4.4, p.y + Math.sin(a) * 4.4], on = ([x, y]) => x > .5 && x < L - .5 && y > .5 && y < W - .5, turn = .45 + (m.t - .6) * .1;
          let a = (p.face ? Math.atan2(p.face[1], p.face[0]) : 0) + turn; if (!on(at(a))) a = Math.atan2(W / 2 - p.y, L / 2 - p.x) + turn; // too near a line: look from the middle of the pitch instead
          return { eye: [clamp(at(a)[0], .5, L - .5), clamp(at(a)[1], .5, W - .5), 1.55], tgt: [p.x, p.y, 1.05], Ff: 1.25, Fw: .5 };
        }
      }
      // A calm chase camera: it trails a smoothed point near the ball and only turns around
      // (slowly) when the other team has the ball, so kicks and passes never make it jump.
      const f = this.follow;
      const c = s.a(b.carrier); if (c) f.yawT = c.team === 'them' ? Math.PI : 0;
      return { eye: [f.x - Math.cos(f.yaw) * 7, f.y - Math.sin(f.yaw) * 7, 4.2], tgt: [f.x + Math.cos(f.yaw) * 4, f.y + Math.sin(f.yaw) * 4, .3], Ff: .9, Fw: .46 };
    }
    // Choosing a dribble: raise the camera so all four arrows are on screen.
    if (this.step === 'dribble' && this.phase === 'decide') return { eye: [h.x - 8, h.y, 9], tgt: [h.x, h.y, 0], Ff: .95, Fw: .5 };
    // 1v1: a bit higher and farther back, aimed between him and the ball, so the ball and the attacker's feet
    // are always in view (seeing the touch is the whole lesson).
    if (this.sc?.kind === 'tackle') {
      const [bx, by] = rot(-4.2, 2, this.yaw); // over his shoulder, so his body never hides a ball rolling at him
      return { eye: [h.x + bx, h.y + by, 4.2], tgt: [lerp(h.x, b.x, .75), lerp(h.y, b.y, .75), 0], Ff: 1.02, Fw: .56 };
    }
    // Player view, behind him in the direction he's turned. Head down: close and aimed just above the ball, so the
    // prompt at the top of a phone screen does not cover his head.
    // Head up: just above head height, looking out across the field.
    const k = smooth(this.look);
    const [bx, by] = rot(-lerp(3.1, 5.2, k), lerp(1.3, .3, k), this.yaw), [fx, fy] = rot(9, 0, this.yaw);
    // On attack, head down looks at the ball at his feet. On defense the ball is away from him, so head down
    // looks a few meters ahead of him toward the ball, keeping him in view.
    let dx = b.x, dy = b.y;
    if (facesBall(this.sc)) { const [ax, ay] = rot(3.5, 0, this.yaw); dx = lerp(h.x + ax, b.x, .25); dy = lerp(h.y + ay, b.y, .25); }
    return { eye: [h.x + bx, h.y + by, lerp(2.9, 2.8, k)], tgt: [lerp(dx, h.x + fx, k), lerp(dy, h.y + fy, k), lerp(.8, .5, k)], Ff: lerp(1.05, .9, k), Fw: lerp(.64, .52, k) };
  },
  updateCamera(dt, time) {
    const f = this.follow, b = this.sim.ball;
    if (this.camMode === 'follow' && f) {
      const k = 1 - Math.exp(-dt * 2.2), ahead = f.yaw > 1.5 ? -2 : 2;
      f.x = lerp(f.x, b.x + ahead, k); f.y = lerp(f.y, lerp(b.y, W / 2, .4), k);
      f.yaw += (f.yawT - f.yaw) * (1 - Math.exp(-dt * 1.4));
    }
    const want = this.camSpec(time);
    if (!this.cam) { this.cam = { eye: [...want.eye], tgt: [...want.tgt], Ff: want.Ff, Fw: want.Fw }; return; }
    if (this.glide > 0) this.glide -= dt;
    const k = 1 - Math.exp(-dt * (this.glide > 0 ? 2.6 : this.camMode === 'player' ? 12 : 4));
    for (let i = 0; i < 3; i++) { this.cam.eye[i] = lerp(this.cam.eye[i], want.eye[i], k); this.cam.tgt[i] = lerp(this.cam.tgt[i], want.tgt[i], k); }
    this.cam.Ff = lerp(this.cam.Ff, want.Ff, k); this.cam.Fw = lerp(this.cam.Fw ?? want.Fw, want.Fw, k);
  },
  // Passing to a running friend: a white arrow on the grass in front of him shows which way he is running. Kept
  // per round, so the scene only builds it once.
  runArrow() {
    const sc = this.sc, m = this.sim.a('m1'), [dx, dy] = sc.dir;
    if (this.arrow?.sc !== sc) this.arrow = { sc, lines: [{ a: { x: m.x + dx * .6, y: m.y + dy * .6 }, b: { x: m.x + dx * 3.2, y: m.y + dy * 3.2 }, color: '#ffffff' }] };
    return this.arrow.lines;
  },
  updateHud() {
    const hud = this.hud, s = this.sim;
    let prompt = '';
    if ((this.mode === 'lesson' || this.mode === 'match' || this.mode === 'free') && !this.showing) {
      if (this.phase === 'pre') prompt = this.lookUp || this.sc?.kind === 'tackle' || this.sc?.kind === 'receive' ? '' : 'Tap 👀 to look up';
      else if (this.phase === 'decide') prompt =
        this.step === 'tackle' ? 'Wait… steal it when it rolls away!' :
        this.step === 'turn' ? (this.peeked ? 'Tap the arrow for your turn' : 'Ball coming! Drag to peek, then tap a turn arrow') :
        this.step === 'spot' && this.sc?.kind === 'lead' ? (this.lookUp ? 'Tap where to pass' : 'Tap 👀 to look up') :
        this.step === 'spot' ? (this.lookUp ? 'Tap where to run' : 'Watch the ball… tap 👀 to look up') :
        this.pendingDir ? 'Small touches or big push?' :
        this.step === 'pass' ? (this.seen.size ? 'Tap a friend you found' : 'Drag to look for a friend') :
        this.step === 'dribble' ? 'Tap an arrow' :
        this.seen.size ? 'Pass or dribble?' : this.lookUp ? 'Drag to look around' : 'Tap 👀 to look up';
    }
    // The only nudge: if he hasn't looked up after a while, pulse LOOK. Never point at the answer.
    const nudge = this.canAct && !this.lookUp && (this.locked || (!this.seen.size && s.time - this.decideAt > 5)) ? 'look' : null;
    hud.state({ phase: this.phase, step: this.step, mode: this.mode, prompt, nudge, lookUp: this.lookUp, look: this.look, locked: this.locked, kind: this.sc?.kind || 'attack', touchPick: !!this.pendingDir, canShoot: (this.canAct || this.showing) && this.canShoot, showing: !!this.showing });
    // The teaching hand follows its target (a spot on the field moves on screen as the camera moves). The HUD
    // hears about it only when the hand shows, hides, moves or taps.
    const at = this.handAt, last = this.handLast, tap = at ? this.handTap : null;
    let id = null, x = null, y = null;
    if (typeof at === 'string') id = at;
    else if (at?.sx != null) { const v = this.viewSize(); x = at.sx * v.w; y = at.sy * v.h; }
    else if (at) { const q = this.world.project(at.x, at.y, at.z ?? 0); if (q) [x, y] = q; }
    if (last.on !== !!at || last.id !== id || last.x !== x || last.y !== y || last.tap !== tap) {
      Object.assign(last, { on: !!at, id, x, y, tap });
      hud.hand(id ?? (x == null ? null : [x, y]), this.handTap);
    }
    const ui = this.ui, deciding = this.phase === 'decide';
    for (const m of MATES) ui.glow[m] = deciding && this.step === 'pass' && this.seen.has(m) ? .8 : 0;
    for (const d of DIRS) ui.arrows[d] = !deciding || this.step !== 'dribble' ? 0 : !this.pendingDir || this.pendingDir === d ? 1 : .3;
    ui.spots = deciding && this.step === 'spot' ? this.sc.spots : NONE;
    ui.turnArrows = deciding && this.step === 'turn' ? this.turnArcs() : NONE;
    ui.lines = deciding && this.sc?.kind === 'lead' ? this.runArrow() : this.lines; ui.heroRing = this.camMode === 'player';
    ui.ballGlow = this.sc?.kind === 'tackle' && ((this.step === 'tackle' && this.hint) || (this.phase === 'outcome' && !this.result)) && this.tackleState() === 'good';
  },
};
