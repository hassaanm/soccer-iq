import test from 'node:test';
import assert from 'node:assert/strict';
import { CUPS, newCup, cupTeam, roundsOf, goalsToWin, cupById } from '../js/cups.js';
import { TEAMS, teamById } from '../js/teams.js';

test('every cup has enough teams, and a run has one different opponent per round', () => {
  for (const c of CUPS) {
    const n = TEAMS.filter(c.teams).length;
    assert.ok(n >= (c.size || 8), `${c.id}: ${n} teams`);
    assert.ok(c.teams(teamById(c.home)), `${c.id} home team can enter`);
    for (let i = 0; i < 20; i++) {
      const run = newCup(c, 'barca');
      assert.equal(run.opps.length, roundsOf(c).length);
      assert.equal(new Set([run.team, ...run.opps]).size, run.opps.length + 1);
      assert.ok([run.team, ...run.opps].every(id => c.teams(teamById(id))));
    }
  }
});

test('he plays as his team, or the country of his star', () => {
  assert.equal(cupTeam(cupById('ucl'), 'barca'), 'barca');
  assert.equal(cupTeam(cupById('worldcup'), 'barca'), 'spain', 'Yamal plays for Spain');
  assert.equal(cupTeam(cupById('worldcup'), 'madrid'), 'france', 'Mbappé plays for France');
  assert.equal(cupTeam(cupById('facup'), 'barca'), 'arsenal');
});

test('the final is first to 3', () => {
  const run = newCup(cupById('worldcup'), 'spain');
  assert.equal(goalsToWin(run), 2); run.round = 2; assert.equal(goalsToWin(run), 3);
});

test('every team has a place and a unique id', () => {
  assert.equal(new Set(TEAMS.map(t => t.id)).size, TEAMS.length);
  assert.ok(TEAMS.every(t => t.zone));
});
