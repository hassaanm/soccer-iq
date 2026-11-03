import test from 'node:test';
import assert from 'node:assert/strict';
import { load, save, finishSession, nextSkill, isMastered, defaultProgress } from '../js/progress.js';
import { PATH } from '../js/skills.js';

const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('load falls back to defaults and round-trips', () => {
  const st = mem();
  const p = load(st);
  assert.equal(p.us, 'barca');
  p.us = 'spain'; save(p, st);
  assert.equal(load(st).us, 'spain');
});

test('load survives broken storage', () => {
  const p = load({ getItem: () => { throw new Error('blocked'); } });
  assert.deepEqual(p, defaultProgress());
});

test('good sessions move a skill up until mastered; bad ones move it down', () => {
  const p = defaultProgress();
  finishSession(p, 'look-up', 5, 6);
  finishSession(p, 'look-up', 6, 6);
  assert.equal(p.skills['look-up'].box, 2);
  assert.equal(isMastered(p, 'look-up'), false);
  finishSession(p, 'look-up', 5, 6);
  assert.equal(isMastered(p, 'look-up'), true);
  finishSession(p, 'look-up', 1, 6);
  assert.equal(p.skills['look-up'].box, 2);
});

test('nextSkill honors the grown-up pick only for ready skills', () => {
  const p = defaultProgress();
  assert.equal(nextSkill(p, PATH), 'look-up');
  p.settings.skill = 'one-goes';
  assert.equal(nextSkill(p, PATH), 'look-up');
});
