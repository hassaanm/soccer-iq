// One decision round: the run-up, the moment he chooses, and how good each choice is. Around it, the lesson
// loop: play the choice, show why a wrong one failed, replay the better way, and let him try again.
import { dist, dribbleEnd } from '../geom.js';
import { grade, pushEnd, LEAD } from '../generate.js';
import { L, W, MATE, spotKind, facesBall, faceTo } from './shared.js';
import { pickFoot } from './outcomes.js';

export const rounds = {
  // Short run-up: he dribbles forward head-down while defenders close in.
  async pre() {
    this.phase = 'pre';
    const sc = this.sc, s = this.sim;
    if (sc.intro === 'won') return this.wonIntro();
    if (sc.kind === 'receive') return this.passIn();
    if (sc.kind === 'lead') return this.runIn();
    s.go('hero', ...sc.heroTo, 3.6);
    if (sc.kind === 'defense') s.go(sc.carrier, ...sc.oppsTo[0], 3);
    (sc.oppsTo || []).forEach((p, i) => p && s.go('o' + (i + 1), ...p, 3));
    await this.delay(1.3);
    s.stopAll();
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
    return new Promise(res => { this._choose = res; });
  },
  // How good a choice is: 'best' (the star answer), 'ok' (just as good), 'safe' (keeps the ball but there was
  // a better choice) or 'bad' (loses it). Dribbles are graded by the real space on the field, so any of the
  // eight directions into open grass works, and only directions a defender blocks lose the ball.
  rating(opt) {
    if (this.sc.best && opt === this.sc.best) return 'best';
    if (this.sc.kind === 'tackle' || this.sc.then) return 'bad'; // a give-and-go step 1 has one right answer: the pass
    if (opt.startsWith('turn:')) return grade(this.sc)['drib:' + this.sc.turns[opt[5]]] === 'good' ? 'ok' : 'bad';
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
    if (opt.startsWith('turn:')) return dribbleEnd({ x: this.sc.heroTo[0], y: this.sc.heroTo[1] }, this.sc.turns[opt[5]], L, W);
    if (opt.startsWith('spot:')) { const sp = this.sc.spots.find(x => x.id === opt.slice(5)); return { x: sp.x, y: sp.y }; }
    if (opt.startsWith('push:')) return pushEnd(h, opt.slice(5));
    return MATE[opt] ? { ...this.sim.a(MATE[opt]) } : dribbleEnd(h, opt.slice(5), L, W);
  },
  // A line with his teammates' names filled in.
  named(text) { return text.replaceAll('{m0}', this.name('m1')).replaceAll('{m1}', this.name('m2')); },
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
  async round(sc, { hint }) {
    this.mode = 'lesson';
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
      // Every decision gets 0–3 stars. 3 = the best choice, 2 = safe but there was a better one, 0 = lost it.
      // The stars and tip are decided now and shown together with the result, the moment the play ends.
      // The praise names what he did, and looking up is praised in every lesson (it is the habit under all of them).
      const praise = sc.kind === 'tackle' ? 'Great steal!' : sc.kind === 'receive' && this.peeked ? 'You peeked!' : sc.kind === 'defense' ? 'Great defending!' : sc.kind === 'support' ? 'Great run!' : scanned ? 'You looked up!' : sc.kind === 'lead' ? 'Great pass!' : 'Great choice!';
      const tip = 'You kept it! Even better: ' + this.cue().replace(/^./, ch => ch.toLowerCase());
      this.rated = more && good && opt === sc.best ? null : rating === 'safe' ? { stars: 2, text: tip, watch: true, say: true }
        : good ? { stars: 3, text: sc.praise ? this.named(sc.praise) : `${praise} ${this.cue()}`, said: praise } // show why it was right, so the idea sticks; say the praise
        : { stars: 0, text: sc.kind === 'defense' || sc.kind === 'tackle' ? 'He got through!' : sc.kind === 'support' ? 'He could not pass to you!' : 'Oops, lost it!' };
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
      await this.feedback(save, opt);
      restart();
      await this.talk('Watch this way!', .2);
      await this.showPlay(sc.best);
      await this.delay(.8); // let the better play land before resetting
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
    const ball = { x: this.sim.ball.x, y: this.sim.ball.y }, bad = this.target(opt), best = this.target(this.sc.best);
    this.lines = [{ a: ball, b: { x: bad.x, y: bad.y }, color: '#e5484d' }, { a: ball, b: { x: best.x, y: best.y }, color: '#30a46c' }];
    this.aimAt = { x: (bad.x + best.x) / 2, y: (bad.y + best.y) / 2 };
    await this.talk(this.cue(), 1.5); // red line, green line, and why: wait for the whole sentence, then a beat
    this.lines = []; this.aimAt = null;
  },
};
