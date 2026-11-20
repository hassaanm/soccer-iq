// "Record speed" (the grown-ups menu, and always on in dev/review.html): a frame recorder for the real phone.
// It keeps every frame longer than 25 ms with what the game was doing and what happened in the 0.3 s before it (a tap,
// a choice opening or closing, buttons shown or hidden, a sound or voice clip, a shader compiled, something made for
// the 3D picture), how long each part of the frame's work took, and totals. `report()` is plain text to copy.
// Off, it costs one check per call. Nothing here touches the game.
// (v93) What each slow frame's time went on, in four parts that add up to it: `game` and `draw` (the frame loop's own
// work, timed in main.js), `page` (the page's own work right after it: the HTML layer's style, layout and painting, and
// the timers and taps waiting), `wait` (the rest: other timers, and waiting for the graphics chip or the screen). The
// parts are those of the frame the gap came after (v76 to v92 showed the next frame's, which ran after the gap). The
// usual frame is told for each mode (home is held at 30 a second, play at 60), a mini game by its own name, a tap by the
// id of what it hit, and the canvas size as it is when the report is made.
const SLOW = 25, KEEP = 400, now = () => performance.now();
export const rec = { on: false };
// (v76) The play log (js/ui/playlog.js) sees every mark and every frame through these, while it records.
export const hooks = { mark: null, frame: null };
let limit = SLOW, frames = 0, over = [0, 0, 0], total = 0, t0 = 0, last = 0, marks = [], slow = [], sect = {}, longs = 0, info = null, seen = {}, obs = null, counts = {}, renderer = null;
let gaps = {}, limits = {}, prev = null, loopEnd = 0, pageEnd = 0, canvasMax = '', mini = null;

// Something happened (kept 0.3 s, shown with the slow frames after it). Counted by its first word too.
export function mark(label) { if (!rec.on) return; marks.push([now(), label]); const k = label.split(' ')[0]; counts[k] = (counts[k] || 0) + 1; hooks.mark?.(label); }
// Times one part of the frame's work: const end = time('sim'); ...; end();
const NOP = () => {};
export function time(name) { if (!rec.on) return NOP; const a = now(); return () => { sect[name] = (sect[name] || 0) + now() - a; }; }

// (v93) The page's own work after a frame: a message posted at the end of the frame loop arrives once the page has done
// what it does right after (its HTML layer drawn, the tasks queued before it).
const ping = typeof MessageChannel === 'function' ? new MessageChannel() : null;
if (ping) ping.port1.onmessage = () => { pageEnd = now(); };
// What a tap hit: its own id, or the nearest one round it ("tap keeperBtn", not "tap I"); a mini game's tile by its game.
const what = el => { const tile = el?.closest?.('#minis [data-id]'); if (tile) return 'tile:' + tile.dataset.id; return el?.id || el?.closest?.('[id]')?.id || el?.tagName || ''; };
const named = el => el.id || (typeof el.className === 'string' && el.className.split(' ')[0]) || el.tagName?.toLowerCase() || '?';

export function start(r) {
  if (rec.on) return; rec.on = true; limit = SLOW; frames = 0; over = [0, 0, 0]; total = 0; t0 = last = now(); marks = []; slow = []; sect = {}; gaps = {}; limits = {}; prev = null; longs = 0; seen = {}; counts = {}; canvasMax = '';
  renderer = r || null; if (renderer?.info) renderer.info.autoReset = false; // (all the passes of a frame are counted: v92 showed only the last, "draw 1 tri 1")
  info = { ua: navigator.userAgent, dpr: devicePixelRatio, screen: `${screen.width}x${screen.height}` };
  if (!obs) {
    addEventListener('pointerdown', e => { const w = what(e.target); if (w.startsWith('tile:')) mini = w.slice(5); else if (/^(playBtn|freeBtn|cupBtn)$/.test(w)) mini = null; mark('tap ' + w); }, true);
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) { longs++; mark('longtask ' + Math.round(e.duration) + 'ms'); } }).observe({ entryTypes: ['longtask'] }); } catch { /* Safari has none */ }
    // (v93) The whole page, not only the game's layer: a mini game's own buttons sit outside it. Nodes are told with
    // where they were made or dropped.
    obs = new MutationObserver(l => {
      let n = 0; const where = new Set(), cls = new Set();
      for (const m of l) { if (m.type === 'childList') { const k = m.addedNodes.length + m.removedNodes.length; if (k) { n += k; where.add(named(m.target)); } } else if (m.target.id) cls.add(m.target.id); }
      if (n) mark(`html nodes ${n} (${[...where].slice(0, 3).join(',')})`); if (cls.size) mark('html show/hide ' + [...cls].slice(0, 5).join(','));
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  }
}
export function stop() { rec.on = false; if (renderer?.info) renderer.info.autoReset = true; }
// (v79) A frame of the loop while the game is paused: not counted, and the next counted frame is timed from here (so the
// pause is neither a slow frame nor part of the totals).
export function idle(t) { if (rec.on) { last = t; prev = null; } }

const median = a => { const g = [...a].sort((x, y) => x - y); return g.length ? g[g.length >> 1] : 0; };
// Once a frame, from the frame loop: `g` the game (phase, mode, window), `r` the renderer (what was drawn and made).
export function frame(t, g, r) {
  if (!rec.on) return;
  const ms = t - last; last = t; frames++; total += ms;
  // what changed since the last frame
  const mode = g?.mode === 'keeper' && mini ? mini : g?.mode; // (a mini game by its name: its tile, js/mini/chooser.js)
  const st = { phase: g?.phase, step: g?.step || '', win: g?.win ? 'open' : 'closed', mode, sk: g?.sk ? g.sk.kind + ':' + g.sk.phase : '', result: g?.result || '' };
  for (const k in st) if (seen[k] !== undefined && seen[k] !== st[k]) mark(`${k} ${seen[k] || '-'}>${st[k] || '-'}`);
  // (a screen held at 30 a second, a phone in Low Power Mode: a frame is slow when it is well over the usual one there)
  const gm = (gaps[st.mode] ||= []); gm.push(ms); if (gm.length > 1200) gm.splice(0, 600);
  if (gm.length === 90 || gm.length % 600 === 0) limits[st.mode] = Math.max(SLOW, median(gm) * 1.4);
  limit = limits[st.mode] || SLOW;
  const made0 = seen.made; seen = st;
  const ri = (r || renderer)?.info, made = { programs: ri?.programs?.length ?? 0, geometries: ri?.memory?.geometries ?? 0, textures: ri?.memory?.textures ?? 0 };
  if (made0) { if (made.programs > made0.programs) mark(`shader compiled +${made.programs - made0.programs}`); if (made.geometries > made0.geometries) mark(`mesh made +${made.geometries - made0.geometries}`); if (made.textures > made0.textures) mark(`texture made +${made.textures - made0.textures}`); }
  seen.made = made;
  const c = (r || renderer)?.domElement; if (c && c.width * c.height > (+canvasMax.split('x')[0] || 0) * (+canvasMax.split('x')[1] || 0)) canvasMax = `${c.width}x${c.height}`;
  // the parts of this gap: the last frame's loop, the page after it, and the rest
  const page = pageEnd > loopEnd ? pageEnd - loopEnd : 0, wait = Math.max(0, t - (pageEnd > loopEnd ? pageEnd : loopEnd)), p = prev ? { ...prev.sect, page, wait } : null;
  if (prev && ms > limit && frames > 3) {
    if (ms > 25) over[0]++; if (ms > 50) over[1]++; if (ms > 100) over[2]++;
    const before = marks.filter(m => m[0] > t - ms - 300).map(m => m[1]);
    const parts = Object.entries(p).filter(e => e[1] >= 1).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' ');
    if (slow.length < KEEP) slow.push({ at: (t - t0) / 1000, ms, mode: prev.mode, phase: prev.phase, parts, before, calls: prev.calls, tris: prev.tris });
  }
  prev = { sect, mode: st.mode, phase: st.phase, calls: ri?.render?.calls, tris: ri?.render?.triangles };
  if (ri && ri.autoReset === false) ri.reset();
  sect = {}; while (marks.length && marks[0][0] < t - 1500) marks.shift();
  hooks.frame?.(t, ms, p); // (p: this gap's parts, for the browser checks: scripts/pop-audit.js)
  loopEnd = now(); ping?.port2.postMessage(0);
}

// (v76) The speed record in short, for the play log: the totals and the six worst frames (each line cut to 220 letters).
export function summary() {
  if (!frames) return ['no frames recorded yet'];
  const r = report().split('\n'), i = r.indexOf('-- ten worst --');
  return [...r.slice(2, 6), ...r.slice(i + 1, i + 7)].map(l => (l.length > 220 ? l.slice(0, 217) + '...' : l));
}
// (v93) Many of one kind in a frame's "before" are told once, with how many: "voice-fetch x47 (saved, good try, ...)".
function told(list) {
  const by = new Map();
  for (const l of list) { const k = /^(voice-fetch|voice-decoded|html nodes|html show\/hide) /.exec(l)?.[1] || l; if (!by.has(k)) by.set(k, []); if (k !== l) by.get(k).push(l.slice(k.length + 1)); }
  return [...by].map(([k, v]) => (v.length > 1 && k.startsWith('voice') ? `${k} x${v.length} (${[...new Set(v)].slice(0, 3).join(', ')}...)` : v.length ? `${k} ${[...new Set(v)].slice(0, 4).join('; ')}` : k)).join('; ');
}
export function report() {
  const pc = n => (frames ? (100 * n / frames).toFixed(1) : '0') + '%';
  const usual = Object.entries(gaps).filter(([, g]) => g.length >= 30).sort((a, b) => b[1].length - a[1].length).map(([m, g]) => { const md = median(g); return `${md.toFixed(1)} ms (${md ? (1000 / md).toFixed(0) : '-'} a second) in ${m || '-'}`; });
  const line = s => `${s.at.toFixed(1)}s ${s.ms.toFixed(0)}ms ${s.mode || ''}/${s.phase || ''}${s.parts ? ' [' + s.parts + ']' : ''}${s.calls != null ? ` draw ${s.calls} tri ${s.tris}` : ''}${s.before.length ? ' <- ' + told(s.before) : ''}`;
  const worst = [...slow].sort((a, b) => b.ms - a.ms).slice(0, 10), c = renderer?.domElement;
  return [
    `Heads Up! Soccer speed record`,
    `${info?.ua}`,
    `screen ${info?.screen} dpr ${info?.dpr}; canvas ${c ? `${c.width}x${c.height} px (${c.clientWidth}x${c.clientHeight} css)` : '-'}, largest ${canvasMax || '-'}; pixel ratio used ${renderer?.getPixelRatio?.()}`,
    `frames ${frames} in ${(total / 1000).toFixed(0)} s; usual frame ${usual.join('; ') || '-'}`,
    `over 25 ms: ${over[0]} (${pc(over[0])}); over 50: ${over[1]} (${pc(over[1])}); over 100: ${over[2]} (${pc(over[2])}); long tasks: ${longs}`,
    `happened: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`,
    `-- ten worst --`, ...worst.map(line),
    `-- all slow frames (over the usual frame x1.4, at least ${SLOW} ms), in order (first ${KEEP}) --`, ...slow.map(line),
  ].join('\n');
}
