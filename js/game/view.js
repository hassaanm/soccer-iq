// What each frame shows: the camera, the HUD state and prompt, the teaching hand, and the highlights in the 3D scene.
import { lerp, smooth, rot, clamp, closestOnLane } from '../geom.js';
import { L, W, gy0, gy1, MATES, DIRS, NONE, facesBall, wrap } from './shared.js';
import { spaces } from '../shot.js';

// Where the eye is seen from the point it looks at: the way round, how high (radians) and how far.
const orbit = (e, t) => { const x = e[0] - t[0], y = e[1] - t[1], z = e[2] - t[2], r = Math.hypot(x, y, z) || 1e-6; return [Math.atan2(y, x), Math.asin(clamp(z / r, -1, 1)), r]; };
// The head-down player view: back, to the side, height (m), target ahead of him (m) and how far toward the ball
// (part), target height, then focal lengths (see World.render). TURN_CAM: the same while choosing a turn.
const HEAD_DOWN = [3.1, 1.3, 2.9, 3.5, .25, .8, 1.05, .64], TURN_CAM = [4.6, .5, 5.2, 3, .2, .4, .68, .35];
// The skill camera (see game/skill.js): metres behind him, to the side, eye height, how far ahead of him it looks
// (with nobody to beat), how high, and the focal lengths. Low and close enough that his feet, the ball and the
// defender fill the picture, far enough that nobody fills the screen.
const SKILL_CAM = [2.7, 1.55, 1.6, 1, .7, .95, .5];
// The spot camera for runs to the goal and after a shot: a ring far from the eye is drawn up to RING_GROW times bigger
// and one near it down to RING_SHRINK times, and the view is only taken if that leaves no ring more than RING_RATIO
// times bigger on screen than another.
const RING_GROW = 2.2, RING_SHRINK = .72, RING_RATIO = 1.4, RING_RATIO_MAX = 1.8;
// His own player in those views is this tall on screen, as a share of the focal length (about 76 px of 380 on a phone
// held sideways; if that cannot be had, a little less), so a child finds him at once (v60).
const HERO_MIN = .2;
// The "stay here" badge (v60): how high over the ground it floats over him, in meters (see World).
const STAY_Z = 1.62;
const BACK_SCALE = [2];
// The aim view (v64, see aimView): how far behind him the camera is (m), the lens (px per metre at the goal, as a share of
// the screen's height, is AIM_K / (his distance from the goal + AIM_B), never under AIM_MIN), and where the goal's middle
// sits (share of the height from the top, and of the width).
const AIM_B = 12, AIM_K = 3.9, AIM_MIN = .15, AIM_GOAL_Y = .455, AIM_GOAL_X = .46;

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
    const v = this.viewSize(), s = this.sim, h = s.a('hero'), sc = this.sc, yaw = Math.round(this.yaw * 50) / 50, win = this.win, key = `${v.w}x${v.h} ${yaw} ${sc.id} ${sc.spots.length} ${win ? Math.round(win.t0 * 1e3) : 0}`;
    if (this.spotFit?.key === key) return this.spotFit.spec;
    const pts = [[h.x, h.y, .9], [h.x, h.y, 0], [s.ball.x, s.ball.y, 0]];
    // (v64) Play goes on while he chooses: the view takes in where he and the rings will be as the window ends too, so it
    // never has to move to keep them in (one fit for the whole window).
    // (Only what moves a metre or more: the rest is in the picture already, and every extra point costs his size.)
    const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) >= 1, end = win ? (this.spotsEnd() || []).filter((e, i) => far(e, sc.spots[i])) : null;
    if (win) { const e = this.windowEnd('hero'); if (far(e, h)) pts.push([e.x, e.y, .9], [e.x, e.y, 0]); }
    { const t = win?.threat && s.a(win.threat.id); if (t && sc.kind !== 'receive' && sc.kind !== 'defense') pts.push([t.x, t.y, 0], [t.x, t.y, 1.5]); } // (round 2: the threat in the picture as he comes)
    if (win && sc.run === 'follow' && sc.shot) pts.push([sc.shot.hit[0], sc.shot.hit[1], 0], [sc.shot.loose[0], sc.shot.loose[1], 0]); // (round 2: it opens as he shoots: where it hits, and where it comes out to)
    // Runs to the goal, after a shot, and getting open (`even`): the friend with the ball and their nearest players are in
    // the picture too, and (running to the goal) the goal, clear of the prompt. A ring far from the eye is drawn bigger
    // and one near it smaller (World: ui.spotScale), so the nearest ring is not the biggest thing on screen. And his own
    // player is big enough to find (v60): that comes first. If it cannot all be had, the view gives up first the far
    // post (the near post and the goal mouth's middle stay), then a little on the ring sizes, then the goal.
    const even = !!(sc.run || sc.even), stay = this.stayOffered();
    const rings = [...sc.spots, ...(end || [])];
    if (!even) for (const sp of rings) for (let a = 0; a < 8; a++) pts.push([sp.x + Math.cos(a * Math.PI / 4) * .85, sp.y + Math.sin(a * Math.PI / 4) * .85, 0]); // the whole ring (and its pulse)
    else for (const sp of rings) pts.push([sp.x, sp.y, 0]);
    let scales = null;
    const goalAll = [], goalNear = [];
    if (even) {
      const c = s.a(sc.carrier), near = s.team('them').filter(p => Math.hypot(p.x - s.ball.x, p.y - s.ball.y) < 10).sort((p, q) => Math.hypot(p.x - s.ball.x, p.y - s.ball.y) - Math.hypot(q.x - s.ball.x, q.y - s.ball.y)).slice(0, sc.run ? 1 : 2); // (v64: not their players far off, as at a goal kick)
      for (const a of [c, ...near]) if (a && a.id !== 'hero') { pts.push([a.x, a.y, 0], [a.x, a.y, 1.5]); if (win) { const e = this.windowEnd(a.id); if (far(e, a)) pts.push([e.x, e.y, 0], [e.x, e.y, 1.5]); } }
      if (stay) pts.push([h.x, h.y, STAY_Z + 1.1]); // the "stay here" badge over his head
      if (sc.run) {
        const ny = Math.abs(h.y - gy0) < Math.abs(h.y - gy1) ? gy0 : gy1;
        for (const y of [gy0, gy1]) goalAll.push([L, y, 0, 1], [L, y, 1.6, 1]); // the posts (1.6 m high; 1: may sit beside the prompt, see inside)
        goalNear.push([L, ny, 0, 1], [L, ny, 1.6, 1], [L, (gy0 + gy1) / 2, 0, 1]);
      }
    }
    let mx = 0, my = 0; for (const p of [...pts, ...goalAll]) { mx += p[0]; my += p[1]; } mx /= pts.length + goalAll.length; my /= pts.length + goalAll.length;
    let cx = mx, cy = my; // where the camera looks: the middle of it all, or (for a closer view) a little toward him
    // The free part of the screen: under the prompt, in from the edges, and not where LOOK UP / HEAD DOWN sits (bottom
    // left; nothing else shows while he picks a spot).
    const Ff = .9, Fw = .45, F = Math.max(v.h * Ff, v.w * Fw), x0 = v.w * .05, x1 = v.w * .95, y0 = 104, y1 = v.h - 16, bx = 160, by = v.h - 150;
    let fx, fy;
    const fits = (pitch, d, { goal, ratio, heroMin }) => { // camera d metres from the middle, looking down `pitch`, from over the pitch (not in the stands)
      const ex = cx - fx * Math.cos(pitch) * d, ey = cy - fy * Math.cos(pitch) * d, ez = Math.sin(pitch) * d;
      if (ex < -.2 || ex > L + .2 || ey < -.2 || ey > W + .2) return false;
      const fwd = [fx * Math.cos(pitch), fy * Math.cos(pitch), -Math.sin(pitch)], rt = [fy, -fx, 0], up = [rt[1] * fwd[2] - rt[2] * fwd[1], rt[2] * fwd[0] - rt[0] * fwd[2], rt[0] * fwd[1] - rt[1] * fwd[0]];
      const proj = (px, py, pz) => { const dx = px - ex, dy = py - ey, dz = pz - ez, z = dx * fwd[0] + dy * fwd[1] + dz * fwd[2]; return z < .5 ? null : [v.w / 2 + F * (dx * rt[0] + dy * rt[1] + dz * rt[2]) / z, v.h / 2 - F * (dx * up[0] + dy * up[1] + dz * up[2]) / z]; };
      if (heroMin) { const a = proj(h.x, h.y, 0), b = proj(h.x, h.y, 1.85); if (!a || !b || a[1] - b[1] < heroMin) return false; } // his player at least this tall
      // (A goal post may also sit up beside the prompt and the round dots, which are in the middle at the top, but not
      // under them, nor under the buttons in the top corners.)
      const inside = (px, py, pz, side = 0) => {
        const q = proj(px, py, pz); if (!q) return false; const [sx, sy] = q;
        const top = (side || even) && Math.abs(sx - v.w / 2) > 200 && sx > 80 && sx < v.w - 80 ? 64 : y0; // (these views: anything may sit up beside the prompt)
        return !(sx < x0 || sx > x1 || sy < top || sy > y1 || (sx < bx && sy > by));
      };
      for (const [px, py, pz, side] of [...pts, ...(goal === 'all' ? goalAll : goal === 'near' ? goalNear : [])]) if (!inside(px, py, pz, side)) return false;
      if (even) { // each ring at the size it will be drawn
        const z = sc.spots.map(sp => (sp.x - ex) * fwd[0] + (sp.y - ey) * fwd[1] - ez * fwd[2]), near = Math.min(...z); // depth: the size on screen goes as 1 / depth
        // A ring far off is drawn bigger and one close by smaller (down to RING_SHRINK), but never so big that it would
        // touch its nearest neighbour ring (each takes half the gap).
        const mid = Math.sqrt(near * Math.max(...z));
        scales = z.map((k, i) => Math.max(RING_SHRINK, Math.min(RING_GROW, k / mid, ...sc.spots.filter((_, j) => j !== i).map(b => (Math.hypot(b.x - sc.spots[i].x, b.y - sc.spots[i].y) - .15) / 1.6))));
        const size = scales.map((k, i) => k / z[i]); if (Math.max(...size) > ratio * Math.min(...size)) return false;
        for (const [i, sp] of sc.spots.entries()) for (let a = 0; a < 8; a++) if (!inside(sp.x + Math.cos(a * Math.PI / 4) * .85 * scales[i], sp.y + Math.sin(a * Math.PI / 4) * .85 * scales[i], 0)) return false;
      }
      return true;
    };
    // The way he faces first; turned a little either way only if that lets it come nearer (or fit at all).
    const search = rule => {
      let best = null;
      for (const lean of even ? [0, .3, .55, .8] : [0]) {
        cx = lerp(mx, h.x, lean); cy = lerp(my, h.y, lean);
        for (const off of [0, .35, -.35, .7, -.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75]) {
          fx = Math.cos(yaw + off); fy = Math.sin(yaw + off);
          for (let pitch = .55; pitch <= 1.31; pitch += .095) for (let d = 7; d <= 30; d += .5) if (fits(pitch, d, rule)) { const cost = d + 4 * Math.abs(off) + 2 * lean; if (!best || cost < best.cost) best = { pitch, d, off, cost, scales, cx, cy }; break; }
        }
      }
      return best;
    };
    // Tried in this order: the whole goal, then only its near post and the middle of its mouth, then rings a little less
    // even, then his player a little smaller, and only then (never running to the goal unless nothing else fits) no goal.
    const hm = HERO_MIN * F, tiers = !even ? [...[1, .88, .78, .7].map(k => ({ goal: 'all', ratio: RING_RATIO, heroMin: hm * k })), { goal: 'all', ratio: RING_RATIO }] : [ // (v62: defending and lead passes too: his player big enough to find, first){ goal: 'all', ratio: RING_RATIO, heroMin: hm }, { goal: 'near', ratio: RING_RATIO, heroMin: hm },
      ...[1, .88, .78, .66].map(k => ({ goal: 'near', ratio: RING_RATIO_MAX, heroMin: hm * k })), { goal: 'none', ratio: RING_RATIO_MAX, heroMin: hm * .78 },
      { goal: 'none', ratio: 3, heroMin: hm * .6 }, { goal: 'all', ratio: RING_RATIO }];
    let best = null, rule = null; for (const t of tiers) if ((best = search(t))) { rule = t; break; }
    const { pitch, d, off } = best || { pitch: 1.35, d: 22, off: 0 }; fx = Math.cos(yaw + off); fy = Math.sin(yaw + off); cx = best?.cx ?? mx; cy = best?.cy ?? my;
    const ex = cx - fx * Math.cos(pitch) * d, ey = cy - fy * Math.cos(pitch) * d;
    this.spotFit = { key, spec: { eye: [ex, ey, Math.sin(pitch) * d], tgt: [cx, cy, 0], Ff, Fw }, scales: best?.scales || null, rule };
    return this.spotFit.spec;
  },

  // The aim view (v64): he picks one of six targets, so the goal must be big (each target at least 44 px), and he must still
  // be in the picture with the ball at his feet. The camera is AIM_B m behind him on the line from the goal through him,
  // with a long lens, looking at the goal: the goal, the keeper and the targets fill the upper middle, he stands whole
  // below them, from behind. (Round 3) The camera stays the same distance behind him wherever he is, so the farther he is
  // from the goal, the smaller it looks (AIM_K: the lens; at 13 m a target is still about 46 px on a small phone). It is as
  // high as lets his feet stay above the bottom edge, and to the side he is on just enough that his head comes up between
  // two low targets.
  aimView(h = this.sim.a('hero')) {
    const v = this.viewSize(), H = v.h || 375, mid = (gy0 + gy1) / 2;
    const dx = L - h.x, dy = mid - h.y, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    const back = Math.min(AIM_B, (h.x - 1) / Math.max(.2, ux)), r = l / back, pxm = H * Math.max(AIM_MIN, AIM_K / (l + back));
    const gcY = Math.max(AIM_GOAL_Y * H, 104 + .9 * pxm); // (the top targets clear of the prompt)
    // To the side (sd): his head comes up between two low targets, never on one. Of the two sides, the one where nobody
    // stands between the camera and him (the defender he got past is often right behind him).
    const off = (spaces()[3].y - mid) / 2 / r, hz = clamp(((H - 28 - gcY) / pxm - .9) / r, 1.6, 7); // (hz: his feet and the ball well over the bottom edge)
    const eyeAt = (sd, up = 0) => [h.x - ux * back - uy * sd, clamp(h.y - uy * back + ux * sd, -4, W + 4), hz + up];
    const clear = e => { let m = 9; for (const a of this.sim.agents.values()) { if (a === h || a.gk) continue; const c = closestOnLane(a, { x: e[0], y: e[1] }, h, 0); if (c.t < .98) m = Math.min(m, c.d); } return m; };
    // (Round 4) How much of the targets (and the keeper, and him) the players hide from an eye: for each target and each outfield player (him too),
    // whether the line from the eye to the target passes through the player (about .4 m to each side, 1.7 m tall with his hair) on its way.
    // The keeper (where he stands is the point of the step) and his own player count double.
    const K = this.sim.keeper('them'), looks = [...spaces().map(t => ({ x: L, y: t.y, z: t.top ? t.z : .4, w: 1 })), ...(K ? [{ x: K.x, y: K.y, z: 1, w: 2, not: K }] : []), { x: h.x, y: h.y, z: .9, w: 2, not: h }];
    const covered = e => { let n = 0; for (const t of looks) for (const a of this.sim.agents.values()) { if (a.gk || a === t.not) continue;
      const c = closestOnLane(a, { x: e[0], y: e[1] }, t, 0); if (c.t > .97) continue;
      const z = e[2] + (t.z - e[2]) * c.t; if (c.d < .4 && z < 1.7) n += t.w * (1 - c.d / .5); } return n; };
    const pref = Math.sign(h.y - mid) || 1, cands = [[pref * off, 0], [-pref * off, 0], [pref * off * 2.2, 0], [-pref * off * 2.2, 0]].map(([sd, up], i) => { const e = eyeAt(sd, up); return { e, i, cov: covered(e), cl: clear(e) }; });
    // The least covered (his side or the other, a little or farther to the side); between near equals, his side, unless
    // the other is much clearer of people in front of him.
    cands.sort((p, q) => (Math.abs(p.cov - q.cov) > .15 ? p.cov - q.cov : p.i < 2 && q.i < 2 && Math.abs(p.cl - q.cl) > .3 ? q.cl - p.cl : p.i - q.i));
    const eye = cands[0].e, dg = Math.hypot(L - eye[0], mid - eye[1], .9 - eye[2]);
    // (the goal a little left of the middle, AIM_GOAL_X of the width)
    const cx = L - eye[0], cy = mid - eye[1], cl = Math.hypot(cx, cy) || 1, sh = (.5 - AIM_GOAL_X) * (v.w || 667) / pxm;
    return { eye, tgt: [L + cy / cl * sh, mid - cx / cl * sh, .9 - (H / 2 - gcY) / pxm], Ff: pxm * dg / H, Fw: 0 };
  },
  camSpec(time) {
    const s = this.sim, h = s.a('hero'), b = s.ball;
    if (this.camMode === 'orbit') { const a = time * .08; return { eye: [L / 2 + Math.cos(a) * 24, W / 2 + Math.sin(a) * 24, 10], tgt: [L / 2, W / 2, 0], Ff: .9, Fw: .4 }; }
    // A shot in front of him (follow your shot): from behind him and a little above, looking past him at where it hits,
    // so the shooter, the shot, the goal and the bounce are all in the picture.
    if (this.camMode === 'shot' && this.aimAt) {
      const p = this.aimAt, l = Math.hypot(p.x - h.x, p.y - h.y) || 1, ux = (p.x - h.x) / l, uy = (p.y - h.y) / l;
      return { eye: [clamp(h.x - ux * 5, .5, L - .5), clamp(h.y - uy * 5, .5, W - .5), 3.6], tgt: [lerp(h.x, p.x, .5), lerp(h.y, p.y, .5), .4], Ff: .85, Fw: .44 };
    }
    if (this.camMode === 'aim' && this.aimFrom) return this.aimView(this.aimFrom); // (his shot, v64: the same view as he aimed, so the keeper's dive is big)
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
      const c = s.a(b.carrier); if (c && !c.gk) f.yawT = c.team === 'them' ? Math.PI : 0; // (a keeper with the ball: the view stays as it was)
      return { eye: [f.x - Math.cos(f.yaw) * 7, f.y - Math.sin(f.yaw) * 7, 4.2], tgt: [f.x + Math.cos(f.yaw) * 4, f.y + Math.sin(f.yaw) * 4, .3], Ff: .9, Fw: .46 };
    }
    // Choosing where to run (or pass to a running friend): every spot whole on screen, clear of the buttons (see spotView).
    if (this.step === 'spot' && this.phase === 'decide' && this.sc?.spots?.length) return this.spotView();
    // Choosing where to shoot, and with which foot: the aim view (v64, see aimView).
    if (this.step === 'aim' && this.phase === 'decide') return this.aimView(); // (the foot, round 3: his own view, below, so he sees how far he is)
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
    // (round 3) A threat coming from behind him: while he chooses, the view is higher and farther back, so he is seen coming.
    const wide = this.phase === 'decide' && this.win?.plan?.wide ? 1 : 0;
    const [bx, by] = rot(-lerp(C[0], 5.2, k) - 3.5 * wide, lerp(C[1], .3, k), this.yaw), [fx, fy] = rot(9, 0, this.yaw);
    // On attack, head down looks at the ball at his feet. On defense the ball is away from him, so head down
    // looks a few meters ahead of him toward the ball, keeping him in view.
    // Dribbling, the ball surges out and back at every touch: head down looks at a steady point just ahead of his
    // feet instead, so the picture doesn't shake with each touch (the camera's own easing covers the switch).
    let dx = b.x, dy = b.y;
    if (b.state === 'carried' && b.carrier === 'hero' && !b.move) { const [ax, ay] = rot(.45, 0, this.yaw); dx = h.x + ax; dy = h.y + ay; }
    if (facesBall(this.sc)) { const [ax, ay] = rot(C[3], 0, this.yaw); dx = lerp(h.x + ax, b.x, C[4]); dy = lerp(h.y + ay, b.y, C[4]); }
    return { eye: [h.x + bx, h.y + by, lerp(C[2], 2.8, k) + 2.2 * wide], tgt: [lerp(dx, h.x + fx, k), lerp(dy, h.y + fy, k), lerp(C[5], .5, k)], Ff: lerp(C[6], .9, k), Fw: lerp(C[7], .52, k) };
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
    const sc = this.sc, m = this.sim.a('m1'), [dx, dy] = sc.dir || sc.dribbling; // (v64: also a friend dribbling, "Don't crowd your friend")
    if (this.arrow?.sc !== sc) this.arrow = { sc, lines: [{ a: { x: m.x + dx * .6, y: m.y + dy * .6 }, b: { x: m.x + dx * 3.2, y: m.y + dy * 3.2 }, color: '#ffffff' }] };
    return this.arrow.lines;
  },
  // Run-to rounds with a friend on the ball where staying put is one of the choices (not the shot rounds' "watch").
  stayOffered() { const sc = this.sc; return sc?.kind === 'support' && !!sc.even && !!sc.spots?.some(sp => sp.id === 'stay'); },
  updateHud() {
    const hud = this.hud, s = this.sim;
    let prompt = '';
    if ((this.mode === 'lesson' || this.mode === 'match' || this.mode === 'free') && !this.showing) {
      if (this.phase === 'pre') prompt = this.lookUp || this.sc?.kind === 'tackle' || this.sc?.kind === 'receive' ? '' : 'Tap 👀 to look up';
      else if (this.phase === 'decide') prompt =
        this.step === 'tackle' ? 'Wait… steal it when it rolls away!' :
        this.step === 'turn' ? (this.peeked ? (this.sc?.back ? 'Tap an arrow, or your friend' : 'Tap the arrow for your turn') : 'Ball coming! Drag to peek, then tap a turn arrow') :
        this.step === 'spot' && this.sc?.kind === 'lead' ? (this.lookUp ? 'Tap where to pass' : 'Tap 👀 to look up') :
        this.step === 'spot' ? (this.lookUp ? (this.stayOffered() ? 'Tap where to run, or stay' : 'Tap where to run') : 'Watch the ball… tap 👀 to look up') :
        this.pendingDir ? 'Small touches or big push?' :
        this.step === 'pass' ? (this.seen.size ? 'Tap a friend you found' : 'Drag to look for a friend') :
        this.step === 'dribble' ? 'Tap an arrow' :
        this.step === 'aim' ? 'Tap where to shoot' :
        this.step === 'foot' ? 'Inside or laces?' :
        this.seen.size ? 'Pass or dribble?' : this.lookUp ? 'Drag to look around' : 'Tap 👀 to look up';
    }
    // The only nudge: if he hasn't looked up after a while, pulse LOOK. Never point at the answer.
    const nudge = this.canAct && !this.lookUp && (this.locked || (!this.seen.size && (this.realTime || 0) - (this.decideReal || 0) > 5)) ? 'look' : null;
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
    for (const m of MATES) ui.glow[m] = deciding && ((this.step === 'pass' && this.seen.has(m)) || (this.step === 'turn' && this.sc?.back && m === (this.sc.carrier || 'm1'))) ? .8 : 0; // (v64: the passer, for the pass back)
    for (const d of DIRS) ui.arrows[d] = !deciding || this.step !== 'dribble' ? 0 : !this.pendingDir || this.pendingDir === d ? 1 : .3;
    const back = deciding && this.step === 'turn' && this.sc?.back && this.sim.a(this.sc.carrier || 'm1'); // (v64: the passer is a choice too: his glow and a gold ring under him)
    if (back) ui.glow[back.id] = 1;
    ui.spots = deciding && this.step === 'spot' ? this.sc.spots : back ? (this.backRing?.sc === this.sc ? this.backRing.v : (this.backRing = { sc: this.sc, v: [{ id: 'back', x: back.x, y: back.y }] }).v) : NONE;
    ui.aims = deciding && this.step === 'aim' ? (this.aimList?.sc === this.sc ? this.aimList.v : (this.aimList = { sc: this.sc, v: this.aimSpots() }).v) : NONE; // the spaces in the goal (v62)
    ui.spotScale = back ? BACK_SCALE : ui.spots !== NONE && (this.sc.run || this.sc.even) ? this.spotFit?.scales || null : null; // (see spotView; the passer's ring bigger, as he is farther off)
    // Staying is one of the choices: a badge floats over his head (and his ring stays under his feet). Tapping either picks it.
    const h = this.sim.a('hero'), st = ui.spots !== NONE && this.stayOffered() && h;
    if (st) { const a = (ui.stayAt ||= { x: 0, y: 0, z: STAY_Z }); a.x = h.x; a.y = h.y; } else ui.stayAt = null;
    ui.turnArrows = deciding && this.step === 'turn' ? this.turnArcs() : NONE;
    ui.lines = deciding && (this.sc?.kind === 'lead' || this.sc?.dribbling) ? this.runArrow() : this.lines; ui.heroRing = this.camMode === 'player' || (this.phase === 'feedback' && !!this.markHero); ui.heroRingRed = this.phase === 'feedback' && !!this.markRed;
    ui.reach = null; ui.timer = this.timerUi?.() || null; // (round 3: one draining ring round his player shows the time left; no patch on the grass)
    ui.ballGlow = this.sc?.kind === 'tackle' && ((this.step === 'tackle' && this.hint) || (this.phase === 'outcome' && !this.result)) && this.tackleState() === 'good';
  },
};
