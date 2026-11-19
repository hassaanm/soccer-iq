// The lab (prototypes/lab/): the chooser (round 2 first) and each prototype's page and scripts exist and parse, every import points at a
// file that exists and a name it exports, each page keeps the game's save out of reach (the throwaway save is set before
// any module loads, and nothing imports js/storage.js itself), and the grown-ups menu has its row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), lab = join(root, 'prototypes/lab');
const PROTOS = ['d', 'e', 'h', 'i', 'a', 'b', 'c']; // (round 2: D, E, H, I, one match in his own view; round 1: A, B, C, top view)
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []));
const exportsName = (src, name) => src.split('\n').some(l => l.startsWith('export') && new RegExp(`(^|[^\\w$])${name}([^\\w$]|$)`).test(l));

test('the chooser links to each prototype, and each page has its script', () => {
  const chooser = readFileSync(join(lab, 'index.html'), 'utf8');
  assert.ok(existsSync(join(lab, 'lab.css')));
  for (const p of PROTOS) {
    assert.match(chooser, new RegExp(`href="${p}/index.html"`), `the chooser links to ${p}`);
    const page = readFileSync(join(lab, p, 'index.html'), 'utf8'), src = page.match(/<script type="module" src="([^"]+)"/)?.[1];
    assert.ok(src && existsSync(join(lab, p, src)), `${p}/index.html loads a script that exists`);
    // the throwaway save comes first: a classic script before the import map and the module
    const flag = page.indexOf('globalThis.SOCCER_THROWAWAY'), mod = page.indexOf('<script type="module"');
    assert.ok(flag > 0 && flag < mod, `${p}/index.html sets the throwaway save before any module`);
    assert.match(page, /"three": "https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\//, `${p}/index.html maps three.js`);
  }
});

test('every lab script parses, and its imports exist and export what it takes', () => {
  for (const f of walk(lab)) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f} does not parse: ${r.stderr}`);
    const text = readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /storage\.js|localStorage|sessionStorage/, `${f} must not touch the game's save`);
    for (const m of text.matchAll(/^import\s+(?:\{([^}]*)\}\s+from\s+)?['"](\.[^'"]+)['"]/gm)) {
      const target = resolve(dirname(f), m[2]); assert.ok(existsSync(target), `${f} imports ${m[2]}, which does not exist`);
      const t = readFileSync(target, 'utf8');
      for (const part of (m[1] || '').split(',').map(s => s.trim()).filter(Boolean)) assert.ok(exportsName(t, part.split(/\s+as\s+/)[0]), `${f} imports { ${part} } from ${m[2]}, which does not export it`);
    }
    // the game modules it loads at run time (js/…) exist
    const list = text.match(/\[([^\]]*)\]\.map\(m => import\(`\.\.\/\.\.\/\.\.\/js\/\$\{m\}\.js`\)\)/);
    if (list) for (const n of list[1].match(/'([^']+)'/g).map(s => s.slice(1, -1))) assert.ok(existsSync(join(root, 'js', n + '.js')), `js/${n}.js exists`);
  }
});

test('the chooser shows round 2 first and keeps round 1 under its own heading', () => {
  const chooser = readFileSync(join(lab, 'index.html'), 'utf8'), at = p => chooser.indexOf(`href="${p}/index.html"`), head = chooser.indexOf('Earlier tries (top view)');
  assert.ok(head > 0, 'the earlier tries have their heading');
  for (const p of ['d', 'e', 'h', 'i']) assert.ok(at(p) > 0 && at(p) < head, `${p} is above the earlier tries`);
  for (const p of ['a', 'b', 'c']) assert.ok(at(p) > head, `${p} is under the earlier tries`);
  assert.ok(!existsSync(join(lab, 'f')), 'F (the rondo) is not in the lab');
});

test('the grown-ups menu opens the lab', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8'), menu = readFileSync(join(root, 'js/ui/menu.js'), 'utf8');
  assert.match(html, /<button id="labBtn"[^>]*>/);
  assert.match(menu, /\$\('#labBtn'\)\.onclick = \(\) => \{ location\.href = 'prototypes\/lab\/index\.html'; \}/);
});
