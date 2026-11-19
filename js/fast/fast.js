// Fast mode: a real-time match in which he is one player the whole time and acts by tapping the field (the owner's
// spec, v84). The Slow game stays as it is; this runs instead of it while FAST.on (js/main.js hands it the frames,
// js/ui/input.js leaves it the touches). What he meets:
//  - The game's own view from behind and above his player (rules.js camSpec), looking at the ball when he does not
//    have it and at the goal he attacks when he does, never off the pitch (rules.js clampYaw).
//  - Spots on the grass round him, always there (marks.js; rules.js spots): near ring jog / close dribble, far ring
//    sprint / big push, his own ring stay.
//  - A tap on a friend he can see passes (with the ball). The pass is a real ball (match.js).
//  - The ball comes to him: his head goes down (the narrow view, the dark edge); LOOK UP, or a drag, lifts it.
//  - A finger held down slows the world (HOLD) for as long as it stays down; moving it turns his head (over the pitch
//    only). Let go and the view eases back.
//  - The avatar (top right) pauses and lets him change his player.
// Play runs at BASE of real speed. First to GOALS wins; play() resolves with the counts.
import { world, game, canvas } from '../ui/stage.js';
import { hud, hudEl } from '../ui/hud.js';
import { say } from '../ui/speech.js';
import { sfx } from '../sound.js';
import { Sim } from '../sim.js';
import { PITCH, TEAM, sizeOf } from '../geom.js';
import { held, setPause } from '../pause.js';
import { FAST, FAST_GOALS } from './state.js';
import { Match } from './match.js';
import { makeMarks, shirt } from './marks.js';
import * as R from './rules.js';
import { shotResult, spaces, EDGE as SHOT_EDGE } from '../shot.js';
import { MOVE_NAME } from '../flair.js';
import { matchShot, SAID } from '../saves.js';

export const SCAN_T = 9, CUE_EVERY = 14;
export const BASE = .75, HOLD = .18, GOALS = FAST_GOALS, HOLD_MS = R.HOLD_S * 1000, RUN_TURN = .25, BACK_S = .6, VIEW_BACK = 1;
const SLIDE = 12; // px a finger may wobble and still be a tap

const $ = s => document.querySelector(s);
function el(tag, attrs = {}, html = '') { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.innerHTML = html; return e; }
const press = (b, f) => b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); f(e); });

class Fast {
  constructor() {
    this.on = false; this.sim = new Sim(); this.cam = { eye: [16, -10, 10], tgt: [16, 11, 0], Ff: .9, Fw: .5 }; this.ui = { glow: {}, clock: 0, lines: null, aims: null };
    this.m = null; this.calm = true; this.dom = null; this.marks = null;
  }
  // ---------- the page ----------
  build() {
    if (this.dom) return;
    const box = el('div', { id: 'fastHud' }, `
      <button id="fAvatar" class="btn btn-glass btn-icon" type="button" aria-label="Change your player"></button>
      <button id="fLook" class="btn btn-gold btn-round" type="button" aria-label="Look up"><i>👀</i><span>LOOK UP</span></button>
      <button id="fAct" class="btn btn-gold btn-round" type="button"><i></i><span></span></button>
      <div id="fHold" aria-hidden="true"><i>✋</i><b>⏳</b></div>
      <div id="fSlow" aria-hidden="true"></div><div id="fChevL" class="fChev" aria-hidden="true">‹‹</div><div id="fChevR" class="fChev" aria-hidden="true">››</div>
      <div id="fFoot" class="howpick"><button id="fIn" class="btn btn-gold" type="button" aria-label="Inside of the foot"></button><button id="fLaces" class="btn btn-gold" type="button" aria-label="Laces"></button></div>
      <div id="fCue" aria-hidden="true"><i>👀</i><b>↔</b></div>
      <div id="fChips">${'<button class="fChip" type="button" aria-label="A friend you saw"><span class="ptr"></span><span class="pic"></span></button>'.repeat(4)}</div>`);
    hudEl.appendChild(box); hudEl.appendChild(el('div', { id: 'fSheet', class: 'hidden' }, '<div class="fCard"><div class="fRow"></div></div>')); // (the sheet: also before play, while the rest is hidden)
    this.dom = { box, cue: $('#fCue'), avatar: $('#fAvatar'), look: $('#fLook'), act: $('#fAct'), hold: $('#fHold'), sheet: $('#fSheet'), row: $('#fSheet .fRow'), tunnel: $('#tunnel') };
    // A press on a button (or a chip) acts as a tap; held longer it slows the world like a press anywhere (rules.js pressKind).
    press(this.dom.look, e => this.down(e, () => { this.lookUp(true); this.acted('look'); }));
    this.dom.chips = [...box.querySelectorAll('.fChip')].map(b => { const c = { b, id: null, key: '', tf: '', o: -1 }; press(b, e => this.down(e, () => { if (c.id && c.tap) { this.passTo(c.id); this.stats.chipPasses++; } })); return c; });
    press(this.dom.avatar, () => { if (!this.on || this.m?.over) return; if (!held.on) setPause(true, 'button'); this.openSheet(id => { this.setMe(id); setPause(false); }); });
    press(this.dom.act, e => this.down(e, () => this.action()));
    // the foot (inside or laces): the game's own pictures (index.html #footIn, #footLaces), a tap picks
    this.dom.foot = $('#fFoot'); for (const [id, src, foot] of [['#fIn', '#footIn', 'in'], ['#fLaces', '#footLaces', 'las']]) { const b = $(id); b.innerHTML = $(src)?.innerHTML || foot; press(b, () => this.shootWith(foot)); }
    this.marks = makeMarks(world);
    canvas.addEventListener('pointerdown', e => this.down(e));
    addEventListener('pointermove', e => this.move(e));
    addEventListener('pointerup', e => this.up(e));
    addEventListener('pointercancel', e => this.up(e, true));
  }
  ids() { return this.m ? this.m.usIds : ['hero', 'm1', 'm2', 'm3'].slice(0, sizeOf().out); }
  player(id) { return this.us.players[id === 'hero' ? 0 : +id.slice(1)]; }
  // The team as shirts: a tap picks one (before the match, and from the avatar button).
  openSheet(done) {
    const d = this.dom; d.row.innerHTML = this.ids().map(id => `<button class="btn btn-glass fPick${id === this.me ? ' me' : ''}" type="button" data-id="${id}">${shirt(this.us, this.player(id).num, 66)}<b>${this.player(id).name.split(' ').pop()}</b></button>`).join('');
    for (const b of d.row.querySelectorAll('.fPick')) press(b, () => { d.sheet.classList.add('hidden'); hudEl.classList.remove('fpicking'); done(b.dataset.id); });
    d.sheet.classList.remove('hidden'); hudEl.classList.add('fpicking');
  }
  pick(us) { this.build(); this.us = us; this.me = this.me && this.ids().includes(this.me) ? this.me : 'hero'; return new Promise(res => this.openSheet(id => { this.me = id; res(id); })); }
  setMe(id) {
    const m = this.m; if (!m || id === this.me) { this.drawAvatar(); return; }
    m.cmd.delete(this.me); this.me = m.me = m.favor = id; m.meMove = null; m.roles = null;
    this.yaw = this.natural(); this.drawAvatar(); this.lookUp(true); this.stats.swaps++;
    game.plog?.('fast', { is: 'swap', me: id });
  }
  drawAvatar() { this.dom.avatar.innerHTML = shirt(this.us, this.player(this.me).num, 40); }

  // ---------- a match ----------
  // opts: { us, them }. Resolves with the counts when one side has GOALS.
  play({ us, them }) {
    this.build(); this.us = us; this.them = them;
    const size = sizeOf(), sim = this.sim = new Sim();
    sim.on = (ev, v) => { if (ev === 'kick') { world.fx('kick', v); sfx(v >= 14 ? 'shot' : 'kick'); } else if (ev === 'touch') world.fx('touch'); };
    const m = this.m = new Match({ sim, L: PITCH.L, W: PITCH.W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, n: size.out, keepers: !!size.keeper, fx: ev => world.fx(ev), sfx: n => sfx(n) });
    m.me = m.favor = this.me || 'hero'; this.me = m.me;
    m.setup('us'); m.kickoff('us');
    this.real = 0; this.slow = this.slowTo = BASE; this.look = 1; this.up1 = true; this.yaw = 0; this.holdYaw = null; this.holdT = 0; this.finger = null; this.holding = false;
    this.ui.clock = 0; this.ui.glow = {}; this.ui.aims = null; this.ui.lines = null; this.warnAt = null; this.warnT = 0; this.over = false;
    this.seen = {}; this.chipsKey = null;
    this.aiming = this.footing = false; this.ui.ballGlow = false; this.actKind = null; this.skT = -9; m.meAuto = false; // (he wins a tackle with STEAL, not by standing there)
    this.stats = { keeperTurns: 0, saves: 0, cues: 0, shots: 0, shotGoals: 0, steals: 0, stealMiss: 0, skills: 0, chipPasses: 0, played: 0, slowT: 0, holdT: 0, holds: 0, actions: 0, looks: 0, taps: 0, swaps: 0, camN: 0, camBall: 0, camGoal: 0, frames: [], work: [], downs: 0, headDownT: 0 };
    this.yaw = this.natural(); this.camNow(1);
    hud.state({ phase: 'idle', mode: 'fast' }); hud.caption(''); hud.score(m.score, us, them);
    game.mode = 'fast'; this.drawAvatar(); this.dom.box.classList.add('on'); this.dom.hold.classList.add('show');
    FAST.on = this.on = true; this.calm = true;
    m.on.gain = (id, how) => this.gained(id, how);
    m.on.goal = team => this.goal(team);
    m.on.warn = k => { this.warnAt = k; this.warnT = this.real + 1.6; sfx('ping'); };
    m.on.theirShot = (id, res) => this.keeperTurn(id, res);
    this.lastScan = 0; this.cueT = -99; this.kBusy = false;
    m.on.lost = was => { if (was === this.me) { this.lookUp(true); say('Where is the ball?'); } };
    game.plog?.('fast', { is: 'start', size: TEAM.size, me: this.me, us: us.id, them: them.id });
    return new Promise(res => { this.done = res; });
  }
  stop() {
    FAST.on = this.on = false; this.marks?.hide(); this.dom?.box.classList.remove('on'); this.dom?.sheet.classList.add('hidden'); hudEl.classList.remove('fpicking');
    const t = this.dom?.tunnel; if (t) { t.style.opacity = 0; t.classList.remove('on'); t.style.transform = ''; }
    this.ui.glow = {}; this.ui.aims = null; this.ui.ballGlow = false; this.aiming = this.footing = false; this.dom?.foot.classList.remove('show'); this.dom?.act.classList.remove('show'); this.actKind = null; this.finger = null; this.holding = false; this.dom?.box.classList.remove('slowing');
    for (const d of this.dom?.chips || []) { d.o = 0; d.b.style.opacity = 0; d.b.style.pointerEvents = 'none'; }
  }
  counts() {
    const m = this.m, c = m.count, all = Object.values(c.touches).reduce((a, b) => a + b, 0);
    return { score: { ...m.score }, touches: c.touches[this.me] || 0, teamTouches: all, share: all ? +((c.touches[this.me] || 0) / all).toFixed(2) : 0, passes: c.passes, good: c.arrived, cut: c.cut, goals: c.goals, steals: c.steals, lost: c.lost,
      time: Math.round(this.stats.played), actions: this.stats.actions, shots: this.stats.shots, skills: this.stats.skills, stealMiss: this.stats.stealMiss, keeperTurns: this.stats.keeperTurns, saves: this.stats.saves, cues: this.stats.cues, chipPasses: this.stats.chipPasses, holds: this.stats.holds, slowS: +this.stats.slowT.toFixed(1), looks: this.stats.looks,
      camBall: this.stats.camN ? +(this.stats.camBall / this.stats.camN).toFixed(3) : null, camGoal: this.stats.camN ? +(this.stats.camGoal / this.stats.camN).toFixed(3) : null };
  }
  // ---------- events ----------
  gained(id, how) {
    const m = this.m;
    const s = this.sim, me = s.a(this.me), pressed = me && m.foes('us').some(o => Math.hypot(o.x - me.x, o.y - me.y) < 1.2);
    if (R.headDownOn(id, this.me, how) || (id === this.me && how === 'push' && pressed)) { this.lookUp(false); this.stats.downs++; } // the ball comes to him (or a heavy touch under pressure, rare): head down
    if (id !== this.me && this.up1 === false) this.lookUp(true); // (he lost it or passed it: head up)
    if (id === this.me && (how === 'tackle' || how === 'cut' || how === 'steal')) { hud.toast('🦶 Great steal!'); say('Great steal!'); }
    game.plog?.('fast', { is: 'gain', id, how });
  }
  goal(team) {
    const m = this.m, won = m.score[team] >= GOALS;
    hud.score(m.score, this.us, this.them); hud.banner(team === 'us' ? 'GOAL!' : 'Their goal', team === 'us' ? 'goal' : 'bad');
    if (team === 'us') say(m.lastOwner === this.me ? 'Great choice!' : 'Great pass!');
    game.plog?.('fast', { is: 'goal', team, us: m.score.us, them: m.score.them, by: m.lastOwner });
    this.lookUp(true); this.calm = true;
    if (won) { this.over = true; m.after(2.2, () => this.finish()); return; }
    m.after(1.8, () => m.kickoff(team === 'us' ? 'them' : 'us', () => { this.calm = false; }));
  }
  finish() {
    const c = this.last = this.counts(); game.plog?.('fast', { is: 'end', ...c, score: `${c.score.us}-${c.score.them}` });
    this.stop(); const d = this.done; this.done = null; d?.(c);
  }
  end() { if (this.on) this.finish(); } // (the grown-up's way out, and the checks)

  // ---------- his head and the camera ----------
  // Where he looks by himself (rules.js naturalYaw), turned a little (RUN_TURN) the way he runs.
  natural() {
    const s = this.sim, h = s.a(this.me), b = s.ball; if (!h) return 0;
    let y = R.naturalYaw(h, b, this.m.owner() === this.me, PITCH.L, PITCH.W); const v = h.lv;
    if (v && Math.hypot(v[0], v[1]) > 1.5) y = R.wrap(y + RUN_TURN * R.wrap(Math.atan2(v[1], v[0]) - y));
    return y;
  }
  lookUp(up) {
    if (this.up1 === up) return; this.up1 = up;
    if (up) { this.stats.looks++; sfx('up'); this.lastScan = this.real; } else sfx('down');
    const d = this.dom.look; d.classList.toggle('show', !up);
  }
  camNow(snap = 0, dt = 0) {
    const s = this.sim, h = s.a(this.me); if (!h) return;
    const w = R.camSpec(h, s.ball, s.ball.state === 'carried' && s.ball.carrier === this.me, this.yaw, this.look), k = snap ? 1 : 1 - Math.exp(-dt * 10), c = this.cam;
    for (let i = 0; i < 3; i++) { c.eye[i] += (w.eye[i] - c.eye[i]) * k; c.tgt[i] += (w.tgt[i] - c.tgt[i]) * k; }
    c.Ff += (w.Ff - c.Ff) * k; c.Fw += (w.Fw - c.Fw) * k;
  }
  // ---------- touches ----------
  // A finger goes down: on the grass (onTap: none, a tap picks what is under it) or on a button (onTap: its action).
  down(e, onTap = null) {
    if (!this.on || held.on || e.isPrimary === false || this.over || this.finger) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), f = this.finger = { id: e.pointerId, x0: e.clientX - r.left, y0: e.clientY - r.top, t0: performance.now(), yaw0: this.yaw, moved: false, held: false, w: r.width || world.width, onTap };
    f.timer = setTimeout(() => { if (this.finger === f && !held.on) this.hold(f); }, HOLD_MS);
  }
  hold(f) { if (f.held) return; f.held = true; this.lastScan = this.real; this.holding = true; this.slowTo = HOLD; this.stats.holds++; sfx('down'); this.dom.hold.classList.remove('show'); this.dom.box.classList.add('slowing'); }
  move(e) {
    const f = this.finger; if (!f || e.pointerId !== f.id || held.on) return;
    const r = canvas.getBoundingClientRect(), dx = e.clientX - r.left - f.x0, dy = e.clientY - r.top - f.y0;
    if (!f.moved && Math.hypot(dx, dy) > SLIDE) { f.moved = true; clearTimeout(f.timer); this.hold(f); this.lookUp(true); }
    if (f.moved) { const h = this.sim.a(this.me); this.holdYaw = h ? R.clampYaw(h, f.yaw0 - dx / f.w * 3.2, PITCH.L, PITCH.W) : null; }
  }
  up(e, cancel = false) {
    const f = this.finger; if (!f || e.pointerId !== f.id) return; this.finger = null; clearTimeout(f.timer);
    if (f.held) { this.holding = false; this.slowTo = BASE; this.holdT = this.real + VIEW_BACK; sfx('up'); this.dom.box.classList.remove('slowing'); return; } // (play eases back over BACK_S; the view stays where he left it a moment, then eases back)
    if (cancel || f.moved || held.on || !this.on) return;
    if (f.onTap) f.onTap(); else { const r = canvas.getBoundingClientRect(); this.tap(e.clientX - r.left, e.clientY - r.top); }
  }
  // What a tap can pick now: his friends he can see (with the ball: a pass), and the spots.
  options() {
    const s = this.sim, m = this.m, me = s.a(this.me), out = []; if (!me || m.dead) return out;
    if (m.owner() === this.me) for (const id of m.usIds) if (id !== this.me && s.a(id)) out.push({ kind: 'pass', id, p: s.a(id) });
    for (const sp of this.spots || []) out.push({ kind: 'spot', sp, p: sp });
    return out;
  }
  seen(p, z = 0) { const q = world.project(p.x, p.y, z); return !!q && R.onScreen(q, world.width, world.height); }
  tap(x, y) {
    if (this.aiming && !this.footing) return this.aimAt(x, y);
    if (!this.on || this.m.dead || this.aiming) return null;
    const reach = Math.max(60, Math.min(world.width, world.height) * .16);
    let best = null, bd = 1e9;
    for (const o of this.options()) {
      for (const z of o.kind === 'pass' ? [.9, 0] : [0]) {
        const q = world.project(o.p.x, o.p.y, z); if (!q || !R.onScreen(q, world.width, world.height)) continue;
        const d = Math.hypot(q[0] - x, q[1] - y) * (o.kind === 'pass' ? .8 : 1); if (d < bd) { bd = d; best = o; } // (a friend wins a close call: his body is what he aims at)
      }
    }
    this.stats.taps++;
    if (!best || bd > reach) { sfx('tap'); return null; }
    if (best.kind === 'pass') this.passTo(best.id); else this.goSpot(best.sp);
    return best;
  }
  passTo(id) {
    const m = this.m, c = m.passCheck(this.me, id); this.acted('pass');
    m.pass(this.me, id); sfx(c.open ? 'star' : 'tap', c.open ? 1 : undefined);
    game.plog?.('fast', { is: 'pass', to: id, open: c.open ? 1 : 0, why: c.why });
  }
  goSpot(sp) { this.m.meTo(sp.x, sp.y, sp.ring); this.acted(sp.ring === 0 ? 'stay' : sp.ring === 2 ? 'far' : 'near'); }
  acted(kind) { this.stats.actions++; this.lastAct = this.real; this.dom.hold.classList.remove('show'); void kind; }
  // ---------- the scan reminder ----------
  // He has not looked round (a hold, a drag, LOOK UP) for SCAN_T s, and someone who matters is out of his view: a friend
  // within 14 m of him or one of theirs within 4 m (behind him, say). A small picture (eyes, a turn) and a spoken word;
  // at most every CUE_EVERY s. It goes as soon as he looks.
  scanCue(h) {
    const s = this.sim, m = this.m, c = this.dom.cue; if (!h || m.dead || this.real - this.cueT > 4) { if (c.classList.contains('show')) c.classList.remove('show'); if (!h || m.dead) return; }
    if (this.real - this.lastScan < 1) { if (c.classList.contains('show')) c.classList.remove('show'); return; }
    if (this.real - this.lastScan < SCAN_T || this.real - this.cueT < CUE_EVERY || this.aiming) return;
    const near = (team, r) => (team === 'us' ? m.usIds.filter(id => id !== this.me) : m.themIds).map(id => s.a(id)).filter(a => a && Math.hypot(a.x - h.x, a.y - h.y) < r);
    const unseen = [...near('us', 14), ...near('them', 4)].some(a => !this.seen1(a, .9) && !this.seen1(a, 0));
    if (!unseen) return;
    this.cueT = this.real; this.stats.cues++; c.classList.add('show'); say('Check your shoulder!'); sfx('ping');
    game.plog?.('fast', { is: 'cue' });
  }
  // ---------- the keeper turn (5 v 5) ----------
  // Their clear shot at our goal: he plays our keeper for it, with the keeper game's own moment (js/game/goalie.js
  // inMatch: the camera to the keeper's view, where to stand, where to dive), set up as the Slow match sets it
  // (js/game/handover.js keeperShot, copied). Easier when the score is level or he is behind (a longer look at the
  // shooter), harder when his team leads (a shorter look).
  keeperTurn(id) {
    const m = this.m; if (!this.goalie || !m.keeper('us') || this.over || this.kBusy || !this.on) return false;
    if (!m.shotCheck(id).good) return false;
    this.kBusy = true; this.keeperMoment(id).catch(e => { console.error(e); this.kBusy = false; this.on = true; });
    return true;
  }
  async keeperMoment(shooter) {
    const s = this.sim, m = this.m, o = s.a(shooter), cy = PITCH.W / 2, TOUCH = .9, KEEP_OUT = 4.2;
    const start = { x: o.x, u: o.y - cy }, d = Math.hypot(start.x, start.u) || 1;
    let dir = { x: -start.x / d, u: -start.u / d }; if (start.x + dir.x * TOUCH < KEEP_OUT) dir = { x: 0, u: -Math.sign(start.u) || 1 };
    const from = { x: Math.max(KEEP_OUT, start.x + dir.x * TOUCH), u: start.u + dir.u * TOUCH };
    const spec = matchShot(from, start, Math.random()), lead = m.score.us - m.score.them, k = lead > 0 ? .7 : 1.2;
    spec.dive *= k; spec.stand *= k;
    this.stats.keeperTurns++; game.plog?.('fast', { is: 'keeper', shooter, lead, zone: spec.zone });
    s.stopAll(); m.flight = null; this.finger = null; this.holding = false; this.endAim(); this.slowTo = this.slow = BASE;
    this.on = false; this.marks.hide(); this.dom.box.classList.remove('on'); const t = this.dom.tunnel; t.style.opacity = 0; t.classList.remove('on'); this.edgeO = 0;
    hud.caption('🧤 ' + SAID.youre); say(SAID.youre);
    const g = { sim: s, cam: this.cam, ui: this.ui };
    let r; try { r = await this.goalie.inMatch(g, spec, shooter); } catch (e) { console.error(e); r = { res: 'goal' }; }
    hud.caption(''); this.cam = g.cam; this.on = true; this.dom.box.classList.add('on'); this.kBusy = false;
    game.plog?.('fast', { is: 'keeperEnd', res: r?.res });
    if (r?.res === 'save') { this.stats.saves++; m.giveTo('k1', 'save'); hud.toast('🧤 Saved!'); }
    else m.goal('them');
  }

  // ---------- the one action button ----------
  // SHOOT: he has the ball within SHOT_EDGE m of the goal. SKILL: he has it, on the move, and one of theirs comes at him.
  // STEAL: one of theirs has it within reach of him (the ball glows when it is off the carrier's foot: rules.js stealNow).
  actionNow() {
    const s = this.sim, m = this.m, me = s.a(this.me); if (!me || m.dead || this.over) return null;
    const c = m.owner();
    if (c === this.me) {
      const d = Math.hypot(PITCH.L - me.x, PITCH.W / 2 - me.y), h = s.ball.h ?? 0;
      const at = m.foes('us').find(o => { const dx = o.x - me.x, dy = o.y - me.y, l = Math.hypot(dx, dy); return l < 3.2 && l > .3 && (dx * Math.cos(h) + dy * Math.sin(h)) / l > .35; });
      const moving = (me.sp || 0) > .8 || (m.meMove && s.time < m.meMove.until);
      if (at && moving && d > 4 && s.time - this.skT > 2.5) return 'skill';
      if (d <= SHOT_EDGE) return 'shoot';
      return null;
    }
    if (c && m.team(c) === 'them' && R.stealShown(s.a(c), me) && m.meMove?.kind !== 'lunge') return 'steal';
    return null;
  }
  drawAction(k) {
    if (k === this.actKind) return; this.actKind = k; const b = this.dom.act;
    b.classList.toggle('show', !!k); if (!k) return;
    b.dataset.kind = k; const [i, t] = k === 'shoot' ? ['🥅', 'SHOOT'] : k === 'steal' ? ['🦶', 'STEAL'] : ['✨', 'SKILL'];
    b.querySelector('i').textContent = i; b.querySelector('span').textContent = t; b.setAttribute('aria-label', t);
  }
  action() {
    const k = this.actionNow(); if (!k || !this.on || held.on) return;
    this.acted(k);
    if (k === 'shoot') this.aim(); else if (k === 'steal') this.steal(); else this.skill();
  }
  // SHOOT: the world nearly stops, his head comes up to the goal, the six targets show (the game's own); a tap on one,
  // then the foot; then it plays (js/shot.js shotResult says what it does).
  aim() {
    this.aiming = true; this.footing = false; this.slowTo = .08; this.lookUp(true); this.holdT = 0; this.aimT = this.real;
    this.ui.aims = spaces().map(z => ({ x: PITCH.L + .02, y: z.y, z: z.z, id: z.id }));
    sfx('ping'); game.plog?.('fast', { is: 'aim' });
  }
  aimAt(x, y) {
    let best = null, bd = 1e9;
    for (const a of this.ui.aims || []) { const q = world.project(a.x, a.y, a.z); if (!q) continue; const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = a; } }
    if (!best || bd > Math.max(70, world.height * .2)) { sfx('tap'); return null; }
    this.zone = best.id; this.ui.aims = [best]; this.footing = true; this.dom.foot.classList.add('show'); sfx('click');
    return best;
  }
  shootWith(foot) {
    if (!this.footing || !this.on || held.on) return;
    const s = this.sim, m = this.m, me = s.a(this.me), k = m.keeper('them');
    this.endAim();
    if (m.owner() !== this.me || !me) return;
    const res = shotResult({ from: { x: me.x, y: me.y }, zone: this.zone, foot, k: k && { x: k.x, y: k.y }, gx: PITCH.L, rand: Math.random, defs: m.foes('us').map(o => ({ x: o.x, y: o.y, id: o.id })) });
    if (res.res === 'cleared' && res.by) res.by = { id: m.foes('us').reduce((p, o) => (Math.hypot(o.x - res.by.x, o.y - res.by.y) < Math.hypot(p.x - res.by.x, p.y - res.by.y) ? o : p)).id };
    this.stats.shots++; if (res.res === 'goal') this.stats.shotGoals++;
    m.shoot(this.me, res); this.slowTo = .35; m.after(.9, () => { if (!this.holding) this.slowTo = BASE; }); // (it plays a little slow, so he sees it go)
    if (res.res === 'save') say('Saved!'); else if (res.res === 'over' || res.res === 'wide') say('So close!');
    game.plog?.('fast', { is: 'shot', zone: this.zone, foot, res: res.res });
  }
  endAim() { this.aiming = this.footing = false; this.ui.aims = null; this.dom.foot.classList.remove('show'); if (!this.holding) this.slowTo = BASE; }
  // STEAL: in time it is his (shown slow); too soon or too late he lunges, is slowed, and the carrier gets past.
  steal() {
    const r = this.m.steal(); if (!r) return;
    if (r === 'won') { this.stats.steals++; this.slowTo = .3; this.m.after(.5, () => { if (!this.holding) this.slowTo = BASE; }); }
    else { this.stats.stealMiss++; sfx('tap'); this.slowTo = .45; this.m.after(.6, () => { if (!this.holding) this.slowTo = BASE; }); }
    game.plog?.('fast', { is: 'steal', res: r });
  }
  // SKILL: one move, in slow motion, toward the open side (the side away from the defender who comes at him): a skill
  // turn from the game's own moves (js/sim.js startTurn with a tapped move, drawn by js/pro/motion.js; names from
  // js/flair.js). The defender is fooled a moment.
  skill() {
    const s = this.sim, m = this.m, me = s.a(this.me), b = s.ball; if (!me || m.owner() !== this.me) return;
    const h = b.h ?? 0, foe = m.foes('us').filter(o => Math.hypot(o.x - me.x, o.y - me.y) < 4).sort((p, q) => Math.hypot(p.x - me.x, p.y - me.y) - Math.hypot(q.x - me.x, q.y - me.y))[0];
    const side = foe ? -Math.sign((foe.y - me.y) * Math.cos(h) - (foe.x - me.x) * Math.sin(h)) || 1 : 1; // (+1: to his left)
    let a = h + side * 1.05; const tx = R.clamp(me.x + Math.cos(a) * 4, 1, PITCH.L - 1), ty = R.clamp(me.y + Math.sin(a) * 4, 1, PITCH.W - 1);
    if (Math.hypot(tx - me.x - Math.cos(a) * 4, ty - me.y - Math.sin(a) * 4) > .5) a = h - side * 1.05; // (no room that side: the other way)
    const kinds = ['double', 'chop', 'roll'].filter(k => k !== 'roll' || (me.sp || 0) < 2.6), k = kinds[Math.floor(Math.random() * kinds.length)];
    s.flair = { ctx: 'fast', by: { [this.me]: { p: 1, can: ['double', 'chop', 'roll', 'croqueta', 'cruyff'], fav: [], tier: 'star' } } }; s.taps = new Set([this.me]); me.turnTap = k; me.skT = -9;
    m.dribble(this.me, me.x + Math.cos(a) * 4, me.y + Math.sin(a) * 4, 3.4, 1.6); m.meMove = { kind: 'near', until: s.time + 1.6 };
    s.step(0); // (the turn starts now)
    const mv = b.move?.k || k;
    this.skT = s.time; this.stats.skills++; m.safeT = s.time + 1.3;
    if (foe) { s.go(foe.id, foe.x, foe.y, 0); m.cmd.set(foe.id, s.time + .9); } // fooled: he stops a moment
    this.slowTo = .3; m.after(.9, () => { if (!this.holding) this.slowTo = BASE; s.flair = null; s.taps = null; });
    hud.toast('✨ ' + (MOVE_NAME[mv] || 'Skill') + '!'); say((MOVE_NAME[mv] || 'Skill') + '!'); world.fx('skill');
    game.plog?.('fast', { is: 'skill', move: mv });
  }

  // ---------- one frame ----------
  // dt: real seconds (none while paused: js/pause.js).
  tick(dt) {
    if (!this.on || !dt) return;
    const t0 = performance.now(), s = this.sim, m = this.m, st = this.stats;
    this.real += dt; st.played += dt;
    this.slow += (this.slowTo - this.slow) * (1 - Math.exp(-dt * (this.slowTo > this.slow ? 3 / BACK_S : 8))); // (back up to speed over about BACK_S s)
    const gdt = dt * this.slow; if (this.slow < BASE * .9) st.slowT += dt; if (this.holding) st.holdT += dt; if (!this.up1) st.headDownT += dt;
    m.step(gdt);
    const n = Math.max(1, Math.ceil(gdt / (1 / 60))); for (let i = 0; i < n; i++) s.step(gdt / n);
    this.ui.clock += gdt;
    this.calm = m.dead;
    const h = s.a(this.me), has = m.owner() === this.me;
    // his head: down only after the ball came to him; the camera looks where he would, or where he holds it
    this.look += ((this.up1 ? 1 : 0) - this.look) * (1 - Math.exp(-dt * 6));
    const nat = this.natural();
    if (this.finger?.moved && this.holdYaw != null) this.yaw = this.holdYaw;
    else if (this.real > this.holdT) { const d = R.wrap(nat - this.yaw); this.yaw = R.wrap(this.yaw + d * (1 - Math.exp(-dt * 2.4))); this.holdYaw = null; }
    if (h) this.yaw = R.clampYaw(h, this.yaw, PITCH.L, PITCH.W, Math.min(R.LOOK_MIN, R.reachOut(h, nat, PITCH.L, PITCH.W))); // (never off the pitch; the ball or the goal near a line still in view)
    this.camNow(0, dt);
    // the spots round him, the glow on friends he can pass to, the warning on a defender about to tackle
    this.spots = h && !m.dead && !this.aiming ? R.spots(h, [...s.agents.values()].filter(a => a.id !== this.me), PITCH.L, PITCH.W) : [];
    for (const id of m.usIds) this.ui.glow[id] = has && id !== this.me ? .5 : 0;
    // the action button, the ball's glow for a steal in time, and a shot he did not finish
    this.drawAction(this.aiming ? null : this.actionNow());
    this.scanCue(h);
    const c = m.owner(); this.ui.ballGlow = this.actKind === 'steal' && !!c && R.stealNow(s.a(c), s.ball, h); this.stealGlow = this.ui.ballGlow;
    if (this.aiming && (m.owner() !== this.me || this.real - this.aimT > 8)) this.endAim();
    if (this.aiming) this.yaw = R.wrap(this.yaw + R.wrap(Math.atan2(PITCH.W / 2 - h.y, PITCH.L - h.x) - this.yaw) * (1 - Math.exp(-dt * 6)));
    if (this.warnAt && (this.real > this.warnT || !has)) this.warnAt = null;
    this.marks.draw(this.spots, h, has, this.ui.clock, this.warnAt && s.a(this.warnAt), !m.dead);
    this.edge(h); this.chips(h, has);
    // the counts: where the camera he did not move looks (the ball on screen, the goal he attacks on screen)
    if (!this.finger?.moved && this.real > this.holdT && h && !m.dead) {
      st.camN++; const b = s.ball; if (R.onScreen(R.project(this.cam, { x: b.x, y: b.y, z: b.z || 0 }, world.width, world.height), world.width, world.height)) st.camBall++;
      if (R.onScreen(R.project(this.cam, { x: PITCH.L, y: PITCH.W / 2, z: .8 }, world.width, world.height), world.width, world.height)) st.camGoal++;
    }
    const w = performance.now() - t0; st.work.push(w); if (st.work.length > 20000) st.work.splice(0, 10000); (this.workAll ||= []).push(w); if (this.workAll.length > 60000) this.workAll.splice(0, 30000);
  }
  // Friends he saw who are off screen now: a chip at the edge toward where he last saw them (rules.js chipList, edgeAt),
  // their shirt and a pointer; gold and a pass when tapped while he has the ball. Never over each other or the buttons.
  chips(h, has) {
    const s = this.sim, w = world.width, hh = world.height, now = this.real, list = [];
    for (const id of this.m.usIds) {
      if (id === this.me) continue; const a = s.a(id); if (!a) continue;
      const on = !this.m.dead && (this.seen1(a, .9) || this.seen1(a, 0)), sn = this.seen[id] ||= { seenAt: null, x: 0, y: 0 };
      if (on) { sn.seenAt = now; sn.x = a.x; sn.y = a.y; }
      list.push({ id, seenAt: this.m.dead ? null : sn.seenAt, on });
    }
    const chips = h ? R.chipList(list, now, has) : [], placed = [];
    for (const c of chips) {
      const sn = this.seen[c.id], q = world.project(sn.x, sn.y, .9);
      let p;
      if (q) p = R.edgeAt(q, false, w, hh, 34);
      else { const rel = R.wrap(Math.atan2(sn.y - h.y, sn.x - h.x) - this.yaw); p = [rel > 0 ? 34 : w - 34, hh * .62]; }
      p[1] = R.clamp(p[1], 84, hh - 150); // (clear of the score at the top and of LOOK UP and the action button at the bottom)
      for (let k = 0; k < 4; k++) for (const o of placed) if (Math.hypot(o[0] - p[0], o[1] - p[1]) < 58) p[1] = p[1] + 60 > hh - 150 ? p[1] - 60 : p[1] + 60;
      placed.push(p); c.p = p; c.ang = Math.atan2((q ? q[1] : hh * .62) - p[1], (q ? q[0] : p[0] < w / 2 ? -1e3 : 1e4) - p[0]);
    }
    this.dom.chips.forEach((d, i) => {
      const c = chips[i]; d.id = c?.id || null; d.tap = !!c?.tap;
      const o = c ? Math.round(c.alpha * 20) / 20 : 0; if (o !== d.o) { d.o = o; d.b.style.opacity = o; d.b.style.pointerEvents = o > .05 ? 'auto' : 'none'; }
      if (!c) return;
      const key = c.id + (c.gold ? 'g' : ''); if (key !== d.key) { d.key = key; d.b.querySelector('.pic').innerHTML = shirt(this.us, this.player(c.id).num, 30); d.b.classList.toggle('gold', c.gold); }
      const tf = `translate(${Math.round(c.p[0] - 24)}px,${Math.round(c.p[1] - 24)}px)`; if (tf !== d.tf) { d.tf = tf; d.b.style.transform = tf; }
      d.b.style.setProperty('--a', Math.round(c.ang * 57.3 / 5) * 5 + 'deg');
    });
  }
  seen1(p, z) { const q = world.project(p.x, p.y, z); return !!q && R.onScreen(q, world.width, world.height, 10); }
  // The head-down edge (#tunnel, as js/ui/hud.js draws it): its clear middle on his player, opacity by how far down.
  edge(h) {
    const t = this.dom.tunnel; if (!t) return;
    const o = Math.round((1 - this.look) * 95) / 100;
    if (o !== this.edgeO) { this.edgeO = o; t.style.opacity = o; t.classList.toggle('on', o > .02); }
    if (o <= .02 || !h) return;
    const q = world.project(h.x, h.y, .9); if (!q) return;
    const ax = q[0] / world.width * 100, ay = q[1] / world.height * 100, body = document.body.classList;
    if (body.contains('smooth') && !body.contains('blur')) { const tx = `translate(${Math.round(ax) - 50}vw, ${Math.round(ay) - 64}vh)`; if (tx !== this.edgeT) { this.edgeT = tx; t.style.transform = tx; } }
    else { const k = `${Math.round(ax)} ${Math.round(ay)}`; if (k !== this.edgeT) { this.edgeT = k; t.style.setProperty('--tx', Math.round(ax) + '%'); t.style.setProperty('--ty', Math.round(ay) + '%'); } }
  }
}

export const fast = new Fast();
if (typeof window !== 'undefined') Object.assign(window, { __fast: fast, __fastWorld: world, __held: held, get __fastL() { return PITCH.L; }, get __fastW() { return PITCH.W; } }); // (for the checks and the console, as window.__game)
