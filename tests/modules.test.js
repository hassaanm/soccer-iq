// The app has no build step and no test loads the browser modules (main.js, world.js, js/ui/*), so these checks
// read the source files as text: every import must point at a file that exists and a name that file exports,
// and index.html must know every module (it re-fetches them all when an update leaves the phone with a mix of
// old and new files).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []));
const files = walk(join(root, 'js')), text = Object.fromEntries(files.map(f => [f, readFileSync(f, 'utf8')]));
const rel = f => relative(root, f);
// A name counts as exported if it appears on a line that starts with `export`.
const exportsName = (src, name) => src.split('\n').some(l => l.startsWith('export') && new RegExp(`(^|[^\\w$])${name.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(l));

test('every import points at a module that exists and exports that name', () => {
  for (const f of files) {
    for (const m of text[f].matchAll(/^import\s+(?:\{([^}]*)\}\s+from\s+)?['"](\.[^'"]+)['"]/gm)) {
      const target = resolve(dirname(f), m[2]);
      assert.ok(text[target] !== undefined, `${rel(f)} imports ${m[2]}, which does not exist`);
      for (const part of (m[1] || '').split(',').map(s => s.trim()).filter(Boolean)) {
        const name = part.split(/\s+as\s+/)[0];
        assert.ok(exportsName(text[target], name), `${rel(f)} imports { ${name} } from ${m[2]}, which does not export it`);
      }
    }
  }
});

test('index.html lists every module for the fresh re-fetch after an update', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const list = html.match(/const files = \[([^\]]*)\]/);
  assert.ok(list, 'index.html has the list of modules');
  const listed = [...list[1].matchAll(/'([^']+)'/g)].map(m => `js/${m[1]}.js`).sort();
  assert.deepEqual(listed, files.map(rel).sort());
});

test('no module is left unused', () => {
  const used = new Set([join(root, 'js/main.js')]);
  for (const f of files) for (const m of text[f].matchAll(/^import\s+(?:[^'"]*\s+from\s+)?['"](\.[^'"]+)['"]/gm)) used.add(resolve(dirname(f), m[1]));
  assert.deepEqual(files.filter(f => !used.has(f)).map(rel), []);
});
