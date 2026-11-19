// Lesson demos and replays: the game plays the move itself, and a hand shows the taps that make it.
import { demoScenario, skillById } from '../skills.js';
import { clamp, smooth } from '../geom.js';
import { L, W, MATE, spotKind, wrap } from './shared.js';
import { pathAt } from '../window.js';

// (v76) How long a line takes in talk() (game.js): the slow reading of it (the voice clips are all shorter), then the pause.
const talkSec = (text, pause = 1.2) => .6 + text.length / 12 + pause;
// (v76) The most real seconds the play after the hand's tap may take (the shot, the rebound, the run in, the result words)
// before the demo ends it itself (demo.js within). The longest takes about 8 s, with the voice at up to three times its time.
const PLAY_MAX = 40;
const TAP = 1.2; // tapAt: the hand's move to the button and its tap
// (v76) A demo's crawl while its idea is said: the slowest and the fastest share of play's speed, and the most of the
// window's play it may use up (demo.js crawlFor).
const CRAWL = [.015, .06], CRAWL_U = .2, RING_DRAIN = [.12, .29]; // (RING_DRAIN: the least and most of the ring that drains while the idea is said)
// (v76) What each lesson's demo looks at once his head is up: the things the lesson is about. A look turns his head
// only to those not on the screen yet; with all of them in sight (a view from above shows everything) he does not look
// around at all. (See the coaching notes in the report: a scan is for finding what is around him before he decides;
// alone in front of goal it is one glance at the goal and the keeper.)
// (v78) And he scans where something that matters is beside or behind him (SCAN, scanWhy): "Look up and scan!" itself;
// the one who comes from behind (a look over his shoulder); friends to pass to on both sides; and off the ball, finding
// space. Not running at the goal (the owner, v76: "the scanning part looked awkward when you're running towards a goal").
// BEHIND: the one who comes is this far (rad) off the way he runs, out of any view that looks that way. SIDE: a friend
// this far (rad) to one side of the view counts as on that side.
const BEHIND = 1.92, SIDE = .26;
const SHOULDER = { turn: .8, hold: .5, back: .6 }; // (shoulderLook: seconds to turn his head, to hold it, to turn back)
//   defenders: their players near the ball (is there only one, or two?); friends: his other friends ahead of or beside
//   him; goal; space: the open grass ahead; ball; open: the player nobody guards; runner: the friend on his run.
const LOOK_AT = {
  'take-him-on': ['defenders'], 'dribble-to-space': ['space'], 'won-it-go': ['space'],
  'see-the-trap': ['defenders'], 'give-and-go': ['defenders'], 'pass-to-open': ['friends'], 'forward-first': ['goal'],
  'follow-shot': ['ball'], 'go-to-goal': ['goal'], 'get-open': ['ball'], 'spread-out': ['ball'], 'get-goal-side': ['ball'], 'one-goes': ['ball', 'open'], 'lead-pass': ['runner'],
};

export const demo = {
  // (v78) Why he scans before this choice (coaching notes in the report), by where things are as the window opens:
  //   'goal'     a clear shot: one glance at the goal and the keeper, no scan (US Youth Soccer, TeamSnap: look up at the
  //              goal, then eyes on the ball)
  //   'shoulder' the one who comes is behind him (BEHIND off his run): a look over the shoulder at him ("check your
  //              shoulder": Jordet's research on scanning before acting; youth coaching cues)
  //   'both'     a pass, with friends to pass to on both sides of the view: a look left and right, then the friend
  //   'around'   off the ball, finding space (get open, spread out): a look left and right (scanning before receiving)
  //   null       everything that matters is ahead, or he runs at the goal: no scan (a glance only at what is off the screen)
  scanWhy(sc = this.sc) {
    const s = this.sim, h = s.a('hero'); if (!h || !sc) return null;
    if (sc.best?.startsWith('shoot')) return 'goal';
    if (sc.kind === 'receive' || sc.kind === 'tackle' || sc.kind === 'defense') return null; // (a pass to him: his peek; defending: the ball is in front of him)
    if (this.threatBehind()) return 'shoulder';
    if (sc.kind === 'support' && sc.run !== 'follow' && sc.run !== 'goal') return 'around';
    const mates = s.team('us').filter(a => a !== h && !a.gk).map(a => wrap(Math.atan2(a.y - h.y, a.x - h.x) - this.yaw));
    if (MATE[sc.best] && mates.some(a => a > SIDE) && mates.some(a => a < -SIDE)) return 'both'; // (a pass is the play: which friend)
    return null;
  },
  // (v78) The one who comes is behind him as the window opens: BEHIND or more off the way he runs (his planned way; the
  // view, when he is not moving). Kept for the window (w.behind).
  threatBehind() {
    const w = this.win; if (!w) return false;
    if (w.behind == null) {
      const s = this.sim, h = s.a('hero'), t = w.threat?.id && s.a(w.threat.id), p = w.plan?.paths?.hero, q = p && pathAt(p, Math.max(0, s.time - w.t0));
      const run = q && Math.hypot(q.vx, q.vy) > .4 ? Math.atan2(q.vy, q.vx) : this.yaw;
      w.behind = !!(h && t && s.ball.carrier === 'hero' && Math.abs(wrap(Math.atan2(t.y - h.y, t.x - h.x) - run)) > BEHIND);
      w.behindId = t?.id || null;
    }
    return w.behind;
  },
  // (v78) A look over his shoulder at the one who comes from behind, and back: `say` says the line meanwhile (a demo).
  async shoulderLook(say = true) {
    const s = this.sim, h = s.a('hero'), t = this.win?.behindId && s.a(this.win.behindId); if (!h || !t || this.skipping) return;
    const y0 = this.yaw, d = wrap(Math.atan2(t.y - h.y, t.x - h.x) - y0); this.checkedBack = true;
    if (say) { this.hud.caption('👀 Behind you?'); this.say('Check your shoulder!'); }
    await this.tween(SHOULDER.turn, u => { this.yaw = y0 + d * smooth(u); }); await this.delay(SHOULDER.hold);
    await this.tween(SHOULDER.back, u => { this.yaw = y0 + d * (1 - smooth(u)); });
  },
  shoulderSec: () => SHOULDER.turn + SHOULDER.hold + SHOULDER.back,
  // (v78) A look left and right over what matters (`pts`: points on the field), then on to `aim` (a direction).
  async scanSides(pts, aim) {
    const h = this.sim.a('hero'); if (!h) return;
    const a = pts.map(p => wrap(Math.atan2(p.y - h.y, p.x - h.x) - this.yaw)), L0 = clamp(Math.max(.7, ...a.filter(v => v > 0)), .7, 1.6), R0 = clamp(Math.max(.7, ...a.filter(v => v < 0).map(v => -v)), .7, 1.6);
    await this.lookAround(aim, L0, R0);
  },
  // "Look up!"'s demo: he really looks around: head up, turn left, then right (past his shoulder, so he can see behind),
  // then settle on what he found. Shows a child that turning to look is part of the move.
  async lookAround(aim, wide = 1.5, right = wide) {
    // (v78) Each turn goes by its own angle from where the view is now, never `wrap(to - y0)`: with the view already far round
    // (left 131°, then right 85° is 216° away) the short way is on round behind him, a full circle in the same direction.
    const turnBy = (d, sec) => { const y0 = this.yaw; return this.tween(sec, t => { this.yaw = y0 + d * smooth(t); }); };
    const base = this.yaw;
    this.hud.caption('👀 Look left…'); this.say('Look left.'); await turnBy(wide, 1);
    this.hud.caption('👀 …look right…'); this.say('Look right.'); await turnBy(-right - wide, 1.5); // (through straight ahead, to the other side)
    await turnBy(base + wrap(aim - base) - this.yaw, 1); // (and on to `aim`, the short way from where he began)
  },
  // (v76) A look with a reason: his head turns to each of `pts` that is not on the screen yet, one glance each, and stays
  // on the last. Nothing to turn for: no turn.
  async lookTo(pts) {
    const h = this.sim.a('hero'); if (!h) return;
    for (const p of pts) {
      if (!p || this.onScreen({ x: p.x, y: p.y, z: p.z ?? .9 })) continue;
      const y0 = this.yaw, d = wrap(Math.atan2(p.y - h.y, p.x - h.x) - y0);
      await this.tween(.45 + .35 * Math.min(1, Math.abs(d) / 1.5), t => { this.yaw = y0 + d * smooth(t); });
    }
  },
  // The points a demo's look goes to (LOOK_AT), where they are now.
  lookPoints(sc) {
    const s = this.sim, h = s.a('hero'), b = s.ball, mate = s.a(MATE[sc.best] || ''), out = [];
    const theirs = s.team('them').filter(a => !a.gk), byBall = [...theirs].sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y));
    for (const k of LOOK_AT[sc.skill] || []) {
      if (k === 'defenders') out.push(...byBall.filter(a => Math.hypot(a.x - b.x, a.y - b.y) < 3));
      else if (k === 'friends') out.push(...s.team('us').filter(a => a !== h && a !== mate && !a.gk && Math.abs(wrap(Math.atan2(a.y - h.y, a.x - h.x))) < 1.9));
      else if (k === 'goal') out.push({ x: L, y: W / 2, z: 1 });
      else if (k === 'space') out.push({ x: h.x + 6, y: h.y, z: 0 });
      else if (k === 'ball') out.push({ x: b.x, y: b.y, z: .2 });
      else if (k === 'open') { const sp = sc.spots?.find(p => 'spot:' + p.id === sc.best); if (sp) out.push({ x: sp.x, y: sp.y, z: 0 }); }
      else if (k === 'runner') { const m = s.a('m1'); if (m) out.push(m); }
    }
    if (mate) out.push(mate); // a pass: his eyes end on the friend he passes to
    return out;
  },
  // (v76) The demo's own clock. The demos and the replays of the better play talk and show taps while play goes on in
  // slow motion, which takes longer than a child's window: the ring used to be empty long before the hand tapped, the one
  // who comes stood at the ball, and play crawled. Now the play's pace is set so that the choice lands with half of the
  // ring left, wherever the talking is: `sec` is how long (real seconds) until the choice from now. Called again as the
  // demo goes on (the voice may take a little longer than planned), so the pace follows (game/window.js windowStep).
  // `left`: the share of the ring left as the choice lands (the ring counts from u0, where the demo's crawl ended).
  showClock(sec, left = .5) {
    const w = this.win; if (!w || this.skipping) return;
    if (this.mode === 'demo' && this.sc?.run === 'follow') left = Math.min(left, .44); // (after a shot: the hand taps once the ball is back out and rolling, not as it comes off the post or the keeper: a tap at that very moment left the rebound unplayed)
    const u0 = w.demo?.u0 ?? 0, L0 = w.demo?.L0 ?? 1, u = u0 + (1 - Math.min(1, left / L0)) * (1 - u0); // (the ring shows L0 at u0: game/window.js timerUi)
    w.demo = { eta: w.real + Math.max(.5, sec), u: Math.max(u, Math.min(.9, (w.u || 0) + .05)), u0, L0 }; w.R = 99; // (R: no jockey's lunge at the end of a real window)
  },
  // (v76) The crawl while a demo's idea is said (`sec`: how long that takes): CRAWL of play's speed, less where the
  // window's play is short, so that no more than CRAWL_U of it is used up before the ring's own count starts (the one who
  // comes is then still well off the ball when the hand taps). The ring drains slowly meanwhile, evenly, at about the pace it
  // keeps after the idea (`after`: seconds from the idea's end to the choice), so its pace never jumps (the owner: a full
  // ring that does not change at all looked wrong).
  crawlFor(sec, after = 5) {
    const w = this.win; if (!w || this.skipping) return;
    const crawl = Math.max(CRAWL[0], Math.min(CRAWL[1], CRAWL_U * w.G / Math.max(1, sec)));
    const aim = this.sc?.run === 'follow' ? .44 : .5; // (v78: where showClock aims the ring after it: a demo after a shot taps a little later)
    w.demo = { crawl, u0: 0, r0: w.real, sec: Math.max(1, sec), drain: clamp((1 - aim) * sec / (sec + after), RING_DRAIN[0], RING_DRAIN[1]) }; w.R = 99; // (the ring drains at about the pace it keeps after: half of it by the choice) // (the ring: RING_DRAIN over `sec`, evenly by real time)
    const P = this.push, rt = this.realTime || 0; if (P) Object.assign(P, { open: rt, peak: Math.min(1, (rt - P.t0) / P.out), end: rt + sec }); // (view.js PUSH: from here the view glides in, arriving as the idea ends)
  },
  crawlEnd() { const w = this.win, d = w?.demo; if (d?.crawl != null) { const u = Math.min(.5, w.u || 0); w.demo = { u0: u, L0: Math.max(.6, 1 - d.drain * (w.real - d.r0) / d.sec), rc: d.drain / d.sec }; } this.push = null; },
  // (v78) Where the ring is aimed after the idea (the share left as the choice lands, 42% to 58%): the share that keeps it
  // draining at the pace it had while the idea was said, over the `sec` seconds to the choice. Its pace used to jump as the
  // idea ended (follow-shot: 3.9% to 7.0% a second).
  ringAim(sec) { const d = this.win?.demo; return d?.rc ? clamp(d.L0 - d.rc * sec, .42, .58) : .5; },
  talkTime: (text, pause) => talkSec(text, pause),
  // How long showTaps takes for `opt` (real seconds), as it plays them.
  tapsSec(opt) {
    const sc = this.sc, h = this.sim.a('hero'); if (!h) return 0;
    let t = sc.kind === 'tackle' ? .6 : sc.kind === 'receive' ? .4 : !this.lookUp ? TAP + .5 : 0;
    if (!this.checkedBack && this.scanWhy(sc) === 'shoulder') t += SHOULDER.turn + SHOULDER.hold + SHOULDER.back; // (v78: showTaps looks over his shoulder first)
    const off = p => (p && !this.onScreen(p) ? 1.8 : 0); // (dragTo)
    if (MATE[opt]) { const m = this.sim.a(MATE[opt]); t += off(m && { ...m, z: .9 }) + TAP + .3 + TAP; }
    else if (opt === 'shoot' || opt.startsWith('shoot:')) { const [, sp, ft] = opt.split(':'), parts = opt === 'shoot' ? {} : this.shotParts(); t += .5 + TAP + (parts.space && sp !== '*' ? .6 + TAP : 0) + (parts.foot && ft !== '*' ? .5 + TAP : 0); }
    else if (/^(drib|push):/.test(opt)) t += TAP + .5 + TAP + (this.pushAllowed ? .3 + TAP : 0);
    else if (opt.startsWith('spot:') || opt.startsWith('turn:')) { const sp = sc.spots?.find(p => 'spot:' + p.id === opt); t += (sp ? off(sp) : 0) + TAP; }
    return t;
  },
  // Before a shot he is clear for (v72): no look around for friends. One glance up at the goal (and the keeper), to pick
  // a spot: his head and the view turn to the goal, from behind him, as his own view does when he taps LOOK UP there.
  async glanceAtGoal(sec = .6) {
    const h = this.sim.a('hero'); if (!h) return;
    const y0 = this.yaw, d = wrap(Math.atan2(W / 2 - h.y, L - h.x) - y0);
    if (Math.abs(d) > .05) await this.tween(sec, t => { this.yaw = y0 + d * smooth(t); });
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
    if (!this.win && !this.skipping) this.openWindow(); // (v64: play goes on, slowly, while the hand shows the taps)
    if (this.skipping || !h) return;
    this.showClock(this.tapsSec(opt), this.mode === 'demo' && this.demoLeft != null ? this.demoLeft : .5); // (v76: the choice lands with about half the ring left; v78: a demo's, where ringAim put it)
    if (sc.kind === 'tackle') { this.step = 'tackle'; this.lookUp = true; this.handAt = 'stealBtn'; await this.delay(.6); return; } // tapped when the ball rolls loose (tackleGen)
    if (sc.kind === 'receive') { this.step = 'turn'; this.facePasser(); await this.delay(.4); }
    else if (!this.lookUp) { await this.tapAt('lookBtn'); this.lookUp = true; this.scanned = true; this.sfx('up'); await this.delay(.5); }
    if (!this.checkedBack && this.scanWhy(sc) === 'shoulder') await this.shoulderLook(false); // (v78: the one who comes is behind him: the better play starts with a look over his shoulder)
    const face = p => wrap(Math.atan2(p.y - h.y, p.x - h.x));
    if (MATE[opt]) {
      const m = this.sim.a(MATE[opt]);
      if (!this.onScreen({ ...m, z: .9 })) await this.dragTo(face(m));
      this.seen.add(MATE[opt]);
      await this.tapAt('passBtn'); this.step = 'pass'; await this.delay(.3);
      await this.tapAt({ x: m.x, y: m.y, z: .9 });
    } else if (opt === 'shoot' || opt.startsWith('shoot:')) {
      await this.glanceAtGoal(.5); // (v72: his eyes on the goal, never a look left and right first)
      await this.tapAt('shootBtn');
      if (opt !== 'shoot') { // then the space in the goal, and the foot (v62)
        const [, sp, ft] = opt.split(':'), parts = this.shotParts();
        if (parts.space && sp !== '*') { this.step = 'aim'; await this.delay(.6); const t = this.targets().find(x => x.opt === 'aim:' + sp); if (t) await this.tapAt(t); this.shotSpace = sp; }
        if (parts.foot && ft !== '*') { this.step = 'foot'; await this.delay(.5); await this.tapAt(ft === 'in' ? 'footIn' : 'footLaces'); }
      }
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
  // (v76) A guard for a wait that depends on the play (a ball that has to come to rest, a player who has to get there): it
  // has `sec` real seconds. If the play has not ended by then, it is stopped where it stands, so the demo goes on to its
  // end in an orderly way and never stays on a frozen picture. Returns true if the play ended itself.
  async within(work, sec) {
    if (this.skipping) return work.then(() => true);
    this.realJobs = true; const cap = this.job(sec); this.realJobs = false;
    const ended = await Promise.race([work.then(() => true), cap.done.then(() => false)]);
    this.cancel(cap);
    if (!ended && !this.skipping) { this.sim.co = null; this._playRes?.(); this.closeWindow?.(); this.hud.caption(''); this.stalled = (this.stalled || 0) + 1; }
    return ended;
  },
  // Shows the taps, then plays the choice. Used by demos and by every replay of the better play.
  async showPlay(opt) {
    await this.showTaps(opt);
    await this.within(this.outcome(opt, true), PLAY_MAX);
    this.showing = false; this.handAt = null;
  },

  // Demo for any lesson: run up, look up, show the idea in words, then play the 3-star choice.
  async demo(skillId) {
    this.mode = 'demo';
    const sc = demoScenario(skillId); await this.prePlan(sc); this.load(sc); // (v78: its plan made in the frames before: game/window.js prePlan)
    const hero = this.name('hero'), tip = skillById(skillId)?.tip || '', capTip = skillById(skillId)?.capTip; // capTip: a shorter caption for a long tip, so it covers no gold place (v64)
    const shot = !!sc.best?.startsWith('shoot'), mateId = MATE[sc.best];
    // (v76) "Watch …" over the run-up; then, from the moment the choice's window opens, play crawls on (CRAWL: a few
    // hundredths of its speed, the one who comes still coming, everyone's legs still going) while the hand taps LOOK UP
    // and the lesson's one idea is said over the very picture it is about. The ring stays full meanwhile (timerUi): its
    // count starts as the idea ends, and the look and the taps that are left land the choice with half of it left
    // (showClock). All that talk used to be said over the window as it ran: it took three times a child's window, so the
    // ring was empty long before the hand tapped and the one who comes stood waiting at the ball. (Play never stands
    // still: the owner wants a world that moves while a choice is made, and a still picture reads as a freeze.)
    const t0 = this.realTime || 0;
    this.push = { t0: this.realTime || 0, out: sc.run === 'follow' ? .45 : 1.3, end: null }; // (view.js: the view draws back over the run-up (a shot's is short) at an even pace, and glides in as the idea is said: never a stop between)
    this.realJobs = true; const intro = this.talk(`Watch ${hero}.`, .2, `Watch ${hero}!`); this.realJobs = false; // (its wait runs on real time: it goes on into the window)
    await this.pre();
    // (v72) The window opens the moment the run-up ends, as in a round.
    this.phase = 'decide'; this.step = spotKind(sc) ? 'spot' : null; this.showing = true;
    this.openWindow(); // (v64: the demo goes on over play in slow motion, as his own choices do)
    const tapLook = sc.kind !== 'tackle' && sc.kind !== 'receive';
    const idea = Math.max(0, talkSec(`Watch ${hero}.`, .2) - ((this.realTime || 0) - t0)) + (tapLook ? .2 + TAP + (shot ? .6 : 0) : 0) + .3 + talkSec(tip, .8);
    // (v76) What he says once he has looked, and how long it all takes from the idea's end to the choice (after).
    const peek = sc.pattern === 'peek-turn', recv = ['Peek over your shoulder.', peek ? 'A defender is behind you! Turn away!' : 'Nobody behind you! Turn and go!'];
    const q = sc.run === 'follow' ? 'Where is the ball? 👀' : sc.run === 'goal' ? 'Where is the goal? 👀' : sc.kind === 'support' ? 'Where is the space? 👀' : sc.kind === 'defense' && sc.skill === 'get-goal-side' ? 'Where is the ball? 👀' : 'See who is open? 👀';
    const K = this.sim.keeper('them'), goalLine = K ? 'Look at the goal. Where is the keeper?' : 'Look at the goal. Nobody in the way!', saw = sc.pattern === 'trap-one' ? 'Only one defender! ⚡' : 'Space ahead! 💨';
    const scan = sc.skill === 'look-up' && !mateId && !spotKind(sc) && !shot && sc.kind !== 'receive';
    if (sc.kind === 'tackle' || sc.kind === 'receive') this.lookUp = true;
    const qPause = sc.run === 'follow' ? 2.8 : 1; // (v78: after a shot the time from the idea to the tap was short, and the ring's pace jumped as the idea ended: a longer look at the loose ball)
    const why = this.scanWhy(sc), sides = why === 'both' || why === 'around', back = why === 'shoulder' && !scan; // (v78: a scan with a reason, scanWhy)
    if (scan && why === 'shoulder') this.checkedBack = true; // ("Look up and scan!": its own look round goes as far as the one behind him)
    const lookSec = sides ? 3.5 : this.lookPoints(sc).filter(p => !this.onScreen({ x: p.x, y: p.y, z: p.z ?? .9 })).length * .8 + (back ? this.shoulderSec() : 0); // (lookTo: a glance for each thing not in sight yet; scanSides: left, right, on; shoulderLook)
    const after = () => (mateId ? lookSec + talkSec('Pass is open!', 1) : sc.kind === 'receive' ? talkSec(recv[0], .2) + 2.4 + talkSec(recv[1], .6) + .6
      : sc.kind === 'lead' ? lookSec + talkSec('Pass is running!', .8) : spotKind(sc) ? lookSec + talkSec(q, qPause) : shot ? talkSec(goalLine, .6) : (scan ? 3.5 : lookSec) + talkSec(saw, .8)) + (this.checkedBack || !back ? this.tapsSec(sc.best) : this.tapsSec(sc.best) - this.shoulderSec()); // (how long from the idea's end to the choice; his look over the shoulder is counted once)
    this.crawlFor(idea, after());
    await intro;
    if (tapLook) { await this.delay(.2); await this.tapAt('lookBtn'); this.lookUp = true; this.scanned = true; this.sfx('up'); this.handAt = null; if (shot) await this.glanceAtGoal(); }
    await this.delay(.3);
    if (this.push) this.push.end = (this.realTime || 0) + talkSec(tip, .8); // (the view arrives as the idea ends)
    await this.talk(tip, .8, capTip); // the lesson's one idea: let it sit (play crawls)
    this.crawlEnd();
    this.demoLeft = this.ringAim(after()); this.showClock(after(), Math.min(.6, this.demoLeft + .02)); // (aimed a little higher until the taps start: a line that runs long still leaves the choice in the middle; v78: the ring drains on at the pace it had while the idea was said, ringAim)
    const h = this.sim.a('hero');
    // (v76) Then he looks at what the lesson is about (LOOK_AT), and only where it is not in sight already: no look
    // left and right for nothing. "Look up!" itself looks around (that is the lesson); a shot, one glance at the goal.
    const toward = p => Math.atan2(p.y - h.y, p.x - h.x);
    if (mateId) {
      if (back) await this.shoulderLook();
      if (why === 'both') await this.scanSides(this.sim.team('us').filter(a => a !== h && !a.gk), toward(this.sim.a(mateId))); else await this.lookTo(this.lookPoints(sc));
      this.seen.add(mateId); this.hint = true;
      await this.talk(`${this.name(mateId)} is open!`, 1);
    } else if (sc.kind === 'receive') {
      this.step = 'turn'; this.facePasser();
      await this.talk(recv[0], .2, 'Peek! 👀');
      const o = this.sim.a('o1'), side = wrap(Math.atan2(o.y - h.y, o.x - h.x) - this.yaw) > 0 ? 1 : -1;
      const y0 = this.yaw; await this.dragTo(y0 + side * 2.5, 1.1); await this.delay(.6);
      await this.talk(recv[1], .6);
      this.handAt = null; await this.tween(.6, t => { this.yaw = y0 + side * 2.5 * (1 - smooth(t)); }); // let go: his head comes back to the ball (v76: the curved arrows then show both turns, with no more words: it was said)
    } else if (sc.kind === 'tackle') {
      this.step = 'tackle'; this.hint = true;
      await this.talk('Watch the ball.', .4, 'Watch the ball… 👀');
    } else if (sc.kind === 'lead') { // he sees his friend running, and where he is going
      if (back) await this.shoulderLook();
      await this.lookTo(this.lookPoints(sc));
      await this.talk(`${this.name('m1')} is running!`, .8);
    } else if (spotKind(sc)) {
      if (why === 'around') await this.scanSides([...(sc.spots || []), this.sim.ball], this.yaw); else await this.lookTo(this.lookPoints(sc)); // (off the ball: he looks round for the space, and back to where he was looking)
      await this.talk(q.replace(/ 👀$/, ''), qPause, q);
    } else if (shot) { // clear on goal (v72): one look at the goal and the keeper, then the shot (the ball is his to look at)
      await this.glanceAtGoal(.4); await this.talk(goalLine, .6, goalLine + (K ? ' 🧤' : ' 🥅'));
    } else {
      if (scan) { const t = this.win?.behindId && this.threatBehind() && this.sim.a(this.win.behindId), a = t ? wrap(toward(t) - this.yaw) : 0; await this.lookAround(0, a > 0 ? Math.min(2.5, a) : 1.5, a < 0 ? Math.min(2.5, -a) : 1.5); } // ("Look up and scan!": left and right, and as far round as the one who comes from behind)
      else { if (back) await this.shoulderLook(); await this.lookTo(this.lookPoints(sc)); }
      await this.talk(saw.replace(/ \S+$/u, ''), .8, saw);
    }
    this.hud.caption('');
    await this.showPlay(sc.best);
    if (sc.then && !this.skipping) { // give-and-go: now the run
      await this.toStep2(); this.phase = 'decide'; this.step = 'spot'; this.lookUp = true;
      this.openWindow(); // (v72: as the step's run-in ends, as in a round; opened after the line, everyone jumped back to where it starts)
      this.showClock(talkSec('Now run past him!', .6) + this.tapsSec(this.sc.best));
      await this.talk('Now run past him!', .6); this.hud.caption('');
      await this.showPlay(this.sc.best);
    }
    // Then say why it worked, with a moment to take it in.
    await this.delay(.8); // let the GOAL! (or the steal) land first
    // Why it worked: the most important line, so it gets the longest pause. It is said over a view from above of
    // where the play happened (him and the ball), not the celebration camera, which by then shows his legs under the
    // words or an empty goal.
    if (!this.skipping) { const b = this.sim.ball; this.aimAt = { x: clamp(b.x, 2, L - 3), y: b.y }; this.camMode = 'overview'; await this.talk(this.cue(), 2.5); this.aimAt = null; }
    this.hud.caption(''); this.skipping = false; this.showing = false; this.handAt = null; this.demoLeft = null; this.mode = 'between'; // the Skip button goes away
  },
};
