// All sounds are made on the fly with Web Audio (no files): short effects plus a soft background tune.
// The browser only allows audio after a tap, so `unlock()` runs on the first touch.
// iPhones mute Web Audio when the ring/silent switch is on silent (speech still plays). Marking the page as
// media playback (iOS 17+) makes the effects play anyway.
// Mixing: effects (master), music and voice each have their own volume, and all three go through `out`,
// which the mute-all switch turns off.
let ctx = null, out = null, master = null, musicGain = null, enabled = true, musicOn = true, noiseBuf = null, ducked = false, muted = false;
const MUSIC_VOL = .05, vol = { sfx: 1, music: 1, voice: 1 };

export function setSoundOn(on) { enabled = on; applyVolumes(); }
export function setMusicOn(on) { musicOn = on; fadeMusic(); }
export function setMuted(m) { muted = m; applyVolumes(); }
export function setVolumes(v) { Object.assign(vol, v); applyVolumes(); }
export const voiceVolume = () => (muted ? 0 : vol.voice); // for the built-in speech fallback
function applyVolumes() {
  if (!ctx) return;
  out.gain.value = muted ? 0 : 1; master.gain.value = enabled ? vol.sfx : 0;
  if (voiceGain) voiceGain.gain.value = vol.voice;
  fadeMusic();
}
// While the voice talks, the tune drops almost to silence so the words are easy to hear.
export function duck(on) { ducked = on; fadeMusic(); }
function fadeMusic() {
  if (!musicGain) return; const t = now(), g = musicGain.gain;
  g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(musicOn ? MUSIC_VOL * vol.music * (ducked ? .15 : 1) : 0, t + .4);
}

export function unlock() {
  if (ctx) { if (ctx.state !== 'running') ctx.resume().catch(() => {}); return; }
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  // 'playback' asks for bigger audio buffers. Sound starts a moment later, but it doesn't break up when the
  // phone is busy drawing the game or the sound goes over the air (CarPlay, AirPlay, Bluetooth).
  try { ctx = new AC({ latencyHint: 'playback' }); } catch { ctx = new AC(); }
  // iOS pauses the audio for a call, Siri or a CarPlay switch; the next tap starts it again (see the top of unlock).
  out = ctx.createGain(); out.connect(ctx.destination); master = ctx.createGain(); master.connect(out);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startMusic(); applyVolumes();
}

const now = () => ctx.currentTime;
function noise(dur, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, vol = .2, attack = .005, at = 0 } = {}) {
  const t = now() + at, src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noiseBuf; flt.type = type; flt.Q.value = q;
  flt.frequency.setValueAtTime(f0, t); flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  src.connect(flt).connect(g).connect(master); src.start(t, Math.random()); src.stop(t + dur + .05);
}
function tone(freq, dur, { type = 'sine', vol = .15, f1 = freq, at = 0, attack = .005 } = {}) {
  const t = now() + at, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + .05);
}

// Background tune: a slow four-chord loop (C, G, Am, F) of soft pads, a gentle bass, and a few bell notes from
// the pentatonic scale. Every note fades in and out, so nothing cuts off.
// The tune is recorded once into a buffer (8 bars, about 19 s) and looped. Playing it live took about 20
// oscillators at a time, and on a busy phone that made all the sound stutter.
const CHORDS = [[261.6, 329.6, 392], [246.9, 293.7, 392], [220, 261.6, 329.6], [220, 261.6, 349.2]];
const BASS = [130.8, 98, 110, 87.3], BELLS = [523.3, 587.3, 659.3, 784, 880], BAR = 2.4, BARS = 8;
function pad(c, dest, freq, t, dur, vol, type = 'triangle') {
  const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
  o.type = type; o.frequency.value = freq; f.type = 'lowpass'; f.frequency.value = 1400;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + dur * .3); g.gain.linearRampToValueAtTime(vol * .8, t + dur * .7); g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(f).connect(g).connect(dest); o.start(t); o.stop(t + dur + .05);
}
function bars(c, dest, t0, from, n) {
  for (let bar = from; bar < from + n; bar++) {
    const t = t0 + (bar - from) * BAR, i = bar % 4;
    for (const f of CHORDS[i]) pad(c, dest, f, t, BAR * 1.25, .22);              // overlapping pads blend into each other
    pad(c, dest, BASS[i], t, BAR, .3, 'sine');
    for (let k = 0; k < 4; k++) if (Math.random() < .55) pad(c, dest, BELLS[Math.floor(Math.random() * BELLS.length)], t + k * BAR / 4, .9, .16, 'sine');
  }
}
// Renders the loop. The notes that ring past the end are added back onto the start, so the seam can't be heard.
async function renderLoop() {
  const sr = ctx.sampleRate, len = Math.round(BARS * BAR * sr);
  const oc = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, len + Math.round(BAR * 1.5 * sr), sr);
  bars(oc, oc.destination, 0, 0, BARS);
  const d = (await oc.startRendering()).getChannelData(0), loop = ctx.createBuffer(1, len, sr), l = loop.getChannelData(0);
  l.set(d.subarray(0, len)); for (let i = len; i < d.length; i++) l[i - len] += d[i];
  return loop;
}
// If recording fails (an old browser), the tune is played live instead, a little ahead of time.
function liveMusic() {
  let next = now() + .1, bar = 0;
  const go = () => { while (next < now() + 1.5) { bars(ctx, musicGain, next, bar, 1); next += BAR; bar++; } };
  go(); setInterval(go, 500);
}
function startMusic() {
  musicGain = ctx.createGain(); musicGain.gain.value = 0; musicGain.connect(out); fadeMusic();
  renderLoop().then(buf => {
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.connect(musicGain); src.start(now() + .05);
  }).catch(liveMusic);
}
// A short cheer for goals and good plays (it fades out on its own).
function cheer(vol, dur) { noise(dur, { f0: 700, f1: 500, q: .5, vol, attack: .25 }); }

const SFX = {
  kick: () => { tone(110, .14, { vol: .5, f1: 55 }); noise(.06, { type: 'lowpass', f0: 2500, vol: .25 }); },
  shot: () => { tone(95, .2, { vol: .45, f1: 45 }); noise(.09, { type: 'lowpass', f0: 3000, vol: .25 }); },
  tap: () => { tone(170, .06, { vol: .2, f1: 120 }); noise(.03, { type: 'lowpass', f0: 1500, vol: .08 }); },
  step: () => { noise(.04, { type: 'highpass', f0: 1600, vol: .06 }); },
  up: () => noise(.28, { f0: 350, f1: 1600, q: 2.5, vol: .07, attack: .08 }),
  down: () => noise(.28, { f0: 1600, f1: 350, q: 2.5, vol: .07, attack: .08 }),
  click: () => tone(720, .07, { vol: .16, f1: 520 }),
  ping: () => tone(990, .14, { vol: .06, type: 'triangle' }),
  star: i => tone([784, 988, 1319][i] || 1319, .25, { vol: .2, type: 'triangle' }),
  // The ball hitting the net: a soft swish.
  net: () => noise(.5, { f0: 2400, f1: 700, q: .8, vol: .22, attack: .02 }),
  yay: () => { [523, 659, 784].forEach((f, i) => tone(f, .2, { vol: .1, type: 'triangle', at: i * .07 })); cheer(.05, 1.2); },
  goal: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, .28, { vol: .13, type: 'triangle', at: i * .08 })); cheer(.14, 2.2); },
  aww: () => { tone(330, .5, { vol: .08, type: 'triangle', f1: 220 }); noise(.9, { type: 'lowpass', f0: 900, f1: 300, vol: .06, attack: .15 }); },
};
export function sfx(name, arg) { if (!ctx || !enabled) return; try { SFX[name]?.(arg); } catch { /* audio not ready */ } }

// ---------- recorded voice ----------
// Clips are fetched once and decoded; leading/trailing silence is trimmed so names flow into the sentence.
// The voice has its own gain straight to the speakers, so it isn't muted by the Sounds switch.
let voiceIndex = null, voiceGain = null, voicePlaying = [];
const clipCache = new Map();
export async function loadVoice(base = 'audio/voice/') {
  try { const r = await fetch(base + 'index.json'); voiceIndex = { base, ...(await r.json()) }; } catch { voiceIndex = null; }
}
function trim(buf) {
  const d = buf.getChannelData(0), th = .01;
  let a = 0, b = d.length - 1;
  while (a < b && Math.abs(d[a]) < th) a++;
  while (b > a && Math.abs(d[b]) < th) b--;
  a = Math.max(0, a - 400); b = Math.min(d.length - 1, b + 1200);
  const out = ctx.createBuffer(1, b - a + 1, buf.sampleRate); out.getChannelData(0).set(d.subarray(a, b + 1)); return out;
}
function clip(key) {
  const file = voiceIndex?.clips[key]; if (!file) return null;
  if (!clipCache.has(file)) clipCache.set(file, fetch(voiceIndex.base + file).then(r => r.arrayBuffer()).then(b => new Promise((res, rej) => ctx.decodeAudioData(b, res, rej))).then(trim).catch(() => null));
  return clipCache.get(file);
}
// True if every piece has a recorded clip (and audio is unlocked), so the line can be played instead of spoken.
export const canSpeak = keys => !!(ctx && voiceIndex && keys.every(k => voiceIndex.clips[k]));
let voiceDone = null; // resolves the line that is playing now (when it ends, or is cut off)
export function stopVoice() { for (const s of voicePlaying) try { s.stop(); } catch { /* already stopped */ } voicePlaying = []; voiceDone?.(); voiceDone = null; }
let voiceToken = 0;
// Plays a line from its clips; the promise resolves when the line has been said (or was cut off by another one).
export async function speakClips(keys) {
  const token = ++voiceToken; stopVoice();
  const bufs = await Promise.all(keys.map(clip));
  if (token !== voiceToken || bufs.some(b => !b)) return;
  const done = new Promise(res => { voiceDone = res; });
  if (!voiceGain) { voiceGain = ctx.createGain(); voiceGain.gain.value = vol.voice; voiceGain.connect(out); }
  let t = now() + .05;
  duck(true);
  bufs.forEach((b, i) => {
    const src = ctx.createBufferSource(); src.buffer = b; src.connect(voiceGain); src.start(t); voicePlaying.push(src);
    t += b.duration + .04;
    if (i === bufs.length - 1) src.onended = () => { if (token === voiceToken) { duck(false); voiceDone?.(); voiceDone = null; } };
  });
  return done;
}
// Preload a few clips (e.g. this team's names) so the first line plays without a pause.
export function preloadClips(keys) { if (ctx && voiceIndex) keys.forEach(clip); }
