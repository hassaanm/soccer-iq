// Endless scenarios for every lesson. Each one is built around a teaching pattern, then every option is graded
// with the same geometry the game uses. Anything unclear (a pass lane that is half open, a push the defender
// might or might not win) is thrown away and rebuilt, so every round has a clear right answer.
import { PITCH, closestOnLane, interceptor, dribbleEnd, rot, clamp, dist, lerp, DRIBBLE_DIRS, BACKWARD } from './geom.js';

const { L, W } = PITCH;
const OPEN = 1.6, BLOCKED = .6;        // pass lanes: clearly open / clearly cut off (meters to nearest defender)
const FREE = 2.2, MARKED = 1.3;        // receivers: nobody near / a defender right on him
const PATH_FREE = 2.2, PATH_HIT = 1.8; // small-touch dribbles: clearly free / a defender in the way (measured from a stride ahead)
const PUSH_LEN = 7; // "big push": knock it 7 m ahead and race for it
export const HERO_RUN = 5.4, DEF_RUN = 4.8;
const OUR_GOAL = { x: 0, y: W / 2 };

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
    const other = P(sc.mates[1 - i]), blockedByFriend = closestOnLane(other, ball, mate, .05).d < .8 && dist(other, mate) > 1;
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
  const hy = near ? 7 + r() * 6 : 5 + r() * 10, heroTo = [0, hy];
  const up = high && ANYWHERE.has(pattern); // near their goal: friends stand a little closer so they stay on the pitch
  const hx = near ? 16 + r() * 4 : far ? 10 + r() * 2 : pattern === 'counter' || pattern === 'counter-pass' ? 3 + r() * 5 : up ? 13 + r() * 5 : 4 + r() * 10;
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
    add([L - 4 - r() * 2, W / 2 + (r() - .5) * 4]); add([L - 8 - r() * 3, pick(r, [3, W - 3])]);
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
    if (far) { const p = [L - 3 - r(), clamp(heroTo[1] + (W / 2 - heroTo[1]) * .6, 8.6, 11.4)]; opps.push(p); oppsTo.push(p); } // recovering near goal
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
    add([heroTo[0] - 4.2 - r() * .8, heroTo[1] + 1.2 + r() * .6]);   // the player he took it from (behind the camera)
    add(at((r() - .5) * .3, 2.1 + r() * .5));                       // recovering, right in his way
    add([L - 3 - r() * 3, mates[0][1] > W / 2 ? 3 + r() * 3 : W - 3 - r() * 3]); // their last defender, on the other side
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
    best = 'pass:0'; cue = mates[0][0] < heroTo[0] - 2 ? 'Nothing ahead was open, so pass back to {m0}!' : pattern === 'marked' ? '{m0} had nobody near him. Pass to {m0}!' : '{m0} was open!';
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
function defense(r, pattern) {
  const c = [12 + r() * 7, 5 + r() * 10], sgn = c[1] < W / 2 ? 1 : -1;
  const mates = [], opps = [c], oppsTo = [c], spots = [];
  let hero, best, cue;
  const addOpp = p => { opps.push([p[0] + 1.5, p[1]]); oppsTo.push(p); };
  if (pattern === 'goal-side') {
    // We just lost the ball. Both friends are already guarding an attacker each; nobody is in front of the ball.
    hero = [c[0] + 3.5 + r() * 1.5, c[1] - sgn * (1 + r() * 2)];             // he got caught behind the ball
    const o2 = [c[0] - 3 - r() * 3, sgn > 0 ? 16.5 + r() * 2 : 1.5 + r() * 2], o3 = [c[0] - 1 - r() * 3, sgn > 0 ? 1.5 + r() * 2 : 16.5 + r() * 2];
    addOpp(o2); addOpp(o3);
    mates.push(goalSide(o2, 1.1), goalSide(o3, 1.1));
    const dbl = goalSide(o2, .9);
    spots.push({ id: 'home', p: goalSide(c, 3.4), label: 'In front' }, { id: 'chase', p: [c[0] + 1.3, c[1]], label: 'Behind him' }, { id: 'o2', p: [dbl[0] + .3, dbl[1] - sgn * 1.4], label: 'Help guard' });
    best = 'home'; cue = 'Nobody was on the ball, so you go! Get in front of it.';
  } else if (pattern === 'gs-covered') {
    // Contrast round: a friend is already in front of the ball, so the open attacker is his job.
    hero = [c[0] + 3 + r() * 1.5, c[1] - sgn * (1 + r() * 2)];
    c[1] = clamp(c[1], 7, 13);
    const o2 = [c[0] - 1.5 - r() * 1.5, c[1] - sgn * (4.5 + r())], o3 = [c[0] - 1 - r() * 3, sgn > 0 ? 16.5 + r() * 2 : 1.5 + r() * 2];
    addOpp(o2); addOpp(o3);
    mates.push(goalSide(c, 1.1), goalSide(o3, 1.1));
    const inFront = goalSide(c, 3.4);
    spots.push({ id: 'home', p: [inFront[0], inFront[1] + sgn * 1.2], label: 'In front' }, { id: 'chase', p: [c[0] + 1.3, c[1]], label: 'Behind him' }, { id: 'o2', p: goalSide(o2, 1.2), label: 'Guard' });
    best = 'o2'; cue = 'A friend was already in front of the ball. Guard the open player!';
  } else if (pattern === 'one-goes' || pattern === 'you-go') {
    // The open attacker (o2) sits on the far side from where a pressing friend would stand, so the pass to him is really open.
    const side = sgn;
    if (pattern === 'one-goes') c[1] = clamp(c[1], 7, 13);
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
  const all = [...opps, ...oppsTo, ...mates, hero, ...spots.map(s => s.p)];
  if (!all.every(p => inPitch(p, 1))) return null;
  if (spots.some((s, i) => spots.some((t, j) => j > i && Math.hypot(s.p[0] - t.p[0], s.p[1] - t.p[1]) < 2))) return null; // spots must be clearly apart
  const sc = { kind: 'defense', carrier: 'o1', hero: [hero[0] + 1.2, hero[1]], heroTo: hero, mates, opps, oppsTo,
    spots: spots.map(s => ({ id: s.id, x: s.p[0], y: s.p[1], label: s.label })), best: 'spot:' + best, ok: [], cue };
  // The right spot must leave no way through, and every wrong spot must leave a real one (no magic goals).
  sc.exploits = Object.fromEntries(sc.spots.map(s => [s.id, exploit(sc, s.id)]));
  if (sc.exploits[best] || sc.spots.some(s => s.id !== best && !sc.exploits[s.id])) return null;
  return sc;
}

// ---------- getting open (his team has the ball, a friend is carrying it) ----------
// m1 has the ball with a defender right in front of him, so he needs a pass. The child (hero) has no ball and
// picks where to run. Right spot: a clear path for the pass and no defender near. Wrong spots: hiding behind a
// defender (the pass gets cut out) or running next to the ball (his defender follows and they trap both).
export const laneClear = (from, to, opps) => opps.every(o => closestOnLane(P(o), P(from), P(to), .1).d > 1.3 && dist(P(o), P(to)) > 2.2);
const laneRoom = (from, to, opps) => Math.min(...opps.map(o => closestOnLane(P(o), P(from), P(to), .1).d));
export const laneBlocked = (from, to, opps) => opps.some(o => closestOnLane(P(o), P(from), P(to), .1).d < .7);
function support(r, pattern) {
  const c = [8 + r() * 8, 6 + r() * 8], side = c[1] < W / 2 ? 1 : -1;   // the open side of the pitch
  const o1 = [c[0] + 1.5, c[1] - side * (.5 + r() * .3)];                 // presser in front of the carrier (forward passes are blocked)
  const at = (ang, d) => { const [dx, dy] = rot(d, 0, ang); return [c[0] + dx, c[1] + dy]; };
  const perp = (a, b, k) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [b[0] - dy / l * k, b[1] + dx / l * k]; };
  let hero, o2, spots, best, cue;
  const m2 = at(-side * (.25 + r() * .35), 9 + r() * 2), o3 = goalSideOf(m2, 1.1);   // the other friend is up the field, marked
  if (pattern === 'shadow') {                     // he's standing right behind a defender: move out of the shadow
    hero = at(side * (.8 + r() * .5), 6.5 + r() * 1.5);
    o2 = [lerp(c[0], hero[0], .62) + (r() - .5) * .3, lerp(c[1], hero[1], .62) + (r() - .5) * .3];
    const k = 3 + r() * .8, a1 = perp(c, hero, k), a2 = perp(c, hero, -k);
    const space = laneRoom(c, a1, [o1, o2]) > laneRoom(c, a2, [o1, o2]) ? a1 : a2;   // step out to the side with the clearer path
    spots = [{ id: 'space', p: space }, { id: 'stay', p: hero }, { id: 'ball', p: [c[0] - .6, c[1] + side * 1.6] }];
    best = 'space'; cue = 'A defender was between you and the ball. Move to open space so {m0} can pass!';
  } else if (pattern === 'spread') {              // he's crowding the ball: spread out into space
    hero = [c[0] - .4, c[1] + side * 2.2];
    o2 = [hero[0] - 1, hero[1] - side * .2];
    spots = [{ id: 'space', p: at(side * (1 + r() * .45), 6.5 + r() * 1.5) }, { id: 'stay', p: hero }, { id: 'hide', p: hero }];
    spots[2].p = [o3[0] + (o3[0] - c[0]) * .25, o3[1] + (o3[1] - c[1]) * .25];  // behind the other defender
    best = 'space'; cue = 'Give {m0} room! Find open space.';
  } else {                                        // 'stay-open': he's already open, so stay and be ready
    hero = at(side * (1 + r() * .45), 6.5 + r() * 1.5);
    o2 = [hero[0] - 2.5 - r(), hero[1] - side * (3 + r())];
    spots = [{ id: 'stay', p: hero }, { id: 'ball', p: [c[0] - .6, c[1] + side * 1.6] }, { id: 'hide', p: [o2[0] + (o2[0] - c[0]) * .3, o2[1] + (o2[1] - c[1]) * .3] }];
    best = 'stay'; cue = 'You were already open. Stay there and get ready for the pass!';
  }
  const opps = [o1, o2, o3], all = [c, o1, o2, o3, m2, hero, ...spots.map(s => s.p)];
  if (!all.every(p => inPitch(p, 1))) return null;
  if (spots.some((s, i) => spots.some((t, j) => j > i && Math.hypot(s.p[0] - t.p[0], s.p[1] - t.p[1]) < 2.2))) return null;
  // The right spot must have a clear pass; every wrong one must be blocked, or right next to the ball.
  const ok = sp => laneClear(c, sp.p, opps), crowd = sp => Math.hypot(sp.p[0] - c[0], sp.p[1] - c[1]) < 2.6;
  if (!ok(spots.find(s => s.id === best))) return null;
  for (const s2 of spots) if (s2.id !== best && !crowd(s2) && (ok(s2) || !laneBlocked(c, s2.p, opps))) return null;
  if (spots.find(s => s.id === best).p[0] < c[0] - 1) return null;   // open space ahead or level, not behind
  return { kind: 'support', carrier: 'm1', hero: [hero[0] - .8, hero[1]], heroTo: hero, mates: [c, m2], opps, oppsTo: opps,
    spots: spots.map(s => ({ id: s.id, x: s.p[0], y: s.p[1], crowd: crowd(s) })), best: 'spot:' + best, ok: [], cue };
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
    best: 'spot:go', ok: [], cue: 'Now run past him into the space, so {m0} can pass it back!' };
}

// ---------- 1v1 defending (steal it) ----------
// He is goal-side of the attacker, who dribbles at him. Small touches keep the ball at the attacker's feet;
// after a big touch it rolls away from him, and that is the moment to steal it. Tapping too early (too far
// away) or while the ball is at his feet lets the attacker go past.
function tackle(r, pattern) {
  const hx = 8 + r() * 4, hy = 6 + r() * 8, side = hy < W / 2 ? 1 : -1;
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
  const H = [high ? 17 + r() * 4 : 8 + r() * 9, 5 + r() * 10], s = pick(r, [1, -1]);
  const m1 = [H[0] - 6 - r() * 1.5, H[1] + (r() - .5) * 3];
  const o1 = pattern === 'peek-turn' ? [H[0] + 1.9 + r() * .6, H[1] + s * (1.1 + r() * .5)] : [H[0] + 8 + r() * 3, H[1] + s * (3 + r() * 2)];
  const m2 = [H[0] + 5 + r() * 3, clamp(H[1] - s * (5 + r() * 1.5), 2, W - 2)], o2 = goalSideOf(m2, 1.1), o3 = [L - 4 - r() * 3, W / 2 + (r() - .5) * 6];
  const sc = { kind: 'receive', carrier: 'm1', hero: [H[0] + .8, H[1]], heroTo: H, mates: [m1, m2], opps: [o1, o2, o3], oppsTo: [o1, o2, o3], turns: { L: 'fr', R: 'fl' } };
  if (![H, m1, m2, o1, o2, o3].every(p => inPitch(p, 1.2))) return null;
  const g = grade(sc), good = k => g['drib:' + sc.turns[k]] === 'good', bad = k => g['drib:' + sc.turns[k]] === 'bad';
  if (pattern === 'peek-turn') {
    const away = s > 0 ? 'L' : 'R', toward = away === 'L' ? 'R' : 'L';
    if (!good(away) || !bad(toward)) return null;
    return { ...sc, best: 'turn:' + away, ok: [], cue: 'A defender was behind you! Peek first, then turn away from him.' };
  }
  if (!good('L') || !good('R')) return null;
  return { ...sc, best: 'turn:' + (s > 0 ? 'L' : 'R'), ok: ['turn:' + (s > 0 ? 'R' : 'L')], cue: 'Nobody was behind you. Peek, then turn and go!' };
}

const goalSideOf = (p, k) => { const dx = L - p[0], dy = W / 2 - p[1], l = Math.hypot(dx, dy) || 1; return [p[0] + dx / l * k, p[1] + dy / l * k]; }; // their goal is at x = L

const PATTERNS = {
  'look-up': ['carry', 'none-open', 'carry', 'one-open', 'shot-open'],
  'shoot-close': ['shot-open', 'shot-open', 'shot-blocked', 'shot-far'],
  'see-the-trap': ['trap', 'trap', 'trap-one'],
  'take-him-on': ['trap-one', 'trap-one', 'carry', 'trap'],
  'pass-to-open': ['marked', 'marked', 'one-open', 'carry'],
  'forward-first': ['forward', 'forward', 'two-open', 'carry', 'shot-open'],
  'dribble-to-space': ['space-far', 'space-near', 'space-behind', 'space-friend'],
  'get-goal-side': ['goal-side', 'you-go', 'goal-side'],
  'won-it-go': ['counter', 'counter', 'counter-pass', 'counter-shot'],
  'one-goes': ['one-goes', 'you-go', 'gs-covered'],
  'mark-the-free-one': ['mark-free', 'mark-free', 'gs-covered'],
  'give-and-go': ['give-go', 'give-go-ahead'],
  'peek-and-turn': ['peek-turn', 'peek-turn', 'peek-open'],
  'steal-it': ['steal', 'steal-fast', 'steal-big'],
  'get-open': ['shadow', 'shadow', 'spread', 'stay-open'],
};
// Half the time the two teammates trade places, so the open one isn't always the same friend.
const swap = o => o?.replace(/pass:([01])/, (_, i) => 'pass:' + (1 - i));
function swapMates(sc) {
  return { ...sc, mates: [sc.mates[1], sc.mates[0]], best: swap(sc.best), ok: (sc.ok || []).map(swap), safe: (sc.safe || []).map(swap),
    cue: sc.cue.replace(/\{m([01])\}/g, (_, i) => `{m${1 - i}}`) };
}
const DEFENSE = new Set(['goal-side', 'gs-covered', 'one-goes', 'you-go', 'mark-free']), SUPPORT = new Set(['shadow', 'spread', 'stay-open']), TACKLE = new Set(['steal', 'steal-fast', 'steal-big']), RECEIVE = new Set(['peek-turn', 'peek-open']);
export const generates = id => !!PATTERNS[id];
export const mainPattern = id => PATTERNS[id]?.[0];
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
export function generate(skill, seed, { even = false, pattern: want = null } = {}) {
  const r = rng(seed), pats = want ? [want] : even ? [...new Set(PATTERNS[skill] || [])] : PATTERNS[skill];
  if (!PATTERNS[skill]) return null;
  // Pick the pattern once, then retry only its layout, so patterns that are harder to build still come up as often.
  const first = Math.floor(r() * pats.length), high = r() < .3; // about 3 in 10 scenes happen near their goal (where it fits)
  for (let i = 0; i < 4000; i++) {
    const pattern = i < 3000 ? pats[first] : pats[Math.floor(r() * pats.length)];
    const sc = DEFENSE.has(pattern) ? defense(r, pattern) : SUPPORT.has(pattern) ? support(r, pattern) : TACKLE.has(pattern) ? tackle(r, pattern) : RECEIVE.has(pattern) ? receive(r, pattern, high) : attack(r, pattern, high);
    const fixed = DEFENSE.has(pattern) || SUPPORT.has(pattern) || TACKLE.has(pattern) || RECEIVE.has(pattern) || pattern === 'give-go' || pattern === 'give-go-ahead'; // give-and-go's step 2 depends on which friend is the wall
    if (sc) return { ...(fixed || r() < .5 ? sc : swapMates(sc)), id: `gen-${pattern}-${seed}`, skill, pattern };
  }
  return null;
}
// The situations a lesson teaches: the main one first, then the others that contrast with it.
export const patternsOf = skill => [...new Set(PATTERNS[skill] || [])];
export const generateLookUp = seed => generate('look-up', seed);
