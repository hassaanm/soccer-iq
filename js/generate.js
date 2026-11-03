// Endless scenarios for every lesson. Each one is built around a teaching pattern, then every option is graded
// with the same geometry the game uses. Anything unclear (a pass lane that is half open, a push the defender
// might or might not win) is thrown away and rebuilt, so every round has a clear right answer.
import { PITCH, closestOnLane, interceptor, dribbleEnd, rot, clamp, dist, DRIBBLE_DIRS, BACKWARD } from './geom.js';

const { L, W } = PITCH;
const OPEN = 1.6, BLOCKED = .6;        // pass lanes: clearly open / clearly cut off (meters to nearest defender)
const FREE = 2.2, MARKED = 1.3;        // receivers: nobody near / a defender right on him
const PATH_FREE = 2, PATH_HIT = 2.6;   // small-touch dribbles: clearly free / a defender close enough to win the ball
export const PUSH_LEN = 7, HERO_RUN = 5.4, DEF_RUN = 4.8; // "big push": knock it 7 m ahead and race for it
export const OUR_GOAL = { x: 0, y: W / 2 };

export function rng(seed) { let s = seed % 2147483647 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const pick = (r, a) => a[Math.floor(r() * a.length)];
const inPitch = ([x, y], m = 1.5) => x > m && x < L - m && y > m && y < W - m;
const P = ([x, y]) => ({ x, y });
export function pushEnd(from, dir) {
  const [dx, dy] = rot(PUSH_LEN, 0, DRIBBLE_DIRS[dir]);
  return { x: clamp(from.x + dx, 1, L - 1), y: clamp(from.y + dy, 1, W - 1) };
}
// A point `k` meters from p toward our goal: where a defender stands to be "goal-side".
export function goalSide(p, k) { const dx = OUR_GOAL.x - p[0], dy = OUR_GOAL.y - p[1], l = Math.hypot(dx, dy) || 1; return [p[0] + dx / l * k, p[1] + dy / l * k]; }

// Grades every attacking option at the freeze: 'good', 'bad', 'unclear', or 'safe' (a backward dribble into
// open space: he keeps the ball but goes away from goal). `push:` options are big pushes into space.
export function grade(sc) {
  const hero = P(sc.heroTo), ball = { x: hero.x + .5, y: hero.y };
  const opps = sc.opps.map((p, i) => P((sc.oppsTo || [])[i] || p));
  const out = {};
  sc.mates.forEach((m, i) => {
    const mate = P(m), d = interceptor(ball, mate, opps).d, mark = Math.min(...opps.map(o => dist(o, mate)));
    out['pass:' + i] = d > OPEN && mark > FREE ? 'good' : d < BLOCKED || mark < MARKED ? 'bad' : 'unclear';
  });
  // Shooting: on from about 9 m or closer with no defender on the line; blocked or from far out, it gets stopped.
  const aim = { x: L + .7, y: clamp(hero.y, PITCH.gy0 + .8, PITCH.gy1 - .8) }, shotD = dist(hero, aim), shotLane = Math.min(...opps.map(o => closestOnLane(o, ball, aim, 0).d));
  out.shoot = shotD < 9.5 && shotLane > 1.1 ? 'good' : shotLane < .8 || shotD > 12 ? 'bad' : 'unclear';
  for (const dir of Object.keys(DRIBBLE_DIRS)) {
    const end = dribbleEnd(hero, dir, L, W), near = Math.min(...opps.map(o => closestOnLane(o, hero, end, 0).d));
    out['drib:' + dir] = near < PATH_HIT ? 'bad' : BACKWARD.has(dir) ? 'safe' : near > PATH_FREE ? 'good' : 'unclear';
    if (BACKWARD.has(dir)) continue;
    const pe = pushEnd(hero, dir), lane = Math.min(...opps.map(o => closestOnLane(o, hero, pe, .15).d));
    const tHero = dist(hero, pe) / HERO_RUN + .15, tDef = Math.min(...opps.map(o => dist(o, pe) / DEF_RUN + .3));
    out['push:' + dir] = tHero < tDef - .3 && lane > 1.2 ? 'good' : tHero > tDef - .05 || lane < .8 ? 'bad' : 'unclear';
  }
  return out;
}

// ---------- attacking patterns ----------
function attack(r, pattern) {
  const hy = 5 + r() * 10, hx = 5 + r() * 7, heroTo = [hx + 3, hy], ball = [hx + 3.5, hy];
  const mates = [], opps = [], oppsTo = [];
  const at = (ang, d) => { const [dx, dy] = rot(d, 0, ang); return [heroTo[0] + dx, heroTo[1] + dy]; };
  const onLane = (to, t) => [ball[0] + (to[0] - ball[0]) * t + (r() - .5) * .5, ball[1] + (to[1] - ball[1]) * t + (r() - .5) * .5];
  const closeIn = p => [p[0] + (p[0] - heroTo[0]) * .35, p[1] + (p[1] - heroTo[1]) * .35]; // defenders start a bit farther out
  const add = p => { opps.push(closeIn(p)); oppsTo.push(p); };
  // Teammates sit anywhere around him, including behind, so he has to turn to find them.
  let angles = [r() * 2.6 - 1.3, pick(r, [1, -1]) * (1.3 + r() * 1.4)];
  const fside = pick(r, [1, -1]);
  if (pattern === 'forward') angles = [-fside * (.1 + r() * .5), fside * (2.3 + r() * .6)];
  if (pattern.startsWith('space')) angles = [pick(r, [1, -1]) * (2.2 + r() * .7), pick(r, [1, -1]) * (2.2 + r() * .7)];
  if (r() < .5 && pattern !== 'forward') angles.reverse();
  for (const a of angles) mates.push(at(a, 5.5 + r() * 4));
  if (!mates.every(p => inPitch(p))) return null;
  const sidePt = (m, k) => { const dx = m[0] - ball[0], dy = m[1] - ball[1], l = Math.hypot(dx, dy); return [m[0] - dy / l * k + dx / l * .4, m[1] + dx / l * k + dy / l * .4]; };

  if (pattern === 'forward') {
    add(at(fside * (.45 + r() * .3), 1.8 + r() * .3));         // presser in front, leaning away from the forward teammate
    add([L - 4 - r() * 2, W / 2 + (r() - .5) * 4]); add([L - 8 - r() * 3, pick(r, [3, W - 3])]);
  } else if (pattern === 'one-open') {
    add(at((r() - .5) * .5, 1.7 + r() * .4));                 // presser in front: dribbling forward runs into him
    add(onLane(mates[1], .55 + r() * .25));
    add([L - 6 - r() * 4, W / 2 + (r() - .5) * 8]);           // last defender stays home
  } else if (pattern === 'marked') {
    add(at((r() - .5) * .5, 1.7 + r() * .4));
    add(sidePt(mates[1], pick(r, [1, -1]) * (.7 + r() * .4)));  // right next to the second teammate, not in the lane
    add([L - 6 - r() * 4, W / 2 + (r() - .5) * 8]);
  } else if (pattern === 'trap') {
    const side = pick(r, [1, -1]);
    add(at((r() - .5) * .4, 1.5 + r() * .4));                 // one in front...
    add(at(side * (1.1 + r() * .5), 1.6 + r() * .5));          // ...and one closing from the side: a trap
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
  } else if (pattern === 'space-near') {                      // a defender lurks ahead: keep it close and go around
    add(onLane(mates[0], .6 + r() * .2)); add(onLane(mates[1], .6 + r() * .2));
    add(at((r() - .5) * .5, 5 + r() * 1.5));
  }
  if (!opps.every(p => inPitch(p, .5)) || !oppsTo.every(p => inPitch(p, 1))) return null;

  const sc = { hero: [hx, hy], heroTo, mates, opps, oppsTo };
  const g = grade(sc), goods = Object.keys(g).filter(k => g[k] === 'good' && !k.startsWith('push:'));
  if (Object.entries(g).some(([k, v]) => v === 'unclear' && k.startsWith('pass:'))) return null;
  let best, cue, safe = [];
  if (pattern === 'one-open' || pattern === 'marked') {
    if (g['pass:0'] !== 'good' || g['pass:1'] !== 'bad' || g['drib:fwd'] !== 'bad') return null;
    best = 'pass:0'; cue = pattern === 'marked' ? '{m1} had a defender right next to him. {m0} had nobody near him!' : '{m0} was open!';
  } else if (pattern === 'trap') {
    if (g['pass:0'] !== 'good' || goods.some(o => o.startsWith('drib:'))) return null;
    best = 'pass:0'; cue = 'Two defenders were closing in on you. Pass it away before they trap you! {m0} was open.';
  } else if (pattern === 'none-open') {
    if (g['pass:0'] !== 'bad' || g['pass:1'] !== 'bad' || !goods.length) return null;
    best = goods.includes('drib:fwd') ? 'drib:fwd' : goods[0]; cue = 'Nobody was open. Run into the space!';
  } else if (pattern === 'two-open') {
    if (g['pass:0'] !== 'good' || g['pass:1'] !== 'good' || g['drib:fwd'] !== 'bad') return null;
    const fwd = mates[0][0] >= mates[1][0] ? 0 : 1;
    if (Math.abs(mates[0][0] - mates[1][0]) < 3) return null;   // "closer to goal" must be obvious
    best = 'pass:' + fwd; cue = `{m${fwd}} was open and closer to the goal!`;
  } else if (pattern === 'forward') {
    if (g['pass:0'] !== 'good' || g['pass:1'] !== 'good' || g['drib:fwd'] !== 'bad' || mates[0][0] - mates[1][0] < 4) return null;
    best = 'pass:0'; safe = ['pass:1']; cue = 'Look forward first! {m0} was open up the field.';
    return { ...sc, best, ok: goods.filter(o => o !== best && o !== 'pass:1'), safe, cue };
  } else if (pattern === 'space-far') {
    if (g['push:fwd'] !== 'good' || g['pass:0'] !== 'bad' || g['pass:1'] !== 'bad') return null;
    best = 'push:fwd'; safe = goods.filter(o => o.startsWith('drib:')); cue = 'Lots of space! Push it ahead and run!';
    return { ...sc, best, ok: Object.keys(g).filter(k => k.startsWith('push:') && g[k] === 'good' && k !== best), safe, cue };
  } else if (pattern === 'space-behind' || pattern === 'space-close') {
    const pushes = Object.keys(g).filter(k => k.startsWith('push:') && g[k] === 'good').sort((a, b) => pushEnd(P(heroTo), b.slice(5)).x - pushEnd(P(heroTo), a.slice(5)).x);
    if (!pushes.length || g['pass:0'] !== 'bad' || g['pass:1'] !== 'bad') return null;
    if (pattern === 'space-close' && g['push:fwd'] === 'good' && pushes[0] === 'push:fwd' && pushes.length < 2) return null;
    best = pushes[0]; safe = goods.filter(o => o.startsWith('drib:'));
    cue = pattern === 'space-behind' ? 'All the defenders were behind you! Push it ahead and run!' : 'The defender was close, but not in your way. Push it away from him and race!';
    return { ...sc, best, ok: pushes.slice(1), safe, cue };
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
  if (runClear(c)) return { kind: 'dribble', who: 'o1', to: shotSpot(c) };
  for (let i = 1; i < sc.oppsTo.length; i++) {
    const a = sc.oppsTo[i], lane = Math.min(...defs.map(d => closestOnLane(d, P(c), P(a), .15).d));
    const mark = Math.min(99, ...defs.filter(d => goalSideOf(d, a)).map(d => dist(d, P(a))));
    if (lane > 1.1 && mark > 1.6 && runClear(a)) return { kind: 'pass', who: 'o' + (i + 1), to: shotSpot(a) };
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
    spots.push({ id: 'home', p: goalSide(c, 3.4), label: 'Run home' }, { id: 'chase', p: [c[0] + 1.3, c[1]], label: 'Chase' }, { id: 'o2', p: [dbl[0] + .3, dbl[1] - sgn * 1.4], label: 'Help guard' });
    best = 'home'; cue = 'Your friends were each guarding a player, and nobody was in front of the ball. Run home and get between the ball and your goal!';
  } else if (pattern === 'one-goes' || pattern === 'you-go') {
    // The open attacker (o2) sits on the far side from where a pressing friend would stand, so the pass to him is really open.
    const side = pattern === 'one-goes' ? -sgn : sgn;
    const o2 = [c[0] - 3 - r() * 3, c[1] + side * (3.5 + r() * 2.5)], o3 = [c[0] + 1 + r() * 3, c[1] - side * (4 + r() * 2)];
    addOpp(o2); addOpp(o3);
    if (pattern === 'one-goes') {
      mates.push(goalSide(c, 1.1), goalSide(o3, 1.1));                       // a friend is already on the ball
      hero = [c[0] - 3 - r() * 2, c[1] - sgn * (1 + r() * 2)];
      best = 'o2'; cue = 'A friend was already chasing the ball. Only one bee chases — guard the open player!';
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
    hero = [o3[0] + 2 + r() * 2, o3[1] - sgn * (2 + r() * 2)];
    const dbl = goalSide(o2, .9);
    spots.push({ id: 'o3', p: goalSide(o3, 1.3), label: 'Guard' }, { id: 'o2', p: [dbl[0] + .3, dbl[1] + sgn * 1.4], label: 'Help guard' }, { id: 'press', p: [goalSide(c, 1.1)[0] - .3, goalSide(c, 1.1)[1] - sgn * .9], label: 'Chase the ball' });
    best = 'o3'; cue = 'Your friends already had the ball and one player covered. The open player was free — guard him, between him and your goal!';
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

const PATTERNS = {
  'look-up': ['one-open', 'one-open', 'none-open', 'two-open'],
  'see-the-trap': ['trap'],
  'pass-to-open': ['marked', 'marked', 'one-open'],
  'forward-first': ['forward', 'forward', 'two-open'],
  'dribble-to-space': ['space-far', 'space-near', 'space-behind', 'space-behind', 'space-close', 'space-close', 'space-close'],
  'get-goal-side': ['goal-side'],
  'one-goes': ['one-goes', 'one-goes', 'you-go'],
  'mark-the-free-one': ['mark-free'],
};
const DEFENSE = new Set(['goal-side', 'one-goes', 'you-go', 'mark-free']);
export const generates = id => !!PATTERNS[id];

// A fresh, clean scenario for a lesson. Same seed, same scenario (handy for tests).
export function generate(skill, seed) {
  const r = rng(seed), pats = PATTERNS[skill];
  if (!pats) return null;
  for (let i = 0; i < 2500; i++) {
    const pattern = pats[Math.floor(r() * pats.length)], sc = DEFENSE.has(pattern) ? defense(r, pattern) : attack(r, pattern);
    if (sc) return { ...sc, id: `gen-${pattern}-${seed}`, skill, pattern };
  }
  return null;
}
export const generateLookUp = seed => generate('look-up', seed);
