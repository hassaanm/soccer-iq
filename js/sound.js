// All sounds are made on the fly with Web Audio (no files): a soft crowd bed plus short effects.
// The browser only allows audio after a tap, so `unlock()` runs on the first touch.
let ctx = null, master = null, crowdGain = null, enabled = true, noiseBuf = null;

export function setSoundOn(on) { enabled = on; if (master) master.gain.value = on ? 1 : 0; }

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC(); master = ctx.createGain(); master.gain.value = enabled ? 1 : 0; master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startCrowd();
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

// A low, breathing crowd murmur that swells gently now and then.
function startCrowd() {
  const src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
  src.buffer = noiseBuf; src.loop = true; flt.type = 'bandpass'; flt.frequency.value = 650; flt.Q.value = .6;
  crowdGain = ctx.createGain(); crowdGain.gain.value = .035;
  lfo.frequency.value = .13; lfoGain.gain.value = .012; lfo.connect(lfoGain).connect(crowdGain.gain);
  src.connect(flt).connect(crowdGain).connect(master); src.start(); lfo.start();
}
function swellCrowd(amount, dur) {
  if (!crowdGain) return; const t = now(), g = crowdGain.gain;
  g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(.035 + amount, t + .25); g.linearRampToValueAtTime(.035, t + dur);
}

const SFX = {
  kick: () => { tone(110, .14, { vol: .35, f1: 55 }); noise(.06, { type: 'lowpass', f0: 2500, vol: .18 }); },
  shot: () => { tone(95, .2, { vol: .45, f1: 45 }); noise(.09, { type: 'lowpass', f0: 3000, vol: .25 }); },
  tap: () => { tone(170, .05, { vol: .1, f1: 120 }); },
  step: () => { noise(.035, { type: 'highpass', f0: 1800, vol: .025 }); },
  up: () => noise(.28, { f0: 350, f1: 1600, q: 2.5, vol: .07, attack: .08 }),
  down: () => noise(.28, { f0: 1600, f1: 350, q: 2.5, vol: .07, attack: .08 }),
  click: () => tone(720, .06, { vol: .09, f1: 520 }),
  ping: () => tone(990, .14, { vol: .06, type: 'triangle' }),
  star: i => tone([784, 988, 1319][i] || 1319, .22, { vol: .12, type: 'triangle' }),
  yay: () => { [523, 659, 784].forEach((f, i) => tone(f, .2, { vol: .1, type: 'triangle', at: i * .07 })); swellCrowd(.05, 1.4); },
  goal: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, .28, { vol: .13, type: 'triangle', at: i * .08 })); swellCrowd(.14, 2.6); noise(1.6, { f0: 900, q: .5, vol: .12, attack: .3 }); },
  aww: () => { tone(330, .5, { vol: .08, type: 'triangle', f1: 220 }); noise(.9, { type: 'lowpass', f0: 900, f1: 300, vol: .06, attack: .15 }); },
};
export function sfx(name, arg) { if (!ctx || !enabled) return; try { SFX[name]?.(arg); } catch { /* audio not ready */ } }
