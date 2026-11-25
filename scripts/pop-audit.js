// The mini games' frame audit (v93, npm run audit:pop): each mini game is started and played for a while in a silent
// headless Chrome with the CPU slowed down (as a phone), and every frame is timed with what happened just before it
// (the speed recorder, js/perf.js). It fails when
//   result  a frame at a result (the big words, the stars, the flash) takes longer than RESULT_MS,
//   start   a frame in the first START_S seconds after the game's tile is tapped takes longer than START_MS,
//   kick    a frame just after a tap that starts a kick or shot sound takes longer than KICK_MS,
//   decode  more than one voice clip finishes decoding between two frames (a burst),
//   fetch   a voice clip is fetched or decoded once play is under way (after the game's start-up warm),
//   nodes   the shared result path (js/ui/hud.js: banner, pop, flash, stars) makes or drops a page node.
// Why these limits: on the owner's iPhone (v92 play log) steady play is 60 a second and the freezes were 150 to 400 ms,
// each at one of these moments. Here, slowed RATE times, a frame of ordinary play takes about 17 to 35 ms; a moment that
// does no more than ordinary play stays under 3 frames (50 ms). What this cannot see is the phone's own painting and
// graphics chip (Chrome paints in other threads and draws the 3D picture in software): those are judged by what is
// painted (no new layer bigger than the screen's tenth at a result), not by time.
//
// Silence (the owner works next to this machine): Chrome runs headless with --mute-audio and --disable-speech-api; before
// any page script, speechSynthesis's speak/cancel/pause/resume are no-ops and every <audio>'s play() is replaced by one
// that starts nothing (it reports itself as ended 0.9 s later, so a line that waits for its end goes on). The sound and
// voice logic itself runs (effects are made, clips fetched and decoded), so this also checks that.
//
//   node scripts/pop-audit.js [--games keeper,pens,...|none] [--live A,D|none] [--live-secs 45] [--rate 4] [--secs 20] [--v] [--dump dir]
//   (--secs 60 for the full voice check; the default plays 20 s of each game)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; }, flag = k => argv.includes('--' + k);
const GAMES = arg('games', 'keeper,pens,rondoKeep,rondoWin,attack,puzzles').split(',').filter(g => g && g !== 'none'), LIVE_IDS = arg('live', 'A,D').split(',').filter(v => v && v !== 'none'), RATE = +arg('rate', 4), SECS = +arg('secs', 20), V = flag('v');
export const LIMITS = { RESULT_MS: 50, START_MS: 50, KICK_MS: 50, START_S: 3, DECODE_PER_FRAME: 2, HUD_NODES: 0, RESULT_DECODES: 0, PLAYS_PER_FRAME: 2 };
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- the page's silence and its save (before any page script) ----------
export const PRE = `(() => {
  try { const s = window.speechSynthesis; if (s) { const no = () => {}; for (const k of ['speak', 'cancel', 'pause', 'resume']) { try { Object.defineProperty(s, k, { value: no, writable: false, configurable: false }); } catch { try { s[k] = no; } catch {} } } } } catch {}
  try { if (window.SpeechSynthesis) SpeechSynthesis.prototype.speak = () => {}; } catch {}
  window.__plays = [];
  try { const M = HTMLMediaElement.prototype, st = (el, p, e) => { Object.defineProperty(el, 'paused', { value: p, configurable: true }); Object.defineProperty(el, 'ended', { value: e, configurable: true }); };
    Object.defineProperty(M, 'play', { configurable: false, writable: false, value: function () { this.muted = true; window.__plays.push(performance.now()); const el = this; st(el, false, false); clearTimeout(el.__end);
      if (!el.loop) el.__end = setTimeout(() => { st(el, true, true); try { el.dispatchEvent(new Event('ended')); } catch {} }, 900); return Promise.resolve(); } });
    Object.defineProperty(M, 'pause', { configurable: false, writable: false, value: function () { clearTimeout(this.__end); st(this, true, !!this.ended); } }); } catch {}
  window.__errs = []; { const ce = console.error.bind(console); console.error = (...a) => { window.__errs.push(a.map(x => String(x && x.stack || x)).join(' ').slice(0, 300)); ce(...a); }; addEventListener('error', e => window.__errs.push('error: ' + e.message)); addEventListener('unhandledrejection', e => window.__errs.push('rejection: ' + (e.reason && e.reason.stack || e.reason))); }
  const mini = {}; for (const k of ['keeper', 'pens', 'rondoKeep', 'rondoWin', 'attack', 'puzzles']) mini[k] = { best: 2, plays: 2, last: 1, day: -1, at: 0 };
  const live = new URLSearchParams(location.search).get('live'); // (v95: a Live match in variant ?live=A … D)
  try { localStorage.setItem('soccer-iq:v1', JSON.stringify({ v: 1, openDay: -1, keeper: { best: 5, plays: 3, last: 4, day: 1, stickers: 0 }, mini,
    settings: { alwaysOpen: true, voice: true, sound: true, music: false, recorded: true, recordSpeed: true, rounds: 6, skill: null, size: '5v5', mode: live ? 'fast' : 'slow', ...(live ? { liveVariant: live } : {}) } })); } catch {}
  let s = 4242; Math.random = () => ((s = Math.imul(s ^ s >>> 15, 2246822507) + 0x6d2b79f5) >>> 0) / 4294967296;
})();`;

// ---------- a static server for the game's folder ----------
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', png: 'image/png', svg: 'image/svg+xml', m4a: 'audio/mp4', webmanifest: 'application/manifest+json' };
export function serve() {
  const srv = http.createServer((q, r) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(q.url, 'http://x').pathname)), f = p.endsWith('/') ? p + 'index.html' : p;
    if (!f.startsWith(ROOT) || !existsSync(f) || !statSync(f).isFile()) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': TYPES[f.split('.').pop()] || 'application/octet-stream', 'Cache-Control': 'no-store' }); r.end(readFileSync(f));
  });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res(srv)));
}

// ---------- a small DevTools client ----------
export async function browser() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pop-audit-'));
  const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', '--disable-speech-api', `--user-data-dir=${dir}`, '--no-first-run', '--hide-scrollbars', '--window-size=932,430',
    '--remote-debugging-port=0', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  let port; for (let i = 0; i < 150 && !port; i++) { await sleep(100); const f = path.join(dir, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]; }
  if (!port) { chrome.kill(); throw new Error('Chrome did not start'); }
  const get = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, r => { let s = ''; r.on('data', d => { s += d; }); r.on('end', () => res(JSON.parse(s))); }).on('error', rej));
  const page = (await get('/json/list')).find(t => t.type === 'page'), u = new URL(page.webSocketDebuggerUrl);
  const sock = await new Promise((res, rej) => { const q = http.request({ host: u.hostname, port: u.port, path: u.pathname, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64') } }); q.on('upgrade', (r, s) => res(s)); q.on('error', rej); q.end(); });
  let buf = Buffer.alloc(0), id = 0, frag = []; const pending = new Map(), waiters = [], subs = [];
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 15; let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + len) return;
      const pl = buf.subarray(off, off + len); buf = buf.subarray(off + len);
      if (op === 1 || op === 0) { frag.push(pl); if (fin) { const m = JSON.parse(Buffer.concat(frag).toString()); frag = [];
        if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
        else if (m.method) { for (const w of [...waiters]) if (w.method === m.method) { waiters.splice(waiters.indexOf(w), 1); w.res(m.params); } for (const s of subs) if (s[0] === m.method) s[1](m.params); } } }
    }
  });
  const send = (method, params = {}) => {
    const msg = Buffer.from(JSON.stringify({ id: ++id, method, params })), mask = crypto.randomBytes(4);
    let head; if (msg.length < 126) head = Buffer.from([0x81, 0x80 | msg.length]); else if (msg.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(msg.length, 2); } else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(msg.length), 2); }
    const body = Buffer.alloc(msg.length); for (let i = 0; i < msg.length; i++) body[i] = msg[i] ^ mask[i & 3];
    sock.write(Buffer.concat([head, mask, body])); return new Promise((res, rej) => pending.set(id, { res, rej }));
  };
  const once = method => new Promise(res => waiters.push({ method, res }));
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const close = async () => { try { await send('Browser.close'); } catch { /* gone */ } chrome.kill(); await sleep(300); try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ } };
  const on = (method, fn) => subs.push([method, fn]);
  return { send, once, on, ev, close, pid: chrome.pid };
}

// ---------- in the page: every frame and every mark (the speed recorder's hooks), DOM nodes in the shared HUD ----------
export const WATCH = `const perf = await import('/js/perf.js'); const T = window.__tl = { f: [], m: [], hudNodes: [] };
  perf.hooks.mark = l => T.m.push([performance.now(), l]);
  perf.hooks.frame = (t, ms, p) => T.f.push([t, ms, p ? +((p.draw || 0) + (p.strip || 0)).toFixed(1) : 0]);
  const own = ['banner', 'pop', 'flash', 'rate', 'burst'].map(id => document.getElementById(id)).filter(Boolean);
  new MutationObserver(l => { for (const r of l) if (r.type === 'childList' && (r.addedNodes.length || r.removedNodes.length) && own.some(o => o.contains(r.target) || o === r.target)) T.hudNodes.push([performance.now(), r.target.id || r.target.className || r.target.tagName, r.addedNodes.length + r.removedNodes.length]); })
    .observe(document.getElementById('hud'), { childList: true, subtree: true });
  return 1;`;

export async function tap(b, x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) await b.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
}
export async function tapEl(b, sel) {
  const r = await b.ev(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null;`);
  if (r) await tap(b, r[0], r[1]); return !!r;
}
const visible = (b, sel) => b.ev(`const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;`);

// Each game's result, as the game calls the shared helpers (js/game/goalie.js saved, js/mini/penalty.js, rondo-ui.js,
// attack-ui.js, puzzle-ui.js in v92): replayed twice in a game's play, so the check does not hang on a bot scoring.
export const RESULTS = {
  keeper: `sfx('tap'); hud.banner('SAVED!', 'goal'); say('Saved!'); hud.pop(3, () => [466, 190]);`,
  pens: `sfx('net'); hud.banner('GOAL!', 'goal'); say('Goal!'); hud.pop(3, () => [466, 190]);`,
  rondoKeep: `sfx('star', 1); hud.banner('KEPT IT!', 'good'); say('You kept it!');`,
  rondoWin: `sfx('click'); sfx('star', 2); hud.banner('GOT IT!', 'good'); say('Great steal!');`,
  attack: `hud.banner('GOAL!', 'goal'); sfx('goal'); say('Great pass!');`,
  puzzles: `hud.banner('GOAL!', 'goal'); sfx('net'); say('Goal!');`,
};
const TRACE = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing'];
async function replay(b, id, k) {
  const ev = []; let on = true; b.on('Tracing.dataCollected', p => { if (on) ev.push(...p.value); });
  await b.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: TRACE } }); await sleep(300);
  const t = await b.ev(`const { hud } = await import('/js/ui/hud.js'); const { sfx } = await import('/js/sound.js'); const { say } = await import('/js/ui/speech.js');
    const t = performance.now(); performance.mark('result${k}'); ${RESULTS[id]} return t;`);
  await sleep(1000); const done = b.once('Tracing.tracingComplete'); await b.send('Tracing.end'); await done; on = false;
  // what the page did in the 900 ms after it: images decoded, and the elements painted
  const mk = ev.find(e => e.name === 'result' + k), z = mk ? mk.ts + 900000 : 0, W = e => mk && e.ts >= mk.ts && e.ts < z;
  const decodes = ev.filter(e => W(e) && e.name === 'Decode Image' && e.ph === 'X'), paints = ev.filter(e => W(e) && e.name === 'Paint').map(e => (e.args?.data?.nodeName || '').replace(/ class=.*/, ''));
  return { t, decodes: decodes.length, decodeMs: decodes.reduce((a, e) => a + e.dur / 1000, 0), paints: [...new Set(paints)] };
}
const visibleNow = (b, sel) => visible(b, sel).catch(() => false);
// One game: started from its tile, played by a child-like player (taps on the field every 0.4 to 1.2 s; on STEAL now
// and then; through any card), for SECS seconds, with its result replayed twice along the way.
export async function playOne(b, base, id, secs) {
  const loaded = b.once('Page.loadEventFired'); await b.send('Page.navigate', { url: base + '?audit=pop' }); await loaded; await sleep(2500);
  await b.send('Emulation.setCPUThrottlingRate', { rate: RATE });
  await b.ev(WATCH);
  await tapEl(b, '#keeperBtn'); await sleep(1200); // (the first tap: sound unlocks here, as on the phone)
  const t0 = await b.ev(`return performance.now()`);
  await tapEl(b, `#minis .tile[data-id=${id}]`);
  for (let i = 0; i < 25 && await visibleNow(b, '#home'); i++) await sleep(200); // (its name is said first: the home screen is behind)
  let rnd = 7 + id.length, n = 0; const R = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const start = Date.now(), end = start + secs * 1000, syn = [], at = [.35, .7].map(x => start + Math.max(5000, secs * 1000 * x)); let kick = start + Math.max(6000, secs * 500);
  while (Date.now() < end) {
    await sleep(400 + R() * 800);
    if (await visibleNow(b, '#results')) break;
    if (await visibleNow(b, '#card')) { await tapEl(b, '#cardMain'); continue; }
    if (RESULTS[id] && at.length && Date.now() > at[0]) { at.shift(); syn.push(await replay(b, id, syn.length)); continue; }
    if (kick && Date.now() > kick) { kick = 0; // a tap that passes the ball (as a rondo pass: its star and the kick, js/mini/rondo-ui.js)
      await b.ev(`const { sfx } = await import('/js/sound.js'); addEventListener('pointerdown', () => { sfx('star', 1); sfx('kick'); }, { once: true, capture: true }); return 1;`); }
    if (id === 'rondoWin' && R() < .35 && await tapEl(b, '#rSteal')) continue;
    await tap(b, 150 + R() * 630, 110 + R() * 230); n++; // (the field, clear of the home and sound buttons in the corners)
  }
  await b.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const out = await b.ev(`const T = window.__tl; return { f: T.f, m: T.m, hudNodes: T.hudNodes, errs: window.__errs.slice(0, 8), plays: window.__plays }`);
  return { id, t0, taps: n, syn, ...out };
}

// The sound logic, silently (the players are stubs): five effects asked in one go start four players (the same one twice
// starts once), one a frame; a line said starts the voice player.
export async function soundCheck(b, base) {
  const loaded = b.once('Page.loadEventFired'); await b.send('Page.navigate', { url: base + '?audit=sound' }); await loaded; await sleep(2000);
  await tapEl(b, '#keeperBtn'); // (the first tap unlocks the sound)
  return b.ev(`const S = await import('/js/sound.js'), { say } = await import('/js/ui/speech.js'), P = window.__plays;
    for (let i = 0; i < 100 && !(S.audioPlayers()?.fx?.['star:1']?.src || '').startsWith('blob:'); i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 1500));
    const fr = []; let on = true; const loop = () => { fr.push(performance.now()); if (on) requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    const n0 = P.length; S.sfx('kick'); S.sfx('tap'); S.sfx('kick'); S.sfx('star', 0); S.sfx('star', 1);
    await new Promise(r => setTimeout(r, 700)); on = false;
    const ts = P.slice(n0); let most = 0; for (let i = 1; i < fr.length; i++) most = Math.max(most, ts.filter(x => x > fr[i - 1] && x <= fr[i]).length);
    const n1 = P.length; await Promise.race([say('Great pass!'), new Promise(r => setTimeout(r, 4000))]);
    return { effects: ts.length, perFrame: most, voice: P.length - n1, errs: window.__errs.slice(0, 4) };`);
}

// ---------- reading the record ----------
const marksIn = (m, a, b) => m.filter(x => x[0] > a && x[0] <= b).map(x => x[1]);
export function judge(r) {
  const { f, m, t0 } = r, L = LIMITS, out = { id: r.id, fails: [] };
  // a frame's time here leaves out the 3D picture's drawing (draw, timed by main.js), which Chrome does in software: the
  // phone draws it on its graphics chip in a few ms (its play log: "draw 1" to "draw 6" in the slowest frames)
  const worstIn = (a, b) => { let w = null; for (const [t, gap, d3] of f) { const ms = gap - (d3 || 0); if (t - gap >= a - 17 && t <= b && (!w || ms > w.ms)) w = { t, ms, gap, before: marksIn(m, t - gap - 300, t) }; } return w; };
  // start: the first START_S seconds after the tile
  // (a frame in which the game builds its 3D picture, shaders compiled or meshes made, is the game's own set-up: Chrome
  // compiles shaders in software here; it is told apart, not judged)
  const setup = w => w && w.before.some(x => /^(shader compiled|mesh made)/.test(x));
  { const all = []; for (const [t, gap, d3] of f) if (t - gap >= t0 - 17 && t <= t0 + L.START_S * 1000) all.push({ t, ms: gap - (d3 || 0), gap, before: marksIn(m, t - gap - 300, t) });
    out.start = all.filter(w => !setup(w)).sort((a, b) => b.ms - a.ms)[0] || null; out.setup = all.filter(setup).sort((a, b) => b.ms - a.ms)[0] || null; }
  // results: the replayed ones (and any the bot made: the big words, html show/hide …banner)
  const res = m.filter(x => /^html show\/hide .*banner/.test(x[1]) && x[0] > t0 + 500).map(x => x[0]), seen = [];
  for (const t of [...r.syn.map(x => x.t), ...res]) if (!seen.some(s => Math.abs(s - t) < 900)) seen.push(t);
  out.results = seen.map(t => worstIn(t - 20, t + 900));
  out.synDecodes = r.syn.reduce((a, x) => a + x.decodes, 0); out.synPaints = [...new Set(r.syn.flatMap(x => x.paints))];
  // sounds: players started between two frames (an effect and a line at most)
  let plays = 0; const P = (r.plays || []).filter(x => x > t0 + 1500); for (let i = 1; i < f.length; i++) { const k = P.filter(x => x > f[i - 1][0] && x <= f[i][0]).length; if (k > plays) plays = k; } out.playsMost = plays;
  // a tap that starts a kick or a shot sound
  const kicks = m.filter(x => /^sound (kick|shot)/.test(x[1]) && m.some(y => /^tap /.test(y[1]) && x[0] - y[0] >= 0 && x[0] - y[0] < 120));
  out.kicks = kicks.map(([t]) => worstIn(t - 120, t + 250));
  // clips: decoded between two frames (most in one gap), and fetched or decoded once play is under way (after the warm:
  // the start window and the first try's run-up)
  let most = 0, mostAt = []; for (let i = 1; i < f.length; i++) { const k = m.filter(x => x[0] > f[i - 1][0] && x[0] <= f[i][0] && /^voice-decoded/.test(x[1])); if (k.length > most) { most = k.length; mostAt = k.map(x => x[1]); } }
  out.decodeAt = mostAt;
  out.decodeMost = most;
  const playFrom = t0 + 8000; out.lateClips = m.filter(x => x[0] > playFrom && /^voice-(fetch|decoded)/.test(x[1])).map(x => x[1]);
  out.startClips = m.filter(x => x[0] <= playFrom && /^voice-fetch/.test(x[1])).length;
  out.hudNodes = r.hudNodes.filter(x => x[0] > t0).reduce((s, x) => s + x[2], 0);
  const max = list => list.filter(Boolean).reduce((a, w) => (!a || w.ms > a.ms ? w : a), null);
  out.resultWorst = max(out.results); out.kickWorst = max(out.kicks);
  if (out.start && out.start.ms > L.START_MS) out.fails.push(`start: a frame of ${out.start.ms.toFixed(0)} ms (limit ${L.START_MS})`);
  if (out.resultWorst && out.resultWorst.ms > L.RESULT_MS) out.fails.push(`result: a frame of ${out.resultWorst.ms.toFixed(0)} ms (limit ${L.RESULT_MS})`);
  if (out.kickWorst && out.kickWorst.ms > L.KICK_MS) out.fails.push(`kick: a frame of ${out.kickWorst.ms.toFixed(0)} ms (limit ${L.KICK_MS})`);
  if (most > L.DECODE_PER_FRAME) out.fails.push(`decode: ${most} clips decoded between two frames (limit ${L.DECODE_PER_FRAME}): ${mostAt.join('; ')}`);
  if (out.lateClips.length) out.fails.push(`fetch: ${out.lateClips.length} clip loads in play (${[...new Set(out.lateClips)].slice(0, 4).join('; ')})`);
  if (out.synDecodes > L.RESULT_DECODES) out.fails.push(`result: ${out.synDecodes} image(s) decoded as a result showed (limit ${L.RESULT_DECODES})`);
  const big = out.synPaints.filter(x => /id='flash'/.test(x)); if (big.length) out.fails.push(`result: the full-screen flash was painted (${big.join(', ')})`);
  if (plays > L.PLAYS_PER_FRAME) out.fails.push(`sound: ${plays} players started between two frames (limit ${L.PLAYS_PER_FRAME})`);
  if (out.hudNodes > L.HUD_NODES) out.fails.push(`nodes: ${out.hudNodes} nodes made or dropped by the result path`);
  // (v96, the puzzles in the 3D world) Nothing made in play: every mark, body, shader and page node is made before the
  // first puzzle shows (the start window). The mini bar's own score and best (run.js: its b and u text) are not the game's.
  if (r.id === 'puzzles') {
    out.made = m.filter(x => x[0] > t0 + L.START_S * 1000 && (/^(shader compiled|mesh made|texture made)/.test(x[1]) || (/^html nodes/.test(x[1]) && !/\((b|u|b,u|u,b)\)$/.test(x[1])))).map(x => x[1]);
    if (out.made.length) out.fails.push(`made: ${out.made.length} in play (${[...new Set(out.made)].slice(0, 4).join('; ')})`);
  }
  if (r.errs?.length) out.fails.push(`errors: ${r.errs.join(' | ').slice(0, 300)}`);
  const sorted = f.map(x => x[1]).filter(x => x > 0).sort((a, b) => a - b); out.usual = sorted[sorted.length >> 1] || 0;
  out.frames = f.length; out.marks = m.length;
  return out;
}

// ---------- a Live match (v95) ----------
// The owner's iPhone froze in Live (variant A, v94): 31 to 117 ms game steps as a decision moment or the scan cue began,
// 96 to 251 ms of page work as Live's own HUD changed and at a goal, and 200 to 228 ms waits as its 3D marks were first
// used (shaders compiled, meshes and textures made at the first SHOOT). A match is played in variant A and D (the big
// choices: arrows, a ring) by a child-like player tapping the field, with the moments that froze made to happen: the ball
// given to him (a decision moment), the scan cue, a SHOOT and its target, a goal. It fails on
//   made     a shader, mesh or texture made, or a page node made or dropped, after the kick-off (all of it is built and
//            warmed while he picks his player: fast.js pick),
//   layout   a layout read (offsetWidth, getBoundingClientRect, getComputedStyle) in the game step (fast.js tick): with the
//            page changed earlier in the frame, the phone lays it all out there and then (a 31 ms step at a cut-out pass),
//   game     a game step over LIVE.GAME_MS in the second after a decision moment starts (here, slowed 4 times, a usual
//            step is 1 to 3 ms; the phone's is 1 to 3 ms too: a step that needs a whole 60 Hz frame on its own is a freeze),
//   page     a frame's page work (style, layout, painting of the HTML: perf.js `page`) over RESULT_MS just after a goal, a
//            cue, a decision start or the first SHOOT.
export const LIVE = { VARIANTS: ['A', 'D'], SECS: +arg('live-secs', 45), GAME_MS: 16, PAGE_MS: LIMITS.RESULT_MS, AFTER_MS: 700, DEC_MS: 1000 };
export const LIVE_WATCH = `const perf = await import('/js/perf.js'); const T = window.__tl = { f: [], m: [], ev: [] };
  perf.hooks.mark = l => T.m.push([performance.now(), l]);
  let was = {}, inTick = false; T.reads = [];
  // (a layout read in the game step: with the page changed earlier in the frame, the phone must lay it out then and there)
  const F0 = window.__fast, tick = F0.tick.bind(F0); F0.tick = dt => { inTick = true; try { return tick(dt); } finally { inTick = false; } };
  for (const [P, k] of [[HTMLElement.prototype, 'offsetWidth'], [HTMLElement.prototype, 'offsetHeight'], [Element.prototype, 'clientWidth'], [Element.prototype, 'getBoundingClientRect'], [window, 'getComputedStyle']]) {
    const d = Object.getOwnPropertyDescriptor(P, k); if (!d) continue; const note = el => { if (inTick) T.reads.push([performance.now(), k + ' ' + (el?.id || el?.className || '')]); };
    if (d.get) Object.defineProperty(P, k, { ...d, get() { note(this); return d.get.call(this); } }); else if (typeof d.value === 'function') { const f = d.value; P[k] = function (...a) { note(P === window ? a[0] : this); return f.apply(this, a); }; } }
  perf.hooks.frame = (t, ms, p) => { const F = window.__fast;
    T.f.push([t, ms, p ? +((p.draw || 0) + (p.strip || 0)).toFixed(1) : 0, p ? +(p.game || 0).toFixed(2) : 0, p ? +(p.page || 0).toFixed(1) : 0, p ? +(p.wait || 0).toFixed(1) : 0]);
    const now = { start: !!F?.on, live: !!F?.on && !F.m?.dead, dec: !!F?.on && !!F.dec?.on, aim: !!F?.on && !!F.aiming, cue: !!F?.on && !!F.dom?.cue.classList.contains('show'), goal: F?.m ? F.m.score.us + F.m.score.them : 0 };
    for (const k in now) if (now[k] && now[k] !== was[k] && (k !== 'live' || !T.ev.some(e => e[1] === 'live'))) T.ev.push([t, k]); if (was.start && !now.start) T.ev.push([t, 'end']); was = now; };
  return 1;`;
// In the page: things that happen in a match by themselves, made to happen now, inside the game's own step (m.after).
const LIVE_DO = {
  ball: `const F = window.__fast, m = F.m; m.after(0, () => { if (!m.dead && m.owner() !== m.me && !m.flight && !F.aiming) m.giveTo(m.me, 'pass'); });`, // (a pass gets to him)
  cue: `const F = window.__fast; F.lastScan = F.real - 13; F.cueT = -99; F.stats.cues = 0;`, // (he has not looked round for a while)
  near: `const F = window.__fast, m = F.m, L = window.__fastL, W = window.__fastW; m.after(0, () => { if (m.dead) return; const a = F.sim.a(m.me); Object.assign(a, { x: L - 8, y: W / 2 - 1.5, tx: L - 8, ty: W / 2 - 1.5 }); for (const o of m.foes('us')) if (Math.hypot(o.x - a.x, o.y - a.y) < 4) Object.assign(o, { x: o.x - 5, tx: o.x - 5 }); m.giveTo(m.me, 'pass'); });`, // (in range of their goal with the ball)
  goal: `const m = window.__fast.m; m.after(0, () => { if (!m.dead) m.goal('us'); });`,
};
export async function playLive(b, base, variant, secs = LIVE.SECS) {
  const loaded = b.once('Page.loadEventFired'); await b.send('Page.navigate', { url: base + '?audit=pop&live=' + variant }); await loaded; await sleep(2500);
  await b.send('Emulation.setCPUThrottlingRate', { rate: RATE });
  await b.ev(LIVE_WATCH);
  await tapEl(b, '#playBtn'); // (the first tap: sound unlocks here)
  for (let i = 0; i < 30 && !await visibleNow(b, '#card'); i++) await sleep(200);
  await sleep(800); await tapEl(b, '#cardMain');
  for (let i = 0; i < 30 && !await visibleNow(b, '#fSheet'); i++) await sleep(200);
  await sleep(1200); await tapEl(b, '#fSheet .fPick');
  let rnd = 11 + variant.charCodeAt(0), n = 0; const R = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const start = Date.now(), end = start + secs * 1000, plan = [[.12, 'ball'], [.25, 'cue'], [.35, 'ball'], [.45, 'near'], [.62, 'goal'], [.75, 'cue'], [.85, 'ball']].map(([k, w]) => [start + k * secs * 1000, w]);
  let shoot = 0;
  while (Date.now() < end) {
    await sleep(400 + R() * 800);
    if (!await b.ev(`return !!window.__fast?.on`)) break;
    if (plan.length && Date.now() > plan[0][0]) { const w = plan.shift()[1]; await b.ev(LIVE_DO[w]); if (w === 'near') shoot = Date.now() + 1200; continue; }
    if (shoot && Date.now() > shoot) { // SHOOT, then a target
      const k = await b.ev(`return window.__fast.actionNow()`);
      if (k === 'shoot') { await tapEl(b, '#fAct'); await sleep(900); const q = await b.ev(`const F = window.__fast, a = (F.ui.aims || F.aimAll || [])[0]; return a ? window.__fastWorld.project(a.x, a.y, a.z) : null;`); if (q) await tap(b, q[0], q[1]); shoot = 0; continue; }
      if (Date.now() > shoot + 4000) { await b.ev(LIVE_DO.near); shoot = Date.now() + 1200; continue; }
    }
    if (R() < .15 && await tapEl(b, '#fAct.show')) continue;
    await tap(b, 150 + R() * 630, 110 + R() * 230); n++;
  }
  await b.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const out = await b.ev(`const T = window.__tl, F = window.__fast; return { f: T.f, m: T.m, ev: T.ev, reads: T.reads, errs: window.__errs.slice(0, 8), stats: F?.stats ? { decs: F.stats.decs, shots: F.stats.shots, cues: F.stats.cues } : null }`);
  return { id: 'live' + variant, taps: n, ...out };
}
export function judgeLive(r) {
  const { f, m, ev } = r, out = { id: r.id, fails: [] };
  const t0 = ev.find(e => e[1] === 'live')?.[0] ?? Infinity, t1 = ev.find(e => e[1] === 'end' && e[0] > t0)?.[0] ?? Infinity;
  const inPlay = x => x[0] > t0 && x[0] < t1;
  out.made = m.filter(x => inPlay(x) && /^(shader compiled|mesh made|texture made)/.test(x[1])).map(x => x[1]);
  out.nodes = m.filter(x => inPlay(x) && /^html nodes/.test(x[1])).map(x => x[1]);
  out.reads = (r.reads || []).filter(inPlay).map(x => x[1]);
  const after = (k, ms) => ev.filter(e => e[1] === k && inPlay(e)).map(([te]) => f.filter(x => x[0] > te && x[0] <= te + ms));
  const worst = (wins, i) => wins.flat().reduce((a, x) => (!a || x[i] > a[i] ? x : a), null);
  const dec = after('dec', LIVE.DEC_MS);
  out.decs = dec.length; out.decGame = worst(dec, 3)?.[3] ?? null;
  for (const k of ['goal', 'cue', 'dec', 'aim']) { const w = k === 'aim' ? after(k, LIVE.AFTER_MS).slice(0, 1) : after(k, LIVE.AFTER_MS); const p = worst(w, 4), fr = w.flat().reduce((a, x) => (!a || x[1] - x[2] > a[1] - a[2] ? x : a), null); out[k] = { n: w.length, page: p?.[4] ?? null, frame: fr ? +(fr[1] - fr[2]).toFixed(0) : null }; }
  const play = f.filter(inPlay), game = play.map(x => x[3]).sort((a, b) => a - b); out.gameUsual = game[game.length >> 1] || 0; out.gameMax = game[game.length - 1] || 0;
  if (out.made.length) out.fails.push(`made: ${out.made.length} in play (${[...new Set(out.made)].slice(0, 4).join('; ')})`);
  if (out.nodes.length) out.fails.push(`nodes: ${out.nodes.length} node changes in play (${[...new Set(out.nodes)].slice(0, 4).join('; ')})`);
  if (out.reads.length) out.fails.push(`layout: ${out.reads.length} layout reads in the game step (${[...new Set(out.reads)].slice(0, 4).join('; ')})`);
  if (out.decGame > LIVE.GAME_MS) out.fails.push(`game: a step of ${out.decGame} ms after a decision moment began (limit ${LIVE.GAME_MS})`);
  for (const k of ['goal', 'cue', 'dec', 'aim']) { if (!out[k].n) out.fails.push(`${k}: it never happened (the check saw nothing)`); else if (out[k].page > LIVE.PAGE_MS) out.fails.push(`${k}: page work of ${out[k].page} ms in a frame (limit ${LIVE.PAGE_MS})`); }
  if (r.errs?.length) out.fails.push(`errors: ${r.errs.join(' | ').slice(0, 300)}`);
  return out;
}

const fmt = w => (w ? `${w.ms.toFixed(0)} ms${V && w.before.length ? ' <- ' + [...new Set(w.before)].join('; ').slice(0, 160) : ''}` : '-');
export async function popAudit({ games = GAMES, secs = SECS, live = LIVE_IDS, log = console.log } = {}) {
  if (!CHROME) { log('pop-audit: no Chrome found (set CHROME=/path/to/chrome)'); return { fails: 1 }; }
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/index.html`, b = await browser();
  let fails = 0; const rows = [];
  try {
    await b.send('Page.enable'); await b.send('Runtime.enable');
    await b.send('Emulation.setDeviceMetricsOverride', { width: 932, height: 430, deviceScaleFactor: 3, mobile: false });
    await b.send('Page.addScriptToEvaluateOnNewDocument', { source: PRE });
    log(`pop audit: ${games.length} mini games, ${secs} s each, CPU ${RATE}x slower`);
    { const sc = await soundCheck(b, base), bad = [];
      if (sc.effects !== 4) bad.push(`${sc.effects} effects started (4 asked)`); if (sc.perFrame > 1) bad.push(`${sc.perFrame} effects in one frame`); if (sc.voice < 1) bad.push('a line said started no player'); if (sc.errs.length) bad.push(sc.errs.join(' | '));
      log(`  sound      effects asked 5 (one twice): started ${sc.effects}, at most ${sc.perFrame} a frame; a line said: ${sc.voice} player started`); for (const x of bad) log(`     FAIL sound: ${x}`); fails += bad.length; }
    for (const id of games) {
      const raw = await playOne(b, base, id, secs), r = judge(raw); rows.push(r); fails += r.fails.length;
      if (arg('dump')) writeFileSync(path.join(arg('dump'), id + '.json'), JSON.stringify(raw));
      log(`  ${id.padEnd(10)} usual ${r.usual.toFixed(0)} ms | start ${fmt(r.start)} (3D set-up ${r.setup ? r.setup.ms.toFixed(0) + ' ms' : '-'}) | result ${fmt(r.resultWorst)} (${r.results.length}) | kick ${fmt(r.kickWorst)} (${r.kicks.length}) | clips at start ${r.startClips}, most decoded in a frame ${r.decodeMost}, in play ${r.lateClips.length} | hud nodes ${r.hudNodes} | at results: images decoded ${r.synDecodes}, painted ${r.synPaints.join(' ').replace(/DIV id=|'/g, '') || '-'}, most players started in a frame ${r.playsMost}${r.made ? ` | made in play ${r.made.length}` : ''}`);
      for (const x of r.fails) log(`     FAIL ${x}`);
    }
    for (const v of live) {
      const raw = await playLive(b, base, v), r = judgeLive(raw); rows.push(r); fails += r.fails.length;
      if (arg('dump')) writeFileSync(path.join(arg('dump'), raw.id + '.json'), JSON.stringify(raw));
      const k = x => `${x.n ? `page ${x.page ?? '-'} ms, frame ${x.frame ?? '-'} ms` : 'none'}`;
      log(`  ${r.id.padEnd(10)} game usual ${r.gameUsual} ms, most ${r.gameMax} ms, at a decision start ${r.decGame ?? '-'} ms (${r.decs}) | goal ${k(r.goal)} | cue ${k(r.cue)} | decision ${k(r.dec)} | first SHOOT ${k(r.aim)} | made in play ${r.made.length}, nodes ${r.nodes.length}, layout reads in the game step ${r.reads.length}`);
      if (V) for (const x of [...new Set([...r.made, ...r.nodes, ...r.reads])]) log(`     (in play: ${x})`);
      for (const x of r.fails) log(`     FAIL ${x}`);
    }
  } finally { await b.close(); srv.close(); }
  log(fails ? `pop audit: ${fails} problem(s)` : 'pop audit: no problems');
  return { fails, rows };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { fails, rows } = await popAudit();
  if (flag('json')) console.log(JSON.stringify(rows.map(r => ({ ...r }))));
  process.exit(fails ? 1 : 0);
}
