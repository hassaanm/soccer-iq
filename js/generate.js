// Endless "Look up" scenarios. Each one is built around a teaching pattern, then every option is graded
// with the same geometry the game uses. Anything unclear (a lane that is half open, a dribble path that is
// neither free nor blocked) is thrown away and rebuilt, so every generated round has a clear right answer.
import { PITCH } from './skills.js';
import { closestOnLane, interceptor, dribbleEnd, rot, DRIBBLE_DIRS, BACKWARD } from './geom.js';

const { L, W } = PITCH;
const OPEN = 1.6, BLOCKED = .6;        // pass lanes: clearly open / clearly cut off (meters to nearest defender)
const PATH_FREE = 2, PATH_HIT = 2.6;   // dribble paths: clearly free / a defender close enough to win the ball

export function rng(seed) { let s = seed % 2147483647 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const pick = (r, a) => a[Math.floor(r() * a.length)];
const inPitch = ([x, y], m = 1.5) => x > m && x < L - m && y > m && y < W - m;

// Grades every option at the freeze: 'good', 'bad' or 'unclear'. Backward dribbles into open space are 'safe'
// (he keeps the ball but goes away from goal).
export function grade(sc) {
  const hero = { x: sc.heroTo[0], y: sc.heroTo[1] }, ball = { x: hero.x + .5, y: hero.y };
  const opps = sc.opps.map((p, i) => { const q = (sc.oppsTo || [])[i] || p; return { x: q[0], y: q[1] }; });
  const out = {};
  sc.mates.forEach(([x, y], i) => {
    const d = interceptor(ball, { x, y }, opps).d;
    out['pass:' + i] = d > OPEN ? 'good' : d < BLOCKED ? 'bad' : 'unclear';
  });
  for (const dir of Object.keys(DRIBBLE_DIRS)) {
    const end = dribbleEnd(hero, dir, L, W), near = Math.min(...opps.map(o => closestOnLane(o, hero, end, 0).d));
    out['drib:' + dir] = near < PATH_HIT ? 'bad' : BACKWARD.has(dir) ? 'safe' : near > PATH_FREE ? 'good' : 'unclear';
  }
  return out;
}

// One attempt at a scenario of the given pattern; returns null if the layout doesn't come out clean.
function attempt(r, pattern) {
  const hy = 5 + r() * 10, hx = 5 + r() * 7, heroTo = [hx + 3, hy], ball = [hx + 3.5, hy];
  const mates = [], opps = [], oppsTo = [];
  const at = (ang, d) => { const [dx, dy] = rot(d, 0, ang); return [heroTo[0] + dx, heroTo[1] + dy]; };
  const onLane = (to, t) => [ball[0] + (to[0] - ball[0]) * t + (r() - .5) * .5, ball[1] + (to[1] - ball[1]) * t + (r() - .5) * .5];
  const closeIn = p => [p[0] + (p[0] - heroTo[0]) * .35, p[1] + (p[1] - heroTo[1]) * .35]; // start a bit farther out
  const add = p => { opps.push(closeIn(p)); oppsTo.push(p); };
  // Teammates sit anywhere around him, including behind, so he has to turn to find them.
  const angles = [r() * 2.6 - 1.3, pick(r, [1, -1]) * (1.3 + r() * 1.4)];
  if (r() < .5) angles.reverse();
  for (const a of angles) mates.push(at(a, 5.5 + r() * 4));
  if (!mates.every(p => inPitch(p))) return null;

  if (pattern === 'one-open') {
    add(at((r() - .5) * .5, 1.7 + r() * .4));                 // presser in front: dribbling forward runs into him
    add(onLane(mates[1], .55 + r() * .25));                   // second teammate is marked
    add([L - 6 - r() * 4, W / 2 + (r() - .5) * 8]);           // last defender stays home
  } else if (pattern === 'none-open') {
    const side = pick(r, [1, -1]);
    add(at(side * (1.9 + r() * .4), 2.8 + r() * .5));          // presser closes from the side and behind
    add(onLane(mates[0], .6 + r() * .2));
    add(onLane(mates[1], .6 + r() * .2));                      // both teammates marked: run into the space
  } else { // 'two-open': both are open, the one nearer the goal is better
    add(at(pick(r, [1, -1]) * (.35 + r() * .25), 1.8 + r() * .3)); // presser a little off to one side, still in the way forward
    add([L - 5 - r() * 3, W / 2 + (r() - .5) * 6]);
    add([L - 9 - r() * 3, pick(r, [3, W - 3])]);
  }
  if (!opps.every(p => inPitch(p, .5)) || !oppsTo.every(p => inPitch(p, 1))) return null;

  const sc = { hero: [hx, hy], heroTo, mates, opps, oppsTo };
  const g = grade(sc), goods = Object.keys(g).filter(k => g[k] === 'good');
  // Pass lanes must be clearly open or clearly cut off. A borderline dribble direction just counts as blocked.
  if (Object.entries(g).some(([k, v]) => v === 'unclear' && k.startsWith('pass:'))) return null;
  let best, cue;
  if (pattern === 'one-open') {
    if (g['pass:0'] !== 'good' || g['pass:1'] !== 'bad' || g['drib:fwd'] !== 'bad') return null;
    best = 'pass:0'; cue = '{m0} was open!';
  } else if (pattern === 'none-open') {
    if (g['pass:0'] !== 'bad' || g['pass:1'] !== 'bad' || !goods.length) return null;
    best = goods.includes('drib:fwd') ? 'drib:fwd' : goods[0]; cue = 'Nobody was open. Run into the space!';
  } else {
    if (g['pass:0'] !== 'good' || g['pass:1'] !== 'good' || g['drib:fwd'] !== 'bad') return null;
    const fwd = mates[0][0] >= mates[1][0] ? 0 : 1;
    if (Math.abs(mates[0][0] - mates[1][0]) < 3) return null;   // "closer to goal" must be obvious
    best = 'pass:' + fwd; cue = `{m${fwd}} was open and closer to the goal!`;
  }
  return { ...sc, best, ok: goods.filter(o => o !== best), cue };
}

const PATTERNS = ['one-open', 'one-open', 'none-open', 'two-open'];

// A fresh, clean scenario. Same seed, same scenario (handy for tests).
export function generateLookUp(seed) {
  const r = rng(seed);
  for (let i = 0; i < 400; i++) {
    const pattern = PATTERNS[Math.floor(r() * PATTERNS.length)], sc = attempt(r, pattern);
    if (sc) return { ...sc, id: `gen-${pattern}-${seed}`, skill: 'look-up', pattern };
  }
  return null;
}
