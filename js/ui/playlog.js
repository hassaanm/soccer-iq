// "Record play" (v76): the grown-ups' one switch (the menu's "Record play", saved as settings.recordSpeed, which also runs
// the speed recorder, js/perf.js) for the play log (js/log.js). This file feeds the log from the game: it watches the game
// once a frame (through perf.js hooks, which also pass on perf's own marks: taps, phases, windows, quality…), and wraps a
// few of the game's methods on the game object itself (as dev/review.js does), so the game's files carry almost no hooks.
// While recording is on: the flag button in play (a tap marks "something odd just happened here"), and Copy log and
// Clear on the home screen. Nothing here changes what the game does. Never in the throwaway mode (the speed test, the
// review page): their play is never logged.
import * as L from '../log.js';
import * as perf from '../perf.js';
import { $ } from './dom.js';
import { game, world } from './stage.js';
import { P } from './store.js';
import { hud, tunnelNow } from './hud.js';
import { VERSION } from '../version.js';
import { TEAM, PITCH, DRIBBLE_DIRS } from '../geom.js';
import { throwaway } from '../storage.js';
import { PATH } from '../skills.js';
import { level } from '../progress.js';
import { MATE, spotKind } from '../game/shared.js';
import { onPause } from '../pause.js';

const { kv } = L, f2 = x => (Number.isFinite(x) ? Math.round(x * 100) / 100 : '-'), f1 = x => (Number.isFinite(x) ? Math.round(x * 10) / 10 : '-');
const deg = r => (Number.isFinite(r) ? Math.round(r * 180 / Math.PI) : '-'), wrapR = a => Math.atan2(Math.sin(a), Math.cos(a));
const keeper = () => (typeof window !== 'undefined' ? window.__keeper : null); // (ui/goalie.js: the keeper game)
const STC = s => (s === 'carried' ? 0 : s === 'flying' ? 1 : s === 'loose' ? 2 : s === 'held' ? 3 : 4), STL = 'cflhx';
export const recording = () => !!P.settings.recordSpeed && !throwaway;

// ---------- the header of a session ----------
const pad = n => String(n).padStart(2, '0');
function header(s) {
  let app = 0; try { app = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches ? 1 : 0; } catch { /* old browser */ }
  const d = new Date(), at = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const bc = document.body.classList, gfx = bc.contains('smooth') ? 'smooth' + (bc.contains('blur') ? '+blur' : '') + (bc.contains('softwords') ? '+soft' : '') : 'pretty';
  return [
    `LOG ${kv({ s, v: VERSION, at, size: TEAM.size, pitch: `${PITCH.L}x${PITCH.W}`, app, screen: `${screen.width}x${screen.height}`, dpr: devicePixelRatio, view: `${innerWidth}x${innerHeight}`, gfx, q: world.level, pr: world.renderer?.getPixelRatio?.() })}`,
    `UA ${kv({ ua: navigator.userAgent })}`,
    settingsLine(),
    `LVL ${kv({ levels: PATH.filter(p => p.ready).map(p => `${p.id}:${level(P, p.id)}`).join(','), sessions: P.sessions, keeper: P.keeper ? `${P.keeper.best}/${P.keeper.plays}` : null })}`,
  ];
}
const settingsLine = () => `SET ${JSON.stringify(P.settings).replace(/\|/g, '/')}`;
export function settingsChanged() { if (L.LOG.on) L.ev('SET', settingsLine().slice(4)); }

// ---------- the scene ----------
let sceneN = 0, winN = 0, curWin = null, lastSay = '', lastFlush = 0;
const P2 = p => (p ? `${f2(p[0])},${f2(p[1])}` : null);
const seedOf = id => { const m = /-(\d+)m?$/.exec(String(id || '')); return m ? +m[1] : null; };
// The scene itself, numbers to the centimetre, for a scene made from live play (it cannot be made again from a seed).
// (oppsTo and heroTo are left out where they are the same as opps and hero, and the grades: the OPT line has them; the
// replay puts them back)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const scJson = sc => JSON.stringify({ ...sc, oppsTo: same(sc.oppsTo, sc.opps) ? undefined : sc.oppsTo, heroTo: same(sc.heroTo, sc.hero) ? undefined : sc.heroTo, cue: undefined, grades: undefined, best: undefined, ok: undefined, safe: undefined },
  (k, x) => (typeof x === 'number' ? Math.round(x * 10) / 10 : typeof x === 'function' ? undefined : x)).replace(/\|/g, '/');
function sceneLine(sc, how) {
  const g = game; sceneN++; prev.sc = sc; prev.how = how;
  const lv = sc.live ? null : g.levelOf?.(sc.skill);
  L.ev('SCENE', kv({ n: sceneN, how: how === 'load' ? null : how, mode: g.mode, id: sc.id || '-', skill: sc.skill, pattern: sc.pattern, seed: how === 'load' ? seedOf(sc.id) : null, kind: sc.kind && sc.kind !== 'attack' ? sc.kind : null, live: sc.live ? 1 : null,
    lv, size: sc.size && sc.size !== TEAM.size ? sc.size : null, hero: how === 'load' ? P2(sc.heroTo || sc.hero) : null, restart: sc.restart ? 1 : null, run: sc.run }));
  if (how !== 'load' || !/^gen-/.test(sc.id || '')) L.ev('SC', scJson(sc)); // (a scene loaded from its seed is made again from it)
}

// ---------- players, camera, options ----------
function vel(s, a) {
  if (a.track) { try { const q = a.track.at(s.time - a.track.t0); return [q.vx || 0, q.vy || 0]; } catch { return [0, 0]; } }
  if (a.lv) return a.lv;
  const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy); if (!(d > .05 && a.speed > 0)) return [0, 0];
  const sp = Math.min(a.speed, a.sp || a.speed); return [dx / d * sp, dy / d * sp];
}
const faceA = a => Math.atan2(a.face?.[1] || 0, a.face?.[0] ?? 1);
function atLine(s, more, u, gt) {
  const out = [kv({ u: f2(u), gt: f2(gt) })];
  for (const a of s.agents.values()) { const v = more ? vel(s, a) : null; out.push(`${a.id}=${f2(a.x)},${f2(a.y)},${deg(faceA(a))}${v ? `,${f1(v[0])},${f1(v[1])}` : ''}`); }
  const b = s.ball; out.push(`ball=${f2(b.x)},${f2(b.y)},${f1(b.z || 0)},${STL[STC(b.state)]},${b.carrier || '-'}`);
  return out.join(' ');
}
const camYaw = c => (c ? Math.atan2(c.tgt[1] - c.eye[1], c.tgt[0] - c.eye[0]) : NaN);
// Every choice on offer as the buttons show it, where it goes, and how the game grades it now (rounds.js rating).
function offered(g) {
  const sc = g.sc, out = [];
  if (!sc) return out;
  if (spotKind(sc)) for (const sp of sc.spots || []) out.push('spot:' + sp.id);
  else if (sc.kind === 'receive') out.push('turn:L', 'turn:R', ...(sc.back ? ['turn:B'] : []));
  else if (sc.kind === 'tackle') out.push('tackle:good', 'tackle:early', 'tackle:tight', 'tackle:none');
  else {
    for (const k of Object.keys(MATE)) if (g.sim.a(MATE[k])) out.push(k);
    for (const d of Object.keys(DRIBBLE_DIRS)) out.push('drib:' + d);
    if (g.pushAllowed) for (const d of ['fwd', 'fl', 'fr', 'left', 'right']) out.push('push:' + d);
    if (sc.shots) out.push(...Object.keys(sc.shots)); else if (g.canShoot) out.push('shoot');
  }
  return out;
}
// One line: the choices on offer grouped by grade (best, ok, safe, bad), where a run goes (spots: at=), and how a shot
// lesson's shots end (shots=). Passes go to the friend (his place is in AT); dribbles follow from his place.
function optLine(g, n) {
  const sc = g.sc, by = { best: [], ok: [], safe: [], bad: [] }, at = [], all = offered(g);
  for (const o of offered(g)) {
    let r = 'bad'; try { r = g.rating(o); } catch { /* */ } (by[r] || (by[r] = [])).push(o);
    if (o.startsWith('spot:') || o.startsWith('turn:')) try { const q = g.target(o); if (q && Number.isFinite(q.x)) at.push(`${o}@${f1(q.x)},${f1(q.y)}`); } catch { /* */ }
  }
  // (on the ball, the usual offer: a pass to each friend, the 8 dribbles, the 5 pushes when push=1, a shot when shoot=1;
  // bad=* : every other one offered is bad)
  const usual = sc && !spotKind(sc) && sc.kind !== 'receive' && sc.kind !== 'tackle' && !sc.shots, bad = by.bad;
  if (usual) by.bad = bad.length ? ['*'] : [];
  return kv({ n, ...Object.fromEntries(Object.entries(by).map(([k, l]) => [k, l.join(',')])), push: usual && g.pushAllowed ? 1 : null, shoot: usual && all.includes('shoot') ? 1 : null, at: at.join(';'), shots: sc?.shots ? Object.entries(sc.shots).map(([k, x]) => `${k}:${x}`).join(',') : null });
}

// ---------- a decision window opens (game/window.js openWindow) ----------
function winOpen() {
  const g = game, w = g.win, s = g.sim; if (!w || curWin?.w === w) return;
  if (g.sc !== prev.sc && g.sc) sceneLine(g.sc, 'play');
  const t = L.now(); winN++; curWin = { n: winN, w, t }; if (!g.showing) L.hotOn(t); forceRow(); // (the better play shown again: 1 row a second)
  const h = s.a('hero'), hv = h ? vel(s, h) : [0, 0], sp = Math.hypot(hv[0], hv[1]), face = h ? faceA(h) : NaN, run = sp > .3 ? Math.atan2(hv[1], hv[0]) : face;
  const th = w.threat?.id, ta = th && s.a(th), to = w.threat?.to ? { x: w.threat.to[0], y: w.threat.to[1] } : w.kind === 'receive' ? h : s.ball;
  const cy = camYaw(g.cam), sc = g.sc, id = sc?.live ? g.idea?.() : sc?.skill;
  let lv = null; try { lv = g.levelOf?.(id) ?? null; } catch { /* */ }
  const c = g.cam, nz = x => x || null;
  L.ev('WIN', kv({ n: winN, tt: t.toFixed(2), scene: sceneN, kind: w.kind, R: f2(w.R), G: f2(w.G), jock: nz(w.jock && 1), lv, think: g.thinkTime?.() === 'normal' ? null : g.thinkTime?.(), first: nz(g.firstRound && 1), retry: nz(g.timeouts), streak: nz(g.toStreak),
    showing: nz(g.showing && 1), step: g.step, look: g.lookUp ? 'up' : null, early: nz(g.lookedEarly && 1), threat: th, threatD: ta && to ? f1(Math.hypot(ta.x - to.x, ta.y - to.y)) : null,
    heroV: f1(sp), run: deg(run), face: deg(face) === deg(run) ? null : deg(face), camYaw: deg(cy), camOff: deg(wrapR(cy - run)), cam: g.camMode === 'player' ? null : g.camMode }), t);
  L.ev('OPT', optLine(g, winN), t);
  // (where everyone is, to the centimetre, with speeds: for a scene from live play, which the replay starts from; a scene
  // made from its seed is made again exactly, and the track row written at this moment shows it)
  if (sc?.live || prev.how !== 'load') L.ev('AT', atLine(s, true, 0, 0), t);
}
// His tap (input.js choose), before it is acted on: what, when, how much ring was left, and where everyone was.
function chose(opt) {
  const g = game; if (!(g.canAct && g._choose)) return;
  if (g.sc !== prev.sc && g.sc) sceneLine(g.sc, 'play');
  const t = L.now(), w = g.win, s = g.sim, gt = w ? s.time - w.t0 : null;
  let r = '-'; try { r = g.rating(opt); } catch { /* */ }
  forceRow(); // (a track row at the very moment of the tap: where everyone was)
  L.ev('CHOOSE', kv({ n: curWin?.w === w ? curWin.n : winN, tt: t.toFixed(2), opt, sec: f2((g.realTime || 0) - (g.decideReal || 0)), u: w ? Math.round(gt / w.G * 1000) / 1000 : null, gt: w ? Math.round(gt * 1000) / 1000 : null, left: f2(g.ui?.timer?.left), rating: r, step: g.step,
    look: g.lookUp ? 'up' : 'down', peeked: g.peeked ? 1 : null }), t);
  L.hotOff(t); lastChose = opt;
}
let lastChose = null; // (his choice's play is not logged again as PLAY)

// ---------- once a frame: what changed, and the rows ----------
const prev = { sc: null, look: null, drag: false, sk: null, skPhase: null, skT: 0, kPhase: null, kRes: null, win: null, card: false, results: false };
let lastRow = -1e9, lastSim = null, lastSimT = 0, lastT = 0;
function poll(g, K, kOn) {
  if (g.win !== prev.win) { if (!g.win && prev.win && curWin?.w === prev.win) L.hotOff(); prev.win = g.win; }
  if (!kOn && g.mode !== 'home') {
    if (g.sc !== prev.sc && g.sc) sceneLine(g.sc, 'play');
    if (!!g.lookUp !== prev.look) { prev.look = !!g.lookUp; if (g.phase !== 'idle' && (g.lookUp || g.phase !== 'pre')) L.ev('LOOK', kv({ to: g.lookUp ? 'up' : 'down', in: g.phase, sec: g.win ? f2((g.realTime || 0) - (g.decideReal || 0)) : null })); }
    if (!!g.drag !== prev.drag) { prev.drag = !!g.drag; L.ev('DRAG', kv({ to: g.drag ? 'start' : 'end', yaw: deg(g.yaw) })); }
  }
  const sk = g.sk, ph = sk?.phase || null;
  if (sk !== prev.sk || ph !== prev.skPhase) {
    const t = L.now();
    if (ph === 'offer' && (sk !== prev.sk || prev.skPhase !== 'offer')) { L.ev('SKILL', kv({ is: 'offer', kind: sk.kind, move: sk.k }), t); prev.skT = t; L.hotOn(t); }
    else if (ph === 'move' && prev.skPhase === 'offer') L.ev('SKILL', kv({ is: 'tapped', move: sk.k, after: f2(t - prev.skT) }), t);
    else if ((ph === 'out' || !sk) && prev.skPhase === 'offer') { L.ev('SKILL', kv({ is: 'missed', move: prev.sk?.k, shown: f2(t - prev.skT) }), t); L.hotOff(t); }
    else if ((ph === 'out' || !sk) && prev.skPhase === 'move') { L.ev('SKILL', kv({ is: 'done', move: prev.sk?.k }), t); L.hotOff(t); }
    prev.sk = sk; prev.skPhase = ph;
  }
  if (K) {
    if (K.phase !== prev.kPhase) { if (K.phase === 'stand' || K.phase === 'dive') L.ev('KPH', K.phase); if (K.phase === 'stand') L.hotOn(); prev.kPhase = K.phase; } // (stand: he picks where to stand; dive: where to dive)
    if (K.result && K.result !== prev.kRes) { prev.kRes = K.result; const r = K.result; L.ev('KRES', kv({ res: r.res, spot: r.spot, tap: r.tap, sec: f2(r.sec), zone: r.spec?.zone, foot: r.spec?.foot, kind: r.spec?.kind })); L.hotOff(); }
  }
}
function onFrame(now) {
  if (!L.LOG.on) return;
  const g = game, K = keeper(), kOn = !!K?.on;
  try { poll(g, K, kOn); } catch (e) { if (!onFrame.err) { onFrame.err = 1; L.ev('ERR', kv({ in: 'poll', e: String(e?.message || e) })); } }
  if (!(kOn || (g.mode && g.mode !== 'home')) || now - lastRow < 290) return; // (about 3 rows a second; log.js keeps fewer away from choices)
  lastRow = now;
  const s = kOn ? K.sim : g.sim, cam = kOn ? K.cam : g.cam; if (!s?.agents?.size || !cam) return;
  const t = L.now(), o = L.rowAt(L.idsFor(s), t); if (o < 0) return;
  const R = L.ROWS, dt = t - lastT, pace = s === lastSim && dt > 0 ? (s.time - lastSimT) / dt : 1; lastSim = s; lastSimT = s.time; lastT = t;
  R[o + 1] = Math.max(0, Math.min(1.55, pace)); R[o + 2] = kOn ? 1 : g.look || 0; R[o + 3] = tunnelNow();
  const b = s.ball; R[o + 4] = b.x; R[o + 5] = b.y; R[o + 6] = b.z || 0; R[o + 7] = STC(b.state);
  const e = cam.eye, c = cam.tgt, hz = Math.hypot(c[0] - e[0], c[1] - e[1]);
  R[o + 8] = c[0]; R[o + 9] = c[1]; R[o + 10] = Math.atan2(c[1] - e[1], c[0] - e[0]); R[o + 11] = Math.atan2(e[2] - c[2], hz); R[o + 12] = Math.hypot(hz, e[2] - c[2]); R[o + 13] = world.camera?.fov || 40;
  let i = 0; for (const a of s.agents.values()) { if (i >= L.MAX_IDS) break; const q = o + L.HEAD + i * 3; R[q] = a.x; R[q + 1] = a.y; R[q + 2] = faceA(a); i++; }
}
// perf.js marks: the ones that say something about play become lines (the rest stay in the speed record).
const MARKS = { tap: 'TAP', phase: 'PH', step: 'STEP', mode: 'MODE', quality: 'QUAL', longtask: 'LONG' }; // (results: PLAYEND and OUT)
function onMark(label) {
  if (!L.LOG.on) return;
  const i = label.indexOf(' '), k = i < 0 ? label : label.slice(0, i), type = MARKS[k]; if (!type) return;
  const rest = i < 0 ? '' : label.slice(i + 1);
  if (type === 'TAP' && rest === 'logFlag') return; // (the flag's own line is FLAG)
  if (type === 'PH' && /^(pre|decide|outcome|keeper)>(pre|decide|outcome|keeper)$/.test(rest)) return; // (WIN, PLAY and the scenes say these)
  L.ev(type, kv({ x: rest }).slice(2));
}

// ---------- wrapping the game's methods (only while recording; nothing they return or do changes) ----------
function wrap(obj, name, before, after) {
  const f = obj?.[name]; if (typeof f !== 'function' || f.plogged) return;
  const w = function (...a) {
    let ctx; if (L.LOG.on && before) try { ctx = before.apply(this, a); } catch (e) { L.ev('ERR', kv({ in: name, e: String(e?.message || e) })); }
    const r = f.apply(this, a);
    if (L.LOG.on && after) { const done = x => { try { after.call(this, x, a, ctx); } catch (e) { L.ev('ERR', kv({ in: name, e: String(e?.message || e) })); } }; if (r && typeof r.then === 'function') r.then(done, () => {}); else done(r); }
    return r;
  };
  w.plogged = true; obj[name] = w;
}
let installed = false;
function install() {
  if (installed) return; installed = true;
  const g = game;
  wrap(g, 'load', () => { if (g.mode === 'match' || g.mode === 'free') forceRow(); }, (r, [sc]) => sceneLine(g.sc || sc, 'load'));
  wrap(g, 'openWindow', null, () => winOpen());
  wrap(g, 'choose', opt => chose(opt));
  wrap(g, 'outcome', (opt, good) => { if (!g.showing && g.mode !== 'demo' && lastChose === opt) return; L.ev('PLAY', kv({ opt, good: good ? 1 : 0, showing: g.showing ? 1 : null, mode: g.mode })); }, () => L.ev('PLAYEND', kv({ result: g.result })));
  wrap(g, 'say', text => { lastSay = String(text || ''); if (lastSay) L.ev('SAY', kv({ text: lastSay })); });
  wrap(g, 'round', null, r => L.ev('ROUND', kv({ is: 'end', firstTry: r?.firstTry ? 1 : 0, stars: r?.stars })));
  wrap(g, 'match', (ids, extra = [], toWin, mode) => L.ev('MATCH', kv({ is: 'start', mode, toWin, lessons: (ids || []).join(','), scenes: extra.length })), r => L.ev('MATCH', kv({ is: 'end', us: r?.us, them: r?.them })));
  wrap(g, 'demo', id => L.ev('DEMO', kv({ is: 'start', skill: id })), () => L.ev('DEMO', kv({ is: 'end' })));
  for (const k of ['lookAround', 'lookTo', 'tapAt', 'dragTo', 'showTaps', 'glanceAtGoal', 'showClock']) wrap(g, k, (...a) => L.ev('DSTEP', kv({ step: k, arg: typeof a[0] === 'string' || typeof a[0] === 'number' ? (typeof a[0] === 'number' ? f2(a[0]) : a[0]) : null })));
  wrap(g, 'skipDemo', () => L.ev('SKIP'));
  wrap(g, 'takeOver', id => { if (id !== 'hero') L.ev('HAND', kv({ to: id })); });
  wrap(g, 'keeperMoment', (spec, shooter) => L.ev('KEEPER', kv({ is: 'start', shooter, spec: spec ? JSON.stringify(spec).replace(/\|/g, '/') : null })), r => L.ev('KEEPER', kv({ is: 'end', res: r?.res })));
  wrap(g, 'home', () => { L.ev('HOME'); setTimeout(() => L.flush(true), 0); });
  // The two hooks in the game's files: flows.js playRounds ('rounds': the round list) and game/live.js match ('fresh': play
  // starts again from a new situation; the row before and the scene after show both pictures).
  g.plog = (kind, o = {}) => {
    if (!L.LOG.on) return;
    if (kind === 'fresh') { forceRow(); L.ev('FRESH', kv({ ...o, why: o.why || (o.after === 'goal' || o.after === 'goalAgainst' ? 'kick-off after a goal' : o.streak > 4 ? 'play went on 4 times without a goal' : 'he won it (no "Won it? Go!" yet)') })); } // (v82: o.why, a new situation brought in from play, game/live.js)
    else L.ev(String(kind).toUpperCase(), kv(o));
  };
  for (const k of ['banner', 'caption', 'toast', 'seen', 'pop']) wrap(hud, k, (...a) => {
    if (k === 'banner') { const [title, kind, rated] = a; L.ev('OUT', kv({ kind, title, stars: rated ? rated.stars : null, light: rated?.light ? 1 : null, tip: rated?.text || null })); setTimeout(flushSoon, 900); }
    else if (k === 'caption') { const s = String(a[0] || ''); if (s && s !== lastSay) L.ev('CAP', kv({ text: s })); }
    else if (k === 'pop') L.ev('POP', kv({ stars: a[0] }));
    else L.ev(k.toUpperCase(), kv({ text: a[0] }));
  });
  const K = keeper();
  if (K) {
    wrap(K, 'round', plan => L.ev('KROUND', kv({ is: 'start', shots: plan?.length, plan: (plan || []).map(p => `${p.kind}/${p.zone}/${p.foot}`).join(',') })), r => L.ev('KROUND', kv({ is: 'end', saves: (r || []).filter(x => x.res === 'save').length })));
    wrap(K, 'play', spec => L.ev('KSHOT', kv({ kind: spec?.kind, zone: spec?.zone, foot: spec?.foot, from: spec?.from ? `${f1(spec.from.x)},${f1(spec.from.u)}` : null, stand: f2(spec?.stand), dive: f2(spec?.dive), match: K.match ? 1 : null })));
    wrap(K, 'choose', opt => L.ev('KTAP', kv({ opt, phase: K.phase, sec: f2((K.real || 0) - (K.phase === 'dive' ? K.diveAt0 : K.tapAt0)) })));
  }
  // The cards and the results: what they say (titles, the score line), as they come up.
  try {
    const watch = (sel, key, type) => { const el = $(sel); if (!el) return; new MutationObserver(() => { const up = !el.classList.contains('hidden'); if (up !== prev[key]) { prev[key] = up; if (up && L.LOG.on) L.ev(type, kv({ text: (el.innerText || el.textContent).replace(/\s+/g, ' ').trim().slice(0, 160) })); } }).observe(el, { attributes: true, attributeFilter: ['class'] }); };
    watch('#card', 'card', 'CARD'); watch('#results', 'results', 'RESULTS');
  } catch { /* no observer: the cards are not logged */ }
}
// A row now, whatever the last one was (the moment before and after the game resets a match's play).
function forceRow() { lastRow = -1e9; try { onFrame(performance.now()); } catch { /* */ } }

// ---------- on and off ----------
export function setRecording(on) {
  document.body.classList.toggle('logon', !!on && !throwaway);
  if (throwaway) return;
  if (on && !L.LOG.on) {
    install(); L.begin(header); if (!perf.rec.on) perf.start(world.renderer);
    perf.hooks.mark = onMark; perf.hooks.frame = onFrame;
    Object.assign(prev, { sc: null, look: null, drag: false, sk: null, skPhase: null, kPhase: null, kRes: null, win: null });
    L.flush(true);
  } else if (!on && L.LOG.on) {
    L.ev('STOP'); savePerf(); L.end(); perf.hooks.mark = perf.hooks.frame = null;
  }
}
// Written out at a quiet moment (a result's card), at most every 20 seconds while he plays; always at home and on hiding.
function flushSoon() { const t = L.now(); if (t - lastFlush < 20) return; lastFlush = t; L.flush(); }
const savePerf = () => { try { L.setPerf(perf.summary()); } catch { /* */ } };
// Written out when the app goes to the background or is closed (a home-screen app is often killed from there).
if (typeof addEventListener === 'function') {
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && L.LOG.on) { L.ev('HIDDEN'); savePerf(); L.flush(true); } else if (L.LOG.on) L.ev('SHOWN'); });
  addEventListener('pagehide', () => { if (L.LOG.on) { savePerf(); L.flush(true); } });
}

// (v79) The pause (js/pause.js): a row of where everyone is, then why it paused; on resume, how long it was.
onPause((on, why, sec) => { if (!L.LOG.on) return; if (on) { forceRow(); const K = keeper(); L.ev('PAUSE', kv({ why, mode: K?.on ? 'keeper' : game.mode, phase: K?.on ? K.phase : game.phase, step: game.step })); } else L.ev('RESUME', kv({ sec: f1(sec) })); });

// ---------- the flag, Copy log and Clear ----------
const flagBtn = $('#logFlag');
let flagTimer = 0;
flagBtn?.addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation();
  if (!L.LOG.on) return;
  const n = L.flag(); forceRow();
  flagBtn.dataset.n = n; flagBtn.classList.add('hit'); clearTimeout(flagTimer); flagTimer = setTimeout(() => flagBtn.classList.remove('hit'), 1400);
});
// The text to copy (the speed record's summary for this session goes in at the end).
export function logText() { savePerf(); return L.text(); }
async function copyText(btn, label) {
  const t = logText(), kb = Math.max(1, Math.round(t.length / 1000));
  let ok = false;
  try { await navigator.clipboard.writeText(t); ok = true; } catch { /* no clipboard: the box below */ }
  if (!ok) { openBox(t, `The log (${kb} KB): select all of it and copy it.`); return; }
  btn.textContent = `✓ Log copied (${kb} KB)`; setTimeout(() => { btn.textContent = label; }, 2600);
}
function openBox(t, note) {
  const sheet = $('#logSheet'), box = $('#logText'); if (!sheet || !box) return;
  $('#logNote').textContent = note; box.value = t; sheet.classList.remove('hidden');
  try { box.focus(); box.setSelectionRange(0, t.length); } catch { try { box.select(); } catch { /* the grown-up selects it */ } }
}
function clearLog(btn, label) {
  if (!confirm('Clear the play log? It cannot be brought back.')) return;
  const on = L.LOG.on; L.clear(); if (on) { L.begin(header); L.ev('CLEARED'); L.flush(true); }
  btn.textContent = 'Cleared'; setTimeout(() => { btn.textContent = label; }, 1800);
}
$('#logCopy')?.addEventListener('click', e => copyText(e.currentTarget, '📋 Copy log'));
$('#logClear')?.addEventListener('click', e => clearLog(e.currentTarget, 'Clear'));
$('#logDone')?.addEventListener('click', () => $('#logSheet').classList.add('hidden'));
$('#logSelect')?.addEventListener('click', () => { const b = $('#logText'); try { b.focus(); b.setSelectionRange(0, b.value.length); } catch { b.select(); } });
// The grown-ups menu: "Show the log" and Copy (the speed record's buttons, now for the whole log) and Clear log.
const box = $('#recBox');
if ($('#recShow') && box) {
  $('#recShow').onclick = () => { box.value = L.LOG.on ? logText() : 'Turn "Record play" on, play for a while, then come back here (or use Copy log on the home screen).'; box.hidden = false; $('#recCopy').hidden = false; };
  $('#recCopy').onclick = async () => { let ok = false; try { await navigator.clipboard.writeText(box.value); ok = true; } catch { /* */ } if (!ok) { box.focus(); box.select(); try { ok = document.execCommand('copy'); } catch { /* */ } } $('#recCopy').textContent = ok ? 'Copied' : 'Select the text and copy it'; };
}
$('#logClearM')?.addEventListener('click', e => clearLog(e.currentTarget, 'Clear log'));
$('#recChk')?.addEventListener('change', () => setRecording($('#recChk').checked));
setRecording(recording());
if (typeof window !== 'undefined') window.__log = { text: logText, flag: () => L.flag(), on: () => L.LOG.on, size: L.size }; // (for the console and the test tools, as window.__game)
