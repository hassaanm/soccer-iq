// (v96 small) The four page items, measured in a silent headless Chrome at 932x430 (the pop audit's own browser helpers:
// --mute-audio, speech and <audio> silenced): the settings switches, the Mini games chooser with 8 and 10 tiles, STEAL's look
// by distance (Live and the rondo), and the Live results card. Skipped when there is no Chrome (set CHROME=/path).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { serve, browser, PRE, tap, tapEl } from '../scripts/pop-audit.js';

const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tests = CHROME ? test : test.skip;

tests('the page items at 932x430: switches mirror, 8 and 10 tiles fit, STEAL by distance, no Classic lesson after Live', { timeout: 120000 }, async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/index.html`, b = await browser();
  const go = async (q, settings = {}) => { settings = { voice: false, sound: false, music: false, ...settings }; // (silence: no voice, no sound, no music in the test save; the audio stubs of PRE as well)
    await b.send('Page.addScriptToEvaluateOnNewDocument', { source: PRE + `;try{const k='soccer-iq:v1',s=JSON.parse(localStorage.getItem(k));Object.assign(s.settings,${JSON.stringify(settings)});localStorage.setItem(k,JSON.stringify(s));}catch{}` }).then(r => r.identifier);
    const l = b.once('Page.loadEventFired'); await b.send('Page.navigate', { url: base + '?audit=pop' + q }); await l; await sleep(2200);
  };
  const shown = sel => b.ev(`const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;`);
  try {
    await b.send('Page.enable'); await b.send('Runtime.enable');
    await b.send('Emulation.setDeviceMetricsOverride', { width: 932, height: 430, deviceScaleFactor: 1, mobile: false });
    // 1. switches: the knob sits the same gap from the right end on as from the left end off (menu and sound popup)
    await go('');
    const knobs = `return [...document.querySelectorAll('.sw')].filter(s => s.getBoundingClientRect().width > 0).map(s => { const i = s.querySelector('i'), tr = i.getBoundingClientRect(), cs = getComputedStyle(i, '::after'), m = new DOMMatrix(cs.transform === 'none' ? undefined : cs.transform), kl = tr.left + parseFloat(cs.left) + m.m41; return { gapL: kl - tr.left, gapR: tr.right - (kl + parseFloat(cs.width)) }; });`;
    const gaps = {};
    await b.ev(`document.querySelector('#gear').dispatchEvent(new PointerEvent('pointerdown')); await new Promise(r => setTimeout(r, 1400)); return 1`);
    for (const on of [false, true]) { await b.ev(`for (const c of document.querySelectorAll('.sw input')) c.checked = ${on}; await new Promise(r => setTimeout(r, 450)); return 1`); gaps['menu' + on] = await b.ev(knobs); }
    await b.ev(`document.querySelector('#menuClose').click(); await new Promise(r => setTimeout(r, 400)); document.querySelector('.home-sound').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await new Promise(r => setTimeout(r, 400)); return 1`);
    for (const on of [false, true]) { await b.ev(`for (const c of document.querySelectorAll('.sw input')) c.checked = ${on}; await new Promise(r => setTimeout(r, 450)); return 1`); gaps['sound' + on] = await b.ev(knobs); }
    for (const w of ['menu', 'sound']) {
      const off = gaps[w + 'false'], on = gaps[w + 'true']; assert.ok(off.length >= 3, `${w}: switches measured`);
      for (let i = 0; i < off.length; i++) { assert.ok(Math.abs(off[i].gapL - on[i].gapR) < .6, `${w} switch ${i}: off ${off[i].gapL.toFixed(1)} from the left, on ${on[i].gapR.toFixed(1)} from the right`); assert.ok(on[i].gapR < 4.5, `${w}: on is at the right end`); }
    }
    // 2. the Mini games chooser: all tiles in view, readable, tappable, clear of the close button (two dummy entries, here only)
    await go('');
    for (const n of [6, 8, 10]) {
      const r = await b.ev(`const { MINI } = await import('/js/mini/games.js'); MINI.length = 6; for (let i = 6; i < ${n}; i++) MINI.push({ ...MINI[i % 6], name: 'Dummy ' + i });
        const { openMini } = await import('/js/mini/chooser.js'); openMini(); await new Promise(r => setTimeout(r, 500));
        const R = e => e.getBoundingClientRect(), tiles = [...document.querySelectorAll('#minis .tile')], close = R(document.querySelector('#miniClose')), m = document.querySelector('#minis');
        const inside = (a, t) => a.left >= t.left - .5 && a.right <= t.right + .5 && a.top >= t.top - .5 && a.bottom <= t.bottom + .5;
        return { n: tiles.length, view: tiles.filter(t => { const x = R(t); return x.left >= 0 && x.right <= innerWidth && x.top >= 0 && x.bottom <= innerHeight; }).length,
          small: tiles.filter(t => R(t).width < 88 || R(t).height < 44).length, under: tiles.filter(t => { const x = R(t); return !(x.right <= close.left || x.left >= close.right || x.bottom <= close.top || x.top >= close.bottom); }).length,
          parts: tiles.filter(t => { const x = R(t), p = R(t.querySelector('.pic')), k = R(t.querySelector('.k')), s = t.querySelector('.st') && R(t.querySelector('.st')); return p.height >= 60 && k.height > 0 && inside(k, x) && !!s && inside(s, x); }).length,
          noScroll: m.scrollWidth <= m.clientWidth + 1 && m.scrollHeight <= m.clientHeight + 1, kfont: parseFloat(getComputedStyle(tiles[0].querySelector('.k')).fontSize) };`);
      assert.equal(r.n, n); assert.equal(r.view, n, `${n} tiles: all in view`); assert.equal(r.small, 0, `${n} tiles: none under 88 x 44`); assert.equal(r.under, 0, `${n} tiles: none under the close button`);
      assert.equal(r.parts, n, `${n} tiles: picture, name and best-score cup inside each tile`); assert.ok(r.noScroll, `${n} tiles: no scrolling`); assert.ok(r.kfont >= 14, `${n} tiles: name ${r.kfont}px`);
    }
    // more than ten: two rows that scroll sideways, the next tile partly in view
    { const r = await b.ev(`const { MINI } = await import('/js/mini/games.js'); MINI.length = 6; for (let i = 6; i < 13; i++) MINI.push({ ...MINI[i % 6], name: 'Dummy ' + i });
        const { openMini } = await import('/js/mini/chooser.js'); openMini(); await new Promise(r => setTimeout(r, 500)); const m = document.querySelector('#minis'), mr = m.getBoundingClientRect();
        const tiles = [...m.querySelectorAll('.tile')].map(t => t.getBoundingClientRect()); return { scrolls: m.scrollWidth > m.clientWidth + 1, peek: tiles.some(x => x.left < mr.right - 20 && x.right > mr.right + 8), rows: new Set(tiles.map(x => Math.round(x.top))).size };`);
      assert.ok(r.scrolls && r.peek && r.rows === 2, `13 tiles: ${JSON.stringify(r)}`); }
    // 3. STEAL in Live: not shown far, small and dim in the middle, full and bright in reach; SHOOT stays gold
    await go('&live=A', { mode: 'fast', liveVariant: 'A' });
    await tapEl(b, '#playBtn'); for (let i = 0; i < 30 && !await shown('#card'); i++) await sleep(200);
    await sleep(800); await tapEl(b, '#cardMain'); for (let i = 0; i < 30 && !await shown('#fSheet'); i++) await sleep(200);
    await sleep(1200); await tapEl(b, '#fSheet .fPick'); await sleep(2500);
    const place = D => b.ev(`const F = window.__fast, m = F.m, s = F.sim, me = s.a(m.me), foe = m.foes('us').find(x => !/k\\d/.test(x.id)) || m.foes('us')[0]; m.giveTo(foe.id, 'pass'); Object.assign(me, { x: 12, y: 10, tx: 12, ty: 10, sp: 0 }); Object.assign(s.a(foe.id), { x: 12 + ${D}, y: 10, tx: 12 + ${D}, ty: 10 }); s.ball.x = 12 + ${D}; s.ball.y = 10; m.meMove = null; return 1`);
    const look = () => b.ev(`const e = document.querySelector('#fAct'), cs = getComputedStyle(e), r = e.getBoundingClientRect(); return { kind: e.dataset.kind, opacity: +cs.opacity, scale: cs.scale === 'none' ? 1 : +cs.scale, w: r.width, color: cs.color, bg: cs.backgroundImage, pe: cs.pointerEvents };`);
    const seen = {};
    for (const [name, D] of [['far', 12], ['mid', 3.5], ['reach', 1]]) { for (let i = 0; i < 6; i++) { await place(D); await sleep(80); } await sleep(450); seen[name] = await look(); }
    assert.equal(seen.far.kind, 'steal'); assert.ok(seen.far.opacity === 0 && seen.far.pe === 'none', 'far: not shown, takes no touch');
    assert.ok(Math.abs(seen.mid.scale - .6) < .02 && Math.abs(seen.mid.opacity - .5) < .03 && seen.mid.w >= 44, `mid: ${JSON.stringify(seen.mid)}`);
    assert.ok(seen.reach.scale === 1 && seen.reach.opacity === 1 && seen.reach.w >= 100, `reach: ${JSON.stringify(seen.reach)}`);
    for (const k of ['far', 'mid', 'reach']) { assert.equal(seen[k].color, 'rgb(255, 255, 255)', 'white words'); assert.match(seen[k].bg, /rgb\(255, 122, 69\)/, 'red-orange'); }
    for (let i = 0; i < 4; i++) { await b.ev(`const F = window.__fast, m = F.m, me = F.sim.a(m.me); m.giveTo(m.me, 'pass'); Object.assign(me, { x: window.__fastL - 8, y: window.__fastW / 2, tx: window.__fastL - 8, ty: window.__fastW / 2 }); for (const f of m.foes('us')) if (Math.hypot(f.x - me.x, f.y - me.y) < 6) Object.assign(f, { x: f.x - 8, tx: f.x - 8 }); return 1`); await sleep(100); }
    await sleep(400); const shoot = await look(); assert.equal(shoot.kind, 'shoot'); assert.match(shoot.bg, /rgb\(255, 216, 77\)/, 'SHOOT keeps its gold');
    // 4. the Live results card has no "NEXT LESSON"
    await b.ev(`window.__fast.real = 99999; return 1`);
    for (let i = 0; i < 40 && !await shown('#results'); i++) await sleep(300); await sleep(1500);
    assert.ok(await shown('#goMatch'), 'Match is still offered'); assert.equal(await shown('#goLesson'), false, 'no Classic lesson offered after Live');
    // ... and in Classic the offer is still made
    assert.ok(await b.ev(`const { nextLesson } = await import('/js/flows.js'), { P } = await import('/js/ui/store.js'); P.settings.mode = 'slow'; const t = nextLesson(); P.settings.mode = 'fast'; return !!t && !!t.text;`), 'Classic: the next lesson is offered');
    // 3b. the rondo's "Win the ball"
    await go('');
    await tapEl(b, '#keeperBtn'); await sleep(1200); await tapEl(b, '#minis .tile[data-id=rondoWin]');
    for (let i = 0; i < 40 && !await b.ev(`return !!document.querySelector('#rSteal.show')`); i++) { await sleep(300); if (await shown('#card')) await tapEl(b, '#cardMain'); }
    await sleep(1000);
    const rlook = () => b.ev(`const e = document.querySelector('#rSteal'), cs = getComputedStyle(e), r = e.getBoundingClientRect(); return { opacity: +cs.opacity, scale: cs.scale === 'none' ? 1 : +cs.scale, w: r.width, color: cs.color, bg: cs.backgroundImage, pe: cs.pointerEvents };`);
    const rplace = D => b.ev(`const { stage } = await import('/js/mini/rondo-ui.js'), s = stage.sim, me = s.a('hero'), bl = s.ball, x = bl.x - ${D}, y = bl.y; Object.assign(me, { x, y, tx: x, ty: y, sp: 0 }); return 1`);
    const rs = {};
    for (const [name, D] of [['far', 9], ['mid', 3.5], ['reach', .9]]) { for (let i = 0; i < 16; i++) { await rplace(D); await sleep(60); } rs[name] = await rlook(); }
    assert.ok(rs.far.opacity === 0 && rs.far.pe === 'none', `rondo far: ${JSON.stringify(rs.far)}`);
    assert.ok(Math.abs(rs.mid.scale - .6) < .02 && Math.abs(rs.mid.opacity - .5) < .03, `rondo mid: ${JSON.stringify(rs.mid)}`);
    assert.ok(rs.reach.scale === 1 && rs.reach.opacity === 1 && rs.reach.w >= 100, `rondo reach: ${JSON.stringify(rs.reach)}`);
    for (const k of ['far', 'mid', 'reach']) { assert.equal(rs[k].color, 'rgb(255, 255, 255)'); assert.match(rs[k].bg, /rgb\(255, 122, 69\)/); }
  } finally { await b.close(); srv.close(); }
});
void tap;
