// "Record speed" (the grown-ups menu, and always on in dev/review.html): a frame recorder for the real phone.
// It keeps every frame longer than 25 ms with what the game was doing and what happened in the 0.3 s before it (a tap,
// a choice opening or closing, buttons shown or hidden, a sound or voice clip, a shader compiled, something made for
// the 3D picture), how long each part of the frame's work took, and totals. `report()` is plain text to copy.
// Off, it costs one check per call. Nothing here touches the game.
const SLOW = 25, KEEP = 400, now = () => performance.now();
export const rec = { on: false };
let limit = SLOW, frames = 0, over = [0, 0, 0], total = 0, t0 = 0, last = 0, marks = [], slow = [], sect = {}, gaps = [], longs = 0, info = null, seen = {}, obs = null, counts = {};

// Something happened (kept 0.3 s, shown with the slow frames after it). Counted by its first word too.
export function mark(label) { if (!rec.on) return; marks.push([now(), label]); const k = label.split(' ')[0]; counts[k] = (counts[k] || 0) + 1; }
// Times one part of the frame's work: const end = time('sim'); ...; end();
const NOP = () => {};
export function time(name) { if (!rec.on) return NOP; const a = now(); return () => { sect[name] = (sect[name] || 0) + now() - a; }; }

export function start(renderer) {
  if (rec.on) return; rec.on = true; limit = SLOW; frames = 0; over = [0, 0, 0]; total = 0; t0 = last = now(); marks = []; slow = []; sect = {}; gaps = []; longs = 0; seen = {}; counts = {};
  const c = renderer?.domElement;
  info = { ua: navigator.userAgent, dpr: devicePixelRatio, screen: `${screen.width}x${screen.height}`, canvas: c ? `${c.width}x${c.height} px (${c.clientWidth}x${c.clientHeight} css)` : '-', pr: renderer?.getPixelRatio?.() };
  if (!obs) {
    addEventListener('pointerdown', e => mark('tap ' + (e.target?.id || e.target?.tagName || '')), true);
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) { longs++; mark('longtask ' + Math.round(e.duration) + 'ms'); } }).observe({ entryTypes: ['longtask'] }); } catch { /* Safari has none */ }
    const hud = document.querySelector('#hud') || document.body;
    obs = new MutationObserver(l => { let n = 0, cls = new Set(); for (const m of l) { if (m.type === 'childList') n += m.addedNodes.length + m.removedNodes.length; else if (m.target.id) cls.add(m.target.id); } if (n) mark('html nodes ' + n); if (cls.size) mark('html show/hide ' + [...cls].slice(0, 4).join(',')); });
    obs.observe(hud, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  }
}
export function stop() { rec.on = false; }

// Once a frame, from the frame loop: `g` the game (phase, mode, window), `r` the renderer (what was drawn and made).
export function frame(t, g, r) {
  if (!rec.on) return;
  const ms = t - last; last = t; frames++; total += ms;
  if (gaps.length < 600) gaps.push(ms);
  // (a screen held at 30 a second, a phone in Low Power Mode: a frame is slow when it is well over the usual one)
  if (gaps.length === 90) { const g = [...gaps].sort((a, b) => a - b); limit = Math.max(SLOW, g[45] * 1.4); }
  // what changed since the last frame
  const st = { phase: g?.phase, step: g?.step || '', win: g?.win ? 'open' : 'closed', mode: g?.mode, sk: g?.sk ? g.sk.kind + ':' + g.sk.phase : '', result: g?.result || '' };
  for (const k in st) if (seen[k] !== undefined && seen[k] !== st[k]) mark(`${k} ${seen[k] || '-'}>${st[k] || '-'}`);
  seen = st;
  const ri = r?.info, made = { programs: ri?.programs?.length ?? 0, geometries: ri?.memory?.geometries ?? 0, textures: ri?.memory?.textures ?? 0 };
  if (seen.made) { if (made.programs > seen.made.programs) mark(`shader compiled +${made.programs - seen.made.programs}`); if (made.geometries > seen.made.geometries) mark(`mesh made +${made.geometries - seen.made.geometries}`); if (made.textures > seen.made.textures) mark(`texture made +${made.textures - seen.made.textures}`); }
  seen.made = made;
  if (ms > limit && frames > 3) {
    if (ms > 25) over[0]++; if (ms > 50) over[1]++; if (ms > 100) over[2]++;
    const before = marks.filter(m => m[0] > t - ms - 300).map(m => m[1]);
    const parts = Object.entries(sect).filter(e => e[1] >= 1).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' ');
    if (slow.length < KEEP) slow.push({ at: (t - t0) / 1000, ms, mode: st.mode, phase: st.phase, parts, before, calls: ri?.render?.calls, tris: ri?.render?.triangles });
  }
  sect = {}; while (marks.length && marks[0][0] < t - 1500) marks.shift();
}

export function report() {
  const pc = n => (frames ? (100 * n / frames).toFixed(1) : '0') + '%', g = [...gaps].sort((a, b) => a - b), med = g.length ? g[g.length >> 1] : 0;
  const line = s => `${s.at.toFixed(1)}s ${s.ms.toFixed(0)}ms ${s.mode || ''}/${s.phase || ''}${s.parts ? ' [' + s.parts + ']' : ''}${s.calls != null ? ` draw ${s.calls} tri ${s.tris}` : ''}${s.before.length ? ' <- ' + [...new Set(s.before)].join('; ') : ''}`;
  const worst = [...slow].sort((a, b) => b.ms - a.ms).slice(0, 10);
  return [
    `Heads Up! Soccer speed record`,
    `${info?.ua}`,
    `screen ${info?.screen} dpr ${info?.dpr}; canvas ${info?.canvas}; pixel ratio used ${info?.pr}`,
    `frames ${frames} in ${(total / 1000).toFixed(0)} s; usual frame ${med.toFixed(1)} ms (${med ? (1000 / med).toFixed(0) : '-'} a second)`,
    `over 25 ms: ${over[0]} (${pc(over[0])}); over 50: ${over[1]} (${pc(over[1])}); over 100: ${over[2]} (${pc(over[2])}); long tasks: ${longs}`,
    `happened: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`,
    `-- ten worst --`, ...worst.map(line),
    `-- all slow frames (over ${limit.toFixed(0)} ms), in order (first ${KEEP}) --`, ...slow.map(line),
  ].join('\n');
}
