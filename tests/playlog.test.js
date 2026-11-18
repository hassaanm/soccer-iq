// The play log (js/log.js, "Record play"): the packed track rows read back to within their 0.1 m, a pasted log reads the
// same without its line breaks or with stray spaces, thinning keeps it under its cap (and what is near a flag), a logged
// lesson decision is made again from its seed exactly, and the throwaway mode keeps nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../js/log.js';
import { makeGame, drive } from './harness.js';
import { generate, demoFor } from '../js/generate.js';
import { runsAt } from '../js/skills.js';

// A recorded session made up here: rows of three players moving (a walk, a sprint, a jump of metres), held still a while.
function fakeSession() {
  L.clear(); L.begin(s => [`LOG s=${s} v=test size=3v3 pitch=30x20`]);
  const sim = { agents: new Map([['hero', {}], ['m1', {}], ['o1', {}]]) }, truth = [];
  let x = 5, y = 7, t = 0;
  for (let k = 0; k < 240; k++) {
    t += .25 + (k % 3) * .01; const o = L.rowAt(L.idsFor(sim), t), R = L.ROWS;
    if (k % 40 < 25) { x += Math.sin(k / 5) * (k % 17 === 0 ? 4 : .3); y += Math.cos(k / 7) * .2; }
    const v = [[x, y, 1], [x + 3, y - 2, -2], [20 - x, y + 1, 3]];
    R.set([t, k > 100 ? .2 : 1, k > 50 ? 1 : 0, k > 50 ? 0 : .95, x + .3, y, k % 9 === 0 ? 1.2 : 0, k % 9 === 0 ? 1 : 0, x + 2, y, .5, .3, 8, 40], o);
    v.forEach((q, i) => R.set(q, o + L.HEAD + i * 3));
    truth.push({ t, v });
    if (k === 60) L.hotOn(t); if (k === 80) L.hotOff(t);
  }
  return truth;
}

test('track rows read back to within 0.05 m, from the text however it was pasted', () => {
  const truth = fakeSession(), text = L.text();
  const rows = L.parse(text).filter(r => r.type === 'T').flatMap(r => L.track(r).rows);
  assert.ok(rows.length > 60, 'rows kept: 4 a second around the choice, 1 a second else');
  for (const r of rows) {
    const k = truth.reduce((a, b) => (Math.abs(b.t - r.t) < Math.abs(a.t - r.t) ? b : a));
    assert.ok(Math.abs(k.t - r.t) < .06, `row time ${r.t} vs ${k.t}`);
    assert.ok(Math.abs(r.p.hero.x - k.v[0][0]) < .051 && Math.abs(r.p.o1.y - k.v[2][1]) < .051, `places at ${r.t}`);
  }
  const same = x => JSON.stringify(L.parse(x).filter(r => r.type === 'T').flatMap(r => L.track(r).rows));
  assert.equal(same(text.replace(/\n/g, '')), same(text), 'no line breaks');
  assert.equal(same(text.replace(/\n/g, '  ')), same(text), 'line breaks turned to spaces');
  assert.equal(same(text.replace(/(.{70})/g, '$1\n   ')), same(text), 'wrapped, with spaces');
});

test('thinning keeps the log under its cap, dropping idle rows first and keeping what is near a flag', () => {
  const lines = [];
  for (let s = 1; s <= 2; s++) { lines.push(`|0.0 LOG s=${s} v=test`); for (let t = 1; t < 400; t++) { lines.push(`|${t}.0 T ${t % 3 ? 'i' : 'd'} hero ${'x'.repeat(200)}`); lines.push(`|${t}.0 SAY text="line ${t}"`); } }
  lines.push('|200.0 FLAG n=1');
  const out = L.thin(lines, 40000), size = out.reduce((n, l) => n + l.length + 1, 0);
  assert.ok(size <= 40000, `${size} over the cap`);
  assert.match(out[0], /^\|0\.0 THIN /);
  assert.ok(out.some(l => l.startsWith('|195.0 T ')), 'the rows 5 s before the flag stay');
  assert.ok(out.filter(l => / LOG /.test(l)).length === 2, 'session headers stay');
});

test('a logged lesson decision is made again from its seed, with everyone where the log has them', async () => {
  const sc = generate('look-up', 3, { runs: 3 });
  const d = { scene: { id: sc.id, skill: sc.skill, pattern: sc.pattern, seed: '3', lv: '1', mode: 'lesson', hero: sc.heroTo.join(',') }, opts: { list: [] } };
  const made = L.sceneFor(d, { generate, demoFor, runsAt });
  assert.equal(made.how, 'seed'); assert.deepEqual(made.sc, sc);
  const run = async () => { const { g } = makeGame(); g.levelOf = () => 1; g.mode = 'lesson'; g.load(made.sc); await drive(g, g.pre()); g.decide(); return g; };
  const a = await run(), b = await run(), pic = { p: Object.fromEntries([...a.sim.agents.values()].map(x => [x.id, { x: x.x, y: x.y }])) };
  assert.ok(L.gap(b, pic).worst < 1e-9, 'the same scene opens its window with everyone in the same place');
  const live = { scene: { id: 'live', how: 'play', sc: { id: 'live', kind: 'attack', hero: [10, 10], mates: [[12, 8]], opps: [[14, 10]] } }, opts: { list: [{ opt: 'pass:0', rating: 'best' }, { opt: 'drib:fwd', rating: 'safe' }] } };
  const m = L.sceneFor(live, { generate, demoFor, runsAt });
  assert.equal(m.how, 'snapshot'); assert.equal(m.sc.best, 'pass:0'); assert.deepEqual(m.sc.safe, ['drib:fwd']); assert.deepEqual(m.sc.oppsTo, [[14, 10]]);
});

test('lines and values read back: k=v words, JSON strings, options by grade, places', () => {
  const f = L.fields(`n=3 opt=pass:1 text=${L.v('Your turn! "go"')} u=0.45`);
  assert.deepEqual(f, { n: '3', opt: 'pass:1', text: 'Your turn! "go"', u: '0.45' });
  const o = L.options('n=1 best=shoot ok=push:fwd,push:fl safe=drib:back bad=pass:0 at=spot:in@12.3,5;turn:L@4,-1');
  assert.deepEqual(o.list.map(x => x.opt + ':' + x.rating), ['shoot:best', 'push:fwd:ok', 'push:fl:ok', 'drib:back:safe', 'pass:0:bad']);
  const p = L.places('u=0 gt=0 hero=1.5,2,90,0.5,-1 ball=1.9,2,0,c,hero');
  assert.deepEqual(p.p.hero, { x: 1.5, y: 2, h: 90, vx: .5, vy: -1 }); assert.equal(p.ball.carrier, 'hero');
  assert.equal(L.v('a|b\nc'), '"a b c"', 'no line marks or breaks inside a value');
});

test('the play log is kept under its own key, through js/storage.js, never in the save, and wired into the game', () => {
  const code = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  assert.match(code('js/storage.js'), /export const PLAY_LOG = 'soccer-iq:playlog'/);
  assert.match(code('js/log.js'), /if \(throwaway\) return;/, 'the throwaway mode (speed test, review page) writes nothing');
  assert.match(code('js/ui/playlog.js'), /!!P\.settings\.recordSpeed && !throwaway/, 'never records on a throwaway save');
  const html = code('index.html');
  for (const id of ['logFlag', 'logCopy', 'logClear', 'logSheet', 'logText', 'logClearM']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /Record play/);
  assert.match(code('css/app.css'), /body\.logon #hud:not\(\.hidden\) ~ #logFlag\{display:block\}/, 'the flag shows only while recording, in play');
});
