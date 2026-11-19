// All the game's sound plays through ordinary audio players (<audio> elements), like a podcast. There is no live
// Web Audio at all: Safari sets the whole page's audio session to a tiny 128-frame buffer while any AudioContext
// exists, and over wireless CarPlay that made every sound, the recorded voice too, cut in and out about once a
// second (see research/carplay-audio.md). Web Audio is used only offline, to record sounds into WAV files:
//  - effects are synthesised once into short recordings, each with its own pre-unlocked player;
//  - the background tune is recorded once and looped;
//  - voice clips are decoded, trimmed and joined into one recording per line.
// One stream stays open the whole time (the tune, or a very quiet hush when the music is off), so the car never
// has to reopen its audio channel when a line or an effect starts.
// The browser only allows audio after a tap, so `unlock()` runs on the first touch.
// Marking the page as media playback (iOS 16.4+) makes everything play even with the silent switch on.
// Effects, music and voice each have their own volume; the mute-all switch turns off all three. iPhones ignore
// `volume` on audio players, so each volume is part of its recordings: a new volume means new recordings.
import { mark } from './perf.js';
export const SR = 48000; // every recording uses the phone's own output rate
const MUSIC_VOL = .05, HUSH_RMS = .001, LEAD = .15, vol = { sfx: 1, music: 1, voice: 1 };
let unlocked = false, enabled = true, musicOn = true, muted = false;
// (round 13) The speed test (dev/speed.html) sets this before anything can unlock: no player is ever made, so nothing can sound.
export const SILENT = { on: false };
const OAC = () => window.OfflineAudioContext || window.webkitOfflineAudioContext;

export function setSoundOn(on) { enabled = on; }
export function setMusicOn(on) { musicOn = on; playBed(); }
export function setMuted(m) { muted = m; if (muted) { stopVoice(); fxStop(); } playBed(); if (voiceEl) voiceEl.muted = muted; }
export function setVolumes(v) {
  Object.assign(vol, v);
  // The wait lets a slider settle before the sounds are recorded again.
  if (fxRaw.size && fxVol !== vol.sfx) { clearTimeout(fxTimer); fxTimer = setTimeout(encodeEffects, 300); }
  if (tune && tuneVol !== vol.music) { clearTimeout(tuneTimer); tuneTimer = setTimeout(() => { encodeTune(); playBed(); }, 300); }
}
export const voiceVolume = () => (muted ? 0 : vol.voice); // for the built-in speech fallback

// Each player has to be started once by a tap, so unlock() starts every one of them on a moment of silence.
let bed = null, voiceEl = null;
let silentUrl = null;
function player() { const el = new Audio(silentUrl ||= wav(new Float32Array(SR / 10))); el.preload = 'auto'; el.play().catch(() => {}); return el; }
export function unlock() {
  if (SILENT.on) return;
  if (unlocked) { playBed(); return; } // also restarts the sound after a call, Siri or a CarPlay switch paused it
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
  if (!OAC()) return;
  unlocked = true;
  bed = player(); bed.loop = true; voiceEl = player(); voiceEl.muted = muted;
  for (const k of EFFECTS) fxEls.set(k, Array.from({ length: FREQ.has(k) ? POOL : 1 }, player)); // (round 14: two for the frequent ones)
  hushUrl = wav(hush());
  playBed();
  renderEffects(); startMusic();
}
// The players, for the sound lab page (dev/sound-lab.html) and the browser checks.
export const audioPlayers = () => (unlocked ? { bed, voice: voiceEl, fx: Object.fromEntries([...fxEls].map(([k, els]) => [k, els[0]])), pools: Object.fromEntries(fxEls) } : null);
// Nothing plays while the game is in the background.
export function pauseAll() { if (!unlocked) return; bed.pause(); stopVoice(); fxStop(); }
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseAll(); else playBed(); });

// Float samples (mono, SR) to a WAV file the audio players can play.
const LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
export function wav(data, sr = SR) {
  const n = data.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  // (round 11: the samples are written through a typed array, many times faster than one DataView call each: a line
  // of a few seconds is 150 000 samples, written in the frame it starts in. Little-endian machines only, as every phone is.)
  if (LE) { const out = new Int16Array(buf, 44, n); for (let i = 0; i < n; i++) { const x = data[i]; out[i] = (x > 1 ? 1 : x < -1 ? -1 : x) * 32767; } }
  else for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 32767, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
const scaled = (d, g) => d.map(x => x * g);

// ---------- the open stream ----------
// The tune when the music is on, otherwise a hush: soft noise about 60 dB below full scale. That is far too quiet
// to hear in a car, but it is not digital silence, which some cars and Bluetooth links treat as "nothing playing"
// and go to sleep on (then the first word of the next line is lost while the link wakes up).
let hushUrl = null;
function hush() {
  const d = new Float32Array(SR * 4); let y = 0, sum = 0;
  for (let i = 0; i < d.length; i++) { y += .08 * (Math.random() * 2 - 1 - y); d[i] = y; sum += y * y; } // a gentle low-passed noise
  return scaled(d, HUSH_RMS / Math.sqrt(sum / d.length));
}
function playBed() {
  if (!unlocked) return;
  if (muted || document.hidden) { bed.pause(); return; }
  const url = musicOn && tuneUrl && !held ? tuneUrl : hushUrl;
  if (bed.dataset.url !== url) { // a new recording: the tune keeps its place in the loop
    const t = url === tuneUrl && bed.dataset.url === tuneOld ? bed.currentTime : url === tuneUrl ? heldAt : 0; heldAt = 0;
    bed.dataset.url = url; bed.src = url; bed.loop = true; try { bed.currentTime = t; } catch { /* not loaded yet */ }
    if (t) bed.addEventListener('loadedmetadata', () => { try { if (bed.dataset.url === url) bed.currentTime = t; } catch { /* */ } }, { once: true });
  }
  if (bed.paused) bed.play().catch(() => {});
}
// (v79) The game paused: the tune gives way to the hush (the stream stays open, so a car keeps its channel), and comes
// back where it was on resume. Effects and a line being said finish by themselves.
let held = false, heldAt = 0;
export function holdMusic(on) {
  if (held === !!on) return; held = !!on;
  if (!unlocked) return;
  if (held && bed.dataset.url === tuneUrl) heldAt = bed.currentTime;
  playBed();
}

// ---------- synthesis (offline only) ----------
// `synth(c)` draws onto an OfflineAudioContext. Called with no context it only measures how long the sound is,
// so the recording can be made exactly that long.
let noiseData = null;
function synth(c) {
  let end = 0, nb = null;
  const buf = () => {
    if (!noiseData) { noiseData = new Float32Array(SR * 2); for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1; }
    if (!nb) { nb = c.createBuffer(1, noiseData.length, SR); nb.getChannelData(0).set(noiseData); }
    return nb;
  };
  return {
    get end() { return end; },
    noise(dur, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, vol = .2, attack = .005, at = 0 } = {}) {
      end = Math.max(end, at + dur + .05); if (!c) return;
      const t = at, src = c.createBufferSource(), flt = c.createBiquadFilter(), g = c.createGain();
      src.buffer = buf(); flt.type = type; flt.Q.value = q;
      flt.frequency.setValueAtTime(f0, t); flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      src.connect(flt).connect(g).connect(c.destination); src.start(t, Math.random()); src.stop(t + dur + .05);
    },
    tone(freq, dur, { type = 'sine', vol = .15, f1 = freq, at = 0, attack = .005 } = {}) {
      end = Math.max(end, at + dur + .05); if (!c) return;
      const t = at, o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + .05);
    },
  };
}
// A short cheer for goals and good plays (it fades out on its own).
const cheer = (s, vol, dur) => s.noise(dur, { f0: 700, f1: 500, q: .5, vol, attack: .25 });
const SFX = {
  kick: s => { s.tone(110, .14, { vol: .5, f1: 55 }); s.noise(.06, { type: 'lowpass', f0: 2500, vol: .25 }); },
  shot: s => { s.tone(95, .2, { vol: .45, f1: 45 }); s.noise(.09, { type: 'lowpass', f0: 3000, vol: .25 }); },
  tap: s => { s.tone(170, .06, { vol: .2, f1: 120 }); s.noise(.03, { type: 'lowpass', f0: 1500, vol: .08 }); },
  up: s => s.noise(.28, { f0: 350, f1: 1600, q: 2.5, vol: .07, attack: .08 }),
  down: s => s.noise(.28, { f0: 1600, f1: 350, q: 2.5, vol: .07, attack: .08 }),
  click: s => s.tone(720, .07, { vol: .16, f1: 520 }),
  ping: s => s.tone(990, .14, { vol: .06, type: 'triangle' }),
  star: (s, i) => s.tone([784, 988, 1319][i] || 1319, .25, { vol: .2, type: 'triangle' }),
  // The ball hitting the net: a soft swish.
  net: s => s.noise(.5, { f0: 2400, f1: 700, q: .8, vol: .22, attack: .02 }),
  yay: s => { [523, 659, 784].forEach((f, i) => s.tone(f, .2, { vol: .1, type: 'triangle', at: i * .07 })); cheer(s, .05, 1.2); },
  goal: s => { [523, 659, 784, 1047].forEach((f, i) => s.tone(f, .28, { vol: .13, type: 'triangle', at: i * .08 })); cheer(s, .14, 2.2); },
  // A skill move is on offer: a quick rising swoosh and two bright notes, so he looks for the button.
  offer: s => { s.noise(.22, { f0: 500, f1: 2600, q: 2, vol: .08, attack: .05 }); [880, 1319].forEach((f, i) => s.tone(f, .16, { vol: .12, type: 'triangle', at: .05 + i * .08 })); },
  // He did it: a sparkle of high notes running up.
  skill: s => { [1047, 1319, 1568, 2093].forEach((f, i) => s.tone(f, .22, { vol: .09, type: 'sine', at: i * .05 })); s.noise(.35, { type: 'highpass', f0: 5000, f1: 7000, vol: .04, attack: .02 }); },
  aww: s => { s.tone(330, .5, { vol: .08, type: 'triangle', f1: 220 }); s.noise(.9, { type: 'lowpass', f0: 900, f1: 300, vol: .06, attack: .15 }); },
  whistle: s => [0, .08, .16, .24, .32].forEach((t, i) => s.tone(i % 2 ? 2650 : 2950, .09, { vol: .06, at: t, attack: .006 })), // (v82) the referee's trill: play stops for a free kick or the ball out (game/live.js bridgeEvent), and full time
};
// Every recording, by key ('star:1' is the second star's note). Footsteps are gone on purpose: they fired several
// times a second, each one a new sound starting, and they were the least missed sound in the game.
export const EFFECTS = [...Object.keys(SFX).filter(k => k !== 'star'), 'star:0', 'star:1', 'star:2'];
export async function renderEffect(key) {
  const [name, arg] = key.split(':'), make = SFX[name], m = synth(null);
  make(m, +arg);
  const oc = new (OAC())(1, Math.ceil((m.end + .02) * SR), SR);
  make(synth(oc), +arg);
  return (await oc.startRendering()).getChannelData(0);
}

// ---------- effects ----------
// Each effect has its own player holding its recording, so two different effects overlap (a kick during a cheer)
// and the same one played again starts over.
// (round 14) On the phone (v76 record) the slowest frames left came just after a sound started (a ball touch, a button's
// click, look up, a kick: 50 to 125 ms). How an effect starts is now a setting the speed test compares on the phone
// (SFX_START.mode; ui/speed.js applies the one it found best):
//   'one'  : as v76, one player per effect, started again even right after it played;
//   'pool' : the frequent effects (FREQ) have two players, used in turn, so a player that is still playing is never
//            restarted or sought;
//   'later': the start waits until the frame it was asked in has been drawn (the next frame, then a 0 ms timer), so it
//            never adds to a tap's or a result's frame; one frame is 17 ms, too short to hear;
//   'pool+later' (the default): both.
export const SFX_START = { mode: 'pool+later' };
export const SFX_MODES = ['one', 'pool', 'later', 'pool+later'];
const FREQ = new Set(['tap', 'click', 'kick', 'up', 'star:0', 'star:1', 'star:2']), POOL = 2;
const fxEls = new Map(), fxRaw = new Map(), fxUrls = new Map(), fxNext = new Map(); // fxEls: key -> its players
let fxVol = null, fxTimer = 0;
async function renderEffects() {
  for (const k of EFFECTS) { try { fxRaw.set(k, await renderEffect(k)); } catch { /* this effect stays silent */ } }
  encodeEffects();
}
function encodeEffects() {
  clearTimeout(fxTimer); fxTimer = 0; fxVol = vol.sfx;
  for (const [k, raw] of fxRaw) {
    const old = fxUrls.get(k), url = wav(scaled(raw, vol.sfx));
    fxUrls.set(k, url); for (const el of fxEls.get(k) || []) { el.pause(); el.src = url; el.load(); }
    if (old) URL.revokeObjectURL(old);
  }
}
function fxStop() { for (const els of fxEls.values()) for (const el of els) el.pause(); fxWaiting.length = 0; }
// The player for this start: in 'pool' mode one that is not playing (or the one started longest ago).
function fxPick(key, pool) {
  const els = fxEls.get(key); if (!els?.length) return null;
  if (!pool || els.length === 1) return els[0];
  const n = fxNext.get(key) || 0, free = els.find(el => el.paused || el.ended);
  const el = free || els[n % els.length]; fxNext.set(key, (els.indexOf(el) + 1) % els.length); return el;
}
function fxStart(key, pool) {
  const el = fxPick(key, pool); if (!el) return;
  // (round 13) A player that has played to its end starts again from the start by itself on play(): the seek, a call into
  // the phone's media player, is made only when the sound is cut off part way.
  if (!el.ended && el.currentTime > 0) { try { el.currentTime = 0; } catch { /* not loaded yet */ } }
  el.play().catch(() => {});
}
const fxWaiting = []; let flushing = false;
function flush() { flushing = false; const keys = [...new Set(fxWaiting.splice(0))]; for (const k of keys) fxStart(k, SFX_START.mode !== 'later'); }
export function sfx(name, arg) {
  if (!unlocked || !enabled || muted || document.hidden) return;
  if (fxTimer) encodeEffects(); // a volume change is waiting: record it now, so this sound plays at the new level
  const key = name === 'star' ? 'star:' + ([0, 1, 2].includes(arg) ? arg : 2) : name;
  if (!fxEls.has(key) || !fxUrls.has(key)) return; // 'step', or not recorded yet
  mark('sound ' + key);
  const mode = SFX_MODES.includes(SFX_START.mode) ? SFX_START.mode : 'pool+later';
  if (!mode.endsWith('later')) return fxStart(key, mode === 'pool');
  fxWaiting.push(key);
  if (!flushing) { flushing = true; requestAnimationFrame(() => setTimeout(flush, 0)); }
}

// ---------- background tune ----------
// A slow four-chord loop (C, G, Am, F) of soft pads, a gentle bass, and a few bell notes from the pentatonic
// scale. Every note fades in and out, so nothing cuts off. It is recorded once (8 bars, about 19 s) and looped.
// It is quiet (MUSIC_VOL), well under the voice, so it doesn't need to dip while the voice talks.
const CHORDS = [[261.6, 329.6, 392], [246.9, 293.7, 392], [220, 261.6, 329.6], [220, 261.6, 349.2]];
const BASS = [130.8, 98, 110, 87.3], BELLS = [523.3, 587.3, 659.3, 784, 880], BAR = 2.4, BARS = 8;
function pad(c, freq, t, dur, vol, type = 'triangle') {
  const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
  o.type = type; o.frequency.value = freq; f.type = 'lowpass'; f.frequency.value = 1400;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + dur * .3); g.gain.linearRampToValueAtTime(vol * .8, t + dur * .7); g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(f).connect(g).connect(c.destination); o.start(t); o.stop(t + dur + .05);
}
// Renders the loop. The notes that ring past the end are added back onto the start, so the seam can't be heard.
export async function renderTune() {
  const len = Math.round(BARS * BAR * SR);
  const oc = new (OAC())(1, len + Math.round(BAR * 1.5 * SR), SR);
  for (let bar = 0; bar < BARS; bar++) {
    const t = bar * BAR, i = bar % 4;
    for (const f of CHORDS[i]) pad(oc, f, t, BAR * 1.25, .22);   // overlapping pads blend into each other
    pad(oc, BASS[i], t, BAR, .3, 'sine');
    for (let k = 0; k < 4; k++) if (Math.random() < .55) pad(oc, BELLS[Math.floor(Math.random() * BELLS.length)], t + k * BAR / 4, .9, .16, 'sine');
  }
  const d = (await oc.startRendering()).getChannelData(0), l = new Float32Array(len);
  l.set(d.subarray(0, len)); for (let i = len; i < d.length; i++) l[i - len] += d[i];
  return l;
}
let tune = null, tuneUrl = null, tuneOld = null, tuneVol = null, tuneTimer = 0;
function encodeTune() {
  tuneVol = vol.music; tuneOld = tuneUrl;
  // At (almost) no volume the tune would be near silence, so the hush plays instead.
  tuneUrl = vol.music >= .02 ? wav(scaled(tune, MUSIC_VOL * vol.music)) : null;
  playBed();
  if (tuneOld) URL.revokeObjectURL(tuneOld);
}
function startMusic() { renderTune().then(t => { tune = t; encodeTune(); }).catch(() => { /* no tune on very old browsers */ }); }

// ---------- recorded voice ----------
// Clips are fetched once and decoded (at SR, by an offline context); leading/trailing silence is trimmed so names
// flow into the sentence. The voice has its own player, so it isn't muted by the Sounds switch.
let voiceIndex = null, decoder = null;
const clipCache = new Map(), clipFailed = new Set(); // clipFailed: files whose last load failed (see clip)
// The list of clips. If it can't be fetched (a network blip at start), it is tried again a few times, a little
// later each time, so the recorded voice isn't lost for the whole session.
export async function loadVoice(base = 'audio/voice/', tries = 4) {
  try { const r = await fetch(base + 'index.json'); voiceIndex = { base, ...(await r.json()) }; }
  catch { voiceIndex = null; if (tries > 0) setTimeout(() => loadVoice(base, tries - 1), (5 - tries) * 4000); }
}
export function decode(bytes) {
  decoder ||= new (OAC())(1, 1, SR);
  return new Promise((res, rej) => decoder.decodeAudioData(bytes, b => res(b.getChannelData(0)), rej));
}
export function trim(d) {
  const th = .01;
  let a = 0, b = d.length - 1;
  while (a < b && Math.abs(d[a]) < th) a++;
  while (b > a && Math.abs(d[b]) < th) b--;
  a = Math.max(0, a - Math.round(.018 * SR)); b = Math.min(d.length - 1, b + Math.round(.054 * SR));
  return d.slice(a, b + 1);
}
// A clip that fails to load (a network blip, a bad file) is not kept: the next call fetches it again. Until a
// load works, the file is listed in clipFailed, so canSpeak sends its lines to the built-in voice instead.
// (round 13) At most LOADS clips are fetched and decoded at once. A mode starting asks for up to 194 together: all at once
// they arrived in one burst of decoding and trimming over the first seconds of play. A clip a line needs now goes first.
const LOADS = 4, waiting = [], STUCK = 10000; let loading = 0, moved = 0;
// (round 14) Clips still to load, for the slow-device governor (world.js pace: it does not judge while they load). When no
// clip has started or finished for 10 s (a fetch that never ends), it counts as nothing loading, so the governor goes on.
export const clipsLoading = () => (performance.now() - moved < STUCK ? loading + waiting.length : 0);
function nextLoad() { while (loading < LOADS && waiting.length) { const job = waiting.shift(); loading++; moved = performance.now(); job.go().finally(() => { loading--; moved = performance.now(); nextLoad(); }); } }
function queued(file, go, now) {
  let job = waiting.find(j => j.file === file);
  if (job) { if (now) { waiting.splice(waiting.indexOf(job), 1); waiting.unshift(job); } return job.p; }
  if (!go) return null; // (only moving a waiting clip up: it is loading or loaded already)
  let res; const p = new Promise(r => { res = r; });
  job = { file, p, go: () => { const q = go(); res(q); return q.catch(() => {}); } };
  if (now) waiting.unshift(job); else waiting.push(job);
  nextLoad(); return p;
}
// A clip's bytes; a fetch that has not ended after 20 s is given up (the clip is fetched again when next needed), so it
// never holds one of the LOADS places for good.
function fetchClip(url) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null, t = ctl && setTimeout(() => ctl.abort(), 20000);
  return fetch(url, ctl ? { signal: ctl.signal } : undefined).then(r => r.arrayBuffer()).finally(() => clearTimeout(t));
}
function clip(key, now = true) {
  const file = voiceIndex?.clips[key]; if (!file || !OAC()) return null;
  if (!clipCache.has(file)) { mark('voice-fetch ' + key); clipCache.set(file, queued(file, () => fetchClip(voiceIndex.base + file).then(decode).then(trim), now)
    .then(d => { mark('voice-decoded ' + key); clipFailed.delete(file); return d; }, () => { clipCache.delete(file); clipFailed.add(file); return null; })); }
  else if (now) queued(file, null, true); // (still waiting: it moves to the front)
  return clipCache.get(file);
}
// True if every piece has a recorded clip (and audio is unlocked), so the line can be played instead of spoken.
// A piece whose clip failed to load last time counts as missing for now, and is fetched again in the background:
// this line falls back to the built-in voice, and a later one plays the recording once it has loaded.
export function canSpeak(keys) {
  if (!(unlocked && voiceIndex && keys.every(k => voiceIndex.clips[k]))) return false;
  const failed = keys.filter(k => clipFailed.has(voiceIndex.clips[k]));
  failed.forEach(k => clip(k));
  return !failed.length;
}
let voiceDone = null, voiceUrl = null; // voiceDone resolves the line that is playing now (when it ends, or is cut off)
export function stopVoice() {
  if (voiceEl) { voiceEl.onended = null; voiceEl.pause(); }
  if (voiceDone) { voiceDone(); voiceDone = null; }
}
// One line from its clips: a short quiet lead-in (so a route that is slow to start doesn't eat the first word),
// the clips with a small gap between them, and a little quiet at the end. The voice volume is part of it.
export function joinLine(clips, gain = 1) {
  const gap = Math.round(.04 * SR), lead = Math.round(LEAD * SR), tail = Math.round(.1 * SR);
  const line = new Float32Array(lead + clips.reduce((n, d) => n + d.length + gap, 0) + tail);
  let at = lead;
  for (const d of clips) { for (let i = 0; i < d.length; i++) line[at + i] = d[i] * gain; at += d.length + gap; }
  return line;
}
let voiceToken = 0; const lineUrls = new Map();
// Plays a line from its clips; the promise resolves when the line has been said (or was cut off by another one).
// It resolves with `false` when the line was not played because a clip could not be loaded, so the caller can
// say it another way. The clips are joined into one recording first, so the line plays in one go.
export async function speakClips(keys) {
  const token = ++voiceToken; stopVoice();
  const clips = await Promise.all(keys.map(k => clip(k)));
  if (token !== voiceToken) return;
  if (clips.some(d => !d)) return false;
  // (round 11) A line's recording is made once and kept (the 40 last used, at this volume): a line said again starts
  // with no work at all in its frame.
  const lk = vol.voice + '|' + keys.join('|'); voiceUrl = lineUrls.get(lk);
  if (voiceUrl) { lineUrls.delete(lk); lineUrls.set(lk, voiceUrl); mark('voice-line kept'); }
  else { mark('voice-line made'); voiceUrl = wav(joinLine(clips, vol.voice)); lineUrls.set(lk, voiceUrl); if (lineUrls.size > 40) { const [k0, u0] = lineUrls.entries().next().value; lineUrls.delete(k0); URL.revokeObjectURL(u0); } }
  const done = new Promise(res => { voiceDone = res; });
  const finish = () => { if (token === voiceToken && voiceDone) { voiceDone(); voiceDone = null; } };
  playBed(); // the open stream is running before the line starts
  voiceEl.muted = muted; voiceEl.loop = false; voiceEl.src = voiceUrl; voiceEl.onended = finish;
  voiceEl.play().catch(finish);
  return done;
}
// Preload a few clips (e.g. this team's names) so the first line plays without a pause. Decoding needs no tap.
export function preloadClips(keys) { if (voiceIndex) keys.forEach(k => clip(k, false)); }
