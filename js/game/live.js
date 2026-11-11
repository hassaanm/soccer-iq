// Matches and free play: one play runs on into the next from wherever everyone stands, and each new decision
// (on the ball, defending, getting open, receiving, a 1v1) is built from the live positions.
import { pickRounds } from '../skills.js';
import { lerp, clamp, dist, interceptor, dribbleEnd, shuffle, DRIBBLE_DIRS } from '../geom.js';
import { grade, pushEnd, goalSide, exploit, laneClear, laneBlocked, inPitch } from '../generate.js';
import { L, W, wrap } from './shared.js';

// A decision built from wherever play is right now (continuous matches). The best choice is the good option that
// moves the ball farthest toward goal; other good options also earn 3 stars; backing away into space is "safe".
function liveScenario(s, skill, pushAllowed) {
  const P = a => [a.x, a.y], h = s.a('hero');
  const sc = { id: 'live', skill, kind: 'attack', live: true, hero: P(h), heroTo: P(h), mates: [P(s.a('m1')), P(s.a('m2'))],
    opps: ['o1', 'o2', 'o3'].map(id => P(s.a(id))) };
  sc.oppsTo = sc.opps;
  // Score each good option by how far it moves the ball toward goal. At this age staying on the ball comes first
  // (FA foundation phase), so a pass is the best answer only when it gains clearly more than running with it.
  const g = grade(sc);
  // Passes in live play: open unless a defender is in the lane or really on the receiver. A defender behind the
  // receiver (on his far side from the ball) only counts if he's right on him; the receiver is between him and the ball.
  const opps = s.team('them');
  sc.mates.forEach((m, i) => {
    const mate = s.a('m' + (i + 1)), d = interceptor(s.ball, mate, opps).d;
    const marked = opps.some(o => { const r = dist(o, mate); if (r < 1.2) return true; const behind = (o.x - mate.x) * (s.ball.x - mate.x) + (o.y - mate.y) * (s.ball.y - mate.y) < 0; return r < 1.8 && !behind; });
    g['pass:' + i] = d > 1.1 && !marked ? 'good' : 'bad';
  });
  const gain = o => o === 'shoot' ? 99 : (o.startsWith('pass:') ? sc.mates[+o[5]][0] - 1.5 : (o.startsWith('push:') ? pushEnd(h, o.slice(5)) : dribbleEnd(h, o.slice(5), L, W)).x) - h.x;
  const goods = Object.keys(g).filter(o => g[o] === 'good' && (pushAllowed || !o.startsWith('push:'))).sort((a, b) => gain(b) - gain(a));
  sc.grades = g; sc.best = goods[0] || null; sc.ok = goods.slice(1); sc.safe = Object.keys(g).filter(o => g[o] === 'safe');
  sc.cue = !sc.best ? 'That was a tough spot!' : sc.best.startsWith('pass:') ? `{m${sc.best[5]}} was open!` : sc.best.startsWith('push:') ? 'Lots of space! Push it and go!' : 'There was space to run into!';
  return sc;
}
// A defending decision built from wherever play is right now (after we lose the ball in a match). Spots: get in
// front of the ball, guard each attacker, or chase from behind. A spot is right when it leaves the attackers no
// open run or pass (the same check the defense lessons use). null when no spot can stop them.
function liveDefense(s, guard = true) {
  const c = s.a(s.ball.carrier); if (!c || c.team !== 'them') return null;
  const P = a => [a.x, a.y], h = s.a('hero'), others = s.team('them').filter(o => o.id !== c.id);
  const mates = [P(s.a('m1')), P(s.a('m2'))], near = (p, k) => mates.some(m => Math.hypot(m[0] - p[0], m[1] - p[1]) < k);
  const ok = ([x, y]) => x > 1 && x < L - 1 && y > 1 && y < W - 1;
  const cand = [{ id: 'home', p: goalSide(P(c), 2.6), label: 'In front' },
    ...(guard ? others.map(o => ({ id: o.id, p: goalSide(P(o), 1.2), label: near(P(o), 2) ? 'Help guard' : 'Guard' })) : []), // "Guard" spots come with Only one bee / Guard the open player
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
    for (const k of ['x', 'y', 'tx', 'ty', 'speed', 'sp', 'dist', 'kickAt', 'kickKind', 'kickFoot', 'face']) [h[k], m[k]] = [m[k], h[k]];
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
    // The nearest defender steps up to about 3 m, off to one side, so there's pressure but still room to play.
    const press = s.team('them').sort((a, b) => dist(a, h) - dist(b, h))[0], side = press.y > h.y ? 1 : -1;
    s.go(press.id, Math.min(L - 1, h.x + 2.2), clamp(h.y + side * 1.8, 1, W - 1), 3.5);
    await this.delay(.8); s.stopAll();
    this.sc = liveScenario(s, this.sc?.skill, this.pushAllowed);
  },

  // After we lose the ball in a match: our team gets back into shape for a moment, then he decides where to run.
  // If no spot could stop them, the play just runs on and the geometry decides what happens.
  async continueDefense() {
    const s = this.sim, c = s.a(s.ball.carrier);
    const choose = this.has('get-goal-side'), guard = this.has('one-goes') || this.has('mark-the-free-one');
    this.beginStep({ seen: new Set(), lookUp: false, drag: null, scanned: false, roles: null, ai: true, scripted: new Set(['hero', c.id]), ballTeam: 'them' });
    const h = s.a('hero');
    this.sc = { kind: 'defense', carrier: c.id, spots: [] };
    this.yaw = Math.atan2(c.y - h.y, c.x - h.x); this.faceYaw(h);
    s.go(c.id, Math.max(7, c.x - 2.5), lerp(c.y, W / 2, .3), 2.4); s.go('hero', h.x - 1.2, h.y, 2.4);
    await this.delay(1.1); this.ai = false; s.stopAll();
    const sc = choose ? liveDefense(s, guard) : null;
    if (sc) { this.sc = sc; this.yaw = this.frameYaw(sc, h, c); return true; }
    // No fair choice: play it out from where everyone stands.
    const stay = { kind: 'defense', live: true, id: 'live-stay', carrier: c.id, oppIds: [c.id, ...s.team('them').filter(o => o.id !== c.id).map(o => o.id)],
      mates: [[s.a('m1').x, s.a('m1').y], [s.a('m2').x, s.a('m2').y]], spots: [{ id: 'stay', x: h.x, y: h.y }] };
    stay.oppsTo = [[c.x, c.y], ...stay.oppIds.slice(1).map(id => [s.a(id).x, s.a(id).y])];
    stay.exploits = { stay: exploit(stay, 'stay') };
    this.sc = stay; await this.outcome('spot:stay', !stay.exploits.stay);
    return false;
  },

  async match(skillIds, extra = [], toWin = 2, mode = 'match') {
    this.mode = mode;
    const score = { us: 0, them: 0 }; this.hud.score(score, this.us, this.them);
    const rounds = shuffle([...pickRounds(skillIds, 6), ...extra]);
    // Play flows on: after "Kept the ball!" or "Stole it!" the next choice starts from right there.
    // Only a goal resets to a fresh situation, like a kickoff.
    // After a lost ball he defends from right there; after "Stopped him!" he defends again; after a win he attacks.
    let live = false, next = 0, streak = 0;
    const tally = () => { if (this.result === 'goal') score.us++; else if (this.result === 'goalAgainst') score.them++; this.hud.score(score, this.us, this.them); };
    for (let i = 0; score.us < toWin && score.them < toWin; i++) {
      if (live && this.sim.a(this.sim.ball.carrier)?.team === 'them') {
        if (!(await this.continueDefense())) { tally(); streak = this.result === 'goalAgainst' ? 0 : streak + 1; live = streak > 0 && streak <= 4; continue; }
      } else if (live) await this.continueLive();
      else { streak = 0; this.load(rounds[next++ % rounds.length]); await this.pre(); }
      const opt = await this.decide(), good = this.isGood(opt);
      this.praise(opt);
      // Chances that come from lessons he has passed (only some of the time, so play keeps flowing).
      this.offBall = !this.sc.then && this.has('get-open') && Math.random() < .6;
      this.duelOK = this.has('steal-it') && Math.random() < .6;
      await this.outcome(opt, good);
      await this.chain(); this.offBall = this.duelOK = false;
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

  // Follow-on decisions inside one play: the second step of a give-and-go, where to run after a pass, the pass
  // back to him (peek and turn), or a 1v1 once he's in front of the attacker.
  async chain() {
    const s = this.sim;
    for (let k = 0; k < 4; k++) {
      if (this.result === 'passed' && this.sc.then) await this.toStep2();
      else if (this.result === 'support') { if (!(await this.toSupport())) { this.result = 'kept'; return; } }
      else if (this.result === 'incoming') { if (!(await this.toReceive())) { await this.until(() => s.ball.state !== 'flying'); s.give('hero'); this.result = 'kept'; return; } }
      else if (this.result === 'duel') await this.toDuel();
      else return;
      const o = await this.decide(); this.praise(o); await this.outcome(o, this.isGood(o));
    }
  },
  // After his pass: he stays himself and picks where to run, from where everyone is right now. Spots: open space
  // with a clear path for the pass back (past his defender once he has "Pass and go!"), staying put, or running
  // to the ball. False when there's no fair choice (then he just takes over his friend, as before).
  async toSupport() {
    const s = this.sim, c = s.a(s.ball.carrier), h = s.a('hero'); if (!c || c.team !== 'us' || c.id === 'hero') return false;
    const opps = s.team('them'), O = opps.map(o => [o.x, o.y]), C = [c.x, c.y];
    const press = [...opps].sort((a, b) => dist(a, c) - dist(b, c))[0], mark = opps.filter(o => o !== press).sort((a, b) => dist(a, h) - dist(b, h))[0];
    const room = p => Math.min(...O.map(o => Math.hypot(o[0] - p[0], o[1] - p[1]))), past = this.has('give-and-go');
    let space = null, top = -1e9;
    for (let a = 0; a < 16; a++) for (const d of [3.5, 5]) {
      const p = [h.x + Math.cos(a * Math.PI / 8) * d, h.y + Math.sin(a * Math.PI / 8) * d];
      if (!inPitch(p, 1.2) || p[0] < c.x - 1 || Math.hypot(p[0] - c.x, p[1] - c.y) < 3.5 || !laneClear(C, p, O) || room(p) < 2.4) continue;
      const score = p[0] - Math.hypot(p[0] - h.x, p[1] - h.y) * .3 + (past && p[0] > press.x + 1.2 ? 4 : 0);
      if (score > top) { top = score; space = p; }
    }
    const H = [h.x, h.y], stayOpen = laneClear(C, H, O) && Math.hypot(h.x - c.x, h.y - c.y) > 2.6, stayBlocked = laneBlocked(C, H, O);
    const toH = Math.hypot(h.x - c.x, h.y - c.y) || 1, crowd = [c.x + (h.x - c.x) / toH * 1.6, c.y + (h.y - c.y) / toH * 1.6];
    const spots = [];
    if (space) spots.push({ id: 'space', x: space[0], y: space[1] });
    if (stayOpen || stayBlocked) spots.push({ id: 'stay', x: h.x, y: h.y });
    spots.push({ id: 'ball', x: crowd[0], y: crowd[1], crowd: true });
    if (spots.length < 2 || !(space || stayOpen) || spots.some((p, i) => spots.some((q, j) => j > i && Math.hypot(p.x - q.x, p.y - q.y) < 2.2))) return false;
    const best = space ? 'space' : 'stay';
    this.sc = { kind: 'support', live: true, id: 'live-run', skill: this.sc?.skill, carrier: c.id, pressId: press.id, markId: mark.id, spots,
      best: 'spot:' + best, ok: best === 'space' && stayOpen ? ['spot:stay'] : [], cue: past && space && space[0] > press.x + 1.2 ? 'Pass and go! Run past him into the space.' : 'Move to open space so your friend can pass to you!' };
    this.beginStep({ seen: new Set(), lookUp: false, drag: null });
    s.stopAll(); this.yaw = this.frameYaw(this.sc, h, c); this.faceYaw(h);
    await this.delay(.35);
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
    const P = a => [a.x, a.y], mates = ['m1', 'm2'].map(id => P(s.a(id))), opps = s.team('them').map(P);
    const sc = { kind: 'receive', live: true, id: 'live-recv', skill: this.sc?.skill, carrier: s.team('us').find(a => a.id !== 'hero' && dist(a, { x: b.fx, y: b.fy }) < 1.5)?.id || 'm1',
      hero: P(h), heroTo: P(h), mates, opps, oppsTo: opps, turns };
    const g = grade(sc), goods = ['L', 'R'].filter(k => g['drib:' + turns[k]] === 'good').sort((p, q) => dribbleEnd(h, turns[q], L, W).x - dribbleEnd(h, turns[p], L, W).x);
    if (!goods.length) return false;
    Object.assign(sc, { best: 'turn:' + goods[0], ok: goods.slice(1).map(k => 'turn:' + k), cue: goods.length > 1 ? 'Nobody was behind you. Peek, then turn and go!' : 'A defender was behind you! Peek first, then turn away from him.' });
    this.sc = sc;
    this.beginStep({ lookUp: false, drag: null });
    s.stopAll(); this.yaw = face; this.faceYaw(h);
    return true;
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
