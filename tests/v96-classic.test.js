// (v96) The Classic game's polish, at the size being played (SOCCER_SIZE):
//   1. The ball goes round with him as he turns to look (pro/motion.js rollBall): in the picture only. Every choice, its
//      grade, its stars and the play after it are the same, frame by frame, with the roll drawn and without it; and as it
//      is drawn the ball stays in front of his feet (never through them, never behind his heel), a sole on it as it rolls,
//      and it is back on the game's ball by the moment a kick meets it.
//   2. The demo's hand: each target on the field is named (a player, an arrow, a ring), and holds still on the screen
//      from the moment the hand sets off for it to its tap (the owner: "it changed before it actually clicked").
//   3. The view on a screen narrower than a phone's: the phone's own height of field (game/shared.js focal); the phone
//      itself, and every screen as wide as a 16:9 phone, as before.
//   4. A demo's view after its idea never draws back before the choice, and never stands still for 0.6 s.
//   5. A skill offer shows 1.5 s or more, or not at all (the step-up's flash at 5v5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PATH, allScenarios } from '../js/skills.js';
import { TEAM } from '../js/geom.js';
import { makeGame, drive, optionsFor } from './harness.js';
import { focal, PHONE } from '../js/game/shared.js';
import { poser } from '../scripts/stand-audit.js';

const animateRig = await poser();
const VW = 932, VH = 430;
// The game's camera as world.js draws it (a stand-in for the page's).
function project(g, x, y, z) {
  const cam = g.cam; if (!cam) return [VW / 2, VH / 2];
  const f = [cam.tgt[0] - cam.eye[0], cam.tgt[1] - cam.eye[1], cam.tgt[2] - cam.eye[2]], fl = Math.hypot(...f); f.forEach((v, i) => { f[i] = v / fl; });
  let r = [f[1], -f[0], 0]; const rl = Math.hypot(...r) || 1; r = r.map(v => v / rl);
  const up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]], d = [x - cam.eye[0], y - cam.eye[1], z - cam.eye[2]];
  const zz = d[0] * f[0] + d[1] * f[1] + d[2] * f[2]; if (zz < .3) return null;
  const F = focal(VW, VH, cam); return [VW / 2 + F * (d[0] * r[0] + d[1] * r[1]) / zz, VH / 2 - F * (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / zz];
}
const seeing = g => { g.world.canvas = { clientWidth: VW, clientHeight: VH }; g.world.project = (x, y, z) => project(g, x, y, z); return g; };
const fakeRig = seed => { const o = () => ({ set() {}, setScalar() {} }), part = () => ({ rotation: o(), position: o(), scale: o() }); const P = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : P), apply: () => P });
  const legs = [0, 1].map(() => ({ hip: { position: { x: 0 }, quaternion: P }, knee: { rotation: {} }, foot: { quaternion: P } }));
  const g = { userData: { seed, legs, arms: [part(), part()], elbows: [{ rotation: {} }, { rotation: {} }], pelvis: part(), torso: part(), head: part(), blob: part(), yaw: null, face: null }, pos: [0, 0, 0], rotation: o() };
  g.position = { set: (x, y, z) => { g.pos[0] = x; g.pos[1] = y; g.pos[2] = z; } }; return g; };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a)), deg = a => a * 180 / Math.PI;

// One play of `opt` in scene `sc`: his head up, the view turned `turns` (radians, one after another, a second each, with a
// second's hold after each) while he decides, then his choice. Everyone is posed every frame as world.js poses them, the
// roll drawn (`roll`) or not (the game's sim.ballShow taken away before each pose). Returns the play frame by frame, what
// was drawn, and how it ended.
async function lookPlay(sc, opt, turns, roll) {
  const { g, events } = makeGame(); g.mode = 'lesson'; g.load(sc);
  const rigs = new Map(), trace = [], drawn = []; let T = 0;
  const pose = () => { const s = g.sim; if (!roll) s.ballShow = null; for (const a of s.agents.values()) { let r = rigs.get(a.id); if (!r) rigs.set(a.id, r = fakeRig(.13 + rigs.size * .17)); animateRig(r, a, s, 0, 0, g.ui.clock ?? T); }
    const h = s.a('hero'), b = s.ball, bs = s.ballShow, r = rigs.get('hero'), kt = h?.kickAt != null ? s.time - h.kickAt : 9;
    if (h && b.state === 'carried' && b.carrier === 'hero') drawn.push({ ph: g.phase, x: bs?.x ?? b.x, y: bs?.y ?? b.y, gx: b.x, gy: b.y, hx: h.x, hy: h.y, body: r.userData.yaw, w: r.userData.m?.roll?.w || 0, kt, move: !!b.move });
    trace.push([...s.agents.values()].map(a => `${a.id}:${a.x.toFixed(6)},${a.y.toFixed(6)}`).join(' ') + ` b:${b.x.toFixed(6)},${b.y.toFixed(6)},${b.state},${b.carrier}`); };
  await drive(g, g.pre(), { onFrame: () => { T += 1 / 30; pose(); } });
  let k = 0, y0 = null; const end = turns.length * 2 + .5;
  const o = await drive(g, g.decide(), { pick: () => (k / 30 > end ? opt : null), onFrame: gm => { T += 1 / 30; k++;
    if (gm.phase === 'decide') { gm.lookUp = true; gm.scanned = true; y0 ??= gm.yaw; const t = k / 30, i = Math.min(turns.length - 1, Math.floor(t / 2)), u = Math.min(1, t / 2 - i);
      gm.yaw = y0 + turns.slice(0, i).reduce((p, q) => p + q, 0) + turns[i] * Math.min(1, u * 2); }
    pose(); } });
  const good = g.isGood(o); await drive(g, g.outcome(o, good), { onFrame: () => { T += 1 / 30; pose(); }, maxSec: 30 });
  return { trace, drawn, good, result: g.result, rated: g.rated && { stars: g.rated.stars, text: g.rated.text }, banners: events.filter(e => e[0] === 'banner').map(e => e[1]) };
}
// Scenes with the ball at his feet as he decides: the first of each lesson that has one.
const ballScenes = () => PATH.map(sk => allScenarios(sk.id).find(sc => !sc.kind || sc.kind === 'attack')).filter(Boolean);

test('1. the ball goes round with him in the picture only: every option, grade, star and play the same', async () => {
  let plays = 0;
  for (const sc of ballScenes().slice(0, 6)) for (const opt of optionsFor(sc).filter(o => !o.startsWith('then:')).slice(0, 5)) {
    const a = await lookPlay(sc, opt, [1.7, -3.2], true), b = await lookPlay(sc, opt, [1.7, -3.2], false); plays++;
    assert.equal(a.trace.length, b.trace.length, `${sc.id} ${opt}: as many frames`);
    const i = a.trace.findIndex((x, j) => x !== b.trace[j]); assert.equal(i, -1, `${sc.id} ${opt}: the play differs from frame ${i}: ${a.trace[i]?.slice(0, 200)} / ${b.trace[i]?.slice(0, 200)}`);
    assert.deepEqual([a.good, a.result, a.rated, a.banners], [b.good, b.result, b.rated, b.banners], `${sc.id} ${opt}: the same grade, result, stars and words`);
    assert.ok(a.drawn.some(d => Math.hypot(d.x - d.gx, d.y - d.gy) > .15), `${sc.id} ${opt}: the ball was drawn round with him`);
  }
  assert.ok(plays >= 20, `${plays} plays`);
});

test('1. as drawn, the ball stays in front of his feet, under his sole as it rolls, and is back on the game\'s ball for a kick', async () => {
  for (const sc of ballScenes().slice(0, 8)) for (const [turns, opt] of [[[1.6, -3.1], sc.best], [[-2.8, 2.2], sc.best], [[2.9, 0], 'pass:0']]) {
    if (!optionsFor(sc).includes(opt)) continue;
    const { drawn } = await lookPlay(sc, opt, turns, true);
    let rolled = 0, sole = 0;
    for (const d of drawn) {
      const r = Math.hypot(d.x - d.hx, d.y - d.hy), rg = Math.hypot(d.gx - d.hx, d.gy - d.hy), off = Math.hypot(d.x - d.gx, d.y - d.gy), rel = Math.abs(deg(wrap(Math.atan2(d.y - d.hy, d.x - d.hx) - d.body)));
      if (off > .02) { rolled++; if (d.w > .5) sole++;
        assert.ok(r >= Math.min(rg, .3) - .005, `${sc.id} ${opt}: the ball drawn ${r.toFixed(2)} m from his middle (never in through his feet)`);
        if (d.ph === 'decide' && !d.move) assert.ok(rel < 75, `${sc.id} ${opt}: the ball drawn ${rel.toFixed(0)}° off the way his body faces as he looks (never behind his heel)`); }
      if (d.kt > .19 && d.kt < .23) assert.ok(off < .01, `${sc.id} ${opt}: the ball drawn ${off.toFixed(3)} m off the game's as the kick meets it`);
    }
    assert.ok(rolled > 10 && sole > 3, `${sc.id} ${opt}: it rolled (${rolled} frames off the game's ball, ${sole} with a sole on it)`);
  }
});

test('2. the demo\'s hand: a named target that holds still on the screen until the hand taps it', async () => {
  for (const sk of PATH) {
    const { g } = makeGame(); seeing(g); let done = false, cur = null, taps = 0; const rows = [];
    g.demo(sk.id).then(() => { done = true; });
    for (let f = 0; f < 30 * 150 && !done; f++) {
      g.tick(1 / 30, f / 30); await null;
      const at = g.handAt; if (at !== cur?.at) cur = at && typeof at === 'object' && at.sx == null ? { at, pts: [] } : null;
      if (cur) { assert.ok(cur.at.id || cur.at.opt, `${sk.id}: the hand's target on the field is a player or a choice, not a copy of where it was`); const p = g.handPoint(cur.at), q = p && project(g, p.x, p.y, p.z); if (q) cur.pts.push(q); }
      if ((g.handTap || 0) !== taps) { taps = g.handTap; if (cur?.pts.length) { const p0 = cur.pts[0]; rows.push([cur.at.opt || cur.at.id, Math.max(...cur.pts.map(p => Math.hypot(p[0] - p0[0], p[1] - p0[1])))]); } }
    }
    assert.ok(done, `${sk.id}: the demo ends`);
    for (const [what, mv] of rows) assert.ok(mv <= 20, `${sk.id}: ${what} moved ${mv.toFixed(0)} px on the screen while the hand went to it and tapped`);
  }
});

test('3. the view: as before on the phone and every screen as wide as a 16:9 phone; the phone\'s height of field on narrower ones', () => {
  const views = [{ Ff: 1.05, Fw: .64 }, { Ff: .9, Fw: .52 }, { Ff: .8, Fw: .41 }, { Ff: .9, Fw: .45 }, { Ff: 1.02, Fw: .56 }];
  for (const v of views) for (const [w, h] of [[932, 430], [844, 390], [667, 375], [1180, 820 * 1.4], [1600, 900]].filter(([w, h]) => w / h >= 1.75))
    assert.equal(focal(w, h, { ...v, Fa: PHONE }), Math.max(h * v.Ff, w * v.Fw), `${w}x${h}: as before`);
  for (const v of views.slice(0, 2)) for (const [w, h] of [[1024, 768], [1000, 1000], [1180, 820]]) {
    assert.ok(Math.abs(focal(w, h, { ...v, Fa: PHONE }) / h - Math.max(VH * v.Ff, VW * v.Fw) / VH) < 1e-9, `${w}x${h}: the phone's height of field (his player the same share of the height)`);
    assert.equal(focal(w, h, v), Math.max(h * v.Ff, w * v.Fw), `${w}x${h}: a view without Fa (every other mode) as before`);
  }
  const src = readFileSync(new URL('../js/world.js', import.meta.url), 'utf8');
  assert.ok(/const F = focal\(Wpx, Hpx, cam\)/.test(src), 'world.js draws with the same lens (shared.js focal)');
});

test('4. a demo\'s view after its idea: never drawn back before the choice, never still for 0.6 s', async () => {
  for (const sk of PATH) {
    const { g } = makeGame(); seeing(g); let done = false, chose = false, was = null; const rows = [], back = [];
    const oc = g.outcome.bind(g); g.outcome = (o, good) => { chose = true; return oc(o, good); };
    g.demo(sk.id).then(() => { done = true; });
    for (let f = 0; f < 30 * 150 && !done && !chose; f++) {
      const P = g.push; g.tick(1 / 30, f / 30); await null; // (the push this frame's view was made with: the demo sets the next one after the frame)
      if (g.phase !== 'decide' || !g.cam || g.win?.demo?.crawl != null || !P?.close || P !== was) { was = P; continue; }
      const S = g.lastSpec, Wt = g.lastWant, et = v => Math.hypot(v.eye[0] - v.tgt[0], v.eye[1] - v.tgt[1], v.eye[2] - v.tgt[2]);
      if (S && Wt && et(Wt) > et(S) + .01) back.push(`${(f / 30).toFixed(1)} s: ${(et(Wt) - et(S)).toFixed(2)} m`);
      rows.push({ t: f / 30, cam: [...g.cam.eye, ...g.cam.tgt], ps: [...g.sim.agents.values()].map(a => [a.x, a.y]) });
    }
    assert.deepEqual(back.slice(0, 3), [], `${sk.id}: the view drawn back after the idea`);
    for (let i = 0, j = 0; i < rows.length; i++) { while (rows[i].t - rows[j].t > .6) j++; if (rows[i].t - rows[j].t < .55) continue;
      const a = rows[j], b = rows[i], cm = Math.hypot(...b.cam.map((v, k) => v - a.cam[k])), mv = Math.max(...b.ps.map((p, k) => (a.ps[k] ? Math.hypot(p[0] - a.ps[k][0], p[1] - a.ps[k][1]) : 0)));
      assert.ok(cm >= .03 || mv >= .05, `${sk.id}: nothing moves from ${a.t.toFixed(1)} s to ${b.t.toFixed(1)} s (the view ${cm.toFixed(3)} m, the players ${mv.toFixed(3)} m)`); }
  }
});

test('5. a skill offer shows 1.5 s or more, or not at all (the step-up\'s flash at 5v5)', { skip: TEAM.size !== '5v5' && 'the step-up case is at 5v5' }, async () => {
  const short = [], RND = Math.random; let offers = 0;
  for (const seed of [235, 226, 231]) { // (235: an offer of v95 that showed 0.57 s: another of theirs got to him first)
    let x = seed * 7907; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647;
    let y = seed * 31337; const rnd = () => (y = (y * 48271) % 2147483647) / 2147483647;
    const { g } = makeGame(); g.skills = new Set(PATH.map(k => k.id)); let cur = null, done = false, last = null, delay = 0, openT = 0, T = 0;
    g.match(PATH.map(k => k.id), [], 3, 'free').then(() => { done = true; });
    for (let k = 0; k < 30 * 900 && !done; k++) { T += 1 / 30; g.tick(1 / 30, T);
      if (g.sk && g.sk !== cur) { cur = g.sk; offers++; cur.r0x = g.realTime; }
      if (cur && !cur.seenOut && cur.phase !== 'offer') { cur.seenOut = true; if (!cur.tapped && g.realTime - cur.r0x < 1.5) short.push(`seed ${seed}: ${(g.realTime - cur.r0x).toFixed(2)} s`); }
      if (g.sk?.phase === 'offer' && g.realTime - g.sk.r0x > 1.6) { g.sk.tapped = true; g.skillTap(g.sk.alts.findIndex(a => a.good)); }
      if (g.canAct && g._choose) { const sc = g.sc; if (g._choose !== last) { last = g._choose; delay = 1 + rnd() * 4; openT = T; }
        let o = null; if (sc.kind === 'tackle') o = g.tackleState() === 'good' ? sc.best : null;
        else if (T - openT >= delay) { const all = optionsFor(sc).filter(q => q !== sc.best); o = all.length && rnd() < .2 ? all[Math.floor(rnd() * all.length)] : sc.best || (sc.spots ? 'spot:' + sc.spots[0].id : 'drib:back'); }
        if (o) { g.seen.add('m1'); g.seen.add('m2'); if (g.sim.a('m3')) g.seen.add('m3'); try { g.choose(o); } catch { /* */ } } }
      if (k % 8 === 0) await new Promise(r => setImmediate(r)); else await null; }
  }
  Math.random = RND;
  assert.ok(offers >= 3, `${offers} offers`);
  assert.deepEqual(short, [], 'offers that showed under 1.5 s with no tap');
});
