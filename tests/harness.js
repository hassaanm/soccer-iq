// Headless game runner shared by the tests and the audit: a stub renderer, fixed 30 fps ticks, and per-play metrics.
import { Game } from '../js/game.js';
import { TEAMS } from '../js/teams.js';
import { dist, closestOnLane, DRIBBLE_DIRS, PITCH, sizeOf } from '../js/geom.js';

export const OPTIONS = ['pass:0', 'pass:1', ...Object.keys(DRIBBLE_DIRS).map(d => 'drib:' + d)];
const PASS3 = ['pass:0', 'pass:1', 'pass:2']; // (4v4: three friends to pass to)
// Every choice a scenario offers: spots on defense; passes, dribbles (and big pushes in the dribble lesson) on attack.
export function optionsFor(sc) {
  if (sc.kind === 'defense' || sc.kind === 'support' || sc.kind === 'lead') return sc.spots.map(s => 'spot:' + s.id);
  if (sc.kind === 'tackle') return ['tackle:good', 'tackle:early', 'tackle:tight', 'tackle:none'];
  if (sc.kind === 'receive') return ['turn:L', 'turn:R'];
  const push = sc.skill === 'dribble-to-space' || sc.skill === 'won-it-go' ? ['fwd', 'fl', 'fr', 'left', 'right'].map(d => 'push:' + d) : [];
  const shoot = !sc.shots && (sc.skill === 'shoot-close' || sc.heroTo[0] > (sizeOf().keeper ? PITCH.L - 13 : 17)); // the SHOOT button shows from 13 m out (a shot lesson's scene: each shot it offers, sc.shots)
  // Give-and-go: after the right pass, each run he could make (written then:spot:<id>).
  const then = sc.then ? sc.then.spots.filter(s => 'spot:' + s.id !== sc.then.best).map(s => 'then:spot:' + s.id) : [];
  return [...(sc.mates.length > 2 ? [...PASS3, ...OPTIONS.slice(2)] : OPTIONS), ...push, ...(shoot ? ['shoot'] : []), ...Object.keys(sc.shots || {}), ...then];
}
const MATE = { 'pass:0': 'm1', 'pass:1': 'm2', 'pass:2': 'm3' };

export function makeGame() {
  const events = [];
  const world = { canvas: { clientWidth: 800, clientHeight: 400 }, setTeams() {}, swapRigs() {}, resetRigs() {}, project: () => [400, 200] };
  const hud = new Proxy({}, { get: (_, k) => (...a) => events.push([k, ...a]) });
  const g = new Game({ world, hud, say: () => {} });
  g.setTeams(TEAMS[3], TEAMS[13]);
  return { g, events };
}

// Runs frames until the promise settles, as the browser does: a frame, then everything waiting on it runs (all of it,
// as the browser empties its queue of finished waits before the next frame). Game time is stepped by the game itself
// (Game.tick: small even steps, see game/skill.js), so the frame length (30 a second here, AUDIT_FPS=60|uneven to
// check) changes nothing in a play. pick(g) is asked for a choice whenever one is possible; onFrame(g) sees every frame.
const FPS = process.env.AUDIT_FPS || '30';
export const frameDt = k => FPS === 'uneven' ? (k & 1 ? .04 : .016) : 1 / +FPS;
export async function drive(g, promise, { pick = () => null, onFrame = () => {}, maxSec = 120 } = {}) {
  let done = false, value; promise.then(v => { done = true; value = v; });
  for (let t = 0, k = 0; t < maxSec && !done; k++) {
    const dt = frameDt(k); t += dt;
    g.tick(dt, t); onFrame(g);
    if (g.canAct && g._choose) { const o = pick(g); if (o) { g.seen.add('m1'); g.seen.add('m2'); if (g.sim.a('m3')) g.seen.add('m3'); g.choose(o); } }
    await new Promise(r => setImmediate(r));
  }
  if (!done) throw new Error('flow did not finish');
  return value;
}

// Plays one option of one scenario from the freeze and measures how the play looked.
export async function playOption(sc, opt) {
  const { g, events } = makeGame();
  g.mode = 'lesson'; g.load(sc);
  await drive(g, g.pre());
  // A give-and-go option: the right pass first, then this run (or the right run, after a plain right pass).
  let step2 = null;
  if (sc.then && opt.startsWith('then:')) { step2 = opt.slice(5); opt = sc.best; } else if (sc.then && opt === sc.best) step2 = sc.then.best;
  const s = g.sim, good = g.isGood(opt), mate = MATE[opt] && s.a(MATE[opt]);
  const start = { ball: { ...s.ball }, mate: mate && { x: mate.x, y: mate.y } };
  const nearestDef = s.team(sc.kind === 'defense' ? 'us' : 'them').sort((a, b) => dist(a, s.ball) - dist(b, s.ball))[0];
  // Times are game time (s.time), not frames: slow motion in a skill moment shows the same play over more frames.
  const m = { flight: 0, shotBlocked: false, minGap: Infinity, mateClosest: Infinity, defClosest: Infinity, defStart: dist(nearestDef, s.ball), frames: 0 }, t0 = s.time;
  let tPrev = t0;
  const kick = s.kick.bind(s);
  let kicker = null, aimAt = null;
  s.kick = (x, y, o) => { // record whether a shot at goal had a defender on its line
    kicker = s.ball.carrier; aimAt = { x, y };
    if (x > PITCH.L - 1 && s.team('them').some(d => closestOnLane(d, s.ball, { x, y }, 0).d < .9)) m.shotBlocked = true;
    if (x < 1 && s.team('us').some(d => d.id !== s.ball.carrier && closestOnLane(d, s.ball, { x, y }, 0).d < .9)) m.shotBlocked = true;
    return kick(x, y, o);
  };
  let gStep2 = null;
  const play = async () => {
    await g.outcome(opt, good);
    if (step2 && g.result === 'passed') { await g.toStep2(); gStep2 = g.isGood(step2); await g.outcome(step2, gStep2); }
  };
  await drive(g, play(), {
    onFrame: () => {
      m.frames++; const gdt = s.time - tPrev; tPrev = s.time;
      const list = [...s.agents.values()];
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) m.minGap = Math.min(m.minGap, dist(list[i], list[j]));
      if (mate && s.ball.state === 'flying') { m.flight += gdt; m.mateClosest = Math.min(m.mateClosest, dist(mate, start.ball)); }
      if (s.time - t0 < 1) m.defClosest = Math.min(m.defClosest, dist(nearestDef, s.ball));
      // A low ball in flight must not pass through anyone except where it's going.
      if (s.ball.state === 'flying' && s.ball.z < .9) for (const a of list) if (a.id !== kicker && dist(a, s.ball) < .4 && dist(a, aimAt) > 1) m.through = a.id;
    },
  });
  const banners = events.filter(e => e[0] === 'banner').map(e => e[1]);
  return { sc: sc.id, expect: sc.shots?.[opt] && SHOT_BANNER[sc.shots[opt]], opt: step2 && step2 !== sc.then?.best ? 'then:' + step2 : opt, good: gStep2 ?? good, defense: sc.kind === 'defense' || sc.kind === 'tackle', banners, ...m, seconds: s.time - t0,
    mateStart: start.mate && !step2 ? dist(start.mate, start.ball) : null };
}

// A shot in a shot lesson ends as its scene says (generate.js finishShots): the banner for each result.
const SHOT_BANNER = { goal: 'GOAL!', save: 'Saved!', over: 'Over the bar!', wide: 'Wide!', cleared: 'Cleared!', blocked: 'Stolen!' };
// The rules a play has to follow to look like real soccer. Returns a list of broken rules.
export function judge(r) {
  const bad = [];
  if (r.expect) { // his shot: it ends as the scene says, whatever its stars (a right space with the wrong foot is 2 stars and a miss)
    if (!r.banners.includes(r.expect)) bad.push(`shot ended ${r.banners.join(',') || 'with nothing'}, the scene says ${r.expect}`);
    if (r.minGap < .5) bad.push(`players overlapped (${r.minGap.toFixed(2)} m apart)`);
    if (r.through) bad.push(`ball went through ${r.through}`);
    if (r.seconds > 10) bad.push(`play dragged on (${r.seconds.toFixed(1)} s)`);
    return bad;
  }
  if (r.minGap < .5) bad.push(`players overlapped (${r.minGap.toFixed(2)} m apart)`);
  if (r.shotBlocked) bad.push('shot went through a defender');
  if (r.seconds > 10) bad.push(`play dragged on (${r.seconds.toFixed(1)} s)`);
  if (r.through) bad.push(`ball went through ${r.through}`);
  if (r.defense) {
    if (r.good && !r.banners.some(b => b === 'Stole it!' || b === 'Stopped him!')) bad.push('right spot did not stop the attack');
    if (!r.good && !r.banners.includes('They scored')) bad.push('wrong spot did not cost a goal');
    return bad;
  }
  if (r.good && !r.banners.some(b => b === 'GOAL!' || b === 'Kept the ball!')) bad.push('good choice lost the ball');
  const lost = ['Stolen!', 'They got it!', 'Cut out!', 'Saved!', 'Over the bar!', 'Wide!', 'Cleared!'].some(b => r.banners.includes(b)); // (a loose ball they get to first; a pass to him cut out; a shot that does not go in)
  if (r.good && lost) bad.push('good choice lost the ball');
  if (!r.good && !lost) bad.push('bad choice did not lose the ball');
  if (!r.good && r.mateStart != null && r.flight > .4 && !(r.mateClosest < r.mateStart - .3)) bad.push('receiver did not come toward the pass');
  if (!r.defense && r.defClosest > r.defStart + .2) bad.push('nearest defender backed off the ball');
  return bad;
}
