// Endless scenarios for every lesson. Each one is built around a teaching pattern, then every option is graded
// with the same geometry the game uses. Anything unclear (a pass lane that is half open, a push the defender
// might or might not win) is thrown away and rebuilt, so every round has a clear right answer.
import { PITCH, L, W, closestOnLane, interceptor, dribbleEnd, rot, clamp, dist, lerp, shuffle, DRIBBLE_DIRS, BACKWARD, TEAM, sizeOf } from './geom.js';
import { GK, resolve, placedAim, spaces, rightFoot, bestSpaceY } from './shot.js';

const OPEN = 1.6, BLOCKED = .6;        // pass lanes: clearly open / clearly cut off (meters to nearest defender)
const FREE = 2.2, MARKED = 1.3;        // receivers: nobody near / a defender right on him
const PATH_FREE = 2.2, PATH_HIT = 1.8; // small-touch dribbles: clearly free / a defender in the way (measured from a stride ahead)
const PUSH_LEN = 7; // "big push": knock it 7 m ahead and race for it
export const HERO_RUN = 5.4, DEF_RUN = 4.8;
const OUR_GOAL = { x: 0, get y() { return W / 2; } }; // (W: the current pitch, see geom.js)
const OUR_GOAL_PT = () => [OUR_GOAL.x, OUR_GOAL.y];

// Small seeded random generator. The seed is scrambled and the first values thrown away, because nearby seeds
// otherwise start with nearly identical (tiny) numbers and always pick the same pattern.
function rng(seed) {
  let s = (Math.abs(Math.floor(seed)) * 2654435761 + 12345) % 2147483647 || 1;
  const next = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 4; i++) next();
  return next;
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
// Where the open friend stands, as an angle from straight at goal: ahead or out wide. A pass back just to keep
// the ball is never the right answer at this age (FA/DFB guidance); escaping a two-defender trap is the exception.
const openAngle = (r, pattern) => { const u = r(), sd = pick(r, [1, -1]); return sd * (u < .6 ? .6 + r() * .6 : pattern === 'trap' && u > .85 ? 2.2 + r() * .6 : 1.25 + r() * .55); };
const PASS_TO = new Set(['one-open', 'marked', 'trap', 'two-open']);
// Situations that happen all over the field, including near their goal (a 1v1 or a trap by the box is common).
const ANYWHERE = new Set(['trap-one', 'trap', 'marked', 'one-open', 'space-behind', 'give-go', 'give-go-ahead']);
// Lessons whose answer is a pass or a dribble: a layout with a clear shot belongs to "Shoot!", so it's skipped.
const NO_SHOT = new Set(['space-friend', 'trap-one', 'trap', 'marked', 'one-open', 'two-open', 'forward', 'carry', 'none-open', 'space-behind', 'space-far', 'space-near', 'give-go', 'give-go-ahead', 'counter', 'counter-pass']);
export const inPitch = ([x, y], m = 1.5) => x > m && x < L - m && y > m && y < W - m;
const P = ([x, y]) => ({ x, y });
// How much longer (dL) and half how much wider (dW) the pitch is than the 3v3 one: places written for 30 x 20 m that are
// measured from their goal or from the middle move with it (0 at 3v3, so its scenes stay exactly as they were).
const dL = () => L - 30, dW = () => (W - 20) / 2;
// How much longer the pitch is than the 4v4 one (0 at 3v3 and 4v4, so their scenes stay exactly as they were): for the
// places that only failed on the 5v5 pitch.
const big = () => Math.max(0, L - 32);
export function pushEnd(from, dir) {
  const [dx, dy] = rot(PUSH_LEN, 0, DRIBBLE_DIRS[dir]);
  return { x: clamp(from.x + dx, 1, L - 1), y: clamp(from.y + dy, 1, W - 1) };
}
// A point `k` meters from p toward our goal: where a defender stands to be "goal-side".
export function goalSide(p, k) { const dx = OUR_GOAL.x - p[0], dy = OUR_GOAL.y - p[1], l = Math.hypot(dx, dy) || 1; return [p[0] + dx / l * k, p[1] + dy / l * k]; }

// A take-on: exactly one defender close in front of him. Cutting diagonally past him on his open side (away from
// the side he stands on) beats him; cutting toward his side runs into him. Straight at him is still blocked, and
// a sideways dribble only keeps the ball. Returns null when it isn't a take-on, else { foe, good }.
export function takeOn(hero, dir, opps) {
  if (dir !== 'fl' && dir !== 'fr') return null;
  const near = opps.filter(o => dist(o, hero) < 3.2); if (near.length !== 1) return null;
  const foe = near[0], ang = Math.atan2(foe.y - hero.y, foe.x - hero.x);
  if (Math.abs(ang) > .6 || dist(foe, hero) < 1.4) return null;            // in front of him, with room to cut
  const side = dir === 'fl' ? 1 : -1, open = Math.abs(ang) < .06 || Math.sign(ang) !== side;
  const end = dribbleEnd(hero, dir, L, W), clear = opps.every(p => p === foe || (dist(p, end) > 2.4 && closestOnLane(p, hero, end, .2).d > 1.6));
  return { foe, good: open && clear };
}

// Grades every attacking option at the freeze: 'good', 'bad', 'unclear', or 'safe' (a backward dribble into
// open space: he keeps the ball but goes away from goal). `push:` options are big pushes into space.
export function grade(sc) {
  const hero = P(sc.heroTo), ball = { x: hero.x + .5, y: hero.y };
  const opps = sc.opps.map((p, i) => P((sc.oppsTo || [])[i] || p));
  const out = {};
  sc.mates.forEach((m, i) => {
    const mate = P(m), d = interceptor(ball, mate, opps).d, mark = Math.min(...opps.map(o => dist(o, mate)));
    const blockedByFriend = sc.mates.some((q, j) => j !== i && closestOnLane(P(q), ball, mate, .05).d < .8 && dist(P(q), mate) > 1);
    out['pass:' + i] = blockedByFriend ? 'unclear' : d > OPEN && mark > FREE ? 'good' : d < BLOCKED || mark < MARKED ? 'bad' : 'unclear';
  });
  // Shooting: on from about 9 m or closer with no defender on the line; blocked or from far out, it gets stopped.
  const aim = { x: L + .7, y: clamp(hero.y, PITCH.gy0 + .8, PITCH.gy1 - .8) }, shotD = dist(hero, aim), shotLane = Math.min(...opps.map(o => closestOnLane(o, ball, aim, 0).d));
  out.shoot = shotD < 12 && shotLane > 1.1 ? 'good' : shotLane < .8 || shotD > 13.5 ? 'bad' : 'unclear';
  // Dribbles: one defender near him is NOT a reason to pass. A dribble only loses the ball if it runs into a
  // defender (checked from a stride ahead, not his own feet) or if two defenders are already on him (a trap).
  const onHim = opps.filter(o => dist(o, hero) < 2.6).length;
  // Dribbling onto a friend keeps the ball, but it takes his space and brings his defender over: space means
  // nobody there, not even a friend. So at most "safe" (two stars).
  const mates = sc.mates.map(P), ontoFriend = (end, r) => mates.some(m => dist(m, end) < r || closestOnLane(m, hero, end, .2).d < .9);
  for (const dir of Object.keys(DRIBBLE_DIRS)) {
    const end = dribbleEnd(hero, dir, L, W), near = Math.min(...opps.map(o => closestOnLane(o, hero, end, .8 / 4.5).d));
    const t = takeOn(hero, dir, opps);
    out['drib:' + dir] = t ? (t.good ? 'good' : 'bad') : near < PATH_HIT || onHim >= 2 ? 'bad' : BACKWARD.has(dir) ? 'safe' : near > PATH_FREE ? 'good' : 'unclear';
    if (out['drib:' + dir] === 'good' && ontoFriend(end, 2.2)) out['drib:' + dir] = 'safe';
    if (BACKWARD.has(dir)) continue;
    const pe = pushEnd(hero, dir), lane = Math.min(...opps.map(o => closestOnLane(o, hero, pe, .15).d));
    const tHero = dist(hero, pe) / HERO_RUN + .15, tDef = Math.min(...opps.map(o => dist(o, pe) / DEF_RUN + .3));
    out['push:' + dir] = tHero < tDef - .3 && lane > 1.2 ? 'good' : tHero > tDef - .05 || lane < .8 ? 'bad' : 'unclear';
    if (out['push:' + dir] === 'good' && ontoFriend(pe, 2.5)) out['push:' + dir] = 'safe';
  }
  return out;
}

// ---------- attacking patterns ----------
function attack(r, pattern, high = false) {
  const near = pattern === 'shot-open' || pattern === 'shot-blocked' || pattern === 'counter-shot', far = pattern === 'shot-far';
  const hy = near ? 7 + dW() + r() * 6 : 5 + dW() + r() * 10, heroTo = [0, hy];
  const up = high && ANYWHERE.has(pattern); // near their goal: friends stand a little closer so they stay on the pitch
  const hx = near ? 16 + dL() + r() * 4 : far ? 10 + dL() + r() * 2 : pattern === 'counter' || pattern === 'counter-pass' ? 3 + r() * 5 : up ? 13 + dL() + r() * 5 : 4 + r() * 10;
  heroTo[0] = hx + 3; const ball = [hx + 3.5, hy];
  const mates = [], opps = [], oppsTo = [];
  const at = (ang, d) => { const [dx, dy] = rot(d, 0, ang); return [heroTo[0] + dx, heroTo[1] + dy]; };
  const onLane = (to, t) => [ball[0] + (to[0] - ball[0]) * t + (r() - .5) * .5, ball[1] + (to[1] - ball[1]) * t + (r() - .5) * .5];
  const closeIn = p => [p[0] + (p[0] - heroTo[0]) * .35, p[1] + (p[1] - heroTo[1]) * .35]; // defenders start a bit farther out
  const add = p => { opps.push(closeIn(p)); oppsTo.push(p); };
  // Teammates sit anywhere around him, including behind, so he has to turn to find them.
  let angles = [r() * 2.6 - 1.3, pick(r, [1, -1]) * (1.3 + r() * 1.4)];
  const fside = pick(r, [1, -1]);
  if (pattern === 'forward') angles = [-fside * (.1 + r() * .5), fside * (2.3 + r() * .6)];
  if (pattern === 'carry') angles = [pick(r, [1, -1]) * (1.5 + r() * 1.2), pick(r, [1, -1]) * (1.8 + r() * 1)];
  if (pattern === 'space-friend') angles = [pick(r, [1, -1]) * (.08 + r() * .2), pick(r, [1, -1]) * (2.4 + r() * .5)]; // a friend standing right in front of him, between him and the goal
  if (pattern === 'counter') angles = [pick(r, [1, -1]) * (.6 + r() * .5), pick(r, [1, -1]) * (2.3 + r() * .6)];   // one friend ahead and wide, one behind
  if (pattern === 'give-go') angles = [pick(r, [1, -1]) * (1.05 + r() * .4), (r() - .5) * .6];                     // a wall friend to the side, one far ahead
  if (pattern === 'give-go-ahead') angles = [pick(r, [1, -1]) * (.7 + r() * .35), (r() - .5) * .6];                // the wall friend ahead and to one side
  if (pattern === 'counter-pass') angles = [pick(r, [1, -1]) * (.45 + r() * .5), pick(r, [1, -1]) * (2.3 + r() * .6)]; // a friend already running ahead
  if ((pattern.startsWith('space') && pattern !== 'space-friend') || pattern.startsWith('shot') || pattern === 'counter-shot') angles = [pick(r, [1, -1]) * (2.2 + r() * .7), pick(r, [1, -1]) * (2.2 + r() * .7)];
  if (PASS_TO.has(pattern)) { const a0 = openAngle(r, pattern); let a1; do a1 = r() * 5.6 - 2.8; while (Math.abs(a1 - a0) < .9); angles = [a0, a1]; }
  else if (r() < .5 && pattern !== 'forward' && pattern !== 'space-friend') angles.reverse();
  // The presser comes from the side away from the open friend, so a pass ahead or out wide really is on.
  const s0 = Math.sign(angles[0]), ahead0 = Math.abs(angles[0]) < 1.25;
  const wall = pattern === 'give-go' || pattern === 'give-go-ahead';
  for (const [k, a] of angles.entries()) mates.push(at(a, wall ? (k ? (up ? 6.5 : 10) + r() * 2 : 4.5 + r() * 1.5) : pattern === 'counter-pass' && !k ? 6.5 + r() * 2.5 : pattern === 'space-friend' && !k ? 3.6 + r() * .9 : up ? 4.5 + r() * 2.5 : 5.5 + r() * 4));
  if (!mates.every(p => inPitch(p))) return null;
  const sidePt = (m, k) => { const dx = m[0] - ball[0], dy = m[1] - ball[1], l = Math.hypot(dx, dy); return [m[0] - dy / l * k + dx / l * .4, m[1] + dx / l * k + dy / l * .4]; };

  if (pattern === 'forward') {
    add(at(fside * (.45 + r() * .3), 1.8 + r() * .3));         // presser in front, leaning away from the forward teammate
    add([L - 4 - big() * .6 - r() * 2, W / 2 + (r() - .5) * 4]); add([L - 8 - big() * .6 - r() * 3, pick(r, [3, W - 3])]);
  } else if (pattern === 'one-open') {
    add(ahead0 ? at(-s0 * (.45 + r() * .35), 1.9 + r() * .3) : at((r() - .5) * .5, 1.7 + r() * .4)); // presser: dribbling forward runs into him
    add(onLane(mates[1], .55 + r() * .25));
    add([L - 6 - r() * 4, W / 2 + (r() - .5) * 8]);           // last defender stays home
  } else if (pattern === 'marked') {
    add(ahead0 ? at(-s0 * (.45 + r() * .35), 1.9 + r() * .3) : at((r() - .5) * .5, 1.7 + r() * .4));
    add(sidePt(mates[1], pick(r, [1, -1]) * (.7 + r() * .4)));  // right next to the second teammate, not in the lane
    add([L - 6 - r() * 4, W / 2 + (r() - .5) * 8]);
  } else if (pattern === 'trap-one') {                        // only one defender: take him on, dribble past
    add(at((r() - .5) * .4, 1.8 + r() * .4));
    add(onLane(mates[1], .6 + r() * .2));
    add([L - 6 - r() * 4, W / 2 + (r() - .5) * 8]);
  } else if (pattern === 'shot-open' || pattern === 'shot-far') { // a clear look at goal (close or too far)
    add(onLane(mates[0], .6 + r() * .2));
    add([heroTo[0] - 2 - r() * 3, heroTo[1] + pick(r, [1, -1]) * (2 + r() * 3)]);            // chasing from behind
    if (far) { const p = [L - 3 - r(), clamp(heroTo[1] + (W / 2 - heroTo[1]) * .6, 8.6 + dW(), 11.4 + dW())]; opps.push(p); oppsTo.push(p); } // recovering near goal
    else add([heroTo[0] - 1 - r() * 2, heroTo[1] + pick(r, [1, -1]) * (3 + r() * 2)]);
  } else if (pattern === 'shot-blocked') {                    // a defender stands right in the way of the shot
    const aim = [L + .7, clamp(heroTo[1], PITCH.gy0 + .8, PITCH.gy1 - .8)], t = .25 + r() * .2;
    add(onLane(mates[0], .6 + r() * .2));
    add([ball[0] + (aim[0] - ball[0]) * t, ball[1] + (aim[1] - ball[1]) * t + (r() - .5) * .4]);
    add([heroTo[0] - 3 - r() * 2, heroTo[1] + (r() - .5) * 6]);
  } else if (pattern === 'trap') {
    add(at(-s0 * (.3 + r() * .3), 1.8 + r() * .3));             // one in front...
    add(at(-s0 * (1.1 + r() * .5), 1.6 + r() * .5));            // ...and one closing from the side: a trap
    add(onLane(mates[1], .6 + r() * .2));
  } else if (pattern === 'none-open') {
    const side = pick(r, [1, -1]);
    add(at(side * (1.9 + r() * .4), 2.8 + r() * .5));          // presser closes from the side and behind
    add(onLane(mates[0], .6 + r() * .2));
    add(onLane(mates[1], .6 + r() * .2));                      // both teammates marked: run into the space
  } else if (pattern === 'two-open') {
    add(at(pick(r, [1, -1]) * (.35 + r() * .25), 1.8 + r() * .3));
    add([L - 5 - r() * 3, W / 2 + (r() - .5) * 6]);
    add([L - 9 - r() * 3, pick(r, [3, W - 3])]);
  } else if (pattern === 'space-far') {                       // wide open field: push it and go
    add(onLane(mates[0], .6 + r() * .2)); add(onLane(mates[1], .6 + r() * .2));
    add([Math.min(L - 3, heroTo[0] + 12 + r() * 4), W / 2 + (r() - .5) * 6]);
  } else if (pattern === 'space-behind') {                    // every defender is behind him: always push it and go
    add(onLane(mates[0], .6 + r() * .2));
    for (let k = 0; k < 2; k++) add([heroTo[0] - 1.5 - r() * 3, heroTo[1] + (r() - .5) * 8]);
  } else if (pattern === 'space-close') {                     // a defender is close, ahead and to one side: push away from him
    const side = pick(r, [1, -1]);
    add(onLane(mates[0], .6 + r() * .2));
    add(at(side * (.5 + r() * .5), 1.8 + r() * .5));
    add([heroTo[0] - 3 - r() * 3, heroTo[1] + (r() - .5) * 6]);
  } else if (pattern === 'space-friend') {                    // open grass one way, a friend standing in the other
    const fs = Math.sign(angles[0]);
    add([mates[0][0] + 2.5 + r() * 1.5, mates[0][1] + fs * (1 + r())]);                // the friend's defender, goal-side of him on his side
    add([heroTo[0] - 2.5 - r() * 2, heroTo[1] + (r() - .5) * 4]);                     // chasing from behind
    add([Math.min(L - 3, heroTo[0] + 13 + r() * 3), clamp(heroTo[1] + fs * (3 + r() * 2), 2.5, W - 2.5)]); // their last defender
  } else if (pattern === 'space-near') {                      // a defender lurks ahead: keep it close and go around
    add(onLane(mates[0], .6 + r() * .2)); add(onLane(mates[1], .6 + r() * .2));
    add(at((r() - .5) * .5, 5 + r() * 1.5));
  } else if (pattern === 'counter' || pattern === 'counter-shot') { // he just won the ball: their players are behind him
    add([heroTo[0] - 4.2 - r() * .8, heroTo[1] + 1.2 + r() * .6]);  // the player he took it from, carried on past him (behind the camera)
    add([heroTo[0] - 4 - r() * 3, heroTo[1] + (r() - .5) * 8]);
    if (pattern === 'counter') add([Math.min(L - 3, heroTo[0] + 14 + r() * 3), W / 2 + (r() - .5) * 6]);   // their last defender, far away
    else add([L - 3 - r() * 3, heroTo[1] > W / 2 ? 2.5 + r() * 2 : W - 2.5 - r() * 2]);                  // wide, out of the shot
  } else if (pattern === 'counter-pass') {                    // he just won it, but a defender is getting back in front of him
    add([heroTo[0] - 4.2 - big() * .2 - r() * .8, heroTo[1] + 1.2 + r() * .6]);   // the player he took it from (behind the camera; a step farther on the 5v5 pitch)
    add(at((r() - .5) * .3, 2.1 + r() * .5));                       // recovering, right in his way
    add([L - 3 - 2 * dL() - r() * 3, mates[0][1] > W / 2 ? 3 + r() * 3 : W - 3 - r() * 3]); // their last defender, on the other side (as far from him on a longer pitch)
  } else if (wall) {                                          // two shirts close him down; a friend is free right beside or ahead of him
    if (pattern === 'give-go-ahead') { add(at(-s0 * (.45 + r() * .3), 1.8 + r() * .3)); add(at(-s0 * (1.35 + r() * .4), 1.8 + r() * .4)); } // pressing from the side away from the wall
    else { add(at((r() - .5) * .3, 1.8 + r() * .3)); add(at(-s0 * (1.1 + r() * .4), 1.8 + r() * .4)); }
    add(sidePt(mates[1], pick(r, [1, -1]) * (.7 + r() * .3)));
  } else if (pattern === 'carry') {                           // space ahead, friends only to the side or behind: keep it and run
    add([heroTo[0] - 2 - r() * 2, heroTo[1] + pick(r, [1, -1]) * (2 + r() * 2)]);   // chasing from behind
    add([Math.min(L - 3, heroTo[0] + 9 + r() * 4), W / 2 + (r() - .5) * 6]);        // last defender, far away
    add([heroTo[0] + 4 + r() * 2, heroTo[1] > W / 2 ? heroTo[1] - 5 - r() * 2 : heroTo[1] + 5 + r() * 2]); // across, not in his path
  }
  if (!opps.every(p => inPitch(p, .5)) || !oppsTo.every(p => inPitch(p, 1))) return null;

  const sc = { hero: [hx, hy], heroTo, mates, opps, oppsTo };
  const g = grade(sc), goods = Object.keys(g).filter(k => g[k] === 'good' && !k.startsWith('push:'));
  if (NO_SHOT.has(pattern) && g.shoot !== 'bad' && heroTo[0] > L - 13) return null; // a shot on (or half on) here would muddle the lesson
  if (Object.entries(g).some(([k, v]) => v === 'unclear' && k.startsWith('pass:'))) return null;
  let best, cue, safe = [];
  if (pattern === 'one-open' || pattern === 'marked') {
    if (g['pass:0'] !== 'good' || g['pass:1'] !== 'bad' || g['drib:fwd'] !== 'bad') return null;
    best = 'pass:0'; cue = mates[0][0] < heroTo[0] - 2 && pattern === 'marked' ? 'Nothing ahead was open, so pass back to {m0}!' : pattern === 'marked' ? '{m0} had nobody near him. Pass to {m0}!' : '{m0} was open!';
  } else if (pattern === 'trap') {
    if (g['pass:0'] !== 'good' || goods.some(o => o.startsWith('drib:'))) return null;
    best = 'pass:0'; cue = 'Two defenders! Pass to {m0}!';
  } else if (pattern === 'trap-one') {
    const fwdish = goods.filter(o => o.startsWith('drib:')).sort((a, b) => dribbleEnd(P(heroTo), b.slice(5), L, W).x - dribbleEnd(P(heroTo), a.slice(5), L, W).x);
    if (!fwdish.length || g['drib:fwd'] !== 'bad') return null;
    // The take-on is the cut past him, diagonally, on his open side. A sideways dribble or a pass only keeps it.
    const cuts = fwdish.filter(o => o === 'drib:fl' || o === 'drib:fr');
    if (!cuts.length) return null;
    best = cuts[0]; cue = 'Only one defender. Dribble past him!';
    return { ...sc, best, ok: cuts.slice(1), safe: [...fwdish.filter(o => !cuts.includes(o)), ...goods.filter(o => o.startsWith('pass:'))], cue };
  } else if (pattern === 'shot-open') {
    if (g.shoot !== 'good') return null;
    best = 'shoot'; cue = 'Close to the goal and nobody in the way. Shoot!';
    return { ...sc, best, ok: [], safe: goods, cue };
  } else if (pattern === 'shot-blocked') {
    if (g.shoot !== 'bad' || !goods.some(o => o.startsWith('drib:'))) return null;
    best = goods.filter(o => o.startsWith('drib:'))[0]; cue = 'A defender was in the way. Dribble around him, then shoot!';
    return { ...sc, best, ok: goods.filter(o => o !== best), cue };
  } else if (pattern === 'shot-far') {
    if (g.shoot !== 'bad' || g['drib:fwd'] !== 'good') return null;
    best = 'drib:fwd'; cue = 'Too far to shoot. Get closer first!';
    return { ...sc, best, ok: goods.filter(o => o !== best), cue };
  } else if (pattern === 'none-open') {
    if (g['pass:0'] !== 'bad' || g['pass:1'] !== 'bad' || !goods.length) return null;
    best = goods.includes('drib:fwd') ? 'drib:fwd' : goods[0]; cue = 'Nobody was open. Run into the space!';
  } else if (pattern === 'two-open') {
    if (g['pass:0'] !== 'good' || g['pass:1'] !== 'good' || g['drib:fwd'] !== 'bad') return null;
    const fwd = mates[0][0] >= mates[1][0] ? 0 : 1;
    if (Math.abs(mates[0][0] - mates[1][0]) < 3 || mates[fwd][0] < heroTo[0] - 1) return null; // "closer to goal" must be obvious, and not a pass back
    if (Math.abs(Math.atan2(mates[fwd][1] - heroTo[1], mates[fwd][0] - heroTo[0])) > .6) return null; // (v62) and in view when he looks up the field: the cue names him
    best = 'pass:' + fwd; cue = `{m${fwd}} was open and closer to the goal!`;
  } else if (pattern === 'forward') {
    if (g['pass:0'] !== 'good' || g['pass:1'] !== 'good' || g['drib:fwd'] !== 'bad' || mates[0][0] - mates[1][0] < 4) return null;
    best = 'pass:0'; safe = ['pass:1']; cue = 'Look forward first! {m0} was open up the field.';
    return { ...sc, best, ok: goods.filter(o => o !== best && o !== 'pass:1'), safe, cue };
  } else if (pattern === 'space-far') {
    if (g['push:fwd'] !== 'good' || g['pass:0'] !== 'bad' || g['pass:1'] !== 'bad') return null;
    best = 'push:fwd'; cue = 'Lots of space! Push it ahead and run!';
    return { ...sc, best, ok: [...Object.keys(g).filter(k => k.startsWith('push:') && g[k] === 'good' && k !== best), ...goods.filter(o => o.startsWith('drib:'))], cue };
  } else if (pattern === 'space-behind' || pattern === 'space-close') {
    const pushes = Object.keys(g).filter(k => k.startsWith('push:') && g[k] === 'good').sort((a, b) => pushEnd(P(heroTo), b.slice(5)).x - pushEnd(P(heroTo), a.slice(5)).x);
    if (!pushes.length || g['pass:0'] !== 'bad' || g['pass:1'] !== 'bad') return null;
    if (pattern === 'space-close' && g['push:fwd'] === 'good' && pushes[0] === 'push:fwd' && pushes.length < 2) return null;
    best = pushes[0]; safe = goods.filter(o => o.startsWith('drib:'));
    cue = pattern === 'space-behind' ? 'All the defenders were behind you! Push it ahead and run!' : 'The defender was close, but not in your way. Push it away from him and race!';
    return { ...sc, best, ok: pushes.slice(1), safe, cue };
  } else if (pattern === 'counter') {
    // Their team is caught behind him: run with it (a pass forward is just as good; a pass back only keeps it).
    if (g['drib:fwd'] !== 'good' || g['push:fwd'] !== 'good') return null;
    const back = [0, 1].filter(i => mates[i][0] < heroTo[0]).map(i => 'pass:' + i);
    best = 'push:fwd'; cue = 'You won it and their team was behind you. Go forward fast!';
    return { ...sc, intro: 'won', best, ok: [...Object.keys(g).filter(k => k.startsWith('push:') && g[k] === 'good' && k !== best), ...goods.filter(o => !back.includes(o) && !(o.startsWith('drib:') && BACKWARD.has(o.slice(5))))], safe: back.filter(o => g[o] === 'good'), cue };
  } else if (pattern === 'counter-pass') {
    // Won it, the way ahead is blocked, and a friend is already running forward: the fast way forward is the pass.
    if (g['pass:0'] !== 'good' || g['drib:fwd'] !== 'bad' || g['push:fwd'] === 'good' || mates[0][0] < heroTo[0] + 3) return null;
    const back = mates[1][0] < heroTo[0] && g['pass:1'] === 'good' ? ['pass:1'] : [];
    return { ...sc, intro: 'won', best: 'pass:0', ok: goods.filter(o => o.startsWith('drib:') && !BACKWARD.has(o.slice(5))), safe: back,
      cue: '{m0} was ahead. Pass it forward!' };
  } else if (pattern === 'counter-shot') {
    if (g.shoot !== 'good') return null;
    best = 'shoot'; cue = 'You won it right by their goal. Shoot before they get back!';
    return { ...sc, intro: 'won', best, ok: [], safe: goods, cue };
  } else if (wall) {
    if (g['pass:0'] !== 'good' || g['pass:1'] !== 'bad' || goods.some(o => o.startsWith('drib:'))) return null;
    const then = giveGo(r, sc);
    if (!then) return null;
    return { ...sc, best: 'pass:0', ok: [], cue: 'Two defenders! Pass to {m0}, then go!', then };
  } else if (pattern === 'carry') {
    // At this age, staying on the ball is right when there's space ahead and every pass goes sideways or back.
    if (g['drib:fwd'] !== 'good' || !['pass:0', 'pass:1'].every(k => g[k] !== 'unclear') || mates.some(m => m[0] > heroTo[0] + 1)) return null;
    best = 'drib:fwd'; cue = 'Space ahead! Keep it and run!';
    return { ...sc, best, ok: goods.filter(o => o.startsWith('drib:') && o !== best && !BACKWARD.has(o.slice(5))), safe: ['pass:0', 'pass:1'].filter(k => g[k] === 'good'), cue };
  } else if (pattern === 'space-friend') {
    // Space means nobody there, not even a friend: the way toward him only keeps it (two stars).
    // The friend stands right in front of him, so straight ahead runs into him: go around, away from his side.
    const toward = angles[0] > 0 ? 'fl' : 'fr', away = angles[0] > 0 ? ['fr', 'right'] : ['fl', 'left'];
    if (g['drib:fwd'] === 'good' || g['push:fwd'] === 'good' || (g['push:fwd'] !== 'safe' && g['drib:fwd'] !== 'safe')) return null;
    const opens = away.flatMap(d => ['push:' + d, 'drib:' + d]).filter(o => g[o] === 'good');
    if (!opens.length || g['pass:0'] === 'good' && !opens.some(o => o.startsWith('push:'))) return null;
    const pushes = opens.filter(o => o.startsWith('push:')).sort((a, b) => pushEnd(P(heroTo), b.slice(5)).x - pushEnd(P(heroTo), a.slice(5)).x);
    best = pushes[0] || opens[0];
    return { ...sc, best, ok: opens.filter(o => o !== best), safe: ['push:fwd', 'drib:fwd', 'push:' + toward, 'drib:' + toward, 'pass:0', 'pass:1'].filter(o => g[o] === 'safe' || g[o] === 'good'),
      cue: 'Run where nobody is!' };
  } else if (pattern === 'space-near') {
    if (g['push:fwd'] !== 'bad' || g['pass:0'] !== 'bad' || g['pass:1'] !== 'bad') return null;
    const smalls = goods.filter(o => o.startsWith('drib:') && o !== 'drib:fwd');
    if (!smalls.length) return null;
    best = smalls[0]; cue = 'A defender was waiting! Keep it close and go around him.';
    return { ...sc, best, ok: smalls.slice(1), cue };
  }
  return { ...sc, best, ok: goods.filter(o => o !== best), safe, cue };
}

// ---------- defending patterns ----------
// How the attackers would beat our defense if he stood at `spot`: the carrier runs at goal through an open lane,
// or passes to an attacker who is unmarked with an open lane to him and an open run at goal. null = no way through.
const shotSpot = a => [4.5, a[1] + (W / 2 - a[1]) * .6];
export function exploit(sc, spotId) {
  const sp = sc.spots.find(s => s.id === spotId), defs = [[sp.x, sp.y], ...sc.mates].map(P), c = sc.oppsTo[0];
  // Only defenders goal-side of an attacker (between him and our goal) can stop him; one standing behind him can't.
  const goalSideOf = (d, a) => (d.x - a[0]) * (OUR_GOAL.x - a[0]) + (d.y - a[1]) * (OUR_GOAL.y - a[1]) > 0;
  const shotOpen = a => { const f = P(shotSpot(a)), aim = { x: -.7, y: clamp(f.y, PITCH.gy0 + .8, PITCH.gy1 - .8) }; return defs.every(d => closestOnLane(d, f, aim, 0).d > 1); };
  const runClear = a => shotOpen(a) && defs.filter(d => goalSideOf(d, a)).every(d => closestOnLane(d, P(a), P(shotSpot(a)), 0).d > 1.3);
  const id = i => sc.oppIds?.[i] || 'o' + (i + 1); // live play: the carrier isn't always o1
  if (runClear(c)) return { kind: 'dribble', who: id(0), to: shotSpot(c) };
  for (let i = 1; i < sc.oppsTo.length; i++) {
    const a = sc.oppsTo[i], lane = Math.min(...defs.map(d => closestOnLane(d, P(c), P(a), .15).d));
    const mark = Math.min(99, ...defs.filter(d => goalSideOf(d, a)).map(d => dist(d, P(a))));
    if (lane > 1.1 && mark > 1.6 && runClear(a)) return { kind: 'pass', who: id(i), to: shotSpot(a) };
  }
  return null;
}
// We defend the goal at x = 0. o1 has the ball; the child plays `hero`, choosing a spot to run to.
function defense(r, pattern, runs = 3) {
  const c = [12 + r() * 7, 5 + dW() + r() * 10], sgn = c[1] < W / 2 ? 1 : -1;
  const mates = [], opps = [c], oppsTo = [c], spots = [];
  let hero, best, cue;
  const addOpp = p => { opps.push([p[0] + 1.5, p[1]]); oppsTo.push(p); };
  if (pattern === 'goal-side') {
    // We just lost the ball. Both friends are already guarding an attacker each; nobody is in front of the ball.
    hero = [c[0] + 3.5 + r() * 1.5, c[1] - sgn * (1 + r() * 2)];             // he got caught behind the ball
    const o2 = [c[0] - 3 - r() * 3, sgn > 0 ? 16.5 + 2 * dW() + r() * 2 : 1.5 + r() * 2], o3 = [c[0] - 1 - r() * 3, sgn > 0 ? 1.5 + r() * 2 : 16.5 + 2 * dW() + r() * 2];
    addOpp(o2); addOpp(o3);
    mates.push(goalSide(o2, 1.1), goalSide(o3, 1.1));
    const dbl = goalSide(o2, .9);
    spots.push({ id: 'home', p: goalSide(c, 3.4), label: 'In front' }, { id: 'chase', p: [c[0] + 1.3, c[1]], label: 'Behind him' }, { id: 'o2', p: [dbl[0] + .3, dbl[1] - sgn * 1.4], label: 'Help guard' });
    best = 'home'; cue = 'Nobody was on the ball, so you go! Get in front of it.';
  } else if (pattern === 'gs-covered') {
    // Contrast round: a friend is already in front of the ball, so the open attacker is his job.
    hero = [c[0] + 3 + r() * 1.5, c[1] - sgn * (1 + r() * 2)];
    c[1] = clamp(c[1], 7 + dW(), 13 + dW());
    const o2 = [c[0] - 1.5 - r() * 1.5, c[1] - sgn * (4.5 + r())], o3 = [c[0] - 1 - r() * 3, sgn > 0 ? 16.5 + 2 * dW() + r() * 2 : 1.5 + r() * 2];
    addOpp(o2); addOpp(o3);
    mates.push(goalSide(c, 1.1), goalSide(o3, 1.1));
    const inFront = goalSide(c, 3.4);
    spots.push({ id: 'home', p: [inFront[0], inFront[1] + sgn * 1.2], label: 'In front' }, { id: 'chase', p: [c[0] + 1.3, c[1]], label: 'Behind him' }, { id: 'o2', p: goalSide(o2, 1.2), label: 'Guard' });
    best = 'o2'; cue = 'A friend was already in front of the ball. Guard the open player!';
  } else if (pattern === 'one-goes' || pattern === 'you-go') {
    // The open attacker (o2) sits on the far side from where a pressing friend would stand, so the pass to him is really open.
    const side = sgn;
    if (pattern === 'one-goes') c[1] = clamp(c[1], 7 + dW(), 13 + dW());
    // one-goes: o2 stands wide, level with the ball, so the pass to him goes around the friend who is pressing.
    const o2 = pattern === 'one-goes' ? [c[0] - 1 - r() * 2.5, c[1] + side * (5 + r() * 2)] : [c[0] - 3 - r() * 3, c[1] + side * (3.5 + r() * 2.5)];
    const o3 = [c[0] + 1 + r() * 3, c[1] - side * (4 + r() * 2)];
    addOpp(o2); addOpp(o3);
    if (pattern === 'one-goes') {
      mates.push(goalSide(c, 1.1), goalSide(o3, 1.1));                       // a friend is already on the ball
      hero = [c[0] - 3 - r() * 2, c[1] - sgn * (1 + r() * 2)];
      best = 'o2'; cue = 'A friend was chasing the ball. You guard the open player!';
    } else {
      mates.push(goalSide(o2, 1.1), goalSide(o3, 1.1));                      // everyone is marking; nobody is on the ball
      hero = [c[0] - 2.5 - r() * 1.5, c[1] - sgn * (.5 + r())];
      best = 'press'; cue = 'Nobody was on the ball and you were closest. Go get it!';
    }
    const press = goalSide(c, 1.1);
    spots.push({ id: 'press', p: pattern === 'one-goes' ? [press[0] - .3, press[1] - side * .9] : press, label: 'Chase the ball' },
      { id: 'o2', p: goalSide(o2, 1.2), label: 'Guard' }, { id: 'o3', p: pattern === 'one-goes' ? [goalSide(o3, 1.2)[0], goalSide(o3, 1.2)[1] + .8] : goalSide(o3, 1.2), label: 'Guard' });
  } else if (pattern === 'mark-free') {
    const o2 = [c[0] - 2 - r() * 3, c[1] - sgn * (4 + r() * 2)], o3 = [c[0] - 4 - r() * 3, c[1] + sgn * (5 + r() * 2)];
    addOpp(o2); addOpp(o3);
    mates.push(goalSide(c, 1.1), goalSide(o2, 1.1));
    // Half the time he got caught up the field (the free attacker is behind him: turn and find him); half the
    // time he is hanging around near goal without a player (the free attacker is in front of him).
    hero = r() < .5 ? [o3[0] + 2 + r() * 2, o3[1] - sgn * (2 + r() * 2)] : [Math.max(3, o3[0] - 2.5 - r() * 2), W / 2 + (r() - .5) * 3];
    const dbl = goalSide(o2, .9);
    spots.push({ id: 'o3', p: goalSide(o3, 1.3), label: 'Guard' }, { id: 'o2', p: [dbl[0] + .3, dbl[1] + sgn * 1.4], label: 'Help guard' }, { id: 'press', p: [goalSide(c, 1.1)[0] - .3, goalSide(c, 1.1)[1] - sgn * .9], label: 'Chase the ball' });
    best = 'o3'; cue = 'A friend was on the ball. Nobody was guarding him — you guard him!';
  }
  // Level 2 (v64): one more place, back toward our goal on the ball's line, farther back than "In front". Graded by what
  // the attackers can do: no way through, it is okay (he got back, but far from the ball); a way through, it is bad.
  if (runs >= 4) {
    const u = unit(c, OUR_GOAL_PT()), k = 5.8 + r() * 1.4, p = [c[0] + u[0] * k, c[1] + u[1] * k];
    if (Math.hypot(p[0] - hero[0], p[1] - hero[1]) > 11.5) return null; // (close enough for his player to stay big on screen)
    spots.push({ id: 'deep', p, label: 'Back to goal' });
  }
  const all = [...opps, ...oppsTo, ...mates, hero, ...spots.map(s => s.p)];
  if (!all.every(p => inPitch(p, 1))) return null;
  if (spots.some((s, i) => spots.some((t, j) => j > i && Math.hypot(s.p[0] - t.p[0], s.p[1] - t.p[1]) < 2))) return null; // spots must be clearly apart
  const sc = { kind: 'defense', carrier: 'o1', hero: [hero[0] + 1.2, hero[1]], heroTo: hero, mates, opps, oppsTo,
    spots: spots.map(s => ({ id: s.id, x: s.p[0], y: s.p[1], label: s.label })), best: 'spot:' + best, ok: [], cue };
  // The right spot must leave no way through, and every wrong spot must leave a real one (no magic goals).
  sc.exploits = Object.fromEntries(sc.spots.map(s => [s.id, exploit(sc, s.id)]));
  if (sc.exploits[best] || sc.spots.some(s => s.id !== best && s.id !== 'deep' && !sc.exploits[s.id])) return null;
  const deep = sc.spots.find(s => s.id === 'deep');
  if (deep && !sc.exploits.deep) { deep.why = 'deep'; sc.safe = ['spot:deep']; }
  return sc;
}

// ---------- getting open (his team has the ball, a friend is carrying it) ----------
// m1 has the ball with a defender right in front of him, so he needs a pass. The child (hero) has no ball and
// picks where to run. Right spot: a clear path for the pass and no defender near. Wrong spots: hiding behind a
// defender (the pass gets cut out) or running next to the ball (his defender follows and they trap both).
export const laneClear = (from, to, opps) => opps.every(o => closestOnLane(P(o), P(from), P(to), .1).d > 1.3 && dist(P(o), P(to)) > 2.2);
const laneRoom = (from, to, opps) => Math.min(...opps.map(o => closestOnLane(P(o), P(from), P(to), .1).d));
export const laneBlocked = (from, to, opps) => opps.some(o => closestOnLane(P(o), P(from), P(to), .1).d < .7);
// ---------- more places to run (v60) ----------
// Besides the one best place, he gets other real places to run: 4–10 m from him, on the pitch and out of the far
// corners, apart from every other ring. Each is graded by what a pass there does, for a reason a coach would give:
// okay (2 stars: the pass reaches him, but) going backwards ('back'), level and far from the goal ('wide'), with a
// defender close ('pressure'), or along a narrow path past a defender ('narrow'); or bad: hidden behind a defender,
// so the pass is cut out ('hidden'). A place as good as the best one is never added. `goal`: a run to the goal, where
// only a run ahead of the ball and in front of the goal is best. `okay`, `bad`: how many of each; `left`: how many of
// either (picked at random). Returns the new spots ({ id, p, why }) or null if there are not enough.
export const OKAY = {
  back: 'You got the ball! Even better: find space up the field, nearer the goal.',
  wide: 'You got the ball, but far from the goal. Even better: run toward the goal!',
  pressure: 'You got the ball, but a defender was close. Even better: find space away from him.',
  narrow: 'You got the ball, but the pass went close to a defender. Even better: find a wide open path.',
  late: 'You got there, but just in time. Even better: run straight in!',
  deep: 'You got back to the goal! Even better: stop him farther out.', // (v64) defending, Level 2: back by our goal
  toofar: 'You were free, but far. Even better: come a bit closer!',            // (v64) restarts: free, but a long pass
  middle: 'You got the ball, but by our goal. Even better: go wide!',           // (v64) restarts: in the middle in front of our goal
};
// Why a run lost the ball, said on the card (v64: only the runs that need more than "He could not pass to you!").
export const BAD = {
  inway: 'You got in his way!',             // across the front of a friend who is dribbling
  close: 'Too close! Give him room.',       // standing right beside him
  behind: 'He was in the way of the pass!', // (restarts) behind one of theirs
  among: 'They were all waiting there!',    // (restarts) up among their players
  same: 'You were both in one place!',      // (restarts) on top of a friend who was already there
  crowd: "Don't crowd your friend!",        // (restarts) running to the ball
  near: 'He was guarding that side!',       // (the keeper's ball) wide, but on the side their player is
  keeper: 'A defender was right there!',   // (the keeper's ball) in front of our keeper, by one of theirs
};
export const RING_GAP = 2.5; // meters between two rings, at least
// `best`: where the best spot is. So that the best one is not always the farthest ring (or the one nearest the goal),
// the first one picked is, more often than not, farther from him than it (or, running to the goal, nearer the goal).
export function moreSpots(r, { c, h, opps, mates = [], have, okay = 0, bad = 0, either = 0, goal = false, kind: own = null, best = null, badFirst = false, skip = null, farLean = null }) {
  const found = { okay: [], bad: [] }, a0 = r() * Math.PI / 8;
  // (Kept to 8.2 m, and running to the goal never more than 2.5 m back, so a round's rings stay close enough together to
  // be seen with his player big on screen.)
  for (let a = 0; a < 16; a++) for (const d of [3.6, 4.4, 5.6, 6.8, 8.2]) {
    const p = [h[0] + Math.cos(a0 + a * Math.PI / 8) * d, h[1] + Math.sin(a0 + a * Math.PI / 8) * d];
    if (skip?.(p)) continue; // (v64: a place the scene rules out, see support 'crowd')
    if (!inPitch(p, 1.8) || p[0] < 3 || (p[0] > L - 4 && Math.abs(p[1] - W / 2) > 5.5) || (goal && p[0] < h[0] - 2.5)) continue; // not in a far corner, not back by our goal
    if (mates.some(m => Math.hypot(m[0] - p[0], m[1] - p[1]) < 1.6) || [...opps, ...mates].some(o => closestOnLane(P(o), P(h), P(p), .1).d < 1)) continue; // nobody on it or in the way of his run
    const lane = laneRoom(c, p, opps), mark = Math.min(...opps.map(o => Math.hypot(o[0] - p[0], o[1] - p[1]))), dc = Math.hypot(p[0] - c[0], p[1] - c[1]);
    if (dc < 3.2 || dc > 11) continue;
    const ahead = goal ? p[0] > c[0] + 2 && Math.abs(p[1] - W / 2) < 6.5 : p[0] >= c[0] - .5, behind = goal ? p[0] < c[0] + .5 : p[0] < c[0] - 2, open = mark > 2.8;
    const why = own ? own(p) : lane < .6 && mark > 1.4 ? 'hidden' : lane >= 1.5 && open && behind ? (goal ? 'wide' : 'back')
      : lane >= 1.5 && mark >= 1.5 && mark <= 2 && ahead ? 'pressure' : lane >= 1 && lane <= 1.2 && open && ahead ? 'narrow' : null;
    if (why) found[why === 'hidden' || why === 'slow' ? 'bad' : 'okay'].push({ p, why });
  }
  const out = [], free = q => [...have, ...out.map(x => x.p)].every(t => Math.hypot(t[0] - q.p[0], t[1] - q.p[1]) >= RING_GAP);
  // (Each pick leans one way, by chance: farther than the best one, or nearer him; and toward the goal more often than not.)
  const db = best && Math.hypot(best[0] - h[0], best[1] - h[1]), up = best && r() < (goal ? .7 : .45);
  const lean = () => { const u = r(); return u < (farLean ?? (goal ? .6 : .3)) ? 'far' : u < .95 ? 'near' : null; }, leans = Array.from({ length: okay + bad + either }, lean);
  const liked = q => { const w = best && leans[out.length], d = Math.hypot(q.p[0] - h[0], q.p[1] - h[1]); return !best || ((w !== 'far' || d > db + .6) && (w !== 'near' || d < db - .6) && (out.length || !up || q.p[0] > best[0] + .5)); };
  const take = list => { const l = shuffle(list, r); for (const q of [...l.filter(liked), ...l]) if (free(q)) { out.push(q); return true; } return false; };
  if (badFirst) for (let i = 0; i < bad; i++) if (!take(found.bad)) return null;
  for (let i = 0; i < okay; i++) if (!take(found.okay)) return null;
  if (!badFirst) for (let i = 0; i < bad; i++) if (!take(found.bad)) return null;
  for (let i = 0; i < either; i++) if (!take(r() < .5 ? found.okay : found.bad) && !take([...found.okay, ...found.bad])) return null;
  return out.map((q, i) => ({ id: 'run' + (i + 1), p: q.p, why: q.why }));
}

function support(r, pattern, runs = 3) {
  const c = [8 + r() * 8, 6 + dW() + r() * 8]; let side = c[1] < W / 2 ? 1 : -1; // the open side of the pitch
  let o1 = [c[0] + 1.5, c[1] - side * (.5 + r() * .3)];                   // presser in front of the carrier (forward passes are blocked)
  const at = (ang, d) => { const [dx, dy] = rot(d, 0, ang); return [c[0] + dx, c[1] + dy]; };
  const perp = (a, b, k) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [b[0] - dy / l * k, b[1] + dx / l * k]; };
  let hero, o2, spots, best, cue, start = null;
  const m2 = at(-side * (.25 + r() * .35), 9 + r() * 2), o3 = goalSideOf(m2, 1.1);   // the other friend is up the field, marked
  if (pattern === 'shadow') {                     // he's standing right behind a defender: move out of the shadow
    hero = at(side * (.8 + r() * .5), 6.5 + r() * 1.5);
    o2 = [lerp(c[0], hero[0], .62) + (r() - .5) * .3, lerp(c[1], hero[1], .62) + (r() - .5) * .3];
    const k = 3.8 + r() * 3.6, a1 = perp(c, hero, k), a2 = perp(c, hero, -k);
    const space = laneRoom(c, a1, [o1, o2]) > laneRoom(c, a2, [o1, o2]) ? a1 : a2;   // step out to the side with the clearer path
    spots = [{ id: 'space', p: space }, { id: 'stay', p: hero }, { id: 'ball', p: [c[0] - .6, c[1] + side * 1.6] }];
    best = 'space'; cue = 'A defender was between you and the ball. Move to open space so {m0} can pass!';
  } else if (pattern === 'spread') {              // he's crowding the ball: spread out into space
    hero = [c[0] - .4, c[1] + side * 2.2];
    o2 = [hero[0] - 1, hero[1] - side * .2];
    spots = [{ id: 'space', p: at(side * (.35 + r() * 1.05), 5.2 + r() * 4) }, { id: 'stay', p: hero }, { id: 'hide', p: hero }];
    { const u = unit(c, o1), k = 2.6 + r() * 1.4; spots[2].p = [o1[0] + u[0] * k, o1[1] + u[1] * k]; } // hiding behind the defender in front of the ball
    best = 'space'; cue = 'Give {m0} room! Find open space.';
  } else if (pattern === 'crowd') {               // (v64) "Don't crowd your friend": a friend dribbles up, and he has come right up beside him
    if (r() < .4) side = -side;                    // (beside him on either side: the space he goes to is on his side)
    o1 = [c[0] + 3 + r() * .8, c[1] - side * (.3 + r() * .5)];          // their player coming to meet the dribble, not on him yet
    hero = [c[0] - .3 - r() * .7, c[1] + side * (1.8 + r() * .4)];      // two metres beside him: one defender can get them both
    o2 = [hero[0] - 2 - r() * .6, hero[1] + side * (.4 + r() * .4)]; // his own defender, who followed him over (a step or two behind)
    spots = [{ id: 'space', p: at(side * (.5 + r() * .9), 4 + r() * 2) }, { id: 'stay', p: hero, why: 'close' },
      { id: 'ball', p: [c[0] + 1.3 + r() * .3, c[1] - side * (1.2 + r() * .3)], why: 'inway' }]; // across the front of his dribble
    start = { m1: [c[0] - 3.4, c[1] + (r() - .5) * .6], hero: [hero[0] - 1.8, hero[1] + side * 1.2], o1: [o1[0] + 1.6, o1[1]], o2: [o2[0] - 1.6, o2[1] + side * .9] };
    best = 'space'; cue = '{m0} was dribbling. Move away to open space, so he can pass to you!';
  } else {                                        // 'stay-open': he's already open, so stay and be ready
    hero = at(side * (1 + r() * .45), 6.5 + r() * 1.5);
    o2 = [hero[0] - 2.5 - r(), hero[1] - side * (3 + r())];
    spots = [{ id: 'stay', p: hero }, { id: 'ball', p: [c[0] - .6, c[1] + side * 1.6] }, { id: 'hide', p: [o2[0] + (o2[0] - c[0]) * .3, o2[1] + (o2[1] - c[1]) * .3] }];
    best = 'stay'; cue = 'You were already open. Stay there and get ready for the pass!';
  }
  const opps = [o1, o2, o3], all = [c, o1, o2, o3, m2, hero, ...spots.map(s => s.p)];
  if (!all.every(p => inPitch(p, 1))) return null;
  if (!apart(spots, RING_GAP)) return null;
  // The right spot must have a clear pass; every wrong one must be blocked, or right next to the ball.
  const ok = sp => laneClear(c, sp.p, opps), crowd = sp => Math.hypot(sp.p[0] - c[0], sp.p[1] - c[1]) < 2.6;
  if (!ok(spots.find(s => s.id === best))) return null;
  for (const s2 of spots) if (s2.id !== best && !crowd(s2) && (ok(s2) || !laneBlocked(c, s2.p, opps))) return null;
  if (spots.find(s => s.id === best).p[0] < c[0] - 1) return null;   // open space ahead or level, not behind
  // Every place to run is a real run: 3.4–8.6 m from him (kept close, so his player can be big on screen). Then the other places (3 to run to at Level 1, 4 after).
  if (spots.some(s => s.id !== 'stay' && !(Math.hypot(s.p[0] - hero[0], s.p[1] - hero[1]) >= 3.4 && Math.hypot(s.p[0] - hero[0], s.p[1] - hero[1]) <= 8.6))) return null;
  const base = spots.filter(s => s.id !== 'stay').length, n = runs - base, wrong = spots.filter(s => s.id !== 'stay' && s.id !== best).length; // (at most two bad runs)
  // (crowd: his defender follows him close behind, so no place where the pass would go past him on the way)
  const skip = pattern === 'crowd' ? p => { const u = unit(c, p), e = [p[0] - u[0] * 1.6, p[1] - u[1] * 1.6]; return [0, .2, .4, .6, .8].some(t => closestOnLane(P([lerp(o2[0], p[0], t), lerp(o2[1], p[1], t)]), P(c), P(e), .1).d < 1.2); } : null;
  const extra = moreSpots(r, { c, h: hero, opps, mates: [c, m2], have: spots.map(s => s.p), okay: wrong >= 2 ? n : 1, either: wrong >= 2 ? 0 : Math.max(0, n - 1), best: best === 'stay' ? null : spots.find(s => s.id === best).p, skip, farLean: pattern === 'crowd' ? .2 : null });
  if (!extra) return null;
  // (crowd: the run-up shows the friend dribbling up, with him drifting over to the ball and their players coming.)
  const moving = start ? { hero: start.hero, mates: [start.m1, m2], matesTo: [c, m2], opps: [start.o1, start.o2, o3] } : { hero: [hero[0] - .8, hero[1]], mates: [c, m2], opps };
  if (start && ![start.m1, start.hero, start.o1, start.o2].every(p => inPitch(p, 1))) return null;
  return { kind: 'support', even: true, carrier: 'm1', heroTo: hero, oppsTo: opps, ...moving,
    spots: (pattern === 'crowd' ? shuffle([...spots, ...extra], r) : [...spots, ...extra]).map(s => ({ id: s.id, x: s.p[0], y: s.p[1], crowd: crowd(s), ...(s.why ? { why: s.why } : {}) })), best: 'spot:' + best, ok: [], // (crowd, v64: in no set order)
    safe: extra.filter(s => OKAY[s.why]).map(s => 'spot:' + s.id), cue };
}
// Give-and-go, step 2: he has passed to the wall friend (m1). The defender who pressed him turns to press m1 and
// now stands between them, so standing still is blocked. The run past that defender into the space ahead is open.
function giveGo(r, sc) {
  const M = sc.mates[0], H = sc.heroTo, [O1, O2, O3] = sc.oppsTo;
  const o1 = [lerp(M[0], H[0], .42), lerp(M[1], H[1], .42)], o2 = [lerp(O2[0], H[0], .45), lerp(O2[1], H[1], .45)];
  const opps = [o1, o2, O3];
  const go = [Math.max(H[0], o1[0]) + 3.6 + r() * 1.2, lerp(H[1], M[1], .25 + r() * .35)];
  const ballSpot = [M[0] - .5, M[1] + (M[1] > H[1] ? 1.5 : -1.5)];
  const spots = [{ id: 'go', p: go }, { id: 'stay', p: H }, { id: 'ball', p: ballSpot }];
  if (!spots.every(sp => inPitch(sp.p, 1)) || !inPitch(o1, 1) || !inPitch(o2, 1)) return null;
  if (spots.some((s, i) => spots.some((t, j) => j > i && Math.hypot(s.p[0] - t.p[0], s.p[1] - t.p[1]) < 2.2))) return null;
  if (!laneClear(M, go, opps) || !laneBlocked(M, H, opps) || Math.hypot(ballSpot[0] - M[0], ballSpot[1] - M[1]) > 2.5) return null;
  if (opps.some(o => dist(P(o), P(go)) < 2.4)) return null;
  return { kind: 'support', carrier: 'm1', move: { o1, o2 }, spots: spots.map(s => ({ id: s.id, x: s.p[0], y: s.p[1], crowd: s.id === 'ball' })),
    best: 'spot:go', ok: [], cue: 'Now run past him into the space, so {m0} can pass it back!',
    praise: 'Great run! You ran past him, so {m0} could pass it back!' }; // the cue asks for the run; after it, the card says what it did
}

// ---------- 1v1 defending (steal it) ----------
// He is goal-side of the attacker, who dribbles at him. Small touches keep the ball at the attacker's feet;
// after a big touch it rolls away from him, and that is the moment to steal it. Tapping too early (too far
// away) or while the ball is at his feet lets the attacker go past.
function tackle(r, pattern) {
  const hx = 8 + r() * 4, hy = 6 + dW() + r() * 8, side = hy < W / 2 ? 1 : -1;
  const c = [hx + 5.5 + r() * 1, hy + (r() - .5) * 2];
  const o2 = [hx + 3 + r() * 2, hy + side * (5.5 + r())], o3 = [hx + 6 + r() * 3, hy - side * (5 + r())];
  const opps = [c, o2, o3], mates = [goalSide(o2, 1.1), goalSide(o3, 1.1)];
  if (![...opps, ...mates, [hx, hy]].every(p => inPitch(p, 1.2))) return null;
  // Touch lengths in meters: small keeps it close; big pushes it ahead. The last touch tries to go past him.
  const touches = pattern === 'steal-big' ? [.3, 1.9, .3, 1.9, 1.6] : pattern === 'steal-fast' ? [.3, .3, 1.8, .3, 1.6] : [.3, .3, 1.9, .3, .3, 1.7];
  const speed = pattern === 'steal-fast' ? 3.6 : 3;
  return { kind: 'tackle', carrier: 'o1', hero: [hx - 1, hy], heroTo: [hx, hy], mates, opps, oppsTo: opps, touches, speed,
    passSide: pick(r, [1, -1]), best: 'tackle:good', ok: [], cue: 'Stay in front. Steal it when it rolls away!' };
}

// ---------- receiving: peek before it comes ----------
// A friend behind him (toward our goal) passes to him; the ball is on its way. In 'peek-turn' a defender is close
// behind him on one side, where he can only see him by peeking over his shoulder. The first touch should turn
// him up the field away from that defender; turning into him loses it. In 'peek-open' nobody is close behind,
// so either turn works. Facing the passer (down the field), his left is the -y side.
function receive(r, pattern, high = false) {
  const H = [high ? 17 + dL() + r() * 4 : 8 + r() * 9, 5 + dW() + r() * 10], s = pick(r, [1, -1]);
  const m1 = [H[0] - 6 - r() * 1.5, H[1] + (r() - .5) * 3];
  const o1 = pattern === 'peek-turn' ? [H[0] + 1.9 + r() * .6, H[1] + s * (1.1 + r() * .5)] : [H[0] + 8 + r() * 3, H[1] + s * (3 + r() * 2)];
  const m2 = [H[0] + 5 + r() * 3, clamp(H[1] - s * (5 + r() * 1.5), 2, W - 2)], o2 = goalSideOf(m2, 1.1), o3 = [L - 4 - r() * 3, W / 2 + (r() - .5) * 6];
  const sc = { kind: 'receive', carrier: 'm1', hero: [H[0] + .8, H[1]], heroTo: H, mates: [m1, m2], opps: [o1, o2, o3], oppsTo: [o1, o2, o3], turns: { L: 'fr', R: 'fl' } };
  if (![H, m1, m2, o1, o2, o3].every(p => inPitch(p, 1.2))) return null;
  const g = grade(sc), good = k => g['drib:' + sc.turns[k]] === 'good', bad = k => g['drib:' + sc.turns[k]] === 'bad';
  // A third choice (v64): pass it straight back to the friend who passed it ('turn:B', a tap on him). It keeps the ball, so
  // it is okay when nobody is in the way of the pass back (a defender in the way: it is cut out, bad).
  sc.back = m1[0] > 3; sc.safe = sc.back && laneClear(m1, H, sc.oppsTo) ? ['turn:B'] : []; // (not with the friend right by our own goal)
  if (pattern === 'peek-turn') {
    const away = s > 0 ? 'L' : 'R', toward = away === 'L' ? 'R' : 'L';
    if (!good(away) || !bad(toward)) return null;
    return { ...sc, best: 'turn:' + away, ok: [], cue: 'A defender was behind you! Peek first, then turn away from him.' };
  }
  if (!good('L') || !good('R')) return null;
  return { ...sc, best: 'turn:' + (s > 0 ? 'L' : 'R'), ok: ['turn:' + (s > 0 ? 'R' : 'L')], cue: 'Nobody was behind you. Peek, then turn and go!' };
}

// ---------- passing in front of a running friend (a lead pass) ----------
// m1 is running up the field into open space, and the play freezes mid-run. The child taps where the pass goes:
// in front of him, where he will be when the ball gets there ('lead', the right answer: he takes it without
// slowing down); where he is now ('feet': by the time it arrives he is past it, so he stops and comes back); or
// far ahead ('far': it runs away from him to their last defender). In 'lead' a defender chases him, so the pass
// to his feet is lost; in 'lead-free' nobody is near him, so it is kept, but he had to stop (2 stars).
export const LEAD = { pre: 1.3, kick: .2, speed: 12 }; // run-up seconds, wind-up seconds, pass speed (m/s)
// Where a pass from `h` meets a runner at `f` going `d` (unit) at `v` m/s: half a step in front of where he is
// when the ball gets there. `t` is when that is, counted from the moment he decides.
export function leadPoint(h, f, d, v) {
  let t = LEAD.kick + .5, T = null;
  for (let i = 0; i < 8; i++) {
    T = { x: f.x + d.x * (v * t + .45), y: f.y + d.y * (v * t + .45) };
    const l = dist(h, T) || 1, b = { x: h.x + (T.x - h.x) / l * .4, y: h.y + (T.y - h.y) / l * .4 }; // the ball sits just in front of him
    t = LEAD.kick + dist(b, T) / LEAD.speed;
  }
  return { ...T, t };
}
function lead(r, pattern, high = false) {
  const side = pick(r, [1, -1]), H = { x: high ? 11 + dL() + r() * 3 : 6 + r() * 5, y: clamp(W / 2 - side * r() * 4, 3, W - 3) };
  const ang = -side * (r() * .75 - .3), d = { x: Math.cos(ang), y: Math.sin(ang) };   // straight up, a little out, or in toward the middle
  const inX = side * d.y, inY = -side * d.x;                                         // sideways toward the middle (his side)
  const v = 4.8 + r() * .6, F = { x: H.x + .5 + r() * 2.5, y: H.y + side * (4.5 + r() * 3) };
  const T = leadPoint(H, F, d, v), farK = 4.5 + r() * 1.5, far = { x: T.x + d.x * farK, y: T.y + d.y * farK };
  const along = (p, k) => [p.x + d.x * k, p.y + d.y * k];
  const room = k => inPitch(along(F, k), 1); let run = 0; while (run < 14 && room(run + .5)) run += .5; // how far he can run before the edge
  if (run < dist(F, far) + 1) return null;
  const S = along(F, -v * LEAD.pre), hero = [H.x, H.y], heroTo = hero;
  const pa = -side * (.25 + r() * .5), pd = 1.9 + r() * .4, o1 = [H.x + Math.cos(pa) * pd, H.y + Math.sin(pa) * pd]; // presser, away from the runner
  const ka = 1 + r() * .6, ki = r() * .9 - .3, o3 = [far.x + d.x * ka + inX * ki, far.y + d.y * ka + inY * ki];      // their last defender, deep, just past the far spot
  const m2 = [H.x - 3.5 - r() * 2, H.y - side * (3 + r() * 2)];                                                                         // the other friend, behind on the other side
  const moves = { m1: { at: [F.x, F.y], to: along(F, run), speed: v } };
  let o2, o2s;
  if (pattern === 'lead') { // a defender runs after him, a step or two behind and inside
    const vc = 4.3 + r() * .3, back = 1.5 + r() * .7, k = .5 + r() * .5;
    o2 = [F.x - d.x * back + inX * k, F.y - d.y * back + inY * k]; o2s = [o2[0] - d.x * vc * LEAD.pre, o2[1] - d.y * vc * LEAD.pre];
    moves.o2 = { at: o2, to: [o2[0] + d.x * (run - 1), o2[1] + d.y * (run - 1)], speed: vc };
  } else { o2 = [clamp(H.x + 8 + r() * 4, 3, L - 3), W / 2 - side * (3 + r() * 3)]; o2s = o2; } // nobody near him: their other defender is across the field
  const P2 = ([x, y]) => ({ x, y }), opps = [o1, o2, o3].map(P2), spots = [{ id: 'lead', p: T }, { id: 'feet', p: F }, { id: 'far', p: far }];
  if (![S, hero, [H.x - 3, H.y], o1, o2, o2s, o3, m2, ...spots.map(s => [s.p.x, s.p.y])].every(p => inPitch(p, 1.2))) return null;
  if (T.x > L - 7 || far.x > L - 2.5) return null;                                     // not so close to goal that a shot is the answer
  // Every pass lane is clear of defenders, except the defender the play is about, and the other friend is out of the way.
  const lane = (o, s, t0 = .1) => closestOnLane(o, H, s.p, t0).d;
  if (spots.some(s => lane(opps[0], s) < 1.5 || lane(P2(m2), s, 0) < 2 || dist(P2(m2), s.p) < 2.5)) return null;
  if (lane(opps[2], spots[0]) < 2 || dist(opps[2], T) < 3.5 || lane(opps[1], spots[0]) < 1.3 || lane(opps[1], spots[2]) < 1.3) return null;
  if (spots.some((s, i) => spots.some((t, j) => j > i && dist(s.p, t.p) < 2.4))) return null;
  // Timing, with the same speeds the play uses. In front: he gets there first, clearly. Far: their last defender does.
  const reach = o => dist(o, T) / DEF_RUN + .3, tFeet = LEAD.kick + dist(H, F) / LEAD.speed;
  if (opps.some(o => reach(o) < T.t + .4)) return null;
  if (dist(opps[2], far) / DEF_RUN + .3 > dist(F, far) / v - .5) return null;
  if (pattern === 'lead' && dist(opps[1], F) / 5 + .1 > tFeet) return null;              // to his feet: the chaser gets there before the ball
  if (pattern === 'lead-free' && opps.some(o => dist(o, F) / DEF_RUN + .3 < tFeet + .8)) return null; // nobody can get to it before he comes back for it
  return { kind: 'lead', hero: [H.x - 3, H.y], heroTo, mates: [S, m2], opps: [[o1[0] + .8, o1[1]], o2s, o3], oppsTo: [o1, o2, o3], moves, dir: [d.x, d.y],
    spots: spots.map(s => ({ id: s.id, x: s.p.x, y: s.p.y })), best: 'spot:lead', ok: [], safe: pattern === 'lead-free' ? ['spot:feet'] : [],
    cue: 'Pass it in front of {m0}, where he is going!' };
}

const goalSideOf = (p, k) => { const dx = L - p[0], dy = W / 2 - p[1], l = Math.hypot(dx, dy) || 1; return [p[0] + dx / l * k, p[1] + dy / l * k]; }; // their goal is at x = L
const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
const away = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k];
const apart = (spots, k) => spots.every((s, i) => spots.every((t, j) => j <= i || Math.hypot(s.p[0] - t.p[0], s.p[1] - t.p[1]) >= k));

// ---------- shots that come back out (no keepers: off a post or a defender's leg) ----------
// A ball against a post or a leg keeps part of its speed along the surface it hits and bounces back off it with less.
export const SHOT = { speed: 17, arc: .06, out: 4, freeze: .75 }; // the shot (m/s, arc), the rebound's speed as it rolls out (m/s, mean) and how much of its roll comes before the freeze
function bounce(d, n, along, back, len, from) {
  const dn = d[0] * n[0] + d[1] * n[1], v = [(d[0] - dn * n[0]) * along - dn * n[0] * back, (d[1] - dn * n[1]) * along - dn * n[1] * back], l = Math.hypot(...v) || 1;
  return away(from, [v[0] / l, v[1] / l], len);
}
// A shot from `from` that clips the inside of a post: its line passes `b` m inside the post's centre (0: head on).
// It comes back out toward the shooter and in toward the middle. Returns where the ball touches the post and where
// the rebound comes to rest.
export function postBounce(from, gy, b, len) {
  const R = .18, post = [L, gy], d = unit(from, post), inY = Math.sign(W / 2 - gy), side = [-d[1], d[0]], k = Math.sign(side[1] * inY) || 1;
  const hit = [post[0] + side[0] * k * b - d[0] * Math.sqrt(R * R - b * b), post[1] + side[1] * k * b - d[1] * Math.sqrt(R * R - b * b)];
  const n = [(hit[0] - post[0]) / R, (hit[1] - post[1]) / R];
  return { hit, loose: bounce(d, n, .8, .45, len, hit) };
}
// A shot that a defender at `B` blocks with his leg: it glances off to one side (`sd`, +1 left of the shot) at angle
// `th` from straight back, and squirts away sideways.
export function legBounce(from, B, sd, th, len) {
  const d = unit(from, B), hit = away(B, d, -.35), c = Math.cos(th), s = Math.sin(th) * sd; // the leg faces back along the shot, turned by th
  return { hit, loose: bounce(d, [-d[0] * c + d[1] * s, -d[0] * s - d[1] * c], .7, .4, len, hit) };
}

// ---------- off the ball: run to the goal with a friend ----------
// m1 dribbles at goal with one defender in front of him; the child (hero) has no ball and picks where to run. Right:
// toward the goal on the open side, level with or ahead of the ball, so the defender has to pick one of them: he stays
// with the ball, m1 passes, and the child scores. Wrong: running to the ball (his defender comes too, and they trap
// both) or staying back (nobody to pass to, so his defender leaves him and they trap m1). 'go-far': a defender already
// stands in his straight run, so the open side is across, behind m1. 'go-shot': m1 has a clear shot. The run in is
// still right: the shot comes back off the post, and the child is there first.
function goalRun(r, pattern, runs = 3) {
  const s = pick(r, [1, -1]); // the side of m1 he is on (+y is left)
  let c, h, o1, o2, spots, best, cue, shot = null;
  if (pattern === 'go-goal') {
    c = [12 + dL() + r() * 4, W / 2 - s * (.5 + r() * 2)];
    h = [c[0] - .5 - r() * 1.8, c[1] + s * (5 + r() * 1.5)];             // level with the ball or a little behind it
    o1 = goalSideOf(c, 2.5 + r() * .5);                                  // in front of m1
    o2 = [h[0] - 2.6 - r() * 1.4, h[1] - s * (.4 + r() * .8)];          // his defender, caught behind the play
    spots = [{ id: 'goal', p: [c[0] + 2.6 + r() * 1.6, c[1] + s * (4.2 + r() * .9)] }, { id: 'ball', p: [c[0] + .3, c[1] + s * 1.6] }, { id: 'stay', p: h }];
    best = 'goal'; cue = '{m0} had the ball! Run to the goal, so he can pass to you.';
  } else if (pattern === 'go-far') {
    c = [12 + dL() + r() * 4, W / 2 + s * (r() * 1.2)];
    h = [c[0] - 1.3 - r() * 1.2, c[1] + s * (1.4 + r() * 1)];           // behind m1, on one side
    o1 = goalSideOf(c, 2.5 + r() * .5);
    o2 = [c[0] + 3 + r() * 1.6, c[1] + s * (4.3 + r() * .8)];            // already standing in his run on that side
    spots = [{ id: 'far', p: [c[0] + 2.2 + r() * 1.2, c[1] - s * (3 + r() * 1)] }, { id: 'near', p: [o2[0] + .6 + r() * .4, o2[1] + s * (r() - .3) * .6] }, { id: 'stay', p: h }]; // (he is too close to m1 for a run to the ball)
    best = 'far'; cue = 'A defender was in the way. Run to the open side, so {m0} can pass to you!';
  } else { // 'go-shot'
    c = [L - 8.6 - r() * 2, W / 2 - s * (.3 + r() * 1.5)];
    h = [c[0] - .6 - r() * 1.6, c[1] + s * (4.5 + r() * 1.2)];
    o1 = [c[0] - 1.6 - r(), c[1] - s * (1.4 + r() * .8)];               // beaten: chasing, behind him and to the side
    o2 = [L - 1.3 - r() * 1, W / 2 + s * (6 + r() * 1.5)];               // deep and wide, on the child's side
    const gy = s > 0 ? PITCH.gy1 : PITCH.gy0, ball = [c[0] + .5, c[1]]; // (the post on his side)
    shot = { by: 'm1', ...postBounce(ball, gy, r() * .05, 3.4 + r() * 1) };
    // The run in: most of the way from him to where it will come out (from there he goes on to the ball).
    const k = .58 + r() * .3, end = [shot.loose[0] - .4, shot.loose[1] + s * .3];
    spots = [{ id: 'goal', p: [lerp(h[0], end[0], k), lerp(h[1], end[1], k)] }, { id: 'stay', p: h }]; // (no crowding run here: he shoots at once)
    best = 'goal'; cue = '{m0} could shoot, but you run in too. The ball can bounce out to you!';
  }
  const m2 = [c[0] - 6 - r() * 2, clamp(c[1] - s * (3 + r() * 2), 2, W - 2)], o3 = goalSideOf(m2, 1.2), opps = [o1, o2, o3];
  if (![c, o1, o2, o3, m2, h, ...spots.map(x => x.p)].every(p => inPitch(p, 1.2)) || !apart(spots, RING_GAP)) return null;
  const sp = id => spots.find(x => x.id === id).p, B = sp(best), c2 = [c[0] + 1, c[1]];  // c2: m1 a step on, when he passes
  // The right run: nobody in his way, the pass to it open, ahead of the ball and in front of the goal, with a clear shot.
  if (opps.some(o => closestOnLane(P(o), P(h), P(B), 0).d < 1.4) || B[0] < c[0] + 2) return null;
  if (!shot && (!laneClear(c, B, opps) || !laneClear(c2, B, opps))) return null;
  const aim = [L, clamp(B[1], PITCH.gy0 + .8, PITCH.gy1 - .8)];
  if (opps.some(o => o[0] > B[0] - 1 && closestOnLane(P(o), P(B), P(aim), 0).d < 1.8)) return null;
  // Each wrong run is plainly wrong: next to the ball, behind it, or right beside a defender.
  for (const x of spots) if (x.id !== best && !(Math.hypot(x.p[0] - c[0], x.p[1] - c[1]) < 2.6 || x.p[0] < c[0] || opps.some(o => Math.hypot(o[0] - x.p[0], o[1] - x.p[1]) < 1.6))) return null;
  if (shot) {
    // m1's shot is clear, and the rebound is the child's: he set off at once, their deep defender only once it hits the post.
    const L0 = [c[0] + .5, c[1]], tHit = .2 + Math.hypot(shot.hit[0] - L0[0], shot.hit[1] - L0[1]) / SHOT.speed * 1.3;
    if ([o1, o2, o3, m2, h].some(p => closestOnLane(P(p), P(L0), P(shot.hit), .05).d < 1.2) || [o1, o2, o3, m2, h, c].some(p => closestOnLane(P(p), P(shot.hit), P(shot.loose), .1).d < 1)) return null;
    const tH = dist(P(h), P(B)) / 5.2 + dist(P(B), P(shot.loose)) / 5.2 + .1, tO = Math.min(...opps.map(o => tHit + .25 + dist(P(o), P(shot.loose)) / DEF_RUN));
    if (tO < tH + .45 || tO > tHit + 2.4 || dist(P(c), P(shot.loose)) < dist(P(o2), P(shot.loose)) + .5) return null;
    if (opps.some(o => o[0] > shot.loose[0] - .5 && closestOnLane(P(o), P(shot.loose), { x: L, y: clamp(shot.loose[1], PITCH.gy0 + .8, PITCH.gy1 - .8) }, 0).d < 1.5)) return null;
  }
  // Where the run-up starts: m1 dribbles up to the freeze, he jogs up off the ball, their defender in front of m1
  // steps up to him and the one behind him jogs after him.
  // The other places to run (v60): 3 runs at Level 1, 4 after, at least one only okay. With a shot on, okay is a run
  // that still gets there first but only just ('late'); bad, one that gets there after their defender ('slow').
  if (spots.some(x => x.id !== 'stay' && !(Math.hypot(x.p[0] - h[0], x.p[1] - h[1]) >= 3.4 && Math.hypot(x.p[0] - h[0], x.p[1] - h[1]) <= 8.6))) return null;
  let own = null;
  if (shot) {
    const L0 = [c[0] + .5, c[1]], tHit = .2 + Math.hypot(shot.hit[0] - L0[0], shot.hit[1] - L0[1]) / SHOT.speed * 1.3, lo = P(shot.loose);
    const tH = dist(P(h), P(B)) / 5.2 + dist(P(B), lo) / 5.2 + .1, tO = Math.min(...opps.map(o => tHit + .25 + dist(P(o), lo) / DEF_RUN));
    own = p => { const t = dist(P(h), P(p)) / 5.2 + dist(P(p), lo) / 5.2 + .1; return dist(P(p), lo) < 2.5 ? null : t > tH + .35 && t < tO - .25 ? 'late' : t > tO + .45 ? 'slow' : null; };
  }
  const base = spots.filter(x => x.id !== 'stay').length, n = runs - base, wrong = base - 1; // (at most two bad runs)
  const extra = shot ? moreSpots(r, { c, h, opps, mates: [c, m2], have: spots.map(x => x.p), bad: 1, okay: 1, either: n - 2, goal: true, kind: own, best: B, badFirst: true })
    : moreSpots(r, { c, h, opps, mates: [c, m2], have: spots.map(x => x.p), okay: wrong >= 2 ? n : 1, either: wrong >= 2 ? 0 : Math.max(0, n - 1), goal: true, kind: own, best: B });
  if (!extra) return null;
  spots.push(...extra);
  const start = [c[0] - RUN_UP * 2.6, c[1]], heroStart = [h[0] - 2.6, h[1]], o1s = shot ? [o1[0] - 2.4, o1[1]] : goalSideOf(o1, .8), o2s = shot ? o2 : [o2[0] - 2.6, o2[1]];
  const m2s = [m2[0] - 1.2, m2[1]], o3s = [o3[0] - 1.2, o3[1]]; // the other friend jogs up too, his defender with him
  if (![start, heroStart, o1s, o2s, m2s, o3s].every(p => inPitch(p, 1))) return null;
  return { kind: 'support', run: 'goal', even: true, carrier: 'm1', hero: heroStart, heroTo: h, mates: [start, m2s], matesTo: [c, m2], opps: [o1s, o2s, o3s], oppsTo: opps, side: s, shot,
    spots: spots.map(x => ({ id: x.id, x: x.p[0], y: x.p[1], crowd: Math.hypot(x.p[0] - c[0], x.p[1] - c[1]) < 2.6, ...(x.why ? { why: x.why } : {}) })), best: 'spot:' + best, ok: [],
    safe: extra.filter(x => OKAY[x.why]).map(x => 'spot:' + x.id), cue };
}
export const RUN_UP = 1.3; // seconds of the run-up before a "run to the goal" round freezes (m1 dribbling at goal)

// ---------- follow your shot ----------
// He shoots from 8–11 m; it hits the post or a defender's leg and comes back out, loose in front of the goal. The play
// freezes as the rebound comes to rest, and he picks where to run: in to the loose ball (right: he is there first and
// scores), stay and watch, or turn back (wrong: their defender gets there and clears it). 'follow-friend': a friend
// shot, and he still runs in.
function followShot(r, pattern, runs = 3) {
  const friend = pattern === 'follow-friend', block = pattern === 'follow-block' || (friend && r() < .35);
  const S = [L - 8.4 - r() * 2.4, W / 2 + (r() - .5) * 7];              // the ball's place as it is struck
  let B = null, hit, loose, KB = null;
  if (pattern === 'follow-keeper') { // (5v5) the keeper gets to it and it comes back out off him: he blocks more than he catches
    KB = [L - .75, clamp(S[1] + (r() - .5) * 2.4, PITCH.gy0 + .7, PITCH.gy1 - .7)];
    ({ hit, loose } = legBounce(S, KB, pick(r, [1, -1]), .15 + r() * .3, 2.8 + r() * 1.2)); // (out in front of him: off his body or his hands)
  } else if (block) {
    const d = unit(S, [L, clamp(S[1] + (r() - .5) * 2, PITCH.gy0 + .6, PITCH.gy1 - .6)]);
    B = away(S, d, 2.7 + r() * .6);
    ({ hit, loose } = legBounce(S, B, pick(r, [1, -1]), .55 + r() * .25, 2.8 + r() * 1.2));
  } else ({ hit, loose } = postBounce(S, pick(r, [PITCH.gy0, PITCH.gy1]), r() * .06, 3.3 + r() * 1.3));
  const d = unit(S, hit), body = away(S, d, -.5), follow = away(S, d, B ? .6 : 1.4);  // the shooter: where he strikes from, where his follow-through ends at the freeze (short of a blocker)
  const side = Math.sign(loose[1] - S[1]) || 1;
  // A friend shot: he is off the ball, a few meters from where it comes out, on its side (not yet running in).
  const ha = side * (.35 + r() * .6), hk = 3.4 + r() * 1.8, heroTo = friend ? [loose[0] - Math.cos(ha) * hk, loose[1] + Math.sin(ha) * hk] : follow;
  const m1 = friend ? follow : [S[0] - 4 - r() * 3, clamp(S[1] - side * (4 + r() * 3), 2, W - 2)];
  const m2 = [S[0] - 7 - r() * 3, clamp(W / 2 + (r() - .5) * 12, 2, W - 2)], o3 = goalSideOf(m2, 1.2);
  const o1 = B || [S[0] - 1.8 - r() * 1.4, S[1] + (r() - .5) * 3];       // the blocker, or the defender he beat (behind him)
  const sgn = loose[1] > W / 2 ? -1 : 1, o2 = [Math.min(L - 1.4, loose[0] - 1.2 + r() * 2), loose[1] + sgn * (4.4 + r() * 2.2)]; // covering, across the goal: he comes from the side, never through the shot
  const opps = [o1, o2, o3], mates = [m1, m2], people = [heroTo, ...mates, ...opps];
  // Turning back: the way back toward his own half with the most room (nobody near his run).
  const room = q => Math.min(...[...mates, ...opps].map(p => closestOnLane(P(p), P(heroTo), P(q), .05).d));
  const back = [0, .45, -.45].map(a => [heroTo[0] - Math.cos(a) * 3.6, heroTo[1] + Math.sin(a) * 3.6]).filter(q => inPitch(q, 1.2)).sort((a, b) => room(b) - room(a))[0];
  if (!back || room(back) < 1.8) return null;
  const spots = [{ id: 'in', p: loose }, { id: 'watch', p: heroTo }, { id: 'back', p: back }];
  if (![...people, ...spots.map(x => x.p)].every(p => inPitch(p, 1.2)) || !apart(spots, 2.4)) return null;
  if (people.some((p, i) => people.some((q, j) => j > i && Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.15))) return null; // (a marker stands 1.2 m from his man)
  if (loose[0] < L - 7 || loose[0] > L - 1.6 || loose[1] < PITCH.gy0 - 3.5 || loose[1] > PITCH.gy1 + 3.5) return null;
  // Nobody stands where the shot or the rebound goes (only the blocker, where it hits him), or on the loose ball.
  const others = people.filter(p => p !== heroTo && p !== (friend ? m1 : null) && p !== B);
  if (others.some(p => closestOnLane(P(p), P(S), P(hit), .05).d < 1.1) || [...people].some(p => p !== B && closestOnLane(P(p), P(hit), P(loose), .05).d < 1)) return null;
  if (people.some(p => Math.hypot(p[0] - loose[0], p[1] - loose[1]) < 1.6)) return null;
  if (people.some(p => p !== heroTo && [spots[0], spots[2]].some(x => closestOnLane(P(p), P(heroTo), P(x.p), .05).d < 1.2))) return null; // nobody in the way of his runs
  // The race from the freeze: he is clearly first; if he waits, a defender is there soon (the blocker is off balance).
  const dh = Math.hypot(heroTo[0] - loose[0], heroTo[1] - loose[1]), tH = dh / 5.2 + .15, tO = Math.min(...opps.map(o => dist(P(o), P(loose)) / DEF_RUN + (o === B ? .75 : .3)));
  if (dh < 3 || dh > 6.5 || tO < tH + .45 || tO > 2.3) return null;
  // Nobody in the way of the one who comes for it (or of anyone nearly as quick, as where they stand varies a little).
  for (const o of opps) if (dist(P(o), P(loose)) / DEF_RUN + (o === B ? .75 : .3) < tO + .4 && people.some(p => p !== o && closestOnLane(P(p), P(o), P(loose), .05).d < (p === heroTo ? 1.1 : 1.3))) return null;
  if (mates.some(m => Math.hypot(m[0] - loose[0], m[1] - loose[1]) < dh + 1)) return null;          // the ball is his: no friend is nearer
  if (KB && (dist(P(KB), P(loose)) / GK.speed + 1.1 < tH + .6 || resolve(P(loose), placedAim(P(loose), P(KB)), 'placed', P(KB)).gap < .3 || people.some(p => Math.hypot(p[0] - KB[0], p[1] - KB[1]) < 2))) return null; // the keeper is down: the ball and the finish are his
  const aim = { x: L, y: clamp(loose[1], PITCH.gy0 + .8, PITCH.gy1 - .8) };
  if (opps.some(o => o[0] > loose[0] - 1 && closestOnLane(P(o), P(loose), aim, 0).d < 1.6)) return null; // then a clear finish
  const by = friend ? 'm1' : 'hero', toward = (p, k) => [p[0] - d[0] * k, p[1] - d[1] * k];
  const cue = friend ? '{m0} shot! Run in too. The ball can bounce out to you!' : KB ? 'The keeper stopped it! Keep running in, and score!' : block ? 'He blocked it! Keep running in, and score!' : 'It hit the post! Keep running in, and score!';
  // Where the run-up starts. The shooter dribbles up to strike it; the others are on the move as play goes up the
  // field (the defender he beat chases from behind), and the covering defender only steps across once it comes out.
  const back1 = (p, k) => [p[0] - k, p[1]], o2s = away(o2, unit(loose, o2), 1.1), starts = [heroTo, m1, m2, o1, o2s, o3, back1(heroTo, 1.8), back1(m1, 1.6), back1(m2, 1.4), back1(o1, 2.6), back1(o3, 1.4)];
  if (!starts.every(p => inPitch(p, 1))) return null;
  // Level 2 (v64): one more place to run, on the way in but not straight at the ball. Okay if he still gets there first,
  // just in time ('late'); bad if their player gets there first ('slow'). Timed as the play goes: he runs to the place,
  // then on to the ball.
  if (runs >= 4) {
    const lo = P(loose), own = p => { const t = dist(P(heroTo), P(p)) / 5.2 + dist(P(p), lo) / 5.2 + .1; return dist(P(p), lo) < 2.5 ? null : t > tH + .25 && t < tO - .2 ? 'late' : t > tO + .45 ? 'slow' : null; };
    const more = k => moreSpots(r, { c: loose, h: heroTo, opps, mates, have: spots.map(x => x.p), [k]: 1, goal: true, kind: own, best: loose });
    const extra = more('okay') || more('bad'); // (okay if there is one)
    if (!extra) return null;
    spots.push(...extra);
  }
  return { kind: 'support', run: 'follow', carrier: by, hero: friend ? back1(heroTo, 1.8) : toward(body, 1.5), heroTo, mates: [friend ? toward(body, 1.5) : back1(m1, 1.6), back1(m2, 1.4)], matesTo: mates,
    opps: [B || back1(o1, 2.6), o2s, back1(o3, 1.4)], oppsTo: opps, shot: { by, from: body, hit, loose, block: KB ? 'k2' : B ? 'o1' : null, cover: 'o2' },
    spots: spots.map(x => ({ id: x.id, x: x.p[0], y: x.p[1], ...(x.why ? { why: x.why } : {}) })), best: 'spot:in', ok: [], ...(runs >= 4 ? { safe: spots.filter(x => OKAY[x.why]).map(x => 'spot:' + x.id) } : {}), cue, ...(KB ? { gk: { them: KB, us: [.7, W / 2], f: .3, off: .75 } } : {}) };
}

// ---------- restarts: "Our ball? Spread out!" (v64) ----------
// Our team restarts play: a friend on the side line with the ball (a pass-in or dribble-in: no throw-ins at these
// ages), the kick-off, a goal kick, or (with keepers) our keeper holding it. The ball is still, on its line, and their
// players stand off it: 3 m at 3v3 and 4v4, about 5 m (5 yd) at 5v5; at a goal kick they are back in their own half
// (the retreat line). Off the ball, he picks where to stand (rings, and staying where he is); graded from the picture:
// open space a pass can reach is best; beside the ball, behind one of theirs, up among them, or where a friend already
// is, is bad. When he takes it himself, he picks the pass or the dribble-in (grade()). See research/curriculum-plan.md.
export const RESTARTS = new Set(['side-in', 'side-take', 'side-pass', 'goal-kick', 'keeper-ball', 'side-two', 'kick-off']);
export const RESTART_LATER = new Set(['side-two', 'kick-off', 'keeper-ball']); // (Level 2 and up; Level 1: the clear, open ones)
const standOff = () => (sizeOf().keeper ? 4.6 : 3);
function restart(r, pattern, runs) {
  const K = sizeOf().keeper, off = standOff(), n = sizeOf().out;
  const s = pick(r, [1, -1]); // which way is "in from the line" (+y: the line at y = 0), or which side is ours to go to
  let c, carrier = 'm1', hero, mates = [], opps = [], spots = [], best, cue, gk = null, take = false;
  const rel = (o, a, d) => [o[0] + Math.cos(a) * d, o[1] + s * Math.sin(a) * d]; // a: 0 up the field, PI/2 straight in
  const shadow = (o, k) => { const u = unit(c, o); return [o[0] + u[0] * k, o[1] + u[1] * k]; };
  if (pattern === 'side-in' || pattern === 'side-two' || pattern === 'side-take' || pattern === 'side-pass') {
    c = [7 + dL() * .5 + r() * 9, (s > 0 ? 0 : W) + s * .3];
    take = pattern === 'side-take' || pattern === 'side-pass';
    if (take) {
      hero = c; carrier = 'hero';
      const o1 = pattern === 'side-take' ? rel(c, 1.05 + r() * .35, off + .2 + r() * .6) : [c[0] + off + .3 + r() * .6, c[1] + s * (.5 + r() * .5)]; // standing off: in from the line, or up the line in his way
      const m1 = rel(c, 1 + r() * .6, 6 + r() * 2), m2 = rel(c, 2.2 + r() * .5, 6 + r() * 2.5);
      mates = [m1, m2];
      opps = [o1, pattern === 'side-take' ? goalSideOf(m1, 1) : [m1[0] + 4 + r() * 2, m1[1] + s * (2 + r() * 2)], goalSideOf(m2, 1.1)];
      cue = pattern === 'side-take' ? 'Lots of space! Dribble it in.' : '{m0} was free. Pass it to him!';
    } else if (pattern === 'side-in') {
      hero = rel(c, 1.7 + r() * .7, 1.9 + r() * .4);                         // right beside the taker
      const o1 = rel(c, .8 + r() * .7, off + .2 + r() * .6), o2 = [c[0] + 1 + r() * 3, W / 2 + (r() - .5) * 3]; // one standing off, one in the middle
      const m2 = rel(c, .4 + r() * .4, 11 + r() * 2);
      mates = [c, m2]; opps = [o1, o2, goalSideOf(m2, 1.1)];
      spots = [{ id: 'space', p: rel(c, .35 + r() * .75, 5 + r() * 1.6) }, { id: 'stay', p: hero, why: 'close' },
        { id: 'far', p: rel(c, .12 + r() * .2, 7.8 + r() * .8), why: 'toofar' }, { id: 'behind', p: shadow(o1, 1.3 + r() * .6), why: 'behind' }];
      best = 'space'; cue = "Our ball? Spread out! Find a space where nobody's in the way.";
    } else { // side-two: a friend is already in the near space; he finds his own
      const a2 = .45 + r() * .5, m2 = rel(c, a2, 6 + r()); hero = rel(c, 1.2 + r() * .5, 3.6 + r() * .8);
      const o1 = rel(c, .9 + r() * .5, off + .2 + r() * .5), o3 = rel(m2, Math.PI / 2 + (r() - .5), 2.2 + r() * .4); // the defender who can mark that space
      mates = [c, m2]; opps = [o1, [c[0] + 9 + r() * 3, W / 2 - s * (2 + r() * 3)], o3];
      spots = [{ id: 'space', p: rel(c, 2.15 + r() * .4, 4.5 + r() * 1.5) }, { id: 'same', p: rel(m2, -Math.PI / 2 + (r() - .5), 1.6 + r() * .3), why: 'same' }, // (deeper, behind the ball: his own space)
        { id: 'ball', p: rel(c, .3 + r() * .4, 1.5 + r() * .3), why: 'crowd' }];
      best = 'space'; cue = 'Two choices for the pass! Spread out.';
    }
  } else if (pattern === 'kick-off') {
    c = [L / 2 - .4, W / 2];
    hero = [c[0] - .5 - r() * .6, W / 2 + s * (1.8 + r() * .4)];
    const o1 = [L / 2 + off + r(), W / 2 + (r() - .5) * 2], o2 = [L / 2 + 2.5 + r() * 2, W / 2 + s * (4.5 + r() * 1.5)], o3 = [L / 2 + 5 + r() * 3, W / 2 - s * (4 + r() * 2)];
    mates = [c, [c[0] - 6 - r() * 2, W / 2 - s * (5 + r() * 2)]]; opps = [o1, o2, o3];
    spots = [{ id: 'space', p: [c[0] - 1.5 - r() * 2, W / 2 + s * Math.min(W / 2 - 2, off + 2 + r() * 1.5)] }, { id: 'stay', p: hero, why: 'close' },
      { id: 'among', p: shadow(o1, -1.3 - r() * .3), why: 'among' }, { id: 'back', p: [c[0] - 5.5 - (off - 3) * .8 - r(), W / 2 + s * (1 + r() * 2)], why: 'toofar' }];
    best = 'space'; cue = 'Kick-off? Spread out wide!';
  } else if (pattern === 'goal-kick') { // a friend takes it; their team is back in its own half
    c = K ? [2.5 + r() * 2, W / 2 - s * (1.5 + r() * 1.5)] : [.4, W / 2 - s * (1 + r() * 2)];
    hero = [c[0] + 4.5 + r() * 1.5, W / 2 + (r() - .5) * 1.5];             // in the middle, in front of the taker
    const h2 = L / 2 + .6, o1 = [h2 + r() * 2, W / 2 + (r() - .5) * 4], o2 = [h2 + .5 + r() * 2, W / 2 + s * (4 + r() * 2)], o3 = [h2 + 1 + r() * 3, W / 2 - s * (4 + r() * 3)];
    mates = [c, [c[0] + 7 + r() * 3, W / 2 - s * (W / 2 - 2.5)]]; opps = [o1, o2, o3];
    const wy = W / 2 + s * Math.min(W / 2 - 2.2, 7.2);
    spots = [{ id: 'wide', p: [hero[0] - .5 + r() * 2, W / 2 + s * Math.min(W / 2 - 2.2, 5.2 + r())] }, { id: 'stay', p: hero, why: 'middle' }, { id: 'ball', p: [c[0] + 1 + r() * .5, c[1] + s * (1.7 + r() * .3)], why: 'crowd' },
      { id: 'far', p: [hero[0] + 5 + r() * 1.2, W / 2 - s * (1 + r() * 1.5)], why: 'toofar' }];
    // (No place up among their players here: they are back past halfway, too far for his player to stay big on screen.)
    best = 'wide'; cue = 'Wide and free! Get the ball and go.';
  } else if (pattern === 'keeper-ball') { // (with keepers) our keeper has it in his hands after a save
    if (!K) return null;
    c = [1.4, W / 2 + (r() - .5) * 2]; carrier = 'k1'; gk = { us: c, them: [L - .7, W / 2], f: .3, off: .7 };
    const o1 = [6.8 + r(), W / 2 + s * (1.2 + r())];                      // one of theirs at the edge of our area, to one side
    hero = [5.2 + r() * .8, W / 2 + (r() - .5) * 1.2];                     // in front of the keeper, in the middle
    const near = [6.5 + r() * 2, W / 2 + s * (6.5 + r())], o2 = [near[0] + 1.1 + r() * .4, near[1] - s * (.6 + r() * .4)]; // and one guarding that side
    mates = [[13 + r() * 3, W / 2 - s * (3 + r() * 3)], [14 + r() * 3, W / 2 + s * (4 + r() * 3)]];
    opps = [o1, o2, goalSideOf(mates[0], 1.1)];
    spots = [{ id: 'wide', p: [5 + r() * 2, W / 2 - s * (5.5 + r())] }, { id: 'stay', p: hero, why: 'keeper' }, { id: 'near', p: near, why: 'near' },
      { id: 'far', p: [10.5 + r(), W / 2 - s * (1 + r() * 2)], why: 'toofar' }];
    best = 'wide'; cue = "Keeper's ball? Go wide!";
  }
  if (K && !gk) gk = { us: [.7, W / 2], them: [L - .7, W / 2], f: .3, off: .7 };
  // The fourth pair (4v4, 5v5): our extra friend back on the far side, marked, out of the way of every ring and pass.
  if (n >= 4) {
    const F = take ? rel(c, 2.6 + r() * .4, 9 + r() * 2) : pattern === 'goal-kick' ? [L / 2 - .6, W / 2 - s * (W / 2 - 2.5)] : pattern === 'kick-off' ? [L / 2 - .5, W / 2 - s * (W / 2 - 2.5)] : [Math.max(3, c[0] - 2 + r() * 4), W / 2 + (pattern === 'kick-off' ? -s : s) * (W / 2 - 2.5)], A = goalSideOf(F, 1.1);
    mates.push(F); opps.push(A);
  }
  const all = [hero, ...mates, ...opps, ...spots.map(x => x.p)].filter(p => p !== c);
  if (!all.every(p => inPitch(p, 1)) || !apart(spots, RING_GAP)) return null;
  if (opps.some(o => Math.hypot(o[0] - c[0], o[1] - c[1]) < off - .05)) return null; // they stand off the ball
  if (pattern === 'goal-kick' && opps.some(o => o[0] < L / 2)) return null;           // (behind the retreat line)
  const people = [hero, ...mates, ...opps]; if (people.some((p, i) => people.some((q, j) => j > i && Math.hypot(p[0] - q[0], p[1] - q[1]) < .9))) return null;
  if (take) {
    const sc = { hero: c, heroTo: c, mates, opps, oppsTo: opps, restart: true, ...(gk ? { gk } : {}) };
    const g = grade(sc); // a dribble out over the line is no dribble: it is lost
    for (const [d, a] of Object.entries(DRIBBLE_DIRS)) if (s * Math.sin(a) < -.3) { g['drib:' + d] = 'bad'; delete g['push:' + d]; }
    if (Object.entries(g).some(([k, v]) => v === 'unclear' && k.startsWith('pass:'))) return null;
    const goods = Object.keys(g).filter(k => g[k] === 'good' && !k.startsWith('push:'));
    if (pattern === 'side-take') { if (g['drib:fwd'] !== 'good' || mates.some((_, i) => g['pass:' + i] !== 'bad')) return null; best = 'drib:fwd'; }
    else { if (g['pass:0'] !== 'good' || g['drib:fwd'] !== 'bad' || mates.slice(1).some((_, i) => g['pass:' + (i + 1)] !== 'bad')) return null; best = 'pass:0'; }
    return { ...sc, grades: g, best, ok: goods.filter(o => o !== best && !BACKWARD.has(o.slice(5))), safe: goods.filter(o => o.startsWith('drib:') && BACKWARD.has(o.slice(5))), cue };
  }
  const from = c, oo = opps, lane = sp => laneClear(from, sp.p, oo), blocked = sp => laneBlocked(from, sp.p, oo);
  const B = spots.find(x => x.id === best);
  if (!lane(B) || spots.some(x => x.id !== 'stay' && x.p !== hero && Math.hypot(x.p[0] - hero[0], x.p[1] - hero[1]) > 11.5)) return null;
  const crowdOf = x => Math.hypot(x.p[0] - c[0], x.p[1] - c[1]) < 2.6;
  for (const x of spots) {
    if (x.id === best) continue;
    if (OKAY[x.why] && !lane(x)) return null;                                 // an okay place: the pass gets there
    if (x.why === 'close' || x.why === 'crowd') { if (!crowdOf(x)) return null; }
    else if (x.why === 'keeper') { if (Math.min(...oo.map(o => Math.hypot(o[0] - x.p[0], o[1] - x.p[1]))) > 3.2) return null; } // a defender right there
    else if (!OKAY[x.why] && !blocked(x) && Math.min(...oo.map(o => Math.hypot(o[0] - x.p[0], o[1] - x.p[1]))) > 1.8) return null; // cut out on the way, or marked where he stands
  }
  if (pattern === 'side-two' && Math.hypot(B.p[0] - mates[1][0], B.p[1] - mates[1][1]) < 4.5) return null;
  // Level 2: one more place (an okay or a bad one, from the picture).
  if (runs >= 4) {
    const extra = moreSpots(r, { c, h: hero, opps, mates, have: spots.map(x => x.p), either: 1, best: B.p });
    if (extra && extra.some(x => Math.hypot(x.p[0] - hero[0], x.p[1] - hero[1]) > 7.5)) return null; // (close enough for his player to stay big)
    if (extra) spots.push(...extra); else if (spots.length < 4) return null; // (four already: fine without)
  }
  // At the keeper's ball and a goal kick (their team far off), a wrong place means the taker has nobody: he kicks it long.
  return { kind: 'support', even: true, restart: true, carrier, hero, heroTo: hero, mates, opps, oppsTo: opps, ...(gk ? { gk } : {}),
    spots: shuffle(spots, r).map(x => ({ id: x.id, x: x.p[0], y: x.p[1], crowd: crowdOf(x), ...(x.why ? { why: x.why } : {}) })), best: 'spot:' + best, ok: [],
    safe: spots.filter(x => OKAY[x.why]).map(x => 'spot:' + x.id), cue };
}

// ---------- 4v4: the fourth pair ----------
// A situation for four a side is the same situation, built the same way, with one more friend (m3) and one more of
// theirs (o4) put in where a coach would expect them in a 4v4 diamond: our extra player is the one back or out wide,
// theirs marks him, goal-side (on defense, theirs is the one who stays back, and ours stands goal-side of him). They
// stand in the picture (6–11 m from him), and away from the play: every option keeps the grade it had (a pass to the
// marked friend is graded like any pass, and loses the ball), every ring keeps its reason, and they are never the
// nearest to a ring, a lane or a loose ball. `r`: its own random numbers, so nothing else in the scene changes.
const pt = ([x, y]) => ({ x, y }), d2 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const farFrom = (p, list, k) => list.every(q => d2(p, q) >= k);
const lane = (p, a, b, t0 = 0) => closestOnLane(pt(p), pt(a), pt(b), t0).d;
const nearest = (list, q) => Math.min(...list.map(p => d2(p, q)));
const sp2 = sc => (sc.spots || []).map(s => [s.x, s.y]);
// Our extra player and his marker (theirs, goal-side of him toward x = L), with the marker's run-up start.
const marked = (r, F) => { const A = goalSideOf(F, 1 + r() * .25); return { F, A }; };
// Attacking scenes in which their whole team is behind him (or he is about to shoot): our extra pair is behind too.
const BEHIND = new Set(['space-behind', 'counter', 'counter-shot', 'counter-pass', 'shot-open', 'shot-blocked', 'shot-far', 'space-far', 'space-friend', 'space-near']); // (and the space lessons: the grass ahead is his)
function extraAttack(r, sc) {
  const H = sc.heroTo, pat = sc.pattern, back = BEHIND.has(pat) || r() < .5;
  const a = back ? Math.PI * (.62 + r() * .76) * pick(r, [1, -1]) : (r() - .5) * 2 * Math.PI, k = 6 + r() * 5;
  const { F, A } = marked(r, [H[0] + Math.cos(a) * k, H[1] + Math.sin(a) * k]);
  const all = [H, ...sc.mates, ...sc.opps, ...sc.oppsTo];
  if (!inPitch(F, 2) || !inPitch(A, 1.5) || !farFrom(F, all, 4) || !farFrom(A, all, 3) || d2(A, H) < (pat.startsWith('trap') ? 5.5 : 4.5)) return null;
  if (pat === 'carry' && F[0] > H[0] + 1) return null;                                      // "friends only to the side or behind"
  if (BEHIND.has(pat) && (F[0] > H[0] - 2.5 || A[0] > H[0] - 1.5)) return null;              // "their team was behind you"
  const As = goalSideOf(F, 2.2), wide = { ...sc, mates: [...sc.mates, F], opps: [...sc.opps, As], oppsTo: [...sc.oppsTo, A] };
  if (!inPitch(As, 1)) return null;
  const g0 = grade(sc), g = grade(wide);
  if (g['pass:2'] !== 'bad' || Object.keys(g0).some(o => g[o] !== g0[o])) return null;
  if (sc.then) { // give-and-go, step 2: the run past him stays open, and nobody new stands near it
    const M = sc.mates[0], go = sc.then.spots.find(s => s.id === 'go'), G = [go.x, go.y];
    if (lane(A, M, G, .1) < 2.5 || d2(A, G) < 3.5 || d2(F, G) < 3.5 || lane(F, M, G) < 1.5) return null;
  }
  return wide;
}
function extraDefense(r, sc) {
  const c = sc.oppsTo[0], A = [c[0] + 4 + r() * 4, 2 + r() * (W - 4)], M = goalSide(A, 1 + r() * .3), h = sc.heroTo;
  const all = [h, ...sc.mates, ...sc.oppsTo, ...sc.opps, ...sp2(sc)];
  if (!inPitch(A, 1.5) || !inPitch(M, 1.5) || !farFrom(A, all, 4) || !farFrom(M, all, 3.5)) return null;
  if (sc.pattern === 'you-go' && d2(M, c) < d2(h, c) + 1.5) return null; // he is still the closest to the ball
  const wide = { ...sc, mates: [...sc.mates, M], opps: [...sc.opps, [A[0] + 1.5, A[1]]], oppsTo: [...sc.oppsTo, A] };
  if (!inPitch(wide.opps.at(-1), 1)) return null;
  const same = (p, q) => (!p && !q) || (p && q && p.kind === q.kind && p.who === q.who);
  const exploits = Object.fromEntries(sc.spots.map(s => [s.id, exploit(wide, s.id)]));
  return sc.spots.every(s => same(exploits[s.id], sc.exploits[s.id])) ? { ...wide, exploits } : null;
}
function extraTackle(r, sc) {
  const c = sc.oppsTo[0], A = [c[0] + 4 + r() * 3.5, 2 + r() * (W - 4)], M = goalSide(A, 1.1 + r() * .2);
  const all = [sc.heroTo, ...sc.mates, ...sc.oppsTo];
  if (!inPitch(A, 1.5) || !inPitch(M, 1.5) || !farFrom(A, all, 4) || !farFrom(M, all, 3.5)) return null;
  return { ...sc, mates: [...sc.mates, M], opps: [...sc.opps, A], oppsTo: [...sc.oppsTo, A] };
}
// Rings, lanes and runs a pair must stay clear of, so every ring keeps its reason (generate.js moreSpots) and its result.
function clearOfRings(sc, F, A, from, h, opps) {
  for (const s of sp2(sc)) {
    if (d2(A, s) < 3.5 || d2(F, s) < 3 || d2(A, s) < nearest(opps, s) + 1) return false;  // never the nearest of theirs to a ring
    for (const c of from) if (lane(A, c, s, .1) < 2.5 || lane(F, c, s, .1) < 1.5) return false; // nor near the pass to it
    if (d2(s, h) > .5 && (lane(A, h, s) < 1.6 || lane(F, h, s) < 1.6)) return false;            // nor in the way of his run
  }
  return true;
}
function extraSupport(r, sc) {
  const c = (sc.matesTo || sc.mates)[0], h = sc.heroTo, side = c[1] < W / 2 ? 1 : -1;
  const { F, A } = marked(r, [c[0] - 4 - r() * 4.5, c[1] - side * (1 + r() * 6)]);
  const all = [c, h, ...sc.mates, ...sc.oppsTo, ...sp2(sc)];
  if (!inPitch(F, 2) || !inPitch(A, 1.5) || !farFrom(F, all, 4) || !farFrom(A, all, 3) || !clearOfRings(sc, F, A, [c], h, sc.oppsTo)) return null;
  return { ...sc, mates: [...sc.mates, F], ...(sc.matesTo ? { matesTo: [...sc.matesTo, F] } : {}), opps: [...sc.opps, A], oppsTo: [...sc.oppsTo, A] };
}
function extraGoalRun(r, sc) {
  const [c, m2] = sc.matesTo, h = sc.heroTo, s = sc.side;
  const { F, A } = marked(r, [c[0] - 1 - r() * 4.5, c[1] - s * (5 + r() * 3.5)]);
  const all = [c, h, m2, ...sc.oppsTo, ...sp2(sc)];
  if (!inPitch(F, 2) || !inPitch(A, 1.5) || !farFrom(F, all, 4) || !farFrom(A, all, 3) || !clearOfRings(sc, F, A, [c, [c[0] + 1, c[1]]], h, sc.oppsTo)) return null;
  const B = sc.spots.find(x => 'spot:' + x.id === sc.best), aim = [L, clamp(B.y, PITCH.gy0 + .8, PITCH.gy1 - .8)];
  if (lane(A, [B.x, B.y], aim) < 2.5) return null;                                          // his finish stays clear
  if (sc.shot) {
    const { hit, loose } = sc.shot, L0 = [c[0] + .5, c[1]];
    if ([F, A].some(p => lane(p, L0, hit, .05) < 2 || lane(p, hit, loose, .1) < 2 || lane(p, loose, [L, clamp(loose[1], PITCH.gy0 + .8, PITCH.gy1 - .8)]) < 2.5)) return null;
    if (d2(A, loose) < nearest(sc.oppsTo, loose) + 3) return null;                         // their racer for the rebound stays the same
  }
  const Fs = [F[0] - 1.2, F[1]], As = [A[0] - 1.2, A[1]]; // jogging up with the play, as the other friend does
  if (!inPitch(Fs, 1) || !inPitch(As, 1)) return null;
  return { ...sc, mates: [...sc.mates, Fs], matesTo: [...sc.matesTo, F], opps: [...sc.opps, As], oppsTo: [...sc.oppsTo, A] };
}
function extraReceive(r, sc) {
  const H = sc.heroTo, m1 = sc.mates[0], m2 = sc.mates[1], s = Math.sign(m2[1] - H[1]) || 1;
  const { F, A } = marked(r, [H[0] - 3 + r() * 6, H[1] - s * (6 + r() * 3)]);
  const all = [H, ...sc.mates, ...sc.oppsTo];
  if (!inPitch(F, 2) || !inPitch(A, 1.5) || !farFrom(F, all, 4) || !farFrom(A, all, 3) || lane(F, m1, H) < 2 || lane(A, m1, H) < 2) return null;
  const wide = { ...sc, mates: [...sc.mates, F], opps: [...sc.opps, A], oppsTo: [...sc.oppsTo, A] }, g0 = grade(sc), g = grade(wide);
  if (Object.keys(g0).some(o => o.startsWith('drib:') && g[o] !== g0[o])) return null; // (his turns are dribbles; nobody passes here)
  for (const dir of Object.values(sc.turns)) { // the two of theirs nearest where each turn goes stay the same
    const e = dribbleEnd(pt(H), dir, L, W), E = [e.x, e.y], near = sc.oppsTo.map(o => d2(o, E)).sort((p, q) => p - q);
    if ((sizeOf().keeper ? d2(A, E) < Math.max(5, near[0] + 1) : d2(A, E) < near[1] + 1) || d2(F, E) < 3) return null; // (5v5: their others stand farther off on the big pitch; he is never the nearest)
  }
  return wide;
}
function extraLead(r, sc) {
  const H = sc.heroTo, [S, m2] = sc.mates, mv = sc.moves.m1, F0 = mv.at, side = Math.sign(F0[1] - H[1]) || 1;
  const { F, A } = marked(r, [H[0] - 1 + r() * 7, H[1] - side * (6 + r() * 3)]);
  const all = [H, S, F0, mv.to, m2, ...sc.opps, ...sc.oppsTo, ...sp2(sc)];
  if (!inPitch(F, 2) || !inPitch(A, 1.5) || !farFrom(F, all, 4) || !farFrom(A, all, 3)) return null;
  if ([F, A].some(p => lane(p, S, mv.to) < 2.5 || sp2(sc).some(q => lane(p, H, q, .1) < 2.5))) return null; // off his run, off every pass
  if (sc.moves.o2 && [F, A].some(p => lane(p, sc.opps[1], sc.moves.o2.to) < 2)) return null;            // and off the chaser's run
  if (sp2(sc).some(q => d2(A, q) < 6) || d2(A, F0) < nearest(sc.oppsTo, F0) + 1.5) return null;          // too far to get to any pass first
  const far = sc.spots.find(x => x.id === 'far');
  if (d2(A, [far.x, far.y]) < d2(sc.oppsTo[2], [far.x, far.y]) + 3) return null;                       // their deep defender still gets the long one
  return { ...sc, mates: [...sc.mates, F], opps: [...sc.opps, A], oppsTo: [...sc.oppsTo, A] };
}
function extraFollow(r, sc) {
  const { from, hit, loose } = sc.shot, h = sc.heroTo, m2 = sc.matesTo[1];
  const { F, A } = marked(r, [from[0] - 6 - r() * 5, 2 + r() * (W - 4)]);
  const all = [h, ...sc.matesTo, ...sc.oppsTo, loose, hit, from, ...sp2(sc)];
  if (!inPitch(F, 2) || !inPitch(A, 1.5) || !farFrom(F, all, 5) || !farFrom(A, all, 4) || Math.abs(F[1] - m2[1]) < 5) return null;
  const aim = [L, clamp(loose[1], PITCH.gy0 + .8, PITCH.gy1 - .8)];
  for (const p of [F, A]) {
    if (lane(p, from, hit) < 2 || lane(p, hit, loose) < 2 || lane(p, loose, aim) < 2.5) return null;
    if (sp2(sc).some(q => lane(p, h, q) < 2) || sc.oppsTo.some(o => lane(p, o, loose) < 2)) return null;
  }
  if (d2(A, loose) < nearest(sc.oppsTo, loose) + 3 || d2(F, loose) < d2(h, loose) + 2) return null; // the race and the ball stay his
  const Fs = [F[0] - 1.4, F[1]], As = [A[0] - 1.4, A[1]];
  if (!inPitch(Fs, 1) || !inPitch(As, 1)) return null;
  return { ...sc, mates: [...sc.mates, Fs], matesTo: [...sc.matesTo, F], opps: [...sc.opps, As], oppsTo: [...sc.oppsTo, A] };
}
// ---------- the shot as two decisions (v62): where, and which foot ----------
// "Inside or laces?" (every size): close (in the box, at an angle): the inside of the foot places it (laces fly over the
// bar); the edge of the box: the laces (the inside is slow: a defender running back clears it, or the keeper gets
// across to it); too far: get closer (shot-far). "Shoot to the space!" (5v5): close, the keeper off the middle (most
// often toward the ball's side, sometimes the other way): the big space; the keeper rushing out: go round him; a sharp
// angle with the keeper on his post and a friend free in front of the far post: pass across.
// Each scene says what every shot does (sc.shots, from shot.js with the scene's keeper and players; finishShots).
export const SHOT_PATS = new Set(['foot-close', 'foot-edge', 'aim-open', 'keeper-out', 'keeper-friend']);
function shotScene(r, pattern, runs) {
  const side = pick(r, [1, -1]); let d, a, heroTo;
  if (pattern === 'foot-close' || pattern === 'aim-open') { d = 5.3 + r() * 1.9; a = side * (pattern === 'aim-open' ? .1 + r() * .65 : .35 + r() * .5); }
  else if (pattern === 'foot-edge') { d = 9.7 + r() * 1.7; a = (r() - .5) * .6; }
  else if (pattern === 'keeper-out') { d = 8.6 + r() * 1.4; a = (r() - .5) * .6; }
  if (pattern === 'keeper-friend') heroTo = [L - 3.4 - r() * 1.6, W / 2 + side * (PITCH.gy1 - W / 2 + 2.6 + r() * 1.2)];
  else heroTo = [L - d * Math.cos(a) - .5, W / 2 + d * Math.sin(a)];
  const hy = heroTo[1], back = (k, dy) => [heroTo[0] - k, clamp(hy + dy, 2, W - 2)];
  // Friends: one behind him, one out wide on the other side, back from the play (keeper-friend: free at the far post).
  const mates = pattern === 'keeper-friend' ? [[L - 2 - r() * 1.4, W / 2 - side * (.6 + r() * 1.4)], back(6 + r() * 3, -side * (5 + r() * 3))]
    : [back(5 + r() * 3, (r() - .5) * 4), back(3 + r() * 4, -Math.sign(hy - W / 2 || 1) * (6 + r() * 3))];
  const opps = [], oppsTo = [], add = (p, s0 = null) => { oppsTo.push(p); opps.push(s0 || [p[0] - 1.5, p[1]]); };
  add(back(2.2 + r() * 1.8, (r() - .5) * 3));                         // the defender he got past, chasing from behind
  if (pattern === 'foot-edge') { // a defender running back to cover the goal, from the side
    const q = .78 + r() * .14, P = [lerp(heroTo[0] + .5, L, q), lerp(hy, W / 2, q)], n = pick(r, [1, -1]), k = 2.7 + r() * 1.1;
    const D = [P[0] - .5 - r() * .8, P[1] + n * k]; add(D, [D[0] - 3, D[1] + n * .8]);
  } else add([heroTo[0] - 4 - r() * 3, clamp(hy - Math.sign(hy - W / 2 || 1) * (4 + r() * 3), 2, W - 2)]);
  add(goalSideOf(mates[1], 1.1));                                       // marking his friend out wide
  const all = [heroTo, ...mates, ...opps, ...oppsTo];
  if (!all.every(p => inPitch(p, 1)) || heroTo[0] > L - 2.5) return null;
  // Their keeper (5v5): where this scene needs him (game/keeper.js plays him from there).
  let gk = null;
  if (sizeOf().keeper) {
    const gy = W / 2, toBall = Math.sign(hy - gy) || side, x = L - .55 - r() * .35;
    let y;
    if (pattern === 'aim-open') y = gy + (r() < .67 ? toBall : -toBall) * (.8 + r() * .5);   // off the middle: most often toward the ball's side
    else if (pattern === 'foot-close') y = gy + toBall * (.5 + r() * .5);
    else if (pattern === 'foot-edge') y = gy + (r() - .5) * .5;                          // set in the middle
    else if (pattern === 'keeper-friend') y = gy + side * (PITCH.gy1 - gy - .45);          // on his near post
    if (pattern === 'keeper-out') { const f = { x: heroTo[0] + .5, y: hy }, u = [L - f.x, gy - f.y], l = Math.hypot(...u), k = 2.4 + r() * .6; gk = { them: [f.x + u[0] / l * k, f.y + u[1] / l * k], from: [L - .6, gy + (hy - gy) * .25], out: true }; }
    else gk = { them: [x, clamp(y, PITCH.gy0 + .35, PITCH.gy1 - .35)] };
    gk.us = [.7, W / 2]; gk.f = .3; gk.off = .7;
  } else if (pattern === 'aim-open' || pattern === 'keeper-out' || pattern === 'keeper-friend') return null; // (5v5 only)
  return { hero: [heroTo[0] - 3, hy], heroTo, mates, opps, oppsTo, gk, stray: .25 + r() * .2, spill: r() < .5, shotN: pattern === 'aim-open' && runs >= 4 ? 3 : 2, shotPlan: pattern,
    friend: mates[0], best: null, ok: [], safe: [], cue: '' }; // (finishShots fills in the answer once everyone is in the scene)
}
// What each shot he can pick does in this scene, now that everyone is in it (finishShots runs after the fourth pair and
// the keepers are in): sc.shots { 'shoot:<space>:<foot>': result }, '*' the space picked for him (the biggest, for the
// right foot), and the right answer. null if the scene does not teach what its pattern is for.
function finishShots(sc) {
  const K = sc.gk?.them ? pt(sc.gk.them) : null, from = { x: sc.heroTo[0] + .5, y: sc.heroTo[1] }, defs = sc.oppsTo.map(pt), pat = sc.shotPlan;
  const res = (y, f) => resolve(from, y, f, K, { stray: sc.stray, defs, DEF_RUN }).res;
  const sp = K ? spaces(sc.shotN) : [], auto = () => bestSpaceY(from, K);
  const shots = {}, right = rightFoot(from);
  if (pat === 'aim-open' || pat === 'keeper-out' || pat === 'keeper-friend') { for (const s of sp) for (const f of ['in', 'las']) shots[`shoot:${s.id}:${f}`] = res(s.y, f); } // ("Shoot to the space!": he picks the space)
  else for (const f of ['in', 'las']) shots['shoot:*:' + f] = res(auto(right), f);                                                                                         // ("Inside or laces?": the biggest space is picked for him)
  const g = grade(sc), goods = Object.keys(g).filter(k => g[k] === 'good' && !k.startsWith('push:')), keep = goods.filter(o => o.startsWith('drib:') || o.startsWith('pass:'));
  let best, ok = [], safe = [], cue;
  if (pat === 'foot-close') {
    if (right !== 'in' || shots['shoot:*:in'] !== 'goal' || shots['shoot:*:las'] !== 'over' || g.shoot !== 'good') return null;
    best = 'shoot:*:in'; safe = keep; cue = 'Close? Inside, for control!';
  } else if (pat === 'foot-edge') {
    if (right !== 'las' || shots['shoot:*:las'] !== 'goal' || !['save', 'cleared'].includes(shots['shoot:*:in']) || g.shoot !== 'good') return null;
    best = 'shoot:*:las'; safe = keep; cue = 'From out here, laces, for power!';
  } else if (pat === 'aim-open') {
    const wins = sp.filter(s => shots[`shoot:${s.id}:in`] === 'goal');
    if (wins.length !== 1 || sp.some(s => shots[`shoot:${s.id}:las`] !== 'over') || g.shoot !== 'good' || right !== 'in') return null;
    if (sp.some(s => s !== wins[0] && shots[`shoot:${s.id}:in`] !== 'save')) return null;
    best = `shoot:${wins[0].id}:in`; safe = [`shoot:${wins[0].id}:las`, ...keep]; cue = 'Keeper in goal? Shoot to the big space!';
  } else if (pat === 'keeper-out') {
    if (Object.values(shots).some(v => v === 'goal')) return null;
    const gk = grade({ ...sc, opps: [...sc.opps, sc.gk.them], oppsTo: [...sc.oppsTo, sc.gk.them] }), cuts = ['drib:fl', 'drib:fr'].filter(o => gk[o] === 'good');
    if (cuts.length !== 1 || gk['drib:fwd'] !== 'bad') return null;
    best = cuts[0]; safe = Object.keys(gk).filter(o => (o.startsWith('drib:') || o.startsWith('pass:')) && o !== best && gk[o] !== 'bad' && !['drib:fl', 'drib:fr', 'drib:fwd'].includes(o));
    return { ...sc, shots, grades: gk, best, ok: [], safe, cue: 'The keeper came out! Go around him!' };
  } else if (pat === 'keeper-friend') {
    const fi = sc.mates.findIndex(m => m[0] === sc.friend[0] && m[1] === sc.friend[1]), pass = 'pass:' + fi; // (the friends may have swapped places)
    if (Object.values(shots).some(v => v === 'goal') || g[pass] !== 'good' || ['pass:0', 'pass:1', 'pass:2'].some(k => k !== pass && g[k] === 'good')) return null;
    if (closestOnLane(K, from, pt(sc.friend), .1).d < 1.8) return null; // the pass across goes in front of him
    best = pass; safe = keep.filter(o => o !== best); cue = `No space to shoot? {m${fi}} was free. Pass it across!`;
  }
  return { ...sc, shots, best, ok, safe, cue };
}

// ---------- 5v5: the keepers ----------
// Each goal has a keeper (sc.gk: ours at x = 0, theirs at x = L, as [x, y]; f and off: how far toward the ball's line
// and off his line he goes once play goes on, see game/keeper.js). He stands a little off his line, part of the way
// toward the ball's side, late. A scene keeps everything it had: he is never near a player or a ring, a shot that
// scores still scores (placed in the bigger space, see shot.js), a shot that hits the post goes past his reach, and a
// rebound stays the hero's.
const ballOf = sc => sc.kind === 'defense' || sc.kind === 'tackle' ? sc.oppsTo[0] : sc.run === 'follow' ? sc.shot.loose : sc.kind === 'support' ? (sc.matesTo || sc.mates)[0] : sc.heroTo;
function withKeepers(sc, r) {
  if (sc.gk?.them) return sc; // (a shot scene places its own keeper)
  const b = ballOf(sc), f = .15 + r() * .25, off = .5 + r() * .4;
  const at = (gx, out, bb) => [gx + out * off, clamp(W / 2 + (bb[1] - W / 2) * f, PITCH.gy0 + .4, PITCH.gy1 - .4)];
  const atk = sc.kind === 'defense' || sc.kind === 'tackle';
  const them = at(L, -1, atk ? [0, W / 2 + (r() - .5) * 4] : b), us = at(0, 1, atk ? b : [0, W / 2 + (r() - .5) * 4]);
  const people = [sc.heroTo, sc.hero, ...sc.mates, ...(sc.matesTo || []), ...sc.opps, ...sc.oppsTo, ...sp2(sc)];
  if (![them, us].every(k => farFrom(k, people, 2.2))) return null;
  const K = pt(them);
  if (!sc.kind) { // a dribble or a big push that keeps the ball does not end in his arms
    const g = grade(sc), h = pt(sc.heroTo);
    for (const o of Object.keys(g)) if (g[o] !== 'bad' && (o.startsWith('push:') || o.startsWith('drib:')) && dist(o.startsWith('push:') ? pushEnd(h, o.slice(5)) : dribbleEnd(h, o.slice(5), L, W), K) < 3) return null;
  }
  if (!sc.kind && grade(sc).shoot === 'good') { // his shot (one tap, placed) still goes in
    const from = { x: sc.heroTo[0] + .5, y: sc.heroTo[1] };
    if (resolve(from, placedAim(from, K), 'placed', K).gap < .3) return null;
  }
  if (sc.shot) { // a shot off the post or a leg: past his reach; the rebound and the finish stay the hero's
    const { hit, loose } = sc.shot, from = pt(sc.shot.from || [(sc.matesTo || sc.mates)[0][0] + .5, (sc.matesTo || sc.mates)[0][1]]), H = pt(hit), Lp = pt(loose);
    const c = closestOnLane(K, from, H, 0), t = Math.hypot(c.x - from.x, c.y - from.y) / 17;
    if (c.d < GK.reach + Math.max(0, t - GK.react) * GK.speed + .4 || closestOnLane(K, H, Lp, 0).d < 1.6) return null;
    const tK = dist(K, Lp) / GK.speed + .9, tH = dist(pt(sc.heroTo), Lp) / 5.2;
    if (tK < tH + .8 || resolve(Lp, placedAim(Lp, K), 'placed', K).gap < .3) return null;
  }
  return { ...sc, gk: { us, them, f, off } };
}

// Which of his three friends stands where is random (as swapMates does for two), so the open one is any of them.
const swapIx = (a, b) => o => o?.replace(new RegExp(`pass:([${a}${b}])`), (_, i) => 'pass:' + (+i === a ? b : a));
function swapMates2(sc, a, b) {
  const f = swapIx(a, b), mates = [...sc.mates]; [mates[a], mates[b]] = [mates[b], mates[a]];
  return { ...sc, mates, best: f(sc.best), ok: (sc.ok || []).map(f), safe: (sc.safe || []).map(f),
    cue: sc.cue.replace(new RegExp(`\\{m([${a}${b}])\\}`, 'g'), (_, i) => `{m${+i === a ? b : a}}`) };
}
function widen(sc, r, fixed) {
  const make = sc.kind === 'defense' ? extraDefense : sc.kind === 'tackle' ? extraTackle : sc.kind === 'receive' ? extraReceive : sc.kind === 'lead' ? extraLead
    : sc.run === 'goal' ? extraGoalRun : sc.run === 'follow' ? extraFollow : sc.kind === 'support' ? extraSupport : extraAttack;
  for (let k = 0; k < 60; k++) {
    const w = make(r, sc); if (!w) continue;
    const u = r();
    return fixed || u < 1 / 3 ? w : swapMates2(w, u < 2 / 3 ? 0 : 1, 2);
  }
  return null;
}

const PATTERNS = {
  'look-up': ['carry', 'none-open', 'carry', 'one-open', 'shot-open'],
  'shoot-close': ['shot-open', 'shot-open', 'shot-blocked', 'shot-far'],
  'see-the-trap': ['trap', 'trap', 'trap-one'],
  'take-him-on': ['trap-one', 'trap-one', 'carry', 'trap'],
  'pass-to-open': ['marked', 'marked', 'one-open', 'carry'],
  'lead-pass': ['lead', 'lead', 'lead-free'],
  'forward-first': ['forward', 'forward', 'two-open', 'carry', 'shot-open'],
  'dribble-to-space': ['space-far', 'space-near', 'space-behind', 'space-friend'],
  'get-goal-side': ['goal-side', 'you-go', 'goal-side'],
  'won-it-go': ['counter', 'counter', 'counter-pass', 'counter-shot'],
  // "One goes, one guards" (v59: "Only one bee chases" and "Guard the open player" in one lesson): both of its
  // old main situations come up as often as each other.
  'one-goes': ['one-goes', 'mark-free', 'one-goes', 'mark-free', 'you-go', 'gs-covered'],
  'give-and-go': ['give-go', 'give-go-ahead'],
  'peek-and-turn': ['peek-turn', 'peek-turn', 'peek-open'],
  'steal-it': ['steal', 'steal-fast', 'steal-big'],
  'get-open': ['shadow', 'shadow', 'spread', 'stay-open', 'crowd'], // (v64: crowd, "Don't crowd your friend")
  'go-to-goal': ['go-goal', 'go-goal', 'go-far', 'go-shot'],
  'follow-shot': ['follow-post', 'follow-block', 'follow-post', 'follow-friend'],
  'inside-laces': ['foot-close', 'foot-close', 'foot-edge', 'shot-far'],
  'shoot-space': ['aim-open', 'aim-open', 'keeper-out', 'keeper-friend'],
  'spread-out': ['side-in', 'side-take', 'goal-kick', 'side-in', 'side-pass', 'kick-off', 'side-two', 'keeper-ball'], // (v64; keeper-ball only with keepers)
};
// Half the time the two teammates trade places, so the open one isn't always the same friend.
const swap = o => o?.replace(/pass:([01])/, (_, i) => 'pass:' + (1 - i));
function swapMates(sc) {
  return { ...sc, mates: [sc.mates[1], sc.mates[0]], best: swap(sc.best), ok: (sc.ok || []).map(swap), safe: (sc.safe || []).map(swap),
    cue: sc.cue.replace(/\{m([01])\}/g, (_, i) => `{m${1 - i}}`) };
}
const DEFENSE = new Set(['goal-side', 'gs-covered', 'one-goes', 'you-go', 'mark-free']), SUPPORT = new Set(['shadow', 'spread', 'stay-open', 'crowd']), TACKLE = new Set(['steal', 'steal-fast', 'steal-big']), RECEIVE = new Set(['peek-turn', 'peek-open']), LEADS = new Set(['lead', 'lead-free']);
const GOAL_RUN = new Set(['go-goal', 'go-far', 'go-shot']), FOLLOW = new Set(['follow-post', 'follow-block', 'follow-friend', 'follow-keeper']);
export const generates = id => !!PATTERNS[id];
export const mainPattern = id => patternList(id)?.[0];
// The demo for a lesson: always its main pattern (never a contrast round), and for passes, a friend ahead or wide
// of him, never a pass back. Same scenario every time.
export function demoFor(skill) {
  const main = mainPattern(skill);
  for (let seed = 7; seed < 400; seed++) {
    const sc = generate(skill, seed);
    if (!sc || sc.pattern !== main) continue;
    if (sc.best.startsWith('pass:') && sc.mates[+sc.best[5]][0] < sc.heroTo[0] + 1) continue;
    return sc;
  }
  return generate(skill, 7);
}

// A fresh, clean scenario for a lesson. Same seed, same scenario (handy for tests). `even` gives every pattern
// the same share (Level 2 and up), instead of mostly the main one.
// `runs`: how many places to run to in a run-to round (3 at Level 1, 4 after; v60), not counting staying.
// The team size is the one being played (geom.js setSize), as the pitch is. With four a side, the fourth pair is put in
// (widen) with its own random numbers; a layout it cannot fit is dropped and the next one tried.
export function generate(skill, seed, { even = false, pattern: want = null, runs = 3 } = {}) {
  const r = rng(seed), PS = patternList(skill), pats = want ? [want] : even ? [...new Set(PS || [])] : PS;
  if (!PATTERNS[skill]) return null;
  const four = sizeOf().out >= 4;
  // Pick the pattern once, then retry only its layout, so patterns that are harder to build still come up as often.
  const first = Math.floor(r() * pats.length), high = r() < .3; // about 3 in 10 scenes happen near their goal (where it fits)
  for (let i = 0; i < 4000; i++) {
    const pattern = i < 3000 ? pats[first] : pats[Math.floor(r() * pats.length)];
    const sc = DEFENSE.has(pattern) ? defense(r, pattern, runs) : SUPPORT.has(pattern) ? support(r, pattern, runs) : TACKLE.has(pattern) ? tackle(r, pattern) : RECEIVE.has(pattern) ? receive(r, pattern, high) : LEADS.has(pattern) ? lead(r, pattern, high)
      : RESTARTS.has(pattern) ? restart(r, pattern, runs) : GOAL_RUN.has(pattern) ? goalRun(r, pattern, runs) : FOLLOW.has(pattern) ? followShot(r, pattern, runs) : SHOT_PATS.has(pattern) ? shotScene(r, pattern, runs) : attack(r, pattern, high);
    const fixed = RESTARTS.has(pattern) || DEFENSE.has(pattern) || SUPPORT.has(pattern) || TACKLE.has(pattern) || RECEIVE.has(pattern) || LEADS.has(pattern) || GOAL_RUN.has(pattern) || FOLLOW.has(pattern) || pattern === 'give-go' || pattern === 'give-go-ahead'; // give-and-go's step 2 depends on which friend is the wall; the runner is always m1
    if (!sc) continue;
    const out = { ...(fixed || r() < .5 ? sc : swapMates(sc)), id: `gen-${pattern}-${seed}`, skill, pattern };
    const done = s => (!s?.shotPlan && !(SHOT_SKILLS.has(skill) && s?.pattern === 'shot-far') ? s : s.shotPlan ? finishShots(s) : farShots(s));
    if (!four) { const f = done(out); if (f) return f; continue; }
    if (RESTARTS.has(pattern)) return { ...out, size: TEAM.size }; // (a restart puts in the whole team itself, keepers too)
    const wide = widen(out, rng(seed * 7919 + i + 1), fixed);
    if (!wide) continue;
    if (!sizeOf().keeper) { const f = done(wide); if (f) return { ...f, size: TEAM.size }; continue; }
    const kept = done(withKeepers(wide, rng(seed * 104729 + i + 3)));
    if (kept) return { ...kept, size: TEAM.size };
  }
  return null;
}
// With a keeper (5v5), "Follow your shot!" opens with a shot that comes back out off him (and keeps its other situations).
const patternList = skill => (skill === 'follow-shot' && sizeOf().keeper ? ['follow-keeper', 'follow-post', 'follow-block', 'follow-keeper', 'follow-friend'] : skill === 'spread-out' && !sizeOf().keeper ? PATTERNS[skill].filter(p => p !== 'keeper-ball') : PATTERNS[skill]);
// "Inside or laces?" also has "too far" (shot-far): there a shot of either kind is stopped, as SHOOT is in "Shoot when close!".
const SHOT_SKILLS = new Set(['inside-laces', 'shoot-space']);
const farShots = sc => ({ ...sc, shots: { 'shoot:*:in': 'blocked', 'shoot:*:las': 'blocked' } });
// The situations a lesson teaches: the main one first, then the others that contrast with it.
export const patternsOf = skill => [...new Set(patternList(skill) || [])];
export const generateLookUp = seed => generate('look-up', seed);
