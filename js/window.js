// The decision window (v64): the world no longer stops while he chooses. Play drops into slow motion and goes on, and
// he has a limited time, shown by the defender coming for the ball. This file is pure (no game, no page): the window's
// length, how everyone moves in it, and the check that what he sees agrees with how each choice is graded. The game
// (game/window.js), the tests and the audits (scripts/motion-audit.js) all use it.
//
// How it works. Each scene is graded from one picture (generate.js). In the window everyone moves on, so the picture
// changes; the grades must stay true at every moment he could tap. Most grades are about players relative to each other
// (a lane between two players, a defender next to a friend), and a play that moves together keeps them. So play moves
// as a whole ("the drift": the player on the ball keeps it rolling, and everyone near goes with him: defenders give
// ground facing the ball, markers stay with their players, friends move with the play), and each player adds his own
// small part on top (the presser edges in, a friend steps across). Each player moves at one steady velocity through the
// window, which the run-up brings him to, so nobody stops, turns back or starts from nothing in it. The planner tries
// the most lively version first and calmer ones after, and takes the first in which every choice keeps its grade at
// every moment of the window (agree, below). The window ends when the threat's reach gets to the ball: he takes it.
import { dist, closestOnLane, interceptor, clamp, PITCH, dribbleEnd, BACKWARD } from './geom.js';
import { grade, exploit, leadPoint, LEAD, DEF_RUN, HERO_RUN, pushEnd, takeOn } from './generate.js';
import { resolve, bestSpaceY, spaceY, rightFoot } from './shot.js';

// ---------- how long ----------
// Real seconds from when the choice opens to when the defender takes the ball, at the "Normal" thinking time (v64
// research, section 2b, as the owner set them): the very first round of a new idea, then by the idea's level (1 to 3).
// Matches use the level of the idea the decision belongs to. One table, so new numbers go in one place.
export const WINDOW = { first: 10, 1: 8, 2: 6, 3: 4.5 };
export const MIN_NORMAL = 4;                                 // never shorter than this at Normal
export const THINK = { relaxed: 1.5, normal: 1, quick: .7 }; // the grown-ups setting "Thinking time"
export const RETRY = 1.3;                                    // a lesson round he ran out of time in is tried again with a longer window
export function windowSeconds({ level = 1, first = false, think = 'normal', retry = 0 } = {}) {
  const base = Math.max(MIN_NORMAL, first ? WINDOW.first : WINDOW[clamp(Math.round(level) || 1, 1, 3)]);
  return base * (THINK[think] ?? 1) * Math.pow(RETRY, Math.min(3, retry));
}
// How much soccer a window shows (game seconds): about 1.5 s, the time the space closes on a real pitch. The world's
// speed in the window is this over the real seconds (about 0.15× for the longest window, 0.33× for the shortest).
export const GAME = 1.5, GAME_MIN = .25, GAME_FAR = 2; // (GAME_FAR: the threat comes from farther off: more of his run is in the window)
// Child speeds (v64 research, section 1, ages 6–8) and the most a child speeds up or slows down: the motion audit's limits.
export const SPEED = { stand: .2, walk: [.8, 1.3], jog: [1.8, 2.5], run: [3, 3.5], sprint: [4, 4.5] }, ACC = 3.5;

// ---------- paths ----------
// A player's way through the window: from (x, y), at velocity v0, changing smoothly to v1 between t1 and t1 + tau (game
// seconds after the window opens), then on at v1. The change is a smoothstep, so it starts and ends gently; its strongest
// pull is 1.5 |v1 - v0| / tau, kept under ACC.
export const easeTime = (v0, v1, t1 = 0) => Math.max(.35, Math.hypot(v1[0] - v0[0], v1[1] - v0[1]) * 1.5 / ACC);
export function pathAt(p, t, out = { x: 0, y: 0, vx: 0, vy: 0 }) {
  if (p.arr) return arrAt(p, t + (p.base || 0), out);
  if (p.go) return goAt(p, t, out);
  if (p.rel) return relAt(p, t, out);
  if (p.herm) return hermAt(p, t, out);
  const t1 = p.t1 || 0, tau = p.tau || 0, dvx = p.v1[0] - p.v0[0], dvy = p.v1[1] - p.v0[1];
  let k = 0, s = 0; // k: how far the change is (velocity), s: the distance it has added, per unit of change
  if (t > t1) { const u = tau > 0 ? Math.min(1, (t - t1) / tau) : 1; k = u * u * (3 - 2 * u); s = tau * (u * u * u - u * u * u * u / 2) + Math.max(0, t - t1 - tau); }
  out.x = p.x + p.v0[0] * t + dvx * s; out.y = p.y + p.v0[1] * t + dvy * s; out.vx = p.v0[0] + dvx * k; out.vy = p.v0[1] + dvy * k;
  return out;
}

// An arrival (v64 round 2): a player runs along u at vRun, slows over his last dB metres to vEnd (at a constant pull,
// as a child brakes), and is at P at time T (seconds from the scene's own moment); after it he goes on at vEnd. `base`:
// the scene-time at which the game's clock for this path reads 0 (the window's opening, or the run-up's start).
const BRAKE = 3.2;
export function arrAt(p, tr, out = { x: 0, y: 0, vx: 0, vy: 0 }) {
  // (he slows no harder than BRAKE: over more than dB metres if he runs in fast)
  const dv = p.vRun * p.vRun - p.vEnd * p.vEnd, a = p.dB > 0 && dv > 0 ? Math.min(BRAKE, dv / (2 * p.dB)) : 0, dB = a > 0 ? dv / (2 * a) : 0, tb = a > 0 ? (p.vRun - p.vEnd) / a : 0, tau = p.T - tr;
  let r, v;
  if (tau <= 0) { r = p.vEnd * tau; v = p.vEnd; }                                  // past P: on at vEnd
  else if (tau <= tb) { r = p.vEnd * tau + .5 * a * tau * tau; v = p.vEnd + a * tau; } // braking in
  else { r = dB + p.vRun * (tau - tb); v = p.vRun; }                                // running in
  out.x = p.P[0] - p.u[0] * r; out.y = p.P[1] - p.u[1] * r; out.vx = p.u[0] * v; out.vy = p.u[1] * v;
  return out;
}
// (round 3) A marker going with his man: where his man is (his own path), plus an offset that goes over the lead-in
// from a step goal-side of him (o0) to where the picture has the marker (o1), smoothly.
export function relAt(p, t, out = { x: 0, y: 0, vx: 0, vy: 0 }) {
  const q = pathAt(p.man, t), k = Math.min(1, Math.max(0, t / p.T)), s = k * k * (3 - 2 * k), ds = t > 0 && t < p.T ? 6 * k * (1 - k) / p.T : 0;
  out.x = q.x + p.o0[0] + (p.o1[0] - p.o0[0]) * s; out.y = q.y + p.o0[1] + (p.o1[1] - p.o0[1]) * s;
  out.vx = q.vx + (p.o1[0] - p.o0[0]) * ds; out.vy = q.vy + (p.o1[1] - p.o0[1]) * ds; return out;
}
// From standing at S, after t0 s, toward E: speeding up and slowing down at a (m/s²), no faster than vMax, stopping at E
// (a shooter's follow-through after the wind-up).
export function goAt(p, t, out = { x: 0, y: 0, vx: 0, vy: 0 }) {
  const dx = p.E[0] - p.S[0], dy = p.E[1] - p.S[1], d = Math.hypot(dx, dy) || 1e-6, ux = dx / d, uy = dy / d, a = p.a, vp = Math.min(p.vMax, Math.sqrt(a * d));
  const t1 = vp / a, d1 = .5 * a * t1 * t1, tc = Math.max(0, (d - 2 * d1) / vp), tt = Math.max(0, t - (p.t0 || 0));
  let r, v;
  if (tt < t1) { r = .5 * a * tt * tt; v = a * tt; }
  else if (tt < t1 + tc) { r = d1 + vp * (tt - t1); v = vp; }
  else { const e = Math.min(t1, tt - t1 - tc); r = d1 + vp * tc + vp * e - .5 * a * e * e; v = Math.max(0, vp - a * e); }
  out.x = p.S[0] + ux * r; out.y = p.S[1] + uy * r; out.vx = ux * v; out.vy = uy * v; return out;
}
// From where he is and how he moves (S, V0) to where the scene has him (E, V1) in T seconds, smoothly (a cubic Hermite
// curve); on at V1 after it. For a window that opens from play already going (a rebound, a match).
export function hermAt(p, t, out = { x: 0, y: 0, vx: 0, vy: 0 }) {
  const T = p.T;
  if (t >= T) { const e = t - T; out.x = p.E[0] + p.V1[0] * e; out.y = p.E[1] + p.V1[1] * e; out.vx = p.V1[0]; out.vy = p.V1[1]; return out; }
  const s = Math.max(0, t) / T, s2 = s * s, s3 = s2 * s, h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  const d00 = (6 * s2 - 6 * s) / T, d10 = 3 * s2 - 4 * s + 1, d01 = (-6 * s2 + 6 * s) / T, d11 = 3 * s2 - 2 * s;
  for (const [i, k] of [[0, 'x'], [1, 'y']]) { out[k] = h00 * p.S[i] + h10 * T * p.V0[i] + h01 * p.E[i] + h11 * T * p.V1[i]; out['v' + k] = d00 * p.S[i] + d10 * p.V0[i] + d01 * p.E[i] + d11 * p.V1[i]; }
  return out;
}

// ---------- what each choice is, as graded, and how it looks now ----------
const P = ([x, y]) => ({ x, y }), A = p => [p.x, p.y];
const PASS = ['pass:0', 'pass:1', 'pass:2'], DRIBS = ['fwd', 'fl', 'left', 'bl', 'back', 'br', 'right', 'fr'];
// The choices an attacking scene offers (as the buttons do: input.js), from where he is.
export function attackOptions(sc, { push = false, shoot = null } = {}) {
  const h = P(sc.heroTo), out = [...PASS.slice(0, sc.mates.length), ...DRIBS.map(d => 'drib:' + d)];
  if (push) out.push(...['fwd', 'fl', 'fr', 'left', 'right'].map(d => 'push:' + d));
  if (shoot ?? (!sc.shots && h.x > PITCH.L - (sc.skill === 'shoot-close' ? 18 : 13))) out.push('shoot');
  return [...out, ...Object.keys(sc.shots || {})];
}
// How a choice was graded: 'good' (3 stars), 'safe' (2) or 'bad', as rounds.js rating() says from the scene.
export function gradedAs(sc, o, g0 = sc.grades || grade(sc)) {
  if (o === sc.best || (sc.ok || []).includes(o)) return 'good';
  if ((sc.safe || []).includes(o)) return 'safe';
  if (o.startsWith('drib:') || o.startsWith('push:') || o === 'shoot') return g0[o] === 'good' ? 'good' : g0[o] === 'safe' ? 'safe' : 'bad';
  return 'bad';
}
const cls = v => (v === 'good' ? 'good' : v === 'safe' ? 'safe' : 'bad');
const fits = (was, now) => (was === 'good' ? now === 'good' : was === 'safe' ? now !== 'bad' : now === 'bad');
// What he sees "agrees" with a grade within TOL metres of the line the grade was drawn on: nobody can see 30 cm on a
// phone, and the generator builds its scenes right up to its lines. So a choice graded right must still look right with
// the lines moved TOL in its favour, and one graded wrong must still look wrong with them moved TOL against it.
export const TOL = .3;
// grade() (generate.js), its lines moved by k metres (k > 0: "open" is easier to be, "blocked" harder).
export function gradeT(sc, k) {
  const hero = P(sc.heroTo), ball = { x: hero.x + .5, y: hero.y }, opps = sc.opps.map((p, i) => P((sc.oppsTo || [])[i] || p)), out = {};
  sc.mates.forEach((m, i) => {
    const mate = P(m), d = interceptor(ball, mate, opps).d, mark = Math.min(...opps.map(o => dist(o, mate)));
    const byFriend = sc.mates.some((q, j) => j !== i && closestOnLane(P(q), ball, mate, .05).d < .8 - k && dist(P(q), mate) > 1);
    out['pass:' + i] = byFriend ? 'unclear' : d > 1.6 - k && mark > 2.2 - k ? 'good' : d < .6 - k || mark < 1.3 - k ? 'bad' : 'unclear';
  });
  const aim = { x: PITCH.L + .7, y: clamp(hero.y, PITCH.gy0 + .8, PITCH.gy1 - .8) }, shotD = dist(hero, aim), shotLane = Math.min(...opps.map(o => closestOnLane(o, ball, aim, 0).d));
  out.shoot = shotD < 12 + k && shotLane > 1.1 - k ? 'good' : shotLane < .8 - k || shotD > 13.5 + k ? 'bad' : 'unclear';
  const onHim = opps.filter(o => dist(o, hero) < 2.6 - k).length, mates = sc.mates.map(P);
  const ontoFriend = (end, r) => mates.some(m => dist(m, end) < r - k || closestOnLane(m, hero, end, .2).d < .9 - k);
  for (const dir of DRIBS) {
    const end = dribbleEnd(hero, dir, PITCH.L, PITCH.W), near = Math.min(...opps.map(o => closestOnLane(o, hero, end, .8 / 4.5).d)), t = takeOn(hero, dir, opps);
    out['drib:' + dir] = t ? (t.good ? 'good' : 'bad') : near < 1.8 - k || onHim >= 2 ? 'bad' : BACKWARD.has(dir) ? 'safe' : near > 2.2 - k ? 'good' : 'unclear';
    if (out['drib:' + dir] === 'good' && ontoFriend(end, 2.2)) out['drib:' + dir] = 'safe';
    if (BACKWARD.has(dir)) continue;
    const pe = pushEnd(hero, dir), lane = Math.min(...opps.map(o => closestOnLane(o, hero, pe, .15).d));
    const tHero = dist(hero, pe) / HERO_RUN + .15, tDef = Math.min(...opps.map(o => dist(o, pe) / DEF_RUN + .3)), kt = k / DEF_RUN;
    out['push:' + dir] = tHero < tDef - .3 + kt && lane > 1.2 - k ? 'good' : tHero > tDef - .05 + kt || lane < .8 - k ? 'bad' : 'unclear';
    if (out['push:' + dir] === 'good' && ontoFriend(pe, 2.5)) out['push:' + dir] = 'safe';
  }
  return out;
}
// A match's own rule for passes (live.js liveScenario), with the same slack.
function livePass(b, m, O, k) {
  const d = interceptor(b, m, O).d;
  const marked = O.some(q => { const r = dist(q, m); if (r < 1.2 - k) return true; const behind = (q.x - m.x) * (b.x - m.x) + (q.y - m.y) * (b.y - m.y) < 0; return r < 1.8 - k && !behind; });
  return d > 1.1 - k && !marked ? 'good' : 'bad';
}

// The scene as it stands now: `pos(id)` gives where each player is. Returns the choices whose look no longer matches their
// grade (empty: all agree). Every kind of decision has its own check, the same rule its scenes were built with.
export function disagree(sc, pos, t = 0, opts = {}) {
  const k = kindOf(sc);
  if (k === 'attack') return attackDis(sc, pos, opts);
  if (k === 'defense') return defenseDis(sc, pos, opts);
  if (k === 'lead') return leadDis(sc, pos);
  if (k === 'follow') return followDis(sc, pos, t, opts);
  if (k === 'receive') return receiveDis(sc, pos);
  if (k === 'support' || k === 'goal') return supportDis(sc, pos, opts);
  return [];
}
export const kindOf = sc => (sc.kind === 'tackle' ? 'tackle' : sc.kind === 'defense' ? 'defense' : sc.kind === 'lead' ? 'lead' : sc.kind === 'receive' ? 'receive'
  : sc.run === 'follow' ? 'follow' : sc.run === 'goal' ? 'goal' : sc.kind === 'support' ? 'support' : 'attack');
const ids = (pre, n) => Array.from({ length: n }, (_, i) => pre + (i + 1));
function attackDis(sc, pos, { options, ball } = {}) {
  const h = pos('hero'), mates = ids('m', sc.mates.length).map(id => A(pos(id))), opps = ids('o', sc.oppsTo.length).map(id => A(pos(id)));
  const k2 = sc.gk?.them && pos('k2'), out = sc.pattern === 'keeper-out' && k2; // (the keeper rushing out counts as a defender)
  const live = { ...sc, heroTo: A(h), mates, opps: out ? [...opps, A(k2)] : opps, oppsTo: out ? [...opps, A(k2)] : opps };
  const gl = gradeT(live, TOL), gt = gradeT(live, -TOL), g1 = grade(live), g0 = sc.grades || grade(sc), bad = [];
  const b = ball || { x: h.x + .5, y: h.y }, O = opps.map(P);
  for (const o of options || attackOptions(sc)) {
    if (o.startsWith('shoot:')) { if (sc.shots && shotNow(sc, o, h, k2, O) !== sc.shots[o]) bad.push(o); continue; }
    const was = gradedAs(sc, o, g0), g = was === 'bad' ? gt : gl; // (in its favour, or against it)
    if ((!o.startsWith('pass:') || !sc.live) && g1[o] === g0[o]) continue; // (graded now just as it was: it agrees)
    let now = cls(g[o]);
    if (o.startsWith('pass:') && sc.live) now = livePass(b, P(mates[+o[5]]), O, was === 'bad' ? -TOL : TOL);
    if (!fits(was, now)) bad.push(o);
  }
  return bad;
}
// A shot he picks (v62): from where he is now, at the keeper where he is now.
function shotNow(sc, o, h, k, defs) {
  const [, sp, ft] = o.split(':'), from = { x: h.x + .5, y: h.y }, K = k ? { x: k.x, y: k.y } : null;
  const foot = ft === '*' ? rightFoot(from) : ft, y = sp === '*' ? bestSpaceY(from, K) : spaceY(sp);
  if (sc.shots[o] === 'blocked') return 'blocked';
  return resolve(from, y, foot, K, { stray: sc.stray, defs }).res;
}
// Defending: the rings go with the players they belong to ("in front of the ball", "guard him"), and each still leaves the
// attackers a way through, or none, as it did.
export function spotRef(sc, sp) {
  const k = kindOf(sc);
  if (k === 'defense') return sp.id === 'home' || sp.id === 'chase' || sp.id === 'press' ? sc.carrier || 'o1' : /^o\d$/.test(sp.id) ? sp.id : sp.id === 'stay' ? 'hero' : null;
  if (k === 'lead') return 'm1';
  if ((k === 'support' || k === 'goal') && sp.id === 'stay') return 'hero';
  if (k === 'follow' && sp.id === 'watch') return 'hero';
  return null; // a place on the grass
}
// Where each ring is now (rings that belong to a player move with him; `at0(id)`: where he was as the window opened).
export function spotsNow(sc, pos, at0) {
  if (kindOf(sc) === 'lead') return leadSpots(sc, pos);
  return (sc.spots || []).map(sp => { const r = spotRef(sc, sp); if (!r) return sp; const a = pos(r), b = at0(r); return { ...sp, x: sp.x + a.x - b.x, y: sp.y + a.y - b.y }; });
}
function defenseDis(sc, pos, opts) {
  const at0 = opts.at0;
  const oppIds = sc.oppIds || (opts.ids || []).filter(id => id[0] === 'o'), live = { ...sc, oppsTo: oppIds.map(id => A(pos(id))), mates: ids('m', sc.mates.length).map(id => A(pos(id))) };
  live.spots = spotsNow(sc, pos, at0);
  return sc.spots.filter(sp => !!exploit(live, sp.id) !== !!(sc.exploits?.[sp.id])).map(sp => 'spot:' + sp.id);
}
// "Pass in front!": the rings go with the runner (where he is, in front of him where the pass would meet him now, far
// ahead), and each keeps the reason it was right or wrong (generate.js lead()).
function leadSpots(sc, pos) {
  const m = pos('m1'), h = pos('hero'), mv = sc.moves.m1, [dx, dy] = sc.dir, d = { x: dx, y: dy };
  const T0 = sc.spots.find(s => s.id === 'lead'), R0 = sc.spots.find(s => s.id === 'far');
  const farK = Math.hypot(R0.x - T0.x, R0.y - T0.y), T = leadPoint(h, m, d, mv.speed);
  return sc.spots.map(s => s.id === 'lead' ? { ...s, x: T.x, y: T.y, t: T.t } : s.id === 'feet' ? { ...s, x: m.x, y: m.y } : { ...s, x: T.x + dx * farK, y: T.y + dy * farK });
}
function leadDis(sc, pos) {
  const h = pos('hero'), sp = leadSpots(sc, pos), [T, F, R] = ['lead', 'feet', 'far'].map(id => sp.find(s => s.id === id)), mv = sc.moves.m1;
  const o = ids('o', sc.oppsTo.length).map(pos), m2 = pos('m2'), lane = (q, s, t0 = .1) => closestOnLane(q, h, s, t0).d, bad = [];
  if (sp.some(s => lane(o[0], s) < 1.5 || lane(m2, s, 0) < 2 || dist(m2, s) < 2.5)) bad.push('lanes');
  if (lane(o[2], T) < 2 || dist(o[2], T) < 3.5 || lane(o[1], T) < 1.3 || lane(o[1], R) < 1.3) bad.push('spot:lead');
  if (o.slice(0, 3).some(q => dist(q, T) / DEF_RUN + .3 < T.t + .4) || T.x > PITCH.L - 7 || R.x > PITCH.L - 2.5) bad.push('spot:lead');
  if (dist(o[2], R) / DEF_RUN + .3 > dist(F, R) / mv.speed - .5) bad.push('spot:far');
  const tFeet = LEAD.kick + dist(h, F) / LEAD.speed;
  if (sc.moves.o2 ? dist(o[1], F) / 5 + .1 > tFeet : o.slice(0, 3).some(q => dist(q, F) / DEF_RUN + .3 < tFeet + .8)) bad.push('spot:feet');
  return bad;
}
// After a shot (follow your shot): he is still clearly first to the loose ball (by at least RACE s), as the scene was
// built; everyone else's run to it starts when they react.
export const RACE = .1;
export const reactOf = (sc, id) => (id === sc.shot?.block ? .75 : .3);
function followDis(sc, pos, t, opts) {
  const loose = opts.loose;
  const L0 = loose || P(sc.shot.loose), h = pos('hero'), tH = dist(h, L0) / 5.2 + .15;
  const tO = Math.min(...(opts.ids || ids('o', sc.oppsTo.length)).filter(id => id[0] === 'o').map(id => dist(pos(id), L0) / DEF_RUN + Math.max(0, reactOf(sc, id) - t)));
  return tO - tH < RACE ? ['spot:in'] : [];
}
function receiveDis(sc, pos) {
  const live = { ...sc, heroTo: A(pos('hero')), mates: ids('m', sc.mates.length).map(id => A(pos(id))), oppsTo: ids('o', sc.oppsTo.length).map(id => A(pos(id))) };
  live.opps = live.oppsTo;
  const gl = gradeT(live, TOL), gt = gradeT(live, -TOL), bad = [];
  for (const [k, dir] of Object.entries(sc.turns)) { const o = 'turn:' + k, was = o === sc.best || (sc.ok || []).includes(o) ? 'good' : 'bad'; if (!fits(was, cls((was === 'bad' ? gt : gl)['drib:' + dir]))) bad.push(o); }
  return bad;
}
// Running to a ring while a friend has the ball (getting open, running to the goal, the run after a give-and-go): each
// ring keeps its reason: a clear pass to it (the best), blocked or right by the ball (wrong), or only okay for the reason
// it gave (behind the ball, a defender close, a narrow path: generate.js moreSpots). A ring's reason is read with
// TOL metres of slack: no one can see 10 cm on a phone, and the lines it is built on are hard cuts.
function supportDis(sc, pos, opts) {
  const at0 = opts.at0;
  const c = A(pos(sc.carrier || 'm1')), opps = (sc.oppIds || (opts.ids || []).filter(id => id[0] === 'o')).map(id => A(pos(id))), spots = spotsNow(sc, pos, at0), bad = [];
  const goal = kindOf(sc) === 'goal', room = (p, q) => Math.min(...opps.map(o => closestOnLane(P(o), P(p), P(q), .1).d)), mark = p => Math.min(...opps.map(o => Math.hypot(o[0] - p[0], o[1] - p[1])));
  const clear = (p, q, k = 0) => room(p, q) > 1.3 - k && opps.every(o => Math.hypot(o[0] - q[0], o[1] - q[1]) > 2.2 - k);
  const blocked = (p, q, k = 0) => room(p, q) < .7 + k, crowd = q => Math.hypot(q[0] - c[0], q[1] - c[1]) < 2.6 + TOL;
  const h = A(pos('hero'));
  for (const sp of spots) {
    const q = [sp.x, sp.y], o = 'spot:' + sp.id, best = o === sc.best;
    if (sc.then || sc.id === 'live-run') { // a give-and-go's run, or a match's (live.js toSupport)
      if (best && sp.id !== 'stay' ? !clear(c, q, TOL) : best ? !clear(c, q, TOL) : false) bad.push(o);
      else if (!best && sp.id === 'stay' && !sc.ok?.includes(o) && !blocked(c, q, TOL)) bad.push(o);
      else if (!best && sp.crowd && !crowd(q)) bad.push(o);
      else if (sp.why && !whyHolds(sp.why, c, q, opps, goal)) bad.push(o);
      continue;
    }
    if (best && sc.shot) { const r = race(sc, c, q, opps, h); if (r.tO < r.tH + .45 - .1) bad.push(o); continue; } // (the rebound: he is still clearly first)
    if (best) { if (!clear(c, q, TOL) || (goal && (q[0] < c[0] + 2 - TOL || !clear([c[0] + 1, c[1]], q, TOL)))) bad.push(o); continue; }
    if (sp.why) { if (!whyHolds(sp.why, c, q, opps, goal, sc, h)) bad.push(o); continue; }
    if (goal) { if (!(crowd(q) || q[0] < c[0] + TOL || mark(q) < 1.6 + TOL)) bad.push(o); continue; }
    if (!sp.crowd && !blocked(c, q, TOL)) bad.push(o);
    else if (sp.crowd && !crowd(q)) bad.push(o);
  }
  return bad;
}
// The race for the ball a friend's shot sends back out (running to the goal, 'go-shot'): his time to it by way of ring
// q, by the best ring, and theirs (generate.js goalRun, from where everyone is now).
function race(sc, c, q, opps, h) {
  const lo = P(sc.shot.loose), hit = P(sc.shot.hit), L0 = { x: c[0] + .5, y: c[1] }, tHit = .2 + dist(L0, hit) / 17 * 1.3, B = sc.spots.find(s => 'spot:' + s.id === sc.best), H = P(h);
  const leg = p => dist(H, p) / 5.2 + dist(p, lo) / 5.2 + .1;
  return { t: leg(P(q)), tH: leg(B), tO: Math.min(...opps.map(o => tHit + .25 + dist(P(o), lo) / DEF_RUN)) };
}
// generate.js moreSpots: why a ring is only okay (or wrong), with TOL of slack each way.
function whyHolds(why, c, q, opps, goal, sc = null, h = null) {
  const lane = Math.min(...opps.map(o => closestOnLane(P(o), P(c), P(q), .1).d)), mark = Math.min(...opps.map(o => Math.hypot(o[0] - q[0], o[1] - q[1]))), k = TOL;
  const ahead = goal ? q[0] > c[0] + 2 - k && Math.abs(q[1] - PITCH.W / 2) < 6.5 + k : q[0] >= c[0] - .5 - k, behind = goal ? q[0] < c[0] + .5 + k : q[0] < c[0] - 2 + k, open = mark > 2.8 - k;
  if (why === 'hidden') return lane < .6 + k && mark > 1.4 - k;
  if (why === 'back' || why === 'wide') return lane >= 1.5 - k && open && behind;
  if (why === 'pressure') return lane >= 1.5 - k && mark >= 1.5 - k && mark <= 2 + k && ahead;
  if (why === 'narrow') return lane >= 1 - k && lane <= 1.2 + k && open && ahead;
  if ((why === 'late' || why === 'slow') && sc?.shot && h) { // a run to the goal with a shot on: the race for the rebound (generate.js goalRun own)
    const r = race(sc, c, q, opps, h), kt = .1;
    return why === 'late' ? r.t > r.tH + .35 - kt && r.t < r.tO - .3 : r.t > r.tO + .45 - kt; // (still first, with a little to spare: the race is close)
  }
  return true;
}

// ---------- the plan ----------
// st: { at: { id: { x, y, vx, vy, team, gk } }, ball: { x, y, carrier } } (where everyone is and how he is moving as the
// window opens). Returns { G (game seconds), threat: { id, to: [x, y] }, paths: { id: path }, watch: Set of ids who face
// the ball as they move, k: which calmer try it took (0 = the liveliest), dis: what still disagrees (empty) }.
// opts: { options (attack: the choices on offer), fixed: true when the run-up will bring everyone to their velocity (the
// paths are steady); otherwise each eases from how he moves now }.
// With `fixed` (a lesson's own scene, whose run-up brings everyone to his velocity), the window need not open at the
// scene's own moment: it may open up to EARLY s before it (the run-up is cut short), wherever the longest window agrees.
// `a` (≤ 0): when it opens, counted from the scene's moment; the paths are then given from there.
export const EARLY = .9;
export function planWindow(sc, st, opts = {}) {
  const kind = kindOf(sc); if (kind === 'tackle') return null;
  opts = { ...opts, ids: Object.keys(st.at).filter(id => !st.at[id].gk) };
  const tries = TRIES[kind](sc, st, opts), at0 = id => st.at[id];
  let best = null;
  for (let k = 0; k < tries.length; k++) {
    const p = build(sc, st, tries[k], opts), r = longest(sc, p, at0, opts);
    const near = nearEnd(sc, st, p, r); // (a threat from far off: how far from the ball he still is as it ends)
    const score = r.G - .3 * Math.max(0, near - 2.5);
    if (!best || score > best.score + .001 || (Math.abs(score - best.score) < .001 && !r.dis.length && best.dis.length)) best = { ...p, ...r, k, want: p.G, score };
    if (r.G >= p.G - .001 && !r.dis.length && near <= 2.5) break; // the liveliest try that agrees all the way, with the threat close at the end
  }
  best.at0 = Object.fromEntries(Object.entries(st.at).map(([id, a]) => [id, { x: a.x, y: a.y }])); // (the scene's own picture: rings that go with a player are placed from it)
  if (best.a) { // the paths from where everyone is when it opens
    for (const path of Object.values(best.paths)) { const q = pathAt(path, best.a); Object.assign(path, { x: q.x, y: q.y }); }
  }
  return best;
}
// The longest window (up to the try's own, at least GAME_MIN) in which every choice agrees with its grade at every
// moment (sampled every STEP_T s), opening at a (0, or earlier with `fixed`). dis: what disagrees, when even the
// shortest window cannot be had.
const STEP_T = .05, ROOM = .85;
// How far the threat is from what he goes for as a window ends (0 when there is no threat).
function nearEnd(sc, st, p, r) {
  const id = p.threat?.id; if (!id || !p.paths[id] || r.dis.length) return 0;
  const q = pathAt(p.paths[id], r.a + r.G), t = p.threat.to ? { x: p.threat.to[0], y: p.threat.to[1] } : (() => { const c = st.ball?.carrier || 'hero', cp = p.paths[c]; return cp ? pathAt(cp, r.a + r.G) : st.at[c] || st.at.hero; })();
  return t ? Math.hypot(q.x - t.x, q.y - t.y) : 0;
}
function longest(sc, p, at0, opts) {
  const tmp = {}, lo = opts.fixed ? -EARLY : 0, n = Math.round((p.G - lo) / STEP_T), ok = [];
  let first = null;
  for (let i = 0; i <= n; i++) {
    const t = lo + i * STEP_T, d = disagree(sc, posAt(p, at0, t, tmp), t, { ...opts, at0 });
    ok.push(!d.length); if (d.length && t >= -1e-6 && !first) first = d;
  }
  // the longest run of agreeing samples, at most G long; of equal ones, the one opening nearest the scene's moment
  let bestG = -1, bestA = 0;
  for (let i = 0; i <= n; i++) {
    if (!ok[i]) continue;
    let j = i; while (j + 1 <= n && ok[j + 1] && (j + 1 - i) * STEP_T <= p.G + 1e-6) j++;
    const G = Math.round((j - i) * STEP_T * 100) / 100, a = Math.round((lo + i * STEP_T) * 100) / 100;
    if (G > bestG + 1e-6 || (Math.abs(G - bestG) < 1e-6 && Math.abs(a) < Math.abs(bestA))) { bestG = G; bestA = a; }
  }
  return bestG >= GAME_MIN - 1e-6 ? { G: bestG, a: bestA, dis: [] } : { G: GAME_MIN, a: 0, dis: first || ['?'] };
}
export function posAt(p, at0, t, cache = {}) {
  return id => { const path = p.paths[id]; if (!path) return at0(id); return pathAt(path, t, cache[id] ||= {}); };
}

// Builds the paths for one try. A try says, for each role, the velocity (m/s) it moves at in the window.
function build(sc, st, tr, opts) {
  const paths = {}, watch = new Set(tr.watch || []), at = st.at;
  for (const [id, a] of Object.entries(at)) {
    const v1 = [...(tr.v[id] || [0, 0])], v0 = opts.fixed ? [...v1] : [a.vx || 0, a.vy || 0];
    // (from play going on: one who is going the other way slows down and bends his way, he does not turn straight back)
    const s0 = Math.hypot(...v0), s1 = Math.hypot(...v1);
    if (!opts.fixed && s0 > .4 && s1 > .1 && (v0[0] * v1[0] + v0[1] * v1[1]) / (s0 * s1) < -.3) { const k = Math.min(1, .5 * s0 / s1); v1[0] = v0[0] * .35 + v1[0] * k * .3; v1[1] = v0[1] * .35 + v1[1] * k * .3; }
    if (tr.start?.[id] && Math.hypot(...v0) < .3 && Math.hypot(...v1) > .5) { const l = Math.hypot(...v1); v0[0] = v1[0] / l * .3; v0[1] = v1[1] / l * .3; } // (before he sets off: already leaning that way, a small step)
    paths[id] = { x: a.x, y: a.y, v0, v1, t1: tr.start?.[id] || 0, tau: opts.fixed && !tr.start?.[id] ? 0 : easeTime(v0, v1) };
  }
  // Nobody walks through anybody: two players whose ways come closer than ROOM in the window move together (the one with
  // less to do, not the player on the ball nor the threat, goes the other's way), so they stay as far apart as they are.
  const out = { G: tr.G || GAME, threat: tr.threat, paths, watch };
  const keep = new Set(['hero', st.ball?.carrier, tr.threat?.id]), list = Object.entries(paths).filter(([id]) => !st.at[id].gk), lo = opts.fixed ? -EARLY : 0, hi = out.G, q1 = {}, q2 = {};
  for (let n = 0; n < 2; n++) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    let dmin = 9;
    for (let t = lo; t <= hi + 1e-6; t += .1) { const a = pathAt(list[i][1], t, q1), b = pathAt(list[j][1], t, q2); dmin = Math.min(dmin, Math.hypot(b.x - a.x, b.y - a.y)); }
    if (dmin >= ROOM) continue;
    const [from, to] = keep.has(list[j][0]) ? [list[j][1], list[i][1]] : [list[i][1], list[j][1]];
    to.v0 = [...from.v0]; to.v1 = [...from.v1]; to.t1 = from.t1; to.tau = from.tau;
  }
  return out;
}

// ---------- the tries, by kind ----------
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k], mul = (a, k) => [a[0] * k, a[1] * k];
const unit = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
const perp = u => [-u[1], u[0]];
const roomAt = (st, p, skip) => Math.min(9, ...Object.entries(st.at).filter(([id]) => !skip.includes(id)).map(([, a]) => Math.hypot(a.x - p[0], a.y - p[1])));
const inside = (p, m = 1.2) => p[0] > m && p[0] < PITCH.L - m && p[1] > m && p[1] < PITCH.W - m;
// The side to move across to: the one with more room, and on the pitch.
function sideways(st, id, u, skip) {
  const a = st.at[id], c = [1, -1].map(s => { const d = mul(perp(u), s), q = [a.x + d[0] * 2, a.y + d[1] * 2]; return { d, r: inside(q) ? roomAt(st, q, [id, ...skip]) : -1 }; });
  return c.sort((p, q) => q.r - p.r)[0].d;
}
// Each player of `team` (besides `skip`) and what he does with the play: a marker (the nearest of the other team to one
// of ours, within 2.6 m) goes with his player; everyone else goes with the drift D, those far from the ball at part of
// it, plus their own small part: a friend steps across his line to the ball (to stay open), a defender a little toward the
// ball's side. `k`: how big their own part is.
function shape(sc, st, ball, D, v, k, skip, def = 'them') {
  const at = st.at, out = [];
  const outfield = Object.entries(at).filter(([id, a]) => !a.gk && !skip.includes(id));
  for (const [id, a] of outfield) {
    if (v[id]) continue;
    const near = Math.hypot(a.x - ball.x, a.y - ball.y) < 12, base = mul(D, near ? 1 : .6);
    // (never still: at least a slow walk with the play, research Q1: still for at most about a second)
    const u = unit(ball, a), sd = sideways(st, id, u, skip), own = mul(sd, Math.max(MOVE, (near ? .55 : .35) * k));
    let w = add(base, own); const sp = Math.hypot(...w); if (sp < MOVE) w = sp > .05 ? mul(w, MOVE / sp) : mul(sd, MOVE); // (never under a slow walk's start)
    v[id] = w; out.push(id);
  }
  // markers go exactly with the player they mark
  for (const [id, a] of outfield) {
    if (a.team !== def) continue;
    const foes = outfield.filter(([j, b]) => b.team !== a.team && !skip.includes(j)).map(([j, b]) => ({ j, d: Math.hypot(b.x - a.x, b.y - a.y) })).sort((p, q) => p.d - q.d);
    const f = foes[0]; if (!f || f.d > 2.6) continue;
    const back = outfield.filter(([j, b]) => b.team === a.team && j !== id).map(([j, b]) => ({ j, d: Math.hypot(b.x - at[f.j].x, b.y - at[f.j].y) })).sort((p, q) => p.d - q.d)[0];
    if (back && back.d < f.d) continue; // someone of his own team is nearer that player: that one marks him
    if (v[f.j]) v[id] = [...v[f.j]];
  }
  return out;
}
// The keepers: set (v64 research Q1: the keeper is still, "set", as a shot may come; his body still shows life:
// pro/keeper.js), also one who rushed out at him (then he is the threat, and smothers the ball at the end). A shot's
// result is worked out from where he stands (shot.js), so he must not drift.
function keepers(sc, st, D, v) { for (const [id, a] of Object.entries(st.at)) if (a.gk) v[id] = [0, 0]; } // (one who rushed out is set too, low, ready to smother: the threat)
// The threat: of the other team, the one who gets to the ball soonest (time to cover the distance, as a child runs).
function threatOf(st, team, ball, skip = []) {
  return Object.entries(st.at).filter(([id, a]) => a.team !== team && !skip.includes(id) && (!a.gk || a.rush)).map(([id, a]) => ({ id, a, d: Math.hypot(a.x - ball.x, a.y - ball.y) }))
    .sort((p, q) => p.d - q.d)[0];
}
const PRESS = 3.4, MOVE = .4; // MOVE: the least anyone moves in the window (m/s) on top of the drift // a defender this close to the ball presses it: he goes with the ball and edges in
// The presser's own part: in toward the ball, so that he gets `b` metres nearer over the window (he edges in, low and
// side-on, as he jockeys); `b` gets smaller in calmer tries.
const edge = (st, id, ball, b, G) => mul(unit(st.at[id], ball), b / G);

const TRIES = {
  // He has the ball. With a defender close (PRESS), he shields: small touches across, away from the defender, who goes
  // with him and edges in. Otherwise he keeps it rolling on his way, and the nearest of theirs comes at it.
  attack(sc, st) {
    const h = st.at.hero, ball = st.ball || { x: h.x + .5, y: h.y }, hv = [h.vx || 0, h.vy || 0], line = Math.hypot(...hv) > .2 ? mul(hv, 1 / Math.hypot(...hv)) : [1, 0];
    const th = threatOf(st, 'us', ball, []), out = [];
    if (!th) return [{ v: { hero: mul(line, .8) }, G: GAME }];
    const near = th.d < PRESS, u = unit(th.a, h);
    const behind = !near && (th.a.x - h.x) * line[0] + (th.a.y - h.y) * line[1] < 0;
    const rows = near ? [[.8, .35, 1], [.8, .2, .6], [.6, .2, .5], [.5, .12, .3], [.4, .06, .2], [.3, .03, 0]]
      : [[1.2, 3.4, 1], [1.2, 2.8, .6], [1.4, 2.2, .4], [1, 1.8, .3], [.8, 1.4, .2], [.6, 1.1, 0]];
    for (const [vh, b, k] of rows) {
      const D = near ? mul(sideways(st, 'hero', u, [th.id]), vh) : mul(line, vh), v = { hero: D };
      if (near) v[th.id] = add(D, edge(st, th.id, h, b, GAME));
      else if (behind) { // a recovery run: up toward his own goal, to get goal-side of the ball, not straight at him
        const off = [(th.a.x - h.x), (th.a.y - h.y)], side = off[0] * -line[1] + off[1] * line[0];
        const Q = { x: h.x + line[0] * 2 - line[1] * side * .7, y: h.y + line[1] * 2 + line[0] * side * .7 };
        v[th.id] = mul(unit(th.a, Q), b);
      } else v[th.id] = mul(u, b * .7); // in front, farther off: he steps up toward the ball
      shape(sc, st, ball, D, v, k, ['hero', th.id]);
      keepers(sc, st, D, v);
      out.push({ v, G: near ? GAME : GAME_FAR, threat: { id: th.id }, watch: near ? [th.id] : [] });
    }
    return out;
  },
  // They have the ball: their dribbler goes on toward our goal; everyone goes with the play (ours back toward our goal,
  // goal-side, facing the ball), and the rings go with the players they belong to.
  defense(sc, st) {
    const cid = sc.carrier || 'o1', c = st.at[cid], to = { x: 4.5, y: c.y + (PITCH.W / 2 - c.y) * .6 }, line = unit(c, to), out = [];
    for (const [vc, k] of [[1.2, 1], [1, .6], [.8, .4], [.6, .2], [.4, 0]]) {
      const D = mul(line, vc), v = { [cid]: D };
      v.hero = add(D, mul(line, .2 * k));
      shape(sc, st, c, D, v, k, [cid, 'hero'], 'us');
      keepers(sc, st, D, v);
      const ours = Object.keys(st.at).filter(id => st.at[id].team === 'us' && !st.at[id].gk);
      out.push({ v, G: GAME, threat: { id: cid, to: [to.x, to.y] }, watch: ours });
    }
    return out;
  },
  // A friend has the ball under pressure: he shields it with small touches across, the defender on him goes with him and
  // edges in (the threat), he himself steps across his line to the ball, and everyone else goes on a little.
  support(sc, st) { return friendBall(sc, st, false); },
  goal(sc, st) { return friendBall(sc, st, true); },
  // After the shot: the ball rolls to rest; the one of theirs who gets there first goes once he reacts; his friends jog
  // up, their others step back toward their goal.
  follow(sc, st) {
    const loose = { x: sc.shot.loose[0], y: sc.shot.loose[1] }, h = st.at.hero, out = [];
    const racer = Object.entries(st.at).filter(([, a]) => a.team === 'them' && !a.gk).map(([id, a]) => ({ id, a, t: Math.hypot(a.x - loose.x, a.y - loose.y) / DEF_RUN + reactOf(sc, id) })).sort((p, q) => p.t - q.t)[0];
    const hv = [h.vx || 0, h.vy || 0], hs = Math.hypot(...hv), hl = hs > .2 ? mul(hv, 1 / hs) : unit(h, loose);
    for (const [vr, k] of [[3.4, 1], [3, .6], [2.6, .3], [2.2, 0]]) {
      const v = { hero: mul(hl, .5) }, start = { [racer.id]: reactOf(sc, racer.id) };
      v[racer.id] = mul(unit(racer.a, loose), vr);
      for (const [id, a] of Object.entries(st.at)) {
        if (v[id] || a.gk) continue;
        v[id] = a.team === 'us' ? [1.2 * k + .4, 0] : [.8, 0];
      }
      keepers(sc, st, [0, 0], v);
      out.push({ v, G: GAME, threat: { id: racer.id, to: sc.shot.loose }, start, watch: [] });
    }
    return out;
  },
  // A pass is on its way to him: he steps toward it (to meet it), the defender behind him (if one) comes with him and
  // edges in, the others go on a little. The window is the ball's flight: he picks his turn before it gets to him.
  receive(sc, st) {
    const h = st.at.hero, ball = st.ball || { x: h.x - 1, y: h.y }, to = unit(h, ball), th = threatOf(st, 'us', h, []), out = [];
    for (const [vh, b, k] of [[.5, .4, 1], [.4, .25, .6], [.3, .12, .3], [.2, .05, 0]]) {
      const D = mul(to, vh), v = { hero: D };
      if (th && th.d < 4) v[th.id] = add(D, edge(st, th.id, h, b, GAME));
      shape(sc, st, h, D, v, k, ['hero', ...(th && th.d < 4 ? [th.id] : [])]);
      keepers(sc, st, [0, 0], v);
      out.push({ v, G: st.flight ? Math.max(GAME_MIN, st.flight - .1) : GAME, threat: th ? { id: th.id } : null, watch: th ? [th.id] : [] });
    }
    return out;
  },
  // "Pass in front!": his friend runs on (the rings with him), the defender chasing him too; he keeps it rolling, the
  // defender near him goes with him and edges in (the threat), their last defender drifts across to the run.
  lead(sc, st) {
    const h = st.at.hero, mv = sc.moves, [dx, dy] = sc.dir, out = [], th = threatOf(st, 'us', h, ['o2', 'o3', 'o4']);
    for (const [vh, b, k, G] of [[.6, .25, 1, GAME], [.5, .15, .5, 1.3], [.45, .08, .2, 1.1], [.4, .04, 0, .9]]) {
      const D = th ? mul(sideways(st, 'hero', unit(th.a, h), [th.id]), vh) : [vh, 0], v = { hero: D, m1: [dx * mv.m1.speed, dy * mv.m1.speed] };
      if (mv.o2) v.o2 = [dx * mv.o2.speed, dy * mv.o2.speed];
      if (th) v[th.id] = add(D, edge(st, th.id, h, b, G));
      const o3 = st.at.o3; if (o3) v.o3 = mul(unit(o3, { x: o3.x - dx * 3, y: o3.y + (st.at.m1.y - o3.y) * .3 }), Math.max(MOVE, .8 * (k + .3)));
      shape(sc, st, h, D, v, k, ['hero', 'm1', ...(mv.o2 ? ['o2'] : []), 'o3', ...(th ? [th.id] : [])]);
      keepers(sc, st, D, v);
      out.push({ v, G, threat: th ? { id: th.id } : null, watch: th ? [th.id] : [] });
    }
    return out;
  },
};
// A friend with the ball (getting open, a give-and-go's run, running to the goal with him).
function friendBall(sc, st, goal) {
  const cid = sc.carrier || 'm1', c = st.at[cid], th = threatOf(st, 'us', c, ['hero']), h = st.at.hero, out = [];
  const g = { x: PITCH.L, y: PITCH.W / 2 }, fwd = unit(c, g);
  // (a friend about to shoot, 'go-shot': he lines it up calmly, as the race for the rebound is close)
  for (const [vc, b, vh, k] of goal && sc.shot ? [[.4, .03, .4, 0]] : goal ? [[1.2, .3, 1, 1], [1, .2, .8, .6], [.8, .12, .6, .4], [.6, .06, .4, .2], [.4, .03, .4, 0]] : [[.6, .3, .5, 1], [.5, .2, .45, .6], [.45, .12, .4, .3], [.4, .06, .4, 0]]) {
    const D = goal ? mul(fwd, vc) : mul(sideways(st, cid, th ? unit(th.a, c) : [1, 0], th ? [th.id] : []), vc), v = { [cid]: D };
    if (th) v[th.id] = add(D, edge(st, th.id, c, b, GAME));
    const hv = [h.vx || 0, h.vy || 0], hs = Math.hypot(...hv);
    v.hero = goal ? add(mul(D, .8), mul(hs > .2 ? mul(hv, 1 / hs) : fwd, .2 * vh))
      : sc.then ? mul(unit(h, c), Math.max(MOVE, vh)) // (after his pass: he steps after it, still behind the defender who now stands between them)
      : mul(sideways(st, 'hero', unit(c, h), []), vh); // with the play; or across his line to the ball
    shape(sc, st, c, goal ? D : mul(D, .4), v, k, [cid, 'hero', ...(th ? [th.id] : [])]);
    keepers(sc, st, D, v);
    out.push({ v, G: GAME, threat: th ? { id: th.id } : null, watch: th ? [th.id] : [] });
  }
  return out;
}
export const __tries = (sc, st, opts) => TRIES[kindOf(sc)](sc, st, opts); // (for tools)

// ---------- round 2: the window ends where the scene was graded (v64) ----------
// The scene's own picture is the moment the threat arrives: the end of the window. The window opens G_PRE s earlier in
// the same play. Everyone is on his way to his place in that picture, as play really goes: the threat runs in (fast, then
// braking over his last 1.6 m into a low stance), a friend runs into the open space he will stand in, a marker closes on
// his man, a cover defender shifts across, the player on the ball carries it on his way. When the threat starts far from
// the ball in the scene (he was getting back, not pressing), the window goes on past the scene's moment until he gets
// there (G_POST). Each choice is graded as the scene says; what decides a choice's result is the play itself, which goes
// on as it was going after his tap (the threat keeps coming), and the motion audit checks every result at an early,
// middle and late tap against the scene's own play (scripts/motion-audit.js). planArrival returns the plan in the same
// shape as planWindow (paths keyed by player, read with pathAt from the window's opening), plus `cls`: 'full' (the whole
// G_PRE lead-in), 'short' (a shorter one, where the run could not start on the pitch).
export const G_PRE = [1.5, 1.2, .9, .6], STANCE = 1.7, PRESSING = 2.8;
// The last resort (round 2): patterns where a tap early in the full lead-in ends another way than the scene's own play
// (the motion audit plays every choice early, midway and late), with the shorter lead-ins they get instead.
// 'co-moving': the round-1 plan (play moving together, the scene's picture at the window's start).
//   (round 3: keeper-out (5v5) now comes in full, the keeper seen rushing out: a shot early in his run, before he is out,
//   goes in, and that is the true result for an early tap; scripts/motion-audit.js says so)
export const SHORT_LEAD = { 'go-shot': [1.2] };
//   go-shot (4v4): running to the goal when his friend will shoot: tapped early in a 1.5 s lead-in, the okay run is
//   still too far back to win the rebound race. 1.2 s holds it.
// Child speeds for each role's run (m/s; research Q1): vRun, vEnd (as he gets there), dB (the metres he slows over).
export const RUN = {
  threat: [3.4, 1, 1.6], far: [4.2, 1, 1.6], stepUp: [3.2, .3, 1.8], // closing down; a recovery run from far off; stepping up to the ball
  carry: [1.8, 1.1, .6],                                  // the player on the ball, carrying it on, slowing to look up
  open: [2.2, .6, 1], openFar: [1.1, .5, .5],             // a friend running into the space he will stand in (near, or far from the ball)
  cover: [1.4, .4, .6], walk: [1, .5, .5],                // a cover defender shifting across; a far player walking with the play
  attack: [2.4, 1.6, .8], recover: [3.2, 2.2, 1],          // their dribbler driving at our goal; his recovery run (defending)
  still: [0, 0, 0], standOff: [.8, .2, .3],
  shield: [.9, .4, .3], drive: [2.8, 2, .8], jog: [2.6, 1.6, .8], step: [1.4, .9, .4], keeper: [.4, 0, .25],
};
const U = ([x, y]) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const arr = (P, u, [vRun, vEnd, dB], T = 0) => ({ arr: true, P: [...P], u: U(u), vRun, vEnd, dB, T, base: 0 });
// How long a run of `d` metres takes on profile [vRun, vEnd, dB].
const runTime = (d, [vRun, vEnd, dB]) => { const dv = vRun * vRun - vEnd * vEnd, a = vRun > vEnd ? Math.min(BRAKE, dv / (2 * dB)) : 0, db = a ? dv / (2 * a) : 0, tb = a ? (vRun - vEnd) / a : 0; return d <= db ? (Math.sqrt(vEnd * vEnd + 2 * a * d) - vEnd) / Math.max(a, .1) : tb + (d - db) / vRun; };

export function planArrival(sc, st, opts = {}) {
  const kind = kindOf(sc); if (kind === 'tackle' || kind === 'follow' || SHORT_LEAD[sc.pattern] === 'co-moving') return null;
  const at = st.at, skip = new Set(opts.skip || []), ids = Object.keys(at).filter(id => !skip.has(id)), out = ids.filter(id => !at[id].gk), paths = {}, role = {}, watch = new Set();
  const P = id => [at[id].x, at[id].y], d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const holder = kind === 'defense' ? sc.carrier || 'o1' : kind === 'support' || kind === 'goal' ? sc.carrier || 'm1' : 'hero';
  const us = id => at[id].team === 'us', ballTeam = at[holder].team, defTeam = ballTeam === 'us' ? 'them' : 'us';
  const goal = { x: ballTeam === 'us' ? PITCH.L : 0, y: PITCH.W / 2 };
  const fixedPaths = opts.keep || {}; // (paths given by the scene itself: a lead pass's runners)
  const dead = !!sc.restart; // (a restart: a dead ball)
  // The player on the ball, and the hero
  const H = P(holder), line = kind === 'defense' ? U([4.5 - H[0], PITCH.W / 2 + (H[1] - PITCH.W / 2) * .6 - H[1]]) : sc.hero && sc.heroTo && holder === 'hero' ? U([sc.heroTo[0] - sc.hero[0] || 1, sc.heroTo[1] - sc.hero[1]]) : U([goal.x - H[0], goal.y - H[1]]);
  // (a restart: a dead ball. The taker stands over it, life only in his body; their players stand off, adjusting a step;
  // friends move to find space. Nobody runs in to tackle.)
  paths[holder] = arr(H, kind === 'support' ? perp(line) : line, dead ? RUN.still : kind === 'defense' ? RUN.attack : kind === 'support' ? RUN.shield : kind === 'goal' ? RUN.drive : RUN.carry); role[holder] = 'ball';
  if (holder !== 'hero') {
    const h = P('hero'), from = sc.hero && sc.heroTo ? U([sc.heroTo[0] - sc.hero[0], sc.heroTo[1] - sc.hero[1]]) : U([goal.x - h[0], goal.y - h[1]]);
    paths.hero = dead ? arr(h, Math.hypot(...from) > .1 ? from : U([goal.x - h[0], 0]), RUN.walk) // (a restart: he walks, looking for his place)
      : arr(h, kind === 'defense' ? (Math.hypot(...from) > .1 ? from : [-1, 0]) : kind === 'receive' ? U([P('m1')[0] - h[0], P('m1')[1] - h[1]]) : from, kind === 'defense' ? RUN.recover : kind === 'goal' ? RUN.jog : RUN.step); role.hero = 'hero';
  } else if (kind === 'receive') { const m = P(sc.carrier || 'm1'), h = P('hero'); paths.hero = arr(h, [m[0] - h[0], m[1] - h[1]], RUN.step); }
  // The threat: of the other team, the one who gets to the ball first (one the camera sees as he comes first, unless
  // the idea is a defender he cannot see: peek, then turn); for their dribbler, he himself (nearing the shooting spot).
  let th = null;
  // (seen: in his head-up view, looking the way the scene has him look; view.js camSpec: from 5.2 m behind him, about
  // 44° to each side at 844x390, a little less to be sure)
  const view = opts.yaw ?? Math.atan2(line[1], line[0]);
  const seen = (q, h = P('hero'), yaw = view) => { const e = [h[0] - 5.2 * Math.cos(yaw), h[1] - 5.2 * Math.sin(yaw)], a = Math.atan2(q[1] - e[1], q[0] - e[0]) - yaw; return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < .66; };
  if (kind === 'defense') th = holder;
  else {
    const cand = ids.filter(id => at[id].team === defTeam && (!at[id].gk || at[id].rush) && !fixedPaths[id]).map(id => {
      const p = P(id), d = d2(p, H);
      return { id, d, cost: at[id].rush ? -1 : d }; // (a keeper rushing out at him is the one who comes) (round 3: the nearest of them to the ball in the picture is the one who comes for it; one from behind is shown coming by a wider view, view.js)
    }).sort((a, b) => a.cost - b.cost);
    th = cand[0]?.id || null;
  }
  // Gpost: a threat the scene has far from the ball runs on past his place until he gets there.
  const holderAt = t => arrAt(paths[holder], t), stanceFrom = (p, t) => { const h = holderAt(t); const u = U([h.x - p[0], h.y - p[1]]); return { u, A: [h.x - u[0] * STANCE, h.y - u[1] * STANCE], d: Math.hypot(h.x - p[0], h.y - p[1]) }; };
  let Gpost = 0;
  if (th && kind !== 'defense') {
    const p = P(th), d0 = d2(p, H);
    // (a pass to him: the window ends as it gets to him, wherever the threat is; running to the goal, it ends at the
    // scene's picture: the pass decides it, not who gets to the friend on the ball)
    if (d0 > PRESSING && kind !== 'receive' && kind !== 'goal') for (let k = 0; k < 3; k++) { const s0 = stanceFrom(p, Gpost); Gpost = runTime(Math.max(0, s0.d - STANCE), RUN.far); }
    const s0 = stanceFrom(p, Gpost), u = Gpost ? s0.u : U([H[0] - p[0], H[1] - p[1]]);
    if (dead) Gpost = 0;
    paths[th] = dead ? arr(p, u, RUN.standOff) : Gpost ? { ...arr(s0.A, u, RUN.far), T: Gpost } : arr(p, u, kind === 'goal' ? RUN.stepUp : RUN.threat); // (running to the goal: their defender steps up to the friend on the ball, all but stopped as it opens)
    // (from his place in the scene on to the ball: the path passes his place at 0 when it is on his line)
    if (Gpost) { const r = Math.hypot(s0.A[0] - p[0], s0.A[1] - p[1]); paths[th].T = runTime(r, RUN.far); Gpost = paths[th].T; }
    role[th] = 'threat'; watch.add(th);
  } else if (th) role[th] = 'threat';
  // (round 3) A defender the ball has gone past (behind it on its way, close): he chases it, a little quicker than it
  // goes, so he closes on it from behind; never walking off away from it.
  if (!dead && kind !== 'defense') for (const id of out) {
    if (id === th || paths[id] || fixedPaths[id] || at[id].team !== defTeam) continue;
    const p = P(id), rel = (p[0] - H[0]) * line[0] + (p[1] - H[1]) * line[1];
    if (rel < -.5 && d2(p, H) < 5) { const hp = paths[holder]; paths[id] = arr(p, line, [Math.min(4, (hp?.vRun || 1.8) + .7), Math.min(3, (hp?.vEnd || 1.1) + .5), .6]); role[id] = 'chaser'; }
  }
  // Markers: of the defending team, the nearest to one of the attackers (within 2.6 m, and nearer him than any of his own team).
  for (const id of out) {
    if (paths[id] || fixedPaths[id] || at[id].team !== defTeam) continue;
    const foes = out.filter(j => at[j].team === ballTeam && j !== holder).map(j => ({ j, d: d2(P(j), P(id)) })).sort((a, b) => a.d - b.d), f = foes[0];
    if (!f || f.d > 2.6 || out.some(k => k !== id && at[k].team === defTeam && d2(P(k), P(f.j)) < f.d)) continue;
    role[id] = 'marker:' + f.j;
  }
  // Friends (and, defending, their players off the ball): into the space they will stand in, away from the nearest of the other team.
  for (const id of out) {
    if (paths[id] || fixedPaths[id] || role[id]) continue;
    const p = P(id), near = d2(p, H) < 12;
    if (at[id].team === ballTeam) {
      const foe = out.filter(j => at[j].team !== at[id].team).map(j => P(j)).sort((a, b) => d2(a, p) - d2(b, p))[0];
      const u = kind === 'defense' ? U([goal.x - p[0], goal.y - p[1]]) : foe ? U([p[0] - foe[0], p[1] - foe[1]]) : line;
      paths[id] = arr(p, u, kind === 'defense' ? RUN.jog : near ? RUN.open : RUN.openFar); role[id] = 'friend';
    } else { // a cover defender steps across toward the ball's side, from behind the presser's line; far off, he walks in toward the play (never away from the ball)
      const tb = U([H[0] - p[0], H[1] - p[1]]), u = near ? U([tb[0] * .6, (Math.sign(H[1] - p[1]) || 1) * .8 + tb[1] * .2]) : tb;
      paths[id] = arr(p, u, near ? RUN.cover : RUN.walk); role[id] = 'cover';
    }
  }
  for (const id of out) { const m = role[id]?.startsWith('marker:') && role[id].slice(7); if (!m || paths[id]) continue; // a marker goes where his man goes, a little quicker: he closes on him
    const mp = paths[m]; paths[id] = arr(P(id), mp ? mp.u : line, mp ? [mp.vRun + .5, mp.vEnd, mp.dB] : RUN.cover); watch.add(id); }
  for (const id of ids) if (at[id].gk && !paths[id] && !fixedPaths[id]) { // keepers: small steps across with the ball's side, set as it ends
    const p = P(id); paths[id] = arr(p, [0, Math.sign(H[1] - p[1]) || 1], RUN.keeper); }
  Object.assign(paths, fixedPaths);
  // The lead-in: the longest of G_PRE whose start has the threat (and the player on the ball) on the pitch, with nobody
  // walking through anybody.
  const inside = (q, m = .6) => q.x > m && q.x < PITCH.L - m && q.y > m && q.y < PITCH.W - m;
  const GP = opts.Gpre || SHORT_LEAD[sc.pattern] || (kind === 'defense' ? [2, ...G_PRE] : G_PRE); // (defending: their dribbler comes on from a little further, so his run shows in the wider view)
  // Anyone else who would start off the pitch runs less far (a slower run, from inside it). Two whose ways would cross
  // closer than bodies allow: one of them (not the threat, nor the player on the ball) comes in on a slightly different
  // line, turned about his place in the picture, the least that clears it (or else he only walks in). True if all clear.
  function settle(Gpre) {
    for (const id of out) { const p = paths[id]; if (!p?.arr || p === paths[th] || id === holder || fixedPaths[id]) continue; let k = 0; while (!inside(arrAt(p, -Gpre), .4) && k++ < 6) { p.vRun *= .7; p.vEnd = Math.min(p.vEnd, p.vRun); } }
    for (let n = 0; n < 6; n++) {
      const c = clash(paths, out, -Gpre, Gpost); if (!c) return true;
      const id = c.find(i => i !== th && i !== holder && !fixedPaths[i] && paths[i]?.arr); if (!id) return false;
      const p = paths[id], u0 = [...p.u]; let ok = false;
      for (let k = 1; k <= 12 && !ok; k++) for (const sgn of [1, -1]) {
        const a = sgn * k * .15; p.u = [u0[0] * Math.cos(a) - u0[1] * Math.sin(a), u0[0] * Math.sin(a) + u0[1] * Math.cos(a)];
        const c2 = clash(paths, out, -Gpre, Gpost); if (inside(arrAt(p, -Gpre), .4) && (!c2 || !c2.includes(id))) { ok = true; break; }
      }
      if (!ok && c.includes(th) && paths[th]?.arr) { // (or the threat comes in on a slightly different line, round him)
        const q = paths[th], w0 = [...q.u], in0 = inside(arrAt(q, -Gpre));
        for (let k = 1; k <= 10 && !ok; k++) for (const sgn of [1, -1]) {
          const a = sgn * k * .08; q.u = [w0[0] * Math.cos(a) - w0[1] * Math.sin(a), w0[0] * Math.sin(a) + w0[1] * Math.cos(a)];
          const c2 = clash(paths, out, -Gpre, Gpost); if ((inside(arrAt(q, -Gpre)) || !in0) && (!c2 || !c2.includes(th))) { ok = true; break; }
        }
        if (!ok) q.u = w0;
        p.u = u0;
      }
      if (!ok) { // (or he comes in quicker or slower, on his own line: the two pass at another moment)
        const v0 = [p.vRun, p.vEnd]; p.u = u0;
        for (const k of [1.4, .6, 1.8, .4]) { p.vRun = Math.min(3.2, v0[0] * k); p.vEnd = Math.min(p.vRun, v0[1] * k); const c2 = clash(paths, out, -Gpre, Gpost); if (inside(arrAt(p, -Gpre), .4) && (!c2 || !c2.includes(id))) { ok = true; break; } }
        if (!ok) { p.vRun = v0[0]; p.vEnd = v0[1]; }
      }
      if (!ok) { p.u = u0; p.vRun = Math.min(p.vRun, 1); p.vEnd = Math.min(p.vEnd, p.vRun); }
    }
    return !clash(paths, out, -Gpre, Gpost);
  }
  const snap = () => Object.fromEntries(Object.entries(paths).filter(([, p]) => p.arr).map(([id, p]) => [id, { u: [...p.u], vRun: p.vRun, vEnd: p.vEnd }]));
  const back = sn => { for (const [id, v] of Object.entries(sn)) Object.assign(paths[id], { u: [...v.u], vRun: v.vRun, vEnd: v.vEnd }); };
  let Gpre = GP[GP.length - 1], cls = 'short';
  const sn0 = snap(); let found = false;
  for (const g of GP) {
    const ok = [th, dead ? null : holder].filter(Boolean).every(id => inside(arrAt(paths[id], -g))); // (a restart's taker stands on the line)
    if (ok && settle(g)) { Gpre = g; cls = SHORT_LEAD[sc.pattern] && !opts.Gpre ? 'last-resort' : g === GP[0] ? 'full' : 'short'; found = true; break; }
    back(sn0);
  }
  if (!found) settle(Gpre);
  // The threat is seen coming (point 5): if he would start out of the head-up view, his run comes in a little more from
  // in front (turned about the place he gets to, up to 50°), unless the idea is a defender he cannot see (a pass to
  // him with his back to their goal).
  // If even that cannot bring him into view, the view itself turns toward him (look: the yaw the run-up turns to), as
  // little as does it. Off the pitch at the start, his run turns in the same way, and if it must, he comes a little slower.
  const tp = th && paths[th]; let look = null;
  if (tp?.arr) {
    const hq = () => { const r = paths.hero?.arr ? arrAt(paths.hero, -Gpre) : at.hero; return [r.x, r.y]; };
    const q0 = () => { const r = arrAt(tp, -Gpre); return [r.x, r.y]; }, u0 = [...tp.u], look4 = kind !== 'receive' && kind !== 'defense';
    const good = (need) => { const q = q0(); return (!need || seen(q, hq())) && inside({ x: q[0], y: q[1] }) && !clash(paths, out, -Gpre, Gpost); };
    if (!good(look4)) {
      let best = null;
      for (const need of look4 ? [true, false] : [false]) for (let k = 1; k <= 9 && !best; k++) for (const sgn of [1, -1]) {
        const a = sgn * k * .1; tp.u = [u0[0] * Math.cos(a) - u0[1] * Math.sin(a), u0[0] * Math.sin(a) + u0[1] * Math.cos(a)];
        if (good(need)) { best = tp.u; break; }
      }
      tp.u = best || u0;
      // (still off the pitch: he was further back, and comes on a little slower; a run on past the picture takes longer)
      for (let k = 0; k < 6 && !inside(arrAt(tp, -Gpre)); k++) {
        tp.vRun = Math.max(2.4, tp.vRun * .85);
        if (Gpost) { const r = Math.hypot(tp.P[0] - at[th].x, tp.P[1] - at[th].y); tp.T = runTime(r, [tp.vRun, tp.vEnd, tp.dB]); Gpost = tp.T; }
      }
      if (look4 && !seen(q0(), hq())) for (let k = 1; k <= 14 && look == null; k++) for (const sgn of [1, -1]) if (seen(q0(), hq(), view + sgn * k * .1)) { look = view + sgn * k * .1; break; }
    }
  }
  // (round 3) A marker has been tracking his man: as the window opens he is a step from him on the goal side, and goes
  // with him to his place in the picture, straight, at an even pace.
  const theirGoal = { x: ballTeam === 'us' ? PITCH.L : 0, y: PITCH.W / 2 };
  for (const id of out) {
    const man = role[id]?.startsWith('marker:') && role[id].slice(7); if (!man || !paths[man]?.arr || !paths[id]?.arr) continue;
    const m0 = arrAt(paths[man], -Gpre), gu = U([theirGoal.x - m0.x, theirGoal.y - m0.y]), S = [m0.x + gu[0] * 1.2, m0.y + gu[1] * 1.2], E = P(id), r = d2(S, E);
    if (r < .3) { paths[id] = arr(E, gu, [.6, .6, 0]); continue; }
    if (opts.Gpre) continue; // (an intro that plans its own lead-in: he goes with his man as before)
    // (the offset changes by no more than a child's pull allows over the lead-in: 6·Δ/T² ≤ 2.5 m/s²)
    const M = P(man), o1 = [E[0] - M[0], E[1] - M[1]], dv = [S[0] - m0.x - o1[0], S[1] - m0.y - o1[1]], dl = Math.hypot(...dv), cap = 2.5 * Gpre * Gpre / 6, k = dl > cap ? cap / dl : 1;
    let o0 = [o1[0] + dv[0] * k, o1[1] + dv[1] * k];
    { const ex = o1[0] - o0[0], ey = o1[1] - o0[1], L2 = ex * ex + ey * ey || 1e-9, tt = clamp(-(o0[0] * ex + o0[1] * ey) / L2, 0, 1); if (Math.hypot(o0[0] + ex * tt, o0[1] + ey * tt) < .8) o0 = [...o1]; } // (never through his man: else he keeps his place by him)
    paths[id] = { rel: true, man: paths[man], o0, o1, T: Gpre };
  }
  settle(Gpre); // (again, after the threat's run may have turned)
  // (round 3) Somebody comes for the ball: as the window opens, the presser is the nearest to it of their players the
  // picture leaves free (not marking a man). One nearer comes in from a little farther on his own line (a quicker run,
  // in toward the play); failing that, the presser starts a little nearer (a shorter run).
  if (th && paths[th]?.arr && !dead && kind !== 'defense') {
    const Hs = () => { const q = arrAt(paths[holder], -Gpre); return [q.x, q.y]; }, at0 = id => { const q = arrAt(paths[id], -Gpre); return [q.x, q.y]; }, dd = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const free = out.filter(id => id !== th && at[id].team === defTeam && paths[id]?.arr && !fixedPaths[id] && !role[id]?.startsWith('marker:'));
    for (let n = 0; n < 16; n++) {
      const h = Hs(), dp = dd(at0(th), h), near = free.filter(id => dd(at0(id), h) < dp + .3); if (!near.length) break;
      for (const id of near) { const p = paths[id], tb = U([h[0] - at[id].x, h[1] - at[id].y]);
        if (p.u[0] * tb[0] + p.u[1] * tb[1] < .2) p.u = U([p.u[0] * .3 + tb[0], p.u[1] * .3 + tb[1]]);
        if (p.vRun < 3.2) { p.vRun = Math.min(3.2, Math.max(p.vRun, .6) * 1.3); } }
      if (n >= 5) { const p = paths[th]; p.vRun = Math.max(1.8, p.vRun * .88); p.vEnd = Math.min(p.vEnd, p.vRun); }
    }
    settle(Gpre); // (their new lines may cross someone's)
  }
  for (const p of Object.values(paths)) if (p.arr) p.base = -Gpre;
  const at0 = Object.fromEntries(ids.map(id => [id, { x: at[id].x, y: at[id].y }]));
  return { arrival: true, G: Gpre + Gpost, a: -Gpre, Gpre, Gpost, cls, look, paths, threat: th ? { id: th, ...(kind === 'defense' ? { to: [4.5, H[1] + (PITCH.W / 2 - H[1]) * .6] } : {}) } : null, watch, at0, dis: [], k: 0, role };
}
// From play already going (a rebound, a match): everyone goes from where he is, as he moves, to where the decision's
// picture has him at its end (`end`), in G seconds; the threat gets there moving in, the rest settling.
export function planLive(st, end, G, threat = null) {
  const paths = {}, watch = new Set();
  for (const [id, a] of Object.entries(st.at)) {
    const E = end[id]; if (!E) continue;
    const dx = E[0] - a.x, dy = E[1] - a.y, d = Math.hypot(dx, dy), u = d > .05 ? [dx / d, dy / d] : [0, 0];
    const v1 = a.gk ? 0 : id === threat ? Math.min(1.2, d / G) : Math.min(.6, d / G);
    paths[id] = { herm: true, S: [a.x, a.y], V0: [a.vx || 0, a.vy || 0], E: [...E], V1: [u[0] * v1, u[1] * v1], T: G };
  }
  if (threat) watch.add(threat);
  const at0 = Object.fromEntries(Object.entries(end).map(([id, p]) => [id, { x: p[0], y: p[1] }]));
  return { live: true, arrival: true, G, a: 0, Gpre: G, Gpost: 0, cls: 'live', paths, threat: threat ? { id: threat } : null, watch, at0, dis: [], k: 0 };
}
// Whether two players' ways come closer than .6 m in the window (scene-time from..to).
export function clash(paths, ids, from, to) {
  const q1 = {}, q2 = {}, at = (p, t, q) => { if (p.arr) return arrAt(p, t, q); if (!p.rel || !p.man.arr) return null; // (scene time; a marker's way from his man's)
    const m = arrAt(p.man, t, q), k = Math.min(1, Math.max(0, (t + p.T) / p.T)), sm = k * k * (3 - 2 * k); q.x = m.x + p.o0[0] + (p.o1[0] - p.o0[0]) * sm; q.y = m.y + p.o0[1] + (p.o1[1] - p.o0[1]) * sm; return q; };
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = paths[ids[i]], b = paths[ids[j]]; if (!a || !b || !(a.arr || a.rel) || !(b.arr || b.rel)) continue;
    for (let t = from; t <= to + 1e-6; t += .05) { const p = at(a, t, q1), q = at(b, t, q2); if (p && q && Math.hypot(p.x - q.x, p.y - q.y) < .6) return [ids[i], ids[j]]; }
  }
  return null;
}
