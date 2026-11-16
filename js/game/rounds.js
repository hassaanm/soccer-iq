// One decision round: the run-up, the moment he chooses, and how good each choice is. Around it, the lesson
// loop: play the choice, show why a wrong one failed, replay the better way, and let him try again.
import { dist, dribbleEnd, lerp } from '../geom.js';
import { grade, pushEnd, LEAD, RUN_UP, SHOT, OKAY, BAD } from '../generate.js';
import { L, W, MATE, spotKind, facesBall, faceTo } from './shared.js';
// The rule for the foot ("Inside or laces?"), in his coach's words: said when he picked the right space with the wrong foot.
const FOOT_TIP = { in: 'Close? Inside, for control.', las: 'Far? Laces, for power!' };
import { pickFoot } from './outcomes.js';

export const rounds = {
  // Short run-up: he dribbles forward head-down while defenders close in.
  async pre() {
    this.phase = 'pre';
    const sc = this.sc, s = this.sim;
    if (sc.intro === 'won') return this.wonIntro();
    if (sc.kind === 'receive') return this.passIn();
    if (sc.kind === 'lead') return this.runIn();
    if (sc.run === 'follow') return this.shotIn();
    if (sc.run === 'goal') return this.goalIn();
    s.go('hero', ...sc.heroTo, 3.6);
    if (sc.gk?.from) s.go('k2', ...sc.gk.them, Math.hypot(sc.gk.them[0] - sc.gk.from[0], sc.gk.them[1] - sc.gk.from[1]) / 1.15); // their keeper rushes out at him (v62)
    if (sc.kind === 'defense') s.go(sc.carrier, ...sc.oppsTo[0], 3);
    (sc.oppsTo || []).forEach((p, i) => p && s.go('o' + (i + 1), ...p, 3));
    if (sc.matesTo) sc.matesTo.forEach((p, i) => { const a = s.a('m' + (i + 1)), d = a && Math.hypot(p[0] - a.x, p[1] - a.y); if (d > .05) s.go(a.id, ...p, Math.max(1, d / 1.25)); }); // (v64: a friend dribbling up as he decides)
    await this.delay(1.3);
    s.stopAll();
    // Getting open (v60): he looks out over where he could go (the rings and his friend on the ball), not only at the
    // ball, so the place nearest the camera is not always the same kind of place.
    if (sc.even && !sc.run) { const h = s.a('hero'), c = s.a(sc.carrier), pts = [...sc.spots, c]; this.yaw = this.frameYaw(sc, h, { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length }); this.faceYaw(h); }
  },
  // "Won it? Go!": their player dribbles straight at him, he steps in and pokes the ball off him, and their player
  // stumbles on past him (around him, on the camera's side) and ends up behind him.
  async wonIntro() {
    const sc = this.sc, s = this.sim, h = s.a('hero'), o1 = s.a('o1'), [hx, hy] = sc.heroTo, meet = { x: hx + 1, y: hy };
    Object.assign(o1, { x: hx + 4.6, y: hy + .2, tx: hx + 4.6, ty: hy + .2, face: [-1, 0] });
    Object.assign(s.ball, { x: o1.x - .45, y: o1.y }); s.give('o1'); // the ball at his feet first, so it is his straight away
    s.go('hero', hx, hy, 2.6); s.go('o1', meet.x, meet.y, 3.2);
    (sc.oppsTo || []).forEach((p, i) => i && p && s.go('o' + (i + 1), ...p, 3));
    const t0 = s.time;
    await this.until(() => dist(o1, h) < 1.3 || dist(o1, meet) < .15 || s.time - t0 > 3);
    s.give('hero'); this.sfx('tap'); s.go('hero', hx, hy, 2); // the ball is at his feet now (it rolls the last bit)
    this.hud.caption('You won the ball! 💪'); this.say('You won the ball!');
    s.go('o1', hx + .3, hy + 1.5, 3); await this.until(() => dist(o1, { x: hx + .3, y: hy + 1.5 }) < .3 || s.time - t0 > 4);
    s.go('o1', ...sc.oppsTo[0], 3.6); await this.delay(.8);
    s.stopAll(); this.hud.caption('');
  },
  // "Peek, then turn": he checks toward his friend, the friend passes, and the play freezes with the ball on its way.
  async passIn() {
    const sc = this.sc, s = this.sim, m = s.a('m1'), [hx, hy] = sc.heroTo;
    s.go('hero', hx, hy, 2.5); (sc.oppsTo || []).forEach((p, i) => p && s.go('o' + (i + 1), ...p, 3));
    await this.delay(.5);
    const foot = pickFoot(m, hx, hy, 'pass', s.team('them')); // before he turns: the foot depends on which way the pass goes
    faceTo(m, hx, hy); s.windup('m1', 'pass', foot); await this.delay(.2);
    s.kick(hx - .45, hy, { speed: 6.5, arc: .05 }); await this.delay(.4);
    s.stopAll();
  },
  // "Pass in front!": he dribbles up while his friend (and a defender chasing him) run up the field; the play
  // freezes mid-run, everyone exactly where the scenario put them, so the spots match the run.
  async runIn() {
    const sc = this.sc, s = this.sim;
    s.go('hero', ...sc.heroTo, 3.6); sc.oppsTo.forEach((p, i) => s.go('o' + (i + 1), ...p, 3)); this.leadRun();
    await this.delay(LEAD.pre);
    s.stopAll(); for (const [id, mv] of Object.entries(sc.moves)) Object.assign(s.a(id), { x: mv.at[0], y: mv.at[1] });
    this.leadRun(); this.phase = 'idle'; // held still (see tick) until he plays the pass
  },
  // "Follow your shot!": the shooter (he, or a friend) dribbles up and shoots; it comes back out off the post or a
  // defender's leg, and a short call says which. The play freezes as the rebound slows down, loose in front of the
  // goal (it rolls the last bit while he decides). Meanwhile the others go to where they stand at the freeze, and the
  // shooter carries on in his follow-through, arriving there as it freezes: nobody stands and watches it roll. The
  // shot is seen from behind and above, with no head-down blur and no prompt over it (phase 'shot'). Everyone is held to
  // the script while the ball flies (nobody steps out of its way).
  async shotIn() {
    const sc = this.sc, s = this.sim, b = s.ball, sh = sc.shot, by = s.a(sh.by), t0 = s.time, h = s.a('hero');
    for (const a of s.agents.values()) this.scripted.add(a.id);
    this.phase = 'shot'; this.camMode = 'shot'; this.aimAt = { x: sh.hit[0], y: sh.hit[1] }; // (see view.js camSpec)
    const at = sh.by === 'hero' ? { x: sh.hit[0], y: sh.hit[1] } : { x: lerp(by.x, sh.hit[0], .6), y: lerp(by.y, sh.hit[1], .6) };
    this.yaw = Math.atan2(at.y - h.y, at.x - h.x); this.faceYaw(h);
    const rollT = Math.hypot(sh.loose[0] - sh.hit[0], sh.loose[1] - sh.hit[1]) / SHOT.out * SHOT.freeze, flyT = Math.hypot(sh.hit[0] - sh.from[0], sh.hit[1] - sh.from[1]) / SHOT.speed * 1.3;
    const to = (id, p, sec) => { const a = s.a(id), d = Math.hypot(p[0] - a.x, p[1] - a.y); if (d > .05) s.go(id, p[0], p[1], Math.max(.8, d / sec)); };
    const moves = [['hero', sc.heroTo], ...sc.matesTo.map((p, i) => ['m' + (i + 1), p]), ...sc.oppsTo.map((p, i) => ['o' + (i + 1), p])].filter(([id]) => id !== sh.by && id !== sh.block && id !== sh.cover);
    for (const [id, p] of moves) to(id, p, .6 + flyT + rollT);
    s.go(sh.by, ...sh.from, 3.2);
    await this.until(() => dist(by, { x: sh.from[0], y: sh.from[1] }) < .2 || s.time - t0 > 1.2);
    if (sh.block === 'k2') this.keeperReact(s.a('k2'), { res: 'save', at: { x: sh.hit[0], y: sh.hit[1] }, t: flyT, arc: .1, parry: true }, { x: sh.from[0], y: sh.from[1] }); // (v62: he gets to it, and it comes back out)
    const end = sh.by === 'hero' ? sc.heroTo : sc.matesTo[0];
    await this.play(this.shotOut(sh, { x: end[0], y: end[1], speed: Math.max(1.2, Math.hypot(end[0] - by.x, end[1] - by.y) / (.2 + flyT + rollT)) }));
    const call = sh.block === 'k2' ? 'Saved!' : sh.block ? 'Blocked!' : 'Off the post!'; this.hud.caption(call); this.say(call);
    if (sh.cover) to(sh.cover, sc.oppsTo[+sh.cover[1] - 1], rollT);
    const t1 = s.time; await this.until(() => b.state !== 'flying' || b.t >= SHOT.freeze || s.time - t1 > 2.5);
    s.stopAll(); this.scripted = new Set(); this.phase = 'pre'; this.camMode = 'player'; this.aimAt = null;
    this.yaw = this.frameYaw(sc, h, { x: sh.loose[0], y: sh.loose[1] }); this.faceYaw(h);
  },
  // "Run to the goal too!": his friend dribbles at goal, he jogs up off the ball, and the play freezes. The view looks
  // between his friend and the goal, so both are on screen with the spots.
  async goalIn() {
    const sc = this.sc, s = this.sim;
    const to = (id, p, min) => { const a = s.a(id); s.go(id, p[0], p[1], Math.max(min, Math.hypot(p[0] - a.x, p[1] - a.y) / (RUN_UP - .1))); };
    to('hero', sc.heroTo, 2.4); s.go('m1', ...sc.matesTo[0], 3.2); sc.matesTo.forEach((p, i) => i && to('m' + (i + 1), p, 1)); sc.oppsTo.forEach((p, i) => to('o' + (i + 1), p, 1));
    await this.delay(RUN_UP);
    s.stopAll();
    const h = s.a('hero'), m = s.a('m1'); this.yaw = this.frameYaw(sc, h, { x: (m.x + L) / 2, y: (m.y + W / 2) / 2 }); this.faceYaw(h);
  },
  // The players running in a lead-pass round go on with their runs (also after a replay puts them back).
  leadRun() { for (const [id, mv] of Object.entries(this.sc.moves || {})) Object.assign(this.sim.a(id), { tx: mv.to[0], ty: mv.to[1], speed: mv.speed, sp: mv.speed }); },

  decide() {
    this.phase = 'decide'; this.step = spotKind(this.sc) ? 'spot' : null; this.decideAt = this.sim.time; this.pendingDir = null;
    if (this.sc.kind === 'receive') { // the ball waits in the air
      this.step = 'turn'; this.peeked = false; this.drag = null; this.facePasser();
    }
    if (this.sc.kind === 'tackle') { // the attacker comes at him; he taps STEAL (or the attacker gets past)
      this.step = 'tackle'; this.lookUp = true; this.scanned = true;
      const g = this; this.sim.run((function* () { if (!(yield* g.approach(false))) g.choose('tackle:none'); })());
    }
    this.delay(1.2).then(() => { if (this.phase === 'decide') this.hud.caption(''); });
    // His choice ends what was said before it ("Your turn!"), however soon it comes.
    return new Promise(res => { this._choose = opt => { if (this.mode !== 'demo') this.hud.caption(''); res(opt); }; });
  },
  // How good a choice is: 'best' (the star answer), 'ok' (just as good), 'safe' (keeps the ball but there was
  // a better choice) or 'bad' (loses it). Dribbles are graded by the real space on the field, so any of the
  // eight directions into open grass works, and only directions a defender blocks lose the ball.
  rating(opt) {
    if (this.sc.best && opt === this.sc.best) return 'best';
    if (this.sc.kind === 'tackle' || this.sc.then) return 'bad'; // a give-and-go step 1 has one right answer: the pass
    if (opt === 'turn:B') return (this.sc.safe || []).includes(opt) ? 'safe' : 'bad'; // (v64) the pass straight back
    if (opt.startsWith('turn:')) return grade(this.sc)['drib:' + this.sc.turns[opt[5]]] === 'good' ? 'ok' : 'bad';
    if (opt.startsWith('shoot:') && !this.sc.shots?.[opt]) { const r = this.rating('shoot'); return r !== 'bad' && this.shotOf(opt).res === 'goal' ? r : 'bad'; } // (a match: as SHOOT is, if it goes in)
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
    this.sc = { ...t, skill: base.skill, id: base.id + '-2', pattern: base.pattern };
    this.beginStep({ seen: new Set(), lookUp: false, drag: null });
    s.stopAll(); s.go('o1', ...t.move.o1, 3.2); s.go('o2', ...t.move.o2, 2.6);
    this.yaw = this.frameYaw(this.sc, { x: base.heroTo[0], y: base.heroTo[1] }, s.a('m1'));
    await this.delay(.8); s.stopAll();
  },

  // Plays one scenario until he gets it. Wrong choices show why, replay the better way, then retry.
  // A give-and-go has two steps (the pass, then the run); each one is retried on its own.
  // `light`: a right answer on the first try gets a light result (Level 2 and up, flows.js).
  async round(sc, { hint, light = false }) {
    this.mode = 'lesson'; this.light = light; this.shown = new Set(); // shown: wrong choices already replayed in this round
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
    const restart = () => { this.sim.restore(save); this.reset(); this.camMode = 'player'; this.yaw = yawSave; const h = this.sim.a('hero'); if (h && facesBall(sc)) this.faceYaw(h); this.leadRun(); };
    for (let attempt = 1; ; attempt++) {
      this.hint = hint || attempt > 1;
      const opt = await this.decide();
      const rating = this.rating(opt), good = rating !== 'bad', scanned = this.scanned;
      if (attempt === 1) this.logChoice?.(opt, rating); // first tries only: a retry comes after he was shown the way
      // Every decision gets 0–3 stars. 3 = the best choice, 2 = safe but there was a better one, 0 = lost it.
      // The stars and tip are decided now and shown together with the result, the moment the play ends.
      // The praise names what he did, and looking up is praised in every lesson (it is the habit under all of them).
      const praise = sc.kind === 'tackle' ? 'Great steal!' : sc.kind === 'receive' && this.peeked ? 'You peeked!' : sc.kind === 'defense' ? 'Great defending!' : sc.kind === 'support' ? 'Great run!' : scanned ? 'You looked up!' : sc.kind === 'lead' ? 'Great pass!' : 'Great choice!';
      const why = opt.startsWith('spot:') && sc.spots?.find(x => 'spot:' + x.id === opt)?.why; // an only-okay run says what was not quite right (generate.js OKAY); some wrong runs say why (BAD)
      const tip = OKAY[why] || (opt.startsWith('shoot:') ? 'Good space! ' + FOOT_TIP[this.shotOf(opt).res === 'over' ? 'in' : 'las'] : 'You kept it! Even better: ' + this.cue().replace(/^./, ch => ch.toLowerCase())); // (a shot: the right space with the wrong foot)
      this.rated = more && good && opt === sc.best ? null : rating === 'safe' ? { stars: 2, text: tip, watch: true, say: true }
        : good && this.light && attempt === 1 ? { stars: 3, light: true, said: praise } // stars and the praise, then on
        : good ? { stars: 3, text: sc.praise ? this.named(sc.praise) : opt !== sc.best && MATE[opt] ? `${praise} ${this.named(`{m${opt[5]}} was open too!`)}` : `${praise} ${this.cue()}`, said: praise } // (a pass as good as the best one: the praise names the friend he picked) // show why it was right, so the idea sticks; say the praise
        : BAD[why] ? { stars: 0, text: BAD[why], say: true }
        : { stars: 0, text: sc.kind === 'defense' || sc.kind === 'tackle' ? 'He got through!' : sc.run === 'follow' || sc.shot ? 'The ball was loose. Run in for it!' : sc.kind === 'support' ? 'He could not pass to you!' : opt.startsWith('shoot:') ? this.shotWhy(opt) : 'Oops, lost it!' }; // (a shot: what happened, and why: outcomes.js shotWhy)
      this.card = null;
      await this.outcome(opt, good);
      if (more && good && opt === sc.best) return { firstTry: attempt === 1, stars: 3 };
      const answer = await (this.card || this.hud.banner('', 'goal', this.rated));
      this.rated = null;
      if (good && rating !== 'safe') return { firstTry: attempt === 1, stars: 3 };
      if (rating === 'safe') {
        if (answer === 'watch') {
          restart();
          await this.talk('Here is the 3-star play!', .2); await this.showPlay(sc.best); await this.delay(.8); this.hud.caption('');
        }
        return { firstTry: false, stars: 2 };
      }
      // The same wrong choice twice in one round: no second replay, straight back to try again.
      if (!this.shown.has(opt)) {
        this.shown.add(opt);
        await this.feedback(save, opt);
        restart();
        await this.talk('Watch this way!', .2);
        await this.showPlay(sc.best);
        await this.delay(.8); // let the better play land before resetting
      }
      restart();
      this.hud.caption('Your turn!'); this.say('Your turn!');
    }
  },
  // Freeze at the decision moment: red line for his choice, green for the better one.
  async feedback(save, opt) {
    if (this.sc.kind === 'tackle') { // no lines for a 1v1: just the cue, then the replay shows the moment
      const y = this.yaw; this.sim.restore(save); this.reset(); this.yaw = y; this.camMode = 'player'; this.phase = 'feedback';
      await this.talk(this.cue(), 1.5); return;
    }
    this.sim.restore(save); this.reset(); this.camMode = 'overview'; this.phase = 'feedback'; this.leadRun();
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
