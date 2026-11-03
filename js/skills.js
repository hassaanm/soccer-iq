// The learning path (see research/skill-tree.md) and the scenarios for each skill that is ready.
import { mirrorScenario, shuffle } from './geom.js';

export const PITCH = { L: 30, W: 20, gy0: 8, gy1: 12, gh: 1.6 };

export const PATH = [
  { id: 'look-up', emoji: '👀', kid: 'Look up!', adult: 'Scan before deciding', ready: true },
  { id: 'get-goal-side', emoji: '🏠', kid: 'Run home first', adult: 'Recover goal-side after losing the ball', ready: false },
  { id: 'dribble-to-space', emoji: '💨', kid: 'Run into space', adult: 'Dribble where defenders are not', ready: false },
  { id: 'one-goes', emoji: '🐝', kid: 'Only one bee chases', adult: 'One presses, the others cover', ready: false },
  { id: 'see-the-trap', emoji: '🚧', kid: 'Two shirts? Let it go!', adult: 'Recognize a 2v1 trap and release the ball', ready: false },
  { id: 'mark-the-free-one', emoji: '🛡️', kid: 'Guard the open player', adult: 'Mark the free attacker', ready: false },
  { id: 'pass-to-open', emoji: '🎯', kid: 'Pass to the open friend', adult: 'Choose the unmarked teammate', ready: false },
  { id: 'forward-first', emoji: '⬆️', kid: 'Forward first', adult: 'Look forward, then sideways, then back', ready: false },
];
export const skillById = id => PATH.find(s => s.id === id);

// Positions are meters on a 30 x 20 pitch; we attack toward x = 30.
// hero/opps move to heroTo/oppsTo before the freeze. Options: 'pass:0', 'pass:1', 'drib:fwd|left|right|back'.
// {m0}/{m1} in a cue become teammate names.
const LOOK_UP = [
  { id: 'lu-wide', hero: [6, 10], heroTo: [9, 10], mates: [[14, 3.5], [16, 13]],
    opps: [[13, 10.5], [15.5, 13.5], [22, 9]], oppsTo: [[10.8, 10.3], [15, 12.3], null],
    best: 'pass:0', cue: '{m0} was open out wide!' },
  { id: 'lu-ahead', hero: [6, 10], heroTo: [9, 10], mates: [[16, 10], [12, 3]],
    opps: [[11, 14], [11.5, 5], [24, 10]], oppsTo: [[9.8, 11.9], [11.6, 4.2], null],
    best: 'pass:0', ok: ['drib:fwd'], cue: '{m0} was open in front of you!' },
  { id: 'lu-space', hero: [6, 10], heroTo: [9, 10], mates: [[14, 4], [14, 16]],
    opps: [[10, 15], [16, 6], [16, 14]], oppsTo: [[9.6, 12.4], [13.6, 4.9], [13.6, 15.1]],
    best: 'drib:fwd', cue: 'Nobody was open. Run into the space!' },
  { id: 'lu-behind', hero: [9, 10], heroTo: [12, 10], mates: [[8, 4], [18, 15]],
    opps: [[17, 10.5], [16, 13], [18, 13.6]], oppsTo: [[13.6, 10.3], [13.2, 11.9], [17.6, 14.3]],
    best: 'pass:0', cue: 'Two defenders! {m0} was open behind you.' },
  { id: 'lu-forward', hero: [6, 10], heroTo: [9, 10], mates: [[8, 16], [17, 6]],
    opps: [[12, 11], [14, 16.5], [24, 12]], oppsTo: [[10.9, 10.6], null, null],
    best: 'pass:1', ok: ['pass:0'], cue: '{m1} was open and closer to the goal!' },
];

const BANK = { 'look-up': LOOK_UP };

export function allScenarios(skillId) {
  const base = BANK[skillId] || [];
  return base.flatMap(sc => [{ ...sc, skill: skillId }, { ...mirrorScenario(sc, PITCH.W), skill: skillId }]);
}

export const demoScenario = skillId => ({ ...BANK[skillId][0], skill: skillId });

// A round list: n scenarios, no repeats until the bank runs out, never the same base twice in a row.
export function pickRounds(skillIds, n, rnd = Math.random) {
  const pool = shuffle(skillIds.flatMap(allScenarios), rnd), out = [];
  while (out.length < n && pool.length) {
    const prev = out[out.length - 1];
    const i = pool.findIndex(s => !prev || s.id.replace(/m$/, '') !== prev.id.replace(/m$/, ''));
    out.push(pool.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return out;
}
