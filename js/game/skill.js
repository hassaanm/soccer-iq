// The skill moment (real game only: `skillTaps`). (v78) Two moves are offered early, as two big buttons where PASS and
// DRIBBLE sit (they are not there while a play runs), when his player will take on a defender:
//   run   he runs at a defender who is still coming (sim.js runOffer): the offer comes while there is time, and the
//         move he picks starts by itself when the defender is at that move's own distance (sim.js MOVE_AT);
//   turn  a play of his starts with a turn past a defender close by (the take-on): his turn is held (he carries the
//         ball on at a walk, sim.js a.holdTurn) while he picks, and the move is the turn itself, as the hold ends.
// Each button shows its move as a picture: the defender, the fake toward him, and the way the ball goes after it. One
// goes to the open side (the side away from where the defender stands, the way his run goes): the better one. The other
// goes toward the defender. Play slows down while he picks (about three real seconds; a ring drains on both buttons).
// A tap arms the move: its button stays lit, the other fades, its name is said, and the camera comes in. The move then
// plays slowly, with its name in big letters and its button still up. The better move goes by him as the play goes
// anyway; the other he reads: he steps across into his way and stops him (the play ends "Kept the ball!", and a
// lesson's card shows 2 stars and why). No tap: play goes on with the plain touch or turn, as with no offer.
// Slow motion only changes how much game time each frame steps, so the play goes on exactly as it would have.
import { touchAt, turnSide, TURN_SKILLS, RUN_MOVES, EXIT_FREE } from '../sim.js';
import { JOCK } from '../window.js';
import { MOVE_NAME } from '../flair.js';

const PACE = [.12, .3];       // game speed while the moves are offered: the slower end when the defender comes on fast (.12: the slowest a choice's window goes, window.js PACE)
const OFFER_REAL = 3;         // real seconds an offer aims to last (the pace is set for it, within PACE)
const OFFER_DEMO = 3.8, DEMO_TAP = 3, HOLD_DEMO = .46; // the demo: longer, for the line that explains it (its turn held longer too); when the hand taps
const ARMED = .25;            // game speed once a move is armed, until it starts (it is chosen: the wait need not be long)
const MOVE = .28, MOVE_TURN = .25; // game speed through the move he picked (a dribble move: one touch, about a second to watch)
const HOLD_G = .36;           // game seconds his turn is held while a turn is offered (he carries the ball on at a walk; round 6)
const GAP = 20;               // in matches: real seconds from one offer to the next (v78: the owner, "it happens way too often")
export const TURN_MOVES = ['double', 'chop', 'croqueta', 'roll', 'cruyff']; // the skill turns a take-on offers (sim.js skillPlan)
export const EXPLAIN = 'Pick a trick! Go where the space is!'; // said the first time the moment comes (and in the take-him-on demo)
export const SKILL_TIP = 'Fake at him, then go to the space!'; // a lesson's card after the move to the wrong side (under the words SAW)
export const SAW = 'He saw it!'; // the result's words after the move to the wrong side (outcomes.js emit 'read'), said in a match
export const SKILL_IDS = ['skillA', 'skillB']; // the two buttons, left and right (index.html)

const ANY_NEAR = 1.6;         // (v76 SL) a plain turn (sim.js turnAhead 'any') is offered only with the defender this far off or more (m)
const OFFER_MIN = 1.6, GONE = 2.7; // (v76 SL) the least real seconds an offer shows (runLeft); m: a defender this near along his way withdraws a run-at offer (sim.js offerGone: LATE + a touch, 2.6 m, and a little to spare)
const STEP = 1 / 480; // seconds of game time in one step (see skillFrame)
const clamp01 = v => Math.max(0, Math.min(1, v));
const pick = (x, y) => (Math.floor(Math.abs(x * 7.31 + y * 13.7) * 10) & 1); // which of the two moves is the better one: from where he is (the same in a replay)

export const skill = {
  // One frame of game time in the real game. It is stepped in small steps of the same size (STEP), however long the
  // frame and however slow the play, so where everyone goes depends only on how much game time has passed: slow
  // motion, and a tap or none, change only how fast the picture shows it, never the play. (A step is short enough
  // that nothing on the pitch looks any less smooth: a sprinter moves 1 cm in one.)
  // When a wait in the game's flow ends in a step (woke), the frame stops there: the code that waited runs before the
  // next step, as it would with any other frames, and the rest of the frame's time is stepped in the next frame.
  skillFrame(dt) {
    // (round 13) The sim asks the job the team's rule gives each of the other team (sim.js exitGap: where they will be as
    // a skill move ends): the one on the ball ('press'), one chasing it ('ball'), the one covering ('cover').
    this.sim.jobOf ||= id => { const j = this.roles?.jobs?.[id]; return this.duel === id ? 'duel' : this.chaser?.id === id || j === 'chase' ? 'ball' : j === 'press' || (j === 'cover' && !this.duel) ? j : null; }; // (v76 SL: one covering while another holds him up, outcomes.js stepUp, covers him, not the ball: as he goes)
    this.sim.movePair ||= () => this.movePair(RUN_MOVES); // (v78: which two moves a run-at offer has)
    this.acc = Math.min(.25, (this.acc || 0) + this.skillPace(dt)); this.woke = false;
    while (this.acc >= STEP) { this.skillHold(); this.acc -= STEP; this.gameTime(STEP); if (this.sk?.blockOn) this.skillBlock(); if (this.woke) break; }
    this.skillWatch(dt);
  },
  // Before each step: a take-on as the play starts, from the standstill of his choice (the others have only just set
  // off): his turn past the defender is offered (as the next step would start it, sim.js turnAhead) and held for HOLD_G
  // s of play (sim.js a.holdTurn: he carries the ball on at a walk), which the slow motion stretches over the offer. The
  // hold is the same length whether he taps or not, so the play goes on the same either way.
  skillHold() {
    const s = this.sim, h = s.a('hero');
    if (h?.holdTurn && (s.time - this.skHoldT >= this.holdG() || this.phase !== 'outcome' || s.ball.carrier !== 'hero')) h.holdTurn = false; // (his turn starts on the next step)
    if (this.phase !== 'outcome' || this.sk || !h || h.holdTurn || h.sp >= 3.5 || !this.offerAllowed()) return;
    // (round 13) No skill turn on offer where it would end by a second man of theirs (sim.js exitRoom: he turns and is
    // away about a metre in some 0.4 to 0.7 s).
    const k = s.turnAhead('hero', true); if (!k || s.exitRoom(h, 1, .7, .35) < EXIT_FREE) return; // (v76 SL: any turn past him, not only one that is a chance for a skill turn: sim.js startTurn)
    const b = s.ball, ch = Math.cos(b.h), sh = Math.sin(b.h); let foe = null, fd = 3.5;
    for (const o of s.team('them')) { const d = Math.hypot(o.x - h.x, o.y - h.y); if (d < fd && (o.x - h.x) * ch + (o.y - h.y) * sh > -.3) { fd = d; foe = o; } }
    if (!foe || (k === 'any' && (!s.flair?.by?.hero || s.flair.ctx === 'finish' || fd < ANY_NEAR))) return; // (v76 SL: a plain turn only in a dribble of his (not his run at goal, which may end in a shot during the hold), and not with him already on him)
    const side = turnSide(s, h, b.h, Math.atan2(h.ty - h.y, h.tx - h.x)), pair = this.movePair(TURN_MOVES), first = pick(h.x, h.y);
    const alts = pair.map((m, i) => ({ k: m, good: i === first, exit: i === first ? side : -side }));
    this.skillOffer({ kind: 'turn', alts, tgt: foe.id, yaw: b.h });
    h.holdTurn = true; h.turnAny = k === 'any'; this.skHoldT = s.time;
  },
  holdG() { return this.mode === 'demo' ? HOLD_DEMO : HOLD_G; },
  // (v76 SL, review) Game seconds a run-at offer stays open: to its last touch, or sooner to when the defender is within a
  // touch and LATE m of him (sim.js offerGone withdraws it then; an offer was seen to flash for 0.1 s). An offer is shown
  // only when that lets it show OFFER_MIN real seconds at the slowest pace (skillWatch).
  runLeft(o) {
    const s = this.sim, h = s.a('hero'), t = s.a(o.tgt), b = s.ball, last = Math.max(.05, (o.last - touchAt(h)) * 1.4 / Math.max(1.5, h.sp)); if (!t || !h) return last;
    const ch = Math.cos(b.h), sh = Math.sin(b.h), f = (t.x - h.x) * ch + (t.y - h.y) * sh, v = t.duelV || t.lv || [0, 0], close = Math.max(.5, Math.max(1.5, h.sp) - (v[0] * ch + v[1] * sh));
    return Math.max(.05, Math.min(last, (f - GONE) / close));
  },
  // Before the frame's game time: the speed of play this frame. Returns the game time to step (dt scaled).
  skillPace(dt) {
    const s = this.sim, h = s.a('hero');
    if (this.phase !== 'outcome' && this.sk && this.sk.phase !== 'out') this.skillEnd();
    if (this.phase !== 'outcome') { this.skDone = false; this.skT0 = null; } // one offer per play (a new outcome starts a new play)
    else this.skT0 ??= s.time;
    s.offerOK = this.offerAllowed() || (this.sk?.phase === 'offer' && !!h?.offer);
    const sk = this.sk;
    const wj = this.win?.jock && this.phase === 'decide' ? Math.max(0, 1 - (this.win.R - .15 - this.win.real) / JOCK.real) : 0; // (a moment early: the speed eases up, and the window is over as the ring empties, not after) // (round 6: the last half second of a window whose defender jockeys: he goes in, and the world speeds up with him)
    const want = wj > 0 ? this.win.f + (JOCK.F1 - this.win.f) * wj * wj : this.win && this.phase === 'decide' ? this.win.f * ((this.mode === 'demo' || this.showing) && this.win.u > .85 ? .3 : 1)
      : !sk || sk.phase === 'out' ? 1 : sk.phase === 'move' ? (sk.kind === 'turn' ? MOVE_TURN : MOVE) : sk.phase === 'armed' ? Math.max(sk.pace, ARMED) : sk.pace; // (v64: the decision window's slow motion)
    if (this.win) this.win.real += dt; this.realTime = (this.realTime || 0) + dt;
    // eased (a critically damped spring, by real time), so the speed never steps
    const st = .12, w = 2 / st, e = w * dt, k = 1 / (1 + e + .48 * e * e + .235 * e * e * e), c = this.slow - want, q = (this.slowV + w * c) * dt;
    this.slowV = (this.slowV - w * q) * k; this.slow = Math.min(1, Math.max(0, want + (c + q) * k));
    if (want === 1 && this.slow > .999) { this.slow = 1; this.slowV = 0; }
    // The picture's clock: slow too, but the players never look frozen (eased, so their life never jumps from one pace to the other).
    this.prate = (this.prate ?? 1) + (Math.max(this.slow, .35) - (this.prate ?? 1)) * (1 - Math.exp(-dt * 6));
    this.ui.clock += dt * this.prate;
    return dt * this.slow;
  },
  // Whether a new offer may come now: his ball in a play (not while he chooses, not in a replay of the better play),
  // one per play, and in matches GAP seconds apart.
  // (v76 SL) `ahead`: as a run starts, a turn still under way counts as done (outcomes.js stepUp).
  offerAllowed(ahead = false) {
    const m = this.mode, b = this.sim.ball;
    // (round 6: only in a play that is going his way: no fake on a dribble into their players, which is about to be lost)
    return this.phase === 'outcome' && this.playGood !== false && !this.skDone && !this.sk && b.carrier === 'hero' && b.state === 'carried' && (ahead || !b.move)
      && (m === 'demo' || ((m === 'lesson' || m === 'match' || m === 'free') && !this.showing)) && (m === 'lesson' || m === 'demo' || this.clock - (this.skLast ?? -99) > GAP)
      && this.skillsOpen(); // (not in the first lessons: from the one that is about taking a defender on)
  },
  // (v78) Two moves of `pool` for the next offer (with `k` first, when given): the ones he has been offered least this
  // session, so every move comes round within a few offers.
  movePair(pool, k = null) {
    const n = this.skSeen ||= {};
    // (review) Each session starts the rotation at its own place (from Math.random, so a test's seeded random keeps it the same).
    if (!this.skStart) { this.skStart = 1 + Math.floor(Math.random() * 97); for (const [i, m] of [...RUN_MOVES, ...TURN_MOVES].entries()) n[m] ??= ((i * 37 + this.skStart * 11) % 97) / 1000; }
    const rest = pool.filter(m => m !== k).sort((p, q) => (n[p] || 0) - (n[q] || 0) || pool.indexOf(p) - pool.indexOf(q));
    return k ? [k, rest[0]] : rest.slice(0, 2);
  },
  // Which way his left is on the screen (+1: to the left, -1: to the right), for the pictures' arrows and the buttons'
  // order: the move that goes left on the screen is on the left.
  screenLeft(h, yaw) {
    const p = this.world.project?.(h.x, h.y, .5), q = this.world.project?.(h.x - Math.sin(yaw) * 2, h.y + Math.cos(yaw) * 2, .5);
    return p && q && Math.abs(q[0] - p[0]) > 4 ? (q[0] < p[0] ? 1 : -1) : 1;
  },
  // A new offer (o: sim.js a.offer for a run at him, or the take-on's turn from skillHold): alts, each with the side
  // (+1 his left) the ball goes after it (`exit`; a run-at move goes away from its fake), and which one is better.
  skillOffer(o) {
    const s = this.sim, h = s.a('hero'), demo = this.mode === 'demo', scr = this.screenLeft(h, o.yaw);
    // dir: where the ball goes on the screen after the move ('l', 'r'); the button on the left gets the move that goes left
    const alts = o.alts.map((m, i) => { const exit = m.exit ?? -m.fake; return { ...m, i, exit, dir: exit * scr > 0 ? 'l' : 'r' }; }).sort((p, q) => (p.dir === 'l' ? 0 : 1) - (q.dir === 'l' ? 0 : 1));
    const T = o.kind === 'turn' ? this.holdG() : this.runLeft(o); // game seconds to the last moment a move can start (v76 SL: or to when the offer is withdrawn, the defender within a touch of him, if sooner: runLeft)
    const pace = Math.min(PACE[1], Math.max(PACE[0], T / (demo ? OFFER_DEMO : OFFER_REAL)));
    // (review) The scene both pictures share: the defender on the side the better move fakes toward (where he stands, the
    // run's bend away from him, or the crowded side), well over when he stands to one side, a little when nearly ahead.
    const gm = alts.find(m => m.good), toward = gm.dir === 'l' ? 1 : -1, wide = o.kind === 'turn' || o.why === 'defender' || Math.abs(o.fl || 0) > .35;
    const scene = { dx: toward * (wide ? .85 : .35), crowd: o.why === 'crowd' ? toward : 0, color: this.them?.kit?.colors?.[0] || null };
    this.sk = { kind: o.kind, scene, alts, phase: 'offer', t0: this.clock, g0: s.time, n0: touchAt(h), last: o.last, tgt: o.tgt, pace, T };
    this.skDone = true; this.skLast = this.clock;
    const n = this.skSeen ||= {};
    // (review) Each session starts the rotation at its own place (from Math.random, so a test's seeded random keeps it the same).
    if (!this.skStart) { this.skStart = 1 + Math.floor(Math.random() * 97); for (const [i, m] of [...RUN_MOVES, ...TURN_MOVES].entries()) n[m] ??= ((i * 37 + this.skStart * 11) % 97) / 1000; } for (const m of alts) n[m.k] = (n[m.k] || 0) + 1;
    this.hud.skill(alts.map(m => ({ k: m.k, dir: m.dir })), 1, scene); this.sfx('offer');
    if (demo) { this.handAt = SKILL_IDS[alts.findIndex(m => m.good)]; this.hud.caption(EXPLAIN.replace('!', '! ✨').replace(/!$/, '! 👆')); this.say(EXPLAIN); this.skTold = true; }
    else if (!this.skTold) { this.skTold = true; this.say(EXPLAIN); } // (the first time in a session it is said once)
  },
  // One of the two buttons (0: left, 1: right; none: the better one). The move is armed: it starts by itself at the
  // right moment. A tap after the offer has closed, or a second tap, does nothing.
  skillTap(i = null) {
    const sk = this.sk; if (!sk || sk.phase !== 'offer') return;
    const m = sk.alts[i ?? sk.alts.findIndex(x => x.good)], h = this.sim.a('hero'); if (!m || !h) return;
    if (sk.kind === 'run') { if (!this.sim.take('hero', m.i)) return; } else { h.turnTap = m.k; h.turnBad = !m.good; }
    Object.assign(sk, { phase: 'armed', pick: m, tm: this.clock });
    this.hud.skillArm(sk.alts.indexOf(m)); this.sfx('skill'); this.say(MOVE_NAME[m.k] + '!');
    this.skillCamStart(); // (it sets this.skIn: how long the camera takes to come in)
  },
  skillEnd() {
    const h = this.sim.a('hero'), sk = this.sk; if (!sk) return;
    if (sk.phase !== 'out') this.hud.skill(null);
    if (h) { h.offer = null; h.armed = null; h.turnTap = null; h.turnBad = false; h.turnAny = false; }
    if (sk.blockOn) this.scripted.delete(sk.tgt);
    if (this.mode === 'demo' && SKILL_IDS.includes(this.handAt)) this.handAt = null;
    sk.phase = 'out';
  },
  // (v78) The move to the wrong side, as it plays (each step): the defender reads it (he does not buy the fake) and
  // steps across into his way, a step ahead of the ball, until he is within reach of him; then the play's own rule takes
  // over (a defender within a step and a half goes in for it, and the play ends with him kept out: outcomes.js onHim,
  // challenge).
  skillBlock() {
    const sk = this.sk, s = this.sim, h = s.a('hero'), o = sk && s.a(sk.tgt), b = s.ball;
    if (!sk?.blockOn || !o || !h) return;
    const d = Math.hypot(o.x - h.x, o.y - h.y); o.beat = 0; // (not beaten: a take-on's defender who bit is not left off balance)
    if (d < 1.35 || s.time - sk.ts > 1.4 || b.carrier !== 'hero') { this.scripted.delete(o.id); sk.blockOn = false; return; }
    this.scripted.add(o.id); o.mom = null; if (o.track) s.untrack(o.id); // (v76 SL: off the step-up's planned way, outcomes.js stepUp)
    const yh = b.move ? b.move.a0 + b.move.d : b.h; // (in a turn: the way it takes him)
    s.go(o.id, h.x + Math.cos(yh) * 1.1, h.y + Math.sin(yh) * 1.1, 5);
  },
  // The move has started: its name, and (the wrong one) the defender's read.
  skillGo(good) {
    const sk = this.sk, s = this.sim, o = s.a(sk.tgt);
    Object.assign(sk, { phase: 'move', good, ts: s.time, fired: this.clock });
    this.hud.skillName(MOVE_NAME[sk.pick.k] + '!'); this.fx('skill');
    if (good && sk.kind === 'run' && o) { o.beat = Math.max(o.beat || 0, s.time + .8); o.tk = s.time; } // (review: he buys it, and is off balance as he goes by: he does not stop the play mid-move)
    if (!good) {
      if (o) { sk.blockOn = true; o.track = null; }
      if (this.rated && !this.rated.soft && this.rated.stars === 3) this.rated = { stars: 2, text: SKILL_TIP, said: SKILL_TIP, say: true, watch: false }; // (a lesson's card: 2 stars, and why)
    }
  },
  // (review) The play ended after his move to the wrong side: the result shows as one that went wrong (outcomes.js emit).
  skRead() { return this.sk?.good === false; },
  // After the frame's step: a new offer, the time left, the move starting and playing, and skill moves by everyone else.
  skillWatch(dt) {
    const s = this.sim, h = s.a('hero'), b = s.ball;
    if (!this.sk && h?.offer && this.phase === 'outcome') { if (h.offer.kind === 'run' && this.runLeft(h.offer) / PACE[0] < OFFER_MIN) h.offer = null; else this.skillOffer(h.offer); } // (v76 SL: too short to show: none)
    const sk = this.sk;
    if (sk?.phase === 'offer') {
      const demo = this.mode === 'demo', left = sk.kind === 'turn' ? clamp01(1 - (s.time - sk.g0) / this.holdG()) : clamp01((sk.last - touchAt(h)) / Math.max(.01, sk.last - sk.n0));
      if (sk.kind === 'run' ? !h?.offer : !h?.holdTurn || left <= 0) this.skillEnd();
      else { this.hud.skill(sk.alts.map(m => ({ k: m.k, dir: m.dir })), Math.round(left * 50) / 50, sk.scene); if (demo && (this.clock - sk.t0 > DEMO_TAP || left < .12)) { this.hud.caption(''); this.handTap = (this.handTap || 0) + 1; this.sfx('click'); this.skillTap(); } }
    } else if (sk?.phase === 'armed') {
      if (sk.kind === 'run') {
        if (h?.skill && h.skill.k === sk.pick.k) this.skillGo(h.skill.good !== false); // (the move has started)
        else if (!h?.armed) { sk.phase = 'out'; this.hud.skill(null); } // (dropped: the defender came too close first, or anything else started)
      } else {
        const m = b.move; if (m && m.k === sk.pick.k && b.carrier === 'hero') this.skillGo(m.good !== false);
        else if (!h?.holdTurn && s.time - sk.g0 > this.holdG() + .4) { sk.phase = 'out'; this.hud.skill(null); } // (the turn never came)
      }
      if (this.mode === 'demo' && SKILL_IDS.includes(this.handAt) && this.clock - sk.tm > .4) this.handAt = null;
    } else if (sk?.phase === 'move') {
      const over = sk.kind === 'turn' ? !b.move || b.carrier !== 'hero' || (s.time - b.move.t0) / b.move.dur > .92 : !h?.skill || touchAt(h) - h.skill.n > 1.15 || h.sp < .3;
      if (over) { sk.phase = 'out'; this.hud.skill(null); }
      if (this.mode === 'demo' && SKILL_IDS.includes(this.handAt)) this.handAt = null;
    } else if (sk?.phase === 'out' && this.slow >= 1 && this.skCam <= 0 && !sk.blockOn && (sk.good !== false || this.phase !== 'outcome' || this.result)) this.sk = null; // (the wrong one is kept until the play has its result)
    if (sk?.good === false && this.result && !sk.said) { sk.said = true; if (this.mode === 'match' || this.mode === 'free') this.say(SAW); } // (a lesson's card says its tip)
    // The close camera: once he taps, in over half a second or more (longer from farther away, see skillCamStart), held
    // through the move, back out over about 0.7 s. (Smoothed both ways in game/view.js, so it starts and stops softly.)
    this.skCam = Math.min(1, Math.max(0, (this.skCam || 0) + (sk?.phase === 'armed' || sk?.phase === 'move' ? dt / (this.skIn || .5) : -dt / .7)));
    // Skill moves by the others: a small tag in the corner with the move and who did it.
    const c = b.state === 'carried' ? s.a(b.carrier) : null, ref = c && (b.move && TURN_SKILLS.has(b.move.k) ? b.move : c.skill);
    if (ref && ref !== this.tagRef) { this.tagRef = ref; if (c.id !== 'hero') this.hud.skillTag(MOVE_NAME[ref.k], this.name(c.id)); }
  },
};
