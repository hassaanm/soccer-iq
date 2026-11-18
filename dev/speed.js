// The speed test (dev/speed.html; version 2, round 14). One tap, then the real game plays the look-up demo's run-up and
// play again and again, with the same events every 2 s (the big words with stars, a praise word, the match stars,
// buttons changing, the pointing hand; ball touches, kicks and clicks in the runs heard), once for each run below, and
// shows how evenly each one drew: pictures a second, the 95th percentile, the worst frame, frames over 34 and 50 ms, and
// how many events were followed by a slow frame. The standard runs three times to show the noise.
//
// The child's save is never touched, except by the settings buttons, which write only `settings.tuned`. Before any game
// module loads, the page sets globalThis.SOCCER_THROWAWAY: the game then reads and writes its save in that in-memory copy
// (js/storage.js). Replacing window.localStorage as well is only a second guard; if Safari refuses it, the test still runs.
// Sound: the game's audio players are never made (sound.js SILENT) and every sound setting is off in the throwaway save.
// Only with "Include the runs with sound" ticked (the page says they are heard) does the Start tap unlock the game's own
// players, and only the four runs that compare ways of starting a sound unmute them.
const SAVE_KEY = 'soccer-iq:v1', SKIP_MS = 600, LESSON = 'look-up';
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
globalThis.SOCCER_THROWAWAY = { map }; // (read by js/storage.js as the game loads)
try { Object.defineProperty(window, 'localStorage', { configurable: true, enumerable: true, get: () => shim }); } catch { /* the flag above is the guard */ }

// ---------- what each run changes (version 2, round 14) ----------
// Fewer runs than version 1, each longer (8 s; 7 s for those heard) and full of the same repeated events (the big words
// with stars, a praise word, the match stars, buttons changing, the pointing hand; ball touches, kicks and clicks in the
// runs heard), so small differences show. The standard runs three times, spread through the test, to show the noise.
// off: classes taken off <body> (blur, softwords: the standard look; js/ui/speed.js puts them back). body: classes put on
// (nofx: dev/speed.html's style). test: world.setTest. sfx: how effects start (js/sound.js SFX_START), heard.
// rebuild: the pop-ups' nodes are made again at each event, as v76 did. pretty: the old full picture, for comparison.
const RUNS = [
  { id: 'base', name: 'Standard', base: true },
  { id: 'one', name: 'Sounds: one player (v76)', sfx: 'one' },
  { id: 'pool', name: 'Sounds: two players', sfx: 'pool' },
  { id: 'plain', name: 'No blur, glow, soft shadow', off: ['blur', 'softwords'], test: { bloom: 0 } },
  { id: 'rebuild', name: 'Pop-ups built as in v76', rebuild: true },
  { id: 'base2', name: 'Standard, again', base: true },
  { id: 'later', name: 'Sounds: after the frame', sfx: 'later' },
  { id: 'poollater', name: 'Sounds: two players, later', sfx: 'pool+later' },
  { id: 'nofx', name: 'Pop-ups, stars off', body: ['nofx'] },
  { id: 'pr2', name: 'Pixel ratio 2', test: { pr: 2 } },
  { id: 'pretty', name: 'Full picture (old Pretty)', pretty: true },
  { id: 'base3', name: 'Standard, third time', base: true },
];
const RUN_MS = 8000, HEARD_MS = 7000, CYCLE = 2000, SLOW = 34, AFTER = 250; // a slow frame: over 34 ms (two refreshes missed)

// ---------- boot ----------
let G = null;
$('#stBack').onclick = $('#stHome').onclick = () => { location.href = 'index.html'; };
$('#stAgain').onclick = () => location.reload();
// The game loads behind the start screen, so the Start tap can unlock its sound players (the phone allows that only in a tap).
let withSound = false;
const booted = boot().then(() => { $('#stGo').disabled = false; $('#stGo').textContent = 'Start'; }, e => fail(e));
$('#stGo').onclick = () => {
  if (!G) return;
  $('#stGo').disabled = true;
  withSound = !!$('#stSound')?.checked;
  if (withSound) { try { G.sound.SILENT.on = false; G.sound.unlock(); G.sound.setMuted(true); } catch { withSound = false; } } // (unlocked, still muted)
  booted.then(start).catch(e => fail(e));
};
function fail(e) { console.error(e); $('#st').className = ''; $('#stIntro').hidden = false; $('#stNow').hidden = true; $('#stErr').textContent = 'The test stopped: ' + (e?.message || e); }

async function boot() {
  const html = await (await fetch('index.html', { cache: 'no-cache' })).text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const n of [...doc.body.childNodes]) if (n.nodeName !== 'SCRIPT') document.body.appendChild(document.adoptNode(n));
  const st = await import('../js/storage.js');
  if (!st.throwaway) throw new Error('The game did not take the throwaway save, so it was not started (his save stays safe).');
  const sound = await import('../js/sound.js'); sound.SILENT.on = true; // before anything can unlock a player
  const [main, stage, hudM, screens, speed, skills, teams, version, geom, store, speech, voice] = await Promise.all(['../js/main.js', '../js/ui/stage.js', '../js/ui/hud.js', '../js/ui/screens.js',
    '../js/ui/speed.js', '../js/skills.js', '../js/teams.js', '../js/version.js', '../js/geom.js', '../js/ui/store.js', '../js/ui/speech.js', '../js/voice.js'].map(p => import(p)));
  G = { main, ...stage, ...hudM, ...screens, ...speed, ...skills, ...teams, ...version, TEAM: geom.TEAM, sound, P: store.P, say: speech.say, hush: speech.hush, pieces: voice.pieces, clipKey: voice.clipKey };
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
  if (r.off) { if (on) for (const c of r.off) b.remove(c); else applyGraphics(); }
  TEST.cap = true; TEST.strip = null;
  if (r.test) world.setTest(on ? r.test : null);
  if (r.pretty) { if (on) { b.remove('smooth', 'blur', 'softwords'); world.setGraphics('pretty'); } else applyGraphics(); }
  if (r.sfx && withSound) { // the game's own players, heard; muted again (everything paused) as the run ends
    const { sound, P } = G; P.settings.muted = !on; // (P: the throwaway save's, in memory)
    if (on) { sound.SFX_START.mode = r.sfx; sound.setSoundOn(true); sound.setMusicOn(child?.settings?.music !== false); sound.setMuted(false); }
    else { G.hush(); sound.setMuted(true); applyGraphics(); } // (applyGraphics puts back the sound mode in force)
  }
}
// The events of one cycle (every 2 s), at their offsets in ms. Sounds only play in the runs heard (muted otherwise).
function cycle(r, at, t0, events) {
  const { world, hud, sound } = G, q = s => document.querySelector(s), ev = k => events.push([performance.now(), k]);
  const rebuild = () => { if (!r.rebuild) return; for (const s of ['#banner b', '#rate .stars', '#pop > div', '#skillName b']) { const e = q(s); if (e) e.textContent = ''; } };
  const sfx = n => { if (r.sfx && withSound) { ev('sound'); sound.sfx(n); } };
  for (let c = 700; c + CYCLE <= (r.sfx ? HEARD_MS : RUN_MS) + 200; c += CYCLE) {
    at(c, () => { rebuild(); ev('big words'); const b = world.sim?.ball || { x: 20, y: 12 }; world.particles.confetti(b.x, b.y, .4, ['#ffd23f', '#ffffff', '#5aa2ff'], 40); hud.banner('GOAL!', 'goal', { stars: 3, text: 'Great run! You looked up first.' }); });
    for (const o of [300, 500, 700]) at(c + o, () => sfx('tap'));
    at(c + 800, () => { ev('praise'); hud.toast('Good defending!'); });
    at(c + 1000, () => sfx('kick'));
    at(c + 1200, () => { rebuild(); ev('stars'); hud.pop(3, () => [world.width * .5, world.height * .4]); });
    at(c + 1500, () => { ev('buttons'); q('#passBtn')?.classList.toggle('active'); q('#lookBtn')?.classList.toggle('nudge'); sfx('click'); });
    at(c + 1650, () => sfx('up'));
    at(c + 1800, () => { ev('hand'); hud.hand(q('#hand.show') ? null : [world.width * .3, world.height * .7], c); });
  }
}
async function run(r) {
  const { TEST } = G, my = ++epoch, times = [], stop = [], events = [];
  stopAll(); setRun(r, true);
  const t0 = performance.now();
  TEST.onFrame = t => { if (t - t0 >= SKIP_MS) times.push(t); };
  scene(my).catch(e => console.warn('scene', e));
  const at = (ms, f) => { const id = setTimeout(() => { if (my === epoch) { try { f(); } catch (e) { console.warn(e); } } }, ms); stop.push(() => clearTimeout(id)); };
  at(Math.round((r.sfx ? HEARD_MS : RUN_MS) * .55), () => { if (my === epoch) { stopAll(); scene(my).catch(() => {}); } }); // the play once more, so the field keeps moving
  cycle(r, at, t0, events);
  await sleep(r.sfx ? HEARD_MS : RUN_MS);
  TEST.onFrame = null; stop.forEach(f => f()); epoch++;
  setRun(r, false); stopAll(); G.hud.hand(null); document.querySelector('#passBtn')?.classList.remove('active'); document.querySelector('#lookBtn')?.classList.remove('nudge');
  return stats(times, events.filter(e => e[0] - t0 >= SKIP_MS));
}
// Pictures a second, percentiles, slow frames, and for each kind of event the share followed by a slow frame (within 250 ms).
function stats(t, events = []) {
  const d = []; for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
  if (!d.length) return { fps: 0, med: 0, p95: 0, max: 0, slow: 0, over: 0, n: 0, after: 0, kinds: {} };
  const s = [...d].sort((a, b) => a - b), q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const slowEnds = []; for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] > SLOW) slowEnds.push(t[i]);
  const kinds = {}; let hit = 0;
  for (const [te, k] of events) { const h = slowEnds.some(x => x > te && x <= te + AFTER); const o = kinds[k] ||= { n: 0, slow: 0 }; o.n++; if (h) { o.slow++; hit++; } }
  return { fps: d.length / ((t[t.length - 1] - t[0]) / 1000), med: q(.5), p95: q(.95), max: s[s.length - 1], slow: slowEnds.length, over: d.filter(x => x > 50).length, n: d.length,
    after: events.length ? hit / events.length : 0, kinds };
}

// ---------- the whole test ----------
async function start() {
  $('#stIntro').hidden = true; $('#st').className = 'running'; const now = $('#stNow'); now.hidden = false; now.textContent = 'Loading the game…';
  await sleep(1500); // first pictures, shaders, the voice list
  const res = [];
  for (let i = 0; i < RUNS.length; i++) {
    if (RUNS[i].sfx && !withSound) { res.push({ ...RUNS[i], ...stats([]), err: 'skipped (sound not ticked)' }); continue; }
    now.textContent = `Speed test ${i + 1} of ${RUNS.length}: ${RUNS[i].name}${RUNS[i].sfx ? ' (sound on)' : ''}. Don't touch the screen.`;
    let s; try { s = await run(RUNS[i]); } catch (e) { console.error(e); s = { ...stats([]), err: String(e?.message || e) }; }
    res.push({ ...RUNS[i], ...s });
  }
  now.hidden = true; G.show('#home'); showResults(res);
}

// What the test found for this phone. The standard runs give the noise (their spread); a change counts only beyond it.
function bestOf(res) {
  const by = id => res.find(r => r.id === id), base = res.filter(r => r.base && r.n);
  if (!base.length) return null;
  const lo = k => Math.min(...base.map(r => r[k])), hi = k => Math.max(...base.map(r => r[k]));
  const asGood = r => !!(r && r.n && r.fps >= lo('fps') - 1 && r.p95 <= hi('p95') + 2 && r.slow <= hi('slow') + 2);
  const better = r => !!(r && r.n && r.fps > hi('fps') + 2 && r.slow < lo('slow'));
  const heard = res.filter(r => r.sfx && r.n).sort((a, b) => a.slow - b.slow || a.max - b.max);
  const plain = better(by('plain'));
  return { blur: !plain, glow: !plain, soft: !plain, pr: asGood(by('pr2')) ? 2 : 0, sfx: heard[0]?.sfx || null, asGood,
    spread: `fps ${lo('fps').toFixed(0)}–${hi('fps').toFixed(0)}, 95% ${lo('p95').toFixed(0)}–${hi('p95').toFixed(0)} ms, slow frames ${lo('slow')}–${hi('slow')}` };
}
let best = null, report = '';
const pct = v => Math.round(v * 100) + '%';
function words(b) { return `sharpness ${b.pr || 1.5}, head-down blur ${b.blur ? 'on' : 'off'}, glow ${b.glow ? 'on' : 'off'}, soft shadow ${b.soft ? 'on' : 'off'}${b.sfx ? ', sounds: ' + b.sfx : ''}`; }
function showResults(res) {
  const f = (v, d = 0) => (v ? v.toFixed(d) : '-');
  const b = best = bestOf(res);
  const head = ['Run', 'pics/s', '95%', 'worst', '>34ms', '>50ms', 'after events'];
  $('#stTable').innerHTML = `<tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>` + res.map(r => {
    const cls = r.base || !b ? '' : b.asGood(r) ? 'good' : 'bad';
    return `<tr class="${cls}"><td>${r.name}</td><td>${f(r.fps)}</td><td>${f(r.p95)}</td><td>${f(r.max)}</td><td>${r.n ? r.slow : '-'}</td><td>${r.n ? r.over : '-'}</td><td>${r.n ? pct(r.after) : '-'}</td></tr>`;
  }).join('') + (b ? `<tr><td colspan="7" style="text-align:left;color:#c9c2d8">Noise (standard ×3): ${b.spread}</td></tr>` : '');
  const c = G.world.renderer.domElement;
  report = [
    `Heads Up! Soccer speed test v2 · ${G.VERSION || ''} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    navigator.userAgent,
    `screen ${screen.width}x${screen.height} dpr ${devicePixelRatio} · canvas ${c.width}x${c.height} · home-screen app ${navigator.standalone ? 'yes' : 'no'} · size ${G.TEAM?.size || JSON.parse(map[SAVE_KEY]).settings.size}`,
    `run | pics/s | median | 95% | worst | frames >34 ms | >50 ms | events followed by a slow frame | by event (slow/n)`,
    ...res.map(r => `${r.name} | ${f(r.fps)} | ${f(r.med, 1)} | ${f(r.p95, 1)} | ${f(r.max)} | ${r.n ? r.slow : '-'} | ${r.n ? r.over : '-'} | ${r.n ? pct(r.after) : '-'} | ${Object.entries(r.kinds || {}).map(([k, o]) => `${k} ${o.slow}/${o.n}`).join(', ')}${r.err ? ' | ' + r.err : ''}`),
    b ? `noise (standard ×3): ${b.spread}` : 'no standard run',
    b ? `best for this phone: ${words(b)}` : '',
  ].join('\n');
  $('#stText').value = report;
  $('#stMsg').textContent = `Green: as good as the standard runs. ${applyBest(b)}`;
  $('#st').className = ''; $('#stOut').hidden = false;
}
$('#stCopy').onclick = async () => {
  const box = $('#stText'); box.focus(); box.select();
  try { await navigator.clipboard.writeText(report); $('#stCopy').textContent = 'Copied'; }
  catch { try { document.execCommand('copy'); $('#stCopy').textContent = 'Copied'; } catch { $('#stCopy').textContent = 'Select the text and copy it'; } }
};
// Writes only `settings.tuned` into his real save (the rest of it is left as it is); "Back to normal" takes it out again.
function writeTuned(tuned) {
  const s = parse(realGet(SAVE_KEY), null);
  const save = s && typeof s === 'object' ? s : { v: 1 }; // (no save yet: one with just this setting; the game fills in the rest)
  save.settings = save.settings || {};
  if (tuned) save.settings.tuned = tuned; else delete save.settings.tuned;
  REAL.setItem(SAVE_KEY, JSON.stringify(save));
}
// (round 14) When the test finishes it uses what it found, by itself; "Back to standard settings" forgets it again.
$('#stNormal').onclick = () => {
  try { writeTuned(null); $('#stMsg').textContent = 'Back to standard settings: sharpness 1.5, head-down blur on, glow on, soft shadow on.'; }
  catch (e) { $('#stMsg').textContent = 'Could not save: ' + (e?.message || e); }
};
function applyBest(b) {
  if (!b) return 'No result, so nothing changed.';
  try {
    const old = parse(realGet(SAVE_KEY), null)?.settings?.tuned, sfx = b.sfx || (old && typeof old.sfx === 'string' ? old.sfx : null); // (no sound runs: the last way found stays)
    writeTuned({ blur: b.blur, glow: b.glow, soft: b.soft, pr: b.pr || 0, ...(sfx ? { sfx } : {}), at: new Date().toISOString().slice(0, 10), v: G.VERSION || '' });
    return `Now in use on this device: ${words({ ...b, sfx })}.`;
  } catch (e) { return 'Could not save the settings: ' + (e?.message || e); }
}
