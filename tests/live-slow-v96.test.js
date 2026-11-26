// (v96 integration) Live's slow look at a decision moment, played in a silent headless Chrome (the pop audit's helpers:
// --mute-audio, --disable-speech-api, speech and <audio> stubbed; voice, sound and music off in the save). In A, B and D
// the HUD box takes the class `slowing` (the blue edge #fSlow and the chevrons) while the decision slows the world; C
// never slows; E has its own `crawl` look instead. (A merge once left the toggle behind a // comment: A, B, D lost it.)
// Skipped when there is no Chrome (set CHROME=/path).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { serve, browser, PRE, tapEl } from '../scripts/pop-audit.js';

const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tests = CHROME ? test : test.skip;

// One variant: a match started, the ball given to him three times, the HUD sampled every 100 ms while a decision is open.
export async function slowLook(b, base, v) {
  const silent = `;try{const k='soccer-iq:v1',s=JSON.parse(localStorage.getItem(k));Object.assign(s.settings,{voice:false,sound:false,music:false});localStorage.setItem(k,JSON.stringify(s));}catch{}`;
  const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: PRE + silent });
  const l = b.once('Page.loadEventFired'); await b.send('Page.navigate', { url: base + '?audit=pop&live=' + v }); await l; await sleep(2200);
  const shown = sel => b.ev(`const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.classList.contains('hidden') && e.getBoundingClientRect().width > 0;`);
  await tapEl(b, '#playBtn'); for (let i = 0; i < 30 && !await shown('#card'); i++) await sleep(200);
  await sleep(600); await tapEl(b, '#cardMain'); for (let i = 0; i < 30 && !await shown('#fSheet'); i++) await sleep(200);
  await sleep(1000); await tapEl(b, '#fSheet .fPick'); await sleep(2500);
  const out = { v, dec: 0, slowing: 0, crawl: 0, fSlowMax: 0, slowMin: 9, withBall: 0, slowingWithBall: 0 };
  for (let k = 0; k < 3; k++) {
    await b.ev(`const F = window.__fast, m = F.m; m.after(0, () => { if (!m.dead && m.owner() !== m.me && !m.flight && !F.aiming) m.giveTo(m.me, 'pass'); }); return 1;`);
    for (let i = 0; i < 30; i++) {
      await sleep(100);
      const s = await b.ev(`const F = window.__fast, box = F.dom.box; return { on: !!F.dec.on, has: F.m.owner() === F.me, slowing: box.classList.contains('slowing'), crawl: box.classList.contains('crawl'), op: +getComputedStyle(document.querySelector('#fSlow')).opacity, slow: F.slow };`);
      if (s.has) { out.withBall++; if (s.slowing) out.slowingWithBall++; }
      if (!s.on) continue;
      out.dec++; if (s.slowing) out.slowing++; if (s.crawl) out.crawl++; out.fSlowMax = Math.max(out.fSlowMax, s.op); out.slowMin = Math.min(out.slowMin, s.slow);
    }
    await sleep(1500);
  }
  await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  return out;
}

tests('Live: the slow look shows at a decision in A, B and D; never in C; E has its crawl look instead', { timeout: 240000 }, async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/index.html`, b = await browser();
  try {
    await b.send('Page.enable'); await b.send('Runtime.enable');
    await b.send('Emulation.setDeviceMetricsOverride', { width: 932, height: 430, deviceScaleFactor: 1, mobile: false });
    for (const v of ['A', 'B', 'C', 'D', 'E']) {
      const r = await slowLook(b, base, v), say = JSON.stringify(r);
      if (v === 'C') { assert.ok(r.withBall > 5, `C: he had the ball (${say})`); assert.equal(r.slowingWithBall, 0, `C never slows (${say})`); continue; }
      assert.ok(r.dec >= 5, `${v}: decision moments seen (${say})`);
      if (v === 'E') { assert.equal(r.slowing, 0, `E: no slow look (${say})`); assert.ok(r.crawl >= r.dec * .8, `E: its crawl look (${say})`); continue; }
      assert.ok(r.slowing >= r.dec * .8, `${v}: the box is 'slowing' at a decision (${say})`);
    }
  } finally { await b.close(); srv.close(); }
});
