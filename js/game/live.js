// Matches and free play: one play runs on into the next from wherever everyone stands, and each new decision
// (on the ball, defending, getting open, receiving, a 1v1) is built from the live positions.
import { pickRounds, skillById } from '../skills.js';
import { lerp, clamp, dist, interceptor, dribbleEnd, shuffle, closestOnLane, DRIBBLE_DIRS } from '../geom.js';
import { grade, pushEnd, goalSide, exploit, laneClear, laneBlocked, inPitch, moreSpots, OKAY, RING_GAP } from '../generate.js';
import { L, W, gy0, gy1, MATES, ROSTER, wrap, faceTo } from './shared.js';
import { planHold, planSteps, rolesOf, pathAt, hermAt, kindOf } from '../window.js';
// His friends' and their players' places, m1 m2 (m3) and o1 o2 o3 (o4): as many as the team size has.
const friends = s => MATES.filter(id => s.a(id)).map(id => [s.a(id).x, s.a(id).y]), foes = s => s.team('them').map(a => [a.x, a.y]);

// ---------- a new situation from play going on (v82) ----------
// The owner (v81): "Whenever you make a decision and all of a sudden it fades out and there's a new scenario, it's really
// confusing what happened." A match used to cut to a fresh scene after five plays without a goal (about 30 s), and the
// moment he won the ball before "Won it? Go!". Now play goes on for STALL real seconds without a goal, and then (or when
// he wins the ball before that lesson) a real piece of soccer, played on screen with the same players, brings in the new
// situation (bridgeTo): the ball goes out and a friend takes the pass-in, it goes out behind our goal for a goal kick,
// our keeper catches their shot, a foul and a free kick, one team wins it off the other, or a pass on. Everyone then runs
// to his place in the new picture and the camera follows. Only a goal (and the start) still cuts, to the next scene.
export const STALL = 60;
const BRIDGE = { vMax: 5.4, T: [1, 2.8], run: 10.5, wait: .15, max: 4, min: 2, ahead: 4 }; // the run to the new picture: fastest drawn speed (m/s), its length (s), the farthest anyone runs (m); how long it waits for its plan after the event (s); the longest and shortest it all takes (s); how many of the next scenes it picks from
const FRAME_STEPS = 60; // (planFrames: steps of these plans a frame, 0.01 to 0.05 ms each here, never 3 ms in all: a scene with rings takes 2 to 1850 steps)
export const SIDE_IN = new Set(['side-in', 'side-take', 'side-pass', 'side-two']);
// A scene that can be reached from play: one whose run-up is a planned one (game/window.js plannedRunUp: with a pass to
// him, a friend's run for a pass in front), or a 1v1 (everyone to his place, the attacker on the ball). Not one with an
// intro of its own (he wins the ball: "Won it? Go!"; a shot that comes back out: "Follow your shot!"). A kick-off only
// follows a goal.
export const bridgeable = sc => !!sc && !sc.intro && sc.run !== 'follow' && sc.pattern !== 'kick-off';
export const sceneTeam = sc => { const c = sc.carrier || 'hero'; return c[0] === 'o' || c === 'k2' ? 'them' : 'us'; };
const perms = n => (n ? perms(n - 1).flatMap(p => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)])) : [[]]);
// Who of a team goes to which place: the way that keeps the longest run shortest (then the runs' sum). { map: { id: new id }, max }
// fix: [id, new id], one who must go to that place (the one with the ball, to the place of the one who has it there).
function assign(ids, from, to, fix = null) {
  let best = null; const fi = fix ? ids.indexOf(fix[0]) : -1, fj = fix ? ids.indexOf(fix[1]) : -1;
  for (const p of perms(ids.length)) { if (fi >= 0 && fj >= 0 && p[fi] !== fj) continue; let max = 0, sum = 0; for (let i = 0; i < ids.length; i++) { const d = Math.hypot(from[i].x - to[p[i]].x, from[i].y - to[p[i]].y); max = Math.max(max, d); sum += d; }
    if (!best || max < best.max - .01 || (max < best.max + .01 && sum < best.sum)) best = { p, max, sum }; }
  return { map: Object.fromEntries(ids.map((id, i) => [id, ids[best.p[i]]])), max: best.max };
}

// A decision built from wherever play is right now (continuous matches). The best choice is the good option that
// moves the ball farthest toward goal; other good options also earn 3 stars; backing away into space is "safe".
// (v66) `near`: { id, x, y }: the one of theirs who is coming for the ball, taken where he will be when he has closed on
// it (on the bearing he comes from): a choice is right or wrong by where he comes from, not by how far off he still is.
function liveScenario(s, skill, pushAllowed, near = null, back = null) { // back: the index (0 for m1) of the friend the ball has just come from
  const at = a => (near && a.id === near.id ? near : a), P = a => [at(a).x, at(a).y], h = s.a('hero'), foes = s => s.team('them').map(P);
  const sc = { id: 'live', skill, kind: 'attack', live: true, hero: P(h), heroTo: P(h), mates: friends(s),
    opps: foes(s) };
  sc.oppsTo = sc.opps;
  // Score each good option by how far it moves the ball toward goal. At this age staying on the ball comes first
  // (FA foundation phase), so a pass is the best answer only when it gains clearly more than running with it.
  const g = grade(sc);
  // Passes in live play: open unless a defender is in the lane or really on the receiver. A defender behind the
  // receiver (on his far side from the ball) only counts if he's right on him; the receiver is between him and the ball.
  const opps = s.team('them').map(at);
  sc.mates.forEach((m, i) => {
    const mate = s.a('m' + (i + 1)), d = interceptor(s.ball, mate, opps).d;
    const marked = opps.some(o => { const r = dist(o, mate); if (r < 1.2) return true; const behind = (o.x - mate.x) * (s.ball.x - mate.x) + (o.y - mate.y) * (s.ball.y - mate.y) < 0; return r < 1.8 && !behind; });
    g['pass:' + i] = d > 1.1 && !marked ? 'good' : 'bad';
  });
  const gain = o => o === 'shoot' ? 99 : (o.startsWith('pass:') ? sc.mates[+o[5]][0] - 1.5 : (o.startsWith('push:') ? pushEnd(h, o.slice(5)) : dribbleEnd(h, o.slice(5), L, W)).x) - h.x;
  const goods = Object.keys(g).filter(o => g[o] === 'good' && (pushAllowed || !o.startsWith('push:'))).sort((a, b) => gain(b) - gain(a));
  // (round 7) The pass straight back to the friend the ball has just come from is never the best answer while something
  // else is on (a run with it, a shot, another friend): no passing it back and forth between two players.
  if (back != null && goods.length > 1 && goods[0] === 'pass:' + back) goods.push(goods.shift());
  sc.grades = g; sc.best = goods[0] || null; sc.ok = goods.slice(1); sc.safe = Object.keys(g).filter(o => g[o] === 'safe');
  sc.cue = !sc.best ? 'That was a tough spot!' : sc.best === 'shoot' ? 'Close to the goal and nobody in the way. Shoot!' : sc.best.startsWith('pass:') ? `{m${sc.best[5]}} was open!`
    : sc.best.startsWith('push:') ? 'Lots of space! Push it and go!' : 'There was space to run into!';
  return sc;
}
// (round 6) The jobs his friends take once he has chosen (id: 'home' or 'chase': he goes to the ball; one of theirs:
// he guards that player): { friendId: { job: 'press' | their player's id, to: [x, y] } }. If he goes, nobody else does:
// each friend takes the nearest of theirs that nobody has, goal-side. If he guards, the friend nearest the ball goes to
// it and the rest guard. A friend with nobody left stays as he is.
export function teamJobs(s, c, others, fr, id) {
  const P = a => [a.x, a.y], jobs = {}, goes = id === 'home' || id === 'chase', left = new Set(fr.map(m => m.id)), taken = new Set(goes ? [] : [id]);
  if (!goes && fr.length) { const m = [...fr].sort((p, q) => dist(p, c) - dist(q, c))[0]; jobs[m.id] = { job: 'press', to: goalSide(P(c), 2.2) }; left.delete(m.id); }
  // (their players nearest our goal first: the most dangerous is guarded first)
  for (const o of [...others].sort((p, q) => p.x - q.x)) { if (taken.has(o.id)) continue; const to = goalSide(P(o), 1.2), m = fr.filter(m => left.has(m.id)).sort((p, q) => Math.hypot(p.x - to[0], p.y - to[1]) - Math.hypot(q.x - to[0], q.y - to[1]))[0];
    if (!m || Math.hypot(m.x - to[0], m.y - to[1]) > 14) continue; jobs[m.id] = { job: o.id, to }; left.delete(m.id); taken.add(o.id); }
  return jobs;
}
// A defending decision built from wherever play is right now (after we lose the ball in a match). Spots: get in
// front of the ball, guard each attacker, or chase from behind. A spot is right when it leaves the attackers no
// open run or pass (the same check the defense lessons use). null when no spot can stop them.
function liveDefense(s, guard = true) {
  const c = s.a(s.ball.carrier); if (!c || c.team !== 'them') return null;
  const P = a => [a.x, a.y], h = s.a('hero'), others = s.team('them').filter(o => o.id !== c.id);
  const mates = friends(s), near = (p, k) => mates.some(m => Math.hypot(m[0] - p[0], m[1] - p[1]) < k);
  const ok = ([x, y]) => x > 1 && x < L - 1 && y > 1 && y < W - 1;
  const cand = [{ id: 'home', p: goalSide(P(c), 2.6), label: 'In front' },
    ...(guard ? others.filter(o => others.filter(q => dist(q, h) < dist(o, h)).length < 2).map(o => ({ id: o.id, p: goalSide(P(o), 1.2), label: near(P(o), 2) ? 'Help guard' : 'Guard' })) : []), // "Guard" spots come with One goes, one guards (the two of theirs nearest him: four rings at any size)
    { id: 'chase', p: [c.x + 1.3, c.y], label: 'Behind him' }];
  const spots = [];
  for (const sp of cand) if (ok(sp.p) && dist({ x: sp.p[0], y: sp.p[1] }, h) > 1 && spots.every(t => Math.hypot(t.x - sp.p[0], t.y - sp.p[1]) > 2.2)) spots.push({ id: sp.id, x: sp.p[0], y: sp.p[1], label: sp.label });
  const sc = { id: `live-def-${Math.round(c.x * 10)}-${Math.round(c.y * 10)}`, kind: 'defense', live: true, carrier: c.id, oppIds: [c.id, ...others.map(o => o.id)],
    hero: P(h), heroTo: P(h), mates, opps: [P(c), ...others.map(P)], spots, ok: [] };
  sc.oppsTo = sc.opps;
  // (round 6) "One goes, one guards", as the lesson teaches it. Whoever of ours is nearest the ball goes to it; the
  // others each take a player or cover. So a spot is judged with his friends doing the other jobs (teamJobs): if he
  // goes to the ball, they stay with their players; if he guards, the friend nearest the ball goes. And going to the
  // ball is the best answer only when his player is our nearest to it by a clear metre; when a friend is nearer by a
  // metre it never is (at most okay: "Your friend was closer. You guard!"); when it is close, both are fine.
  const fr = MATES.filter(id => s.a(id)).map(id => s.a(id)), dH = dist(h, c), nm = [...fr].sort((p, q) => dist(p, c) - dist(q, c))[0], dM = nm ? dist(nm, c) : 99;
  const heroNearest = dH < dM - .6, mateNearest = dM < dH - .6, /* (round 7: .6, not 1: the players move a step before the window opens, and what he sees then must never contradict the answer by a metre) */ go = id => id === 'home' || id === 'chase';
  sc.jobs = Object.fromEntries(spots.map(sp => [sp.id, teamJobs(s, c, others, fr, sp.id)]));
  sc.exploits = Object.fromEntries(spots.map(sp => [sp.id, exploit({ ...sc, mates: fr.map(m => sc.jobs[sp.id][m.id]?.to || P(m)) }, sp.id)]));
  sc.nearest = heroNearest ? 'hero' : mateNearest ? nm.id : 'close';
  const goods = spots.filter(sp => !sc.exploits[sp.id]).map(sp => sp.id), guards = goods.filter(g => !go(g));
  // (a guard spot by a player nobody of ours is on comes before helping a friend guard)
  const open = id => { const o = s.a(id); return o ? Math.min(99, ...fr.map(m => dist(m, o))) : 0; }; guards.sort((p, q) => open(q) - open(p));
  if (spots.length < 2) return null;
  // (round 7) The rule holds on what he sees, with no way round it. His player plainly the nearest: the best answer is
  // to go to the ball (the ring in front of it), and it is a right answer: his friends guard (teamJobs), and what the
  // play then shows is him stopping the ball. A friend plainly the nearest: the best answer is a guard ring that stops
  // them. Where the picture offers no such ring (no ring in front of the ball; no guard ring that works), there is no
  // fair choice to ask for, and play runs on.
  const hasHome = spots.some(sp => sp.id === 'home');
  if (heroNearest) { if (!hasHome) return null; sc.exploits.home = null; if (!goods.includes('home')) goods.unshift('home'); }
  if (mateNearest && !guards.length) return null;
  if (!goods.length) return null;
  const best = mateNearest ? guards[0] : goods.includes('home') ? 'home' : guards[0] || goods[0];
  if (goods.length === spots.length && !mateNearest && !heroNearest) return null; // (every spot stops them and nobody is plainly the nearest: no real choice)
  sc.best = 'spot:' + best; sc.ok = goods.filter(g => g !== best).map(g => 'spot:' + g);
  sc.cue = mateNearest ? (go(best) ? 'Your friends had it covered. Stay close!' : 'Your friend was closer to the ball. You guard!') : best === 'home' ? (heroNearest ? 'You were the closest to the ball. You go!' : 'Nobody was in front of the ball. Get in front!') : best === 'chase' ? 'Your friends had it covered. Stay close!' : 'A friend was on the ball. Guard the open player!';
  return sc;
}

export const live = {
  // Hand control to teammate `id`: the sim's "hero" slot takes over his body, position and the ball.
  takeOver(id) {
    if (id === 'hero') return;
    const s = this.sim, h = s.a('hero'), m = s.a(id);
    for (const k of ['x', 'y', 'tx', 'ty', 'speed', 'sp', 'dist', 'd0', 'tA', 'tL', 'tN', 'kickAt', 'kickKind', 'kickFoot', 'face']) [h[k], m[k]] = [m[k], h[k]];
    if (s.ball.carrier === id) s.ball.carrier = 'hero';
    this.world.swapRigs('hero', id);
    const r = this.roster; [r.hero, r[id]] = [r[id], r.hero];
    this.glide = 1; // the camera glides over to his new player instead of jumping there
  },
  // Continue a match from wherever the last play ended: a defender steps up, then he makes the next choice.
  async continueLive() {
    const s = this.sim, c = s.a(s.ball.carrier);
    // (round 7: the friend who has just played it to the player he now is: after taking over a friend, that is the body he was, which now has the friend's id)
    if (c && c.team === 'us' && c.id !== 'hero') this.cameFrom = c.id; else if (!this.gotBack) this.cameFrom = null; this.gotBack = false;
    if (c && c.team === 'us') this.takeOver(c.id);
    const h = s.a('hero');
    if (this.sc?.kind === 'defense' || this.sc?.kind === 'tackle') this.playLook = false; // (v78: we have just won it: a new spell of our ball starts head-down)
    this.beginStep({ seen: new Set(), lookUp: false, drag: null, scanned: false, yaw: 0 });
    h.face = [1, 0];
    if (this.sc?.kind === 'tackle') this.sc = { ...this.sc, kind: 'attack' }; // after winning a 1v1: back to the normal view and buttons
    // (v66) Nobody stops and nobody is put anywhere: everyone comes over to moving with the play, and the choice opens
    // from that picture. The nearest free defender is the one who comes, from wherever he is (game/window.js).
    await this.settle(.7);
    // The picture the choice is graded from: where everyone is now, with the one who comes taken where he will have
    // closed on the ball (2.3 m off it, on the bearing he comes from). He himself runs in from where he is.
    const st = this.liveState(), P = { at: Object.fromEntries(Object.entries(st.at).map(([id, a]) => [id, { ...a }])), ball: st.ball };
    let near = null;
    try { const th = rolesOf({ kind: 'attack' }, st.at).th, t = th && st.at[th], bx = h.x + .5, d = t ? Math.hypot(t.x - bx, t.y - h.y) : 0;
      if (t && !t.gk && d > 2.5) { near = { id: th, x: bx + (t.x - bx) / d * 2.3, y: h.y + (t.y - h.y) / d * 2.3 }; P.at[th].x = near.x; P.at[th].y = near.y; } } catch (e) { console.error(e); }
    this.sc = liveScenario(s, this.sc?.skill, this.pushAllowed, near, this.cameFrom && MATES.includes(this.cameFrom) && s.a(this.cameFrom) ? MATES.indexOf(this.cameFrom) : null);
    if (near) { let plan = null; this.heavyAt = this.frameNo | 0; try { plan = planHold(this.sc, P, { R: this.windowReal(), Rfloor: this.windowMin(), options: this.offerList(), from: st.at, lead: 0, yaw: this.yaw }); } catch (e) { console.error(e); }
      // (round 7: only a plan in which he does run in from where he is: one that could not find him a run has him in his
      // place in the picture, a jump of metres as the choice opens; then the window is planned from where everyone is)
      const tp = plan?.threat?.id === near.id && plan.paths[near.id], t0 = tp && pathAt(tp, 0, {}), ta = s.a(near.id);
      if (plan && t0 && Math.hypot(t0.x - ta.x, t0.y - ta.y) < .2) { plan.sc = this.sc; plan.live = false; plan.fromLive = true; plan.ready = true; this.wplan = plan; }
      // (frame time: the plan from where everyone is, is made in the next frame, not in this one too)
      else await this.delay(.001); }
  },

  // After we lose the ball in a match: our team gets back into shape for a moment, then he decides where to run.
  // If no spot could stop them, the play just runs on and the geometry decides what happens.
  async continueDefense() {
    const s = this.sim, c = s.a(s.ball.carrier);
    this.returns = 0; this.cameFrom = null; // (their ball: the move is over)
    const choose = this.has('get-goal-side'), guard = this.has('one-goes'); // (saves that had "Guard the open player" have "One goes, one guards": progress.js MERGED)
    this.playLook = false; // (v78: their ball: defending starts head-down, game.js beginStep)
    this.beginStep({ seen: new Set(), lookUp: false, drag: null, scanned: false, roles: null, ai: true, scripted: new Set(['hero', c.id]), ballTeam: 'them' });
    const h = s.a('hero');
    this.sc = { kind: 'defense', carrier: c.id, spots: [] };
    this.yaw = Math.atan2(c.y - h.y, c.x - h.x); this.faceYaw(h);
    s.go(c.id, Math.max(7, c.x - 2.5), lerp(c.y, W / 2, .3), 3.3); s.go('hero', h.x - 1.2, h.y, 3.3); // (v62: quicker, same places)
    await this.delay(.45); this.ai = false; await this.settle(.5); // (v64: nobody stops; v66: the choice opens with everyone moving on with the play, so its picture holds)
    const sc = choose ? liveDefense(s, guard) : null;
    if (sc) { this.sc = sc; this.yaw = this.frameYaw(sc, h, c); return true; }
    // No fair choice: play it out from where everyone stands.
    const stay = { kind: 'defense', live: true, id: 'live-stay', carrier: c.id, oppIds: [c.id, ...s.team('them').filter(o => o.id !== c.id).map(o => o.id)],
      mates: friends(s), spots: [{ id: 'stay', x: h.x, y: h.y }] };
    stay.oppsTo = [[c.x, c.y], ...stay.oppIds.slice(1).map(id => [s.a(id).x, s.a(id).y])];
    stay.exploits = { stay: exploit(stay, 'stay') };
    this.sc = stay; await this.outcome('spot:stay', !stay.exploits.stay);
    return false;
  },

  async match(skillIds, extra = [], toWin = 2, mode = 'match', keep = null) { // keep: which situations may come up (v64: the mini match, at his level)
    this.mode = mode;
    const score = { us: 0, them: 0 }; this.hud.score(score, this.us, this.them);
    const rounds = shuffle([...pickRounds(skillIds, 6), ...extra].filter(sc => !keep || keep(sc)));
    this.warm?.(rounds); // (round 11: the lines this match can say are loaded now, ui/voicewarm.js)
    // Play flows on from wherever the last play ended: after "Kept the ball!" or "Stole it!" the next choice starts from
    // right there; after a lost ball he defends from there; after "Stopped him!" he defends again. A goal (and the start)
    // cuts to the next scene, the break the game shows as one. After STALL s of play without a goal, and when he wins the
    // ball before "Won it? Go!", a piece of play on screen brings in the next situation (bridgeTo; v82: it used to cut
    // after four plays without a goal, about 30 s, and at once after a won ball).
    let live = false, next = 0, streak = 0, since = this.realTime || 0, early = null;
    const isGoal = () => this.result === 'goal' || this.result === 'goalAgainst';
    this.missed = {}; this.misses = 0; this.timeoutsInMatch = 0; this.cued = new Set(); this.hintNext = null; this.choiceLog = 'match'; this.firstRound = false; this.timeouts = 0;
    const tally = () => { if (this.result === 'goal') score.us++; else if (this.result === 'goalAgainst') score.them++; this.hud.score(score, this.us, this.them); };
    // Whether play goes on from where it is (true), or a new situation comes in (a goal: the cut; else a bridge).
    const goOn = () => !isGoal() && (this.realTime || 0) - since < (this.stallAfter ?? STALL) && (this.result !== 'won' || this.has('won-it-go')); // (play on after winning it: Won it? Go!) (stallAfter: tests)
    // (v82) As a goal goes in: the score shows it with the banner (it used to change only after the celebration, as the
    // next scene cut in), and the next scene's plan is made over the celebration's frames, not after them on a still picture.
    const goalWatch = () => this.job(1e9, null, () => { if (!isGoal()) return false;
      const now = { us: score.us + (this.result === 'goal' ? 1 : 0), them: score.them + (this.result === 'goalAgainst' ? 1 : 0) };
      this.hud.score(now, this.us, this.them);
      if (now.us >= toWin || now.them >= toWin) this.fullTime(now); // (the goal that ends it: the final whistle with its celebration)
      else { const nx = rounds[next % rounds.length]; early = { nx, p: this.planAhead(nx) }; }
      return true; });
    for (let i = 0; score.us < toWin && score.them < toWin; i++) {
      let bridged = false;
      if (i && !live) { // (v76: the play log, ui/playlog.js: play starts again from a new situation)
        const why = isGoal() ? null : this.result === 'won' && !this.has('won-it-go') ? 'won' : 'stall', pick = why ? this.bridgePick(rounds, next, why) : null;
        const sec = Math.round(((this.realTime || 0) - since) * 10) / 10;
        if (!why || pick) this.plog?.('fresh', { after: this.result, streak, sec, ...(why ? { why: `${why === 'won' ? 'he won it (no "Won it? Go!" yet)' : `${this.stallAfter ?? STALL} s without a goal`}: ${pick.ev.kind} into ${pick.sc.pattern || pick.sc.id}` } : {}) });
        else this.plog?.('stall', { after: this.result, streak, sec, why: `${why}: no scene to reach from here, play goes on` });
        if (pick) { const k = next % rounds.length; [rounds[k], rounds[pick.i]] = [rounds[pick.i], rounds[k]]; next++; this.lastBridge = pick.sc; streak = 0; since = this.realTime || 0; bridged = await this.bridgeTo(pick); if (!bridged) live = true; } // (the scenes come in the match's own order: the one picked takes the next one's turn; its plan not ready in time: play goes on from the event)
        else if (why) live = true; // (nothing near enough to reach: play goes on, and the next play's end tries again)
      }
      this.result = null; const gw = goalWatch(); // (from here on: a goal in what follows)
      if (bridged) { /* the new situation is set up, on screen */ }
      else if (live && this.sim.a(this.sim.ball.carrier)?.team === 'them') {
        if (!(await this.continueDefense())) { this.cancel(gw); tally(); streak = isGoal() ? 0 : streak + 1; live = goOn(); continue; }
      } else if (live) await this.continueLive();
      else { streak = 0; since = this.realTime || 0; const nx = await this.nextPlanned(rounds, next++, early); early = null; this.load(nx); await this.pre(); } // (v78: game/window.js prePlan)
      const opt = await this.decide(), good = this.isGood(opt);
      this.react(opt);
      // Chances that come from lessons he has passed (only some of the time, so play keeps flowing).
      this.offBall = !this.sc.then && this.has('get-open') && Math.random() < .6;
      this.duelOK = this.has('steal-it') && Math.random() < .6;
      this.reboundOK = this.has('follow-shot') && opt === 'shoot' && !good && Math.random() < .7; // a blocked shot can come back out to him
      await this.outcome(opt, good);
      await this.chain(); this.offBall = this.duelOK = this.reboundOK = false;
      this.cancel(gw); tally();
      streak = isGoal() ? 0 : streak + 1;
      live = goOn();
      if (i >= toWin * 25) break; // safety: don't let a match run forever
    }
    return score;
  },
  // (v82) The end of a match: as the goal that ends it goes in, the final whistle and the words with the score bumped in
  // the corner, over that goal's own celebration (nothing is added to the match: the results follow as before).
  fullTime(score) { this.sfx('whistle'); this.hud.caption(score.us > score.them ? '🏆 Full time!' : 'Full time!'); },

  // ---------- a new situation from play going on (v82, see STALL) ----------
  // The scene to bring in, from where everyone is now: of the scenes that can be reached from play (bridgeable), the one
  // quickest to reach (each player runs to the nearest free place of his team in it, the longest run as short as it can
  // be), with a soccer event that fits (bridgeEvent), of the next few in the match's own order. null: none near enough.
  // { sc, i (its place in rounds), map: { old id: new id }, ev: { kind, by, to, T }, run (m) }
  bridgePick(rounds, next, why) {
    const s = this.sim, b = s.ball, c = b.carrier && s.a(b.carrier), cur = c ? c.team : null, h = s.a('hero'); if (!h) return null;
    const usIds = MATES.filter(id => s.a(id)), themIds = s.team('them').map(a => a.id);
    let best = null; const n = rounds.length, seen = new Set();
    // (the next BRIDGE.ahead scenes of the match's own order first, so the mix of situations stays the match's; then any)
    for (let j = 0; j < n; j++) { if (j === BRIDGE.ahead && best) break; const i = (next + j) % n, sc = rounds[i];
      if (seen.has(sc) || !bridgeable(sc) || this.slowScenes?.has(sc)) continue; seen.add(sc);
      const P = this.sceneState(sc).at, T = sceneTeam(sc), cid = sc.carrier || 'hero', ball = P[cid]; if (!P.hero || !ball || usIds.some(id => !P[id]) || themIds.some(id => !P[id])) continue;
      const db = Math.hypot(b.x - ball.x, b.y - ball.y);
      let ev = null;
      if (SIDE_IN.has(sc.pattern)) { if (db > 12 || !c || c.gk) continue; ev = { kind: 'out', to: [ball.x, ball.y < W / 2 ? -.5 : W + .5], at: [ball.x, ball.y] }; } // (over the side line by the place the pass-in is taken from)
      else if (sc.pattern === 'goal-kick') { if (cur !== 'them' || b.x > 16 || c.gk) continue; const y = clamp(ball.y, 1, W - 1), side = y < W / 2 ? -1 : 1; ev = { kind: 'out', to: [-.6, W / 2 + side * Math.max(Math.abs(y - W / 2), (gy1 - gy0) / 2 + 1.2)], at: [ball.x, ball.y], goalKick: true }; } // (wide of our post, over our goal line)
      else if (sc.pattern === 'keeper-ball') { if (cur !== 'them' || !s.keeper('us') || b.x > 15 || c.gk) continue; ev = { kind: 'keeper', by: c.id }; }
      else if (cur === T || !c) { const o = c && T === 'us' && s.team('them').filter(o => !o.gk && Math.hypot(o.x - c.x, o.y - c.y) < 2.2 && o.tk > s.time - 2).sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y))[0];
        ev = o && why === 'stall' ? { kind: 'foul', by: o.id } : { kind: 'pass' }; }
      else { if (c.gk) continue; const o = s.team(T).filter(o => !o.gk).sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y))[0]; if (!o) continue; ev = { kind: 'tackle', by: o.id }; }
      // Each team's players to the places of its team (the longest run as short as it can be); the one who has the ball after
      // the event goes to the place of the one who has it in the new picture, when that keeps the runs about as short: no pass then.
      const has = ev.kind === 'tackle' ? ev.by : ev.kind === 'pass' || ev.kind === 'foul' ? c?.id : null, fix = has && has !== 'hero' && cid !== 'hero' && has[0] === cid[0] ? [has, cid] : null;
      const team = (ids, f) => assign(ids, ids.map(id => s.a(id)), ids.map(id => P[id]), f), mu0 = team(usIds), mt0 = team(themIds);
      const mu1 = fix?.[0][0] === 'm' ? team(usIds, fix) : null, mt1 = fix?.[0][0] === 'o' ? team(themIds, fix) : null;
      const mu = mu1 && mu1.max < mu0.max + 2 ? mu1 : mu0, mt = mt1 && mt1.max < mt0.max + 2 ? mt1 : mt0;
      const run = Math.max(Math.hypot(h.x - P.hero.x, h.y - P.hero.y), mu.max, mt.max); if (run > BRIDGE.run) continue;
      const map = { hero: 'hero', ...mu.map, ...mt.map };
      if (sc === this.sc || sc.id === this.sc?.id || sc === this.lastBridge) continue; // (never the same situation again straight away)
      // (the whole of it, the event and the run, in BRIDGE.max s: the event's own time, as bridgeEvent plays it, and the run's)
      const near = id => { const o = id && s.a(id); return o && c ? Math.hypot(o.x - c.x, o.y - c.y) : 0; }, theirs = c && s.team('them').filter(o => !o.gk).sort((p, q) => dist(p, b) - dist(q, b))[0];
      ev.T = ev.kind === 'pass' ? .15 : ev.kind === 'foul' ? 1 : ev.kind === 'tackle' ? near(ev.by) / 5.4 + .3 : ev.kind === 'keeper' ? 1.3 : (cur === 'us' && theirs ? dist(theirs, b) / 4.6 : 0) + .2 + .9 + .5;
      if (ev.T + clamp(run / 3.4, BRIDGE.T[0], BRIDGE.T[1]) + (ev.kind === 'out' ? .6 : 0) > BRIDGE.max) continue;
      const cost = ev.T + run / 3.4 + (j >= BRIDGE.ahead ? 3 : 0); // (about how long it takes, s)
      if (!best || cost < best.cost) best = { sc, i, map, ev, run, cost };
    }
    return best;
  },
  // Brings in the new situation, on screen: the event (bridgeEvent) on the old picture, then the new scene is set up around
  // everyone where he is (adopt), and everyone runs to his place in its picture as the ball goes to the one who has it
  // there (bridgeRun). The next choice opens as they get there, with its usual window.
  // (v82) The next scene of the match's order, with its plan made (game/window.js prePlan, started as the goal went in:
  // early). (Not swapped for a quicker one when its plan is slow: which plans are already made depends on what was
  // played before, so the match would not play the same twice, and the frame audit compares two runs. One scene,
  // gen-shot-open-110, needs about 60 s of frames to plan: a game/window.js matter, reported.)
  async nextPlanned(rounds, i, early) { const nx = rounds[i % rounds.length]; await (early?.nx === nx ? early.p : this.planAhead(nx)); return nx; },
  // (v82) game/window.js prePlan, which can be stopped: a plan given up on stops stepping (nothing goes on planning in
  // the frames of play). It plans as the game it is called on, with its own `skipping`.
  planAhead(sc) {
    const game = this, ctl = { off: false }, me = Object.create(this, { skipping: { get: () => game.skipping || ctl.off } });
    const p = this.prePlan.call(me, sc); p.stop = () => { ctl.off = true; }; return p;
  },
  // (v82) The plan of a scene that prePlan leaves to the frame it is set up in (rings, a pass to him, a lead pass, "Won it?
  // Go!"), made over the frames after it is set up instead, FRAME_STEPS steps a frame, and kept: the run-up finds it made (one,
  // a scene with rings, took 13 ms in its frame here: 53 ms on a phone). As game/window.js plannedRunUp asks for it.
  async planFrames() {
    const sc = this.sc; if (!sc || sc.kind === 'tackle' || sc.run === 'follow' || (!sc.spots && sc.kind !== 'receive' && sc.kind !== 'lead' && sc.intro !== 'won')) return;
    const extra = sc.kind === 'receive' ? this.passInRun() : sc.kind === 'lead' ? this.runInRun() : sc.intro === 'won' ? { never: ['o1'] } : {};
    let r = { done: false, it: null }; const [s0, st, opts] = this.planArgs(false, extra);
    try { do { this.realJobs = true; const j = this.job(0); this.realJobs = false; await j.done; r = planSteps(s0, st, opts, FRAME_STEPS, r.it); } while (!r.done); } catch (e) { console.error(e); }
  },
  // false: its plan was not made in time (BRIDGE.wait): nothing more is brought in, and play goes on from where the event
  // left it (a free kick taken, their ball after their tackle). A restart from out of play waits for its plan first.
  async bridgeTo(pick) {
    const s = this.sim, sc = pick.sc, h = s.a('hero');
    const planning = this.planAhead(sc), ready = () => Promise.race([planning.then(() => true), this.delay(BRIDGE.wait).then(() => false)]); // (made over the event's frames: game/window.js)
    const notReady = () => { planning.stop(); (this.slowScenes ||= new Set()).add(sc); this.plog?.('stall', { why: `${sc.pattern || sc.id}: its plan was not ready, play goes on` }); return false; };
    if ((pick.ev.kind === 'out' || pick.ev.kind === 'keeper') && !(await ready())) return notReady();
    this.closeWindow?.();
    Object.assign(this, { phase: 'outcome', step: null, ai: false, scripted: new Set([...s.agents.keys()]), camMode: 'follow', lines: [], aimAt: null, teamJob: null, roles: null });
    this.follow ||= { x: h.x + 2, y: lerp(h.y, W / 2, .4), yaw: 0, yawT: 0 };
    s.untrackAll(); for (const a of s.agents.values()) { a.mom = null; a.ease = false; }
    this.bridging = true;
    const t0 = s.time; try { await this.play(this.bridgeEvent(pick));
      if (!(await ready())) return notReady();
      this.adopt(sc, pick.map); await this.planFrames(); await this.bridgeRun(pick, BRIDGE.max - (s.time - t0), BRIDGE.min - (s.time - t0)); } finally { this.bridging = false; }
    return true;
  },
  // The event, on the old picture. It ends with the ball still, with the player who has it (or on the line for a restart).
  *bridgeEvent(pick) {
    const s = this.sim, b = s.ball, ev = pick.ev;
    if (b.state === 'flying') yield () => b.state !== 'flying';
    if (ev.kind !== 'out' && (!b.carrier || b.state !== 'carried' && b.state !== 'held')) { const n = s.team(sceneTeam(pick.sc)).sort((p, q) => dist(p, b) - dist(q, b))[0], t0 = s.time; // (a loose ball: the new picture's team gets to it)
      yield () => { s.go(n.id, b.x, b.y, 4); return dist(n, b) < .6 || s.time - t0 > 1.5; }; s.give(n.id); s.stop(n.id); }
    const c = s.a(b.carrier), whistle = (line) => { this.sfx('whistle'); if (line) this.hud.caption(line); };
    // Everyone not in the event already sets off for his place in the new picture (the event and their runs at the same time).
    const P = this.sceneState(pick.sc).at, actors = new Set([c.id, ev.by, ev.kind === 'out' && c.team === 'us' ? s.team('them').filter(o => !o.gk).sort((p, q) => dist(p, b) - dist(q, b))[0]?.id : null]);
    for (const a of s.agents.values()) { const q = P[pick.map[a.id] || a.id]; if (a.gk || actors.has(a.id) || !q) continue; const d = Math.hypot(q.x - a.x, q.y - a.y); s.go(a.id, q.x, q.y, clamp(d / 2, 1.2, 4.2)); }
    if (ev.kind === 'out') {
      // Out of play off their player: their pass goes astray, or (our ball) one of theirs gets a foot to it.
      let k = c;
      if (c.team === 'us' || c.gk) { const o = s.team('them').filter(o => !o.gk).sort((p, q) => dist(p, b) - dist(q, b))[0], t0 = s.time; this.spice(null);
        s.go(c.id, c.x + (c.tx - c.x) * .3, c.y + (c.ty - c.y) * .3, 1.2); o.tk = s.time;
        yield () => { s.go(o.id, b.x, b.y, 4.6); return dist(o, b) < .7 || s.time - t0 > 1.4; }; k = o; c.beat = s.time + .8; }
      s.windup(k.id, k === c ? 'pass' : 'touch'); yield .2;
      const [tx, ty] = ev.to; s.kick(tx, ty, { speed: clamp(Math.hypot(tx - b.x, ty - b.y) / .9, 5, 11), arc: .12, touch: true }); this.kicked = true;
      if (k !== c) s.go(k.id, k.x + (tx - k.x) * .25, k.y + (ty - k.y) * .25, 2.4);
      yield () => b.state !== 'flying';
      whistle(ev.goalKick ? '⚽ Goal kick!' : '⚽ Our ball!'); yield .4;
    } else if (ev.kind === 'keeper') {
      // Their shot, at our keeper: he catches it and holds it.
      const gk = s.keeper('us'), y = clamp(gk.y + (c.y > gk.y ? .3 : -.3), gy0 + .5, gy1 - .5), at = { x: gk.x + .35, y, z: .9 };
      this.scripted.add(gk.id); s.stop(gk.id); faceTo(c, at.x, at.y); s.windup(c.id, 'shot'); yield .25;
      this.keeperReact(gk, { res: 'save', at, t: Math.max(.3, dist(c, at) / 14), held: true }, { x: b.x, y: b.y });
      s.kick(at.x, at.y, { speed: 14, arc: .1, z1: .9 }); this.kicked = true;
      yield () => b.state !== 'flying';
      Object.assign(b, { state: 'held', carrier: gk.id, move: null, reach: null }); // (his hands are on it: he stands up with it, game/keeper.js keeperMotion)
      this.hud.caption('🧤 Saved!'); this.say('Saved!'); yield .6;
    } else if (ev.kind === 'foul') {
      // One of theirs comes in late on our player with the ball: a foul. The whistle; the ball stays where it is.
      const o = s.a(ev.by), l = dist(o, b) || 1; o.tk = s.time; o.beat = s.time + 1.2;
      s.go(o.id, clamp(b.x + (b.x - o.x) / l * .4, .5, L - .5), clamp(b.y + (b.y - o.y) / l * .4, .5, W - .5), 4.8); yield .3;
      c.beat = s.time + .8; s.stop(c.id); s.go(o.id, o.x + (b.x - o.x) * .3, o.y + (b.y - o.y) * .3, 1.5); yield .15;
      whistle('Free kick! ⚽'); yield .45;
    } else if (ev.kind === 'tackle') {
      // The other team wins it: their nearest player gets to it and takes it.
      const o = s.a(ev.by), t0 = s.time; this.spice(null); s.go(c.id, c.x + (c.tx - c.x) * .2, c.y + (c.ty - c.y) * .2, 1); // (he slows, shielding it)
      yield () => { s.go(o.id, b.x, b.y, 5.4); return dist(o, b) < .65 || s.time - t0 > 1.4; };
      c.beat = s.time + .8; o.tk = s.time; s.give(o.id); s.stop(o.id);
      // (words as a caption: the new scene's setup takes a banner off at once, game.js load)
      if (o.id === 'hero') { this.sfx('tap'); this.hud.caption('You won the ball! 💪'); this.say('You won the ball!'); } else if (o.team === 'us') { this.sfx('tap'); this.hud.caption('We won it! 💪'); } else { this.fx('stolen'); this.hud.caption('They got it!'); }
      yield .1;
    } else yield .15; // ('pass': the play simply goes on, bridgeRun)
    this.spice(null);
  },
  // The new scene, set up around everyone where he is now: the same players (each of a team to the place picked for him,
  // map), the ball where it is, the camera where it is. Nobody moves and nothing cuts.
  adopt(sc, map) {
    const s = this.sim, keepF = ['x', 'y', 'tx', 'ty', 'speed', 'sp', 'face', 'lv', 'dist', 'd0', 'tA', 'tL', 'tN', 'gkm', 'upUntil', 'beat', 'tk'], was = {};
    for (const a of s.agents.values()) was[map[a.id] || a.id] = Object.fromEntries(keepF.map(k => [k, Array.isArray(a[k]) ? [...a[k]] : a[k]]));
    const ball = { ...s.ball, carrier: s.ball.carrier ? map[s.ball.carrier] || s.ball.carrier : null }, roster = { ...this.roster }, cam = this.cam, follow = this.follow;
    // Which body each id has: ours by the roster (takeOver swaps the two together), theirs their own.
    const body = id => (id in roster ? 'u' + roster[id] : id), want = {}; for (const [o, n] of Object.entries(map)) want[n] = body(o);
    this.load(sc); // (the scene's own setup: its rings, its plan, the play's state; it puts everyone in its picture and resets the bodies and the camera)
    const now = {}; for (const id of s.agents.keys()) now[id] = id in ROSTER ? 'u' + ROSTER[id] : id;
    for (const id of Object.keys(want)) { if (now[id] === want[id]) continue; const o = Object.keys(now).find(k => now[k] === want[id]); if (!o) continue; this.world.swapRigs?.(id, o); [now[id], now[o]] = [now[o], now[id]]; }
    this.roster = Object.fromEntries(Object.keys(ROSTER).map(id => [id, now[id] ? +now[id].slice(1) : ROSTER[id]]));
    for (const a of s.agents.values()) { const w = was[a.id]; if (!w) continue; Object.assign(a, w, { track: null }); } // (each goes on as he was going: the run's own paths take over from there)
    Object.assign(s.ball, ball, { move: null, reach: null });
    this.cam = cam; this.follow = follow; this.camMode = 'follow'; this.phase = 'outcome'; // (load's reset made it 'idle': play is going on)
  },
  // Everyone runs from where he is to his place as the new scene's window opens (its plan, as a run-up would bring him
  // there: game/window.js plannedRunUp), and the ball goes to the one who has it there: carried, passed (a free kick,
  // a pass on, the pass after winning it), rolled out by our keeper, or picked up on the line. The camera follows the
  // ball, then comes round to the new scene's view as the choice opens. BRIDGE.T s, as the longest run needs.
  async bridgeRun(pick, budget = BRIDGE.T[1], least = BRIDGE.T[0]) {
    const s = this.sim, sc = this.sc, b = s.ball;
    // (the run-up's own needs: a pass to him, game/rounds.js passInRun; a friend's run for a pass in front, runInRun)
    const extra = sc.kind === 'receive' ? this.passInRun() : sc.kind === 'lead' ? this.runInRun() : {}, oneOnOne = sc.kind === 'tackle';
    let plan = null, tv = null;
    if (!oneOnOne) for (const rCap of kindOf(sc) === 'attack' ? [0, 5.2, 4.2, 3.4] : [0]) { const p = this.plan(false, rCap ? { ...extra, rCap } : extra); if (!p) break; const t = kindOf(sc) === 'attack' ? this.threatFit(p) : null; if (!plan || t?.seen) { plan = p; tv = t; } if (!t || t.seen || !p.threat || p.rP >= (rCap || 9)) break; }
    if (!plan && !oneOnOne) { this.cam = null; await this.pre(); return; } // (no plan: the scene's own run-up, as before v82)
    if (plan) { this.wplan = plan; plan.sc = sc; }
    if (tv) { plan.wideK = tv.k; plan.seen = tv.seen; if (tv.off) this.yaw += tv.off; }
    const at0 = id => (plan?.paths[id] ? pathAt(plan.paths[id], 0) : null);
    if (sc.run === 'goal') { const hq = at0('hero'), m = at0('m1'); if (hq && m) { this.yaw = this.frameYaw(sc, hq, { x: (m.x + L) / 2, y: (m.y + W / 2) / 2 }); } }
    else if (sc.even && !sc.run && sc.spots) { const hq = at0('hero'), c = at0(sc.carrier), pts = [...sc.spots, c || hq]; if (hq) this.yaw = this.frameYaw(sc, hq, { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length }); }
    const cid = sc.carrier || 'hero', holder = b.carrier && s.a(b.carrier), keeperBall = !!sc.gk?.hold;
    const goal = id => { const q = at0(id); if (q) return q; const P = this.sceneState(sc).at[id]; return P ? { x: P.x, y: P.y, vx: 0, vy: 0 } : null; };
    // The ball's way to the one who has it in the new picture. kickAt: when it is played (s from now); by: who plays it.
    const passes = holder && holder.id !== cid && b.state !== 'loose', loose = !holder || b.state === 'loose', kickAt = passes ? .35 : 0;
    // Each one's way: a moment still (the one who plays the ball, until it is played), then a smooth run (hermite) from how
    // he moves now to his place, arriving with the plan's own velocity. A ball left on a line (out of play) is picked up on
    // the way: the one who has it in the new picture runs to it first, then walks it onto its place.
    const ways = {}, B = { x: b.x, y: b.y };
    for (const a of s.agents.values()) { const e = goal(a.id); if (!e) continue; const lv = a.lv || [0, 0], v0 = Math.hypot(lv[0], lv[1]), k0 = v0 > 4 ? 4 / v0 : 1, kicker = a.id === holder?.id && passes;
      const V0 = kicker ? [0, 0] : [lv[0] * k0, lv[1] * k0], E = [e.x, e.y], V1 = [e.vx, e.vy];
      if (loose && a.id === cid && Math.hypot(e.x - B.x, e.y - B.y) > .5) { const d = Math.hypot(e.x - B.x, e.y - B.y), P = [B.x - (e.x - B.x) / d * .3, B.y - (e.y - B.y) / d * .3];
        ways[a.id] = { delay: 0, legs: [{ herm: true, S: [a.x, a.y], V0, E: P, V1: [0, 0] }, { herm: true, S: P, V0: [0, 0], E, V1, T: clamp(d / 2.2, .5, 1.8) }] }; }
      else ways[a.id] = { delay: kicker ? kickAt + .15 : 0, legs: [{ herm: true, S: [a.x, a.y], V0, E, V1 }] }; }
    const fit = (w, Tb) => { const T1 = Tb - w.delay - (w.legs[1]?.T || 0); return T1 > .3 && w.legs.every((l, i) => { const T = i ? l.T : T1; for (let k = 1; k < 12; k++) { const q = hermAt({ ...l, T }, T * k / 12); if (Math.hypot(q.vx, q.vy) > BRIDGE.vMax) return false; } return true; }); };
    let Tb = Math.max(BRIDGE.T[0], least);
    while (Tb < BRIDGE.T[1] && !Object.values(ways).every(w => fit(w, Tb))) Tb += .1;
    if (passes) { const e = goal(cid), d = e ? Math.hypot(e.x - b.x, e.y - b.y) : 0; Tb = Math.max(Tb, kickAt + .2 + d / 13 + .35); } // (a pass no faster than 13 m/s, there a moment before the choice opens)
    Tb = Math.max(BRIDGE.T[0], Math.min(Tb, BRIDGE.T[1] + .2, budget)); // (within the whole bridge's time: a run a little quicker, rarely)
    s.dead = !!sc.restart; s.reactFrom = null; s.aliveCap = 1; for (const a of s.agents.values()) a.aliveK = 1;
    if (plan) plan.openAt = s.time + Tb; this.scripted = new Set([...s.agents.keys()]);
    for (const [id, w] of Object.entries(ways)) {
      const a = s.a(id), p = plan?.paths[id], S = { x: a.x, y: a.y, vx: 0, vy: 0 }, E = goal(id), T2 = w.legs[1]?.T || 0, T1 = Math.max(.3, Tb - w.delay - T2), l1 = { ...w.legs[0], T: T1 }, l2 = w.legs[1];
      a.track = { at: tt => { const u = tt - w.delay; return u < 0 ? S : u < T1 ? hermAt(l1, u) : l2 && u < T1 + T2 ? hermAt(l2, u - T1) : p ? pathAt(p, tt - Tb) : { x: E.x, y: E.y, vx: 0, vy: 0 }; }, t0: s.time, watch: false };
    }
    const t0 = s.time, carrier = s.a(cid), during = extra.during?.(Tb); // (a pass to him: played as the choice opens)
    if (keeperBall && carrier) { Object.assign(b, { state: 'held', carrier: cid, move: null, reach: null }); carrier.gkm ||= { k: 'hold', t0: s.time, low: false }; }
    // The ball: carried by the one who has it there already; else played to where he will be a moment before the choice.
    if (passes) {
      await this.delay(kickAt - .2); const k = s.a(holder.id), e = carrier.track.at(Tb - .3), dd = Math.hypot(e.x - b.x, e.y - b.y);
      if (k.gk && b.state === 'held') { k.face = [(e.x - k.x) / (dd || 1), (e.y - k.y) / (dd || 1)]; k.gkm = { k: 'roll', t0: s.time, low: true }; await this.delay(.2); Object.assign(b, { state: 'carried', carrier: k.id, z: 0 }); k.gkm = null; } // (our keeper rolls it out)
      else { faceTo(k, e.x, e.y); s.windup(k.id, 'pass'); await this.delay(.2); }
      s.kick(e.x, e.y, { speed: clamp(dd / Math.max(.3, Tb - .3 - (s.time - t0)), 4, 13), arc: dd > 9 ? .3 : .15 }); this.kicked = true;
    }
    const pick0 = this.job(Tb + 1, null, () => { if (b.carrier === cid && b.state === 'carried' || b.state === 'held') return true; if (b.state !== 'flying' && carrier && dist(carrier, b) < (loose ? 1.1 : .8)) { s.give(cid); return true; } return false; });
    // The camera: from the event's view of the ball it comes round behind his player as everyone runs to his place, so it
    // follows him there, slowly (glide); in the last moment it takes the new scene's own view, with the head-down edge.
    this.camMode = 'player'; this.glide = Math.min(Tb, 1.2); // (eased over a second, then it keeps up with him)
    await this.delay(Math.max(0, Tb - .8)); this.phase = 'pre'; this.returns = 0; this.cameFrom = null; this.hud.caption('');
    await this.delay(Math.max(0, Tb - (s.time - t0)));
    this.cancel(pick0);
    if (b.carrier !== cid && carrier && !keeperBall && b.state !== 'flying') { s.give(cid); } // (late: it is his as the choice opens)
    if (carrier && !carrier.gk && b.carrier === cid) { const c = carrier; if (b.state === 'carried' && dist(b, c) > .6) Object.assign(b, { x: c.x + c.face[0] * .4, y: c.y + c.face[1] * .4 }); }
    await during;
    if (plan) plan.ready = true;
    else { s.untrackAll(); s.stopAll(); this.yaw = Math.atan2(s.ball.y - s.a('hero').y, s.ball.x - s.a('hero').x); this.faceYaw(s.a('hero')); } // (a 1v1: he faces the one coming at him, game/rounds.js pre)
  },

  // In matches, a good choice gets a quick word that names what he did (the play doesn't stop for stars).
  praise(opt) {
    const r = this.rating(opt); if (r !== 'best' && r !== 'ok') return;
    const k = this.sc.kind, word = k === 'receive' ? (this.peeked ? 'Nice peek! 👀' : 'Nice turn!') : k === 'support' ? 'Great run!' : k === 'defense' ? 'Good defending!'
      : k === 'tackle' ? null : opt === 'shoot' ? null : opt.startsWith('pass:') || k === 'lead' ? 'Nice pass!' : opt.startsWith('push:') ? 'Into space! 💨' : 'Great dribble!';
    if (word) this.hud.toast(word);
  },

  // What each choice in a match shows, the moment he makes it, without holding play up (nothing here waits): stars pop
  // over his player (3 for the best choice or one just as good, 2 for one that only keeps the ball, none for a miss),
  // with the praise word for a good one; when he picked a place to run that was not the best, the best ring stays a
  // moment in soft green. A miss is counted for the idea it belongs to (the card at the end names the one missed most),
  // and the first miss of an idea queues that idea's name, said the moment the play's result shows (resultCue).
  react(opt) {
    this.praise(opt); this.hintNext = null;
    const sc = this.sc, r = this.rating(opt); this.logChoice(opt, r); if (!sc.best) return; // a tough spot: there was no better choice
    if (opt === 'timeout') { this.timeoutsInMatch = (this.timeoutsInMatch || 0) + 1; const id = this.idea(); if (id) this.missed[id] = { n: (this.missed[id]?.n || 0) + 1, at: ++this.misses }; return; } // (v64) out of time: a miss for its idea, nothing said (play goes on)
    const h = this.sim.a('hero'), stars = r === 'best' || r === 'ok' ? 3 : r === 'safe' ? (this.shotMissed?.(opt) ? 1 : 2) : 0; // (a shot that does not go in: 1 star at most)
    if (stars) this.hud.pop?.(stars, () => this.world.project?.(h.x, h.y, 1.55));
    if (stars < 3) this.betterRing(opt);
    if (r !== 'bad') return;
    const id = this.missIdea?.(opt) || this.idea(); if (!id) return; // (a shot: the space or the foot he got wrong, outcomes.js)
    this.missed[id] = { n: (this.missed[id]?.n || 0) + 1, at: ++this.misses };
    if (!this.cued.has(id) && this.cued.size < 3) this.hintNext = { id };
  },
  // Called as a play's result shows (outcomes.js emit): after a miss, the idea's short name ("Look up and scan!"), once per
  // idea and three at most in a match, never over other words (a caption, a skill move's name). It is short, so it is
  // over before the next decision opens.
  resultCue() {
    const h = this.hintNext; this.hintNext = null;
    if (!h || this.cued.has(h.id) || this.hud.busy?.()) return;
    this.cued.add(h.id); this.say(this.cueFor(h.id));
  },
  cueFor: id => skillById(id)?.kid || '',
  // He picked a place to run (a ring) that was not the best one: the best ring stays where it was for a moment, in
  // soft green, and fades (js/fx.js mark), while the others go as usual. Not for passes, dribbles or turns: no ring.
  betterRing(opt) {
    const sc = this.sc, i = sc.spots?.findIndex(p => 'spot:' + p.id === sc.best) ?? -1;
    if (!opt.startsWith('spot:') || i < 0) return;
    const sp = sc.spots[i]; this.world.particles?.mark?.(sp.x, sp.y, this.ui.spotScale?.[i] || 1);
  },
  // Every choice he makes goes into the decision log (progress.js logChoice, via onChoice set by flows.js): which idea,
  // how good, how long he took from the moment it opened, and whether he looked first (not for a steal: no look).
  logChoice(opt, r) {
    if (!this.onChoice || !this.choiceLog) return;
    const sc = this.sc, looked = sc.kind === 'tackle' ? null : sc.kind === 'receive' ? !!this.peeked : !!this.scanned;
    const whole = { id: !sc.live && sc.skill ? sc.skill : this.idea(), mode: this.choiceLog, grade: r === 'best' || r === 'ok' ? 'best' : r === 'safe' ? 'okay' : 'miss', sec: (this.realTime || 0) - (this.decideReal || 0), looked, ...(opt === 'timeout' ? { timeout: true } : {}) }; // (sec: real seconds, as he lived them: the window runs slow)
    for (const rec of this.shotLog?.(opt, whole) || [whole]) this.onChoice(rec); // (a shot he picked a space or a foot for: each part under its own lesson, outcomes.js)
  },
  // The lesson a match decision practises (for the idea he missed most).
  idea() {
    const sc = this.sc, b = sc.best || '';
    if (sc.then) return 'give-and-go';
    if (sc.kind === 'tackle') return 'steal-it';
    if (sc.kind === 'receive') return 'peek-and-turn';
    if (sc.kind === 'lead') return 'lead-pass';
    if (sc.run === 'follow') return 'follow-shot';
    if (sc.run === 'goal') return 'go-to-goal';
    if (sc.kind === 'support') return sc.id === 'live-run' ? (/^Pass and go/.test(sc.cue) ? 'give-and-go' : /^Run to the goal/.test(sc.cue) ? 'go-to-goal' : 'get-open') : sc.skill || 'get-open';
    if (sc.kind === 'defense') return sc.live ? (b === 'spot:home' || b === 'spot:chase' ? 'get-goal-side' : 'one-goes') : sc.skill || 'get-goal-side';
    if (!sc.live && sc.skill) return sc.skill; // one of a lesson's own scenes
    return b === 'shoot' ? 'shoot-close' : b.startsWith('pass:') ? 'pass-to-open' : 'dribble-to-space';
  },
  // The idea he missed most in this match (the latest of equals), or null.
  mostMissed() { return Object.entries(this.missed || {}).sort((p, q) => q[1].n - p[1].n || q[1].at - p[1].at)[0]?.[0] || null; },

  // Follow-on decisions inside one play: the second step of a give-and-go, where to run after a pass, the pass
  // back to him (peek and turn), or a 1v1 once he's in front of the attacker.
  async chain() {
    const s = this.sim;
    for (let k = 0; k < 4; k++) {
      if (this.result === 'passed' && this.sc.then) await this.toStep2();
      else if (this.result === 'support') { if (!(await this.toSupport())) { this.result = 'kept'; return; } }
      else if (this.result === 'incoming') { if (!(await this.toReceive())) { await this.until(() => s.ball.state !== 'flying'); s.give('hero'); this.result = 'kept'; return; } }
      else if (this.result === 'duel') await this.toDuel();
      else if (this.result === 'rebound') this.toRebound();
      else return;
      const o = await this.decide(); this.react(o); await this.outcome(o, this.isGood(o));
    }
  },
  // After his pass: he stays himself and picks where to run, from where everyone is right now. Spots: open space
  // with a clear path for the pass back (past his defender once he has "Pass and go!"), staying put, or running
  // to the ball. False when there's no fair choice (then he just takes over his friend, as before).
  async toSupport() {
    const s = this.sim, c = s.a(s.ball.carrier), h = s.a('hero'); if (!c || c.team !== 'us' || c.id === 'hero') return false;
    this.ai = false; await this.settle(.5); // (v66: the picture is taken with everyone moving on with the play)
    const opps = s.team('them'), O = opps.map(o => [o.x, o.y]), C = [c.x, c.y];
    const press = [...opps].sort((a, b) => dist(a, c) - dist(b, c))[0], mark = opps.filter(o => o !== press).sort((a, b) => dist(a, h) - dist(b, h))[0];
    // With "Pass and go!" the run goes past his defender when it can; with "Run to the goal too!", toward the goal, ahead of the ball.
    const room = p => Math.min(...O.map(o => Math.hypot(o[0] - p[0], o[1] - p[1]))), past = this.has('give-and-go'), goal = this.has('go-to-goal');
    let space = null, top = -1e9;
    for (let a = 0; a < 16; a++) for (const d of [4, 5.5, 7]) {
      const p = [h.x + Math.cos(a * Math.PI / 8) * d, h.y + Math.sin(a * Math.PI / 8) * d];
      if (!inPitch(p, 1.2) || p[0] < c.x - 1 || Math.hypot(p[0] - c.x, p[1] - c.y) < 3.5 || !laneClear(C, p, O) || room(p) < 2.4) continue;
      const score = p[0] - Math.hypot(p[0] - h.x, p[1] - h.y) * .3 + (past && p[0] > press.x + 1.2 ? 4 : 0) + (goal && p[0] > c.x + 1.5 && Math.abs(p[1] - W / 2) < 6 ? 3 : 0);
      if (score > top) { top = score; space = p; }
    }
    const H = [h.x, h.y], stayOpen = laneClear(C, H, O) && Math.hypot(h.x - c.x, h.y - c.y) > 2.6, stayBlocked = laneBlocked(C, H, O);
    const toH = Math.hypot(h.x - c.x, h.y - c.y) || 1, crowd = [c.x + (h.x - c.x) / toH * 1.6, c.y + (h.y - c.y) / toH * 1.6];
    const spots = [];
    if (space) spots.push({ id: 'space', x: space[0], y: space[1] });
    if (stayOpen || stayBlocked) spots.push({ id: 'stay', x: h.x, y: h.y });
    if (Math.hypot(crowd[0] - h.x, crowd[1] - h.y) >= 3.4) spots.push({ id: 'ball', x: crowd[0], y: crowd[1], crowd: true }); // (a run, not a ring under his feet)
    if (spots.length < 2 || !(space || stayOpen) || spots.some((p, i) => spots.some((q, j) => j > i && Math.hypot(p.x - q.x, p.y - q.y) < RING_GAP))) return false;
    // Three places to run in all (v60): the other ones only okay (the pass reaches him, but…) or hidden behind a defender.
    const others = s.team('us').filter(a => a !== h && a !== c).map(a => [a.x, a.y]), runs = spots.filter(p => p.id !== 'stay').length;
    const extra = moreSpots(Math.random, { c: C, h: H, opps: O, mates: [C, ...others], have: spots.map(p => [p.x, p.y]), okay: 1, either: Math.max(0, 2 - runs) })
      || moreSpots(Math.random, { c: C, h: H, opps: O, mates: [C, ...others], have: spots.map(p => [p.x, p.y]), either: 1 }) || [];
    for (const e of extra) spots.push({ id: e.id, x: e.p[0], y: e.p[1], why: e.why });
    const best = space ? 'space' : 'stay';
    this.sc = { kind: 'support', live: true, even: true, id: 'live-run', skill: this.sc?.skill, carrier: c.id, pressId: press.id, markId: mark.id, spots,
      best: 'spot:' + best, ok: best === 'space' && stayOpen ? ['spot:stay'] : [], safe: extra.filter(e => OKAY[e.why]).map(e => 'spot:' + e.id), cue: past && space && space[0] > press.x + 1.2 ? 'Pass and go! Run past him into the space.' : goal && space && space[0] > c.x + 1.5 ? 'Run to the goal, so your friend can pass to you!' : 'Move to open space so your friend can pass to you!' };
    this.beginStep({ seen: new Set(), lookUp: false, drag: null });
    this.yaw = this.frameYaw(this.sc, h, c); this.faceYaw(h);
    return true;
  },
  // A friend's pass is on its way to him: the ball waits in the air while he peeks, then he picks a turn. His left
  // and right turns lean up the field. False when neither turn is open (then he just takes the ball).
  async toReceive() {
    const s = this.sim, h = s.a('hero'), b = s.ball, face = Math.atan2(b.fy - h.y, b.fx - h.x);
    if (Math.abs(face) < 2) return false; // the pass isn't from behind him: no turn needed
    const nearest = ang => Object.entries(DRIBBLE_DIRS).sort((p, q) => Math.abs(wrap(p[1] - ang)) - Math.abs(wrap(q[1] - ang)))[0][0];
    const lean = side => Math.atan2(Math.sin(side), Math.cos(side) + 1);
    const turns = { L: nearest(lean(face + Math.PI / 2)), R: nearest(lean(face - Math.PI / 2)) };
    if (turns.L === turns.R) return false;
    const P = a => [a.x, a.y], mates = friends(s), opps = foes(s);
    const sc = { kind: 'receive', live: true, id: 'live-recv', skill: this.sc?.skill, carrier: s.team('us').find(a => a.id !== 'hero' && dist(a, { x: b.fx, y: b.fy }) < 1.5)?.id || 'm1',
      hero: P(h), heroTo: P(h), mates, opps, oppsTo: opps, turns };
    const g = grade(sc), goods = ['L', 'R'].filter(k => g['drib:' + turns[k]] === 'good').sort((p, q) => dribbleEnd(h, turns[q], L, W).x - dribbleEnd(h, turns[p], L, W).x);
    if (!goods.length) return false;
    Object.assign(sc, { best: 'turn:' + goods[0], ok: goods.slice(1).map(k => 'turn:' + k), cue: goods.length > 1 ? 'Nobody was behind you. Peek, then turn and go!' : 'A defender was behind you! Peek first, then turn away from him.' });
    this.sc = sc;
    this.beginStep({ lookUp: false, drag: null });
    this.yaw = face; this.faceYaw(h);
    return true;
  },
  // His shot was blocked and came back out (outcomes.js shootGen): where does he run? In to the loose ball, stay, or back.
  toRebound() {
    const s = this.sim, h = s.a('hero'), sh = this.rebound, P = a => [a.x, a.y], others = [...s.agents.values()].filter(a => a !== h), loose = { x: sh.loose[0], y: sh.loose[1] };
    // Turning back: back toward his own half, or back and to one side, wherever has the most room (clear of everyone,
    // and of the other two rings). None with room: just the two rings.
    const room = q => Math.min(...others.map(a => Math.min(dist(a, q), closestOnLane(a, h, q, .1).d + .8)), dist(q, loose));
    const back = [Math.PI, Math.PI - .6, Math.PI + .6].map(a => ({ x: h.x + Math.cos(a) * 3.6, y: h.y + Math.sin(a) * 3.6 })).filter(q => inPitch([q.x, q.y], 1.2)).sort((p, q) => room(q) - room(p))[0];
    this.sc = { kind: 'support', run: 'follow', live: true, id: 'live-rebound', skill: this.sc?.skill, carrier: 'hero', shot: sh,
      hero: P(h), heroTo: P(h), mates: friends(s), opps: foes(s),
      spots: [{ id: 'in', x: loose.x, y: loose.y }, { id: 'watch', x: h.x, y: h.y }, ...(back && room(back) >= 2 ? [{ id: 'back', x: back.x, y: back.y }] : [])],
      best: 'spot:in', ok: [], cue: 'He blocked it! Keep running in, and score!' };
    this.sc.oppsTo = this.sc.opps;
    this.beginStep({ seen: new Set(), lookUp: false, drag: null });
    this.yaw = this.frameYaw(this.sc, h, s.ball); this.faceYaw(h);
  },
  // He got in front of the attacker: now it's a 1v1, and he taps STEAL at the right moment.
  async toDuel() {
    const s = this.sim, c = s.a(s.ball.carrier), h = s.a('hero');
    const big = Math.random() < .5;
    this.sc = { kind: 'tackle', live: true, id: 'live-duel', skill: this.sc?.skill, carrier: c.id, touches: big ? [.3, 1.9, .3, 1.7] : [.3, .3, 1.8, .3, 1.6], speed: 3,
      passSide: Math.random() < .5 ? 1 : -1, best: 'tackle:good', ok: [], cue: 'Wait in front of him. Steal it when it rolls away from his feet!' };
    this.beginStep({ tk: null });
    s.stopAll(); this.yaw = Math.atan2(c.y - h.y, c.x - h.x); this.faceYaw(h);
    await this.delay(.3);
  },
};
