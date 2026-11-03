// Headless game runner shared by the tests and the audit: a stub renderer, fixed 30 fps ticks, and per-play metrics.
import { Game } from '../js/game.js';
import { TEAMS } from '../js/teams.js';
import { dist, closestOnLane } from '../js/geom.js';

export const OPTIONS = ['pass:0', 'pass:1', 'drib:fwd', 'drib:left', 'drib:right', 'drib:back'];
const MATE = { 'pass:0': 'm1', 'pass:1': 'm2' };

export function makeGame() {
  const events = [];
  const world = { canvas: { clientWidth: 800, clientHeight: 400 }, setTeams() {}, project: () => [400, 200] };
  const hud = new Proxy({}, { get: (_, k) => (...a) => events.push([k, ...a]) });
  const g = new Game({ world, hud, say: () => {} });
  g.setTeams(TEAMS[3], TEAMS[13]);
  return { g, events };
}

// Runs frames until the promise settles. pick(g) is asked for a choice whenever one is possible; onFrame(g) sees every frame.
export async function drive(g, promise, { pick = () => null, onFrame = () => {}, maxSec = 120 } = {}) {
  let done = false, value; promise.then(v => { done = true; value = v; });
  for (let t = 0; t < maxSec && !done; t += 1 / 30) {
    g.tick(1 / 30, t); onFrame(g);
    if (g.canAct && g._choose) { const o = pick(g); if (o) { g.seen.add('m1'); g.seen.add('m2'); g.choose(o); } }
    await null;
  }
  if (!done) throw new Error('flow did not finish');
  return value;
}

// Plays one option of one scenario from the freeze and measures how the play looked.
export async function playOption(sc, opt) {
  const { g, events } = makeGame();
  g.mode = 'lesson'; g.load(sc);
  await drive(g, g.pre());
  const s = g.sim, good = g.isGood(opt), mate = MATE[opt] && s.a(MATE[opt]);
  const start = { ball: { ...s.ball }, mate: mate && { x: mate.x, y: mate.y } };
  const nearestDef = s.team('them').sort((a, b) => dist(a, s.ball) - dist(b, s.ball))[0];
  const m = { flight: 0, shotBlocked: false, minGap: Infinity, mateClosest: Infinity, defClosest: Infinity, defStart: dist(nearestDef, s.ball), frames: 0 };
  const kick = s.kick.bind(s);
  s.kick = (x, y, o) => { // record whether a shot at goal had a defender on its line
    if (x > 29 && s.team('them').some(d => closestOnLane(d, s.ball, { x, y }, 0).d < .9)) m.shotBlocked = true;
    return kick(x, y, o);
  };
  await drive(g, g.outcome(opt, good), {
    onFrame: () => {
      m.frames++;
      const list = [...s.agents.values()];
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) m.minGap = Math.min(m.minGap, dist(list[i], list[j]));
      if (mate && s.ball.state === 'flying') { m.flight++; m.mateClosest = Math.min(m.mateClosest, dist(mate, start.ball)); }
      if (m.frames < 30) m.defClosest = Math.min(m.defClosest, dist(nearestDef, s.ball));
    },
  });
  const banners = events.filter(e => e[0] === 'banner').map(e => e[1]);
  return { sc: sc.id, opt, good, banners, ...m, seconds: m.frames / 30,
    mateStart: start.mate ? dist(start.mate, start.ball) : null };
}

// The rules a play has to follow to look like real soccer. Returns a list of broken rules.
export function judge(r) {
  const bad = [];
  if (r.minGap < .55) bad.push(`players overlapped (${r.minGap.toFixed(2)} m apart)`);
  if (r.good && !r.banners.some(b => b === 'GOAL!' || b === 'Kept the ball!')) bad.push('good choice lost the ball');
  if (r.good && r.banners.includes('Stolen!')) bad.push('good choice lost the ball');
  if (r.shotBlocked) bad.push('shot went through a defender');
  if (!r.good && !r.banners.includes('Stolen!')) bad.push('bad choice did not lose the ball');
  if (!r.good && r.mateStart != null && r.flight > 12 && !(r.mateClosest < r.mateStart - .3)) bad.push('receiver did not come toward the pass');
  if (r.defClosest > r.defStart + .2) bad.push('nearest defender backed off the ball');
  if (r.seconds > 10) bad.push(`play dragged on (${r.seconds.toFixed(1)} s)`);
  return bad;
}
