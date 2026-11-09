// Cup runs: a knockout cup (quarter-final, semi-final, final) against teams from that cup, one match at a time.
// A lost match can be played again; winning the final puts the cup in the trophy case.
import { TEAMS, teamById } from './teams.js';
import { shuffle } from './geom.js';

const country = zone => t => t.type === 'country' && (!zone || zone.includes(t.zone));
const club = zone => t => t.type === 'club' && (!zone || zone.includes(t.zone));
// home: the team to play as when his own team can't enter (a club in a World Cup, say).
export const CUPS = [
  { id: 'worldcup', name: 'World Cup', emoji: '🏆', teams: country(), home: 'spain' },
  { id: 'ucl', name: 'Champions League', emoji: '⭐', teams: club(['eng', 'esp', 'ita', 'ger', 'fra', 'por']), home: 'barca' },
  { id: 'clubworld', name: 'Club World Cup', emoji: '🏅', teams: club(), home: 'barca' },
  { id: 'euros', name: 'Euros', emoji: '🇪🇺', teams: country(['europe']), home: 'spain' },
  { id: 'copa', name: 'Copa América', emoji: '🌎', teams: country(['americas']), home: 'argentina' },
  { id: 'facup', name: 'FA Cup', emoji: '🦁', teams: club(['eng']), home: 'arsenal' },
  { id: 'supercopa', name: 'Supercopa', emoji: '🇪🇸', teams: club(['esp']), home: 'barca', size: 4 },
];
export const cupById = id => CUPS.find(c => c.id === id);
const ROUND_NAMES = { 8: ['Quarter-final', 'Semi-final', 'Final'], 4: ['Semi-final', 'Final'] };
export const roundsOf = cup => ROUND_NAMES[cup.size || 8];

// The team he plays as: his own if it can enter, else the cup's team with his star in it (Barça's Yamal plays
// for Spain), else the cup's home team.
export function cupTeam(cup, us) {
  const t = teamById(us);
  if (cup.teams(t)) return t.id;
  return TEAMS.find(o => cup.teams(o) && o.players.some(p => p.name === t.players[0].name))?.id || cup.home;
}

// A new run: one opponent per round, all different.
export function newCup(cup, us, rnd = Math.random) {
  const team = cupTeam(cup, us), others = shuffle(TEAMS.filter(t => cup.teams(t) && t.id !== team).map(t => t.id), rnd);
  return { id: cup.id, team, opps: others.slice(0, roundsOf(cup).length), round: 0 };
}
// Goals to win: 2 in the early rounds, 3 in the final.
export const goalsToWin = run => (run.round === roundsOf(cupById(run.id)).length - 1 ? 3 : 2);
