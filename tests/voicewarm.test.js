// (round 12) The lines loaded as a mode starts (js/ui/voicewarm.js) cover every line the recordings are made from
// (tests/spoken.js) that is not a scene's own cue or a lesson's name or tip: a new shared line cannot be missed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spokenLines, clean } from './spoken.js';
import { ALL_LESSONS, PATH, allScenarios } from '../js/skills.js';
import { CUPS } from '../js/cups.js';
import { pieces, clipKey } from '../js/voice.js';

test('voicewarm: the shared lines, a round list and the keeper game together cover every recorded line', async () => {
  const loaded = new Set();
  const W = await import('../js/voicelines.js');
  const scenes = PATH.flatMap(s => allScenarios(s.id));
  W.linesFor(scenes).forEach(l => loaded.add(l)); W.keeperLines().forEach(l => loaded.add(l));
  const keys = new Set([...loaded].flatMap(l => pieces(clean(l.replaceAll('{m0}', 'Saka').replaceAll('{m1}', 'Rice').replaceAll('{m2}', 'Saka'))).map(clipKey)));
  // what a round list brings itself: cues (any scene's), lesson names and tips; and what only menus say
  const own = new Set([...ALL_LESSONS.flatMap(s => [s.kid, s.tip]), ...CUPS.map(c => c.name), 'Train first!', 'Start a new cup?'].map(clean));
  const missing = spokenLines().filter(l => !own.has(l) && !/^You kept it! Even better/.test(l)).filter(l => pieces(l).some(p => !p.name && !keys.has(clipKey(p))));
  // (a scene's own cue is loaded with its round list: every generated scene's cue, at every size, is left out here)
  const { SIZES, TEAM, setSize } = await import('../js/geom.js'), { generate } = await import('../js/generate.js'), cues = new Set(), was = TEAM.size;
  for (const size of Object.keys(SIZES).filter(k => SIZES[k].offer)) { setSize(size); for (const sk of PATH) for (let seed = 1; seed <= 140; seed++) { const sc = seed <= 10 ? generate(sk.id, 100 + seed) : generate(sk.id, seed); for (const c of [sc?.cue, sc?.then?.cue]) if (c) cues.add(clean(c.replaceAll('{m0}', 'Saka').replaceAll('{m1}', 'Rice').replaceAll('{m2}', 'Saka'))); } }
  setSize(was);
  const shared = missing.filter(l => !cues.has(l));
  assert.deepEqual(shared, [], 'lines said in play that voicewarm.js does not load');
});
