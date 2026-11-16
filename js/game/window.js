// The decision window in the game (v64; the plan itself is js/window.js). The run-up brings everyone to the way they
// move as the choice opens; then play drops into slow motion and goes on, each player on his planned way, until he
// chooses or the threat's reach gets to the ball (the time-out: outcomes.js timeoutGen). His player's own ring and the
// threat's reach on the grass show how long he has (ui.reach, drawn by world.js).
import { planWindow, pathAt, windowSeconds, kindOf, attackOptions, spotsNow } from '../window.js';
import { L, W, facesBall } from './shared.js';
import { clamp } from '../geom.js';

const RUNUP = 1.3;
const mulv = (v, k) => [v[0] * k, v[1] * k]; // seconds of the run-up before the choice (as before v64)
const PACE_MIN = .03; // the slowest the world goes in a window (a very short piece of play in a long window)
// In demos and in the replay of the better play nobody runs out of time: the window is this long (real seconds), and
// the hand taps well inside it.
const SHOW = { demo: 16, replay: 7 };

// Cubic Hermite from (p0, v0) to (p1, v1) over T seconds: a smooth way that leaves and arrives at the given velocities.
function hermite(p0, v0, p1, v1, T) {
  return t => {
    const s = clamp(t / T, 0, 1), s2 = s * s, s3 = s2 * s, h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    const d00 = (6 * s2 - 6 * s) / T, d10 = (3 * s2 - 4 * s + 1), d01 = (-6 * s2 + 6 * s) / T, d11 = (3 * s2 - 2 * s);
    if (t > T) { const e = t - T; return { x: p1[0] + v1[0] * e, y: p1[1] + v1[1] * e, vx: v1[0], vy: v1[1] }; }
    return { x: h00 * p0[0] + h10 * T * v0[0] + h01 * p1[0] + h11 * T * v1[0], y: h00 * p0[1] + h10 * T * v0[1] + h01 * p1[1] + h11 * T * v1[1],
      vx: d00 * p0[0] + d10 * v0[0] + d01 * p1[0] + d11 * v1[0], vy: d00 * p0[1] + d10 * v0[1] + d01 * p1[1] + d11 * v1[1] };
  };
}

export const moving = {
  // ---------- planning ----------
  // Where everyone is in the scene's own picture (the moment it was graded), for planning before the run-up.
  sceneState(sc) {
    const at = {}, put = (id, p, team, gk = false) => { if (p && this.sim.a(id)) at[id] = { x: p[0], y: p[1], vx: 0, vy: 0, team, gk }; };
    put('hero', sc.heroTo, 'us');
    (sc.matesTo || sc.mates).forEach((p, i) => put('m' + (i + 1), p, 'us'));
    (sc.oppsTo || sc.opps).forEach((p, i) => put('o' + (i + 1), p, 'them'));
    if (sc.gk?.us) put('k1', sc.gk.us, 'us', true);
    if (sc.gk?.them) { put('k2', sc.gk.them, 'them', true); if (sc.gk.out && at.k2) at.k2.rush = true; }
    // Two players the scene put closer than bodies allow stand apart, as the frozen picture showed them (sim.js SPACE).
    const list = Object.values(at);
    for (let n = 0; n < 4; n++) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const p = list[i], q = list[j], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1e-3;
      if (d < .9) { const k = (.9 - d) / 2 / d; p.x -= dx * k; p.y -= dy * k; q.x += dx * k; q.y += dy * k; }
    }
    return { at };
  },
  // Where everyone is now and how he moves (for a window that opens from live play: matches, and after a scripted
  // run-up).
  liveState() {
    const s = this.sim, at = {};
    for (const a of s.agents.values()) {
      let vx = 0, vy = 0;
      if (a.track) { const q = a.track.at(s.time - a.track.t0); vx = q.vx; vy = q.vy; }
      else { const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy); if (d > .05 && a.speed > 0) { const v = Math.min(a.speed, a.sp || a.speed); vx = dx / d * v; vy = dy / d * v; } }
      at[a.id] = { x: a.x, y: a.y, vx, vy, team: a.team, gk: !!a.gk, rush: a.gk && a.team === 'them' && !!this.sc?.gk?.out };
    }
    const b = s.ball;
    return { at, ball: { x: b.x, y: b.y, carrier: b.carrier }, flight: b.state === 'flying' ? Math.max(0, (1 - b.t) * b.dur) : null };
  },
  // The choices on offer, as the buttons show them (attack), for the plan's check.
  offerList(sc = this.sc) {
    if (kindOf(sc) !== 'attack') return undefined;
    const x = sc.heroTo?.[0] ?? this.sim.a('hero').x, shoot = !facesBall(sc) && x > L - (sc.skill === 'shoot-close' || sc.shots ? 18 : 13) && !sc.shots;
    return attackOptions(sc, { push: this.pushAllowed, shoot });
  },
  plan(live) {
    const sc = this.sc;
    if (kindOf(sc) === 'tackle') return null;
    const st = live ? this.liveState() : this.sceneState(sc);
    try { const p = planWindow(sc, st, { fixed: !live, options: this.offerList() }); if (p) p.live = live; return p; } catch (e) { console.error(e); return null; } // (never a stuck choice: without a plan the choice opens as before v64)
  },

  // ---------- the run-up ----------
  // A lesson's scene: the window's plan first, then a run-up that brings everyone to where the window opens, moving as
  // it will have him move (cut short when the window opens before the scene's own moment, plan.a < 0). Each comes in
  // a little faster than he goes on: the player on the ball slows down to look up, the presser was closing down and eases
  // into his jockey; everyone else is already going his way.
  async plannedRunUp() {
    const s = this.sim, sc = this.sc, plan = this.wplan = this.plan(false);
    if (!plan) return;
    plan.sc = sc;
    const T = Math.max(.6, RUNUP + plan.a), th = plan.threat?.id;
    for (const [id, p] of Object.entries(plan.paths)) {
      const a = s.a(id); if (!a) continue;
      const P = [p.x, p.y], V = p.v0, sp = Math.hypot(...V);
      let ex = [0, 0];
      const cp = plan.paths[s.ball.carrier]; // where the ball's carrier is as the window opens
      if (id === s.ball.carrier) { const l = sp > .1 ? [V[0] / sp, V[1] / sp] : [1, 0]; ex = mulv(l, id === 'hero' ? 1.1 : .6); } // the player on the ball slows down to look up
      else if (id === th && cp) { const dx = cp.x - p.x, dy = cp.y - p.y, l = Math.hypot(dx, dy) || 1; ex = [dx / l * 1.6, dy / l * 1.6]; } // the presser eases from closing down into his jockey
      const Vs = [V[0] + ex[0], V[1] + ex[1]];
      const S = [clamp(P[0] - T * (Vs[0] + V[0]) / 2, .6, L - .6), clamp(P[1] - T * (Vs[1] + V[1]) / 2, .6, W - .6)];
      a.x = S[0]; a.y = S[1]; a.tx = a.x; a.ty = a.y;
      const vs = Math.hypot(...Vs); if (vs > .1 && !a.gk && !plan.watch.has(id)) a.face = [Vs[0] / vs, Vs[1] / vs];
      a.track = { at: hermite(S, Vs, P, V, T), t0: s.time, watch: plan.watch.has(id) };
    }
    const c = s.a(s.ball.carrier);
    if (c) { Object.assign(s.ball, { x: c.x + c.face[0] * .4, y: c.y + c.face[1] * .4, h: Math.atan2(c.face[1], c.face[0]) }); c.d0 = c.dist; c.tA = 0; c.tN = 0; }
    if (sc.kind === 'defense' && this.sim.a('hero')) { const hh = s.a('hero'); hh.face = [-1, 0]; }
    await this.delay(T);
    plan.ready = true; // the play is where the plan opens
  },

  // ---------- the window ----------
  // How long he has (real seconds): by the idea's level (the first round of a new idea longer), the grown-ups' "Thinking
  // time", and longer again on a lesson round he ran out of time in.
  windowReal() {
    const sc = this.sc, id = sc?.live ? this.idea?.() : sc?.skill, lv = this.levelOf?.(id) ?? (this.mode === 'lesson' ? 1 : 3);
    return windowSeconds({ level: Math.max(1, lv), first: !!this.firstRound, think: this.thinkTime?.() || 'normal', retry: this.timeouts || 0 });
  },
  openWindow() {
    const s = this.sim, sc = this.sc;
    this.closeWindow();
    if (kindOf(sc) === 'tackle') return;
    const plan = this.wplan?.ready && this.wplan.sc === sc ? this.wplan : this.plan(true);
    if (!plan) return;
    plan.sc = sc; plan.ready = false; this.wplan = plan; // (kept: a retry of this choice opens the same window again)
    const show = this.mode === 'demo' ? SHOW.demo : this.showing ? SHOW.replay : 0, R = show || this.windowReal(), G = plan.G;
    this.spotsReset();
    this.win = { plan, G, R, f: Math.max(PACE_MIN, Math.min(1, (G - .1) / Math.max(.5, R - .1))), t0: s.time, real: 0, threat: plan.threat, kind: kindOf(sc), spots0: this.spot0 || [], at0: {} };
    for (const [id, p] of Object.entries(plan.paths)) {
      const a = s.a(id); if (!a) continue;
      this.win.at0[id] = plan.at0?.[id] && !plan.live ? plan.at0[id] : { x: p.x, y: p.y }; // (rings that go with a player: from the scene's own picture)
      a.track = { at: t => pathAt(p, t), t0: s.time, watch: plan.watch.has(id) };
    }
  },
  // Each step of game time while it is open: the rings that belong to a player move with him, and when the threat gets
  // there he takes it.
  windowStep() {
    const w = this.win, s = this.sim; if (!w) return;
    if (this.phase !== 'decide') { this.closeWindow(); return; }
    if (w.spots0.length && this.sc.spots) {
      const at0 = id => w.at0[id] || s.a(id), now = spotsNow({ ...this.sc, spots: w.spots0 }, id => s.a(id), at0);
      this.sc.spots.forEach((sp, i) => { if (now[i]) { sp.x = now[i].x; sp.y = now[i].y; } });
    }
    w.u = (s.time - w.t0) / w.G;
    if (w.u >= 1 && !w.out) { w.out = true; if (this.mode !== 'demo' && !this.showing) { this.choose('timeout'); this.woke = true; } } // (the frame steps no further: the play that follows goes on from this very step)
  },
  // His choice (or the time-out) ends the window: everyone goes on as he was going until the play moves him.
  closeWindow() {
    const w = this.win; if (!w) { this.sim.untrackAll(); return; } // (a play may start straight after a run-up: the tests)
    this.lastWin = { u: Math.min(1, w.u || 0), real: w.real, R: w.R, G: w.G }; this.lastThreat = w.threat?.id || null;
    this.sim.untrackAll(); this.win = null;
  },
  // The spot rings back where the scene put them (a retry, or the replay of the better play, starts from there).
  // spot0: the scene's own places, kept when the scene is loaded (game.js load).
  spotsReset() {
    const sc = this.sc; if (!sc?.spots) { this.spot0 = null; return; }
    if (this.spot0Of !== sc) { this.spot0Of = sc; this.spot0 = sc.spots.map(sp => ({ ...sp })); return; } // a new scene (or a match's choice): its rings are where they are
    sc.spots.forEach((sp, i) => { const o = this.spot0[i]; if (o) { sp.x = o.x; sp.y = o.y; } });
  },

  // Where player `id` will be as the window ends (or now, with no window), and where the rings will be: the camera keeps
  // all of it in view through the whole window (view.js spotView).
  windowEnd(id) { const w = this.win, p = w?.plan.paths[id]; return p ? pathAt(p, w.G) : this.sim.a(id); },
  spotsEnd() {
    const w = this.win; if (!w || !this.sc.spots) return null;
    return spotsNow({ ...this.sc, spots: w.spots0 }, id => this.windowEnd(id), id => w.at0[id] || this.sim.a(id));
  },
  // ---------- what shows ----------
  // The threat's reach (v64 research 2d): a soft patch on the grass in front of him, toward what he is going for, that
  // reaches it as the window ends. null when no window is open.
  reachUi() {
    const w = this.win; if (!w || this.phase !== 'decide' || !w.threat) return null;
    const s = this.sim, o = s.a(w.threat.id); if (!o) return null;
    const to = w.threat.to ? { x: w.threat.to[0], y: w.threat.to[1] } : w.kind === 'receive' ? s.a('hero') : w.kind === 'support' || w.kind === 'goal' ? s.ball : s.ball;
    const dx = to.x - o.x, dy = to.y - o.y, d = Math.hypot(dx, dy) || 1, u = clamp(w.u || 0, 0, 1), r0 = .55;
    const len = r0 + Math.max(0, d - r0 - .1) * u; // from his feet at the start to the ball (less its size) at the end
    const out = (this.ui.reach ||= {});
    Object.assign(out, { x: o.x, y: o.y, dx: dx / d, dy: dy / d, len: Math.min(len, d), u });
    return out;
  },
};
