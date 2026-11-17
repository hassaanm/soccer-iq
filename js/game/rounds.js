// One decision round: the run-up, the moment he chooses, and how good each choice is. Around it, the lesson
// loop: play the choice, show why a wrong one failed, replay the better way, and let him try again.
import { dist, dribbleEnd, lerp, clamp } from '../geom.js';
import { grade, pushEnd, LEAD, SHOT, OKAY, BAD } from '../generate.js';
import { L, W, MATE, spotKind, facesBall, faceTo } from './shared.js';
// (v64) A pass to him (peek, then turn) travels at this speed (m/s); the choice opens as it is played. After a shot that
// comes back out, the choice opens as it comes off the post or the leg, and runs while it rolls to rest.
const PASS_IN = 5, FOLLOW_OPEN = 0;
// Won it (round 2): game seconds from the start until he pokes it away, and from then on to the scene's picture.
const WON = { poke: 1.1, lead: 1.7 };
// What he hears and sees when the defender gets there first (v64): kind words, never a buzzer; the first time in a
// lesson, more about what to do.
export const TIMEOUT = { title: 'He got there!', first: 'He came for the ball! Choose before he gets there.', again: 'Choose a bit quicker!',
  // (round 2) A restart: nobody comes for the ball; the taker plays it, and he was not in his place yet.
  restart: { title: 'Ball played!', first: 'Find your place before the ball is played!', again: 'Find your place a bit quicker!' },
  // (v66) Each kind of choice says what really happened: defending, their dribbler got through; off the ball, his friend
  // could wait no longer; a pass to him, it got to him before he had picked his turn; after a shot, they got to it first.
  defense: { title: 'He got past!', first: 'Pick your spot sooner.', again: 'Pick your spot a bit quicker!' },
  off: { title: 'Too late!', first: 'Find your space sooner.', again: 'Find your space a bit quicker!' },
  receive: { title: 'Too late!', first: 'Pick your turn before the ball comes.', again: 'Pick your turn a bit quicker!' },
  follow: { title: 'Too late!', first: 'Run in for the ball sooner.', again: 'Run in a bit quicker!' } };
// The words for a time-out in this scene.
export const timeoutWords = sc => (sc?.restart ? TIMEOUT.restart : sc?.kind === 'defense' ? TIMEOUT.defense : sc?.kind === 'receive' ? TIMEOUT.receive : sc?.run === 'follow' || sc?.shot ? TIMEOUT.follow : sc?.kind === 'support' ? TIMEOUT.off : TIMEOUT);
import { pickFoot } from './outcomes.js';
import { arrAt, pathAt } from '../window.js';

export const rounds = {
  // Short run-up: he dribbles forward head-down while defenders close in.
  async pre() {
    this.phase = 'pre';
    const sc = this.sc, s = this.sim;
    if (sc.intro === 'won') return this.wonIntro();
    if (sc.kind === 'receive') return this.passIn();
    if (sc.kind === 'lead') return this.runIn();
    if (sc.run === 'follow') return this.shotIn();
    if (sc.kind === 'tackle') { // the 1v1: he backs in, the attacker comes on (the STEAL moment is its own window)
      s.go('hero', ...sc.heroTo, 3.6); (sc.oppsTo || []).forEach((p, i) => p && s.go('o' + (i + 1), ...p, 3));
      await this.delay(1.3); s.stopAll(); return;
    }
    if (sc.gk?.hold) { const k = s.a(sc.carrier); Object.assign(s.ball, { state: 'held', carrier: k.id, move: null, reach: null }); k.gkm = { k: 'hold', t0: s.time, low: false }; } // (v64: the keeper's ball, in his hands)
    // (v64) Everyone else comes into the choice on his planned way, still moving as it opens (game/window.js).
    await this.plannedRunUp({ frame: at => {
      const h = at('hero'), hh = s.a('hero');
      if (sc.run === 'goal') { const m = at('m1'); this.yaw = this.frameYaw(sc, h, { x: (m.x + L) / 2, y: (m.y + W / 2) / 2 }); this.faceYaw(hh); }
      // Getting open (v60): he looks out over where he could go (the rings and his friend on the ball), not only at the
      // ball, so the place nearest the camera is not always the same kind of place.
      else if (sc.even && !sc.run) { const c = at(sc.carrier), pts = [...sc.spots, c]; this.yaw = this.frameYaw(sc, h, { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length }); this.faceYaw(hh); }
    } });
  },
  // "Won it? Go!": their player dribbles straight at him, he steps in and pokes the ball off him, and their player
  // stumbles on past him (around him, on the camera's side) and ends up behind him.
  // (v66) He wins it (WON.poke s in), their player stumbles on past him to his place behind him (WON.lead s more), and
  // then the choice opens, with the scene's picture as it is graded. All through, everyone else is already moving as
  // the window has him move (planned before the intro, so nobody changes his way as it opens), and he carries the ball on.
  async wonIntro() {
    const sc = this.sc, s = this.sim, o1 = s.a('o1'), T = WON.poke, lead = WON.lead, T2 = T + lead;
    const plan = this.wplan = this.plan(false, { never: ['o1'] });
    if (!plan) return this.wonIntroOld();
    plan.sc = sc; plan.openAt = s.time + T2;
    const meetH = pathAt(plan.paths.hero, -lead), o0 = pathAt(plan.paths.o1, 0); // where he is as he wins it; their player's place as the choice opens
    const side = Math.sign(o0.y - meetH.y) || 1, meet = { x: meetH.x + 1, y: meetH.y + side * .45 }; // (a little to the side he stumbles past on)
    Object.assign(o1, { x: meetH.x + 3.6, y: meetH.y + side * .2, tx: meetH.x + 3.6, ty: meetH.y + side * .2, face: [-1, 0] });
    Object.assign(s.ball, { x: o1.x - .45, y: o1.y }); s.give('o1'); // the ball at his feet first, so it is his straight away
    for (const [id, p] of Object.entries(plan.paths)) {
      const a = s.a(id); if (!a || id === 'o1') continue;
      // (one who would start off the pitch waits at its edge until his way comes onto it)
      let t0 = -T2; while (t0 < 0 && !a.gk) { const q = pathAt(p, t0); if (q.x > .3 && q.x < L - .3 && q.y > .3 && q.y < W - .3) break; t0 += .1; }
      const q = pathAt(p, t0); Object.assign(a, { x: q.x, y: q.y, tx: q.x, ty: q.y });
      const v = Math.hypot(q.vx, q.vy); if (v > .1 && !a.gk && !plan.watch.has(id)) a.face = [q.vx / v, q.vy / v];
      a.track = { at: tt => pathAt(p, Math.max(t0, tt - T2)), t0: s.time, watch: plan.watch.has(id) && id !== 'hero' };
    }
    s.go('o1', meet.x, meet.y, Math.hypot(meet.x - o1.x, meet.y - o1.y) / T);
    await this.delay(T);
    s.give('hero'); this.sfx('tap'); this.say('You won the ball!');
    // The player he took it from stumbles on, braking as a child does, to his place behind him (a smooth way from how
    // he moves now, round the camera's side of him: past him, not through him), and then goes on with the play.
    const ov = [(meet.x - (meetH.x + 3.6)) / T, (meet.y - (meetH.y + side * .2)) / T], S = [o1.x, o1.y], op = plan.paths.o1, t1 = s.time;
    const st = { herm: true, S, V0: ov, E: [o0.x, o0.y], V1: [o0.vx, o0.vy], T: lead };
    o1.track = { at: tt => pathAt(st, tt), t0: t1, watch: true };
    await this.delay(lead);
    void op; plan.ready = true;
  },
  async wonIntroOld() {
    const sc = this.sc, s = this.sim, h = s.a('hero'), o1 = s.a('o1'), [hx, hy] = sc.heroTo, meet = { x: hx + 1, y: hy };
    Object.assign(o1, { x: hx + 4.6, y: hy + .2, tx: hx + 4.6, ty: hy + .2, face: [-1, 0] });
    Object.assign(s.ball, { x: o1.x - .45, y: o1.y }); s.give('o1');
    s.go('hero', hx, hy, 2.6); s.go('o1', meet.x, meet.y, 3.2);
    (sc.oppsTo || []).forEach((p, i) => i && p && s.go('o' + (i + 1), ...p, 3));
    const t0 = s.time;
    await this.until(() => dist(o1, h) < 1.3 || dist(o1, meet) < .15 || s.time - t0 > 3);
    s.give('hero'); this.sfx('tap'); s.go('hero', hx, hy, 2);
    this.hud.caption('You won the ball! 💪'); this.say('You won the ball!');
    s.go('o1', hx + .3, hy + 1.5, 3); await this.until(() => dist(o1, { x: hx + .3, y: hy + 1.5 }) < .3 || s.time - t0 > 4);
    const o0 = { x: sc.oppsTo[0][0], y: sc.oppsTo[0][1] }, t2 = s.time;
    await this.until(() => { const d = dist(o1, o0); s.go('o1', o0.x, o0.y, clamp(Math.sqrt(2 * 3 * d), .1, 3.8)); return d < .03 || s.time - t2 > 2.5; });
    this.hud.caption('');
  },
  // "Peek, then turn": he checks toward his friend, the friend passes, and he chooses his turn while the ball comes.
  async passIn() {
    const sc = this.sc, s = this.sim, m = s.a('m1'), [hx, hy] = sc.heroTo, b = s.ball;
    // (round 2) Everyone comes on as the pass travels, and is where the scene has him as it gets to him: the window is
    // the pass's flight (it is played as the window opens), and he picks his turn before it arrives.
    const dur = Math.max(.25, Math.hypot(hx - .45 - (m.x + .4), hy - m.y) / PASS_IN);
    await this.plannedRunUp({ skip: ['m1'], G: dur, during: async T => {
      await this.delay(Math.max(0, T - .2));
      const foot = pickFoot(m, hx, hy, 'pass', s.team('them')); // before he turns: the foot depends on which way the pass goes
      this.scripted.add('m1'); faceTo(m, hx, hy); s.windup('m1', 'pass', foot); await this.delay(.2); // (the passer: not one to step out of his own pass's way)
      s.kick(hx - .45, hy, { speed: Math.hypot(hx - .45 - b.x, hy - b.y) / dur, arc: .05 });
      // Pass and move: he steps on after it, off its line.
      const dx = hx - m.x, dy = hy - m.y, l = Math.hypot(dx, dy) || 1, side = Math.sign(W / 2 - m.y) || 1;
      if (this.wplan?.paths) this.wplan.paths.m1 = { go: true, S: [m.x, m.y], E: [m.x + dx / l * .9 - dy / l * side * .9, m.y + dy / l * .9 + dx / l * side * .9], a: 2.5, vMax: 1.2, t0: 0 };
    } });
  },
  // "Pass in front!": he dribbles up while his friend (and a defender chasing him) run up the field; the choice opens
  // mid-run and the run goes on while he chooses, the rings with the runner.
  async runIn() {
    const sc = this.sc, mv = sc.moves, d = sc.dir;
    // His friend (and a defender chasing him) run on through the window, where the scene has them at its own moment;
    // the rings go with the runner.
    await this.plannedRunUp({ keep: { m1: [d[0] * mv.m1.speed, d[1] * mv.m1.speed], ...(mv.o2 ? { o2: [d[0] * mv.o2.speed, d[1] * mv.o2.speed] } : {}) } });
  },
  // "Follow your shot!": the shooter (he, or a friend) dribbles up and shoots; it comes back out off the post or a
  // defender's leg, and a short call says which. The choice opens as the rebound slows down, loose in front of the
  // goal (it rolls the last bit while he decides, and their players set off for it: v64). Meanwhile the others go to where they stand at the freeze, and the
  // shooter carries on in his follow-through, arriving there as it freezes: nobody stands and watches it roll. The
  // shot is seen from behind and above, with no head-down blur and no prompt over it (phase 'shot'). Everyone is held to
  // the script while the ball flies (nobody steps out of its way).
  async shotIn() {
    const sc = this.sc, s = this.sim, b = s.ball, sh = sc.shot, by = s.a(sh.by), t0 = s.time, h = s.a('hero');
    for (const a of s.agents.values()) this.scripted.add(a.id);
    this.phase = 'shot'; this.camMode = 'shot'; this.aimAt = { x: sh.hit[0], y: sh.hit[1] }; // (see view.js camSpec)
    const at = sh.by === 'hero' ? { x: sh.hit[0], y: sh.hit[1] } : { x: lerp(by.x, sh.hit[0], .6), y: lerp(by.y, sh.hit[1], .6) };
    this.yaw = Math.atan2(at.y - h.y, at.x - h.x); this.faceYaw(h);
    // (v66) The view is the one he chooses in, from the start: fitted for where the scene has everyone as it comes out (view.js spotView).
    const yawD = this.frameYaw(sc, { x: sc.heroTo[0], y: sc.heroTo[1] }, { x: sh.loose[0], y: sh.loose[1] }); this.yaw = yawD;
    const flyT = Math.hypot(sh.hit[0] - sh.from[0], sh.hit[1] - sh.from[1]) / SHOT.speed * 1.3, outT = Math.hypot(sh.loose[0] - sh.hit[0], sh.loose[1] - sh.hit[1]) / SHOT.out;
    const runT = Math.min(1.2, Math.hypot(sh.from[0] - by.x, sh.from[1] - by.y) / 3.2) + .2, total = runT + flyT + outT; // (to the strike, then the window: the shot's flight and the rebound's roll)
    const to = (id, p, sec) => { const a = s.a(id), d = Math.hypot(p[0] - a.x, p[1] - a.y); if (d > .05) s.go(id, p[0], p[1], Math.max(.8, d / sec)); };
    // (round 2) The one of theirs who gets to the loose ball first (outcomes.js raceForIt) runs in for it all along, and
    // is where the scene has him as the rebound stops (a racer who blocked the shot is there already).
    const lo = sh.loose, late = id => (id === sh.block ? .75 : .3), racer = sc.oppsTo.map((p, i) => ({ id: 'o' + (i + 1), p })).filter(o => s.a(o.id))
      .sort((p, q) => Math.hypot(p.p[0] - lo[0], p.p[1] - lo[1]) / 4.8 + late(p.id) - Math.hypot(q.p[0] - lo[0], q.p[1] - lo[1]) / 4.8 - late(q.id))[0];
    this.followRuns = []; this.bounced = null; this.followRacer = racer?.id || null;
    // (the covering defender too: he comes across from the side as it is struck)
    // (round 3: he too, when a friend shoots, jogs in toward where it may come out, and is where the scene has him as it does)
    for (const o of [racer, sc.oppsTo[+(sh.cover || 'o0')[1] - 1] && { id: sh.cover, p: sc.oppsTo[+sh.cover[1] - 1] }, sh.by !== 'hero' && { id: 'hero', p: sc.heroTo, me: true }]) {
      if (!o || o.id === sh.block || this.followRuns.some(f => f.id === o.id) || !s.a(o.id)) continue;
      const P = o.p, u = [lo[0] - P[0], lo[1] - P[1]], l = Math.hypot(...u) || 1, run = { arr: true, P: [...P], u: [u[0] / l, u[1] / l], vRun: o === racer ? 3.4 : o.me ? 2.2 : 2.2, vEnd: o === racer ? 1 : o.me ? 1 : .6, dB: o.me ? 1 : 1.6, T: 0, base: 0 };
      const off = () => { const q = arrAt(run, -total); return q.x < .8 || q.x > L - .8 || q.y < .8 || q.y > W - .8; }, u0 = [...run.u];
      // (off the pitch: he comes in on a line turned about his place, up to 90°, the least that keeps him on it)
      if (off()) for (let k = 1, ok = false; k <= 9 && !ok; k++) for (const sg of [1, -1]) { const a = sg * k * .17; run.u = [u0[0] * Math.cos(a) - u0[1] * Math.sin(a), u0[0] * Math.sin(a) + u0[1] * Math.cos(a)]; if (!off()) { ok = true; break; } if (k === 9 && sg === -1) run.u = u0; }
      for (let k = 0; k < 6 && off(); k++) run.vRun = Math.max(1.6, run.vRun * .85);
      const a = s.a(o.id), q = arrAt(run, -total); Object.assign(a, { x: q.x, y: q.y, tx: q.x, ty: q.y, face: [run.u[0], run.u[1]] });
      a.track = { at: tt => arrAt(run, -total + tt), t0: s.time, watch: false };
      this.followRuns.push({ id: o.id, run, t0: s.time, total });
    }
    const moves = [['hero', sc.heroTo], ...sc.matesTo.map((p, i) => ['m' + (i + 1), p]), ...sc.oppsTo.map((p, i) => ['o' + (i + 1), p])].filter(([id]) => id !== sh.by && id !== sh.block && id !== sh.cover && !this.followRuns.some(f => f.id === id));
    for (const [id, p] of moves) to(id, p, .6 + flyT + outT * SHOT.freeze);
    s.go(sh.by, ...sh.from, 3.2);
    await this.until(() => dist(by, { x: sh.from[0], y: sh.from[1] }) < .2 || s.time - t0 > 1.2);
    if (sh.block === 'k2') this.keeperReact(s.a('k2'), { res: 'save', at: { x: sh.hit[0], y: sh.hit[1] }, t: flyT, arc: .1, parry: true }, { x: sh.from[0], y: sh.from[1] }); // (v62: he gets to it, and it comes back out)
    const end = sh.by === 'hero' ? sc.heroTo : sc.matesTo[0];
    // (round 2) The choice opens as he strikes it ("follow your shot!"): the flight and the rebound go on in the window,
    // on game time (a job, so his tap's play does not cut them off).
    await this.play(this.shotOut(sh, { x: end[0], y: end[1], speed: Math.max(1.2, Math.hypot(end[0] - by.x, end[1] - by.y) / (.2 + flyT + outT * SHOT.freeze)) }, true));
    this.scripted = new Set(); this.phase = 'pre'; this.camMode = 'player'; this.aimAt = null;
    this.yaw = yawD; if (b.carrier !== 'hero') this.faceYaw(h); // (he may still be winding up to shoot: his body stays on the shot)
  },
  // The shot's flight on from the strike and its bounce off the post, the keeper or the leg, as a job on game time.
  shotBounce(sh, from) {
    const s = this.sim, b = s.ball, hit = { x: sh.hit[0], y: sh.hit[1] }, l = dist(from, hit) || 1, d = { x: (hit.x - from.x) / l, y: (hit.y - from.y) / l };
    let done = false;
    this.job(8, () => {
      if (done || !(b.state !== 'flying' || (b.x - from.x) * d.x + (b.y - from.y) * d.y >= l)) return;
      done = true; this.bounced = s.time;
      Object.assign(b, { x: hit.x, y: hit.y }); // (the step can carry it a few cm past the post: it bounces off where it touched)
      s.kick(sh.loose[0], sh.loose[1], { speed: SHOT.out, arc: .12 });
      if (sh.block) { const o = s.a(sh.block), k = Math.sign((sh.loose[0] - hit.x) * -d.y + (sh.loose[1] - hit.y) * d.x) || 1; s.go(o.id, o.x - d.x * .2 + d.y * k * .15, o.y - d.y * .2 - d.x * k * .15, .8); }
      const call = sh.block === 'k2' ? 'Saved!' : sh.block ? 'Blocked!' : 'Off the post!'; this.hud.caption(call); this.say(call);
      if (sh.cover && !this.followRuns?.some(f => f.id === sh.cover)) { const sc = this.sc, p = sc.oppsTo[+sh.cover[1] - 1], a = s.a(sh.cover), dd = Math.hypot(p[0] - a.x, p[1] - a.y); if (dd > .05) s.go(sh.cover, p[0], p[1], Math.max(.8, dd / (dist(hit, { x: sh.loose[0], y: sh.loose[1] }) / SHOT.out * SHOT.freeze))); }
    }, () => done);
  },
  // The players running in a lead-pass round go on with their runs (also after a replay puts them back).
  leadRun() { for (const [id, mv] of Object.entries(this.sc.moves || {})) Object.assign(this.sim.a(id), { tx: mv.to[0], ty: mv.to[1], speed: mv.speed, sp: mv.speed }); },

  decide() {
    this.phase = 'decide'; this.step = spotKind(this.sc) ? 'spot' : null; this.decideAt = this.sim.time; this.decideReal = this.realTime || 0; this.pendingDir = null;
    if (this.sc.kind === 'receive') { // the ball comes on while he chooses (v64)
      this.step = 'turn'; this.peeked = false; this.drag = null; this.facePasser();
    }
    if (this.sc.kind === 'tackle') { // the attacker comes at him; he taps STEAL (or the attacker gets past)
      this.step = 'tackle'; this.lookUp = true; this.scanned = true;
      const g = this; this.sim.run((function* () { if (!(yield* g.approach(false))) g.choose('tackle:none'); })());
    }
    this.openWindow(); // (v64) play goes on in slow motion while he chooses (game/window.js)
    this.delay(1.2).then(() => { if (this.phase === 'decide' && this.mode !== 'demo') this.hud.caption(''); }); // (on real time, made in the window: the words of the run-up go)
    // His choice ends what was said before it ("Your turn!"), however soon it comes.
    return new Promise(res => { this._choose = opt => { this.closeWindow(); if (this.mode !== 'demo') this.hud.caption(''); res(opt); }; });
  },
  // How good a choice is: 'best' (the star answer), 'ok' (just as good), 'safe' (keeps the ball but there was
  // a better choice) or 'bad' (loses it). Dribbles are graded by the real space on the field, so any of the
  // eight directions into open grass works, and only directions a defender blocks lose the ball.
  rating(opt) {
    if (opt === 'timeout') return 'bad'; // (v64) the defender got there first: no choice made
    if (this.sc.best && opt === this.sc.best) return 'best';
    if (this.sc.kind === 'tackle' || this.sc.then) return 'bad'; // a give-and-go step 1 has one right answer: the pass
    if (opt === 'turn:B') return (this.sc.safe || []).includes(opt) ? 'safe' : 'bad'; // (v64) the pass straight back
    if (opt.startsWith('turn:')) return grade(this.sc)['drib:' + this.sc.turns[opt[5]]] === 'good' ? 'ok' : 'bad';
    if (opt.startsWith('shoot:') && !this.sc.shots?.[opt]) { // (a match: as SHOOT is, then each part he picked: the target and the foot; v64: by the choice, not by how the chances fell)
      const r = this.rating('shoot'), g = this.shotPartGrades(opt);
      return r === 'bad' || g?.space === false || (g?.foot === false && g.space == null) ? 'bad' : g?.space === 'okay' || g?.foot === false ? 'safe' : r; // (the foot alone wrong: a miss, as before; with a good target: 2 stars)
    }
    if ((this.sc.ok || []).includes(opt)) return 'ok';
    if ((this.sc.safe || []).includes(opt)) return 'safe';
    if (spotKind(this.sc)) return 'bad';
    const g = (this.grades ||= this.sc.grades || grade(this.sc))[opt];
    if ((opt.startsWith('drib:') || opt.startsWith('push:') || opt === 'shoot') && g === 'good') return 'ok';
    if ((opt.startsWith('drib:') || opt.startsWith('push:')) && g === 'safe') return 'safe';
    return 'bad';
  },
  isGood(opt) { return this.rating(opt) !== 'bad'; },
  target(opt) {
    const h = this.sim.a('hero');
    if (opt.startsWith('tackle:')) return { x: this.sim.ball.x, y: this.sim.ball.y };
    if (opt === 'shoot') return { x: L, y: W / 2 }; // the middle of the goal (it used to fall through to a dribble: NaN)
    if (opt.startsWith('shoot:')) return { x: L, y: this.shotOf(opt).aimY }; // where that shot was aimed
    if (opt === 'turn:B') return { ...this.sim.a(this.sc.carrier || 'm1') };
    if (opt.startsWith('turn:')) return dribbleEnd({ x: this.sc.heroTo[0], y: this.sc.heroTo[1] }, this.sc.turns[opt[5]], L, W);
    if (opt.startsWith('spot:')) { const sp = this.sc.spots.find(x => x.id === opt.slice(5)); return { x: sp.x, y: sp.y }; }
    if (opt.startsWith('push:')) return pushEnd(h, opt.slice(5));
    return MATE[opt] ? { ...this.sim.a(MATE[opt]) } : dribbleEnd(h, opt.slice(5), L, W);
  },
  // A line with his teammates' names filled in.
  named(text) { return text.replace(/\{m([012])\}/g, (_, i) => this.name('m' + (+i + 1))); },
  cue() { return this.named(this.sc.cue); },

  // Give-and-go, step 2: the friend has the ball; the defender who was on him turns to press the friend.
  async toStep2() {
    const s = this.sim, base = this.sc, t = base.then;
    this.sc = { ...t, spots: t.spots.map(sp => ({ ...sp })), skill: base.skill, id: base.id + '-2', pattern: base.pattern }; // (its own rings: they move in the window)
    this.beginStep({ seen: new Set(), lookUp: false, drag: null });
    s.stopAll(); s.go('o1', ...t.move.o1, 3.2); s.go('o2', ...t.move.o2, 2.6);
    this.yaw = this.frameYaw(this.sc, { x: base.heroTo[0], y: base.heroTo[1] }, s.a('m1'));
    await this.delay(.8); // (v64: and play goes on into his choice)
  },

  // Plays one scenario until he gets it. Wrong choices show why, replay the better way, then retry.
  // A give-and-go has two steps (the pass, then the run); each one is retried on its own.
  // `light`: a right answer on the first try gets a light result (Level 2 and up, flows.js).
  async round(sc, { hint, light = false, level = 1, first = false }) {
    this.mode = 'lesson'; this.light = light; this.shown = new Set(); // shown: wrong choices already replayed in this round
    this.level1 = level <= 1; this.firstRound = first; // (v64: the window's length, window.js; a new idea's very first round has the longest)
    this.load(sc); await this.pre();
    let firstTry = true;
    for (;;) {
      const more = !!this.sc.then, r = await this.attempt(hint, more);
      firstTry &&= r.firstTry;
      if (r.stars === 2) return { firstTry: false, stars: 2 };
      if (!more) return { firstTry, stars: 3 };
      await this.toStep2();
    }
  },
  // One decision, retried until it is right. `more`: another step follows, so a right choice shows no result yet.
  async attempt(hint, more) {
    const sc = this.sc, save = this.sim.save(), yawSave = this.yaw;
    // After a replay the round starts over facing the same way as before (toward the ball on a receive or on
    // defense), not up the field.
    const plan = this.wplan, runs = { followRuns: this.followRuns, followRacer: this.followRacer, reshoot: this.reshoot }, t00 = this.sim.time; // (v64: the window's plan from the run-up; a restart puts the play back where it opens, with its runs and shot)
    const restart = () => { this.sim.restore(save); this.reset(); this.spotsReset(); if (plan) plan.ready = true; Object.assign(this, runs, { followRuns: (runs.followRuns || []).map(f => ({ ...f, t0: f.t0 + this.sim.time - t00 })) }); this.reshoot?.(); /* (the sim's clock runs on through a restart: the runs keep their place in the play) */ /* (round 2: a shot still to be struck as it opens) */ this.camMode = 'player'; this.yaw = yawSave; const h = this.sim.a('hero'); if (h && facesBall(sc)) this.faceYaw(h); this.leadRun(); };
    let firstTry = true;
    for (let attempt = 1; ; attempt++) {
      this.hint = hint || attempt > 1;
      const opt = await this.decide();
      if (opt === 'timeout') { // (v64) the defender got there first: kind words, then the same round again with more time
        if (attempt === 1) this.logChoice?.(opt, 'bad');
        firstTry = false; await this.timedOut(restart); continue;
      }
      const rating = this.rating(opt), good = rating !== 'bad', scanned = this.scanned;
      if (attempt === 1) this.logChoice?.(opt, rating); // first tries only: a retry comes after he was shown the way
      // Every decision gets 0–3 stars. 3 = the best choice, 2 = safe but there was a better one, 0 = lost it.
      // The stars and tip are decided now and shown together with the result, the moment the play ends.
      // The praise names what he did, and looking up is praised in every lesson (it is the habit under all of them).
      const praise = sc.kind === 'tackle' ? 'Great steal!' : sc.kind === 'receive' && this.peeked ? 'You peeked!' : sc.kind === 'defense' ? 'Great defending!' : sc.kind === 'support' ? 'Great run!' : scanned ? (this.lookedEarly ? 'You looked early!' : 'You looked up!') : sc.kind === 'lead' ? 'Great pass!' : 'Great choice!';
      const why = opt.startsWith('spot:') && sc.spots?.find(x => 'spot:' + x.id === opt)?.why; // an only-okay run says what was not quite right (generate.js OKAY); some wrong runs say why (BAD)
      const tip = OKAY[why] || (opt.startsWith('shoot:') ? this.shotTip(opt) : 'You kept it! Even better: ' + this.cue().replace(/^./, ch => ch.toLowerCase())); // (a shot: the right space with the wrong foot)
      this.rated = more && good && opt === sc.best ? null : rating === 'safe' ? { stars: this.shotMissed?.(opt) ? 1 : 2, text: tip, watch: true, say: true } // (v64: a shot that does not go in never shows more than 1 star)
        : good && this.light && attempt === 1 ? { stars: 3, light: true, said: praise } // stars and the praise, then on
        : good ? { stars: 3, text: sc.praise ? this.named(sc.praise) : opt !== sc.best && MATE[opt] ? `${praise} ${this.named(`{m${opt[5]}} was open too!`)}` : `${praise} ${this.cue()}`, said: praise } // (a pass as good as the best one: the praise names the friend he picked) // show why it was right, so the idea sticks; say the praise
        : BAD[why] ? { stars: 0, text: BAD[why], say: true }
        : { stars: 0, text: sc.kind === 'defense' || sc.kind === 'tackle' ? 'He got through!' : sc.run === 'follow' || sc.shot ? 'The ball was loose. Run in for it!' : sc.kind === 'support' ? 'He could not pass to you!' : opt.startsWith('shoot:') ? this.shotWhy(opt) : 'Oops, lost it!' }; // (a shot: what happened, and why: outcomes.js shotWhy)
      this.card = null;
      await this.outcome(opt, good);
      if (more && good && opt === sc.best) return { firstTry: attempt === 1 && firstTry, stars: 3 };
      const answer = await (this.card || this.hud.banner('', 'goal', this.rated));
      this.rated = null;
      if (good && rating !== 'safe') return { firstTry: attempt === 1 && firstTry, stars: 3 };
      if (rating === 'safe') {
        if (answer === 'watch') {
          restart(); this.showing = true; this.phase = 'decide'; this.step = spotKind(sc) ? 'spot' : null; this.openWindow();
          await this.talk('Here is the 3-star play!', .2); await this.showPlay(sc.best); await this.delay(.8); this.hud.caption('');
        }
        return { firstTry: false, stars: 2 };
      }
      // The same wrong choice twice in one round: no second replay, straight back to try again.
      if (!this.shown.has(opt)) {
        this.shown.add(opt);
        await this.feedback(save, opt);
        restart(); this.showing = true; this.phase = 'decide'; this.step = spotKind(sc) ? 'spot' : null; this.openWindow(); // (v64: the better way, from play going on)
        await this.talk('Watch this way!', .2);
        await this.showPlay(sc.best);
        await this.delay(.8); // let the better play land before resetting
      }
      restart();
      this.hud.caption('Your turn!'); this.say('Your turn!');
    }
  },
  // (v64) He did not choose before the defender got there. The play showed it (outcomes.js timeoutGen); the card says it
  // kindly, with no stars taken. The first time in a lesson he sees it once more, at play speed, with the defender's
  // reach coming to the ball, and hears what to do. Then the same round again, with a longer window (window.js RETRY).
  async timedOut(restart) {
    const first = !this.lessonTimeouts;
    this.lessonTimeouts = (this.lessonTimeouts || 0) + 1; this.timeouts = (this.timeouts || 0) + 1;
    const T = timeoutWords(this.sc), line = first ? T.first : T.again;
    this.rated = { stars: 0, nostars: true, text: line, said: line, soft: true, title: T.title };
    this.card = null;
    await this.outcome('timeout', false);
    await (this.card || this.hud.banner('', 'soft', this.rated)); this.rated = null;
    if (first && this.level1) { // see the defender come once more, at play speed
      restart(); this.showing = true; this.phase = 'decide'; this.step = spotKind(this.sc) ? 'spot' : null;
      this.openWindow(); this.win.f = Math.min(1, this.win.G / 2.2); this.hud.caption(this.sc?.restart || this.sc?.kind === 'receive' || this.sc?.run === 'follow' ? 'Watch the ball! 👀' : 'Watch him come! 👀');
      await this.until(() => !this.win || this.win.u >= 1); this.closeWindow(); this.showing = false;
      await this.delay(.4); this.hud.caption('');
    }
    restart();
    this.hud.caption('Your turn!'); this.say('Your turn!');
  },
  // Freeze at the decision moment: red line for his choice, green for the better one.
  async feedback(save, opt) {
    if (this.sc.kind === 'tackle') { // no lines for a 1v1: just the cue, then the replay shows the moment
      const y = this.yaw; this.sim.restore(save); this.reset(); this.yaw = y; this.camMode = 'player'; this.phase = 'feedback';
      await this.talk(this.cue(), 1.5); return;
    }
    this.sim.restore(save); this.reset(); this.spotsReset(); this.camMode = 'overview'; this.phase = 'feedback'; this.leadRun();
    // Where he ran to (defending, getting open): the lines start at him, and he is marked; else (a pass, a dribble)
    // at the ball.
    const runs = this.sc.kind === 'defense' || this.sc.kind === 'support', h = this.sim.a('hero');
    const from = runs ? { x: h.x, y: h.y } : { x: this.sim.ball.x, y: this.sim.ball.y }, bad = this.target(opt), best = this.target(this.sc.best);
    // Staying put was the wrong choice: no red arrow from him to himself; his own ring turns red instead.
    const stayed = runs && Math.hypot(bad.x - from.x, bad.y - from.y) < .8;
    this.markHero = runs; this.markRed = stayed;
    this.lines = [...(stayed ? [] : [{ a: from, b: { x: bad.x, y: bad.y }, color: '#e5484d' }]), { a: from, b: { x: best.x, y: best.y }, color: '#30a46c' }];
    this.aimAt = { x: (bad.x + best.x) / 2, y: (bad.y + best.y) / 2 };
    await this.talk(this.cue(), 1.5); // red line, green line, and why: wait for the whole sentence, then a beat
    this.lines = []; this.aimAt = null; this.markHero = this.markRed = false;
  },
};
