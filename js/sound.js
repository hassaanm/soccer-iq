// Sound effects are made on the fly with Web Audio. The background tune is made the same way but recorded once,
// and it plays with the recorded voice through ordinary audio players (see unlock for why).
// The browser only allows audio after a tap, so `unlock()` runs on the first touch.
// Marking the page as media playback (iOS 17+) makes everything play even with the silent switch on.
// Effects, music and voice each have their own volume; the mute-all switch turns off all three.
let ctx = null, out = null, master = null, enabled = true, musicOn = true, noiseBuf = null, ducked = false, muted = false;
const MUSIC_VOL = .05, vol = { sfx: 1, music: 1, voice: 1 };

export function setSoundOn(on) { enabled = on; applyVolumes(); }
export function setMusicOn(on) { musicOn = on; playMusic(); }
export function setMuted(m) { muted = m; applyVolumes(); }
export function setVolumes(v) { Object.assign(vol, v); applyVolumes(); }
export const voiceVolume = () => (muted ? 0 : vol.voice); // for the built-in speech fallback
let builtVol = null, rebuildTimer = 0;
function applyVolumes() {
  if (!ctx) return;
  out.gain.value = muted ? 0 : 1; master.gain.value = enabled ? vol.sfx : 0;
  if (voiceEl) voiceEl.muted = muted;
  // The music's volume is part of its recording (iPhones ignore volume changes on audio players), so a new
  // volume means a new recording. The wait lets a slider settle first.
  if (tune && builtVol !== vol.music) { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(buildMusic, 300); }
  playMusic();
}
// While the voice talks, the tune drops almost to silence so the words are easy to hear.
export function duck(on) { ducked = on; playMusic(); }

// Music and voice play through ordinary audio players, like a podcast. Safari's Web Audio breaks up over
// CarPlay and Bluetooth (about a second on, a second off); audio players don't. Web Audio is kept only for
// the short sound effects. Each player has to be started once by a tap, so unlock() starts them on silence.
let musicEls = null, voiceEl = null;
function player() { const el = new Audio(wav(new Float32Array(800), 8000)); el.preload = 'auto'; return el; }
export function unlock() {
  if (ctx) { if (ctx.state !== 'running') ctx.resume().catch(() => {}); playMusic(); return; }
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  try { ctx = new AC({ latencyHint: 'playback' }); } catch { ctx = new AC(); }
  out = ctx.createGain(); out.connect(ctx.destination); master = ctx.createGain(); master.connect(out);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  musicEls = [player(), player()]; voiceEl = player();
  [...musicEls, voiceEl].forEach(el => el.play().catch(() => {}));
  startMusic(); applyVolumes();
}
// Nothing plays while the game is in the background.
document.addEventListener('visibilitychange', () => {
  if (!musicEls) return;
  if (document.hidden) { musicEls.forEach(el => el.pause()); stopVoice(); } else playMusic();
});
// Float samples (mono) to a WAV file the audio players can play.
function wav(data, sr) {
  const n = data.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 32767, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
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
// the pentatonic scale. Every note fades in and out, so nothing cuts off. It is recorded once (8 bars, about
// 19 s) and looped by two audio players: one at full volume and one quieter, for while the voice talks.
const CHORDS = [[261.6, 329.6, 392], [246.9, 293.7, 392], [220, 261.6, 329.6], [220, 261.6, 349.2]];
const BASS = [130.8, 98, 110, 87.3], BELLS = [523.3, 587.3, 659.3, 784, 880], BAR = 2.4, BARS = 8, MUSIC_SR = 22050;
function pad(c, dest, freq, t, dur, vol, type = 'triangle') {
  const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
  o.type = type; o.frequency.value = freq; f.type = 'lowpass'; f.frequency.value = 1400;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + dur * .3); g.gain.linearRampToValueAtTime(vol * .8, t + dur * .7); g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(f).connect(g).connect(dest); o.start(t); o.stop(t + dur + .05);
}
// Renders the loop. The notes that ring past the end are added back onto the start, so the seam can't be heard.
async function renderTune() {
  const len = Math.round(BARS * BAR * MUSIC_SR);
  const oc = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, len + Math.round(BAR * 1.5 * MUSIC_SR), MUSIC_SR);
  for (let bar = 0; bar < BARS; bar++) {
    const t = bar * BAR, i = bar % 4;
    for (const f of CHORDS[i]) pad(oc, oc.destination, f, t, BAR * 1.25, .22);   // overlapping pads blend into each other
    pad(oc, oc.destination, BASS[i], t, BAR, .3, 'sine');
    for (let k = 0; k < 4; k++) if (Math.random() < .55) pad(oc, oc.destination, BELLS[Math.floor(Math.random() * BELLS.length)], t + k * BAR / 4, .9, .16, 'sine');
  }
  const d = (await oc.startRendering()).getChannelData(0), l = new Float32Array(len);
  l.set(d.subarray(0, len)); for (let i = len; i < d.length; i++) l[i - len] += d[i];
  return l;
}
let tune = null, musicUrls = [];
function buildMusic() {
  builtVol = vol.music; musicUrls.forEach(u => URL.revokeObjectURL(u));
  musicUrls = [1, .15].map(k => { const g = MUSIC_VOL * vol.music * k; return wav(tune.map(x => x * g), MUSIC_SR); });
  musicEls.forEach((el, i) => { el.pause(); el.src = musicUrls[i]; el.loop = true; });
  playMusic();
}
// Starts or stops the tune, and picks the loud or the quiet player. Both run together so they stay in step.
function playMusic() {
  if (!musicEls || !tune || document.hidden) return;
  const on = musicOn && !muted;
  musicEls.forEach((el, i) => {
    el.muted = !on || (i === 0 ? ducked : !ducked);
    if (on && el.paused) { if (i === 1) el.currentTime = musicEls[0].currentTime; el.play().catch(() => {}); }
    if (!on && !el.paused) el.pause();
  });
}
function startMusic() { renderTune().then(t => { tune = t; buildMusic(); }).catch(() => { /* no tune on very old browsers */ }); }
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
// The voice has its own player, so it isn't muted by the Sounds switch.
let voiceIndex = null;
const clipCache = new Map(), clipFailed = new Set(); // clipFailed: files whose last load failed (see clip)
// The list of clips. If it can't be fetched (a network blip at start), it is tried again a few times, a little
// later each time, so the recorded voice isn't lost for the whole session.
export async function loadVoice(base = 'audio/voice/', tries = 4) {
  try { const r = await fetch(base + 'index.json'); voiceIndex = { base, ...(await r.json()) }; }
  catch { voiceIndex = null; if (tries > 0) setTimeout(() => loadVoice(base, tries - 1), (5 - tries) * 4000); }
}
function trim(buf) {
  const d = buf.getChannelData(0), th = .01;
  let a = 0, b = d.length - 1;
  while (a < b && Math.abs(d[a]) < th) a++;
  while (b > a && Math.abs(d[b]) < th) b--;
  a = Math.max(0, a - 400); b = Math.min(d.length - 1, b + 1200);
  const out = ctx.createBuffer(1, b - a + 1, buf.sampleRate); out.getChannelData(0).set(d.subarray(a, b + 1)); return out;
}
// A clip that fails to load (a network blip, a bad file) is not kept: the next call fetches it again. Until a
// load works, the file is listed in clipFailed, so canSpeak sends its lines to the built-in voice instead.
function clip(key) {
  const file = voiceIndex?.clips[key]; if (!file) return null;
  if (!clipCache.has(file)) clipCache.set(file, fetch(voiceIndex.base + file).then(r => r.arrayBuffer()).then(b => new Promise((res, rej) => ctx.decodeAudioData(b, res, rej))).then(trim)
    .then(buf => { clipFailed.delete(file); return buf; }, () => { clipCache.delete(file); clipFailed.add(file); return null; }));
  return clipCache.get(file);
}
// True if every piece has a recorded clip (and audio is unlocked), so the line can be played instead of spoken.
// A piece whose clip failed to load last time counts as missing for now, and is fetched again in the background:
// this line falls back to the built-in voice, and a later one plays the recording once it has loaded.
export function canSpeak(keys) {
  if (!(ctx && voiceIndex && keys.every(k => voiceIndex.clips[k]))) return false;
  const failed = keys.filter(k => clipFailed.has(voiceIndex.clips[k]));
  failed.forEach(clip);
  return !failed.length;
}
let voiceDone = null, voiceUrl = null; // voiceDone resolves the line that is playing now (when it ends, or is cut off)
export function stopVoice() {
  if (voiceEl) { voiceEl.onended = null; voiceEl.pause(); }
  if (voiceDone) { duck(false); voiceDone(); voiceDone = null; }
}
let voiceToken = 0;
// Plays a line from its clips; the promise resolves when the line has been said (or was cut off by another one).
// It resolves with `false` when the line was not played because a clip could not be loaded, so the caller can
// say it another way. The clips are joined into one recording first, so the line plays in one go.
export async function speakClips(keys) {
  const token = ++voiceToken; stopVoice();
  const bufs = await Promise.all(keys.map(clip));
  if (token !== voiceToken) return;
  if (bufs.some(b => !b)) return false;
  const sr = bufs[0].sampleRate, gap = Math.round(.04 * sr), line = new Float32Array(bufs.reduce((n, b) => n + b.length + gap, 0));
  let at = Math.round(.05 * sr); // a moment of quiet so the first word isn't clipped
  for (const b of bufs) { const d = b.getChannelData(0); for (let i = 0; i < d.length && at + i < line.length; i++) line[at + i] = d[i] * vol.voice; at += b.length + gap; }
  if (voiceUrl) URL.revokeObjectURL(voiceUrl);
  voiceUrl = wav(line, sr);
  const done = new Promise(res => { voiceDone = res; });
  const finish = () => { if (token === voiceToken && voiceDone) { duck(false); voiceDone(); voiceDone = null; } };
  duck(true); voiceEl.muted = muted; voiceEl.loop = false; voiceEl.src = voiceUrl; voiceEl.onended = finish;
  voiceEl.play().catch(finish);
  return done;
}
// Preload a few clips (e.g. this team's names) so the first line plays without a pause.
export function preloadClips(keys) { if (ctx && voiceIndex) keys.forEach(clip); }
