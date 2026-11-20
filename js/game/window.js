// The decision window in the game (v64; the plan itself is js/window.js planHold). The scene's own picture holds for the
// whole window: the run-up brings everyone to the way he moves in it (the play drifting on, each with his own small
// part, and the threat already running in from farther out); then play drops into slow motion and goes on until he
// chooses or the threat gets to the ball (the time-out: outcomes.js timeoutGen). The ring round his own player shows how
// long he has (ui.timer, drawn by world.js).
import { time } from '../perf.js';
import { planHold, planSteps, planTry, planLive, pathAt, windowSeconds, windowFloor, kindOf, attackOptions, spotsNow, agreeAt, PACE, jockPace, jockFeint, JOCK } from '../window.js';
import { L, W, gy0, gy1, facesBall, spotKind } from './shared.js';
const LIVE_PASS = 5; // real seconds (Normal) for a pass to him in a match
const GUARD = 1.25, GUARD_DT = .05; // (alive-shape) how much farther than his own small move takes him the picture is graded, and how often (real s: aliveGuard)
// (v76) The view for his own player carrying the ball from live play: as near the way to their goal (ga) as keeps it within
// VIEW_OFF of the way he carries it (a): it looks the way he goes, never across it. CARRY_BACK: the most (rad) his carry on
// after a touch away from one of theirs turns off the way to their goal (settle).
const VIEW_OFF = .3, CARRY_BACK = 1.4, ACROSS = 1.3, wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const viewFor = (a, ga) => { const d = wrapA(ga - a); return a + Math.sign(d) * Math.min(Math.abs(d), VIEW_OFF); };
import { SHOT, shotLook } from '../generate.js';
import { clamp } from '../geom.js';

const RUNUP = 1.3;
const FIRST = { look: 8, frames: 24 }; // (v76 SL) vetFirst: how many scenes it looks at for a quick first one, and quick is this many frames of planning or fewer
const VET_PLAY = 16; // (v76 SL) steps of a scene's vetting a frame while play goes on (vetRest): a fifth of PLAN_CHUNK
const PLAN_LIMIT = 170, PLAN_CHUNK = 80; // (v83) the most frames prePlan may take for a scene (60 per second: 1.2 s of the celebration it is made over, and 1.5 s of still picture at the most); how many steps vetRounds makes in a frame
const planCost = new WeakMap(); // (a scene: its prePlan frames, found by prePlanFrames)
export { PLAN_LIMIT };
const PLAN_STEPS = 4; // (v78) how many steps of a plan prePlan makes in a frame (window.js planSteps: each one moment of one try, a millisecond or less here)
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
  // What planHold is asked (plan, and prePlan's steps).
  planArgs(live, extra = {}) { const sc = this.sc; return [sc, live ? this.liveState() : this.sceneState(sc), { live, options: this.offerList(), yaw: this.yaw, R: this.windowReal(), Rfloor: this.windowMin(), ...extra }]; },
  plan(live, extra = {}) {
    const sc = this.sc;
    if (kindOf(sc) === 'tackle') return null;
    this.heavyAt = this.frameNo | 0; // (frame time: see view.js spotView)
    const timed = time('plan'); // (the frame recorder, perf.js)
    try {
      const p = planHold(...this.planArgs(live, extra));
      if (p) p.live = live;
      return p;
    } catch (e) { console.error(e); return null; } finally { timed(); } // (never a stuck choice: without a plan the choice opens as before v64)
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
        if ((c.y < 3 && ay < 0) || (c.y > W - 3 && ay > 0)) ay = -ay; if ((c.x > L - 3 && ax > 0) || (c.x < 3 && ax < 0)) ax = -ax; const al = Math.hypot(ax, ay) || 1; dir = [ax / al, ay / al]; burst = 3.4; T = Math.max(T, .9);
        // (v78) The touch goes away from him across the pitch, never back toward his own goal: at most ACROSS off the way to
        // their goal (the owner, v76: he walked back from their goal, facing his own, with nobody on him). Only one right on
        // him (the touch across would take him past that player's shoulder) sends it straight away from him.
        const ga0 = Math.atan2(g[1] - c.y, g[0] - c.x), da = wrapA(Math.atan2(dir[1], dir[0]) - ga0); if (Math.abs(da) > ACROSS) { const a = ga0 + Math.sign(da) * ACROSS; dir = [Math.cos(a), Math.sin(a)]; }
        { const k = 3.4 * .25 + 1.2 * (T - .25), ex = c.x + dir[0] * k - o.x, ey = c.y + dir[1] * k - o.y; if (Math.hypot(ex, ey) < 1.9) dir = [bx, by]; } } } // (round 6: never a touch that takes him past that player's shoulder: then straight away from him)
    // (v76) His own player carries it on toward their goal, the way the choice's plan then has him carry it (window.js
    // planHold: a picture from live play has him carry it at the goal), and the view looks that way (viewFor). He used to
    // carry on the way the last play left him (a dribble out wide, the touch away), at the side line or back across with
    // nobody there, and turned for the goal as the choice opened, while the view looked straight up the field
    // (continueLive): near the side line he crossed the screen sideways. One exception: where carrying at the goal would
    // take him back at the player he has just touched it away from, he goes on across, never more than CARRY_BACK off the
    // way to the goal if there is room (then the touch's own way, away from him).
    let cdir = dir;
    if (c.id === 'hero' && c.team === 'us') {
      const o = s.team('them').sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y))[0], k0 = burst * .25;
      const clear = u => !o || [.5, 1, 1.5, 2].every(t => Math.hypot(c.x + dir[0] * k0 + u[0] * v * t - o.x, c.y + dir[1] * k0 + u[1] * v * t - o.y) >= 2.2); // (two steps clear of that player as he stands)
      const ga = Math.atan2(g[1] - c.y, g[0] - c.x), to = a => [Math.cos(a), Math.sin(a)];
      cdir = to(ga);
      // (v78) Not clear at the goal: the least turn off it, on the side away from that player first, that is clear; none
      // clear: of those, the one that keeps him farthest from that player. Never more than ACROSS off the way to their goal:
      // he used to carry it on the touch's own way, back toward his own goal, for the whole window (16% of the windows on
      // the ball in matches at 3v3, up to 2 m back).
      if (burst && !clear(cdir)) { const sd = o ? Math.sign(wrapA(Math.atan2(c.y - o.y, c.x - o.x) - ga)) || 1 : 1, offs = [.35, .7, 1.05, ACROSS], tries = [...offs.map(a => ga + sd * a), ...offs.map(a => ga - sd * a)];
        const room = u => Math.min(...[.5, 1, 1.5, 2].map(t => Math.hypot(c.x + dir[0] * k0 + u[0] * v * t - o.x, c.y + dir[1] * k0 + u[1] * v * t - o.y)));
        const ok = tries.find(a => clear(to(a))); cdir = to(ok ?? tries.sort((p, q) => room(to(q)) - room(to(p)))[0]); }
      this.yaw = viewFor(Math.atan2(cdir[1], cdir[0]), ga); this.camTurn = this.clock + T + .8; // (view.js CAM_TURN: the camera is round by the time the choice opens)
      if (this.wplan?.sc === this.sc && spotKind(this.sc)) this.wplan = null; // (the last play's plan, a run to a ring or a defending choice: its view from above held on through these moments, and swung round as the choice opened)
    }
    const D = [cdir[0] * v, cdir[1] * v];
    // (round 6) The nearest of the other team is already coming as the choice opens: he closes on the ball through
    // these moments (to two and a half metres off it, no nearer: from there the window brings him in), never standing.
    const cm = [...s.agents.values()].filter(a => !a.gk && a.team !== c.team && !(a.beat > s.time + .3)).sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y))[0];
    const cd = cm ? Math.hypot(cm.x - c.x, cm.y - c.y) : 0, cs = cm ? Math.max(0, Math.min(2.4, (cd - 2.5 + (burst ? .6 : 0)) / T)) : 0;
    for (const a of s.agents.values()) {
      if (a.gk) continue;
      const D1 = a === cm && cs > .2 ? [D[0] + (c.x - a.x) / cd * cs, D[1] + (c.y - a.y) / cd * cs] : D;
      const q = st.at[a.id], own = a === c && burst, v0 = own ? [dir[0] * burst, dir[1] * burst] : [q.vx, q.vy], dv = Math.hypot(D1[0] - v0[0], D1[1] - v0[1]), path = { x: a.x, y: a.y, v0, v1: D1, t1: own ? .25 : 0, tau: own ? T - .25 : Math.max(.3, Math.min(T, dv * 1.5 / 3.5 + .1)) };
      a.track = { at: t => pathAt(path, t), t0: s.time, watch: a.team !== c.team, comer: a === cm && cs > .2 }; a.setPath = path;
    }
    // (round 7) Within shooting range of their goal, the one of theirs best placed for it (not the one who comes, not one
    // just beaten) steps across onto the shot's line, three metres off the ball: after a missed tackle the next of them
    // covers the goal, as a team does. So a shot is not left open by the challenge that failed.
    if (c.team === 'us' && L - c.x < 13) { const ce = pathAt(c.setPath, T), ay = clamp(ce.y, gy0 + .8, gy1 - .8), dl = Math.hypot(L - ce.x, ay - ce.y) || 1, k = Math.min(3, dl * .5), B = [ce.x + (L - ce.x) / dl * k, ce.y + (ay - ce.y) / dl * k];
      const bl = [...s.agents.values()].filter(a => !a.gk && a.team !== c.team && a !== cm && !(a.beat > s.time) && a.setPath).sort((p, q) => Math.hypot(p.x - B[0], p.y - B[1]) - Math.hypot(q.x - B[0], q.y - B[1]))[0];
      if (bl && Math.hypot(bl.x - B[0], bl.y - B[1]) < 6 && Math.hypot(bl.x - B[0], bl.y - B[1]) > .4) { const P = bl.setPath, tau = Math.min(T, .5), sT = tau / 2 + (T - tau); let v1 = [P.v0[0] + (B[0] - bl.x - P.v0[0] * T) / sT, P.v0[1] + (B[1] - bl.y - P.v0[1] * T) / sT]; const vl = Math.hypot(v1[0], v1[1]); if (vl > 4.6) v1 = [v1[0] / vl * 4.6, v1[1] / vl * 4.6]; P.v1 = v1; P.tau = tau; P.t1 = 0; } }
    // (round 6) Nobody of the other team ends these moments at the shoulder of the player on the ball: one whose way
    // would bring him nearer than two steps holds off (his way bends off the ball as he slows).
    { const ce = pathAt(c.setPath, T); for (const a of s.agents.values()) { if (a.gk || a.team === c.team || !a.setPath) continue; const e = pathAt(a.setPath, T), d = Math.hypot(e.x - ce.x, e.y - ce.y);
      if (d < 2.2) { for (let n = 0; n < 4; n++) { const q = pathAt(a.setPath, T), dq = Math.hypot(q.x - ce.x, q.y - ce.y); if (dq >= 2.1) break; const k = (2.3 - dq) / (T * .6), l = dq || 1; a.setPath.v1 = [a.setPath.v1[0] + (q.x - ce.x) / l * k, a.setPath.v1[1] + (q.y - ce.y) / l * k]; } } } } // (round 7: until it does hold him off)
    await this.delay(T);
  },
  // (v78) The plan for a scene that is about to be set up: its tries (plannedRunUp: one for each rCap), PLAN_STEPS steps a frame, while
  // the last picture is still on the screen. planHold keeps each, so as the scene is set up plannedRunUp finds them made:
  // the frame it is set up in used to make them all (41 ms on a phone). It plans on a stand-in for the game with that
  // scene in it (the scene as load() makes it), so nothing on the screen changes.
  // (v83) Whether prePlan plans this scene (the others are planned as they are set up: live.js planFrames, or by plannedRunUp).
  prePlanned(sc) { return !!sc && !sc.spots && sc.intro !== 'won' && sc.kind !== 'receive' && sc.kind !== 'lead' && sc.kind !== 'tackle' && sc.run !== 'follow' && kindOf(sc) === 'attack'; },
  // The stand-in for the game that a scene is planned on (see prePlan).
  planGhost(sc) {
    const sim = new this.sim.constructor(); sim.setup(sc);
    return Object.assign(Object.create(this), { sc, sim, timeouts: 0, yaw: sc.shots && sc.shotPlan ? shotLook(sc.heroTo, sc.mates) : 0 });
  },
  async prePlan(sc) {
    if (this.skipping || !this.prePlanned(sc)) return;
    const ghost = this.planGhost(sc);
    const frame = () => { this.realJobs = true; const j = this.job(0); this.realJobs = false; return j.done; }; // (the next frame)
    for (const rCap of [0, 5.2, 4.2, 3.4]) {
      const [s0, st, opts] = ghost.planArgs(false, rCap ? { rCap } : {}); let r = { done: false, it: null }, p = null;
      try { do { await frame(); if (this.skipping) return; r = planSteps(s0, st, opts, PLAN_STEPS, r.it); } while (!r.done); p = r.plan; } catch (e) { console.error(e); return; } // (PLAN_STEPS of it a frame)
      if (!p) break;
      const t = ghost.threatFit(p); if (!t || t.seen || !p.threat || p.rP >= (rCap || 9)) break;
    }
    await frame(); // (and the scene is set up in a frame of its own)
  },
  // (v83) How many frames prePlan takes to plan this scene, counted the way prePlan makes it (the same tries, PLAN_STEPS + 1 steps a
  // frame) but without keeping any plan, and given up on as soon as it is past PLAN_LIMIT. Only the scene says (and the size and
  // the window's length the game plays it with), never how long anything took or what was played before. null: not prePlanned.
  // `spend(n)`: waits for the next frame once PLAN_CHUNK steps of work have been made in this one (over all the scenes), so that
  // finding out is no long frame either.
  async prePlanFrames(sc, spend, cap = PLAN_LIMIT) {
    if (!this.prePlanned(sc)) return null;
    const per = PLAN_STEPS + 1; let frames = 1;
    await spend(2); const ghost = this.planGhost(sc);
    for (const rCap of [0, 5.2, 4.2, 3.4]) {
      await spend(1); const [s0, st, opts] = ghost.planArgs(false, rCap ? { rCap } : {}); let r = { done: false, it: null };
      do { await spend(per); r = planTry(s0, st, opts, PLAN_STEPS, r.it); frames++; if (frames > cap) return frames; } while (!r.done);
      const p = r.plan; if (!p) break;
      await spend(2); const t = ghost.threatFit(p); if (!t || t.seen || !p.threat || p.rP >= (rCap || 9)) break;
    }
    return frames;
  },
  // (v83) The scenes of a match's list that are not left out: one whose plan takes more than PLAN_LIMIT frames would leave the
  // picture still for seconds after a goal (gen-shot-open-110: 30 s). It depends on the scene alone, so the same match plays
  // the same twice, and the next scene is never swapped for another. Found once for each scene (a scene is one object).
  async vetRounds(rounds) {
    if (this.skipping) return rounds;
    const kept = [], frame = () => { this.realJobs = true; const j = this.job(0); this.realJobs = false; return j.done; };
    let left = 0; const spend = async n => { if (left < n) { await frame(); left = PLAN_CHUNK; } left -= n; }; // (PLAN_CHUNK steps of work a frame, over all the scenes)
    for (const sc of rounds) { let f = planCost.get(sc); if (f === undefined) { try { f = await this.prePlanFrames(sc, spend); } catch (e) { console.error(e); f = null; } planCost.set(sc, f); } if (f == null || f <= PLAN_LIMIT) kept.push(sc); }
    return kept.length ? kept : rounds;
  },
  // (v76 SL, review) A match vets its first scene before it starts (vetFirst) and the rest during play (vetRest), a few
  // steps of work a frame (VET_PLAY), so play starts at once after Kick off (a real match's 24 fresh scenes took up to 7.5
  // s of still players). A scene not yet vetted is not picked yet (live.js nextPlanned, bridgePick). vetState: 'ok', 'slow'
  // (left out), or null (not vetted yet).
  vetState(sc) { const f = planCost.get(sc); return f === undefined ? null : f == null || f <= PLAN_LIMIT ? 'ok' : 'slow'; },
  async vetOne(sc, spend) { if (planCost.get(sc) === undefined) { let f; try { f = await this.prePlanFrames(sc, spend); } catch (e) { console.error(e); f = null; } planCost.set(sc, f); } return this.vetState(sc); },
  vetSpend(chunk) { const frame = () => { this.realJobs = true; const j = this.job(0); this.realJobs = false; return j.done; }; let left = 0; return async n => { if (left < n) { await frame(); left = chunk; } left -= n; }; },
  // The first scene of `rounds` that is not left out is moved to the front (rounds is changed in place).
  // (Of the first FIRST.look, the first one quick to plan, FIRST.frames frames or fewer; else the quickest: play starts
  // moving within a few frames of Kick off even after the quickest tap.)
  async vetFirst(rounds) { if (this.skipping) return; const spend = this.vetSpend(PLAN_CHUNK); let best = -1, bf = 1e9;
    for (let i = 0; i < rounds.length && (i < FIRST.look || best < 0); i++) { if ((await this.vetOne(rounds[i], spend)) !== 'ok') continue; const f = planCost.get(rounds[i]) ?? FIRST.frames;
      if (f < bf) { bf = f; best = i; } if (f <= FIRST.frames) break; }
    if (best > 0) rounds.unshift(...rounds.splice(best, 1)); },
  // The rest, in the frames of play; a scene left out is taken out of `rounds` (never the last one). `alive()`: false once the match is over.
  async vetRest(rounds, alive = () => true) { if (this.skipping) return; const spend = this.vetSpend(VET_PLAY);
    for (const sc of [...rounds]) { if (!alive()) return; if ((await this.vetOne(sc, spend)) === 'slow' && rounds.length > 1) { const i = rounds.indexOf(sc); if (i >= 0) rounds.splice(i, 1); } } },
  // ---------- the run-up ----------
  // A lesson's scene: the window's plan first, then a run-up in which everyone already moves as he will in the window
  // (RUNUP s before it opens, less if someone would start well off the pitch): the play drifting on, the threat coming
  // at a jog and speeding up. `extra.during(T)`: what the scene's script does meanwhile (a pass played to him).
  async plannedRunUp(extra = {}) {
    const s = this.sim, sc = this.sc;
    // (v66) The view he chooses in is set now, before the run-up: raised and turned as little as shows the one who comes
    // as he sets off. If no view that keeps his own player big enough shows him from that far, he sets off from nearer.
    let plan = null, tv = null;
    // (v76: the view turns by TURN_MAX at most, view.js threatFit: it looks the way he runs; so where only a view turned
    // farther showed him, he now sets off from nearer)
    for (const rCap of kindOf(sc) === 'attack' ? [0, 5.2, 4.2, 3.4] : [0]) { const p = this.plan(false, rCap ? { ...extra, rCap } : extra); if (!p) break; const t = kindOf(sc) === 'attack' ? this.threatFit(p) : null; if (!plan || t?.seen) { plan = p; tv = t; } if (!t || t.seen || !p.threat || p.rP >= (rCap || 9)) break; }
    this.wplan = plan;
    if (!plan) return;
    plan.sc = sc;
    {
      let T = RUNUP; const far = id => { const q = pathAt(plan.paths[id], -T); return q.x < -1.5 || q.x > L + 1.5 || q.y < -1.5 || q.y > W + 1.5; };
      while (T > .5 && Object.keys(plan.paths).some(far)) T = Math.round((T - .1) * 10) / 10;
      plan.openAt = s.time + T; // (when the choice opens: the view is set for it from now on, view.js spotView)
      s.dead = !!sc.restart; s.reactFrom = null; s.aliveCap = 1; for (const a of s.agents.values()) a.aliveK = 1; // (alive-shape: at a dead ball the players stand, pro/motion.js ALIVE; the run-up goes as the plan says)
      for (const [id, p] of Object.entries(plan.paths)) {
        const a = s.a(id); if (!a) continue;
        const q = pathAt(p, -T), v = Math.hypot(q.vx, q.vy);
        Object.assign(a, { x: q.x, y: q.y, tx: q.x, ty: q.y });
        if (v > .1 && !a.gk && !plan.watch.has(id)) a.face = [q.vx / v, q.vy / v];
        else if (plan.watch.has(id) || a.gk) { const h = plan.paths[sc.carrier || 'hero'] || plan.paths.hero, hq = h && pathAt(h, -T); if (hq) { const dx = hq.x - a.x, dy = hq.y - a.y, l = Math.hypot(dx, dy) || 1; a.face = [dx / l, dy / l]; } }
        a.track = { at: tt => pathAt(p, tt - T), t0: s.time, watch: plan.watch.has(id), comer: id === plan.threat?.id || id === plan.second }; // (comer: pro/motion.js leaves his run as it is)
      }
      const c = s.a(s.ball.carrier);
      if (c) { Object.assign(s.ball, { x: c.x + c.face[0] * .4, y: c.y + c.face[1] * .4, h: Math.atan2(c.face[1], c.face[0]) }); c.d0 = c.dist; c.tA = 0; c.tN = 0; }
      if (tv) { plan.wideK = tv.k; plan.seen = tv.seen; if (tv.off) this.yaw += tv.off; }
      extra.frame?.(id => pathAt(plan.paths[id] || { x: s.a(id).x, y: s.a(id).y, v0: [0, 0], v1: [0, 0] }, 0)); // (the way he looks as the choice opens, set now: the view is fitted for it before the run-up)
      await Promise.all([this.delay(T), extra.during?.(T)]);
      plan.ready = true;
    }
  },

  // (round 6) A match: his shot was blocked and the ball lies loose (live.js toRebound). The choice has a window like
  // any other: everyone goes on as he was going, easing up; their nearest player to the ball comes for it at a jog (and
  // is still a step and more short of it as the ring empties: then he races for it, outcomes.js raceForIt).
  reboundPlan() {
    const s = this.sim, sc = this.sc, st = this.liveState(), lo = { x: sc.shot.loose[0], y: sc.shot.loose[1] };
    const G = Math.max(.6, PACE * (Math.min(this.windowReal(), this.windowMin()) - .1) + .12);
    const racer = s.team('them').filter(o => !o.gk).sort((p, q) => Math.hypot(p.x - lo.x, p.y - lo.y) - Math.hypot(q.x - lo.x, q.y - lo.y))[0];
    const end = Object.fromEntries(Object.entries(st.at).map(([id, a]) => [id, [a.x + (a.vx || 0) * .25, a.y + (a.vy || 0) * .25]]));
    if (racer) { const a = st.at[racer.id], d = Math.hypot(lo.x - a.x, lo.y - a.y) || 1, k = Math.max(0, Math.min(d - 1.4, 2.4 * G)) / d; end[racer.id] = [a.x + (lo.x - a.x) * k, a.y + (lo.y - a.y) * k]; }
    const p = planLive(st, end, G, racer?.id); p.live = false; p.threat = racer ? { id: racer.id, to: sc.shot.loose } : null;
    return p;
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
    const think = (this.toStreak || 0) >= 3 ? 'relaxed' : this.thinkTime?.() || 'normal', v = windowSeconds({ level: Math.max(1, lv), first: !!this.firstRound, think, retry: this.timeouts || 0 });
    return sc?.live && sc.kind === 'receive' ? Math.max(v, LIVE_PASS * windowFloor({ level: 3, think }) / 4.5) : v; // (round 7: a pass to him in a match: 5 s at Normal, not the bare floor)
  },
  // The shortest this choice's window may be cut to (window.js windowFloor), with the same level and setting as windowReal.
  windowMin() {
    const sc = this.sc, id = sc?.live ? this.idea?.() : sc?.skill, lv = this.levelOf?.(id) ?? (this.mode === 'lesson' ? 1 : 3);
    const think = (this.toStreak || 0) >= 3 ? 'relaxed' : this.thinkTime?.() || 'normal', v = windowFloor({ level: Math.max(1, lv), first: !!this.firstRound, think });
    return sc?.live && sc.kind === 'receive' ? Math.max(v, LIVE_PASS * windowFloor({ level: 3, think }) / 4.5) : v;
  },
  openWindow() {
    const s = this.sim, sc = this.sc;
    this.closeWindow();
    if (kindOf(sc) === 'tackle') return;
    const fromRunUp = !!(this.wplan?.ready && this.wplan.sc === sc), plan = fromRunUp ? this.wplan : kindOf(sc) === 'follow' ? (sc.live ? this.reboundPlan() : this.followPlan()) : this.plan(true);
    if (!plan) return;
    plan.sc = sc; plan.ready = false; this.wplan = plan; // (kept: a retry of this choice opens the same window again)
    s.dead = !!sc.restart; s.reactFrom = null; if (!fromRunUp) { s.aliveCap = 1; for (const a of s.agents.values()) a.aliveK = 1; } // (alive-shape: at a dead ball the players stand until it is played, pro/motion.js ALIVE; in the window everyone goes as its plan says; what the run-up's check found holds on)
    // (v66) The world never goes slower than PACE: a short piece of play is a shorter window (a tight scene is a quick one).
    const show = this.mode === 'demo' ? SHOW.demo : this.showing ? SHOW.replay : 0, G = plan.G, Rp = (G - .1) / PACE + .1, Rm = show ? 0 : Math.min(this.windowReal(), this.windowMin()), // (round 7: a stretch of play a tenth of a second short of the window's floor is shown that much slower, not cut under it)
      R = Math.max(G, Math.min(show || this.windowReal(), plan.jock && !show ? JOCK.R : 99, Rp < Rm && Rp > Rm - .2 ? Rm : Rp));
    this.spotsReset();
    // (round 6) One who jockeys goes in over the last half second: the world speeds up with him (skill.js skillPace), and
    // the pace before that is the one that makes the whole window last R.
    this.win = { plan, G, R, f: plan.jock ? jockPace(G, R) : Math.max(PACE * .96, Math.min(1, (G - .1) / Math.max(.5, R - .1))), jock: !!plan.jock, t0: s.time, real: 0, threat: plan.threat, kind: kindOf(sc), spots0: this.spot0 || [], at0: {} };
    // (round 2) A pass coming to him from live play: he meets it where it is going, a small step behind where it stops,
    // as it gets there (not on with the play, a metre off it).
    const b = s.ball, h = s.a('hero');
    if (plan.live && kindOf(sc) === 'receive' && b.state === 'flying' && h && plan.paths.hero) {
      const T = Math.max(.2, (1 - b.t) * b.dur), dx = b.tx - b.fx, dy = b.ty - b.fy, l = Math.hypot(dx, dy) || 1, E = [b.tx + dx / l * .45, b.ty + dy / l * .45], q = pathAt(plan.paths.hero, 0);
      if (Math.hypot(E[0] - h.x, E[1] - h.y) < 2.5) plan.paths.hero = { herm: true, S: [h.x, h.y], V0: [q.vx, q.vy], E, V1: [0, 0], T };
    }
    // (a window from play going on, a match: its view is fitted now, and the camera goes over to it slowly: no lurch)
    if ((plan.live || plan.fromLive) && plan.hold && !plan.viewSet) { plan.viewSet = true;
      // (v76) His own player on the ball: the view looks the way the plan has him carry it (viewFor; settle has set it so
      // already), so he never crosses the screen sideways.
      if (kindOf(sc) === 'attack' && s.ball.carrier === 'hero' && plan.paths.hero) { const q = pathAt(plan.paths.hero, 0), h = s.a('hero'); if (h && Math.hypot(q.vx, q.vy) > .6) this.yaw = viewFor(Math.atan2(q.vy, q.vx), Math.atan2(W / 2 - h.y, L - h.x)); }
      if (kindOf(sc) === 'attack') { const tv = this.threatFit(plan); plan.wideK = tv.k; plan.seen = tv.seen; } this.camSlow = 2; }
    { const h0 = s.a('hero'); if (h0) { h0.calmTouch = !!plan.calm && s.ball.carrier === 'hero'; if (h0.calmTouch && !s.ball.move) { h0.tA = h0.dist - (h0.d0 || 0); h0.tL = .4; } } } // (v78: no pressure: small touches from now, sim.js calmTouch; window.js CALM)
    for (const [id, p] of Object.entries(plan.paths)) {
      const a = s.a(id); if (!a) continue;
      this.win.at0[id] = plan.at0?.[id] || { x: p.x, y: p.y }; // (rings that go with a player: from the scene's own picture)
      a.track = { at: t => pathAt(p, t), t0: s.time, watch: plan.watch.has(id), jf: p.jock ? t => jockFeint(p, t) : null, comer: id === plan.threat?.id || id === plan.second }; // (jf: a jockey's feint lunges, drawn by pro/motion.js; comer: the one who comes, whose run pro/motion.js leaves as it is)
    }
  },
  // Each step of game time while it is open: the rings that belong to a player move with him, and when the threat gets
  // there he takes it.
  windowStep() {
    const w = this.win, s = this.sim;
    // (alive-shape) In the run-up the small moves are already graded (aliveGuard), on the picture the window will open
    // on: what is drawn as it opens holds.
    if (!w) { const p = this.wplan; if (p?.hold && p.sc === this.sc && !p.ready && p.openAt != null && this.phase === 'pre' && !((this.realTime || 0) - (p.gT ?? -9) < GUARD_DT)) { p.gT = this.realTime || 0; const q = {}; this.aliveGuard({ plan: p, t: 0, at0: p.at0 || {}, spots0: [], base: id => (p.paths[id] ? pathAt(p.paths[id], 0, q[id] ||= {}) : s.a(id)) }); } return; } // (graded on the picture the window will open on: everyone where its plan has him then)
    if (this.phase !== 'decide') { this.closeWindow(); return; }
    s.view = this.yaw; s.prate = this.prate ?? 1; // (alive-shape: the view and the picture's pace, for pro/motion.js ALIVE)
    if (w.plan.hold && !((this.realTime || 0) - (w.gT ?? -9) < GUARD_DT)) { w.gT = this.realTime || 0; this.aliveGuard(w); } // (from its very first step, then every GUARD_DT s of real time)
    if (w.spots0.length && this.sc.spots) {
      const at0 = id => w.at0[id] || s.a(id), now = spotsNow({ ...this.sc, spots: w.spots0 }, id => s.a(id), at0);
      this.sc.spots.forEach((sp, i) => { if (now[i]) { sp.x = now[i].x; sp.y = now[i].y; } });
    }
    w.u = (s.time - w.t0) / w.G;
    // (v76) A demo or a replay of the better play (demo.js showClock): the pace that brings play to the share of the window
    // its choice is planned at, just as the hand taps it. Never slower than an eighth of the slowest window pace (a demo's crawl).
    if (w.demo?.crawl != null) w.f = w.demo.crawl; // (v76: a demo's idea being said: play crawls on, demo.js crawlFor)
    else if (w.demo?.eta != null) { const left = w.demo.u * w.G - (s.time - w.t0), real = w.demo.eta - w.real; w.f = clamp(left / Math.max(.3, real), PACE * .125, 1); }
    if (w.u >= 1 && !w.out) { w.out = true; if (this.mode !== 'demo' && !this.showing) { this.choose('timeout'); this.woke = true; } } // (the frame steps no further: the play that follows goes on from this very step)
  },
  // (alive-shape) The small moves off the ball (pro/motion.js ALIVE) are drawn, not played: the game's own places, from
  // which every choice is graded, do not move. Their size is well inside the slack the grades are read with, but a scene
  // built right up to a line (and a defending scene's spots, read with none) can tip. So from the window's first step,
  // and every GUARD_DT s of real time after, the picture is graded as it will be drawn: everyone where his own move now takes him, GUARD times as far (ahead of
  // time, with room to spare). A choice that would look other than its grade, and does not already in the game's own
  // places, halves the moves of the player whose move does it, for the rest of the window (a.aliveK; none after three
  // halvings), or everyone's if no one alone does it (sim.aliveCap). Cheap: one grading (0.06 ms here at 5v5, 0.2 ms at
  // the most but for one step in a hundred), only where somebody is moving round his place; in the rare step that finds
  // one, one more for each player tried until the one who does it.
  aliveGuard(w) {
    const s = this.sim, cap = s.aliveCap ?? 1; if (cap <= 0) return;
    let any = false; for (const a of s.agents.values()) if (a.alive && (a.alive[2] || a.alive[3])) { any = true; break; } if (!any) return;
    const sc = this.sc.spots && w.spots0.length ? { ...this.sc, spots: w.spots0 } : this.sc, t = w.t ?? s.time - w.t0, opts = { options: this.offerList(), ids: [...s.agents.values()].filter(a => !a.gk).map(a => a.id), ball: s.ball, at0: id => w.at0[id] || s.a(id) };
    const base = w.base || (id => s.a(id)), at = only => id => { const a = s.a(id), b = base(id), q = a.alive; return q && (!only || only === id) ? { x: b.x + q[2] * GUARD, y: b.y + q[3] * GUARD } : b; }, worse = (r, was) => [...r.dis, ...r.threat].some(o => !was.has(o));
    const drawn = agreeAt(sc, w.plan, at(null), t, opts); if (!drawn.dis.length && !drawn.threat.length) return;
    const own = agreeAt(sc, w.plan, base, t, opts), was = new Set([...own.dis, ...own.threat]); if (!worse(drawn, was)) return;
    const half = k => (k > .2 ? k / 2 : 0);
    // (the one whose move goes farthest first; the first found is enough this step: the next looks again)
    const movers = [...s.agents.values()].filter(a => a.alive && (a.alive[2] || a.alive[3])).sort((p, q) => Math.hypot(q.alive[2], q.alive[3]) - Math.hypot(p.alive[2], p.alive[3]));
    const who = movers.find(a => worse(agreeAt(sc, w.plan, at(a.id), t, opts), was));
    if (who) who.aliveK = half(who.aliveK ?? 1); else s.aliveCap = half(cap);
  },
  // His choice (or the time-out) ends the window: everyone goes on as he was going until the play moves him.
  closeWindow() {
    const w = this.win; if (!w) { this.sim.untrackAll(); return; } // (a play may start straight after a run-up: the tests)
    this.lastWin = { u: Math.min(1, w.u || 0), real: w.real, R: w.R, G: w.G }; this.lastThreat = w.threat?.id || null; { const h0 = this.sim.a('hero'); if (h0) h0.calmTouch = false; }
    this.sim.untrackAll(!!this.sc?.live); this.win = null; this.sim.dead = false; this.sim.view = null; this.sim.prate = 1; this.sim.aliveCap = 1; for (const a of this.sim.agents.values()) a.aliveK = 1; this.sim.reactFrom = this.mode === 'match' || this.mode === 'free' ? null : this.sim.time + .6; // (alive-shape: from a moment after the choice, nobody stays rooted while the ball goes by: sim.js react. A lesson's and a demo's play: in a match the team's shape moves everyone already, and how a match goes on is left as it was) // (in a match: two left overlapping step apart over a few frames, sim.js)
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
    out.left = w.demo ? (w.demo.crawl != null ? clamp(1 - w.demo.drain * (w.real - w.demo.r0) / w.demo.sec, .6, 1) : clamp((w.demo.L0 ?? 1) * (1 - ((w.u || 0) - w.demo.u0) / (1 - w.demo.u0)), 0, 1)) : /* (v76: a demo's ring: slowly while its idea is said, then on from there; demo.js crawlFor, showClock) */ w.jock ? clamp(Math.min(1 - w.real / w.R, 1 - (w.u || 0) * .02), 0, 1) : clamp(1 - (w.u || 0), 0, 1); // (round 6: the ring empties with real time: where the world speeds up at the end, the ring does not)
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
