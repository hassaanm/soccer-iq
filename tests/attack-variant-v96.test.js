// (v96 integration) Score attack runs on the Live controller (js/mini/attack-ui.js: fast.play) and takes the variant
// picked on the home screen, except E (the crawl, STAY, off-ball places): there it plays as A (the owner's decision).
// B, C and D stay as picked. Played in a silent headless Chrome (the pop audit's helpers; voice, sound, music off).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { serve, browser, PRE, tapEl } from '../scripts/pop-audit.js';

const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tests = CHROME ? test : test.skip;

test('Score attack asks fast.play for no E; a Live match does not', () => {
  const ui = readFileSync(new URL('../js/mini/attack-ui.js', import.meta.url), 'utf8'), fast = readFileSync(new URL('../js/fast/fast.js', import.meta.url), 'utf8');
  assert.match(ui, /fast\.play\(\{ us, them, warm: 'attack', noE: true \}\); \} finally \{ game\.plog = pl; \}/);
  assert.match(fast, /this\.vid = variantOf\(P\.settings\); if \(noE && this\.vid === 'E'\) this\.vid = 'A';/);
  assert.doesNotMatch(fast.replace(/play\(\{[^)]*\}\) \{/, ''), /noE: true/);
});

tests('Score attack with E picked plays as A (no crawl, no STAY); with B, C or D as picked', { timeout: 180000 }, async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/index.html`, b = await browser();
  try {
    await b.send('Page.enable'); await b.send('Runtime.enable');
    await b.send('Emulation.setDeviceMetricsOverride', { width: 932, height: 430, deviceScaleFactor: 1, mobile: false });
    for (const v of ['E', 'B', 'C', 'D']) {
      const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: PRE + `;try{const k='soccer-iq:v1',s=JSON.parse(localStorage.getItem(k));Object.assign(s.settings,{voice:false,sound:false,music:false,mode:'fast',liveVariant:'${v}'});localStorage.setItem(k,JSON.stringify(s));}catch{}` });
      const l = b.once('Page.loadEventFired'); await b.send('Page.navigate', { url: base + '?audit=pop' }); await l; await sleep(2200);
      await tapEl(b, '#keeperBtn'); await sleep(1200); await tapEl(b, '#minis .tile[data-id=attack]');
      let r = null; for (let i = 0; i < 40 && !(r?.on); i++) { await sleep(250); r = await b.ev(`const F = window.__fast; return F?.dom ? { on: !!F.on && F.dom.box.classList.contains('on') !== undefined && !!F.m?.scene, vid: F.vid, crawl: !!F.V?.crawl, vE: F.dom.box.classList.contains('vE') } : null`); }
      await sleep(4000);
      const s = await b.ev(`const F = window.__fast; return { vid: F.vid, crawl: !!F.V.crawl, vE: F.dom.box.classList.contains('vE'), stay: F.dom.stay.classList.contains('show'), saved: JSON.parse(localStorage.getItem('soccer-iq:v1')).settings.liveVariant }`);
      assert.equal(s.vid, v === 'E' ? 'A' : v, `${v}: ${JSON.stringify(s)}`);
      assert.equal(s.saved, v, 'the setting itself is not changed');
      if (v === 'E') { assert.equal(s.crawl, false); assert.equal(s.vE, false); assert.equal(s.stay, false); }
      await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    }
  } finally { await b.close(); srv.close(); }
});
