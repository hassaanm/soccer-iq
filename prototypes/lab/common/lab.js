// The lab's shared engine. Each prototype page boots it with its letter, name and team size, then plays its own rules
// in `tick`. It draws with the game's own 3D world (js/world.js) and moves players and the ball with the game's own sim
// (js/sim.js), read only. Everything else is here: the frame loop with slow motion, the camera, the gold markers the
// child taps, the picture buttons, spoken and pictured feedback, the counts, and the chrome (letter, home, pause, mute,
// version stamp, end screen).
//
// The game's save is never touched: the page sets globalThis.SOCCER_THROWAWAY before any game module loads, so the
// game's storage module (pulled in by geom.js) reads and writes an in-memory copy. boot() refuses to start without it.
import * as THREE from 'three';

const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.innerHTML = html; return e; };
const Q = new URLSearchParams(location.search);

// A canvas texture (made once, shared).
function tex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const ringTex = () => tex(256, 256, (g, w) => {
  const c = w / 2, rg = g.createRadialGradient(c, c, 10, c, c, c);
  rg.addColorStop(0, 'rgba(255,220,90,.45)'); rg.addColorStop(.7, 'rgba(255,210,63,.18)'); rg.addColorStop(1, 'rgba(255,210,63,0)');
  g.fillStyle = rg; g.fillRect(0, 0, w, w);
  g.lineWidth = 26; g.strokeStyle = '#ffffff'; g.beginPath(); g.arc(c, c, 84, 0, 7); g.stroke();
  g.lineWidth = 16; g.strokeStyle = '#ffcf2e'; g.beginPath(); g.arc(c, c, 84, 0, 7); g.stroke();
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(c, c, 18, 0, 7); g.fill();
});
const ctrlTex = () => tex(256, 256, (g, w) => {
  const c = w / 2; g.lineWidth = 18; g.strokeStyle = 'rgba(36,25,58,.55)'; g.beginPath(); g.arc(c, c, 100, 0, 7); g.stroke();
  g.lineWidth = 12; g.strokeStyle = '#ffd23f'; g.beginPath(); g.arc(c, c, 100, 0, 7); g.stroke();
});
const arrowTex = () => tex(512, 192, (g, w, h) => {
  g.beginPath(); [[40, 70], [330, 70], [330, 22], [490, 96], [330, 170], [330, 122], [40, 122]].forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath();
  g.lineJoin = 'round'; g.lineWidth = 22; g.strokeStyle = '#fff'; g.stroke(); g.fillStyle = '#ffcf2e'; g.fill();
});
const targetTex = () => tex(256, 256, (g, w) => {
  const c = w / 2; g.fillStyle = 'rgba(36,25,58,.5)'; g.beginPath(); g.arc(c, c, 120, 0, 7); g.fill();
  g.lineWidth = 30; g.strokeStyle = '#ffcf2e'; g.beginPath(); g.arc(c, c, 86, 0, 7); g.stroke();
  g.lineWidth = 8; g.strokeStyle = '#fff'; g.beginPath(); g.arc(c, c, 106, 0, 7); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(c, c, 26, 0, 7); g.fill();
});
const flatMat = map => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false });

export async function boot(cfg) {
  const mem = globalThis.SOCCER_THROWAWAY;
  if (!mem || typeof mem !== 'object') { document.body.append(el('div', { id: 'err' }, 'The lab did not start: it runs only on a throwaway save.')); throw new Error('no throwaway save'); }
  const show = e => { try { const box = $('#err') || document.body.appendChild(el('div', { id: 'err' })); box.textContent = String(e && (e.stack || e.message) || e).slice(0, 600); } catch { /* nothing more to do */ } };
  addEventListener('error', e => show(e.error || e.message));
  let mods;
  try {
    mods = await Promise.all(['world', 'sim', 'teams', 'sound', 'voice', 'geom'].map(m => import(`../../../js/${m}.js`)));
  } catch (e) { show(e); throw e; }
  const [{ World }, { Sim }, { teamById, displayName }, snd, { pieces, clipKey }, geom] = mods;
  const { PITCH } = geom, L = PITCH.L, W = PITCH.W;
  if (cfg.size && geom.TEAM.size !== cfg.size) console.warn('lab: size', geom.TEAM.size, 'not', cfg.size);

  // ---------- the page ----------
  const canvas = $('#view');
  let world;
  try { world = new World(canvas); } catch (e) { show('This device can’t show 3D graphics (WebGL is off).'); throw e; }
  world.setGraphics('smooth'); world.setEnv(cfg.env || 'crowd');
  const us = teamById(cfg.us || 'barca'), them = teamById(cfg.them || 'madrid');
  world.setTeams(us, them);
  const sim = new Sim();
  const chrome = el('div', { id: 'chrome' }, `
    <div id="letter">${cfg.letter}</div>
    <button id="homeB" class="lb glass icon" aria-label="Back to the lab">🏠</button>
    <button id="muteB" class="lb glass icon" aria-label="Sound">🔊</button>
    <button id="pauseB" class="lb glass icon" aria-label="Pause">⏸</button>
    <div id="score"></div>
    <div id="stamp">Lab ${cfg.letter} · ${cfg.version} · ${cfg.size}</div>
    <div id="fb"><span class="emo"></span><span class="txt"></span></div>
    <div id="ask"></div>
    <div id="picks"></div>
    <div id="pauseS" class="sheet hide"><div class="card"><h2>Paused</h2><div class="row"><button id="resumeB" class="lb green big" aria-label="Play">▶</button></div><div class="row"><button id="pHome" class="lb glass">🏠 Lab</button><button id="pEnd" class="lb glass">🏁 End and see counts</button></div></div></div>
    <div id="endS" class="sheet hide"><div class="card"><h2>🏁 Well played!</h2><div class="counts"></div><div class="note"></div><div class="row"><button id="againB" class="lb green big" aria-label="Play again">↻</button><button id="eHome" class="lb glass big" aria-label="Back to the lab">🏠</button></div></div></div>
    <div id="tapStart"><button id="goB" class="lb green">▶ Play</button></div>`);
  document.body.append(chrome);

  // ---------- sound: nothing until the first tap ----------
  let unlocked = false, muted = false;
  const unlock = () => {
    if (unlocked) return; unlocked = true;
    try { snd.setMusicOn(false); snd.unlock(); snd.loadVoice('../../../audio/voice/'); } catch (e) { console.warn('sound', e); }
  };
  const sfx = (n, a) => { if (unlocked && !muted) try { snd.sfx(n, a); } catch { /* no sound */ } };
  let ttsOK = false; try { ttsOK = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance === 'function'; } catch { /* none */ }
  // A spoken line: the game's recorded clips when every piece of it has one, else the phone's own voice.
  function say(text) {
    if (!unlocked || muted || !text) return;
    try {
      const keys = pieces(text).map(clipKey);
      if (snd.canSpeak(keys)) { snd.speakClips(keys).then(ok => { if (ok === false) tts(text); }).catch(() => {}); return; }
    } catch { /* fall back */ }
    tts(text);
  }
  function tts(text) { if (!ttsOK || muted) return; try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1; u.pitch = 1.1; speechSynthesis.speak(u); } catch { /* no voice */ } }
  const nameOf = id => { const a = sim.a(id); if (!a) return ''; const t = a.team === 'us' ? us : them, i = id === 'hero' ? 0 : +id.slice(1) - (a.team === 'us' ? 0 : 1); return displayName(t.players[Math.max(0, i)]?.name || ''); };

  // ---------- markers on the pitch ----------
  const rTex = ringTex(), cTex = ctrlTex(), aTex = arrowTex(), tTex = targetTex();
  const ringGeo = new THREE.PlaneGeometry(1.7, 1.7), rings = Array.from({ length: 8 }, () => { const m = new THREE.Mesh(ringGeo, flatMat(rTex)); m.visible = false; m.renderOrder = 2; world.scene.add(m); return m; });
  const ctrlRing = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 1.55), flatMat(cTex)); ctrlRing.visible = false; ctrlRing.renderOrder = 3; world.scene.add(ctrlRing);
  const arrows = Array.from({ length: 3 }, () => { const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.2).translate(1.6 + .55, 0, 0), flatMat(aTex)); m.visible = false; m.renderOrder = 2; world.scene.add(m); return m; });
  const target = new THREE.Sprite(new THREE.SpriteMaterial({ map: tTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })); target.visible = false; target.renderOrder = 9; target.scale.set(1.5, 1.5, 1); world.scene.add(target);
  // Cones (the rondo's box): small orange cones, one mesh each, made on request.
  const coneGeo = new THREE.ConeGeometry(.24, .55, 14).rotateX(Math.PI / 2).translate(0, 0, .275), coneMat = new THREE.MeshStandardMaterial({ color: '#ff7a1a', roughness: .6 });
  const cones = pts => { for (const [x, y] of pts) { const m = new THREE.Mesh(coneGeo, coneMat); m.position.set(x, y, 0); m.castShadow = true; world.scene.add(m); } };
  // A box painted on the grass (the rondo's square): four orange strips.
  const box = (x0, y0, x1, y1, w = .12) => { const mat = new THREE.MeshBasicMaterial({ color: '#ffb066', transparent: true, opacity: .85, depthWrite: false, toneMapped: false });
    for (const [cx, cy, sx, sy] of [[(x0 + x1) / 2, y0, x1 - x0, w], [(x0 + x1) / 2, y1, x1 - x0, w], [x0, (y0 + y1) / 2, w, y1 - y0], [x1, (y0 + y1) / 2, w, y1 - y0]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sy), mat); m.position.set(cx, cy, .03); world.scene.add(m); } };

  // ---------- the lab object ----------
  const lab = {
    world, sim, THREE, L, W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, geom, us, them, sfx, say, nameOf, cones, box, cfg,
    time: 0, real: 0, slow: 1, slowTo: 1, paused: true, ended: false, started: false, waiting: false,
    ctrl: null, ctrlSoft: false, ui: { glow: {}, lines: null, heroRing: false },
    win: null, tick: null, cam: null, camWant: null, onEnd: null,
    stats: { decisions: 0, good: 0, choose: 0, watch: 0, wait: 0, played: 0, picks: [], stalls: 0, frames: [] },
    len: +(Q.get('len') || cfg.len || 180), // seconds of play before the end screen
  };
  window.__lab = lab;
  sim.on = (ev, v) => { if (ev === 'kick') { world.fx('kick', v); sfx(v >= 14 ? 'shot' : 'kick'); } else if (ev === 'touch') world.fx('touch'); };

  // ---------- choices ----------
  // lab.open({ kind, options, onPick, slow, hint, from, ask })
  //   option: { id, kind: 'player'|'spot'|'goal'|'arrow'|'btn', who, x, y, ang, icon, label, good, best, word, line }
  //   good options get 👍 and their word; bad ones ✋, their word, and a green line to the best option.
  const picks = $('#picks'), ask = $('#ask'), btnPool = [];
  lab.open = w => {
    lab.close();
    lab.win = { ...w, t0: lab.real, hinted: false, age: 0 };
    lab.slowTo = w.slow ?? .25;
    let bi = 0;
    for (const o of w.options) if (o.kind === 'btn') {
      let b = btnPool[bi]; if (!b) { b = el('button', { class: 'lb gold pk off' }); b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); unlock(); if (b.dataset.id && lab.win && !lab.paused) lab.pick(b.dataset.id); }); picks.append(b); btnPool.push(b); }
      b.dataset.id = o.id; b.innerHTML = `${o.icon}${o.label ? `<span>${o.label}</span>` : ''}`; b.setAttribute('aria-label', o.aria || o.label || o.id); b.classList.remove('off', 'hint'); bi++;
    }
    for (; bi < btnPool.length; bi++) { btnPool[bi].classList.add('off'); btnPool[bi].dataset.id = ''; }
    ask.textContent = w.ask || ''; ask.classList.toggle('show', !!w.ask);
    if (w.sound !== false) sfx('ping');
  };
  lab.close = () => {
    lab.win = null; lab.slowTo = 1; ask.classList.remove('show');
    for (const b of btnPool) { b.classList.add('off'); b.classList.remove('hint'); b.dataset.id = ''; }
  };
  const fb = $('#fb'); let fbT = 0;
  lab.feedback = (good, word, emo) => {
    fb.querySelector('.emo').textContent = emo || (good ? '👍' : '✋'); fb.querySelector('.txt').textContent = word || '';
    fb.classList.toggle('good', !!good); fb.classList.toggle('bad', !good); fb.classList.add('show'); fbT = 1.7;
  };
  let lineT = 0;
  lab.showLines = (lines, secs = 1.8) => { lab.ui.lines = lines; lineT = secs; };
  lab.pick = id => {
    const w = lab.win; if (!w) return;
    const o = w.options.find(x => x.id === id); if (!o) return;
    try { w.judge?.(w.options); } catch (e) { console.error(e); } // (graded on the picture at the moment of the tap)
    const rt = lab.real - w.t0;
    lab.stats.decisions++; if (o.good) lab.stats.good++;
    lab.stats.picks.push({ t: +lab.real.toFixed(1), kind: w.kind, id, good: !!o.good, best: !!o.best, rt: +rt.toFixed(2), n: w.options.length });
    lab.close();
    if (w.quiet !== true) {
      lab.feedback(o.good, o.word, o.emo);
      sfx(o.good ? 'star' : 'tap', o.good ? (o.best ? 2 : 1) : undefined);
      say(o.line);
      if (!o.good && w.from) { const b = w.options.find(x => x.best) || w.options.find(x => x.good); if (b) { const p = lab.pointOf(b, true); if (p) lab.showLines([{ a: w.from(), b: { x: p.x, y: p.y }, color: '#3ddc84' }]); } }
    }
    w.onPick?.(o, rt);
  };
  // Where an option sits on the pitch (for taps and markers), or null (a button).
  lab.pointOf = (o, ground = false) => {
    if (o.kind === 'player') { const a = sim.a(o.who); return a && { x: a.x, y: a.y, z: ground ? 0 : .7 }; }
    if (o.kind === 'spot') return { x: o.x, y: o.y, z: 0 };
    if (o.kind === 'goal') return { x: o.gx ?? L, y: o.gy ?? W / 2, z: ground ? 0 : .8 };
    if (o.kind === 'arrow') { const a = sim.a(o.who); return a && { x: a.x + Math.cos(o.ang) * 2.6, y: a.y + Math.sin(o.ang) * 2.6, z: 0 }; }
    return null;
  };
  // A tap on the pitch picks the option nearest to it on screen, within a generous reach (a small hand, a moving picture).
  canvas.addEventListener('pointerdown', e => {
    unlock(); const w = lab.win; if (!w || lab.paused || lab.ended) return;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, reach = Math.max(64, Math.min(world.width, world.height) * .17);
    let best = null, bd = 1e9;
    for (const o of w.options) {
      const pts = [lab.pointOf(o), lab.pointOf(o, true)].filter(Boolean);
      for (const p of pts) { const s = world.project(p.x, p.y, p.z); if (!s) continue; const d = Math.hypot(s[0] - x, s[1] - y); if (d < bd) { bd = d; best = o; } }
    }
    if (best && bd < reach) lab.pick(best.id); else sfx('tap');
  });
  // For the bots and the checks: tap an option the way a finger would (its marker's place on screen).
  lab.tapPoint = id => { const o = lab.win?.options.find(x => x.id === id); if (!o) return null; const p = lab.pointOf(o); if (!p) return null; const s = world.project(p.x, p.y, p.z); return s && { x: s[0], y: s[1] }; };

  // ---------- chrome ----------
  const pauseS = $('#pauseS'), endS = $('#endS');
  const setPaused = p => { if (lab.ended || !lab.started) return; lab.paused = p; pauseS.classList.toggle('hide', !p); if (p) { try { snd.pauseAll(); speechSynthesis?.cancel(); } catch { /* none */ } } };
  lab.pause = setPaused;
  const tapB = (sel, f) => $(sel).addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); unlock(); f(); });
  tapB('#pauseB', () => setPaused(!lab.paused));
  tapB('#resumeB', () => setPaused(false));
  const home = () => { try { snd.pauseAll(); speechSynthesis?.cancel(); } catch { /* none */ } location.href = '../index.html'; };
  tapB('#homeB', home); tapB('#pHome', home); tapB('#eHome', home);
  tapB('#pEnd', () => { pauseS.classList.add('hide'); lab.paused = false; end(); });
  tapB('#againB', () => location.reload());
  tapB('#muteB', () => { muted = !muted; $('#muteB').textContent = muted ? '🔇' : '🔊'; try { snd.setMuted(muted); if (muted) speechSynthesis?.cancel(); } catch { /* none */ } });
  tapB('#goB', () => { $('#tapStart').remove(); lab.started = true; lab.paused = false; cfg.onStart?.(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && lab.started && !lab.paused) setPaused(true); });
  const score = $('#score'); lab.setScore = html => { if (score._h !== html) { score.innerHTML = html; score._h = html; } };

  function end() {
    if (lab.ended) return; lab.ended = true; lab.close();
    const s = lab.stats, mins = s.played / 60, m = Math.floor(s.played / 60), sec = Math.round(s.played % 60);
    endS.querySelector('.counts').innerHTML = `<div><b>${s.decisions}</b><small>🧠 choices</small></div><div><b>${s.good}</b><small>👍 good ones</small></div><div><b>${m}:${String(sec).padStart(2, '0')}</b><small>⏱ played</small></div>`
      + (lab.onEnd ? lab.onEnd() : '');
    endS.querySelector('.note').textContent = `Lab ${cfg.letter} · ${cfg.version} · ${mins > 0 ? (s.decisions / mins).toFixed(1) : 0} choices a minute · choosing ${Math.round(100 * s.choose / Math.max(1, s.played))}% of the time`;
    endS.classList.remove('hide'); sfx('yay'); say('good game');
  }
  lab.end = end;

  // ---------- camera ----------
  const cam = { eye: [L / 2, -12, 12], tgt: [L / 2, W / 2, 0], Ff: .95, Fw: .45 };
  lab.camNow = cam;
  function moveCam(dt, snap = false) {
    const w = lab.camWant?.(); if (!w) return;
    const k = snap ? 1 : 1 - Math.exp(-dt * (w.k || 2.5));
    for (let i = 0; i < 3; i++) { cam.eye[i] += (w.eye[i] - cam.eye[i]) * k; cam.tgt[i] += (w.tgt[i] - cam.tgt[i]) * k; }
    cam.Ff += (w.Ff - cam.Ff) * k; cam.Fw += ((w.Fw ?? .45) - cam.Fw) * k;
  }

  // ---------- markers each frame ----------
  function drawMarkers(t) {
    const w = lab.win, pulse = 1 + .08 * Math.sin(t * 6);
    let ri = 0, ai = 0; target.visible = false; for (const k in lab.ui.glow) delete lab.ui.glow[k];
    const hint = w && w.hinted;
    if (w) for (const o of w.options) {
      const hb = hint && o.best ? 1.35 + .2 * Math.sin(t * 9) : 1;
      if (o.kind === 'player' || o.kind === 'spot') {
        const p = lab.pointOf(o, true); const m = rings[ri++]; if (!p || !m) continue;
        m.visible = true; m.position.set(p.x, p.y, .045); m.scale.setScalar(pulse * hb * (o.kind === 'spot' ? 1.15 : 1));
        if (o.kind === 'player') lab.ui.glow[o.who] = hint && o.best ? 1 : .55;
      } else if (o.kind === 'arrow') {
        const a = sim.a(o.who), m = arrows[ai++]; if (!a || !m) continue;
        m.visible = true; m.position.set(a.x, a.y, .05); m.rotation.z = o.ang; m.scale.setScalar(pulse * hb);
      } else if (o.kind === 'goal') {
        target.visible = true; target.position.set(o.gx ?? L + .15, o.gy ?? W / 2, .85); target.scale.setScalar(1.45 * pulse * hb);
      }
    }
    for (; ri < rings.length; ri++) rings[ri].visible = false;
    for (; ai < arrows.length; ai++) arrows[ai].visible = false;
    const c = lab.ctrl && sim.a(lab.ctrl);
    ctrlRing.visible = !!c; if (c) { ctrlRing.position.set(c.x, c.y, .04); ctrlRing.material.opacity = lab.ctrlSoft ? .5 : 1; ctrlRing.scale.setScalar(1 + .04 * Math.sin(t * 4)); }
    if (hint) for (const b of btnPool) if (w.options.find(o => o.id === b.dataset.id)?.best) b.classList.add('hint');
  }

  // ---------- the frame loop ----------
  let last = performance.now(), picT = 0, stallRef = null, stallT = 0;
  const moved = () => { let s = Math.hypot(sim.ball.x || 0, sim.ball.y || 0) * 0; const now = [sim.ball.x, sim.ball.y]; for (const a of sim.agents.values()) now.push(a.x, a.y); if (!stallRef) { stallRef = now; return 1; } for (let i = 0; i < now.length; i++) s = Math.max(s, Math.abs(now[i] - (stallRef[i] ?? now[i]))); return s; };
  function frame(now) {
    requestAnimationFrame(frame);
    const ms = Math.min(100, now - last); last = now; const dt = Math.min(.05, ms / 1000);
    if (lab.started && !lab.paused && !lab.ended) lab.stats.frames.push(+ms.toFixed(1));
    try {
      if (lab.started && !lab.paused && !lab.ended) {
        lab.real += dt; lab.stats.played += dt;
        const mode = lab.win ? 'choose' : lab.waiting ? 'wait' : 'watch'; lab.stats[mode] += dt; lab.mode = mode;
        if (lab.win) {
          lab.win.age = lab.real - lab.win.t0;
          if (!lab.win.hinted && lab.win.age > (lab.win.hintAfter ?? 5)) { lab.win.hinted = true; try { lab.win.judge?.(lab.win.options); } catch (e) { console.error(e); } if (lab.win.hintLine) say(lab.win.hintLine); }
        }
        lab.slow += (lab.slowTo - lab.slow) * (1 - Math.exp(-dt * 7));
        const gdt = dt * lab.slow; lab.time += gdt;
        lab.tick?.(gdt, dt);
        // the sim in steps of at most 1/60 s, so a slow frame plays the same
        const n = Math.max(1, Math.ceil(gdt / (1 / 60))); for (let i = 0; i < n; i++) sim.step(gdt / n);
        picT += gdt;
        if (fbT > 0 && (fbT -= dt) <= 0) fb.classList.remove('show');
        if (lineT > 0 && (lineT -= dt) <= 0) lab.ui.lines = null;
        // stall watch: 3 s of play with nothing moving more than 5 cm
        if ((stallT += dt) >= 3) { if (moved() < .05) { lab.stats.stalls++; console.warn('lab: stall at', lab.real.toFixed(1)); } stallRef = null; stallT = 0; moved(); }
        if (lab.real >= lab.len) end();
      }
      moveCam(dt, !lab.started && !lab.camSnapped && (lab.camSnapped = true));
      drawMarkers(now / 1000);
      world.render(sim, cam, lab.ui, picT);
    } catch (e) { console.error(e); }
  }
  lab.run = () => { last = performance.now(); requestAnimationFrame(frame); };
  return lab;
}

// ---------- small pure helpers the prototypes share ----------
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// Closest point on segment a→b to p, from t0 on (so the passer's own feet do not count).
export function onLane(p, a, b, t0 = .12) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1, t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, t0, 1);
  const x = a.x + dx * t, y = a.y + dy * t; return { t, x, y, d: Math.hypot(p.x - x, p.y - y), along: t * Math.sqrt(l2) };
}
