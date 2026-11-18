// The play log ("Record play" in the grown-ups menu; js/ui/playlog.js feeds it from the game). It keeps what happened in
// play as plain text that a grown-up copies from the home screen and pastes into a chat, and that an engineer (or
// scripts/log-read.js) reads back: one short line per event, and the players, the ball and the camera packed into short
// "track" lines a few times a second. This file has no page code in it: the reader and the replay tools load it in Node.
//
// THE TEXT. Every line starts with "|", the seconds since that session started and a word for what it is:
//   |12.3 SAY text="Your turn!"            |12.3 CHOOSE n=4 opt=pass:1 sec=1.82 ...      |0.0 LOG s=3 v=... (a new session)
// Values are bare words or JSON strings (k="..."). A line that lost its line break, or picked up spaces, still reads:
// the reader finds the "|<seconds> <WORD>" that starts each one (parse()).
// TRACK LINES ("|12.3 T d hero,m1,m2,o1,o2,o3 <rows>") hold one row per moment, each ended by ".": the time step, the
// ball, every player (x, y, way he faces), the camera and the effects, in a 64-letter alphabet (base64url), as moves
// from the row before ("!" then the place itself when a move is too big). Kind: d around a choice (about 3 a second), f near a
// flag (all rows), i the rest (1 a second). Each line starts afresh, so any of them can be dropped.
// THE SIZE. Play is collected into arrays (the rows into one Float32Array) and turned into text only at a flush (scene
// ends, the home screen, the app going to the background, Copy). Rows are taken about 3 a second; the flush keeps 1 a
// second away from choices and flags. The stored log is held under 300 KB and the copy under 80 KB by thin(): idle track lines
// go first (oldest first), then choice track lines, then a choice's detail lines, then whole old sessions; never what is
// near a flag while anything else is left.
import { storage, throwaway, PLAY_LOG } from './storage.js';

export const CAP_STORE = 300000, CAP_COPY = 80000;
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', IDX = {};
for (let i = 0; i < 64; i++) IDX[A[i]] = i;
const c1 = v => A[v < 0 ? 0 : v > 63 ? 63 : v | 0];
const c2 = v => { v = v < 0 ? 0 : v > 4095 ? 4095 : v | 0; return A[v >> 6] + A[v & 63]; };
const TAU = Math.PI * 2;
const qx = v => Math.round(v * 10) + 200; // a place, in decimetres (-20 m to 389 m)
const ST = 'cflhx', stOf = s => (s === 'carried' ? 0 : s === 'flying' ? 1 : s === 'loose' ? 2 : s === 'held' ? 3 : 4);
export const BALL_STATE = { c: 'carried', f: 'flying', l: 'loose', h: 'held', x: '-' };

// ---------- the rows (one Float32Array; no objects made per row) ----------
// [t, pace, look, edge, ball x, y, z, state, camera target x, y, yaw, pitch, distance, fov, then x, y, facing per player]
export const HEAD = 14, MAX_IDS = 14, STRIDE = HEAD + MAX_IDS * 3, CAP_ROWS = 1600;
const rows = new Float32Array(CAP_ROWS * STRIDE), rowIds = new Uint16Array(CAP_ROWS);
let nRows = 0, idsList = [], idsAt = -1;

export const LOG = { on: false, loaded: false };
let T0 = 0, lines = [], events = [], seq = 0, flags = [], hot = [], session = 0, flagN = 0;
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
export const now = () => (clock() - T0) / 1000;
const ts = t => (t < 0 ? 0 : t).toFixed(1);
// A value for a line: a bare word, or a JSON string when it has spaces, quotes or the line mark in it.
export const v = x => { const s = String(x ?? '-').replace(/[\n\r|]/g, ' '); return /^[^\s"=]+$/.test(s) ? s : JSON.stringify(s); };
export const kv = o => Object.entries(o).filter(([, x]) => x !== undefined && x !== null && x !== '').map(([k, x]) => `${k}=${v(x)}`).join(' ');

// ---------- recording ----------
export function load() {
  if (LOG.loaded) return; LOG.loaded = true;
  let text = null; try { text = throwaway ? null : storage?.getItem(PLAY_LOG); } catch { /* blocked */ }
  lines = text ? text.split('\n').filter(Boolean) : [];
  session = lines.reduce((m, l) => { const r = /^\|0\.0 LOG s=(\d+)/.exec(l); return r ? Math.max(m, +r[1]) : m; }, 0);
}
// A new session: its clock starts at 0, and its header lines come first.
export function begin(header) {
  load(); T0 = clock(); session++; flags = []; hot = []; flagN = 0; nRows = 0; idsAt = -1; idsList = []; events = []; seq = 0;
  for (const h of header(session)) events.push([0, seq++, '|0.0 ' + h]);
  LOG.on = true;
}
export function end() { if (!LOG.on) return; flush(true); LOG.on = false; }
// One event line now (or at `t`).
export function ev(type, text = '', t = now()) { if (!LOG.on) return; events.push([t, seq++, `|${ts(t)} ${type}${text ? ' ' + text : ''}`]); }
export function flag() { const t = now(); flags.push(t); ev('FLAG', `n=${++flagN}`, t); return flagN; }
// Moments kept 4 a second: a choice from just before it opens to a little after it is made, a keeper's shot, a skill move.
export function hotOn(t = now()) { const last = hot[hot.length - 1]; if (last && last[1] === Infinity) return; hot.push([t, Infinity]); }
export function hotOff(t = now()) { const last = hot[hot.length - 1]; if (last && last[1] === Infinity) last[1] = t; }
// The players of the next rows (ids in order). Returns the list's number; a new list only when the players change.
export function idsFor(sim) {
  const cur = idsList[idsAt];
  if (cur && cur.length === sim.agents.size) { let i = 0, same = true; for (const id of sim.agents.keys()) if (cur[i++] !== id) { same = false; break; } if (same) return idsAt; }
  const ids = [...sim.agents.keys()].slice(0, MAX_IDS); idsList.push(ids); return (idsAt = idsList.length - 1);
}
// Where the next row goes (its first value index), or -1 when the buffer is full and cannot be flushed now.
export function rowAt(ids, t) {
  if (nRows >= CAP_ROWS) flush(false, 30); // (only after minutes without a flush: the oldest rows are written out)
  if (nRows >= CAP_ROWS) return -1;
  const o = nRows * STRIDE; rows[o] = t; rowIds[nRows] = ids; nRows++; return o;
}
export const ROWS = rows;

// ---------- the flush: rows and events to text, then to storage ----------
const near = (t, list, before, after) => list.some(f => t >= f - before && t <= f + after);
// Rows come about 3 a second (playlog.js); all are kept while a choice is open and for the first second of its play,
// every other one just before it opens and on to 2.5 s into its play, 1 a second the rest of the time.
const inHot = t => hot.some(([a, b]) => t >= a - .4 && t <= b + 1), warm = t => hot.some(([a, b]) => t >= a - 1.2 && t <= b + 2.5);
// Rows older than `keep` seconds (all when final) become track lines; events of that time join them, in order.
export function flush(final = false, keep = 12) {
  if (!LOG.loaded) return;
  const cut = final ? Infinity : now() - keep, out = [];
  let k = 0; while (k < nRows && rows[k * STRIDE] < cut) k++;
  if (k) encode(0, k, out);
  if (k) { rows.copyWithin(0, k * STRIDE, nRows * STRIDE); rowIds.copyWithin(0, k, nRows); nRows -= k; }
  const old = events.filter(e => e[0] < cut); events = events.filter(e => e[0] >= cut);
  const all = [...old, ...out].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const e of all) lines.push(e[2]);
  if (final || all.length) persist();
}
let perfLines = [];
export function setPerf(list) { perfLines = list.map(l => `|${ts(now())} PERF ${l.replace(/[\n|]/g, ' ')}`); }
function persist() {
  if (throwaway) return;
  lines = thin(lines, CAP_STORE - perfLines.reduce((n, l) => n + l.length + 1, 0));
  try { storage?.setItem(PLAY_LOG, lines.concat(perfLines).join('\n')); } catch { try { lines = thin(lines, CAP_STORE / 2); storage?.setItem(PLAY_LOG, lines.concat(perfLines).join('\n')); } catch { /* full: kept for this visit */ } }
}
// The text to copy: everything so far, under CAP_COPY.
export function text(cap = CAP_COPY) { flush(true); return thin(lines.concat(perfLines), cap).join('\n'); }
export function clear() {
  lines = []; events = []; perfLines = []; nRows = 0; flags = []; hot = []; flagN = 0;
  if (!throwaway) try { storage?.removeItem(PLAY_LOG); } catch { /* blocked */ }
}
export const size = () => lines.reduce((n, l) => n + l.length + 1, 0);

// Rows [a, b) to track lines (pushed as [t, seq, line] into `out`). A line breaks where the players change, where the
// kind changes (around a choice, near a flag, the rest), after a gap, and every 60 rows.
function encode(a, b, out) {
  let seg = null, lastKept = -1e9;
  const close = () => { if (seg?.n) out.push([seg.t0, seq++, `|${seg.hdr.toFixed(1)} T ${seg.kind} ${idsList[seg.ids].join(',')} ${seg.s}`]); seg = null; };
  for (let r = a; r < b; r++) {
    const o = r * STRIDE, t = rows[o], kind = near(t, flags, 10, 5) ? 'f' : warm(t) ? 'd' : 'i';
    if (kind === 'i' && t - lastKept < .85) continue;
    if (kind === 'd' && !inHot(t) && t - lastKept < .55) continue;
    if (!seg || seg.ids !== rowIds[r] || seg.kind !== kind || t - seg.t > 3.1 || seg.n >= 60) { close(); seg = { t0: t, hdr: Math.floor(Math.max(0, t) * 10) / 10, t, ids: rowIds[r], kind, n: 0, s: '', p: new Int32Array(2 + 2 + MAX_IDS * 2), q: [] }; }
    seg.s += row(o, seg, idsList[rowIds[r]].length); seg.t = t; seg.n++; lastKept = t;
  }
  close();
}
// A move from the row before, in decimetres: one letter for a step of up to 3 each way (a walk, or play in slow motion),
// two for up to 14, "~" and two for up to 31, else "!" and the place itself (four letters).
function xy(x, y, p, i, first) {
  const X = qx(x), Y = qx(y), dx = X - p[i], dy = Y - p[i + 1]; p[i] = X; p[i + 1] = Y;
  if (first || dx < -31 || dx > 32 || dy < -31 || dy > 32) return '!' + c2(X) + c2(Y);
  if (dx >= -3 && dx <= 3 && dy >= -3 && dy <= 3) return A[(dx + 3) * 7 + dy + 3];
  if (dx >= -14 && dx <= 14 && dy >= -14 && dy <= 14) { const k = (dx + 14) * 29 + dy + 14; return A[49 + (k >> 6)] + A[k & 63]; }
  return '~' + c1(dx + 31) + c1(dy + 31);
}
const ang = a => c1(Math.round((((a % TAU) + TAU) % TAU) / TAU * 64) % 64);
// A group of letters, or "=" when it is the same as in the row before.
const same = (s, p, k) => (p[k] === s ? '=' : (p[k] = s));
function row(o, seg, n) {
  const R = rows, first = seg.n === 0, p = seg.p, q3 = seg.q;
  if (first) q3.length = 0;
  // (the time step from the time as read back, so no error builds up; the first row's: from the line's own time, to 0.1 s)
  const dt = Math.max(0, Math.round((R[o] - (first ? seg.hdr : seg.tq)) / .05)); seg.tq = (first ? seg.hdr : seg.tq) + dt * .05;
  // (":" for the ball, a player or the camera with nothing changed since the row before; "*" for a whole row so)
  const still = (a, k) => (!first && a === 'Y' + q3[k] ? ':' : ((q3[k] = a.slice(1)), a));
  let s = '';
  s += still(xy(R[o + 4], R[o + 5], p, 0, first) + (same(c1(Math.round(R[o + 6] * 10)) + ST[R[o + 7] | 0], q3, 0) === '=' ? '=' : q3[0]), 3);
  for (let i = 0; i < n; i++) { const q = o + HEAD + i * 3; s += still(xy(R[q], R[q + 1], p, 4 + i * 2, first) + ang(R[q + 2]), 5 + i); }
  s += still(xy(R[o + 8], R[o + 9], p, 2, first) + ang(R[o + 10]) + same(c1(Math.round(R[o + 11] * 180 / Math.PI / 1.5)) + c1(Math.round(R[o + 12] * 2)) + c1(Math.round(R[o + 13] - 20)), q3, 1), 4);
  s += same(c1(Math.round(R[o + 1] * 40)) + c1(Math.round(R[o + 2] * 63)) + c1(Math.round(R[o + 3] * 63)), q3, 2);
  return c1(dt) + (/^:+=$/.test(s) ? '*' : s) + '.';
}

// ---------- reading (the reader, the replay, the tests) ----------
// Every line of a pasted log, as { s (session), t, type, rest, raw }. Lost line breaks and stray spaces are fine.
export function parse(textIn) {
  const out = [], re = /\|\s*(\d+)\s*\.\s*(\d)\s+([A-Z][A-Z0-9]*)(?![a-z0-9])/g, src = String(textIn);
  const marks = []; let m; while ((m = re.exec(src))) marks.push({ at: m.index, t: +(m[1] + '.' + m[2]), type: m[3], end: re.lastIndex });
  let s = 0;
  marks.forEach((k, i) => {
    // (a line break inside a line is a wrap from the paste: with a space on either side it was between words, else it
    // cut a word, which is joined again)
    const rest = src.slice(k.end, i + 1 < marks.length ? marks[i + 1].at : src.length).replace(/( *)\r?\n( *)/g, (m, a, b) => (a || b ? ' ' : '')).replace(/\s+/g, ' ').trim();
    if (k.type === 'LOG') s = +(/s=(\d+)/.exec(rest)?.[1] || s + 1);
    out.push({ s, t: k.t, type: k.type, rest, raw: `|${k.t.toFixed(1)} ${k.type} ${rest}` });
  });
  return out;
}
// The k=v values of a line (JSON strings unquoted).
export function fields(rest) {
  const o = {}, re = /([A-Za-z_][\w.]*)=("(?:[^"\\]|\\.)*"|\S+)/g; let m;
  while ((m = re.exec(rest))) { let x = m[2]; if (x[0] === '"') try { x = JSON.parse(x); } catch { x = x.slice(1, -1); } o[m[1]] = x; }
  return o;
}
// A track line back to rows: { t, pace, look, edge, ball: { x, y, z, st }, cam: { x, y, yaw, pitch, dist, fov }, p: { id: { x, y, h } } }
// (angles in degrees). Spaces anywhere in the rows are dropped first.
export function track(rec) {
  // (kind: one small letter; the ids: small letters, digits and commas; the rows start at the first capital letter: the
  // first row's time step, then "!" and the ball's place)
  const all = rec.rest.replace(/\s+/g, ''), at = all.slice(1).search(/[A-Z]!/) + 1, kind = all[0], ids = all.slice(1, at > 0 ? at : all.length).split(','), s = at > 0 ? all.slice(at) : '', out = [];
  const p = new Int32Array(4 + ids.length * 2); let i = 0, t = rec.t;
  const one = () => IDX[s[i++]] ?? 0, two = () => one() * 64 + one();
  const pos = j => {
    const ch = s[i];
    if (ch === '!') { i++; p[j] = two(); p[j + 1] = two(); }
    else if (ch === '~') { i++; p[j] += one() - 31; p[j + 1] += one() - 31; }
    else { const a = one(); if (a < 49) { p[j] += Math.floor(a / 7) - 3; p[j + 1] += (a % 7) - 3; } else { const k = (a - 49) * 64 + one(); p[j] += Math.floor(k / 29) - 14; p[j + 1] += (k % 29) - 14; } }
    return { x: (p[j] - 200) / 10, y: (p[j + 1] - 200) / 10 };
  };
  const kept = []; const group = (k, n) => { if (s[i] === '=') { i++; return kept[k]; } const g = []; for (let j = 0; j < n; j++) g.push(one()); return (kept[k] = g); };
  let first = true;
  while (i < s.length) {
    const dt = one(); t += dt * .05;
    const last = out[out.length - 1];
    if (s[i] === '*' && last) { i++; if (s[i] !== '.') break; i++; out.push({ ...last, t: Math.round(t * 100) / 100 }); continue; }
    let b, zs;
    if (s[i] === ':' && last) { i++; b = { x: last.ball.x, y: last.ball.y }; zs = kept[0]; }
    else { b = pos(0); if (s[i] === '=') { i++; zs = kept[0]; } else { zs = [one() / 10, BALL_STATE[s[i++]] || '-']; kept[0] = zs; } }
    const P = {};
    for (let k = 0; k < ids.length; k++) { if (s[i] === ':' && last) { i++; P[ids[k]] = last.p[ids[k]]; continue; } const q = pos(4 + k * 2); P[ids[k]] = { x: q.x, y: q.y, h: one() / 64 * 360 }; }
    let cam;
    if (s[i] === ':' && last) { i++; cam = last.cam; }
    else { const c = pos(2), yaw = one() / 64 * 360, [pc, dc, fc] = group(1, 3); cam = { x: c.x, y: c.y, yaw, pitch: pc * 1.5, dist: dc / 2, fov: fc + 20 }; }
    const [pa, lo, ed] = group(2, 3), z = zs?.[0] ?? 0, st = zs?.[1] ?? '-';
    const pace = pa / 40, look = lo / 63, edge = ed / 63;
    if (s[i] !== '.') break; // (a row cut short: the rest of the line is lost)
    i++; first = false;
    out.push({ t: Math.round(t * 100) / 100, pace, look, edge, ball: { ...b, z, st }, cam, p: P });
  }
  return { kind, ids, rows: out };
}

// ---------- thinning ----------
const isTrack = l => / T [dfi] /.test(l.slice(0, 24));
const DETAIL = new Set(['OPT', 'AT', 'ATT', 'CAM', 'SC', 'KSPEC']);
// Lines dropped, oldest first, until the text fits in `cap` (characters): idle track lines, choice track lines, the
// detail lines of a choice, whole old sessions, then anything. Lines near a flag (10 s before, 5 s after) go last. A
// line at the top says what was dropped.
export function thin(list, cap) {
  let total = list.reduce((n, l) => n + l.length + 1, 0);
  if (total <= cap) return list;
  const info = list.map(l => { const m = /^\|(\d+\.\d) ([A-Z][A-Z0-9]*)/.exec(l); return { t: m ? +m[1] : 0, type: m ? m[2] : '', kind: isTrack(l) ? l[l.indexOf(' T ') + 3] : '' }; });
  let s = 0; const sess = info.map(x => (x.type === 'LOG' ? ++s : s)), flagsAt = {};
  info.forEach((x, i) => { if (x.type === 'FLAG') (flagsAt[sess[i]] ||= []).push(x.t); });
  const flagged = i => near(info[i].t, flagsAt[sess[i]] || [], 10, 5);
  const keep = list.map(() => true), dropped = {};
  const pass = (name, test) => { for (let i = 0; i < list.length && total > cap; i++) if (keep[i] && test(i)) { keep[i] = false; total -= list[i].length + 1; dropped[name] = (dropped[name] || 0) + 1; } };
  pass('idle track lines', i => info[i].kind === 'i' && !flagged(i));
  pass('choice track lines', i => info[i].kind === 'd' && !flagged(i));
  pass('detail lines', i => DETAIL.has(info[i].type) && !flagged(i));
  const last = s;
  pass('lines of older sessions', i => sess[i] < last && info[i].type !== 'LOG');
  pass('older lines', i => info[i].type !== 'LOG' && info[i].type !== 'THIN');
  const note = `|0.0 THIN ${kv({ cap: Math.round(cap / 1000) + 'KB', dropped: Object.entries(dropped).map(([k, n]) => `${n} ${k}`).join(', ') })}`;
  return [note, ...list.filter((l, i) => keep[i] && !l.startsWith('|0.0 THIN '))];
}

// ---------- the decisions in a log (the reader and the replay) ----------
// The decisions of a log, in order: { n, s (session), t, ...the WIN fields, opts (OPT: options()), at (AT: places() at
// the open), choose (CHOOSE fields), play (PLAY), out (the result's words, OUT), scene (SCENE fields, with sc: the scene
// itself when it cannot be made again from its seed) }.
export function decisions(recs) {
  const list = [], scenes = {}; let cur = null, last = null, ids;
  for (const r of recs) {
    if (r.type === 'T') { const m = /^\s*[a-z]\s*([a-z0-9,]+)/.exec(r.rest); if (m) ids = m[1].split(','); }
    if (r.type === 'SCENE') { const f = fields(r.rest); cur = scenes[r.s + ':' + f.n] = { ...f, s: r.s, t: r.t }; }
    else if (r.type === 'SC' && cur) { try { cur.sc = JSON.parse(r.rest); } catch { cur.scBad = true; } }
    else if (r.type === 'WIN') { last = { ...fields(r.rest), s: r.s, t: r.t }; last.n = +last.n; last.scene = cur; list.push(last); }
    else if (!last || last.s !== r.s) continue;
    else if (r.type === 'OPT') last.opts = options(r.rest, ids);
    else if (r.type === 'AT' && !last.at) last.at = places(r.rest);
    else if (r.type === 'CHOOSE' && !last.choose && +fields(r.rest).n === last.n) last.choose = { ...fields(r.rest), t: r.t };
    else if (r.type === 'PLAY' && !last.play) last.play = { ...fields(r.rest), t: r.t };
    else if (r.type === 'OUT' && (last.play || last.choose) && !last.out) last.out = { ...fields(r.rest), t: r.t };
  }
  return list;
}
// "OPT n=4 best=pass:1 ok=drib:fl safe=… bad=… at=spot:in@12.3,5;…" to { list: [{ opt, rating, x?, y? }], shots }.
// bad=* (on the ball): every other choice of the usual offer is bad: a pass to each friend (ids: who plays), the 8
// dribbles, the 5 pushes with push=1, the shot with shoot=1.
const DRIBS = ['fwd', 'fl', 'left', 'bl', 'back', 'br', 'right', 'fr'], PUSHES = ['fwd', 'fl', 'fr', 'left', 'right'];
export function options(rest, ids = ['m1', 'm2']) {
  const f = fields(rest), at = {}, list = [], named = new Set();
  for (const tok of String(f.at || '').split(';')) { const m = /^(.+)@(-?[\d.]+),(-?[\d.]+)$/.exec(tok); if (m) at[m[1]] = { x: +m[2], y: +m[3] }; }
  for (const r of ['best', 'ok', 'safe', 'bad']) for (const o of String(f[r] || '').split(',').filter(Boolean)) if (o !== '*') { list.push({ opt: o, rating: r, ...at[o] }); named.add(o); }
  if (f.bad === '*') {
    const usual = [...ids.filter(id => /^m\d$/.test(id)).map(id => 'pass:' + (+id[1] - 1)), ...DRIBS.map(d => 'drib:' + d), ...(f.push === '1' ? PUSHES.map(d => 'push:' + d) : []), ...(f.shoot === '1' ? ['shoot'] : [])];
    for (const o of usual) if (!named.has(o)) list.push({ opt: o, rating: 'bad' });
  }
  return { list, shots: f.shots || null };
}
// "AT u=0 hero=12.31,8.12,90,0.5,3.1 …" to { u, ball, p: { id: { x, y, h, vx, vy } } }
export function places(rest) {
  const f = fields(rest), out = { u: +f.u || 0, gt: +f.gt || 0, p: {} };
  for (const [k, x] of Object.entries(f)) {
    const n = String(x).split(',');
    if (k === 'ball') out.ball = { x: +n[0], y: +n[1], z: +n[2], st: n[3], carrier: n[4] && n[4] !== '-' ? n[4] : null };
    else if (k !== 'u' && k !== 'gt' && n.length >= 2 && !isNaN(+n[0])) out.p[k] = { x: +n[0], y: +n[1], h: n[2] != null ? +n[2] : null, vx: +(n[3] || 0), vy: +(n[4] || 0) };
  }
  return out;
}

// ---------- replaying a logged decision (dev/review.js in the page, scripts/log-replay.js in Node) ----------
// The scene of a decision, made again. A scene loaded from its list (a lesson's rounds, a match's fresh situations, a
// demo) is made again from its lesson, pattern and seed, and checked against where the log has his player: the same
// scene, exactly. A scene made from live play (a match going on, a give-and-go's second step) is taken as the log wrote
// it, and the window then starts from the players as the log has them (placeFrom): close, not exact.
// deps: { generate, demoFor, runsAt } (js/generate.js, js/skills.js). Returns { sc, how: 'seed' | 'snapshot' } or null.
export function sceneFor(d, { generate, demoFor, runsAt }) {
  const f = d.scene || {}, hero = f.hero ? String(f.hero).split(',').map(Number) : null;
  const fits = sc => !!sc && sc.id === f.id && (!hero || Math.hypot(sc.heroTo[0] - hero[0], sc.heroTo[1] - hero[1]) < .02);
  if ((!f.how || f.how === 'load') && /^gen-/.test(f.id || '') && f.skill) {
    if (f.mode === 'demo') { try { const sc = demoFor(f.skill); if (fits(sc)) return { sc, how: 'seed' }; } catch { /* */ } }
    for (const runs of [...new Set([runsAt(+f.lv || 1), 3, 4])]) { try { const sc = generate(f.skill, +f.seed, { pattern: f.pattern, runs }); if (fits(sc)) return { sc, how: 'seed', runs }; } catch { /* */ } }
  }
  if (f.sc) { // (the grades from the OPT line: best, ok, safe; a dribble or a shot graded as the game graded it)
    const sc = { ...f.sc }, by = r => (d.opts?.list || []).filter(o => o.rating === r).map(o => o.opt);
    sc.oppsTo ||= sc.opps; sc.heroTo ||= sc.hero; sc.best = by('best')[0] || null; sc.ok = by('ok'); sc.safe = by('safe');
    sc.grades = Object.fromEntries((d.opts?.list || []).map(o => [o.opt, o.rating === 'bad' ? 'bad' : o.rating === 'safe' ? 'safe' : 'good']));
    return { sc, how: 'snapshot' };
  }
  return null;
}
const STATE = { c: 'carried', f: 'flying', l: 'loose', h: 'held' };
// Everyone where the log has them as the window opened (AT): place, facing, and moving as they were (a steady run, so the
// window's plan sees the same speeds).
export function placeFrom(g, at) {
  const s = g.sim;
  for (const [id, p] of Object.entries(at?.p || {})) {
    const a = s.a(id); if (!a) continue;
    const h = (p.h || 0) * Math.PI / 180, x0 = p.x, y0 = p.y, vx = p.vx || 0, vy = p.vy || 0;
    Object.assign(a, { x: x0, y: y0, tx: x0, ty: y0, px: x0, py: y0, lv: [vx, vy], face: [Math.cos(h), Math.sin(h)] });
    a.track = { at: t => ({ x: x0 + vx * t, y: y0 + vy * t, vx, vy }), t0: s.time, watch: false };
  }
  const b = at?.ball;
  if (b) Object.assign(s.ball, { x: b.x, y: b.y, z: b.z || 0, state: STATE[b.st] || s.ball.state, carrier: b.st === 'c' ? b.carrier : null, move: null });
}
// The largest distance (m) between where the game has everyone now and a logged picture ({ p: { id: { x, y } }, ball }),
// who it is, and his own player's.
export function gap(g, pic) {
  let worst = 0, who = null, hero = null;
  for (const [id, p] of Object.entries(pic?.p || {})) { const a = g.sim.a(id); if (!a) continue; const d = Math.hypot(a.x - p.x, a.y - p.y); if (id === 'hero') hero = d; if (d > worst) { worst = d; who = id; } }
  return { worst, who, hero };
}
// The track row nearest to time t (within 0.08 s; WIN and CHOOSE carry their time to 0.01 s as tt=), as a picture for gap().
export function rowAtTime(recs, s, t) {
  let best = null;
  for (const r of recs) if (r.s === s && r.type === 'T' && r.t <= t + .1) for (const x of track(r).rows) if (Math.abs(x.t - t) < .08 && (!best || Math.abs(x.t - t) < Math.abs(best.t - t))) best = x;
  return best;
}
// A window from live play, made to go as the log has it: after the window opens (and its plan has set everyone's way),
// each player instead follows his logged track rows from the open to the tap (in game time: each row's pace times its
// real seconds, scaled so the tap lands at the logged game time). So the picture at the tap is the logged one (to the
// rows' 0.1 m) and the play after the tap starts from it. Returns the number of rows followed.
export function followRows(g, recs, d) {
  const s = g.sim, w = g.win, t0 = +d.tt || d.t, t1 = +d.choose?.tt || d.choose?.t, gt1 = +d.choose?.gt;
  if (!w || !Number.isFinite(t1) || !(gt1 > 0)) return 0;
  const rows = recs.filter(r => r.s === d.s && r.type === 'T' && r.t <= t1 + .1).flatMap(r => track(r).rows).filter(r => r.t >= t0 - .05 && r.t <= t1 + .05).sort((a, b) => a.t - b.t);
  if (rows.length < 2) return 0;
  const gts = [0]; for (let i = 1; i < rows.length; i++) gts.push(gts[i - 1] + (rows[i].t - rows[i - 1].t) * Math.max(.02, (rows[i].pace + rows[i - 1].pace) / 2));
  const k = gts[gts.length - 1] > 0 ? gt1 / gts[gts.length - 1] : 1; for (let i = 0; i < gts.length; i++) gts[i] *= k;
  for (const a of s.agents.values()) {
    if (!rows[0].p[a.id]) continue;
    const pts = rows.map((r, i) => [gts[i], r.p[a.id].x, r.p[a.id].y]), watch = !!a.track?.watch;
    const at = t => { let i = 1; while (i < pts.length - 1 && pts[i][0] < t) i++; const [ta, xa, ya] = pts[i - 1], [tb, xb, yb] = pts[i], u = tb > ta ? Math.max(0, Math.min(1, (t - ta) / (tb - ta))) : 1, dt = tb - ta || 1;
      return { x: xa + (xb - xa) * u, y: ya + (yb - ya) * u, vx: (xb - xa) / dt, vy: (yb - ya) / dt }; };
    a.track = { at, t0: w.t0, watch };
  }
  return rows.length;
}
