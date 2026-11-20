// The grown-ups' "Speed" settings: Graphics (round 14: one standard look on every device, or what the speed test chose for
// this one) and "Record speed" (the frame recorder, js/perf.js) with its report to copy.
import { $ } from './dom.js';
import { P, save } from './store.js';
import { world } from './stage.js';
import * as perf from '../perf.js';
import { SFX_START, SFX_MODES } from '../sound.js';

// (round 14) There is no Smooth or Pretty choice any more: every device starts from the standard below (what the owner's
// phone landed on in the speed test: the cheap way of painting, sharpness 1.5, the head-down blur, the glow and the big
// words' soft shadow). A saved `settings.graphics` from before is ignored. The old full picture ('pretty') is drawn only in
// the speed test's comparison run.
export const graphics = () => 'smooth';
export const smooth = () => mode === 'smooth';
let mode = 'smooth';
export const STANDARD = { blur: true, glow: true, soft: true, pr: 0 };
export const TUNED_VERSION = 2; // (the speed test's version that wrote `settings.tuned`: an older result, as v76's, is ignored)
// What the speed test (dev/speed.html) chose for this device, kept in the save when it finishes: { blur, glow, soft, pr, sfx,
// at }. Each value wins over the standard only when it is a real one: true or false, a pixel ratio of 2 or 3, a known way of
// starting sounds; anything else ("no", "1") leaves the standard.
// A result from another version of the test, or one with no valid value at all, reads as the standard (fromTest false).
export const tunedFrom = settings => { const t = settings?.tuned, o = { ...STANDARD, fromTest: false }; if (!t || typeof t !== 'object' || t.tv !== TUNED_VERSION) return o;
  let n = 0;
  for (const k of ['blur', 'glow', 'soft']) if (typeof t[k] === 'boolean') { o[k] = t[k]; n++; }
  if (t.pr === 2 || t.pr === 3 || t.pr === 0) { if (t.pr) o.pr = t.pr; n++; }
  if (SFX_MODES.includes(t.sfx)) { o.sfx = t.sfx; n++; }
  if (!n) return { ...STANDARD, fromTest: false };
  if (typeof t.at === 'string') o.at = t.at;
  o.fromTest = true; return o; };
export const tuned = () => tunedFrom(P.settings);
// Smooth: no glow pass, a smaller shadow map (world.js), no blur over the moving picture and none behind cards
// (css: body.smooth), 60 pictures a second at most and fewer on the screens where nothing is played (main.js).
export function applyGraphics() {
  mode = graphics(); const sm = mode === 'smooth', t = tuned();
  document.body.classList.toggle('smooth', sm); document.body.classList.toggle('blur', sm && !!t.blur); // (blur: the head-down edge as in Pretty)
  document.body.classList.toggle('softwords', sm && !!t.soft); // (soft: the big words' soft shadow, css/app.css)
  world.setGraphics(mode, sm ? { bloom: t.glow ? 1 : 0, pr: t.pr } : {});
  SFX_START.mode = t.sfx || 'pool+later'; // (round 14: how effects start, as the speed test found best here; sound.js)
}
// (round 13) Switches for the speed test only (dev/speed.js); nothing here is saved. cap: the 60-a-second cap (main.js);
// strip: read the picture's bottom row for the iPad's strip colour even on an iPhone (null: as the device needs); onFrame:
// called with the time of every picture drawn.
export const TEST = { cap: true, strip: null, onFrame: null };
export function applyRecord() { if (P.settings.recordSpeed) perf.start(world.renderer); else perf.stop(); }
applyGraphics(); applyRecord();

const box = $('#recBox');
const showRecord = () => { if (!box) return; box.value = perf.rec.on ? perf.report() : 'Turn "Record speed" on, play for a few minutes, then come back here.'; box.hidden = false; $('#recCopy').hidden = false; };
if ($('#recChk')) {
  $('#recChk').onchange = () => { P.settings.recordSpeed = $('#recChk').checked; save(); applyRecord(); };
  $('#recShow').onclick = showRecord;
  $('#recCopy').onclick = async () => { box.focus(); box.select(); try { await navigator.clipboard.writeText(box.value); $('#recCopy').textContent = 'Copied'; } catch { try { document.execCommand('copy'); $('#recCopy').textContent = 'Copied'; } catch { $('#recCopy').textContent = 'Select the text and copy it'; } } };
}
if ($('#speedTestBtn')) $('#speedTestBtn').onclick = () => { location.href = 'dev/speed.html'; }; // (round 13: dev/speed.html)
// (v93) What is in force, in plain words (the menu and the speed test page both use these). Nothing is ever applied by the
// speed test by itself: it offers its result, and the grown-up chooses ("Use these settings" or "Keep what I have").
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m && MONTHS[+m[2] - 1] ? `${MONTHS[+m[2] - 1]} ${+m[3]}` : ''; }; // ('2026-11-20' -> 'Nov 20')
export const graphicsState = t => { const set = !!t.fromTest, d = set ? shortDate(t.at) : '';
  return { set, text: set ? `Graphics: tuned for this phone${d ? ` (${d})` : ''}` : 'Graphics: standard',
    facts: `sharpness ${t.pr || 1.5}, head-down blur ${t.blur ? 'on' : 'off'}, glow ${t.glow ? 'on' : 'off'}, soft shadow ${t.soft ? 'on' : 'off'}` }; };
// How a result (the speed test's { blur, glow, soft, pr, sfx }) differs from the standard, in words; [] = the same.
export const SFX_STANDARD = 'pool+later';
export const differences = b => { const d = [];
  if (b.pr) d.push('sharper picture'); if (b.blur === false) d.push('no head-down blur'); if (b.glow === false) d.push('no glow'); if (b.soft === false) d.push('no soft shadow');
  if (b.sfx && b.sfx !== SFX_STANDARD) d.push('sounds that start another way'); return d; };
// Two results are the same when their words are.
export const sameSettings = (a, b) => JSON.stringify(differences(a)) === JSON.stringify(differences(b));
// The one plain sentence under the test's table.
export const resultSentence = (b, inForce) => { const d = differences(b);
  if (!d.length) return 'The standard settings are already the best for this phone.';
  if (inForce?.fromTest && sameSettings(b, inForce)) return `This phone can use: ${d.join(', ')}. These are already in use.`;
  return `This phone can use: ${d.join(', ')}.`; };
// "Back to standard" shows only while tuned settings are in force.
export function graphicsWords() { return graphicsState(tuned()); }
if ($('#gfxReset')) $('#gfxReset').onclick = () => { delete P.settings.tuned; save(); applyGraphics(); showSpeed(); };
// (called as the menu opens: the controls show what is set)
export function showSpeed() {
  const w = graphicsWords();
  if ($('#gfxNow')) $('#gfxNow').textContent = w.text;
  if ($('#gfxFacts')) $('#gfxFacts').textContent = w.facts;
  if ($('#gfxResetRow')) $('#gfxResetRow').style.display = w.set ? '' : 'none';
  if ($('#recChk')) $('#recChk').checked = !!P.settings.recordSpeed;
  if (box) { box.hidden = true; $('#recCopy').hidden = true; $('#recCopy').textContent = 'Copy'; }
}
// The game's own layer is painted once, unseen, before it is first needed (css: #hud.warm).
function warmHud() { const hud = $('#hud'); if (!hud || !hud.classList.contains('hidden')) return; hud.classList.add('warm'); const off = () => hud.classList.remove('warm'); setTimeout(off, 250); addEventListener('pointerdown', off, { once: true, capture: true }); }
setTimeout(warmHud, 600);

// (round 13) The sunburst behind "GOAL!", "Stole it!", "SAVED!"… and behind a trophy sticker: a repeating conic gradient
// under a radial mask, which the phone painted the moment the words came in (a freeze of 200 to 300 ms in the phone's
// recordings, just before the burst shows). The same picture is drawn once into an image here, at the screen's sharpness,
// and the CSS uses it in place of the gradient and the mask (html.burst). If any step fails, the gradient stays.
function burst(css, size, color, on, period, inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); if (!g) return Promise.resolve(false);
  const m = size / 2, R = Math.SQRT1_2 * size, rad = d => (d - 90) * Math.PI / 180; // (CSS: 0deg is up, clockwise; the mask's circle reaches the corners)
  g.fillStyle = color;
  for (let a = 0; a < 360; a += period) { g.beginPath(); g.moveTo(m, m); g.arc(m, m, R, rad(a), rad(Math.min(360, a + on))); g.closePath(); g.fill(); }
  const r = g.createRadialGradient(m, m, 0, m, m, R); r.addColorStop(0, '#000'); r.addColorStop(inner, '#000'); r.addColorStop(outer, 'rgba(0,0,0,0)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in'; g.fillStyle = r; g.fillRect(0, 0, size, size);
  return new Promise(res => { try { c.toBlob(b => { if (!b) return res(false); const url = URL.createObjectURL(b), img = new Image(); img.src = url;
    const done = () => { document.documentElement.style.setProperty(css, `url("${url}")`); c.width = c.height = 0; res(true); };
    (img.decode ? img.decode() : Promise.resolve()).then(done, done); }, 'image/png'); } catch { res(false); } });
}
export function makeBursts() {
  try {
    const dpr = Math.min(3, Math.max(1, devicePixelRatio || 1));
    Promise.all([burst('--burst-goal', Math.round(Math.min(2048, 620 * dpr)), 'rgba(255,236,150,.6)', 8, 22, .18, .66),
      burst('--burst-trophy', Math.round(Math.min(1024, 260 * dpr)), 'rgba(255,216,77,.5)', 9, 24, .2, .68)])
      .then(ok => { if (ok.every(Boolean)) document.documentElement.classList.add('burst'); }, () => {});
  } catch { /* the gradient stays */ }
}
setTimeout(makeBursts, 900);
