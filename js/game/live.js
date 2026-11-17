// Matches and free play: one play runs on into the next from wherever everyone stands, and each new decision
// (on the ball, defending, getting open, receiving, a 1v1) is built from the live positions.
import { pickRounds, skillById } from '../skills.js';
import { lerp, clamp, dist, interceptor, dribbleEnd, shuffle, closestOnLane, DRIBBLE_DIRS } from '../geom.js';
import { grade, pushEnd, goalSide, exploit, laneClear, laneBlocked, inPitch, moreSpots, OKAY, RING_GAP } from '../generate.js';
import { L, W, MATES, wrap } from './shared.js';
import { planHold, rolesOf } from '../window.js';
// His friends' and their players' places, m1 m2 (m3) and o1 o2 o3 (o4): as many as the team size has.
const friends = s => MATES.filter(id => s.a(id)).map(id => [s.a(id).x, s.a(id).y]), foes = s => s.team('them').map(a => [a.x, a.y]);

// A decision built from wherever play is right now (continuous matches). The best choice is the good option that
// moves the ball farthest toward goal; other good options also earn 3 stars; backing away into space is "safe".
// (v66) `near`: { id, x, y }: the one of theirs who is coming for the ball, taken where he will be when he has closed on
// it (on the bearing he comes from): a choice is right or wrong by where he comes from, not by how far off he still is.
function liveScenario(s, skill, pushAllowed, near = null) {
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
  sc.grades = g; sc.best = goods[0] || null; sc.ok = goods.slice(1); sc.safe = Object.keys(g).filter(o => g[o] === 'safe');
  sc.cue = !sc.best ? 'That was a tough spot!' : sc.best === 'shoot' ? 'Close to the goal and nobody in the way. Shoot!' : sc.best.startsWith('pass:') ? `{m${sc.best[5]}} was open!`
    : sc.best.startsWith('push:') ? 'Lots of space! Push it and go!' : 'There was space to run into!';
  return sc;
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
  sc.exploits = Object.fromEntries(spots.map(sp => [sp.id, exploit(sc, sp.id)]));
  const goods = spots.filter(sp => !sc.exploits[sp.id]).map(sp => sp.id);
  if (spots.length < 2 || !goods.length || goods.length === spots.length) return null;
  const onBall = near(goalSide(P(c), 1.2), 2.2), best = goods.includes('home') && !onBall ? 'home' : goods.find(g => g !== 'home' && g !== 'chase') || goods[0];
  sc.best = 'spot:' + best; sc.ok = goods.filter(g => g !== best).map(g => 'spot:' + g);
  sc.cue = best === 'home' ? 'Nobody was in front of the ball. Get in front!' : best === 'chase' ? 'Your friends had it covered. Stay close!' : 'A friend was on the ball. Guard the open player!';
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
    if (c && c.team === 'us') this.takeOver(c.id);
    const h = s.a('hero');
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
    this.sc = liveScenario(s, this.sc?.skill, this.pushAllowed, near);
    if (near) { let plan = null; try { plan = planHold(this.sc, P, { R: this.windowReal(), Rfloor: this.windowMin(), options: this.offerList(), from: st.at, lead: 0, yaw: this.yaw }); } catch (e) { console.error(e); }
      if (plan && plan.threat?.id === near.id) { plan.sc = this.sc; plan.live = false; plan.fromLive = true; plan.ready = true; this.wplan = plan; } }
  },

  // After we lose the ball in a match: our team gets back into shape for a moment, then he decides where to run.
  // If no spot could stop them, the play just runs on and the geometry decides what happens.
  async continueDefense() {
    const s = this.sim, c = s.a(s.ball.carrier);
    const choose = this.has('get-goal-side'), guard = this.has('one-goes'); // (saves that had "Guard the open player" have "One goes, one guards": progress.js MERGED)
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
    // Play flows on: after "Kept the ball!" or "Stole it!" the next choice starts from right there.
    // Only a goal resets to a fresh situation, like a kickoff.
    // After a lost ball he defends from right there; after "Stopped him!" he defends again; after a win he attacks.
    let live = false, next = 0, streak = 0;
    this.missed = {}; this.misses = 0; this.timeoutsInMatch = 0; this.cued = new Set(); this.hintNext = null; this.choiceLog = 'match'; this.firstRound = false; this.timeouts = 0;
    const tally = () => { if (this.result === 'goal') score.us++; else if (this.result === 'goalAgainst') score.them++; this.hud.score(score, this.us, this.them); };
    for (let i = 0; score.us < toWin && score.them < toWin; i++) {
      if (live && this.sim.a(this.sim.ball.carrier)?.team === 'them') {
        if (!(await this.continueDefense())) { tally(); streak = this.result === 'goalAgainst' ? 0 : streak + 1; live = streak > 0 && streak <= 4; continue; }
      } else if (live) await this.continueLive();
      else { streak = 0; this.load(rounds[next++ % rounds.length]); await this.pre(); }
      const opt = await this.decide(), good = this.isGood(opt);
      this.react(opt);
      // Chances that come from lessons he has passed (only some of the time, so play keeps flowing).
      this.offBall = !this.sc.then && this.has('get-open') && Math.random() < .6;
      this.duelOK = this.has('steal-it') && Math.random() < .6;
      this.reboundOK = this.has('follow-shot') && opt === 'shoot' && !good && Math.random() < .7; // a blocked shot can come back out to him
      await this.outcome(opt, good);
      await this.chain(); this.offBall = this.duelOK = this.reboundOK = false;
      tally();
      // Play flows on until a goal; after 4 plays in a row without one, start a fresh situation.
      streak = this.result === 'goal' || this.result === 'goalAgainst' ? 0 : streak + 1;
      live = streak > 0 && streak <= 4 && (this.result !== 'won' || this.has('won-it-go')); // play on after winning it: Won it? Go!
      if (i >= toWin * 25) break; // safety: don't let a match run forever
    }
    return score;
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
  // Called as a play's result shows (outcomes.js emit): after a miss, the idea's short name ("Look up!"), once per
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
