// The decision window (v64): the world no longer stops while he chooses. Play drops into slow motion and goes on, and
// he has a limited time, shown by the defender coming for the ball. This file is pure (no game, no page): the window's
// length, how everyone moves in it, and the check that what he sees agrees with how each choice is graded. The game
// (game/window.js), the tests and the audits (scripts/motion-audit.js) all use it.
//
// How it works (v66). Each scene is graded from one picture (generate.js). That picture holds for the whole window: the
// whole group drifts with the play and each player adds one small steady movement of his own, so every relation between
// players that a grade rests on stays as it was (planHold, below, checks it at every moment with `disagree`). One player
// does not hold his place: the threat, who runs in at the ball from farther out on the bearing the picture has him on,
// and gets to it as the window ends: he takes it.
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
// Child speeds (v64 research, section 1, ages 6–8) and the most a child speeds up or slows down: the motion audit's limits.
export const SPEED = { stand: .2, walk: [.8, 1.3], jog: [1.8, 2.5], run: [3, 3.5], sprint: [4, 4.5] }, ACC = 3.5;

// ---------- paths ----------
// A player's way through the window: from (x, y), at velocity v0, changing smoothly to v1 between t1 and t1 + tau (game
// seconds after the window opens), then on at v1. The change is a smoothstep, so it starts and ends gently; its strongest
// pull is 1.5 |v1 - v0| / tau, kept under ACC.
export const easeTime = (v0, v1, t1 = 0) => Math.max(.35, Math.hypot(v1[0] - v0[0], v1[1] - v0[1]) * 1.5 / ACC);
export function pathAt(p, t, out = { x: 0, y: 0, vx: 0, vy: 0 }) {
  if (p.run) return runAt(p, t, out);
  if (p.arr) return arrAt(p, t + (p.base || 0), out);
  if (p.go) return goAt(p, t, out);
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
const gPs = new WeakMap(), gP = sc => { let g = gPs.get(sc); if (!g) gPs.set(sc, g = grade(sc)); return g; };
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
    if (!sc.live && gP(sc)[o] !== g0[o] && !o.startsWith('shoot:')) continue; // (a grade the scene set by hand, not from the picture alone: a dribble out over the line at a restart)
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
  if (k === 'follow') return sp.id === 'watch' ? 'hero' : null; // (a place on the grass: where the ball comes out to)
  if ((k === 'support' || k === 'goal') && !sc.shot) return sc.carrier || 'm1'; // (v66) a place to run to goes with the play: with the friend on the ball
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

// ---------- the plan (v66): the shape holds, one defender comes ----------
// The scene's own picture P (the positions its choices were graded from) is the picture for the whole window, not its
// end. Everybody except one player keeps P's arrangement all through: the whole group drifts with the play at a walk or
// a slow jog (the way the ball is being carried), and inside that each player makes one small, steady movement of his
// own (a friend steps across to keep his lane, a marker mirrors his man, a cover defender shuffles toward the ball's
// side, a keeper adjusts on his line). So a friend graded open is open from the first moment to the last, a marked
// friend is marked, a blocked lane is blocked. The one player who does not hold his place is the threat: the free
// defender P puts nearest the ball. As the window opens he is farther back on the same bearing from the ball as in P,
// and he runs straight in for the whole window (speeding up gently, never braking), reaching the ball as the ring
// empties. Choices that are right or wrong because of him are judged by where he comes from (his bearing), not by how
// far off he still is (agreeAt).
export const PACE = .12;                       // the slowest the world goes in a window (as a share of real time)
export const RUNIN = 6.5, CONTACT = .6;        // how far out the threat starts where there is room (m); how near the ball he gets (m)
export const V_RUN = { min: 1.8, tight: 1.5, pref: 3.3, max: 4.1 }; // his average speed over the run-in (m/s): a jog at the least, a run by choice
const ROOM = .85, STEP_T = .1, MOVE = .45, STEP_OWN = .9, BEAR = .45; // BEAR: how far (rad) his bearing may differ from P's
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k], mul = (a, k) => [a[0] * k, a[1] * k], len = a => Math.hypot(a[0], a[1]);
const U = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; }, perp = u => [-u[1], u[0]], rotv = (u, a) => [u[0] * Math.cos(a) - u[1] * Math.sin(a), u[0] * Math.sin(a) + u[1] * Math.cos(a)];
const onPitch = (x, y, m = .5) => x > m && x < PITCH.L - m && y > m && y < PITCH.W - m;

// The threat's run: from S along u, at v0 as the window opens, up to v1 over ta s, then on at v1 (also past the window's
// end). Before it opens (the run-up) he was coming at a jog and speeding up (vPre).
export function runAt(p, t, out = { x: 0, y: 0, vx: 0, vy: 0 }) {
  t += p.shift || 0; // (a run that set off before the window opened: a give-and-go's second step)
  const a = p.ta > 0 ? (p.v1 - p.v0) / p.ta : 0; let s, v;
  if (t >= p.ta) { s = (p.v0 + p.v1) / 2 * p.ta + p.v1 * (t - p.ta); v = p.v1; }
  else if (t >= 0) { s = p.v0 * t + .5 * a * t * t; v = p.v0 + a * t; }
  else { const tb = Math.max(0, (p.v0 - p.vPre) / 2.5); if (t > -tb) { s = p.v0 * t + 1.25 * t * t; v = p.v0 + 2.5 * t; } else { s = -p.v0 * tb + 1.25 * tb * tb + p.vPre * (t + tb); v = p.vPre; } }
  out.x = p.S[0] + p.u[0] * s; out.y = p.S[1] + p.u[1] * s; out.vx = p.u[0] * v; out.vy = p.u[1] * v; return out;
}
const mkRun = (S, E, G, v0 = null) => { const d = [E[0] - S[0], E[1] - S[1]], L = len(d), ta = Math.min(.6, G * .35), w0 = v0 == null ? null : v0;
  const v1 = w0 == null ? L / (G - .15 * ta) : (L - w0 * ta / 2) / (G - ta / 2); const s0 = w0 == null ? .7 * v1 : w0;
  return { run: true, S: [...S], u: U(d), v0: s0, v1, ta, vPre: Math.min(s0, 1.5), L }; };

// Where the ball is for the plan: at the feet of the player on it (a step ahead of his own player, as generate.js
// grades it); a pass on its way to him: where it comes to (him).
const ballOf = (sc, kind, holder, p) => (holder === 'hero' && kind !== 'receive' ? { x: p.x + .5, y: p.y } : { x: p.x, y: p.y });
const holderOf = (sc, kind = kindOf(sc)) => (kind === 'defense' ? sc.carrier || 'o1' : kind === 'support' || kind === 'goal' ? sc.carrier || 'm1' : 'hero');
// How a choice is rated in the scene: 'good', 'safe' or 'bad' (every kind of decision).
function ratedAs(sc, o, kind, g0) {
  if (kind === 'attack') return gradedAs(sc, o, g0);
  return o === sc.best || (sc.ok || []).includes(o) || o === 'lanes' ? 'good' : (sc.safe || []).includes(o) ? 'safe' : 'bad';
}
// The roles in a picture: who is on the ball, who marks whom (a defender nearer one of the other team's players than
// the ball, within 2.6 m of him), who is free, and the threat: the free defender nearest the ball (a keeper who rushed
// out at him first). `at`: { id: { x, y, team, gk, rush } }.
export function rolesOf(sc, at, { skip = [], never = [] } = {}) {
  const kind = kindOf(sc), holder = holderOf(sc, kind), ids = Object.keys(at).filter(id => !skip.includes(id)), out = ids.filter(id => !at[id].gk);
  const ballTeam = at[holder]?.team || 'us', defTeam = ballTeam === 'us' ? 'them' : 'us', B = ballOf(sc, kind, holder, at[holder] || at.hero);
  const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y), defs = out.filter(id => at[id].team === defTeam), atk = out.filter(id => at[id].team === ballTeam && id !== holder);
  const mark = {};
  for (const id of defs) { const m = atk.map(j => ({ j, d: d(at[j], at[id]) })).sort((a, b) => a.d - b.d)[0]; if (m && m.d < 2.6 && m.d < d(at[id], B)) mark[id] = m.j; }
  const free = defs.filter(id => !mark[id]).sort((a, b) => d(at[a], B) - d(at[b], B));
  let th = null;
  // (nobody comes: defending (their dribbler comes on), a dead ball, and a friend about to shoot: he shoots as the ring empties)
  if (kind !== 'defense' && !sc.restart && kind !== 'tackle' && !(kind === 'goal' && sc.shot)) {
    const rush = ids.find(id => at[id].gk && at[id].rush && at[id].team === defTeam);
    th = rush || free.find(id => !never.includes(id)) || defs.filter(id => !never.includes(id)).sort((a, b) => d(at[a], B) - d(at[b], B))[0] || null;
  }
  return { kind, holder, ballTeam, defTeam, B, defs, atk, mark, free, th, out, ids };
}

// What he sees at time t of a window (pos(id): where each player is) against how the scene grades each choice:
//   dis     choices whose look does not fit their grade with the threat taken at his place in the picture (moved on with
//           the play): every relation that does not hang on him. Empty when the shape holds.
//   threat  what the threat himself spoils: a right choice he makes look wrong while he is still farther out than his
//           place in the picture; or a wrong choice that looks right while he is not coming on the picture's bearing.
//           (Nearer than his place he is on the ball: then the choice is judged by his coming, not by where he is.)
export function agreeAt(sc, plan, pos, t, opts = {}) {
  const kind = kindOf(sc), th = plan.threat?.id, at0 = opts.at0 || (id => plan.at0[id] || pos(id)), o2 = { ...opts, at0 };
  if (!th || !plan.virt || kind === 'defense' || kind === 'follow') return { dis: disagree(sc, pos, t, o2), threat: [] };
  const tP = plan.tP || 0, D = plan.D || [0, 0], vp = {}; for (const c of plan.comers || [{ id: th, ...plan.virt }]) vp[c.id] = { x: c.x + D[0] * (t - tP), y: c.y + D[1] * (t - tP) };
  const dis = disagree(sc, id => vp[id] || pos(id), t, o2), real = disagree(sc, pos, t, o2), out = [];
  const q = pos(th), B = ballOf(sc, kind, plan.holder, pos(plan.holder)), r = Math.hypot(q.x - B.x, q.y - B.y);
  const a = Math.atan2(q.y - B.y, q.x - B.x) - plan.bear, sh = Math.abs(Math.atan2(Math.sin(a), Math.cos(a))), g0 = kind === 'attack' ? sc.grades || grade(sc) : null;
  for (const o of real) {
    if (dis.includes(o)) continue;
    if (ratedAs(sc, o, kind, g0) !== 'bad') { if (r > plan.rP + .3) out.push(o); }
    else if (sh > BEAR + .1 && r > 1.5) out.push(o);
  }
  return { dis, threat: out };
}

// st: { at: { id: { x, y, vx, vy, team, gk, rush } }, ball } : the picture P (a lesson's scene), or with opts.live where
// everyone is and how he moves now (a match, a give-and-go's second step: the picture is now).
// opts: { live, R (the real seconds wanted), options (attack: the choices on offer), skip (ids the scene's own script
// moves), keep ({ id: [vx, vy] }: runs the scene gives, a lead pass's runners), never (ids that cannot be the threat),
// G (a window whose length the play gives: a pass on its way), yaw (the way he looks) }.
// Returns { G, R (the real seconds it can have at PACE or more), tP (the window time at which play is exactly P), D (the
// drift), paths, threat: { id }, virt, bear, rP (the threat's place, bearing and distance in P), watch, at0, role, cls,
// dis (what still disagrees: empty), look, wide }.
const cache = new WeakMap();
export function planHold(sc, st, opts = {}) {
  const kind = kindOf(sc); if (kind === 'tackle' || kind === 'follow') return null;
  const key = opts.live ? null : JSON.stringify([opts.R, opts.rCap, opts.from, opts.lead, opts.skip, opts.never, opts.G, opts.keep, opts.options, opts.fracs, Object.keys(st.at).length, Math.round((opts.yaw || 0) * 100)]);
  if (key) { const hit = cache.get(sc)?.[key]; if (hit) return clonePlan(hit); }
  const p = planHold0(sc, st, opts, kind);
  if (key && p) { const m = cache.get(sc) || {}; m[key] = p; cache.set(sc, m); return clonePlan(p); }
  return p;
}
const clonePlan = p => ({ ...p, paths: Object.fromEntries(Object.entries(p.paths).map(([id, q]) => [id, { ...q }])), watch: new Set(p.watch), threat: p.threat && { ...p.threat } });
const SPEEDS = { attack: [1.3, 1, .8, .5, .25], lead: [1.2, 1, .8, .5, .25], defense: [1.8, 1.4, 1, .8, .5, .25], support: [.9, .7, .5, .25], goal: [1.6, 1.3, 1, .8, .5, .25], receive: [.9, .6, .4], dead: [0] };
function planHold0(sc, st, opts, kind) {
  const live = !!opts.live, at = st.at, R = opts.R || 8, never = opts.never || [], keep = opts.keep || {};
  const ro = rolesOf(sc, at, { skip: opts.skip, never: [...never, ...Object.keys(keep)] }), { holder, ballTeam, defTeam, out, ids, mark } = ro;
  if (!at[holder]) return null;
  const dead = !!sc.restart || (at[holder].gk && !at[holder].rush), P = id => [at[id].x, at[id].y], dd = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const H = P(holder), goal = [ballTeam === 'us' ? PITCH.L : 0, PITCH.W / 2], B = [ro.B.x, ro.B.y], th = dead ? null : ro.th;
  // The way the play goes: the way the ball is being carried (a lesson: his run-up's way; live: as he moves), toward
  // the goal they attack when that says nothing.
  let line = U([goal[0] - H[0], goal[1] - H[1]]);
  if (kind === 'defense') line = U([4.5 - H[0], PITCH.W / 2 + (H[1] - PITCH.W / 2) * .6 - H[1]]);
  else if (live) { const v = [at[holder].vx || 0, at[holder].vy || 0]; if (len(v) > .4) line = U(v); }
  else if (holder === 'hero' && sc.hero && sc.heroTo && dd(sc.hero, sc.heroTo) > .3) line = U([sc.heroTo[0] - sc.hero[0], sc.heroTo[1] - sc.hero[1]]);
  const passer = kind === 'receive' ? at[sc.carrier || 'm1'] || st.ball : null;
  if (passer && Math.hypot(passer.x - H[0], passer.y - H[1]) > .5) line = U([passer.x - H[0], passer.y - H[1]]); // (a pass on its way to him: he steps to meet it, and the play shifts that way with him)
  // ---- who comes ----
  // The threat; and, where the picture has a second free defender on the ball too (a trap, two pressing him), that one
  // comes in with him, a step behind, to his own place in the picture: two close him down, the nearer one tackles.
  const toP = kind === 'receive'; // (a pass on its way to him: the threat is at his place in the picture as it gets there, still coming)
  const rP = th ? dd(P(th), B) : 0, bear0 = th ? U([at[th].x - B[0], at[th].y - B[1]]) : [1, 0], bearA = Math.atan2(bear0[1], bear0[0]);
  const frees = ro.free.filter(id => id !== th && !at[id].gk && !never.includes(id) && !keep[id]);
  const second = th && !live && !opts.from && !at[th].gk ? frees.find(id => dd(P(id), B) < Math.max(3, rP + 1.2)) || null : null, d2 = second ? dd(P(second), B) : 0, bear2 = second ? Math.atan2(at[second].y - B[1], at[second].x - B[0]) : 0;
  // (he is the nearest free defender from the first moment: never farther out than another free one)
  const cap = th ? Math.min(9e9, ...frees.filter(id => id !== second).map(id => dd(P(id), B) - .4 - (second ? d2 - rP + .4 : 0))) : 0;
  // (opts.rCap: no farther out than this, unless the picture itself has him farther: for a view that shows him as he sets off)
  const runin = Math.min(RUNIN, opts.rCap || RUNIN), rWant = !th ? 0 : live ? rP : toP ? Math.min(rP + 4, Math.max(rP + 1.5, runin)) : Math.max(rP, runin);
  const rLow = toP ? rP + 1 : Math.min(rP, 1.6), rMax = !th ? 0 : live ? rP : Math.max(Math.min(rWant, cap), rLow);
  const lenOf = r0 => Math.max(.3, toP ? r0 - rP : r0 - CONTACT);
  const Gpace = PACE * (R * RETRY - .1) + .1 + .01; // (the play a window of R s, and of its first longer retry, needs at PACE)
  const Gfor = L => { let G = Math.max(L / V_RUN.pref, Gpace); G = Math.min(G, L / (L < 2.5 ? V_RUN.tight : V_RUN.min)); return Math.max(G, L / V_RUN.max, .6); }; // (a very short run-in: he steps in; never under .6 s of play)
  let G = opts.G || (th ? Gfor(lenOf(rMax)) : clamp(Gpace, 1.6, 2.6)), fixedG = !!opts.G;
  // ---- everyone else: the drift, and his own small part ----
  const sideways = (id, u) => { // the side to step across to: the one with more room, on the pitch
    const p = P(id), c = [1, -1].map(sg => { const d = mul(perp(u), sg), q = add(p, d, 2); return { d, r: onPitch(q[0], q[1], 1.2) ? Math.min(9, ...out.filter(j => j !== id && mark[j] !== id).map(j => dd(P(j), q))) : -1 }; });
    return c.sort((a, b) => b.r - a.r)[0].d;
  };
  const shotOn = kind === 'goal' && !!sc.shot;
  const own = {}, comer = id => id === th || id === second;
  for (const id of out) {
    if (id === holder || keep[id] || comer(id)) continue;
    const p = P(id), tb = U([B[0] - p[0], B[1] - p[1]]), far = dd(p, B) > 12 ? .6 : 1;
    if (at[id].team === ballTeam) { const sd = sideways(id, tb); own[id] = mul(U(add(mul(sd, .9), tb, .3)), far); } // a friend steps across his line to the ball, never away from it
    else if (!mark[id]) { // a cover defender shuffles toward the ball's side (the line from the ball to his goal), never away from it
      const g = [defTeam === 'us' ? 0 : PITCH.L, PITCH.W / 2], c = closestOnLane({ x: p[0], y: p[1] }, { x: B[0], y: B[1] }, { x: g[0], y: g[1] }, .15), to = [c.x - p[0], c.y - p[1]];
      own[id] = mul(U(add(len(to) > .6 ? mul(U(to), .75) : [0, 0], tb, .35)), .8 * far);
    }
  }
  for (const id of out) if (mark[id] && !comer(id) && own[mark[id]] && !keep[id]) own[id] = [...own[mark[id]]]; // a marker mirrors his man
  const keeperV = id => { if (sc.shots || at[id].rush || sc.gk?.hold || sc.gk?.out || sc.shot) return [0, 0]; const dy = B[1] - at[id].y; return [0, Math.abs(dy) > .3 ? Math.sign(dy) * .22 : 0]; };
  function build(sp, k, tP, G) {
    const D = mul(line, sp), paths = {}, wmag = Math.min(.6, STEP_OWN / G) * k;
    for (const id of ids) {
      if (comer(id)) continue;
      const a = at[id]; let v;
      if (a.gk) v = dead && id === holder ? [0, 0] : keeperV(id);
      else if (keep[id]) v = [...keep[id]];
      else if (id === holder) v = dead ? [0, 0] : D;
      else if (id === 'hero' && shotOn) v = mul(own[id] || [0, 0], .25 * k); // (a friend about to shoot: the race for the rebound is run from where he is, so he only shifts his feet, ready to go)
      else { v = add(D, own[id] || [0, 0], wmag); const s = len(v); if (s < MOVE && (k > 0 || sp > 0)) v = s > .05 ? mul(v, MOVE / s) : mul(own[id] || line, MOVE); // (never still: at least a slow walk)
        if (id === 'hero' && !dead && k > 0 && len(v) < .85) v = mul(U(v), .85); } // (his own player: a walk at the least)
      const v0 = live ? [a.vx || 0, a.vy || 0] : [...v]; let v1 = v;
      if (live) { const s0 = len(v0), s1 = len(v1); if (s0 > .4 && s1 > .1 && (v0[0] * v1[0] + v0[1] * v1[1]) / (s0 * s1) < -.3) v1 = add(mul(v0, .35), v1, .3); } // (one going the other way slows and bends his way: he does not turn straight back)
      paths[id] = { x: a.x - (live ? 0 : v[0] * tP), y: a.y - (live ? 0 : v[1] * tP), v0, v1, t1: 0, tau: live ? easeTime(v0, v1) : 0 };
    }
    // Nobody walks through anybody: two whose ways come closer than ROOM move together (the one with less to do goes the other's way).
    const list = Object.entries(paths).filter(([id]) => !at[id].gk), q1 = {}, q2 = {}, fixed = new Set([holder, 'hero', ...Object.keys(keep)]);
    if (!live) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      let dmin = 9; for (let t = -1; t <= G + 1e-6; t += .25) { const a = pathAt(list[i][1], t, q1), b = pathAt(list[j][1], t, q2); dmin = Math.min(dmin, Math.hypot(b.x - a.x, b.y - a.y)); }
      if (dmin >= ROOM) continue;
      const [from, to, tid] = fixed.has(list[j][0]) ? [list[j][1], list[i][1], list[i][0]] : [list[i][1], list[j][1], list[j][0]]; if (fixed.has(tid)) continue;
      const a = at[tid]; to.v0 = [...from.v0]; to.v1 = [...from.v1]; to.x = a.x - to.v1[0] * tP; to.y = a.y - to.v1[1] * tP;
    }
    return { paths, tP, D, sp, k, G };
  }
  // (a comer's place in the picture, moved on with the play)
  const virtAt = (b, t, id = th) => ({ x: at[id].x + b.D[0] * (t - b.tP), y: at[id].y + b.D[1] * (t - b.tP) });
  const posOf = (b, t, real = null, tmp = {}) => id => (comer(id) ? real?.[id] ? pathAt(real[id], t, tmp[id] ||= {}) : virtAt(b, t, id) : b.paths[id] ? pathAt(b.paths[id], t, tmp[id] ||= {}) : at[id]);
  const o2 = { options: opts.options, ids: ids.filter(id => !at[id].gk), at0: id => at[id], ball: st.ball };
  // Which moments of the window agree (ok[i]: at i·STEP_T), and whether everyone stays on the pitch.
  function score(b) {
    const tmp = {}, ok = [], vd = [], onp = Object.keys(b.paths).filter(id => !at[id].gk && onPitch(at[id].x, at[id].y, .4)); let bad = 0, first = null;
    const n = Math.max(1, Math.ceil(b.G / STEP_T - 1e-6)), dtS = b.G / n; b.dtS = dtS;
    for (let i = 0; i <= n; i++) {
      const t = i * dtS, d = disagree(sc, posOf(b, t, null, tmp), t, o2), off = onp.some(id => { const q = pathAt(b.paths[id], t, tmp[id] ||= {}); return !onPitch(q.x, q.y, .4); });
      ok.push(!d.length && !off); vd.push(d); if (d.length || off) { bad++; first ||= d.length ? d : ['off the pitch']; }
    }
    let run = 0, r0 = 0, r1 = -1; for (let i = 0, s = 0; i <= ok.length; i++) { if (i < ok.length && ok[i]) continue; if (i - s > run) { run = i - s; r0 = s; r1 = i - 1; } s = i + 1; }
    return Object.assign(b, { bad, first, offp: 0, ok, vd, runOk: [r0, r1] });
  }
  let best = null;
  // (a friend about to shoot: the race for the rebound is close and is run on the grass as it lies, so the play does not
  // drift: he lines his shot up, and everyone only makes his own small move)
  const speeds = dead || shotOn ? [0] : [...(SPEEDS[kind] || SPEEDS.attack), 0], fracs = live || opts.from ? [0] : toP ? [1] : opts.fracs || [.5, 1, 0]; // (from where everyone stands now: the picture is the window's start)
  search: for (const sp of speeds) for (const k of shotOn ? [.5, .25, 0] : [1, .5, 0]) for (const frac of fracs) {
    const b = score(build(sp, k, frac * G, G)), cost = b.offp * 100 + b.bad * 10 - (b.runOk[1] - b.runOk[0]) + (speeds.indexOf(sp) + (1 - k)) * .01;
    if (!best || cost < best.cost) { best = b; best.cost = cost; }
    if (!b.bad && !b.offp) break search;
  }
  // (no try agrees all the way: the window is the longest stretch of the best try that does, never under .6 s of play;
  // the picture itself may then lie just outside it, and play is as near it as it ever is)
  if (best.bad && !live && !fixedG) for (let m = 0; m < 3 && best.bad; m++) {
    const [i0, i1] = best.runOk, a0 = i0 + (m && i0 > 0 ? 1 : 0), a1 = i1 - (m && i1 < best.ok.length - 1 ? 1 : 0), Gs = (a1 - a0) * best.dtS; // (a step in from the edge of what agrees, if the first cut does not)
    if (Gs < .6 - 1e-6) break;
    const b = score(build(best.sp, best.k, best.tP - a0 * best.dtS, Gs)); if (b.bad <= best.bad) { best = b; G = Gs; fixedG = true; } else break;
  }
  // ---- the runs in ----
  let r0 = 0, shift = 0, tviol = 0, tclash = 0; const g0 = kind === 'attack' ? sc.grades || grade(sc) : null;
  if (th) {
    const tmp = {};
    const tryRun = (b, G, r, sh) => {
      const hp0 = pathAt(b.paths[holder], 0), hp1 = pathAt(b.paths[holder], G), B0 = ballOf(sc, kind, holder, hp0), B1 = ballOf(sc, kind, holder, hp1), u = [Math.cos(bearA + sh), Math.sin(bearA + sh)];
      const cur = opts.from?.[th], S = live ? [at[th].x, at[th].y] : cur ? [cur.x, cur.y] : [B0.x + u[0] * r, B0.y + u[1] * r]; // (cur: he sets off from where he is now, `lead` s before it opens)
      if (!live && !cur && !onPitch(S[0], S[1], .8)) return null;
      // (as it opens he is plainly coming for the ball, not standing by one of ours: 2.7 m or more from every friend off the ball)
      if (!live && !cur && ro.atk.some(m => { const q = b.paths[m] && pathAt(b.paths[m], 0, tmp.m ||= {}); return q && Math.hypot(q.x - S[0], q.y - S[1]) < 2.7; })) return null;
      let E;
      if (toP) { const v = virtAt(b, G); E = [v.x, v.y]; }
      else { // the nearest point to where he starts, CONTACT m from the ball, that is not on top of the player on it
        const mv = !at[holder].gk, bc = mv ? [hp1.x + line[0] * .45, hp1.y + line[1] * .45] : [B1.x, B1.y], fa = mv ? Math.atan2(line[1], line[0]) : null, wa = Math.atan2(S[1] - bc[1], S[0] - bc[0]);
        let a = wa; if (fa != null) { const da = Math.atan2(Math.sin(wa - fa), Math.cos(wa - fa)); a = fa + clamp(da, -1.4, 1.4); }
        const rr = fa != null ? CONTACT : Math.max(CONTACT, .9); E = [bc[0] + Math.cos(a) * rr, bc[1] + Math.sin(a) * rr];
      }
      const L = dd(S, E); if (L < .2) return null;
      const va = live ? clamp((at[th].vx || 0) * (E[0] - S[0]) / L + (at[th].vy || 0) * (E[1] - S[1]) / L, .6, Math.min(3, L / G)) : null; let path = mkRun(S, E, G, va);
      if (cur) { const T = opts.lead || 0; path = mkRun(S, E, G + T, .8); path.shift = T; }
      if (path.v1 > 4.45) return null;
      if (live) { // from how he moves now, smoothly, when that is a way a child could run (no harder than 3.5 m/s², never back on himself)
        const uu = U([E[0] - S[0], E[1] - S[1]]), hp = { herm: true, S, V0: [at[th].vx || 0, at[th].vy || 0], E, V1: mul(uu, clamp(L / G, 1.2, 4.2)), T: G, L }; let ok = true, prev = null, v0 = null;
        for (let k = 0; k <= 20 && ok; k++) { const q = hermAt(hp, G * k / 20), sp = Math.hypot(q.vx, q.vy); if (sp > 4.5 || (prev && Math.hypot(q.vx - prev.vx, q.vy - prev.vy) / (G / 20) > 3.5)) ok = false; if (sp > .4) { if (!v0) v0 = [q.vx / sp, q.vy / sp]; else if (q.vx / sp * v0[0] + q.vy / sp * v0[1] < -.17) ok = false; } prev = { ...q }; }
        if (ok) path = hp;
      }
      const real = { [th]: path };
      // (how often a run comes too near anyone on his way: bodies, not the player it ends at)
      const near = (pp, skipId, endAt) => { let n = 0; for (let i = 0; i * STEP_T <= G + 1e-6; i++) { const t = i * STEP_T, q = pathAt(pp, t, tmp.n1 ||= {}); for (const id of out) { if (id === skipId) continue; const op = real[id] && real[id] !== pp ? real[id] : b.paths[id]; if (!op || op === pp) continue; const o = pathAt(op, t, tmp.n2 ||= {}), d = Math.hypot(o.x - q.x, o.y - q.y); if (d < (id === holder ? endAt : 1) && !(id === holder && endAt < .6 && t > G - .3)) n++; } } return n; };
      if (second) { // the second one: from as much farther out as he is in the picture (and a step more), to his place in it
        let p2 = null, c2 = 1e9;
        for (const s2 of [0, .12, -.12, .25, -.25, .4, -.4, .55, -.55]) { const u2 = [Math.cos(bear2 + s2), Math.sin(bear2 + s2)], S2 = [B0.x + u2[0] * (r + d2 - rP + .4), B0.y + u2[1] * (r + d2 - rP + .4)], v = virtAt(b, G, second);
          if (!onPitch(S2[0], S2[1], .8) || dd(S2, [v.x, v.y]) < .3) continue;
          if (ro.atk.some(m => { const q = b.paths[m] && pathAt(b.paths[m], 0, tmp.m ||= {}); return q && Math.hypot(q.x - S2[0], q.y - S2[1]) < 2.7; })) continue; const c = mkRun(S2, [v.x, v.y], G); if (c.v1 > 4.45) continue; const n = near(c, second, .9); if (n < c2) { c2 = n; p2 = c; } if (!n) break; }
        if (!p2) return null; real[second] = p2;
      }
      let viol = 0, clash = near(path, th, .55) + (second ? near(real[second], second, .9) : 0);
      for (let i = 0; i < (b.vd?.length || 0); i++) {
        const t = i * b.dtS, q = pathAt(path, t, tmp.th ||= {});
        const Bt = ballOf(sc, kind, holder, pathAt(b.paths[holder], t, tmp.h ||= {})), r1 = Math.hypot(q.x - Bt.x, q.y - Bt.y);
        if (r1 > rP + .3) { const rd = disagree(sc, posOf(b, t, real, {}), t, o2), virt = b.vd?.[i] || []; for (const o of rd) if (!virt.includes(o) && ratedAs(sc, o, kind, g0) !== 'bad') viol++; }
      }
      return { real, path, L, viol, clash };
    };
    const pick = (b, G, fixed) => {
      let got = null, fall = null;
      const top = fixed && !toP ? Math.min(rMax, CONTACT + G * V_RUN.max) : rMax, rs = []; for (let r = top; r >= rLow - 1e-6 && rs.length < 14; r -= .5) rs.push(r); if (live || opts.from?.[th] || !rs.length) { rs.length = 0; rs.push(live || opts.from?.[th] ? rP : rLow); }
      outer: for (const r of rs) for (const sh of live || opts.from?.[th] ? [0] : [0, .1, -.1, .2, -.2, .3, -.3, .4, -.4]) {
        const t = tryRun(b, G, r, sh); if (!t) continue;
        if (!t.viol && !t.clash) { got = { ...t, r, sh }; break outer; }
        if (!fall || t.viol * 3 + t.clash < fall.viol * 3 + fall.clash) fall = { ...t, r, sh };
      }
      return got || fall;
    };
    // The window is as long as his run takes (a shorter run than hoped for, or a chase after a ball going away from him:
    // the shape is built again for that length, a few times over until the two agree).
    let got = null;
    for (let n = 0; n < 7; n++) {
      const g1 = pick(best, G, fixedG || n > 0); if (g1) { got = g1; got.G = G; }
      if (fixedG) break;
      const G2 = g1 ? Gfor(g1.L) : Math.min(4.6, G * 1.4);
      if ((g1 && Math.abs(G2 - G) <= .05) || (!g1 && G >= 4.6 - 1e-6)) break;
      const b = score(build(best.sp, best.k, live ? 0 : best.tP * G2 / G, G2)); if (!live && b.bad > best.bad) break;
      b.cost = best.cost; best = b; G = G2; if (!g1) got = null;
    }
    if (got && Math.abs(got.G - G) > 1e-6) { const g2 = pick(best, G, true) || tryRun(best, G, got.r, got.sh); if (g2) got = { r: got.r, sh: got.sh, ...g2 }; } // (the run for the length it ended at)
    // (and never shorter than his run needs at a jog: a short run-in is walked through at its own pace, not rushed)
    if (got && !fixedG) { const Gf = Gfor(got.L); if (Gf > G + .05) { const b = score(build(best.sp, best.k, best.tP * Gf / G, Gf)); if (b.bad <= best.bad) { const g2 = tryRun(b, Gf, got.r, got.sh); if (g2) { best = b; G = Gf; got = { ...g2, r: got.r, sh: got.sh }; } } } }
    if (got) { Object.assign(best.paths, got.real); r0 = got.r; shift = got.sh; tviol = got.viol; tclash = got.clash; }
    else for (const id of [th, second].filter(Boolean)) { const a = at[id]; best.paths[id] = { x: a.x - best.D[0] * best.tP, y: a.y - best.D[1] * best.tP, v0: [...best.D], v1: [...best.D], t1: 0, tau: 0 }; }
  }
  // ---- the view: the threat is seen coming ----
  // (seen: in his head-up view, looking the way the scene has him look; view.js camSpec: from 5.2 m behind him, about
  // 44° to each side at 844x390, a little less to be sure). If he starts outside it the view turns toward him, as little
  // as does it; one coming from behind is shown by a higher, wider view (wide), except on a pass to him with his back to
  // their goal (the idea is the defender he cannot see).
  let look = null, wide = false; const run = th && best.paths[th];
  if (run?.run && best.paths.hero && !live) {
    const view = opts.yaw ?? Math.atan2(line[1], line[0]), h = pathAt(best.paths.hero, 0), q = pathAt(run, 0);
    const seen = yaw => { const e = [h.x - 5.2 * Math.cos(yaw), h.y - 5.2 * Math.sin(yaw)], a = Math.atan2(q.y - e[1], q.x - e[0]) - yaw; return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < .62; };
    const rel = Math.atan2(q.y - h.y, q.x - h.x) - view, ab = Math.abs(Math.atan2(Math.sin(rel), Math.cos(rel))), sg0 = Math.sign(Math.sin(rel)) || 1;
    if (kind !== 'receive' && kind !== 'defense') { wide = ab > 1.9; if (!seen(view) && !wide) for (let k = 1; k <= 14 && look == null; k++) for (const sg of [sg0, -sg0]) if (seen(view + sg * k * .1)) { look = view + sg * k * .1; break; } }
  }
  const watch = new Set(out.filter(id => at[id].team === defTeam && id !== holder));
  if (th && at[th].gk) watch.add(th);
  const role = {}; for (const id of out) role[id] = id === holder ? 'ball' : id === th ? 'threat' : id === second ? 'second' : mark[id] ? 'marker:' + mark[id] : at[id].team === defTeam ? 'cover' : id === 'hero' ? 'hero' : 'friend';
  const Rmax = (G - .1) / PACE + .1, closes = th ? r0 - (toP ? rP : CONTACT) : 0;
  // When play is at the scene's own picture with the threat in it too: the moment he is as far from the ball as the
  // picture has him (the tests and the audits choose there when they want the picture whole).
  let tPic = clamp(best.tP, 0, G);
  if (run?.run && !toP) { tPic = G; for (let i = 0; i <= 40; i++) { const t = G * i / 40, q = pathAt(run, t, {}), Bt = ballOf(sc, kind, holder, pathAt(best.paths[holder], t, {})); if (Math.hypot(q.x - Bt.x, q.y - Bt.y) <= rP + .05) { tPic = t; break; } } }
  return { hold: true, arrival: true, live, G, R: Math.min(R, Rmax), tP: best.tP, Gpre: tPic, Gpost: G - tPic, a: 0, D: best.D, paths: best.paths, holder,
    threat: th ? { id: th } : kind === 'defense' ? { id: holder, to: [4.5, H[1] + (PITCH.W / 2 - H[1]) * .6] } : null, second,
    comers: [th, second].filter(Boolean).map(id => ({ id, x: at[id].x, y: at[id].y })), virt: th ? { x: at[th].x, y: at[th].y } : null, bear: bearA, rP, r0, shift, watch, role, look, wide,
    at0: Object.fromEntries(ids.map(id => [id, { x: at[id].x, y: at[id].y }])), dis: best.bad ? best.first || ['?'] : [], disN: best.bad, k: best.k, sp: best.sp,
    cls: !th ? (dead ? 'dead' : 'no-threat') : best.bad ? 'disagrees' : best.sp < .8 && !dead && !toP ? 'calm' : closes < 2.5 ? 'short' : 'full', tviol, tclash };
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
