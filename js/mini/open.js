// "Who's open?" (v96): a mini game about the habit the whole game is named after: look up, scan, find the free friend
// quickly. He stands with the ball at his feet in the middle of the pitch and never moves. Friends stand round him, in
// front, to the side and behind; red players mark some of them and stand in some passing lanes. A ring at his feet drains
// (the try's clock). He taps the friend who is really open; the pass is played whatever he taps, and he sees what
// happens: it gets there, it is cut out in the lane, or the marker steps in and wins it. Ring empty: the nearest of
// theirs comes and takes the ball from him. Two lives, a growing score, a saved best (mini/rules.js, mini/run.js).
//
// "Open" is the game's own: a friend is open when BOTH of the game's pass checks say so (and a decoy is one both call
// shut, so a layout never sits on the edge):
//   - the Classic game's grade (generate.js grade: nobody of theirs within 1.6 m of the line from the ball and nobody
//     within 2.2 m of him; shut when one is within 0.6 m of the line or 1.3 m of him), and
//   - the Live engine's pass check (fast/match.js passCheck, run on its own code: a defender near the line, one right on
//     him on the ball's side, or one who can get a foot to the ball's path in time, with the margin Live asks of his own
//     passes), which is also what decides a pass he plays here, so the picture and the result agree.
// Coaching behind it (generic searches, v96 report): a teammate is open when no defender can intercept the pass on its
// way (a clear passing lane) and no defender is close enough to win the ball as it arrives (unmarked, with time to
// receive); scan before the ball comes, check both shoulders, and look forward first: of two open friends the one nearer
// the goal is the better pass, the safe one is still a good one.
//
// What this file holds: the layouts (made from a seed, so a try can be made again from the play log), the level mapping
// (the one place to tune the game), the view and what he can see from it, and the checks. No page and no 3D world here,
// so the tests and the bots use it as it is (mini/open-ui.js puts it on the page).
import { PITCH } from '../geom.js';
import { grade } from '../generate.js';
import { Match, oppOf } from '../fast/match.js';
import { camSpec, project, onLane, dist, wrap, clamp } from '../fast/rules.js';
import { stream } from '../shot.js';

// ---------- the players ----------
// Ids as the sim has them: him ('hero'), up to five friends and six of theirs. (The 3D world draws m1..m3 and o1..o4
// itself; mini/open-ui.js poses the others.)
export const FRIENDS = ['m1', 'm2', 'm3', 'm4', 'm5'], FOES = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6'];
// Where he stands: the middle of the pitch, facing their goal (+x).
export const heroAt = () => ({ x: PITCH.L / 2, y: PITCH.W / 2 });

// ---------- the view ----------
// The game's own view from behind and above him, head up (fast/rules.js camSpec: the Classic head-up view), turned to
// `yaw`. A point is in view when its feet and its head both land inside the screen (SCREEN points: the phone held
// sideways) clear of the bar along the top and the edges.
export const SCREEN = [932, 430], EDGE = { x: 56, top: 70, bottom: 10 };
export const viewCam = (me, yaw, w = SCREEN[0], h = SCREEN[1]) => camSpec(me, me, true, yaw, 1);
export function onView(me, p, yaw, w = SCREEN[0], h = SCREEN[1]) {
  const c = viewCam(me, yaw, w, h);
  for (const z of [.1, 1.5]) { const q = project(c, { x: p.x, y: p.y, z }, w, h); if (!q || q[0] < EDGE.x || q[0] > w - EDGE.x || q[1] < EDGE.top || q[1] > h - EDGE.bottom) return false; }
  return true;
}
// Looking round: a tap on a turn arrow turns his head TURN_STEP rad that way (at up to TURN_RATE rad/s); a drag turns it
// with the finger (DRAG rad across the whole screen), as in the Classic game. lookSteps: how many arrow taps (each way
// tried) bring p into view: 0 (in view as the try starts), 1 (a side), 2 (behind him), 3 (not with the arrows).
export const TURN_STEP = 1.25, TURN_RATE = 4.5, DRAG = 3.2;
export function lookSteps(me, p) {
  if (onView(me, p, 0)) return 0;
  const side = Math.sign(wrap(Math.atan2(p.y - me.y, p.x - me.x))) || 1;
  for (const k of [1, 2]) if (onView(me, p, side * k * TURN_STEP) || onView(me, p, -side * k * TURN_STEP)) return k;
  return 3;
}
// The least time a quick child needs to find a friend that far round and tap him (s): a first look ahead, each turn
// (decide, tap, the head turning), then seeing him and tapping. A layout never asks for more than its time allows.
export const QUICK = { first: .8, step: .6, tap: .7 };
export const needSecs = k => QUICK.first + k * QUICK.step + QUICK.tap;

// ---------- the checks ----------
// The Live engine's own pass check (fast/match.js Match.prototype.passCheck), run on a stand-in for a match that holds
// just these players: his pass, so with Live's margin for his own passes ("a pass shown open is a promise"), at the
// engine's middle level.
export const LIVE_LEVEL = .5;
const LIVE_OPP = oppOf(LIVE_LEVEL);
function liveMatch(hero, friends, foes) {
  const m = Object.create(Match.prototype), all = new Map();
  const put = (id, team, p) => all.set(id, { id, team, x: p.x, y: p.y, tx: p.x, ty: p.y, sp: 0 });
  put('hero', 'us', hero); for (const f of friends) put(f.id, 'us', f); for (const o of foes) put(o.id, 'them', o);
  Object.assign(m, { sim: { a: id => all.get(id) }, usIds: ['hero', ...friends.map(f => f.id)], themIds: foes.map(o => o.id), keepers: false, opp: LIVE_OPP, L: PITCH.L, W: PITCH.W, me: 'hero' });
  return m;
}
// { open, why: 'lane' | 'marked', by } for a pass from him to friend `to`, as Live would play it.
export function liveCheck(hero, friends, foes, to) { return liveMatch(hero, friends, foes).passCheck('hero', to); }
// The Classic grade of a pass to each friend: 'good', 'bad' or 'unclear' (generate.js grade, the ball at his feet).
export function classicGrades(hero, friends, foes) {
  const sc = { heroTo: [hero.x, hero.y], mates: friends.map(f => [f.x, f.y]), opps: foes.map(o => [o.x, o.y]) };
  const g = grade(sc, new Set(friends.map((_, i) => 'pass:' + i)));
  return Object.fromEntries(friends.map((f, i) => [f.id, g['pass:' + i]]));
}
// Every friend's status: 'open' (both checks), 'shut' (both say no, with Live's reason and who), or 'unclear'.
export function statuses(hero, friends, foes) {
  const cg = classicGrades(hero, friends, foes), m = liveMatch(hero, friends, foes), out = {};
  for (const f of friends) {
    const lv = m.passCheck('hero', f.id);
    out[f.id] = lv.open && cg[f.id] === 'good' ? { s: 'open' } : !lv.open && cg[f.id] === 'bad' ? { s: 'shut', why: lv.why, by: lv.by } : { s: 'unclear', why: lv.why || null, by: lv.by || null, classic: cg[f.id], live: lv.open ? 1 : 0 };
  }
  return out;
}
export const openIds = st => Object.keys(st).filter(id => st[id].s === 'open');

// ---------- how hard, by level (a third of a level a success: mini/rules.js) ----------
// The one place to tune the game. `s` is the score the level comes with (level x 3). Every number moves only the hard
// way as it rises (tests/open.test.js). The first two tries are gentle: three friends, all in front of him, the decoys
// plain (a red right next to a friend, or right in the middle of the line), and time to spare.
//   friends  how many friends (3 to 5; the fraction: the chance of one more)
//   hide     the chance the open friend is out of view as the try starts (to a side or behind him), from HIDE_AT
//   behind   of those, the chance he is behind him (two turns)
//   subtle   0..1: how close to the line a decoy's red stands (a marker a step off him, not touching; a red in the lane
//            near either end, not in its middle)
//   press    the chance of a red pressing him (in front, away from every line); roam: how many reds stand about, in no lane
//   move     the chance of a moving try: a red leaves the friend he marks and runs into the open friend's lane, so the
//            answer changes during the try
//   two      the chance of two open friends: the one nearer their goal is worth a bonus point ("forward first")
//   secs     the try's time (the ring at his feet)
export const HIDE_AT = 2, BEHIND_AT = 3, MOVE_AT = 4, TWO_AT = 5;
// (v96 fix, the owner's decision) The first WELCOME tries of a run are welcoming, whatever the score: two friends, both
// in front of him (one open, nobody of theirs near him; the other plainly shut: a red right next to him or right in the
// middle of his line, and no other red on the pitch), WELCOME_SECS on the clock, and one more go after a first miss
// (mini/open-ui.js: he sees why, the ball comes back, the same picture again; the second miss costs the life). From the
// third try on the level's own numbers below, as before.
export const WELCOME = 2, WELCOME_SECS = 12, AGAIN = 1;
export const welcomeOf = n => (n >= 0 && n < WELCOME ? n : -1); // (the try's place among the welcoming ones, or -1)
export function openLevel(L, w = -1) {
  const s = Math.max(0, L) * 3, up = (from, per, max) => clamp((s - from) * per, 0, max);
  if (w >= 0) return { s: 0, friends: 2, hide: 0, behind: 0, subtle: 0, press: 0, roam: 0, move: 0, two: 0, secs: WELCOME_SECS, welcome: w };
  return {
    s, friends: 3 + up(1.5, 1 / 3, 2), hide: s < HIDE_AT ? 0 : Math.min(.75, .35 + .07 * (s - HIDE_AT)), behind: s < BEHIND_AT ? 0 : Math.min(.45, .2 + .05 * (s - BEHIND_AT)),
    subtle: up(0, 1 / 6, 1), press: s < HIDE_AT ? 0 : Math.min(.8, .3 + .1 * (s - HIDE_AT)), roam: up(3, 1 / 3, 2),
    move: s < MOVE_AT ? 0 : Math.min(.45, .2 + .05 * (s - MOVE_AT)), two: s < TWO_AT ? 0 : Math.min(.35, .2 + .03 * (s - TWO_AT)),
    secs: 3 + 4 * Math.exp(-s / 4.2),
  };
}

// ---------- a layout ----------
// Zones round him by the way he faces (+x): in front (in view as the try starts), to a side (one turn), behind (two).
const ZONE = { view: [0, 1.05], side: [1.2, 2.4], behind: [2.3, Math.PI] }, NEAR = [4.6, 6.6], FAR = [6.6, 9.4];
const zoneOf = k => (k === 0 ? 'view' : k === 1 ? 'side' : 'behind');
// The answer's place, for the spread and for "never the same answer twice in a row": its zone, its side (l: on his
// left, r: his right, c: straight ahead or behind) and near or far.
export function placeKey(me, p) {
  const a = wrap(Math.atan2(p.y - me.y, p.x - me.x)), k = lookSteps(me, p), lr = Math.abs(Math.sin(a)) * dist(me, p) < 1.2 ? 'c' : a > 0 ? 'l' : 'r';
  return { zone: zoneOf(Math.min(2, k)), lr, d: dist(me, p) < NEAR[1] ? 'near' : 'far', key: `${zoneOf(Math.min(2, k))}-${lr}-${dist(me, p) < NEAR[1] ? 'n' : 'f'}` };
}
// Where everyone is at t s into the try (a moving red runs from his place to his target at `v` m/s from `t0`).
export function posAt(lay, t) {
  const at = p => { const m = p.move; if (!m || t <= m.t0) return { id: p.id, x: p.x, y: p.y }; const d = dist(p, m.to), k = Math.min(1, (t - m.t0) * m.v / (d || 1)); return { id: p.id, x: p.x + (m.to.x - p.x) * k, y: p.y + (m.to.y - p.y) * k }; };
  return { hero: lay.hero, friends: lay.friends.map(at), foes: lay.foes.map(at) };
}
export const statusAt = (lay, t) => { const p = posAt(lay, t); return statuses(p.hero, p.friends, p.foes); };
// The open friends at t (the right answers then), the best first (the one nearer their goal).
export function answersAt(lay, t) {
  const st = statusAt(lay, t), ids = openIds(st), x = id => lay.friends.find(f => f.id === id).x;
  return ids.sort((a, b) => x(b) - x(a));
}

const unit = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; };
const inPitch = (p, m = 1.4) => p.x > m && p.x < PITCH.L - m && p.y > m && p.y < PITCH.W - m;
const MARK_D = 1.3, FREE_D = 1.8; // (a marker: within the Classic grade's 1.3 m of him; free of a marker: nobody within 1.8 m)
const MOVE_V = 5, STEP_DT = .1, MOVE_MORE = 1.3; // (a moving try is 30% longer: time to see it change)
// Screen boxes, to keep friends apart on screen and never wholly behind one of theirs.
function screenBox(me, yaw, p, w = SCREEN[0], h = SCREEN[1]) {
  const c = viewCam(me, yaw, w, h), f = project(c, { x: p.x, y: p.y, z: 0 }, w, h), t = project(c, { x: p.x, y: p.y, z: 1.6 }, w, h); if (!f || !t) return null;
  const e = c.eye, d = Math.hypot(p.x - e[0], p.y - e[1]), half = (f[1] - t[1]) * .2;
  return { x0: f[0] - half, x1: f[0] + half, y0: t[1], y1: f[1], d, fx: f[0], fy: f[1] };
}
const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

// Makes the layout for a try at level L from `seed` (a whole number). prev: the last try's layout (its answer's place is
// never this one's). Returns { seed, level, hero, friends, foes, ans (open as it starts, best first), after (open once
// a moving red has got there, or null), at (s: when the answer changes), kinds, secs, need (s), look (arrow turns to
// the first answer), place, two }.
export function* layoutSteps(L, seed, prev = null, w = -1) {
  const d = openLevel(L, w), r0 = stream((((seed >>> 0) % 4294967291) + .5) / 4294967296);
  // The plan is drawn once (so the shares of each kind of try are as the level says); only the places are drawn again
  // until every check passes. A plan that cannot be made (very rare) gives way to a plainer one.
  const U = (a, b) => a + (b - a) * r0(), nF = Math.min(5, Math.floor(d.friends) + (r0() < d.friends % 1 ? 1 : 0)), two = nF >= 3 && r0() < d.two, move = !two && r0() < d.move;
  let zone = 'view'; if (r0() < d.hide) zone = r0() < d.behind ? 'behind' : 'side';
  if (two) zone = 'view'; // (the forward one: up the pitch, in front of him; the safe one anywhere)
  const plan = { nF, two, move, zone, side: r0() < .5 ? 1 : -1, far: r0() < .5 };
  if (prev?.place) { const k = prev.place; if (k.zone === zone && (k.d === 'far') === plan.far && k.lr === (plan.side > 0 ? 'l' : 'r')) plan.side = -plan.side; } // (never the same place twice running)
  const plans = [plan, { ...plan, move: false }, { ...plan, move: false, two: false, zone: zone === 'behind' ? 'side' : zone }, { ...plan, move: false, two: false, zone: 'view', nF: Math.min(3, nF) }];
  for (const [i, pl] of plans.entries()) for (let n = 0; n < 400; n++) { const lay = tryLayout(d, L, r0, prev, seed, n + i * 1000, pl); if (lay) return lay; yield n; }
  void U; return fallback(L, seed, w); // (never seen: the tests make thousands)
}
// The same, made at once (the tests, the bots); the page makes the next try's layout a little at a time during this one
// (layoutSteps yields after each attempt: mini/open-ui.js).
export function makeLayout(L, seed, prev = null, w = -1) { const g = layoutSteps(L, seed, prev, w); for (;;) { const r = g.next(); if (r.done) return r.value; } }
function tryLayout(d, L, r, prev, seed, n, plan) {
  const me = heroAt(), U = (a, b) => a + (b - a) * r(), pick = a => a[Math.floor(r() * a.length)], sgn = () => (r() < .5 ? 1 : -1);
  const { nF, two, move, zone } = plan, friends = [], foes = [], kinds = {};
  // (a place in zone z: an angle and a distance, tried until the view says it is in that zone: lookSteps)
  // (and apart from the friends already placed: by angle round him, so each is his own choice on screen, and on the pitch)
  const apart = p => inPitch(p, 1.6) && friends.every(f => Math.abs(wrap(f.a - p.a)) >= .42 && dist(f, p) >= 3);
  const place = (z, side, far) => { for (let k = 0; k < 30; k++) { const [a0, a1] = ZONE[z], a = side * U(a0, a1), rr = far ? U(...FAR) : U(...NEAR), p = { x: me.x + Math.cos(a) * rr, y: me.y + Math.sin(a) * rr, a }; if (apart(p) && zoneOf(lookSteps(me, p)) === z) return p; } return null; };
  const ans = place(zone, plan.side, plan.far); if (!ans) return null;
  friends.push({ id: 'm1', ...ans });
  // the others: at the gentle start all in front of him; later round him, at least one in front
  const zones = [];
  for (let i = 1; i < nF; i++) zones.push(d.s < HIDE_AT ? 'view' : r() < .5 ? 'view' : r() < .7 ? 'side' : 'behind');
  if (zone !== 'view' && !zones.includes('view')) zones[0] = 'view';
  if (zone !== 'view' && zones.filter(z => z === 'view').length < 2 && nF >= 4) zones[1] = 'view'; // (two tempting choices in front, when he has to look away for the right one)
  for (let i = 1; i < nF; i++) { const p = place(zones[i - 1], sgn(), r() < .5); if (!p) return null; friends.push({ id: FRIENDS[i], ...p }); }
  { const ids = FRIENDS.slice(0, nF); for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; } friends.forEach((f, i) => { f.id = ids[i]; }); } // (each id is its own body: the open one is never always the same boy)
  // the second open friend (two): one of the others, nearer our goal by 3 m or more; the forward one must be up the pitch
  let second = null;
  if (two) { const c = friends.slice(1).filter(f => f.x <= friends[0].x - 3); if (!c.length || friends[0].x < me.x + 2) return null; second = pick(c); }
  // the decoys: a red marking him (a step from him, on the ball's side) or a red in his lane
  const decoys = friends.filter(f => f !== friends[0] && f !== second), sub = d.subtle;
  const want = decoys.map((_, i) => (i === 0 ? pick(['marked', 'lane']) : i === 1 ? null : pick(['marked', 'lane'])));
  if (want.length >= 2) want[1] = want[0] === 'marked' ? 'lane' : 'marked'; // (both kinds, whenever there are two decoys)
  decoys.forEach((f, i) => {
    let o;
    if (want[i] === 'marked') { const u = unit(f, me), a = sgn() * U(0, .35 + .85 * sub), dm = U(.62, .8 + .38 * sub), c = Math.cos(a), s = Math.sin(a); o = { x: f.x + (u.x * c - u.y * s) * dm, y: f.y + (u.x * s + u.y * c) * dm }; }
    else { const t = sub < .4 ? U(.4, .6) : U(.3 - .1 * sub, .85), off = sgn() * U(0, .14 + .34 * sub); const u = unit(me, f); o = { x: me.x + (f.x - me.x) * t - u.y * off, y: me.y + (f.y - me.y) * t + u.x * off }; }
    foes.push({ id: FOES[foes.length], ...o, job: want[i], of: f.id }); kinds[f.id] = want[i];
  });
  // a red pressing him (in front, away from every line), and reds standing about
  if (r() < d.press) {
    let best = null; for (let k = 0; k < 12; k++) { const a = U(-1.1, 1.1), gap = Math.min(...friends.map(f => Math.abs(wrap(f.a - a)))); if (!best || gap > best.gap) best = { a, gap }; }
    if (best.gap > .75) { const rr = U(2.1, 2.8); foes.push({ id: FOES[foes.length], x: me.x + Math.cos(best.a) * rr, y: me.y + Math.sin(best.a) * rr, job: 'press' }); }
  }
  const nRoam = Math.floor(d.roam) + (r() < d.roam % 1 ? 1 : 0);
  for (let k = 0; k < nRoam && foes.length < FOES.length; k++) {
    for (let t = 0; t < 10; t++) { const a = U(-Math.PI, Math.PI), rr = U(5, 10.5), p = { x: me.x + Math.cos(a) * rr, y: me.y + Math.sin(a) * rr }; if (inPitch(p, 1) && friends.every(f => dist(f, p) > 3.2) && foes.every(o => dist(o, p) > 2.5)) { foes.push({ id: FOES[foes.length], ...p, job: 'roam' }); break; } }
  }
  if (foes.length > FOES.length || !foes.every(o => inPitch(o, .8))) return null;
  // a moving try: the red marking a friend in front of him leaves him and runs into the open friend's lane
  let at = null; const secs = d.secs * (move ? MOVE_MORE : 1);
  if (move) {
    const m = foes.find(o => o.job === 'marked' && lookSteps(me, friends.find(f => f.id === o.of)) === 0); if (!m) return null;
    const g = friends[0], t = U(.38, .62), off = sgn() * U(0, .3), u = unit(me, g), to = { x: me.x + (g.x - me.x) * t - u.y * off, y: me.y + (g.y - me.y) * t + u.x * off };
    const t0 = U(.2, .34) * secs, arrive = t0 + dist(m, to) / MOVE_V;
    if (arrive > .7 * secs || secs - arrive < 1.4) return null;
    m.move = { to, t0, v: MOVE_V }; at = { t0, arrive };
  }
  // checks: the answer (and the second) open, every decoy shut, by both checks
  const lay = { seed, level: L, n, hero: me, friends: friends.map(({ id, x, y }) => ({ id, x, y })), foes: foes.map(({ id, x, y, job, of, move: mv }) => ({ id, x, y, job, ...(of ? { of } : {}), ...(mv ? { move: mv } : {}) })), secs, two: !!second, at, welcome: d.welcome ?? -1 };
  const st = statuses(me, lay.friends, lay.foes), open = openIds(st).sort();
  const wantOpen = [friends[0].id, ...(second ? [second.id] : [])].sort();
  if (open.join() !== wantOpen.join()) return null;
  if (Object.entries(st).some(([id, x]) => !wantOpen.includes(id) && x.s !== 'shut')) return null;
  // each decoy is shut by its own red alone, and is the kind it shows: 'marked' (that red within a step of him, the lane
  // clear: without him he would be open) or 'lane' (that red in the line, nobody near him: free of a marker)
  for (const o of lay.foes) if (o.of) {
    const f = lay.friends.find(x => x.id === o.of), rest = lay.foes.filter(x => x !== o);
    if (rest.length && statuses(me, lay.friends, rest)[f.id].s !== 'open') return null; // (with nobody else of theirs he is open)
    if (o.job === 'marked' ? dist(o, f) > MARK_D : lay.foes.some(x => dist(x, f) < FREE_D)) return null;
  }
  lay.ans = answersAt(lay, 0); lay.kinds = kinds; lay.after = null;
  if (move) { // after the run: the friend he left is open, the old answer shut, the rest as they were; on the way, never anyone else
    const m = lay.foes.find(o => o.move), fId = m.of, end = at.arrive + .05;
    const st1 = statusAt(lay, end), o1 = openIds(st1);
    if (o1.join() !== fId || st1[friends[0].id].s !== 'shut') return null;
    for (let t = STEP_DT; t < end; t += STEP_DT) { const o = openIds(statusAt(lay, t)); if (o.some(id => id !== fId && id !== friends[0].id)) return null; }
    lay.after = [fId];
  }
  // what he can see: friends apart on screen at every turn of his head; the answer never wholly behind one of theirs
  for (const k of [0, 1, -1, 2, -2]) {
    const yaw = k * TURN_STEP, vis = lay.friends.filter(f => onView(me, f, yaw)).map(f => screenBox(me, yaw, f)).filter(Boolean);
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) if (Math.hypot(vis[i].fx - vis[j].fx, vis[i].fy - vis[j].fy) < 60) return null;
  }
  // nobody between the camera and him as the try starts or one turn either way (a body there would fill the picture)
  for (const k of [0, 1, -1]) { const c = viewCam(me, k * TURN_STEP), e = { x: c.eye[0], y: c.eye[1] }; for (const p of [...lay.friends, ...lay.foes, ...lay.foes.filter(o => o.move).map(o => o.move.to)]) { const q = onLane(p, me, e, 0); if (q.d < 1.1 && q.along > .8) return null; } }
  for (const id of [...lay.ans, ...(lay.after || [])]) {
    const f = lay.friends.find(x => x.id === id), k = lookSteps(me, f), side = Math.sign(wrap(Math.atan2(f.y - me.y, f.x - me.x))) || 1;
    if (k > 2) return null;
    const yaw = [0, 1, -1, 2, -2].map(j => j * TURN_STEP).find(y => onView(me, f, y)) ?? side * k * TURN_STEP, fb = screenBox(me, yaw, f); if (!fb) return null;
    const hid = lay.foes.map(o => screenBox(me, yaw, o)).filter(b => b && b.d < fb.d).reduce((s, b) => s + overlap(fb, b), 0) / ((fb.x1 - fb.x0) * (fb.y1 - fb.y0) || 1);
    if (hid > (d.s < 4 ? .3 : .6)) return null;
  }
  // time: the answer must be findable by a quick child (and a moving try's late answer is in front of him)
  const k0 = lookSteps(me, lay.friends.find(f => f.id === lay.ans[0])), need = needSecs(Math.min(...lay.ans.map(id => lookSteps(me, lay.friends.find(f => f.id === id)))));
  if (need > secs - .3) return null;
  if (lay.after && lookSteps(me, lay.friends.find(f => f.id === lay.after[0])) !== 0) return null;
  // never the same place as the last answer
  lay.place = placeKey(me, lay.friends.find(f => f.id === lay.ans[0]));
  if (prev?.place && prev.place.key === lay.place.key) return null;
  lay.look = k0; lay.need = need;
  return lay;
}
// (never used in play: every level makes its layouts; kept so a try always has one)
function fallback(L, seed, w = -1) {
  const me = heroAt(), f = (id, a, r) => ({ id, x: me.x + Math.cos(a) * r, y: me.y + Math.sin(a) * r });
  const friends = [f('m1', .3, 6), f('m2', -.35, 7)], foes = [{ id: 'o1', x: friends[1].x - .7, y: friends[1].y, job: 'marked', of: 'm2' }];
  return { seed, level: L, n: -2, hero: me, friends, foes, secs: openLevel(L, w).secs, two: false, at: null, ans: ['m1'], after: null, kinds: { m2: 'marked' }, place: placeKey(me, friends[0]), look: 0, need: needSecs(0), welcome: w };
}

// ---------- a pass he plays ----------
// What happens to a pass to `to` with everyone where they are now (the Live check, as Live would play it): { ok, why
// ('lane': cut out on its way, 'marked': won as it arrives), by (who) }.
export function passResult(hero, friends, foes, to) {
  const lv = liveCheck(hero, friends, foes, to);
  return lv.open ? { ok: true } : { ok: false, why: lv.why, by: lv.by };
}
// The ring ran out: the nearest of theirs comes and takes the ball.
export const taker = (hero, foes) => foes.reduce((b, o) => (!b || dist(o, hero) < dist(b, hero) ? o : b), null);
// The friend nearer their goal of two open ones is worth this much more (a bonus point; the other still scores).
export const FORWARD_BONUS = 1;

// What is said (spoken: tests/spoken.js via mini/games.js `lines`; each has a recorded clip, the name is new in v96).
export const OPEN_SAID = {
  name: "Who's open!", intro: 'See who is open?', good: 'Great pass!', looked: 'Nice pass! You looked up!', forward: 'Great choice!',
  lane: 'Blocked!', marked: 'They got it!', time: 'So close! Try again!', behind: 'Check your shoulder!',
};
