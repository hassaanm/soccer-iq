// The decision window in the game (v64; the plan itself is js/window.js planHold). The scene's own picture holds for the
// whole window: the run-up brings everyone to the way he moves in it (the play drifting on, each with his own small
// part, and the threat already running in from farther out); then play drops into slow motion and goes on until he
// chooses or the threat gets to the ball (the time-out: outcomes.js timeoutGen). The ring round his own player shows how
// long he has (ui.timer, drawn by world.js).
import { planHold, planLive, pathAt, windowSeconds, windowFloor, kindOf, attackOptions, spotsNow, PACE } from '../window.js';
import { L, W, facesBall } from './shared.js';
import { SHOT } from '../generate.js';
import { clamp } from '../geom.js';

const RUNUP = 1.3;
// In demos and in the replay of the better play nobody runs out of time: the window is this long (real seconds), and
// the hand taps well inside it.
const SHOW = { demo: 16, replay: 7 };

export const moving = {
  // ---------- planning ----------
  // Where everyone is in the scene's own picture (the moment it was graded), for planning before the run-up.
  sceneState(sc) {
    const at = {}, put = (id, p, team, gk = false) => { if (p && this.sim.a(id)) at[id] = { x: p[0], y: p[1], vx: 0, vy: 0, team, gk }; };
    put('hero', sc.heroTo, 'us');
    (sc.matesTo || sc.mates).forEach((p, i) => put('m' + (i + 1), sc.kind === 'lead' && i === 0 ? sc.moves.m1.at : p, 'us')); // (a lead pass: the runner where the scene has him)
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
  // The plan for this choice (window.js planHold). live: from play already going (a match, a give-and-go's second step):
  // the picture is where everyone is now. Else the scene's own picture, planned before the run-up. `extra`: options for
  // planHold (who the scene's own script moves, runs the scene gives, a length the play gives).
  plan(live, extra = {}) {
    const sc = this.sc;
    if (kindOf(sc) === 'tackle') return null;
    const st = live ? this.liveState() : this.sceneState(sc);
    try {
      const p = planHold(sc, st, { live, options: this.offerList(), yaw: this.yaw, R: this.windowReal(), Rfloor: this.windowMin(), ...extra });
      if (p) p.live = live;
      return p;
    } catch (e) { console.error(e); return null; } // (never a stuck choice: without a plan the choice opens as before v64)
  },

  // (v66) A match's choice opens from play going on. Before its picture is taken, everyone comes over (T s, smoothly,
  // nobody stopping) to moving with the play: the way the ball is being carried, at a walk or a slow jog. So the picture
  // the choice is graded from is one that holds: as the window opens, the whole shape is already drifting together.
  async settle(T = .6) {
    const s = this.sim, st = this.liveState(), c = s.a(s.ball.carrier); if (!c || c.gk) { await this.delay(T); return; }
    const cv = st.at[c.id], sp0 = Math.hypot(cv.vx, cv.vy), g = [c.team === 'us' ? L : 0, W / 2], gl = Math.hypot(g[0] - c.x, g[1] - c.y) || 1;
    let dir = sp0 > .6 ? [cv.vx / sp0, cv.vy / sp0] : [(g[0] - c.x) / gl, (g[1] - c.y) / gl]; const v = c.team === 'us' ? 1.2 : 1.5;
    // His own first touch with one of theirs right on him takes the ball away from that player (and up the field), a
    // quick step or two before he settles into his carry: there is pressure, but still room to play.
    let burst = 0;
    if (c.id === 'hero') { const o = s.team('them').sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y))[0], d = o ? Math.hypot(o.x - c.x, o.y - c.y) : 9;
      if (d < 3.2) { // (away from him and across, toward the side with more room: he stays goal-side, a step or two farther off)
        const bx = (c.x - o.x) / (d || 1), by = (c.y - o.y) / (d || 1), sg = Math.sign((-by) * 0 + bx * (W / 2 - c.y)) || 1; let ax = bx * .6 - by * sg * .8, ay = by * .6 + bx * sg * .8;
        if ((c.y < 3 && ay < 0) || (c.y > W - 3 && ay > 0)) ay = -ay; if ((c.x > L - 3 && ax > 0) || (c.x < 3 && ax < 0)) ax = -ax; const al = Math.hypot(ax, ay) || 1; dir = [ax / al, ay / al]; burst = 3.4; T = Math.max(T, .9); } }
    const D = [dir[0] * v, dir[1] * v];
    for (const a of s.agents.values()) {
      if (a.gk) continue;
      const q = st.at[a.id], own = a === c && burst, v0 = own ? [dir[0] * burst, dir[1] * burst] : [q.vx, q.vy], dv = Math.hypot(D[0] - v0[0], D[1] - v0[1]), path = { x: a.x, y: a.y, v0, v1: D, t1: own ? .25 : 0, tau: own ? T - .25 : Math.max(.3, Math.min(T, dv * 1.5 / 3.5 + .1)) };
      a.track = { at: t => pathAt(path, t), t0: s.time, watch: a.team !== c.team };
    }
    await this.delay(T);
  },
  // ---------- the run-up ----------
  // A lesson's scene: the window's plan first, then a run-up in which everyone already moves as he will in the window
  // (RUNUP s before it opens, less if someone would start well off the pitch): the play drifting on, the threat coming
  // at a jog and speeding up. `extra.during(T)`: what the scene's script does meanwhile (a pass played to him).
  async plannedRunUp(extra = {}) {
    const s = this.sim, sc = this.sc;
    // (v66) The view he chooses in is set now, before the run-up: raised and turned as little as shows the one who comes
    // as he sets off. If no view that keeps his own player big enough shows him from that far, he sets off from nearer.
    let plan = null, tv = null;
    for (const rCap of kindOf(sc) === 'attack' ? [0, 5.2, 4.2, 3.4] : [0]) { const p = this.plan(false, rCap ? { ...extra, rCap } : extra); if (!p) break; const t = kindOf(sc) === 'attack' ? this.threatFit(p) : null; if (!plan || t?.seen) { plan = p; tv = t; } if (!t || t.seen || !p.threat || p.rP >= (rCap || 9)) break; }
    this.wplan = plan;
    if (!plan) return;
    plan.sc = sc;
    {
      let T = RUNUP; const far = id => { const q = pathAt(plan.paths[id], -T); return q.x < -1.5 || q.x > L + 1.5 || q.y < -1.5 || q.y > W + 1.5; };
      while (T > .5 && Object.keys(plan.paths).some(far)) T = Math.round((T - .1) * 10) / 10;
      plan.openAt = s.time + T; // (when the choice opens: the view is set for it from now on, view.js spotView)
      for (const [id, p] of Object.entries(plan.paths)) {
        const a = s.a(id); if (!a) continue;
        const q = pathAt(p, -T), v = Math.hypot(q.vx, q.vy);
        Object.assign(a, { x: q.x, y: q.y, tx: q.x, ty: q.y });
        if (v > .1 && !a.gk && !plan.watch.has(id)) a.face = [q.vx / v, q.vy / v];
        else if (plan.watch.has(id) || a.gk) { const h = plan.paths[sc.carrier || 'hero'] || plan.paths.hero, hq = h && pathAt(h, -T); if (hq) { const dx = hq.x - a.x, dy = hq.y - a.y, l = Math.hypot(dx, dy) || 1; a.face = [dx / l, dy / l]; } }
        a.track = { at: tt => pathAt(p, tt - T), t0: s.time, watch: plan.watch.has(id) };
      }
      const c = s.a(s.ball.carrier);
      if (c) { Object.assign(s.ball, { x: c.x + c.face[0] * .4, y: c.y + c.face[1] * .4, h: Math.atan2(c.face[1], c.face[0]) }); c.d0 = c.dist; c.tA = 0; c.tN = 0; }
      if (tv) { plan.wideK = tv.k; plan.seen = tv.seen; if (tv.off) this.yaw += tv.off; }
      extra.frame?.(id => pathAt(plan.paths[id] || { x: s.a(id).x, y: s.a(id).y, v0: [0, 0], v1: [0, 0] }, 0)); // (the way he looks as the choice opens, set now: the view is fitted for it before the run-up)
      await Promise.all([this.delay(T), extra.during?.(T)]);
      plan.ready = true;
    }
  },

  // After a shot that came back out (round 2): the window is the ball's roll to rest; everyone goes from where he is to
  // where the scene has him as it stops, their player who gets to it first (the threat) on his way to it.
  followPlan() {
    const s = this.sim, sc = this.sc, b = s.ball, st = this.liveState(), end = Object.fromEntries(Object.entries(this.sceneState(sc).at).map(([id, a]) => [id, [a.x, a.y]]));
    // (round 2: it opens as the shot is struck; the window is the rest of its flight to where it hits, and the rebound's roll)
    const sh = sc.shot, hit = { x: sh.hit[0], y: sh.hit[1] }, lo = { x: sh.loose[0], y: sh.loose[1] }, outT = Math.hypot(lo.x - hit.x, lo.y - hit.y) / SHOT.out;
    const toHit = Math.hypot(hit.x - b.x, hit.y - b.y), toEnd = b.state === 'flying' ? Math.hypot(b.tx - b.x, b.ty - b.y) || toHit : toHit;
    const G = Math.max(.6, b.state === 'flying' ? (1 - b.t) * b.dur * Math.min(1, toHit / toEnd) + outT : .2 + Math.max(.25, toHit / SHOT.speed) + outT); // (still to strike: the wind-up, its flight, the roll)
    const racer = this.followRacer ? s.a(this.followRacer) : s.team('them').sort((p, q) => Math.hypot(p.x - lo.x, p.y - lo.y) - Math.hypot(q.x - lo.x, q.y - lo.y))[0];
    const p = planLive(st, end, G, racer?.id); p.live = false; p.threat = racer ? { id: racer.id, to: sh.loose } : null;
    // The shooter: still as he winds up, then his follow-through on toward where the scene has him (child-like: it may
    // stop short of it).
    const by = s.a(sh.by); if (by && p.paths[sh.by]) p.paths[sh.by] = { go: true, S: [by.x, by.y], E: end[sh.by], a: 3, vMax: 2.6, t0: b.state === 'flying' ? 0 : .2 };
    for (const fr of this.followRuns || []) if (p.paths[fr.id]) p.paths[fr.id] = { ...fr.run, base: s.time - fr.t0 - fr.total }; // (those running in on their own runs: no change of way as it opens)
    // The one it comes off is knocked back half a step and gets his balance back, facing it.
    const bk = sh.block && sh.block[0] === 'o' && p.paths[sh.block];
    if (bk) { const a = s.a(sh.block), dx = a.x - hit.x, dy = a.y - hit.y, l = Math.hypot(dx, dy) || 1, ux = lo.x - a.x, uy = lo.y - a.y, m = Math.hypot(ux, uy) || 1;
      const kx = dx / l + ux / m, ky = dy / l + uy / m, kl = Math.hypot(kx, ky) || 1; // (back and to the side it went: he turns after it, never back on himself)
      Object.assign(bk, { S: [a.x, a.y], V0: [0, 0], E: [a.x + kx / kl * .35, a.y + ky / kl * .35], V1: [ux / m * .5, uy / m * .5] }); }
    return p;
  },
  // ---------- the window ----------
  // How long he has (real seconds): by the idea's level (the first round of a new idea longer), the grown-ups' "Thinking
  // time", and longer again on a lesson round he ran out of time in.
  windowReal() {
    const sc = this.sc, id = sc?.live ? this.idea?.() : sc?.skill, lv = this.levelOf?.(id) ?? (this.mode === 'lesson' ? 1 : 3);
    return windowSeconds({ level: Math.max(1, lv), first: !!this.firstRound, think: (this.toStreak || 0) >= 3 ? 'relaxed' : this.thinkTime?.() || 'normal', retry: this.timeouts || 0 });
  },
  // The shortest this choice's window may be cut to (window.js windowFloor), with the same level and setting as windowReal.
  windowMin() {
    const sc = this.sc, id = sc?.live ? this.idea?.() : sc?.skill, lv = this.levelOf?.(id) ?? (this.mode === 'lesson' ? 1 : 3);
    return windowFloor({ level: Math.max(1, lv), first: !!this.firstRound, think: (this.toStreak || 0) >= 3 ? 'relaxed' : this.thinkTime?.() || 'normal' });
  },
  openWindow() {
    const s = this.sim, sc = this.sc;
    this.closeWindow();
    if (kindOf(sc) === 'tackle') return;
    const plan = this.wplan?.ready && this.wplan.sc === sc ? this.wplan : kindOf(sc) === 'follow' && !sc.live ? this.followPlan() : this.plan(true);
    if (!plan) return;
    plan.sc = sc; plan.ready = false; this.wplan = plan; // (kept: a retry of this choice opens the same window again)
    // (v66) The world never goes slower than PACE: a short piece of play is a shorter window (a tight scene is a quick one).
    const show = this.mode === 'demo' ? SHOW.demo : this.showing ? SHOW.replay : 0, G = plan.G, R = Math.max(G, Math.min(show || this.windowReal(), (G - .1) / PACE + .1));
    this.spotsReset();
    this.win = { plan, G, R, f: Math.max(PACE, Math.min(1, (G - .1) / Math.max(.5, R - .1))), t0: s.time, real: 0, threat: plan.threat, kind: kindOf(sc), spots0: this.spot0 || [], at0: {} };
    // (round 2) A pass coming to him from live play: he meets it where it is going, a small step behind where it stops,
    // as it gets there (not on with the play, a metre off it).
    const b = s.ball, h = s.a('hero');
    if (plan.live && kindOf(sc) === 'receive' && b.state === 'flying' && h && plan.paths.hero) {
      const T = Math.max(.2, (1 - b.t) * b.dur), dx = b.tx - b.fx, dy = b.ty - b.fy, l = Math.hypot(dx, dy) || 1, E = [b.tx + dx / l * .45, b.ty + dy / l * .45], q = pathAt(plan.paths.hero, 0);
      if (Math.hypot(E[0] - h.x, E[1] - h.y) < 2.5) plan.paths.hero = { herm: true, S: [h.x, h.y], V0: [q.vx, q.vy], E, V1: [0, 0], T };
    }
    // (a window from play going on, a match: its view is fitted now, and the camera goes over to it slowly: no lurch)
    if ((plan.live || plan.fromLive) && plan.hold && !plan.viewSet) { plan.viewSet = true; if (kindOf(sc) === 'attack') { const tv = this.threatFit(plan); plan.wideK = tv.k; plan.seen = tv.seen; } this.camSlow = 2; }
    for (const [id, p] of Object.entries(plan.paths)) {
      const a = s.a(id); if (!a) continue;
      this.win.at0[id] = plan.at0?.[id] || { x: p.x, y: p.y }; // (rings that go with a player: from the scene's own picture)
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
    // (v66) The ones who were coming go on to where their runs end (by the ball), not on through the player on it: what
    // the play does next takes them from there.
    for (const id of [w.threat?.id, w.plan.second]) { const p = id && w.plan.paths[id], a = id && this.sim.a(id); if (!p?.run || !a) continue; const e = pathAt(p, w.G), v = Math.hypot(e.vx, e.vy); if (Math.hypot(e.x - a.x, e.y - a.y) > .1) this.sim.go(id, e.x, e.y, Math.max(1, v)); }
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
  // reaches it as the window ends; world.js also spreads warm segments round his own ring from the threat's side (u: how
  // far the window has run). null when no window is open.
  // (round 3) The time left in the window, for the timer ring round his own player (world.js): full as it opens, empty
  // as it ends (the threat gets there at that very moment). `wide`: a ring he could tap lies at his feet, so the timer goes
  // round outside it.
  timerUi() {
    const w = this.win; if (!w || this.phase !== 'decide') return null;
    const h = this.sim.a('hero'), out = (this.ui.timer ||= {});
    out.left = clamp(1 - (w.u || 0), 0, 1);
    out.wide = !!(h && this.sc?.spots?.some(sp => Math.hypot(sp.x - h.x, sp.y - h.y) < 1.4));
    return out;
  },
  reachUi() {
    const w = this.win; if (!w || this.phase !== 'decide' || !w.threat || this.sc?.restart) return null; // (a restart: nobody comes for the ball; his ring alone shows the time)
    const s = this.sim, o = s.a(w.threat.id); if (!o) return null;
    const to = w.threat.to ? { x: w.threat.to[0], y: w.threat.to[1] } : w.kind === 'receive' ? s.a('hero') : s.ball; // (the ball he goes for; on a pass to him, where it comes to)
    const dx = to.x - o.x, dy = to.y - o.y, d = Math.hypot(dx, dy) || 1, u = clamp(w.u || 0, 0, 1), r0 = .55;
    const len = r0 + Math.max(0, d - r0 - .1) * u; // from his feet at the start to the ball (less its size) at the end
    const out = (this.ui.reach ||= {});
    Object.assign(out, { x: o.x, y: o.y, dx: dx / d, dy: dy / d, len: Math.min(len, d), u });
    return out;
  },
};
