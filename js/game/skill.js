// The skill moment (real game only: `skillTaps`). When his player has the ball and a skill move would make sense
// (sim.js: a defender ahead on his run, or a turn past one from a standstill), a big SKILL button shows the move for a
// short window and play slows down (or, for a turn, waits a moment before it starts). A tap in time: he does the move,
// the camera comes in close (game/view.js) and time stays slow through it, with its name in big letters. No tap: play
// goes on with the plain touch. The tests and audits leave `skillTaps` off, and every chance is taken by itself.
// Slow motion only changes how much game time each frame steps; while play waits for a turn the sim is not stepped
// at all, so the play goes on exactly as it would have.
import { touchAt, TURN_SKILLS } from '../sim.js';
import { JOCK } from '../window.js';
import { MOVE_NAME } from '../flair.js';

const SLOW = .3;   // game speed while a run-at move is offered (about 1.3 real seconds to tap)
const MOVE = .5, MOVE_TURN = .4; // game speed through the move he tapped (a dribble move, a turn: the turns are quicker)
const WAIT = 1.2;  // real seconds a turn is offered while play waits (in the demo, long enough for the line that explains it)
const WAIT_DEMO = 3.4, DEMO_TAP = 2.8; // the demo: how long it waits, and when the hand taps (it rests on the button first)
export const EXPLAIN = 'See the gold button? Tap it to do a trick!'; // said in the take-him-on demo when the button first shows
const GAP = 5;     // in matches: real seconds from one offer to the next
const OFFER_END = -.3; // as in sim.js: where a run-at offer closes (dribble touches before its move)

const STEP = 1 / 480; // seconds of game time in one step (see skillFrame)

export const skill = {
  // One frame of game time in the real game. It is stepped in small steps of the same size (STEP), however long the
  // frame and however slow the play, so where everyone goes depends only on how much game time has passed: slow
  // motion, and a tap or none, change only how fast the picture shows it, never the play. (A step is short enough
  // that nothing on the pitch looks any less smooth: a sprinter moves 1 cm in one.)
  // When a wait in the game's flow ends in a step (woke), the frame stops there: the code that waited runs before the
  // next step, as it would with any other frames, and the rest of the frame's time is stepped in the next frame.
  skillFrame(dt) {
    this.acc = Math.min(.25, (this.acc || 0) + this.skillPace(dt)); this.woke = false;
    while (this.acc >= STEP) { if (this.skillHold()) { this.acc = 0; break; } this.acc -= STEP; this.gameTime(STEP); if (this.woke) break; }
    this.skillWatch(dt);
  },
  // Before each step: a skill turn as the play starts, from the standstill of his choice (the others have only just
  // set off), is offered first: play waits for him before the turn begins. (Later in a play a turn starts with no
  // warning, so it is never offered.) True when play waits.
  skillHold() {
    const s = this.sim, h = s.a('hero');
    if (this.sk?.kind === 'turn' && (this.sk.phase === 'offer' || (this.sk.phase === 'move' && this.clock < this.sk.go))) return true; // (after the tap, a moment more while the camera comes in)
    if (this.phase !== 'outcome' || this.sk || !h || h.sp >= .6 || s.time - (this.skT0 ?? s.time) >= .12 || !this.offerAllowed() || !s.list.every(a => a.sp < 1.5)) return false; // (v64: play now goes on into his choice, so this standstill is rare: skill moves are offered on his runs)
    const k = s.turnAhead('hero'); if (k) this.skillOffer('turn', k);
    return !!k;
  },
  // Before the frame's game time: the speed of play this frame. Returns the game time to step (dt scaled).
  skillPace(dt) {
    const s = this.sim, h = s.a('hero');
    if (this.phase !== 'outcome' && this.sk && this.sk.phase !== 'out') this.skillEnd();
    if (this.phase !== 'outcome') { this.skDone = false; this.skT0 = null; } // one offer per play (a new outcome starts a new play)
    else this.skT0 ??= s.time;
    s.offerOK = this.offerAllowed() || (this.sk?.phase === 'offer' && this.sk.kind === 'run' && !!h?.offer);
    const sk = this.sk, waits = sk?.kind === 'turn' && (sk.phase === 'offer' || (sk.phase === 'move' && this.clock < sk.go));
    const wj = this.win?.jock && this.phase === 'decide' ? Math.max(0, 1 - (this.win.R - this.win.real) / JOCK.real) : 0; // (round 6: the last half second of a window whose defender jockeys: he goes in, and the world speeds up with him)
    const want = wj > 0 ? this.win.f + (JOCK.F1 - this.win.f) * wj * wj : this.win && this.phase === 'decide' ? this.win.f * ((this.mode === 'demo' || this.showing) && this.win.u > .85 ? .3 : 1) : !sk || sk.phase === 'out' ? 1 : sk.phase === 'move' ? (sk.kind === 'turn' ? MOVE_TURN : MOVE) : sk.kind === 'turn' ? 0 : SLOW; // (v64: the decision window's slow motion)
    if (this.win) this.win.real += dt; this.realTime = (this.realTime || 0) + dt;
    if (waits) { this.slow = 0; this.slowV = 0; }
    else { // eased (a critically damped spring, by real time), so the speed never steps
      const st = .12, w = 2 / st, e = w * dt, k = 1 / (1 + e + .48 * e * e + .235 * e * e * e), c = this.slow - want, q = (this.slowV + w * c) * dt;
      this.slowV = (this.slowV - w * q) * k; this.slow = Math.min(1, Math.max(0, want + (c + q) * k));
      if (want === 1 && this.slow > .999) { this.slow = 1; this.slowV = 0; }
    }
    // The picture's clock: slow too, but while play waits the standing players breathe and shift at nearly their own pace
    // (eased, so their life never jumps from one pace to the other).
    this.prate = (this.prate ?? 1) + ((waits ? .85 : Math.max(this.slow, .35)) - (this.prate ?? 1)) * (1 - Math.exp(-dt * 6));
    this.ui.clock += dt * this.prate;
    return dt * this.slow;
  },
  // Whether a new offer may come now: his ball in a play (not while he chooses, not in a replay of the better play),
  // one per play, and in matches some seconds apart.
  offerAllowed() {
    const m = this.mode, b = this.sim.ball;
    return this.phase === 'outcome' && !this.skDone && !this.sk && b.carrier === 'hero' && b.state === 'carried' && !b.move
      && (m === 'demo' || ((m === 'lesson' || m === 'match' || m === 'free') && !this.showing)) && (m === 'lesson' || m === 'demo' || this.clock - (this.skLast ?? -99) > GAP)
      && this.skillsOpen(); // (not in the first lessons: from the one that is about taking a defender on)
  },
  skillOffer(kind, k, n = 0) {
    const h = this.sim.a('hero');
    this.sk = { kind, k, n, phase: 'offer', t0: this.clock, c0: kind === 'run' ? touchAt(h) - n : 0 };
    this.skDone = true; this.skLast = this.clock;
    this.hud.skill(MOVE_NAME[k], 1); this.sfx('offer');
    if (this.mode === 'demo') { this.handAt = 'skillBtn'; this.hud.caption(EXPLAIN.replace('?', '? ✨').replace(/!$/, '! 👆')); this.say(EXPLAIN); }
  },
  // The SKILL button. A tap after the window has closed, or a second tap, does nothing.
  skillTap() {
    const sk = this.sk; if (!sk || sk.phase !== 'offer') return;
    const s = this.sim, h = s.a('hero');
    if (sk.kind === 'run') { if (!s.take('hero')) return; } else h.turnTap = sk.k;
    this.skillCamStart(); // (it sets this.skIn: how long the camera takes to come in)
    Object.assign(sk, { phase: 'move', tm: this.clock, started: sk.kind === 'run', go: this.clock + this.skIn * .7 }); // a turn waits most of the way in
    this.hud.skill(null); this.hud.skillName(MOVE_NAME[sk.k] + '!'); this.sfx('skill'); this.fx('skill');
    this.say(MOVE_NAME[sk.k] + '!');
  },
  skillEnd() {
    const h = this.sim.a('hero'), sk = this.sk; if (!sk) return;
    if (sk.phase === 'offer') this.hud.skill(null);
    if (h) { h.offer = null; h.turnTap = null; }
    if (this.mode === 'demo' && this.handAt === 'skillBtn') this.handAt = null;
    sk.phase = 'out';
  },
  // After the frame's step: new offers, the window running out, the move playing, and skill moves by everyone else.
  skillWatch(dt) {
    const s = this.sim, h = s.a('hero'), b = s.ball;
    if (!this.sk && h?.offer && this.phase === 'outcome') this.skillOffer('run', h.offer.k, h.offer.n);
    const sk = this.sk;
    if (sk?.phase === 'offer') {
      const demo = this.mode === 'demo', left = sk.kind === 'turn' ? 1 - (this.clock - sk.t0) / (demo ? WAIT_DEMO : WAIT) : h?.offer ? 1 - (touchAt(h) - sk.n - sk.c0) / (OFFER_END - sk.c0) : 0;
      if (left <= 0) this.skillEnd();
      else { this.hud.skill(MOVE_NAME[sk.k], Math.round(left * 50) / 50); if (demo && (this.clock - sk.t0 > DEMO_TAP || left < .15)) { this.hud.caption(''); this.handTap = (this.handTap || 0) + 1; this.sfx('click'); this.skillTap(); } }
    } else if (sk?.phase === 'move') {
      // A turn: it starts on the next step (sim.js); the move is over when the turn is (or if it never came). A run-at
      // move is over a little after the touch that takes the ball away.
      if (sk.kind === 'turn') { const m = b.move; if (m && m.k === sk.k && b.carrier === 'hero') sk.started = true; if (sk.started ? !m || (s.time - m.t0) / m.dur > .92 : this.clock - sk.go > .4) sk.phase = 'out'; }
      else if (!h?.skill || touchAt(h) - h.skill.n > 1.15) sk.phase = 'out';
      if (this.mode === 'demo' && this.handAt === 'skillBtn' && this.clock - sk.tm > .4) this.handAt = null;
    } else if (sk?.phase === 'out' && this.slow >= 1 && this.skCam <= 0) this.sk = null;
    // The close camera: only once he taps, in over half a second or more (longer from farther away, see skillCamStart),
    // back out over about 0.7 s. (Smoothed both ways in game/view.js, so it starts and stops softly.)
    this.skCam = Math.min(1, Math.max(0, (this.skCam || 0) + (sk?.phase === 'move' ? dt / (this.skIn || .5) : -dt / .7)));
    // Skill moves by the others: a small tag in the corner with the move and who did it.
    const c = b.state === 'carried' ? s.a(b.carrier) : null, ref = c && (b.move && TURN_SKILLS.has(b.move.k) ? b.move : c.skill);
    if (ref && ref !== this.tagRef) { this.tagRef = ref; if (c.id !== 'hero') this.hud.skillTag(MOVE_NAME[ref.k], this.name(c.id)); }
  },
};
