// Lesson demos and replays: the game plays the move itself, and a hand shows the taps that make it.
import { demoScenario, skillById } from '../skills.js';
import { clamp, smooth } from '../geom.js';
import { MATE, spotKind, wrap } from './shared.js';

export const demo = {
  // In demos he really looks around: head up, turn left, then right (past his shoulder, so he can see behind),
  // then settle on what he found. Shows a child that turning to look is part of the move.
  async lookAround(aim, wide = 1.5) {
    const turnTo = (to, sec) => { const y0 = this.yaw; return this.tween(sec, t => { this.yaw = y0 + wrap(to - y0) * smooth(t); }); };
    const base = this.yaw;
    this.hud.caption('👀 Look left…'); this.say('Look left.'); await turnTo(base + wide, 1.2);
    this.hud.caption('👀 …look right…'); this.say('Look right.'); await turnTo(base - wide, 1.8);
    await turnTo(aim, 1.2);
  },

  // ---------- the teaching hand ----------
  // In demos and replays a hand shows the taps that make the play: LOOK UP, then PASS and the friend, DRIBBLE and
  // the arrow (and small touches or big push), SHOOT, a spot to run to, a turn arrow, or STEAL. So he learns
  // which buttons do what along with the idea. `handAt` is a button id, a point on the field {x, y, z}, or a
  // point on the screen {sx, sy} (fractions of its size).
  async tapAt(target, wait = .8) {
    if (this.skipping) return;
    this.handAt = target; await this.delay(wait);
    if (this.skipping) return;
    this.handTap = (this.handTap || 0) + 1; this.sfx('click'); await this.delay(.4);
  },
  // A drag on the screen turns his head: the hand slides the way a finger would (see lookMove).
  async dragTo(yaw, sec = 1) {
    if (this.skipping) { this.yaw = yaw; return; }
    const y0 = this.yaw, d = wrap(yaw - y0), sx = .5 + clamp(-d / 3.2 * .5, -.3, .3);
    this.handAt = { sx: .5, sy: .62 }; await this.delay(.6);
    this.lookUp = true; this.scanned = true; this.handAt = { sx, sy: .62 };
    await this.tween(sec, t => { this.yaw = y0 + d * smooth(t); });
    await this.delay(.2);
  },
  onScreen(p) {
    const q = this.world.project(p.x, p.y, p.z ?? 0), v = this.viewSize();
    return !!q && q[0] > v.w * .1 && q[0] < v.w * .9 && q[1] > v.h * .12 && q[1] < v.h * .85;
  },
  // Acts out the taps for `opt` (the decision is not made here: outcome() plays it right after).
  async showTaps(opt) {
    const sc = this.sc, h = this.sim.a('hero');
    this.showing = true; this.phase = 'decide'; this.pendingDir = null;
    if (this.skipping || !h) return;
    if (sc.kind === 'tackle') { this.step = 'tackle'; this.lookUp = true; this.handAt = 'stealBtn'; await this.delay(.6); return; } // tapped when the ball rolls loose (tackleGen)
    if (sc.kind === 'receive') { this.step = 'turn'; this.facePasser(); await this.delay(.4); }
    else if (!this.lookUp) { await this.tapAt('lookBtn'); this.lookUp = true; this.scanned = true; this.sfx('up'); await this.delay(.5); }
    const face = p => wrap(Math.atan2(p.y - h.y, p.x - h.x));
    if (MATE[opt]) {
      const m = this.sim.a(MATE[opt]);
      if (!this.onScreen({ ...m, z: .9 })) await this.dragTo(face(m));
      this.seen.add(MATE[opt]);
      await this.tapAt('passBtn'); this.step = 'pass'; await this.delay(.3);
      await this.tapAt({ x: m.x, y: m.y, z: .9 });
    } else if (opt === 'shoot') {
      if (Math.abs(wrap(this.yaw)) > .5) await this.dragTo(0, .8);
      await this.tapAt('shootBtn');
    } else if (/^(drib|push):/.test(opt)) {
      const d = opt.slice(5);
      await this.tapAt('dribBtn'); this.step = 'dribble'; await this.delay(.5); // the camera rises to show the arrows
      const t = this.targets().find(x => x.opt === 'drib:' + d);
      if (t) await this.tapAt(t);
      if (this.pushAllowed) { this.pendingDir = d; await this.delay(.3); await this.tapAt(opt.startsWith('push:') ? 'touchBig' : 'touchSmall'); }
    } else if (opt.startsWith('spot:') || opt.startsWith('turn:')) {
      this.step = opt.startsWith('spot:') ? 'spot' : 'turn';
      const t = this.targets().find(x => x.opt === opt);
      if (t && opt.startsWith('spot:') && !this.onScreen(t)) await this.dragTo(face(t));
      if (t) await this.tapAt(t);
    }
  },
  // Shows the taps, then plays the choice. Used by demos and by every replay of the better play.
  async showPlay(opt) {
    await this.showTaps(opt);
    await this.outcome(opt, true);
    this.showing = false; this.handAt = null;
  },

  // Demo for any lesson: run up, look up, show the idea in words, then play the 3-star choice.
  async demo(skillId) {
    this.mode = 'demo';
    const sc = demoScenario(skillId); this.load(sc);
    const hero = this.name('hero'), tip = skillById(skillId)?.tip || '';
    const intro = this.talk(`Watch ${hero}.`, .2, `Watch ${hero}!`);
    await this.pre(); await intro;
    this.phase = 'decide'; this.step = spotKind(sc) ? 'spot' : null; this.showing = true;
    await this.delay(.4);
    if (sc.kind === 'tackle' || sc.kind === 'receive') this.lookUp = true;
    else { await this.tapAt('lookBtn'); this.lookUp = true; this.scanned = true; this.sfx('up'); this.handAt = null; }
    await this.delay(.9);
    await this.talk(tip, 1.8); // the lesson's one idea: let it sit before anything moves
    // He looks around first, so the choice doesn't come out of nowhere. For a pass he ends up facing the open
    // friend; otherwise he turns back to the space ahead (or to the ball on defense).
    const mateId = MATE[sc.best], h = this.sim.a('hero');
    if (mateId) {
      const m = this.sim.a(mateId);
      await this.lookAround(wrap(Math.atan2(m.y - h.y, m.x - h.x)));
      this.seen.add(mateId); this.hint = true;
      await this.talk(`${this.name(mateId)} is open!`, 1);
    } else if (sc.kind === 'receive') {
      this.step = 'turn'; this.facePasser();
      await this.talk('Peek over your shoulder.', .2, 'Peek! 👀');
      const o = this.sim.a('o1'), side = wrap(Math.atan2(o.y - h.y, o.x - h.x) - this.yaw) > 0 ? 1 : -1;
      const y0 = this.yaw; await this.dragTo(y0 + side * 2.5, 1.1); await this.delay(.6);
      await this.talk(sc.pattern === 'peek-turn' ? 'A defender is behind you! Turn away!' : 'Nobody behind you! Turn and go!', .6);
      this.handAt = null; await this.tween(.6, t => { this.yaw = y0 + side * 2.5 * (1 - smooth(t)); }); // let go: his head comes back to the ball
      await this.talk(sc.pattern === 'peek-turn' ? 'Turn away from him!' : 'Turn and go!', .8); // the curved arrows show both turns
    } else if (sc.kind === 'tackle') {
      this.step = 'tackle'; this.hint = true;
      await this.talk('Watch the ball.', .4, 'Watch the ball… 👀');
    } else if (spotKind(sc)) {
      await this.lookAround(this.yaw, 1.1);
      const q = sc.kind === 'support' ? 'Where is the space? 👀' : 'See who is open? 👀';
      await this.talk(q.replace(/ 👀$/, ''), 1, q);
    } else {
      await this.lookAround(0);
      const saw = sc.best === 'shoot' ? 'Goal ahead! 🥅' : sc.pattern === 'trap-one' ? 'Only one defender! ⚡' : 'Space ahead! 💨';
      await this.talk(saw.replace(/ \S+$/u, ''), .8, saw);
    }
    this.hud.caption('');
    await this.showPlay(sc.best);
    if (sc.then && !this.skipping) { // give-and-go: now the run
      await this.toStep2(); this.phase = 'decide'; this.step = 'spot'; this.lookUp = true;
      await this.talk('Now run past him!', .6); this.hud.caption('');
      await this.showPlay(this.sc.best);
    }
    // Then say why it worked, with a moment to take it in.
    await this.delay(.8); // let the GOAL! (or the steal) land first
    if (!this.skipping) await this.talk(this.cue(), 2.5); // why it worked: the most important line, so it gets the longest pause
    this.hud.caption(''); this.skipping = false; this.showing = false; this.handAt = null; this.mode = 'between'; // the Skip button goes away
  },
};
