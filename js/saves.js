// The keeper game (v67): he plays in goal. A round is eight shots at him. For each he taps twice, as when he shoots
// (a place, then how): where to stand as the shooter comes (three gold spots), then where to dive as the shot is struck
// (the six targets he shoots at, now in his own goal). Nothing here is chance: the same taps in the same shot always end
// the same way, and the result follows from the picture.
// Places are in the goal's own frame: x metres out from our goal line, u metres across from the goal's middle (+u: his
// left as he faces the shooter, the left of the screen behind him). game/goalie.js plays it in the 3D world.
import { FOOT, LOW_Z, CLOSE, stream } from './shot.js';
import { ease, ramp } from './mini/rules.js';

// The 5v5 goal (geom.js SIZES), at every team size: 5 m wide, 1.8 m high.
export const GOAL = { half: 2.5, gh: 1.8 };
// The six targets, as he shoots at them (shot.js: IN m inside the post, the top row TOP m under the bar, the low row a
// ball along the grass), named as he sees them from his goal: L his left, R his right, T the top row.
const IN = .6, TOP = .4;
export const ZONES = ['TL', 'TM', 'TR', 'L', 'M', 'R'];
export const zoneAt = id => { const col = id.slice(-1), top = id.length > 1; return { id, col, top, u: col === 'L' ? GOAL.half - IN : col === 'R' ? IN - GOAL.half : 0, z: top ? GOAL.gh - TOP : LOW_Z }; };

// ---------- where to stand ----------
// "Ball, you, goal": the right spot is on the line from the ball (where it is struck) to the middle of the goal, OFF m
// off the line: a step for a shot, two in a 1v1 (he comes out to make the goal small), on the line for a penalty (the
// rule). The other two spots are GAP m across from it, inside the posts.
export const OFF = { shot: 1, '1v1': 2.2, pen: .15 };
const GAP = 1.4, EDGE = 2.1, NEAR = .5;
export const rightSpot = shot => { const off = Math.min(OFF[shot.kind], shot.from.x * .4), f = off / shot.from.x; return { x: off, u: shot.from.u * f }; }; // (never closer to the ball than he is to the goal: a 1v1 struck from close in a match)
// The three gold spots, left to right as he sees them: { id: 0..2, x, u, right }.
export function spotsFor(shot) {
  const r = rightSpot(shot);
  if (shot.kind === 'pen') return []; // (a penalty: the rule keeps him on his line, in the middle, where he starts: only the dive)
  const others = [r.u + GAP, r.u - GAP].map(u => ({ x: r.x, u: Math.abs(u) <= EDGE ? u : r.u - Math.sign(u) * 2 * GAP })); // (side by side at one depth, so all three are clear on screen; one would be outside a post: both go on the other side)
  return [{ ...r, right: true }, ...others.map(p => ({ ...p, right: false }))].sort((p, q) => q.u - p.u || p.x - q.x).map((p, id) => ({ id, ...p }));
}
// Where he stands as the shot is struck is right when it is the right spot (within NEAR m of it).
export const standOf = (shot, at) => (Math.hypot(at.x - rightSpot(shot).x, at.u - rightSpot(shot).u) <= NEAR ? 'right' : 'wrong');
// Where he starts each shot: in the middle of his goal, on the line.
export const START = { x: .15, u: 0 }; // (just off the line: the ring round his feet stays clear of the spots a step out)

// ---------- what a shot does ----------
// Where the ball, struck from `from` along the grass at a target, crosses his line (x = kx): u across, z its height.
export function crossAt(from, zid, kx) {
  const Z = zoneAt(zid), f = Math.max(0, Math.min(1, (from.x - kx) / from.x));
  return { u: from.u + (Z.u - from.u) * f, z: Z.z * f + LOW_Z * .3 * (1 - f) };
}
// A young keeper (shot.js GK): a ball within BODY m of his middle (up to BODY_TOP high) hits him; he dives across DIVE_MAX m
// at most (his body and his arms). He commits as the shot is struck, so his dive takes him to where he chose:
//   - he chose the place the ball goes: saved, unless it is out of reach from where he stands (a far corner);
//   - standing right he is closer to everything, so the other target on that side (high or low) is his too;
//   - no dive: he stays where he is and reacts late, so only a ball at his body is stopped.
export const DIVE_MAX = 2.3, BODY = .45, BODY_TOP = 1.5, MISS = .5; // (MISS: a ball he does not get goes at least this far past his hands)
// saveOf(shot, at, tap): at = where he stands ({ x, u }), tap = the target he chose ('TL'..'R') or null.
// Returns { res: 'save' | 'goal', right (he stood right), why: null | 'spot' (stand between the ball and the goal) |
// 'dive' (he went the other way) | 'late' (no dive), act: what his body does ('stay' blocks it, 'reach' a step and his
// hands, 'low' a dive along the grass, 'high' a dive up, 'late' a late lunge), dir: +1 his left, held (a save he keeps; else
// he pushes it away), hand: where his hands go { u, z } (a save: on the ball), ball: where it crosses his line, reach }.
export function saveOf(shot, at, tap = null) {
  const right = standOf(shot, at) === 'right', B = zoneAt(shot.zone), c = crossAt(shot.from, shot.zone, at.x), off = c.u - at.u;
  const atBody = Math.abs(off) <= BODY && c.z <= BODY_TOP;
  let save, reach = true, hand = c;
  if (!tap) save = atBody;
  else {
    const T = zoneAt(tap), ct = crossAt(shot.from, tap, at.x);
    reach = Math.abs(ct.u - at.u) <= DIVE_MAX;
    save = reach && (tap === shot.zone || (right && T.col === B.col));
    if (!save) hand = reach ? ct : { u: at.u + Math.sign(ct.u - at.u) * DIVE_MAX, z: ct.z }; // (as far as he gets toward where he chose)
  }
  if (!save && !tap) hand = { u: at.u + Math.sign(off) * Math.max(0, Math.min(Math.abs(off) - .6, .8)), z: Math.min(c.z, 1) }; // (late: a lunge toward it)
  if (!save) { const g = Math.hypot(hand.u - c.u, hand.z - c.z); if (g < MISS) hand = { u: hand.u - Math.sign(c.u - at.u) * (MISS - g), z: hand.z }; } // (it goes past his fingertips, not through them)
  const why = save ? null : !tap ? 'late' : !reach || (!right && zoneAt(tap).col === B.col) ? 'spot' : 'dive';
  const du = hand.u - at.u, far = Math.abs(du);
  const act = save && atBody && (!tap || zoneAt(tap).col === B.col || far <= BODY) ? 'stay' : !tap ? 'late' : far <= .95 ? 'reach' : hand.z > .9 ? 'high' : 'low';
  const held = save && (shot.foot === 'in' || act === 'stay' || act === 'reach');
  return { res: save ? 'save' : 'goal', right, why, act, dir: Math.sign(du) || 1, held, hand: { u: hand.u, z: hand.z }, ball: c, reach };
}
// The kind line after a goal, by why it went in (spoken: tests/spoken.js).
export const SAVED = 'Saved!';
export const WHY = { dive: 'Good try! Watch his eyes.', spot: 'Good try! Ball, you, goal!', late: 'Good try! Dive for it!' };
// What else the keeper game says (ui/goalie.js): the first time it opens, the results card's headline by how many he saved,
// and in a match the first few times he is handed our keeper.
export const SAID = { intro: 'You are the keeper! Stop his shots!', top: 'Super keeper! You got a new sticker!', good: 'Great saves!', try: 'Good try!', youre: "You're the keeper!" };

// ---------- the shooter's tell ----------
// Before the kick he shows where it goes, honestly: he looks at it (his eyes, drawn big over his head while it is new)
// and turns his body and standing foot to it; and the kick tells how: close in, the inside of the foot (low and slower),
// farther out the laces (fast, and it can rise). shot.js decides the foot by the same distance (CLOSE).
// The tell is clear on the first shots and subtler later: `level` 3 his eyes the whole time and an arrow from his
// standing foot; 2 his eyes; 1 his eyes for a moment (his body says it all the time). Seen from his goal the shooter is
// small, so his eyes never go altogether.
export const TELL = [3, 3, 2, 2, 2, 1, 1, 1];
export const tellOf = shot => { const Z = zoneAt(shot.zone); return { col: Z.col, top: Z.top, foot: shot.foot, level: shot.tell, at: { u: Z.u, z: Z.z }, flash: shot.flash ?? 1.6 }; }; // (flash: v87, the mini game's later shots show his eyes for less time)
// How long he has to choose, real seconds: where to stand (the shooter's run-up) and where to dive (the wind-up and the
// strike, in slow motion). A little quicker as the round goes on.
export const windows = n => ({ stand: 3.8 - .15 * n, dive: 3.6 - .12 * n });

// ---------- a round ----------
export const SHOTS = 8, STICKER_AT = 6;
// One shot: kind 'shot' | '1v1' (he dribbles in) | 'pen' (the penalty that ends a round), from where it is struck, the
// target, and where his run starts. The foot follows from the distance (shot.js CLOSE).
export function makeShot(n, kind, from, zone, start = null) {
  const d = Math.hypot(from.x, from.u), foot = d <= CLOSE ? 'in' : 'las', back = foot === 'in' ? 2.4 : 3.6;
  if (foot === 'in' && zoneAt(zone).top) throw new Error(`an inside-foot shot is low (${zone})`);
  start ||= { x: from.x + from.x / d * back, u: from.u + from.u / d * back + (kind === 'pen' ? 0 : (from.u >= 0 ? .6 : -.6)) };
  return { n, kind, from, zone, foot, speed: FOOT[foot].speed, start, tell: TELL[n], ...windows(n) };
}
// The eight shots of a round from a seed: from the left, the middle and the right, close and far, one or two 1v1s, and
// a penalty to end it. The same seed gives the same round.
export function roundPlan(seed = 1) {
  const r = stream((Math.abs(seed) * .6180339887 + .1) % 1), side = () => (r() < .5 ? 1 : -1), pick = a => a[Math.floor(r() * a.length)];
  const low = s => (s > 0 ? 'L' : 'R'), lowFar = s => (s > 0 ? 'R' : 'L'), top = s => (s > 0 ? 'TL' : 'TR');
  const s = Array.from({ length: 8 }, side); s[2] = -s[1]; s[5] = -s[3]; // (shots from both sides in every round)
  return [
    makeShot(0, 'shot', { x: 7, u: .5 * s[0] }, pick([low(s[1]), low(-s[1])])),                       // middle, close: low
    makeShot(1, 'shot', { x: 6.5, u: 3 * s[1] }, pick([lowFar(s[1]), low(s[1])])),                    // from the side, close
    makeShot(2, 'shot', { x: 11.5, u: 2 * s[2] }, pick([top(-s[2]), top(s[2]), lowFar(s[2])])),     // far: laces
    makeShot(3, '1v1', { x: 5.5, u: s[3] }, pick([lowFar(s[3]), low(s[3])]), { x: 15, u: 3.2 * s[3] }), // he dribbles in
    makeShot(4, 'shot', { x: 12, u: 0 }, pick(['TM', top(s[4]), 'M'])),                               // far, straight on
    makeShot(5, 'shot', { x: 6, u: 3.2 * s[5] }, pick([lowFar(s[5]), 'M'])),                         // the side, close
    r() < .5 ? makeShot(6, '1v1', { x: 5.5, u: .8 * s[6] }, lowFar(s[6]), { x: 15, u: -2 * s[6] }) : makeShot(6, 'shot', { x: 10.5, u: -2.5 * s[6] }, pick([top(s[6]), low(s[6])])),
    makeShot(7, 'pen', { x: 7, u: 0 }, pick(['L', 'R', 'M'])),                                         // the penalty
  ];
}
// ---------- the mini game (v87): endless, two lives ----------
// The keeper mini game is no longer a round of eight: shots keep coming until two go in (mini/rules.js), and each save
// makes the next shots a little harder. keeperLevel says how hard at a level (a third of a level a save): the one place
// to tune it. The tells stay honest at every level (his eyes, his body, his standing foot): only how long they show and
// how long he has to choose change, and the shots come from harder places.
// (v93) The owner: the first shooter "just stops and waits... shows you the eyes for a long time... so easy", every
// shot to one side, a try about 12 s. Now a try takes about half that, the shots vary from the first one (where from,
// which side, how high, which foot, a 1v1 or a penalty), his eyes show for a moment only from the third save, and he
// can look one way first and then the way he shoots (a feint: his last look is always the true one).
//   stand, dive   real seconds to pick where to stand and where to dive (1.9 and 1.2 at first, toward 0.8 and 0.55)
//   tell          2: his eyes the whole time; 1: his eyes for `flash` s after his last look, then his body only
//   flash         (tell 1) how long his eyes show, in the picture's seconds
//   fake          the share of shots in which he looks one way first (0.4 at first, toward 0.75)
//   fakeAt        when his true look comes, as a share of the dive window (later and later: less time to change)
//   far, top      the share of far shots (laces: they can go high), and of those the share at the top corners
//   speed         the shot's speed, times the foot's own (after he has chosen: it only looks and feels quicker)
export function keeperLevel(L) {
  L = Math.max(0, L);
  return {
    stand: ease(1.9, .8, 5)(L), dive: ease(1.2, .55, 5)(L),
    tell: L < 1 ? 2 : 1, flash: ease(.8, .3, 4)(Math.max(0, L - 1)),
    fake: .4 + ramp(0, .1, .35)(L), fakeAt: .5 + ramp(0, .06, .22)(L),
    far: .2 + ramp(0, .04, .2)(L), top: .35 + ramp(0, .07, .4)(L), speed: 1 + Math.min(.3, .03 * L),
  };
}
// The kinds of shot, a few of each in every six (shuffled): close in front, from the side, from far out, a 1v1, a
// penalty. hist: the shots before (newest last), so no kind and no corner comes twice in a row, and no side three times.
const KINDS = ['close', 'side', 'far', '1v1', 'pen', 'side'];
// One shot of the endless game at `level` (n: how many came before it; r: a stream of numbers 0..1, shot.js stream).
export function endlessShot(level, r, n = 0, hist = []) {
  const D = keeperLevel(level), pick = a => a[Math.floor(r() * a.length) % a.length], last = hist.at(-1);
  const low = s => (s > 0 ? 'L' : 'R'), lowFar = s => (s > 0 ? 'R' : 'L'), top = s => (s > 0 ? 'TL' : 'TR');
  let kind = KINDS[Math.floor(r() * KINDS.length) % KINDS.length];
  if (r() < D.far * .6) kind = 'far';
  if (last && last.k === kind) kind = KINDS[(KINDS.indexOf(kind) + 1 + Math.floor(r() * 3)) % KINDS.length];
  if (last && last.k === kind) kind = kind === 'close' ? 'side' : 'close';
  const cols = hist.slice(-2).map(h => zoneAt(h.zone).col);
  let side = r() < .5 ? 1 : -1;
  const high = kind === 'far' && r() < D.top, ok = z => z !== last?.zone && !(cols.length === 2 && cols.every(c => c === zoneAt(z).col)); // (never the same corner twice, nor one side three times)
  const zonesOf = s => (kind === 'pen' ? ['L', 'R', 'M'] : kind === '1v1' || kind === 'side' ? [lowFar(s), low(s)] : high ? [top(s), top(-s)] : kind === 'far' ? [low(s), lowFar(s), 'M'] : [low(s), low(-s), 'M']).filter(ok); // (from the spot or close in: the inside of the foot, low)
  if (!zonesOf(side).length) side = -side;
  const zone = pick(zonesOf(side).length ? zonesOf(side) : ['L', 'R'].filter(z => z !== last?.zone));
  let sh;
  if (kind === 'pen') sh = makeShot(n, 'pen', { x: 7, u: 0 }, zone);
  else if (kind === '1v1') sh = makeShot(n, '1v1', { x: 5.5, u: side * (.5 + r() * .5) }, zone, { x: 15, u: 3 * side });
  else if (kind === 'far') sh = makeShot(n, 'shot', { x: 10.5 + r() * 1.5, u: side * r() * 2.5 }, zone);
  else if (kind === 'side') sh = makeShot(n, 'shot', { x: 6 + r() * .6, u: side * (2.4 + r() * .8) }, zone);
  else sh = makeShot(n, 'shot', { x: 6.5 + r(), u: side * r() * .6 }, zone); // (close, in front)
  // A feint: his eyes and his body go to a target on the other side first (as high), then to the true one.
  const Z = zoneAt(zone), fake = r() < D.fake ? (Z.col === 'M' ? (r() < .5 ? 'L' : 'R') : Z.col === 'L' ? 'R' : 'L') : null;
  const fz = fake && (Z.top && sh.foot === 'las' ? 'T' + fake : fake);
  return { ...sh, k: kind, tell: D.tell, flash: D.flash, stand: D.stand, dive: D.dive, speed: sh.speed * D.speed, level, fake: fz, fakeAt: D.fakeAt };
}

// The score after a round: saves of SHOTS, and the stars on the card (3: STICKER_AT or more, 2: four or more, 1: some).
export const starsFor = saves => (saves >= STICKER_AT ? 3 : saves >= 4 ? 2 : saves > 0 ? 1 : 0);

// ---------- in a match (v67): now and then he is our keeper for one of their shots ----------
// The grown-ups' setting "Play the keeper" (P.settings.keeperPlay): off (our keeper plays as before: game/keeper.js
// OUR_SAVE), sometimes, always. Only at a size with keepers (5v5). Sometimes: a shot is his half of the time when the
// last one was not, and never two in a row, so about one of their shots in three is his (u: a seeded number 0..1).
export const KEEPER_PLAY = ['off', 'sometimes', 'always'], SOMETIMES = .5;
export const keeperGive = (mode, lastGiven, u) => mode === 'always' || (mode === 'sometimes' && !lastGiven && u < SOMETIMES);
// Their shot as a keeper's moment: struck from `from` (he takes one touch to set it, from `start`), at a target picked by
// the seeded number u (the inside of the foot from close: low; the laces from farther: any). His eyes show it all the way.
export function matchShot(from, start, u) {
  const close = Math.hypot(from.x, from.u) <= CLOSE, low = ['L', 'R', 'M', 'L', 'R'], zone = close ? low[Math.floor(u * low.length) % low.length] : ZONES[Math.floor(u * 6) % 6];
  return { ...makeShot(2, Math.hypot(from.x, from.u) <= 7.5 ? '1v1' : 'shot', from, zone, start), match: true };
}
// How his two taps went, for the decision log (progress.js logChoice, under its own idea 'keeper'): both right (the right
// spot, and the side the ball went) best; one of them okay; neither a miss. No taps at all: out of time.
export const KEEPER_IDEA = 'keeper';
export const gradeOf = r => (r.spot == null && r.tap == null ? 'timeout' : r.right && r.tap && zoneAt(r.tap).col === zoneAt(r.spec.zone).col ? 'best' : r.right || (r.tap && zoneAt(r.tap).col === zoneAt(r.spec.zone).col) ? 'okay' : 'miss');
