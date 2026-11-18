// The speed test (dev/speed.html, round 13). One tap, then the real game plays the same short scene (the look-up demo's
// run-up and play, with a praise word, stars, a burst of confetti and the big "GOAL!" words at fixed times) once for each
// switch below, with no sound, and shows how evenly each one drew: pictures a second, the median frame, the 95th
// percentile and the worst frame. "Use the best settings for this phone" keeps what cost nothing here (js/ui/speed.js).
//
// The child's save is never touched, except by that button, which writes only `settings.tuned`. Before any game module
// loads, the page swaps the browser's localStorage, as the game sees it, for a throwaway copy in memory (as dev/review.js
// does). Sound: the game's audio players are never made (sound.js SILENT), the voice is off in the throwaway save, and the
// one run that measures audio players plays recordings of pure silence on muted players.
const SAVE_KEY = 'soccer-iq:v1', RUN_MS = 4800, SKIP_MS = 600, LESSON = 'look-up';
const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const parse = (t, d) => { try { return JSON.parse(t) ?? d; } catch { return d; } };

// ---------- the real storage, read only (the best-settings button writes one field) ----------
let REAL = null; try { REAL = window.localStorage; } catch { /* blocked */ }
const realGet = k => { try { return REAL ? REAL.getItem(k) : null; } catch { return null; } };
const child = parse(realGet(SAVE_KEY), null);

// ---------- the throwaway save ----------
const map = {};
map[SAVE_KEY] = JSON.stringify({ v: 1, us: child?.us || 'barca', them: child?.them || 'madrid',
  settings: { size: child?.settings?.size || '3v3', graphics: 'smooth', muted: true, sound: false, music: false, voice: false, recorded: false, recordSpeed: false } });
const shim = {
  getItem: k => (k in map ? map[k] : null), setItem: (k, v) => { map[k] = String(v); }, removeItem: k => { delete map[k]; }, clear: () => { for (const k of Object.keys(map)) delete map[k]; },
  key: i => Object.keys(map)[i] ?? null, get length() { return Object.keys(map).length; },
};
let swapped = false;
try { Object.defineProperty(window, 'localStorage', { configurable: true, enumerable: true, get: () => shim }); swapped = window.localStorage === shim; } catch { swapped = false; }

// ---------- what each run changes ----------
// body: classes on <body> (blur: the old head-down blur in Smooth; nofx, nopulse, nosoft and noedge: dev/speed.html's style).
// test: world.setTest (pr, bloom, shadowPass, particles). cap: the 60 cap. strip: the iPad strip's pixel read.
const RUNS = [
  { id: 'base', name: 'Smooth as shipped (px 1.5)' },
  { id: 'blur', name: 'Head-down blur on', body: ['blur'] },
  { id: 'glow', name: 'Glow on', test: { bloom: 1 } },
  { id: 'shadow', name: 'Shadows off', test: { shadowPass: false } },
  { id: 'pr1', name: 'Pixel ratio 1', test: { pr: 1 } },
  { id: 'pr2', name: 'Pixel ratio 2', test: { pr: 2 } },
  { id: 'pr3', name: 'Pixel ratio 3', test: { pr: 3 } },
  { id: 'nofx', name: 'Pop-ups, stars off', body: ['nofx'] },
  { id: 'noparts', name: 'Particles off', test: { particles: false } },
  { id: 'nopulse', name: 'Button glow pulse off', body: ['nopulse'] },
  { id: 'nosoft', name: 'Big words: no soft shadow', body: ['nosoft'] },
  { id: 'nocap', name: '60 cap off', cap: false },
  { id: 'sound', name: 'Sound players (silent)', sound: true },
  { id: 'strip', name: 'iPad strip read on', strip: true },
  { id: 'noedge', name: 'Head-down edge off', body: ['noedge'] },
  { id: 'park', name: 'Training ground (day)', env: 'park' },
  { id: 'pretty', name: 'Pretty (everything)', pretty: true },
  { id: 'base2', name: 'Smooth as shipped, again' },
];

// ---------- silent audio players (made in the Start tap, which is what lets them play) ----------
function silentWav(sec) {
  const n = Math.round(48000 * sec), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf); // the samples stay zero: silence
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 48000, true); v.setUint32(28, 96000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
let quiet = null;
function makeQuiet() {
  try {
    const mk = sec => { const el = new Audio(); el.muted = true; el.volume = 0; el.preload = 'auto'; el.src = silentWav(sec); return el; };
    quiet = { fx: [mk(.25), mk(.25), mk(.3), mk(.2)], voice: mk(1.5) };
    for (const el of [...quiet.fx, quiet.voice]) { const p = el.play(); if (p && p.then) p.then(() => el.pause(), () => {}); }
  } catch { quiet = null; }
}

// ---------- boot ----------
let G = null;
$('#stBack').onclick = $('#stHome').onclick = () => { location.href = 'index.html'; };
$('#stAgain').onclick = () => location.reload();
$('#stGo').onclick = () => {
  $('#stGo').disabled = true; makeQuiet();
  start().catch(e => fail(e));
};
function fail(e) { console.error(e); $('#st').className = ''; $('#stIntro').hidden = false; $('#stNow').hidden = true; $('#stErr').textContent = 'The test stopped: ' + (e?.message || e); }

async function boot() {
  if (!swapped) throw new Error('This browser would not let the page use a throwaway save, so the game was not started (his save stays safe).');
  const html = await (await fetch('index.html', { cache: 'no-cache' })).text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const n of [...doc.body.childNodes]) if (n.nodeName !== 'SCRIPT') document.body.appendChild(document.adoptNode(n));
  const sound = await import('../js/sound.js'); sound.SILENT.on = true; // before anything can unlock a player
  const [main, stage, hudM, screens, speed, skills, teams, version, geom] = await Promise.all(['../js/main.js', '../js/ui/stage.js', '../js/ui/hud.js', '../js/ui/screens.js',
    '../js/ui/speed.js', '../js/skills.js', '../js/teams.js', '../js/version.js', '../js/geom.js'].map(p => import(p)));
  G = { main, ...stage, ...hudM, ...screens, ...speed, ...skills, ...teams, ...version, TEAM: geom.TEAM, sound };
  const { world, game, show, teamById } = G;
  for (let i = 0; i < 60 && !world.post; i++) await sleep(50); // (the post passes load on their own)
  world.pacer.done = true; // the slow-device governor stays out of the test
  const P = JSON.parse(map[SAVE_KEY]);
  game.setTeams(teamById(P.us) || teamById('barca'), teamById(P.them) || teamById('madrid'));
  world.setEnv('crowd'); show(null); G.hud.hideScore(); G.hud.dots([], 0);
}

// ---------- one run ----------
let epoch = 0;
function stopAll() {
  const { game, hud } = G, q = s => document.querySelector(s), tryit = f => { try { f(); } catch { /* the game moved on */ } };
  tryit(() => { game.tweens.length = 0; game.speechWaits.length = 0; });
  tryit(() => { game.sim.co = null; game._playRes = null; game._choose = null; });
  tryit(() => { game.closeWindow?.(); game.win = null; });
  tryit(() => { if (game.sk) game.skillEnd(); game.sk = null; });
  Object.assign(game, { slow: 1, slowV: 0, skCam: 0, prate: 1, skipping: false, showing: false, card: null, rated: null });
  tryit(() => hud.banner('', 'soft', null));
  for (const s of ['#hud']) q(s)?.classList.remove('rating');
  q('#banner')?.classList.remove('show', 'up'); q('#rate')?.classList.remove('show');
  for (const s of ['#toast', '#pop', '#seenNote', '#skillName', '#skillTag']) q(s)?.classList.remove('show');
  q('#confetti')?.remove();
  tryit(() => { hud.caption(''); hud.skill(null); hud.hand(null); });
}
async function scene(my) {
  const { game, demoScenario } = G;
  game.mode = 'demo'; game.load(demoScenario(LESSON));
  await game.pre(); if (my !== epoch) return;
  game.phase = 'decide'; game.step = null; game.showing = true; game.openWindow();
  await game.showPlay(game.sc.best);
}
function setRun(r, on) {
  const { world, TEST, applyGraphics } = G, b = document.body.classList;
  for (const c of r.body || []) b.toggle(c, on);
  TEST.cap = on && r.cap === false ? false : true; TEST.strip = on && r.strip ? true : null;
  if (r.test) world.setTest(on ? r.test : null);
  if (r.env) world.setEnv(on ? r.env : 'crowd');
  if (r.pretty) { if (on) { b.remove('smooth', 'blur'); world.setGraphics('pretty'); } else applyGraphics(); }
}
function playQuiet(t0, stop) { // the "sound" run: a silent effect every 0.4 s and a new silent line every 2 s, as the game starts its players
  if (!quiet) return;
  let k = 0; const fxT = setInterval(() => { const el = quiet.fx[k++ % quiet.fx.length]; try { if (!el.ended && el.currentTime > 0) el.currentTime = 0; el.play().catch(() => {}); } catch { /* fine */ } }, 400);
  const line = () => { try { quiet.voice.src = silentWav(1.2 + Math.random() * .6); quiet.voice.play().catch(() => {}); } catch { /* fine */ } };
  line(); const lineT = setInterval(line, 2000);
  stop.push(() => { clearInterval(fxT); clearInterval(lineT); try { quiet.voice.pause(); quiet.fx.forEach(el => el.pause()); } catch { /* fine */ } });
}
async function run(r) {
  const { world, hud, TEST } = G, my = ++epoch, times = [], stop = [];
  stopAll(); setRun(r, true);
  const t0 = performance.now();
  TEST.onFrame = t => { if (t - t0 >= SKIP_MS) times.push(t); };
  scene(my).catch(e => console.warn('scene', e));
  const at = (ms, f) => { const id = setTimeout(() => { if (my === epoch) { try { f(); } catch (e) { console.warn(e); } } }, ms); stop.push(() => clearTimeout(id)); };
  at(1000, () => hud.toast('Good defending!'));
  at(2000, () => hud.pop(3, null));
  at(3000, () => { const b = world.sim?.ball || { x: 20, y: 12 }; world.particles.confetti(b.x, b.y, .4, ['#ffd23f', '#ffffff', '#5aa2ff'], 70); hud.banner('GOAL!', 'goal', { stars: 3, text: 'Great run! You looked up first.' }); });
  at(4200, () => world.particles.sparks(world.sim?.ball?.x || 20, world.sim?.ball?.y || 12, .3, 18));
  if (r.sound) playQuiet(t0, stop);
  await sleep(RUN_MS);
  TEST.onFrame = null; stop.forEach(f => f()); epoch++;
  setRun(r, false); stopAll();
  return stats(times);
}
function stats(t) {
  const d = []; for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
  if (!d.length) return { fps: 0, med: 0, p95: 0, max: 0, over: 0, n: 0 };
  const s = [...d].sort((a, b) => a - b), q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { fps: d.length / ((t[t.length - 1] - t[0]) / 1000), med: q(.5), p95: q(.95), max: s[s.length - 1], over: d.filter(x => x > 50).length, n: d.length };
}

// ---------- the whole test ----------
async function start() {
  $('#stIntro').hidden = true; $('#st').className = 'running'; const now = $('#stNow'); now.hidden = false; now.textContent = 'Loading the game…';
  await boot();
  await sleep(1500); // first pictures, shaders, the voice list
  const res = [];
  for (let i = 0; i < RUNS.length; i++) {
    now.textContent = `Speed test ${i + 1} of ${RUNS.length}: ${RUNS[i].name}. Don't touch the screen.`;
    let s; try { s = await run(RUNS[i]); } catch (e) { console.error(e); s = { fps: 0, med: 0, p95: 0, max: 0, over: 0, n: 0, err: String(e?.message || e) }; }
    res.push({ ...RUNS[i], ...s });
  }
  now.hidden = true; G.show('#home'); showResults(res);
}

// What cost nothing here: as good as the worse of the two base runs, give or take the noise between runs.
function bestOf(res) {
  const by = id => res.find(r => r.id === id), b1 = by('base'), b2 = by('base2');
  const ref = !b1?.n ? b2 : !b2?.n ? b1 : (b1.p95 >= b2.p95 ? b1 : b2);
  const free = r => !!(r && r.n && ref?.n && r.fps >= ref.fps - 2 && r.p95 <= ref.p95 * 1.2 + 2 && r.over <= ref.over + 1);
  const pr = free(by('pr3')) && free(by('pr2')) ? 3 : free(by('pr2')) ? 2 : 0;
  return { blur: free(by('blur')), glow: free(by('glow')), pr, free };
}
let best = null, report = '';
function showResults(res) {
  const f = (v, d = 0) => (v ? v.toFixed(d) : '-');
  const b = best = bestOf(res);
  const head = ['Run', 'pics/s', 'median', '95%', 'worst', '>50ms'];
  $('#stTable').innerHTML = `<tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>` + res.map(r => {
    const cls = r.id.startsWith('base') ? '' : b.free(r) ? 'good' : 'bad';
    return `<tr class="${cls}"><td>${r.name}</td><td>${f(r.fps)}</td><td>${f(r.med, 1)}</td><td>${f(r.p95, 1)}</td><td>${f(r.max)}</td><td>${r.n ? r.over : '-'}</td></tr>`;
  }).join('');
  const c = G.world.renderer.domElement, words = `head-down blur ${b.blur ? 'on' : 'off'}, glow ${b.glow ? 'on' : 'off'}, pixel ratio ${b.pr || 1.5}`;
  $('#stMsg').textContent = `Green: cost nothing here. Best: ${words}.`;
  report = [
    `Heads Up! Soccer speed test · ${G.VERSION || ''} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    navigator.userAgent,
    `screen ${screen.width}x${screen.height} dpr ${devicePixelRatio} · canvas ${c.width}x${c.height} · home-screen app ${navigator.standalone ? 'yes' : 'no'} · size ${G.TEAM?.size || JSON.parse(map[SAVE_KEY]).settings.size}`,
    `run | pics/s | median ms | 95% ms | worst ms | frames over 50 ms`,
    ...res.map(r => `${r.name} | ${f(r.fps)} | ${f(r.med, 1)} | ${f(r.p95, 1)} | ${f(r.max)} | ${r.n ? r.over : '-'}${r.err ? ' | error ' + r.err : ''}`),
    `best for this phone: ${words}`,
  ].join('\n');
  $('#stText').value = report;
  $('#st').className = ''; $('#stOut').hidden = false;
}
$('#stCopy').onclick = async () => {
  const box = $('#stText'); box.focus(); box.select();
  try { await navigator.clipboard.writeText(report); $('#stCopy').textContent = 'Copied'; }
  catch { try { document.execCommand('copy'); $('#stCopy').textContent = 'Copied'; } catch { $('#stCopy').textContent = 'Select the text and copy it'; } }
};
// Writes only `settings.tuned` into his real save (the rest of it is left as it is).
$('#stBest').onclick = () => {
  if (!best) return;
  try {
    const s = parse(realGet(SAVE_KEY), null);
    if (!s || typeof s !== 'object') throw new Error('no save yet: play once first');
    s.settings = s.settings || {};
    s.settings.tuned = { blur: best.blur, glow: best.glow, pr: best.pr || 0, at: new Date().toISOString().slice(0, 10), v: G.VERSION || '' };
    REAL.setItem(SAVE_KEY, JSON.stringify(s));
    $('#stMsg').textContent = `Saved for this phone: head-down blur ${best.blur ? 'on' : 'off'}, glow ${best.glow ? 'on' : 'off'}, pixel ratio ${best.pr || 1.5}. They apply with Graphics on Smooth.`;
    $('#stBest').disabled = true;
  } catch (e) { $('#stMsg').textContent = 'Could not save: ' + (e?.message || e); }
};
