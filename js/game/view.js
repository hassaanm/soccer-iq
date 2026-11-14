// What each frame shows: the camera, the HUD state and prompt, the teaching hand, and the highlights in the 3D scene.
import { lerp, smooth, rot, clamp } from '../geom.js';
import { L, W, MATES, DIRS, NONE, facesBall, wrap } from './shared.js';

// Where the eye is seen from the point it looks at: the way round, how high (radians) and how far.
const orbit = (e, t) => { const x = e[0] - t[0], y = e[1] - t[1], z = e[2] - t[2], r = Math.hypot(x, y, z) || 1e-6; return [Math.atan2(y, x), Math.asin(clamp(z / r, -1, 1)), r]; };
// The head-down player view: back, to the side, height (m), target ahead of him (m) and how far toward the ball
// (part), target height, then focal lengths (see World.render). TURN_CAM: the same while choosing a turn.
const HEAD_DOWN = [3.1, 1.3, 2.9, 3.5, .25, .8, 1.05, .64], TURN_CAM = [4.6, .5, 5.2, 3, .2, .4, .68, .35];
// The skill camera (see game/skill.js): metres behind him, to the side, eye height, how far ahead of him it looks
// (with nobody to beat), how high, and the focal lengths. Low and close enough that his feet, the ball and the
// defender fill the picture, far enough that nobody fills the screen.
const SKILL_CAM = [2.7, 1.55, 1.6, 1, .7, .95, .5];

export const view = {
  // The canvas size in CSS pixels. Asking the DOM for it can force a layout, so it is asked at most twice a second.
  viewSize() {
    const v = this.view;
    if (!(Math.abs(this.clock - v.at) < .5)) { const cv = this.world.canvas; v.w = cv.clientWidth; v.h = cv.clientHeight; v.at = this.clock; }
    return v;
  },

  // The camera for picking a spot: it looks the way he faces (this.yaw, so a drag still turns it), from behind and
  // above, at the middle of him, the ball and the spots, and comes only as close as keeps every spot ring whole inside
  // the part of the screen nothing covers (under the prompt, clear of the button in the corner, in from the sides).
  // Tried from a steep look down to a flatter one, the nearest view that fits wins. Kept until the view's size, the
  // round or his facing changes.
  spotView() {
    const v = this.viewSize(), s = this.sim, h = s.a('hero'), sc = this.sc, yaw = Math.round(this.yaw * 50) / 50, key = `${v.w}x${v.h} ${yaw} ${sc.id} ${sc.spots.length}`;
    if (this.spotFit?.key === key) return this.spotFit.spec;
    const pts = [[h.x, h.y, .9], [h.x, h.y, 0], [s.ball.x, s.ball.y, 0]];
    for (const sp of sc.spots) for (let a = 0; a < 8; a++) pts.push([sp.x + Math.cos(a * Math.PI / 4) * .85, sp.y + Math.sin(a * Math.PI / 4) * .85, 0]); // the whole ring (and its pulse)
    let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length;
    // The free part of the screen: under the prompt, in from the edges, and not where LOOK UP / HEAD DOWN sits (bottom
    // left; nothing else shows while he picks a spot).
    const Ff = .9, Fw = .45, F = Math.max(v.h * Ff, v.w * Fw), x0 = v.w * .05, x1 = v.w * .95, y0 = 104, y1 = v.h - 16, bx = 160, by = v.h - 150;
    let fx, fy;
    const fits = (pitch, d) => { // camera d metres from the middle, looking down `pitch`, from over the pitch (not in the stands)
      const ex = cx - fx * Math.cos(pitch) * d, ey = cy - fy * Math.cos(pitch) * d, ez = Math.sin(pitch) * d;
      if (ex < -.2 || ex > L + .2 || ey < -.2 || ey > W + .2) return false;
      const fwd = [fx * Math.cos(pitch), fy * Math.cos(pitch), -Math.sin(pitch)], rt = [fy, -fx, 0], up = [rt[1] * fwd[2] - rt[2] * fwd[1], rt[2] * fwd[0] - rt[0] * fwd[2], rt[0] * fwd[1] - rt[1] * fwd[0]];
      for (const [px, py, pz] of pts) {
        const dx = px - ex, dy = py - ey, dz = pz - ez, z = dx * fwd[0] + dy * fwd[1] + dz * fwd[2]; if (z < .5) return false;
        const sx = v.w / 2 + F * (dx * rt[0] + dy * rt[1] + dz * rt[2]) / z, sy = v.h / 2 - F * (dx * up[0] + dy * up[1] + dz * up[2]) / z;
        if (sx < x0 || sx > x1 || sy < y0 || sy > y1 || (sx < bx && sy > by)) return false;
      }
      return true;
    };
    // The way he faces first; turned a little either way only if that lets it come nearer (or fit at all).
    let best = null;
    for (const off of [0, .35, -.35, .7, -.7, 1.05, -1.05, 1.4, -1.4]) {
      fx = Math.cos(yaw + off); fy = Math.sin(yaw + off);
      for (let pitch = .55; pitch <= 1.31; pitch += .095) for (let d = 7; d <= 30; d += .5) if (fits(pitch, d)) { const cost = d + 4 * Math.abs(off); if (!best || cost < best.cost) best = { pitch, d, off, cost }; break; }
    }
    const { pitch, d, off } = best || { pitch: 1.35, d: 22, off: 0 }; fx = Math.cos(yaw + off); fy = Math.sin(yaw + off);
    const ex = cx - fx * Math.cos(pitch) * d, ey = cy - fy * Math.cos(pitch) * d;
    this.spotFit = { key, spec: { eye: [ex, ey, Math.sin(pitch) * d], tgt: [cx, cy, 0], Ff, Fw } };
    return this.spotFit.spec;
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
    // Choosing where to run (or pass to a running friend): every spot whole on screen, clear of the buttons (see spotView).
    if (this.step === 'spot' && this.phase === 'decide' && this.sc?.spots?.length) return this.spotView();
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
    // Choosing a turn as the pass comes (head down): a little higher and farther back, so both curved arrows round
    // his feet, the ball and the passer are all on screen. Head up is the same as everywhere.
    const C = this.step === 'turn' && this.phase === 'decide' ? TURN_CAM : HEAD_DOWN;
    const [bx, by] = rot(-lerp(C[0], 5.2, k), lerp(C[1], .3, k), this.yaw), [fx, fy] = rot(9, 0, this.yaw);
    // On attack, head down looks at the ball at his feet. On defense the ball is away from him, so head down
    // looks a few meters ahead of him toward the ball, keeping him in view.
    // Dribbling, the ball surges out and back at every touch: head down looks at a steady point just ahead of his
    // feet instead, so the picture doesn't shake with each touch (the camera's own easing covers the switch).
    let dx = b.x, dy = b.y;
    if (b.state === 'carried' && b.carrier === 'hero' && !b.move) { const [ax, ay] = rot(.45, 0, this.yaw); dx = h.x + ax; dy = h.y + ay; }
    if (facesBall(this.sc)) { const [ax, ay] = rot(C[3], 0, this.yaw); dx = lerp(h.x + ax, b.x, C[4]); dy = lerp(h.y + ay, b.y, C[4]); }
    return { eye: [h.x + bx, h.y + by, lerp(C[2], 2.8, k)], tgt: [lerp(dx, h.x + fx, k), lerp(dy, h.y + fy, k), lerp(C[5], .5, k)], Ff: lerp(C[6], .9, k), Fw: lerp(C[7], .52, k) };
  },
  updateCamera(dt, time) {
    const f = this.follow, b = this.sim.ball;
    if (this.camMode === 'follow' && f) {
      const k = 1 - Math.exp(-dt * 2.2), ahead = f.yaw > 1.5 ? -2 : 2;
      f.x = lerp(f.x, b.x + ahead, k); f.y = lerp(f.y, lerp(b.y, W / 2, .4), k);
      f.yaw += (f.yawT - f.yaw) * (1 - Math.exp(-dt * 1.4));
    }
    let want = this.camSpec(time);
    // In a skill moment the view comes round to the skill camera and back on the same orbit, eased (no cut), and
    // follows it closely meanwhile.
    const sw = smooth(this.skCam || 0); if (sw > 0) want = this.skillView(want, sw, dt);
    if (!this.cam) { this.cam = { eye: [...want.eye], tgt: [...want.tgt], Ff: want.Ff, Fw: want.Fw }; return; }
    // While play waits for him to tap for a turn, the camera stays where it is (it comes in only if he taps).
    if (this.sk?.kind === 'turn' && this.sk.phase === 'offer') { this.camT0 = this.clock; return; }
    if (this.camMode !== this.camWas) { this.camWas = this.camMode; this.camT0 = this.clock; }
    if (this.glide > 0) this.glide -= dt;
    // (When the camera sets off for a new view, or for the skill camera, its speed builds up over a moment, so it never
    // starts with a jerk.)
    const k = 1 - Math.exp(-dt * lerp(this.glide > 0 ? 2.6 : this.camMode === 'player' ? 12 : 4, 12, sw) * smooth((this.clock - Math.max(this.skView?.t0 ?? -9, this.camT0 ?? -9)) / .35)), c = this.cam;
    // The point looked at slides over; the eye goes round it (way round, how high, how far), so on the way from
    // one view to another the camera always looks at the play. Sliding the eye and the point each on its own
    // straight line made them cross when the new view looks the other way (behind him facing the passer, to the
    // chase camera up the field): for a few frames it looked straight down at the grass or at a defender.
    const o0 = orbit(c.eye, c.tgt), o1 = orbit(want.eye, want.tgt);
    for (let i = 0; i < 3; i++) c.tgt[i] = lerp(c.tgt[i], want.tgt[i], k);
    const yaw = o0[0] + wrap(o1[0] - o0[0]) * k, pitch = lerp(o0[1], o1[1], k), r = lerp(o0[2], o1[2], k);
    c.eye[0] = c.tgt[0] + Math.cos(yaw) * Math.cos(pitch) * r; c.eye[1] = c.tgt[1] + Math.sin(yaw) * Math.cos(pitch) * r; c.eye[2] = c.tgt[2] + Math.sin(pitch) * r;
    c.Ff = lerp(c.Ff, want.Ff, k); c.Fw = lerp(c.Fw ?? want.Fw, want.Fw, k);
  },
  // The skill camera starts: which way it looks (his run), from which side, and at whom (the nearest defender, if one
  // is close).
  skillCamStart() {
    const s = this.sim, h = s.a('hero'), b = s.ball, c = this.cam; if (!h) return;
    const y = b.move ? b.move.a0 : b.h, cy = Math.cos(y), sy = Math.sin(y), C = SKILL_CAM;
    let foe = null, fd = 7; for (const o of s.team('them')) { const d = Math.hypot(o.x - h.x, o.y - h.y); if (d < fd) { fd = d; foe = o; } }
    // Where everyone else will be in a moment (on the way to where he is going), and how crowded the eye's place and
    // its way there would be on one side: nobody may come close to the eye, or he would fill the screen.
    const soon = a => { const dx = a.tx - a.x, dy = a.ty - a.y, l = Math.hypot(dx, dy), k = Math.min(l, a.sp * .7) / (l || 1); return [a.x + dx * k, a.y + dy * k]; };
    const others = s.list.filter(a => a !== h).flatMap(a => [[a.x, a.y], soon(a)]);
    const crowd = sd => { const ex = h.x - cy * C[0] - sd * sy * C[1], ey = h.y - sy * C[0] + sd * cy * C[1], pts = c ? [[ex, ey], [(ex + c.eye[0]) / 2, (ey + c.eye[1]) / 2]] : [[ex, ey]];
      let k = 0; for (const [ax, ay] of others) for (const [x, y] of pts) k += Math.max(0, 3.2 - Math.hypot(ax - x, ay - y)); return k; };
    // A turn: the side he turns to (the ball comes across in front of the camera, not behind his body). Else the side
    // away from the nearest defender (so it looks past him at the defender), else the side the camera is on already
    // (so it swings the short way). Unless that side is the more crowded one.
    const fl = foe ? cy * (foe.y - h.y) - sy * (foe.x - h.x) : 0, tw = this.sk?.kind === 'turn' ? Math.atan2(Math.sin(Math.atan2(h.ty - h.y, h.tx - h.x) - y), Math.cos(Math.atan2(h.ty - h.y, h.tx - h.x) - y)) : 0;
    let side = Math.abs(tw) > .3 ? Math.sign(tw) : Math.abs(fl) > .3 ? -Math.sign(fl) : c ? Math.sign(cy * (c.eye[1] - h.y) - sy * (c.eye[0] - h.x)) || 1 : 1;
    if (crowd(side) > crowd(-side) + .3) side = -side;
    this.skView = { yaw: y, side, foe: foe?.id, t0: this.clock };
    // How long the camera takes to come in: half a second, longer from farther away (so it never rushes: about 0.4 m a
    // frame at most), up to 1.1 s.
    const ex = h.x - cy * C[0] - side * sy * C[1], ey = h.y - sy * C[0] + side * cy * C[1];
    this.skIn = c ? Math.min(1.1, Math.max(.5, Math.hypot(c.eye[0] - ex, c.eye[1] - ey, c.eye[2] - C[2]) / 10)) : .5;
  },
  // The view mixed `w` of the way toward the skill camera: the point looked at slides, the eye goes round it.
  skillView(want, w, dt) {
    const s = this.sim, h = s.a('hero'), b = s.ball, v = this.skView; if (!h || !v) return want;
    // It turns with his run slowly (in a turn, only part of the way), so a big turn never swings the picture round.
    const to = b.carrier === 'hero' ? (b.move ? b.move.a0 + b.move.d * .35 : b.h) : v.yaw; v.yaw += wrap(to - v.yaw) * (1 - Math.exp(-dt * 1.5));
    // It looks just ahead of him, a little toward a defender in front of him (so both are in the picture).
    const C = SKILL_CAM, [ex, ey] = rot(-C[0], v.side * C[1], v.yaw), cy = Math.cos(v.yaw), sy = Math.sin(v.yaw), o = v.foe && s.a(v.foe);
    let tx = h.x + cy * C[3], ty = h.y + sy * C[3];
    if (o) { const f = (o.x - h.x) * cy + (o.y - h.y) * sy, l = (o.y - h.y) * cy - (o.x - h.x) * sy, k = .3 * smooth(f / 1.5) * (1 - smooth((Math.hypot(f, l) - 6) / 2)); tx += (o.x - tx) * k; ty += (o.y - ty) * k; }
    const o0 = orbit(want.eye, want.tgt), o1 = orbit([h.x + ex, h.y + ey, C[2]], [tx, ty, C[4]]);
    const tgt = [lerp(want.tgt[0], tx, w), lerp(want.tgt[1], ty, w), lerp(want.tgt[2], C[4], w)];
    const yaw = o0[0] + wrap(o1[0] - o0[0]) * w, pitch = lerp(o0[1], o1[1], w), r = lerp(o0[2], o1[2], w);
    const eye = [tgt[0] + Math.cos(yaw) * Math.cos(pitch) * r, tgt[1] + Math.sin(yaw) * Math.cos(pitch) * r, tgt[2] + Math.sin(pitch) * r];
    // Someone else running close by the eye: it rises over him (smoothly, as he comes), so he never fills the screen.
    let lift = 0; for (const a of s.list) if (a !== h) lift = Math.max(lift, 2.6 - Math.hypot(a.x - eye[0], a.y - eye[1]));
    eye[2] += 1.1 * lift * w;
    return { eye, tgt, Ff: lerp(want.Ff, C[5], w), Fw: lerp(want.Fw ?? C[6], C[6], w) };
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
    ui.lines = deciding && this.sc?.kind === 'lead' ? this.runArrow() : this.lines; ui.heroRing = this.camMode === 'player' || (this.phase === 'feedback' && !!this.markHero);
    ui.ballGlow = this.sc?.kind === 'tackle' && ((this.step === 'tackle' && this.hint) || (this.phase === 'outcome' && !this.result)) && this.tackleState() === 'good';
  },
};
