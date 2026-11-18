// The grown-ups' "Speed" settings (round 11): Graphics (Smooth, the default on phones, or Pretty) and "Record speed"
// (the frame recorder, js/perf.js) with its report to copy.
import { $ } from './dom.js';
import { P, save } from './store.js';
import { world } from './stage.js';
import * as perf from '../perf.js';

const phone = () => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } };
export const graphics = () => (P.settings.graphics === 'pretty' || P.settings.graphics === 'smooth' ? P.settings.graphics : phone() ? 'smooth' : 'pretty');
export const smooth = () => mode === 'smooth';
let mode = 'pretty';
// Smooth: no glow pass, a smaller shadow map (world.js), no blur over the moving picture and none behind cards
// (css: body.smooth), 60 pictures a second at most and fewer on the screens where nothing is played (main.js).
export function applyGraphics() { mode = graphics(); document.body.classList.toggle('smooth', mode === 'smooth'); world.setGraphics(mode); }
export function applyRecord() { if (P.settings.recordSpeed) perf.start(world.renderer); else perf.stop(); }
applyGraphics(); applyRecord();

const box = $('#recBox');
const showRecord = () => { if (!box) return; box.value = perf.rec.on ? perf.report() : 'Turn "Record speed" on, play for a few minutes, then come back here.'; box.hidden = false; $('#recCopy').hidden = false; };
if ($('#gfxSel')) {
  $('#gfxSel').onchange = () => { P.settings.graphics = $('#gfxSel').value; save(); applyGraphics(); };
  $('#recChk').onchange = () => { P.settings.recordSpeed = $('#recChk').checked; save(); applyRecord(); };
  $('#recShow').onclick = showRecord;
  $('#recCopy').onclick = async () => { box.focus(); box.select(); try { await navigator.clipboard.writeText(box.value); $('#recCopy').textContent = 'Copied'; } catch { try { document.execCommand('copy'); $('#recCopy').textContent = 'Copied'; } catch { $('#recCopy').textContent = 'Select the text and copy it'; } } };
}
// (called as the menu opens: the controls show what is set)
export function showSpeed() { if (!$('#gfxSel')) return; $('#gfxSel').value = graphics(); $('#recChk').checked = !!P.settings.recordSpeed; if (box) { box.hidden = true; $('#recCopy').hidden = true; $('#recCopy').textContent = 'Copy'; } }
