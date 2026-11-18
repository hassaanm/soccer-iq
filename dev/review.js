// The review page (dev/review.html): the real game, started straight into one situation of the burn list
// (dev/review-list.js, which also says how to open the page and add an entry), with a slim bar to repeat it, step
// through the list, change the size, level, thinking time and seed, and leave a note on each entry.
//
// The child's save is never touched. Before any game module loads, this page swaps the browser's localStorage, as the
// game sees it, for a throwaway copy kept in memory (and in this tab's sessionStorage, so a reload for another team size
// keeps it). The throwaway save starts with every lesson passed. The page's own notes live under their own key,
// 'soccer-iq:review', in the real localStorage. If the swap cannot be made, the page stops before the game loads.
//
// Starting an entry stops the one before it in place (so the sound the first tap unlocked keeps working): every timed job
// and play script of the game is dropped, so the old round can never go on, and the screens, cards and words are cleared.
// Two things need a reload instead: another team size (the 3D pitch is built once), and leaving one of the game's own
// flows (a lesson, match or cup the grown-up started from a screen) half way, since only one of those can run at a time.
import { ENTRIES, GROUPS } from './review-list.js';

const SAVE_KEY = 'soccer-iq:v1', NOTES_KEY = 'soccer-iq:review', TMP_KEY = 'soccer-iq:review-throwaway';
const SIZES = ['3v3', '4v4', '5v5'], LEVELS = [1, 2, 3], THINKS = [['relaxed', 'Relaxed'], ['normal', 'Normal'], ['quick', 'Quick']];
const SOUND_KEYS = ['voice', 'sound', 'music', 'muted', 'sfxVol', 'musicVol', 'voiceVol', 'recorded', 'voiceName'];
const byId = id => ENTRIES.find(e => e.id === id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

// ---------- the real storage (read the child's save; write only our own key) ----------
let REAL = null; try { REAL = window.localStorage; } catch { /* blocked */ }
const real = {
  get: k => { try { return REAL ? REAL.getItem(k) : null; } catch { return null; } },
  set: (k, v) => { try { REAL?.setItem(k, v); } catch { /* full or blocked: notes stay for this visit */ } },
};
const parse = (t, d) => { try { return JSON.parse(t) ?? d; } catch { return d; } };
const mine = parse(real.get(NOTES_KEY), {}); mine.notes ||= {}; mine.prefs ||= {};
const keepMine = () => real.set(NOTES_KEY, JSON.stringify(mine));
const childSave = parse(real.get(SAVE_KEY), null); // read only

// ---------- the throwaway save ----------
const tmp = (() => { try { return parse(sessionStorage.getItem(TMP_KEY), {}); } catch { return {}; } })();
tmp.map ||= {};
const keepTmp = () => { try { sessionStorage.setItem(TMP_KEY, JSON.stringify(tmp)); } catch { /* memory only */ } };
const shim = {
  getItem: k => (Object.hasOwn(tmp.map, k) ? tmp.map[k] : null),
  setItem: (k, v) => { tmp.map[k] = String(v); keepTmp(); },
  removeItem: k => { delete tmp.map[k]; keepTmp(); },
  clear: () => { tmp.map = {}; keepTmp(); },
  key: i => Object.keys(tmp.map)[i] ?? null,
  get length() { return Object.keys(tmp.map).length; },
};
// A size the game's own size picker chose (it saves and reloads) becomes the page's size.
const savedSize = parse(tmp.map[SAVE_KEY], null)?.settings?.size;
if (savedSize && tmp.setSize && savedSize !== tmp.setSize && SIZES.includes(savedSize)) { mine.prefs.size = savedSize; keepMine(); }

// Which entry, from the address (#id or #id:seed), else the last one.
const fromHash = () => { const [id, seed] = decodeURIComponent(location.hash.slice(1)).split(':'); return byId(id) ? { id, seed: +seed || null } : null; };
const want0 = fromHash() || (byId(mine.prefs.last) ? { id: mine.prefs.last, seed: null } : null);
const sizeFor = e => e?.size || (SIZES.includes(mine.prefs.size) ? mine.prefs.size : SIZES.includes(childSave?.settings?.size) ? childSave.settings.size : '3v3');
const bootSize = sizeFor(want0 && byId(want0.id));
{
  const cs = childSave?.settings || {}, s = { size: bootSize };
  for (const k of SOUND_KEYS) if (k in cs) s[k] = cs[k];
  const old = parse(tmp.map[SAVE_KEY], null); // keep sound settings changed on this page
  if (old?.settings) for (const k of SOUND_KEYS) if (k in old.settings) s[k] = old.settings[k];
  tmp.map[SAVE_KEY] = JSON.stringify({ v: 1, us: childSave?.us || 'barca', them: childSave?.them || 'madrid', settings: s });
  tmp.setSize = bootSize; keepTmp();
}
let swapped = false;
try { Object.defineProperty(window, 'localStorage', { configurable: true, enumerable: true, get: () => shim }); swapped = window.localStorage === shim && globalThis.localStorage === shim; } catch { swapped = false; }

// ---------- boot ----------
let G = null; // the game's modules, once loaded
boot().catch(e => fail(e));
async function boot() {
  if (!swapped) throw new Error('This browser would not let the page use a throwaway save, so the game was not started (the child\'s save stays safe).');
  const html = await (await fetch('index.html', { cache: 'no-cache' })).text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const n of [...doc.body.childNodes]) if (n.nodeName !== 'SCRIPT') document.body.appendChild(document.adoptNode(n));
  buildBar();
  const [main, stage, hudM, screens, dom, store, flows, home, report, speech, progress, skills, generate, geom, shot, teams, sound, voice, version] = await Promise.all([
    '../js/main.js', '../js/ui/stage.js', '../js/ui/hud.js', '../js/ui/screens.js', '../js/ui/dom.js', '../js/ui/store.js', '../js/flows.js', '../js/ui/home.js', '../js/ui/report.js',
    '../js/ui/speech.js', '../js/progress.js', '../js/skills.js', '../js/generate.js', '../js/geom.js', '../js/shot.js', '../js/teams.js', '../js/sound.js', '../js/voice.js', '../js/version.js',
  ].map(p => import(p)));
  G = { main, ...stage, ...hudM, ...screens, ...dom, ...store, ...flows, ...home, ...report, ...speech, ...progress, ...skills, ...generate, ...geom, ...shot, ...teams, ...sound, ...voice, ...version, save: store.save, P: store.P, CLOSE: shot.CLOSE }; // (progress.js has a save() of its own: the store's is the one)
  const { game, hud } = G;
  if (G.P.settings.size !== G.TEAM.size) throw new Error('The throwaway save and the pitch disagree on the team size.');
  G.levelOf0 = game.levelOf; G.thinkTime0 = game.thinkTime;
  // A result card from a round that was stopped never lets that round go on.
  const banner0 = hud.banner; G.banner0 = banner0;
  hud.banner = function (...a) { const e = epoch; return banner0.apply(this, a).then(v => (e === epoch ? v : new Promise(() => {}))); };
  // Their keeper's wrong-way guesses are counted (for the "keeper guesses wrong" check).
  const guess0 = game.guessWrong; game.guessWrong = function (...a) { const r = guess0.apply(this, a); if (r) review.guesses++; return r; };
  const offer0 = game.skillOffer; game.skillOffer = function (...a) { review.offers++; return offer0.apply(this, a); }; // (and skill moments offered)
  G.$('#homeBtn').onclick = () => start('home'); // the field's home button: the Home entry (the game itself reloads)
  state.size = G.TEAM.size;
  const w = fromHash() || want0;
  setView(w ? (mine.prefs.view === 'min' ? 'min' : 'bar') : 'list');
  const first = start(w?.id || 'home', { seed: w?.seed, keepView: true });
  review.ready = true; // (the entry runs on: a round resolves only when it is over)
  await first;
}

// ---------- the state of the page ----------
const state = { size: bootSize, level: LEVELS.includes(mine.prefs.level) ? mine.prefs.level : 1, think: THINKS.some(t => t[0] === mine.prefs.think) ? mine.prefs.think : 'normal', seed: 1, status: '' };
let epoch = 0, cur = null, flowy = false, notice = '';
export const review = { ready: false, guesses: 0, offers: 0, errors, entries: ENTRIES, start: (id, o) => start(id, o), again: () => again(), next: () => step(1), prev: () => step(-1), reached: () => reached(), act: () => act(), state: () => ({ id: cur?.id, ...state, notice, epoch }), copy: () => feedbackText() };
window.__review = review;

const levelOf = e => (e.pick?.includes('level') || !e.level ? state.level : e.level);
async function start(id, { seed = null, keepView = false } = {}) {
  const e = byId(id); if (!e) return;
  const my = ++epoch;
  state.seed = seed || (cur?.id === id ? state.seed : e.seed || 1);
  mine.prefs.last = id; keepMine();
  try { history.replaceState(null, '', location.pathname + location.search + '#' + id + (state.seed > 1 ? ':' + state.seed : '')); } catch { /* fine */ }
  const want = e.size || sizeFor(null);
  if (G && (want !== G.TEAM.size || mustReload())) return reloadTo(want);
  cur = e; flowy = !!(e.screen || e.results || e.keeper);
  showErr('');
  if (!keepView && view === 'list') setView('bar');
  if (!G) return;
  try {
    stopAll();
    resetSave(e);
    status('starting…'); render();
    await run(e, my);
  } catch (err) { if (my === epoch) { fail(err); status('error'); } }
  if (my === epoch) render();
}
const again = () => cur && start(cur.id, { seed: state.seed });
const step = d => { const i = ENTRIES.indexOf(cur); return start(ENTRIES[(i + d + ENTRIES.length) % ENTRIES.length].id, { seed: null }); };

// A real flow (a lesson, match or cup) may be running: only a reload stops it.
function mustReload() {
  if (!flowy) return false;
  const { game, $ } = G;
  return game.mode !== 'home' || !$('#card').classList.contains('hidden') || !!G.goalie?.on;
}
function reloadTo(size) {
  const s = parse(tmp.map[SAVE_KEY], {}); s.settings ||= {}; s.settings.size = size; tmp.map[SAVE_KEY] = JSON.stringify(s); tmp.setSize = size; keepTmp();
  status('reloading…'); render();
  location.reload();
}

// Stops whatever runs now: the old round's jobs and scripts are dropped (it can never go on), and the screen is cleared.
function stopAll() {
  const { game, hud, $ } = G;
  game.tweens.length = 0; game.speechWaits.length = 0;
  game.sim.co = null; game._playRes = null; game._choose = null;
  game.closeWindow?.(); game.win = null;
  if (game.sk) game.skillEnd(); game.sk = null;
  Object.assign(game, { slow: 1, slowV: 0, skCam: 0, prate: 1, skipping: false, showing: false, card: null, rated: null, toStreak: 0, timeouts: 0, lessonTimeouts: 0, forceGuess: false, onRoundStub: null });
  for (const k of ['load', 'round', 'match', 'demo']) if (Object.hasOwn(game, k)) delete game[k];
  game.levelOf = G.levelOf0; game.thinkTime = G.thinkTime0;
  G.hush();
  for (const s of ['#card', '#results', '#menu', '#report', '#lessonSheet', '#cupSheet', '#albumSheet', '#sizePop', '#soundPop']) $(s)?.classList.add('hidden');
  $('#cardMain').onclick = null; $('#cardAlt').onclick = null;
  $('#confetti')?.remove();
  G.banner0.call(hud, '', 'soft', null); // (clears the result card's own timers)
  $('#hud').classList.remove('rating'); $('#banner').classList.remove('show', 'up'); $('#rate').classList.remove('show');
  for (const s of ['#toast', '#pop', '#seenNote', '#skillName', '#skillTag']) $(s).classList.remove('show');
  hud.caption(''); hud.hideScore(); hud.dots([], 0); hud.skill(null); hud.hand(null);
  game.home();
  notice = '';
}

// The throwaway save for an entry: every lesson passed at the chosen level, Match and Cup open. Sound settings stay.
function resetSave(e) {
  const { P, PATH, defaultProgress, today, teamById } = G, lv = levelOf(e), day = today();
  const keep = {}; for (const k of SOUND_KEYS) if (k in P.settings) keep[k] = P.settings[k];
  const p = defaultProgress();
  p.us = teamById(P.us) ? P.us : p.us; p.them = teamById(P.them) ? P.them : p.them;
  Object.assign(p.settings, keep, { size: G.TEAM.size, think: state.think, alwaysOpen: true });
  for (const s of PATH) p.skills[s.id] = { box: lv, top: lv, last: day - 1, sessions: 1, firstTry: 5, rounds: 6, day: day - 1, days: lv, upDay: day - 1, today: 0, recent: [1, 1, 1] };
  p.known = PATH.map(s => s.id); p.openDay = day; p.sessions = 6;
  for (const k of Object.keys(P)) delete P[k];
  Object.assign(P, p);
  if (e.screen === 'report') P.log = sampleLog();
  G.save(); G.renderPickers();
}
// The progress page reads the decision log: the real one in this browser (a copy; never written back), else a sample.
function sampleLog() {
  const rl = childSave?.log;
  if (rl && (Object.keys(rl.days || {}).length || Object.keys(rl.weeks || {}).length)) return JSON.parse(JSON.stringify(rl));
  const { PATH, logChoice, today } = G, p = { log: { days: {}, weeks: {} } }, day = today();
  let r = 7; const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let d = 26; d >= 0; d -= 2) for (const s of PATH) for (let k = 0; k < 2; k++) {
    const u = rnd(), skill = (PATH.indexOf(s) % 5) / 10 + (26 - d) / 80;
    logChoice(p, { id: s.id, mode: rnd() < .5 ? 'lesson' : 'match', grade: u < .45 + skill ? 'best' : u < .7 + skill ? 'okay' : 'miss', sec: 1 + rnd() * 6, looked: rnd() < .7 }, day - d);
  }
  return p.log;
}

// ---------- starting each kind of entry ----------
function setStage(env) {
  const { game, world, show, hud, teamById, P, preloadClips, pieces, displayName } = G;
  const us = teamById(P.us), them = teamById(P.them);
  game.setTeams(us, them);
  preloadClips([...us.players, ...them.players].map(p => 'name:' + pieces(displayName(p.name))[0]?.name));
  world.setEnv(env); show(null); hud.hideScore(); hud.dots([], 0);
}
// A scene of `lesson`'s `pattern` from the seed on (some seeds cannot make a pattern: the next one is tried).
function scene({ lesson, pattern, where }, seed, lv, dir = 1) {
  const { generate, runsAt, PITCH, CLOSE } = G;
  const fits = sc => { const d = Math.hypot(PITCH.L - sc.heroTo[0], PITCH.W / 2 - sc.heroTo[1]);
    return where === 'close' ? d <= CLOSE : where === 'far' ? d > CLOSE : where === 'midfield' ? Math.abs(sc.heroTo[0] - PITCH.L / 2) < 4 : true; };
  const tries = [...Array(80).keys()].map(i => seed + dir * i).filter(s => s >= 1).concat(dir < 0 ? [...Array(80).keys()].map(i => seed + 1 + i) : []);
  for (const s of tries) { const sc = generate(lesson, s, { pattern, runs: runsAt(lv) }); if (sc && sc.pattern === pattern && fits(sc)) return { sc, seed: s }; }
  throw new Error(`No scene of ${lesson} / ${pattern}${where ? ' (' + where + ')' : ''} near seed ${seed} at ${G.TEAM.size}.`);
}
async function run(e, my) {
  const { game, hud, $, show, renderPickers, PATH, generate } = G;
  const lv = levelOf(e);
  if (e.round) {
    const { sc, seed } = scene(e.round, state.seed, lv, state.stepDir || 1); state.seed = seed; state.stepDir = 1; renderSeed();
    setStage('park'); hud.dots([], 1); review.offers = 0;
    game.levelOf = () => lv; game.thinkTime = () => state.think; game.choiceLog = 'lesson';
    status('playing');
    const r = await game.round(sc, { hint: lv <= 1, light: lv >= 2, level: lv, first: !!e.round.first });
    if (my !== epoch) return;
    hud.dots([r.firstTry && r.stars === 3], 1); status('done: Again, or the next one');
    return;
  }
  if (e.match || (e.keeper === 'match' && keeperMoment())) {
    const m = e.match || { goals: 5 }, without = m.without || [];
    for (const id of without) delete G.P.skills[id];
    const ids = PATH.map(s => s.id).filter(id => !without.includes(id));
    setStage('crowd'); game.skills = new Set(ids); game.forceGuess = !!m.forceGuess; review.guesses = 0;
    if (m.first) {
      const { sc, seed } = scene(m.first, state.seed, lv, state.stepDir || 1); state.seed = seed; state.stepDir = 1; renderSeed();
      const load = game.load; game.load = function (x) { delete this.load; return load.call(this, sc); };
    }
    const extra = Array.from({ length: 24 }, () => generate(ids[Math.floor(Math.random() * ids.length)], Math.floor(Math.random() * 1e9))).filter(Boolean);
    status('playing');
    const score = await game.match(ids, extra, m.goals, 'free');
    if (my !== epoch) return;
    status(`done: ${score.us}–${score.them}. Again, or the next one`);
    return;
  }
  if (e.keeper) {
    const ok = e.keeper === 'game' && !!$('#keeperBtn');
    if (!ok) { notice = 'Not in this build yet: the keeper work is on another branch. This entry lights up once it is merged.'; status('not in this build yet'); return; }
    game.home(); renderPickers(); show('#home'); G.goalie = (await import('../js/ui/goalie.js').catch(() => null))?.goalie || null;
    $('#keeperBtn').click(); status('playing'); return;
  }
  if (e.screen) {
    game.home(); G.world.setEnv('crowd'); renderPickers(); show('#home');
    if (e.screen === 'sizes') $('#sizeBtn').click();
    else if (e.screen === 'lessons') $('#lessonBtn').click();
    else if (e.screen === 'report') G.openReport();
    else if (e.screen === 'cups') { G.openCups(); $('#cups .tile')?.click(); }
    else if (e.screen === 'menu') {
      // Held as he would hold it. (The press is not a real tap, so the game must not take it as the tap that unlocks sound.)
      const oac = [window.OfflineAudioContext, window.webkitOfflineAudioContext];
      window.OfflineAudioContext = window.webkitOfflineAudioContext = undefined;
      try { $('#gear').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); } finally { [window.OfflineAudioContext, window.webkitOfflineAudioContext] = oac; }
      status('holding the gear…'); render();
      await sleep(1350); if (my !== epoch) return;
      $('#gear').dispatchEvent(new PointerEvent('pointerleave'));
    }
    status('showing'); return;
  }
  if (e.results) return results(e, my);
  throw new Error('This entry has no way to start.');
}
const keeperMoment = () => typeof G.game.keeperMoment === 'function';
// One of the game's own flows, played through at once: every round right, the match won, every card tapped.
async function results(e, my) {
  const { game, $, P, runSession, runFreePlay } = G;
  P.settings.alwaysOpen = false; P.openDay = -1; P.pick = null;
  if (e.results === 'lesson') { delete P.skills['give-and-go']; P.pick = 'give-and-go'; }
  game.round = async () => ({ firstTry: true, stars: 3 });
  game.match = async (ids, extra, toWin) => ({ us: toWin, them: toWin === 2 ? 1 : 3 });
  game.demo = async () => {};
  status('playing it through…'); render();
  const done = (e.results === 'match' ? runFreePlay : runSession)();
  let settled = false; Promise.resolve(done).finally(() => { settled = true; });
  for (let i = 0; i < 120 && !settled && my === epoch; i++) { if (!$('#card').classList.contains('hidden')) $('#cardMain').click(); await sleep(50); }
  for (const k of ['round', 'match', 'demo']) if (Object.hasOwn(game, k)) delete game[k];
  if (my !== epoch) return;
  if ($('#results').classList.contains('hidden')) { flowy = true; return reloadTo(G.TEAM.size); } // another flow was still running: only a reload stops it
  status('showing');
}

// What "it is up" means for the entry now showing (for the walk script and the tests).
function reached() {
  if (!G || !cur) return false;
  const { game, $ } = G, r = cur.reach || (cur.round || cur.match ? 'decide' : null);
  const shown = s => !!$(s) && !$(s).classList.contains('hidden');
  if (cur.keeper && notice) return 'placeholder';
  if (r === 'decide') return game.phase === 'decide' && game.canAct;
  if (r === 'defend') return game.phase === 'decide' && game.canAct && game.sc?.kind === 'defense';
  if (r === 'timeout') return (game.lessonTimeouts || 0) > 0 && $('#rate').classList.contains('show');
  if (r === 'skill') return review.offers > 0;
  if (r === 'guess') return review.guesses > 0;
  if (cur.results) return shown('#results');
  const sel = { home: '#home', sizes: '#sizePop', lessons: '#lessonSheet', menu: '#menu', report: '#report', cups: '#card' }[cur.screen];
  if (sel) return shown(sel) && (!['sizes', 'lessons', 'report'].includes(cur.screen) || shown('#home')); // (those three open over the home screen)
  if (cur.keeper) return G.goalie?.on || false;
  return false;
}
// What the walk script does once the entry is up (the page never chooses for the grown-up).
function act() {
  const { game } = G;
  if (cur?.act === 'best' && game.canAct && game.sc?.best) game.choose(game.sc.best);
  if (cur?.act === 'shoot' && game.canAct) game.shoot();
}

// ---------- notes ----------
const noteOf = id => mine.notes[id] || null;
function setNote(patch) {
  if (!cur) return;
  const n = { ...(noteOf(cur.id) || {}), ...patch, size: G?.TEAM.size || state.size, level: levelOf(cur), think: state.think, seed: state.seed, at: Date.now() };
  if (!n.vote && !n.text?.trim()) delete mine.notes[cur.id]; else mine.notes[cur.id] = n;
  keepMine(); render();
}
function feedbackText() {
  const thinkName = t => THINKS.find(x => x[0] === t)?.[1] || t;
  const list = ENTRIES.filter(e => mine.notes[e.id]);
  const head = `Heads Up! Soccer: review notes (${G?.VERSION || 'game'}, ${new Date().toISOString().slice(0, 10)})`;
  if (!list.length) return head + '\n\nNo notes yet.';
  return head + '\n\n' + list.map((e, i) => {
    const n = mine.notes[e.id], how = [n.vote === 'good' ? 'Good' : n.vote === 'work' ? 'Needs work' : null, n.size, e.round || e.match ? `Level ${n.level}` : null, e.round || e.match ? `${thinkName(n.think)} thinking time` : null, e.round || e.match?.first ? `seed ${n.seed}` : null].filter(Boolean).join(' · ');
    return `${i + 1}. ${e.title} [${e.group}] (#${e.id})\n   ${how}${n.text?.trim() ? '\n   ' + n.text.trim().replace(/\n+/g, '\n   ') : ''}`;
  }).join('\n\n');
}
async function copyFeedback() {
  const t = feedbackText(), out = document.getElementById('rvOut');
  out.value = t; out.hidden = false;
  try { await navigator.clipboard.writeText(t); flashCopy('Copied'); } catch { out.focus(); out.select(); flashCopy('Select the text below and copy it'); }
}
function flashCopy(t) { const b = document.getElementById('rvCopy'); b.textContent = t; setTimeout(() => { b.textContent = 'Copy feedback'; }, 2200); }

// ---------- the bar, the handle and the list ----------
let view = 'bar';
const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v != null) n.setAttribute(k, v); } n.append(...kids); return n; };
const btn = (label, title, on, cls) => el('button', { type: 'button', title, 'aria-label': title, class: cls, onclick: e => { e.stopPropagation(); on(); } }, label);
// The page's own controls never reach the field (no look-around drags, no taps on players).
const quiet = n => { for (const ev of ['pointerdown', 'pointerup', 'pointermove']) n.addEventListener(ev, e => e.stopPropagation()); return n; };
function buildBar() {
  const root = el('div', { id: 'rv', class: 'bar' });
  const handle = quiet(el('div', { id: 'rvHandle' },
    btn('☰', 'All entries', () => setView('list')), btn('↻', 'Again', again), btn('›', 'Next', () => step(1)), btn(el('span', { class: 'n', id: 'rvHn' }), 'Show the bar', () => setView('bar'))));
  const seg = (id, items, on) => el('span', { class: 'seg', id }, ...items.map(([v, t]) => btn(t, t, () => on(v)))) ;
  const bar = quiet(el('div', { id: 'rvBar' },
    el('div', { class: 'r1' },
      btn('☰', 'All entries', () => setView(view === 'list' ? 'bar' : 'list')),
      el('div', { class: 'what' }, el('div', {}, el('b', { id: 'rvTitle' }), el('span', { class: 'n', id: 'rvN' }), el('span', { class: 'st', id: 'rvSt' })), el('div', { class: 'look', id: 'rvLook' })),
      btn('‹', 'Previous', () => step(-1)), btn('↻ Again', 'Again', again), btn('›', 'Next', () => step(1)), btn('▴', 'Hide the bar', () => setView('min'))),
    el('div', { class: 'r2' },
      el('span', { id: 'rvSize' }, el('span', { class: 'lbl' }, 'size'), seg('rvSizeSeg', SIZES.map(s => [s, s]), v => { mine.prefs.size = v; keepMine(); if (cur) start(cur.id, { seed: state.seed }); }), el('span', { class: 'fixed', id: 'rvSizeFixed' })),
      el('span', { id: 'rvLevel' }, el('span', { class: 'lbl' }, 'level'), seg('rvLevelSeg', LEVELS.map(l => [l, String(l)]), v => { state.level = v; mine.prefs.level = v; keepMine(); again(); })),
      el('span', { id: 'rvThink' }, el('span', { class: 'lbl' }, 'time'), seg('rvThinkSeg', THINKS, v => { state.think = v; mine.prefs.think = v; keepMine(); again(); })),
      el('span', { id: 'rvSeed', class: 'seed' }, el('span', { class: 'lbl' }, 'seed'), btn('−', 'Another one like this (back)', () => { state.stepDir = -1; start(cur.id, { seed: Math.max(1, state.seed - 1) }); }), el('b', { id: 'rvSeedN' }), btn('+', 'Another one like this', () => start(cur.id, { seed: state.seed + 1 }))),
      btn('👍', 'Looks good', () => setNote({ vote: noteOf(cur.id)?.vote === 'good' ? null : 'good' }), 'good'),
      btn('🔧', 'Needs work', () => setNote({ vote: noteOf(cur.id)?.vote === 'work' ? null : 'work' }), 'work'),
      el('input', { id: 'rvNote', type: 'text', placeholder: 'Note (dictation works)', autocomplete: 'off', oninput: e => setNote({ text: e.target.value }) })),
    el('div', { id: 'rvErr' })));
  const list = quiet(el('div', { id: 'rvList' }));
  const cols = el('div', { class: 'cols' });
  for (const g of GROUPS) {
    const items = ENTRIES.filter(e => e.group === g); if (!items.length) continue;
    cols.append(el('div', { class: 'grp' }, el('h3', {}, g), ...items.map(e => el('button', { type: 'button', class: 'item', 'data-id': e.id, onclick: () => start(e.id) },
      el('span', { class: 'm' }), el('span', {}, e.title, e.size ? el('small', {}, e.size) : '')))));
  }
  list.append(cols, el('div', { class: 'foot' },
    el('div', { class: 'row' }, el('button', { type: 'button', id: 'rvCopy', onclick: copyFeedback }, 'Copy feedback')),
    el('div', { class: 'hint' }, 'Notes stay in this browser (not in the game\'s save). Copy feedback puts every note into the clipboard as plain text, with the size, level and seed in use, ready to paste into a chat. If the clipboard is blocked, copy it from the box.'),
    el('textarea', { id: 'rvOut', readonly: '', hidden: '' })));
  root.append(handle, bar, list, el('div', { id: 'rvNotice' }));
  document.body.append(root);
  addEventListener('resize', place);
  addEventListener('keydown', e => {
    if (e.target.closest?.('input, textarea')) return;
    if (e.key === 'ArrowRight' || e.key === 'n') step(1); else if (e.key === 'ArrowLeft' || e.key === 'p') step(-1); else if (e.key === 'a') again(); else if (e.key === 'Escape') setView(view === 'min' ? 'bar' : 'min');
  });
  render();
}
function setView(v) { view = v; if (v !== 'list') { mine.prefs.view = v; keepMine(); } const r = document.getElementById('rv'); if (r) { r.className = v; render(); } }
function place() { const b = document.getElementById('rvBar'), l = document.getElementById('rvList'); if (b && l) l.style.top = b.offsetHeight + 'px'; }
function status(t) { state.status = t; const s = document.getElementById('rvSt'); if (s) s.textContent = t ? '· ' + t : ''; }
function renderSeed() { const n = document.getElementById('rvSeedN'); if (n) n.textContent = state.seed; }
function render() {
  const $ = id => document.getElementById(id); if (!$('rv')) return;
  const e = cur || byId('home'), i = ENTRIES.indexOf(e), pick = new Set(e.pick || []), n = noteOf(e.id);
  $('rvTitle').textContent = e.title; $('rvN').textContent = `${i + 1}/${ENTRIES.length}`; $('rvHn').textContent = `${i + 1}/${ENTRIES.length}`;
  $('rvLook').textContent = e.look; status(state.status);
  $('rvSize').hidden = !pick.has('size') && !e.size; $('rvSizeSeg').hidden = !!e.size; $('rvSizeFixed').textContent = e.size ? `${e.size} only` : '';
  $('rvLevel').hidden = !pick.has('level'); $('rvThink').hidden = !pick.has('think'); $('rvSeed').hidden = !pick.has('seed') || !(e.round || e.match?.first);
  const size = G?.TEAM.size || state.size;
  for (const b of $('rvSizeSeg').children) b.classList.toggle('on', b.textContent === size);
  for (const b of $('rvLevelSeg').children) b.classList.toggle('on', +b.textContent === levelOf(e));
  for (const [k, b] of THINKS.map((t, j) => [t[0], $('rvThinkSeg').children[j]])) b.classList.toggle('on', k === state.think);
  renderSeed();
  document.querySelector('#rvBar .good').classList.toggle('on', n?.vote === 'good'); document.querySelector('#rvBar .work').classList.toggle('on', n?.vote === 'work');
  if (document.activeElement !== $('rvNote')) $('rvNote').value = n?.text || '';
  for (const it of document.querySelectorAll('#rvList .item')) {
    const nn = noteOf(it.dataset.id), m = it.querySelector('.m');
    it.classList.toggle('cur', it.dataset.id === e.id);
    m.className = 'm ' + (nn?.vote || (nn ? 'note' : '')); m.textContent = nn ? (nn.vote === 'good' ? '●' : nn.vote === 'work' ? '●' : '✎') : '';
  }
  $('rvNotice').textContent = notice;
  place();
}
function showErr(t) { const n = document.getElementById('rvErr'); if (n) n.textContent = t; }
function fail(e) {
  const t = String(e?.message || e); errors.push(t);
  if (!document.getElementById('rv')) { document.body.textContent = t; return; }
  showErr('Error: ' + t); if (view === 'min') setView('bar');
}
// Errors anywhere (the frame loop logs its own) show in the bar too; they still go to the console.
const err0 = console.error.bind(console);
console.error = (...a) => { err0(...a); fail(a.map(x => x?.stack || x?.message || String(x)).join(' ').split('\n')[0]); };
addEventListener('error', e => fail(e.error || e.message));
addEventListener('unhandledrejection', e => fail(e.reason));
