// The sound rules that keep the game clear over wireless CarPlay (research/carplay-audio.md). The browser modules
// can't run here, so these checks read the source as text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []));
const files = walk(join(root, 'js'));
const code = f => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1'); // without comments

test('the game never makes a live AudioContext (only offline ones, for recording)', () => {
  for (const f of files) {
    const hits = code(f).match(/(?<!Offline)\bAudioContext\b|\bwebkitAudioContext\b/g);
    assert.equal(hits, null, `${relative(root, f)} uses ${hits?.join(', ')}: a live AudioContext sets the whole page's audio to a tiny buffer`);
  }
});

test('every sound the game asks for is recorded (footsteps are left out on purpose)', () => {
  const src = code(join(root, 'js/sound.js'));
  const recorded = new Set([...src.match(/const SFX = \{([\s\S]*?)\n\};/)[1].matchAll(/^\s+(\w+): /gm)].map(m => m[1]));
  const asked = new Set();
  for (const f of files) {
    const src = code(f);
    for (const m of src.matchAll(/\bsfx\(/g)) { // the call's arguments, up to its closing bracket
      let i = m.index + m[0].length, depth = 1; while (depth && i < src.length) depth += { '(': 1, ')': -1 }[src[i++]] || 0;
      for (const n of src.slice(m.index, i).replace(/[=!]==\s*'\w+'/g, '').matchAll(/'(\w+)'/g)) asked.add(n[1]);
    }
  }
  assert.ok(asked.has('kick') && asked.has('goal'), 'found the calls');
  for (const name of asked) assert.ok(recorded.has(name) || name === 'step', `sfx('${name}') has no recording`);
});

test('the sound lab is linked from nowhere in the game', () => {
  for (const f of files) assert.ok(!code(f).includes('sound-lab'), relative(root, f));
  assert.ok(!readFileSync(join(root, 'index.html'), 'utf8').includes('sound-lab'), 'index.html');
});
