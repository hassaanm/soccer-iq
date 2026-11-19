// One player, free play: the shared match for Lab E (flowing), H (hold to think) and I (coach asks). Lab D runs the
// same match (common/match.js, onball.js, offball.js, eyes.js) with its own announced decisions.
// He picks one of the four and is him all match, in his own view (eyes.js). Play runs at one calm speed and he acts
// whenever he wants: tap the ground to run there (or dribble, with the ball), tap a friend he can see to pass, tap the
// goal to shoot, drag to turn his head. His player moves only when he says so. Friends favour him (FAVOR to 1).
// Nobody tackles him while he stands on the ball (a dribble into a defender can lose it). After 4 s with nothing done, a
// hint pulses the best option and a word is said. A clearly bad pass, shot or dribble can freeze play for 1.5 s to show
// why (the blocked line in red, the better option in green), on a switch in the pause sheet.
// The variants add: opt.hold (H: a held finger slows the world), opt.ask (I: now and then a near-freeze with one question).
import { boot, dist, clamp } from './lab.js';
import { Match } from './match.js';
import { judgeBall } from './onball.js';
import { runSpots, guardSpots, judgeSpot } from './offball.js';
import { eyes, avatar, shirt, wrap } from './eyes.js';

export const FAVOR = 1.6;
const IDS = ['hero', 'm1', 'm2', 'm3'];

export async function onePlayer(cfg) {
  let me = 'hero';
  const lab = await boot({ ...cfg, size: '4v4', us: 'barca', them: 'madrid', tapOnUp: true, mustSee: true,
    picker: l => ({ title: 'Who are you?', items: IDS.map(id => { const p = l.us.players[id === 'hero' ? 0 : +id.slice(1)]; return { id, html: `${shirt(l.us, p.num, 70)}<b>${p.name}</b>` }; }) }),
    onPick: id => setMe(id), onStart: () => { lastAct = lab.real; },
    mode: () => lab.waiting || lab.real < lab.frozenT ? 'wait' : lab.win || m.owner() === me || lab.real < actUntil || view.holding ? 'choose' : 'watch' });
  const { sim, L, W } = lab;
  const m = new Match(lab, { n: 4, isAI: id => id !== me });
  m.favor = me; m.favorW = FAVOR; m.manual = me; lab.__m = m; // (for the checks)
  m.tackleT = { us: .4, them: .7 }; m.aiSpeed = { them: 2.7 }; // (a slight tilt to his team: his friends win it back sooner, so he gets more of the ball)
  m.setup('us');
  lab.base = lab.slowTo = cfg.base;
  const view = eyes(lab, { me, hold: cfg.hold, natural: () => { const h = sim.a(me), b = sim.ball; if (!h) return null; return m.owner() === me ? Math.atan2(W / 2 - h.y, L - h.x) : Math.atan2(b.y - h.y, b.x - h.x); } });
  const av = avatar(lab, IDS, me, id => setMe(id));
  const touches = Object.fromEntries(IDS.map(id => [id, 0]));
  const S = lab.sight = { moments: 0, offAtStart: 0, foundByLook: 0, looks: 0 };
  let actUntil = 0, lastAct = 0, hint = null, job = null, moment = null, why = cfg.why !== false, freeT = 0;
  lab.ctrl = me;
  const ctx = { lab, m, view, get me() { return me; }, touches, act: () => { lastAct = lab.real; hint = null; } };

  function setMe(id) { m.cmd.delete(me); me = id; view.me = id; m.favor = id; m.manual = id; lab.ctrl = id; av.draw(id); lab.close(); job = null; hint = null; view.snap(); lastAct = lab.real; }

  // ---------- the speed chips and the why switch on the pause sheet ----------
  const card = document.querySelector('#pauseS .card'), chips = document.createElement('div'); chips.className = 'chips';
  const speeds = cfg.speeds || [['🐢 Slower', cfg.base * .72], ['Calm', cfg.base], ['🐇 Faster', cfg.base * 1.3]];
  chips.innerHTML = `<small>Speed of play</small>${speeds.map(([t, v], i) => `<button class="lb glass ${i === 1 ? 'on' : ''}" data-v="${v}">${t}</button>`).join('')}`
    + (cfg.whySwitch ? `<small>After a clear mistake</small><button class="lb glass ${why ? 'on' : ''}" data-why="1">⏸ Freeze 1.5 s and show why</button><button class="lb glass ${why ? '' : 'on'}" data-why="0">▶ Play straight on</button>` : '');
  card.insertBefore(chips, card.querySelector('.row:last-child'));
  for (const b of chips.querySelectorAll('button')) b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation();
    if (b.dataset.v) { lab.base = +b.dataset.v; for (const x of chips.querySelectorAll('[data-v]')) x.classList.toggle('on', x === b); }
    else { why = b.dataset.why === '1'; for (const x of chips.querySelectorAll('[data-why]')) x.classList.toggle('on', x === b); } });

  // ---------- what he can tap now (rings on his friends while he has the ball, the goal when it is near) ----------
  function freeOptions() {
    const out = [];
    if (m.owner() === me && !m.dead) {
      for (const f of IDS) if (f !== me && sim.a(f)) out.push({ id: 'pass:' + f, kind: 'player', who: f, act: 'pass', to: f });
      if (L - sim.a(me).x < 17) out.push({ id: 'shoot', kind: 'goal', act: 'shoot' });
    }
    if (hint) { const h = out.find(o => o.id === hint.id); if (h) h.best = true; else out.push({ ...hint, best: true }); }
    return out;
  }
  // the best thing to do now (for the hint and the checks)
  function bestNow() {
    const c = m.owner(); if (!c || m.dead) return null;
    if (c === me) { const os = [...IDS.filter(f => f !== me).map(f => ({ id: 'pass:' + f, kind: 'player', who: f, act: 'pass', to: f })), ...(L - sim.a(me).x < 17 ? [{ id: 'shoot', kind: 'goal', act: 'shoot' }] : []), { id: 'run', kind: 'arrow', who: me, ang: clamp(Math.atan2(W / 2 - sim.a(me).y, L - sim.a(me).x), -.9, .9), act: 'run' }];
      judgeBall(lab, m, me, os); const b = os.find(o => o.best); if (!b) return null;
      if (b.act === 'run') { const a = sim.a(me); return { id: 'go', kind: 'spot', x: clamp(a.x + Math.cos(b.ang) * 3.5, 1, L - 1), y: clamp(a.y + Math.sin(b.ang) * 3.5, 1, W - 1), line: b.line, act: 'run' }; }
      return { ...b, line: b.act === 'pass' ? 'see who is open' : b.line }; }
    const os = m.team(c) === 'us' ? runSpots(lab, m, me, c) : guardSpots(lab, m, me), b = os.find(o => o.best);
    return b && { ...b, id: 'hint:' + b.id, line: m.team(c) === 'us' ? 'get open' : 'one goes one guards' };
  }
  lab.bestNow = bestNow;

  // ---------- his actions ----------
  const freeze = (lines, word, line) => { if (!why) { lab.feedback(false, word); lab.say(line); return; } lab.frozenT = lab.real + 1.5; lab.showLines(lines, 2.2); lab.feedback(false, word); lab.say(line); };
  function noteMoment(target) { if (!moment) return; if (moment.off) { S.offAtStart++; if (view.looks > moment.looks0 && target && view.sees(target)) S.foundByLook++; } S.looks += view.looks - moment.looks0; moment = null; }
  function pass(to, asked = false) {
    const c = m.passCheck(me, to), a = sim.a(me), b = sim.a(to); noteMoment({ x: b.x, y: b.y, z: .7 }); ctx.act();
    const best = bestNow();
    if (!asked) lab.record('pass', 'pass:' + to, c.open, best?.id === 'pass:' + to, c.open ? 'Open!' : c.why === 'lane' ? 'In the way!' : 'Guarded!', c.open ? '👍' : '✋', '', true);
    if (c.open && !asked) lab.sfx('star', 1);
    m.hold = false; m.pass(me, to, c.open ? null : c.by);
    if (!c.open && !asked) { const g = best && best.act === 'pass' ? sim.a(best.to) : null; freeze([{ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, color: '#ff5a4a' }, ...(g ? [{ a: { x: a.x, y: a.y }, b: { x: g.x, y: g.y }, color: '#3ddc84' }] : [])], c.why === 'lane' ? 'In the way!' : 'Guarded!', c.why === 'lane' ? 'he was in the way of the pass' : 'a defender was right there'); }
  }
  function shoot() {
    const c = m.shotCheck(me); noteMoment({ x: L, y: W / 2, z: .8 }); ctx.act();
    lab.record('shoot', 'shoot', c.good, c.good, c.good ? 'Shoot!' : c.why === 'far' ? 'Too far!' : 'Blocked!', c.good ? '🥅' : '✋', c.good ? 'great choice' : '', true);
    m.hold = false; m.shoot(me, c);
    if (!c.good) freeze([], c.why === 'far' ? 'Too far!' : 'Blocked!', c.why === 'far' ? 'too far to shoot get closer first' : 'a defender was in the way dribble around him then shoot');
  }
  function ground(p, asked = false) {
    const a = sim.a(me); if (!a || m.dead) return;
    ctx.act();
    if (m.owner() === me) {
      const ang = Math.atan2(p.y - a.y, p.x - a.x), d = Math.min(5, Math.max(1.5, dist(a, p))), c = m.runCheck(me, ang); noteMoment(p);
      const tx = clamp(a.x + Math.cos(ang) * d, 1, L - 1), ty = clamp(a.y + Math.sin(ang) * d, 1, W - 1);
      lab.record('dribble', 'run', c.good, false, c.good ? 'Space!' : 'Defender!', c.good ? '🏃' : '✋', '', true);
      m.hold = false; m.protect = c.good ? me : null; m.dribble(me, tx, ty, c.good ? 3.8 : 3.4, d / 3.4 + .3); actUntil = lab.real + (d / 3.4 + .3) / lab.base;
      if (!c.good) { m.pressThem = c.by || null; freeze([{ a: { x: a.x, y: a.y }, b: { x: tx, y: ty }, color: '#ff5a4a' }], 'Defender!', 'a defender was right there'); }
      return;
    }
    const tx = clamp(p.x, .8, L - .8), ty = clamp(p.y, .8, W - .8), j = judgeSpot(lab, m, me, { x: tx, y: ty });
    if (!asked) { lab.record('move', 'move', j.good, false, j.word, j.good ? '👍' : '✋', j.line || '', true); if (!j.good) lab.feedback(false, j.word); }
    sim.go(me, tx, ty, 4.6); actUntil = lab.real + dist(a, { x: tx, y: ty }) / 4.6 / lab.base;
    const c = m.owner(); job = null;
    if (c && m.team(c) === 'them') { if (dist({ x: tx, y: ty }, sim.a(c)) < 2.5) { job = { press: true }; m.pressUs = null; } else m.pressUs = 'auto'; }
  }
  ctx.pass = pass; ctx.ground = ground; ctx.bestNow = bestNow;
  lab.onFree = o => { if (o.act === 'pass') pass(o.to); else if (o.act === 'shoot') shoot(); else if (o.kind === 'spot') ground({ x: o.x, y: o.y }); };
  lab.onGround = p => { if (lab.win) return; ground(p); };

  // ---------- the match's events ----------
  const prevGain = cfg.onGain;
  m.on.gain = (id, how) => {
    job = null; m.protect = null; hint = null; lastAct = lab.real; m.hold = id === me;
    if (m.team(id) === 'us') {
      touches[id]++; m.pressUs = null;
      if (id === me) { view.setUp(false); m.hold = true; S.moments++; const mo = moment = { off: false, looks0: view.looks }; setTimeout(() => { if (moment === mo && m.owner() === me) { const b = bestNow(); mo.off = !!b && b.kind === 'player' && !lab.seen(b); } }, 700); if ((how === 'tackle' || how === 'cut') ) { lab.feedback(true, 'Our ball!', '💪'); lab.say('great steal'); } }
    } else { m.pressUs = 'auto'; if (how !== 'pass' && how !== 'kickoff') lab.feedback(false, 'Their ball', '🔄'); }
    prevGain?.(ctx, id, how);
  };
  m.on.goal = team => {
    lab.close(); lab.waiting = true; m.hold = false; m.pressUs = null; job = null;
    lab.feedback(team === 'us', team === 'us' ? 'GOAL!' : 'Their goal', team === 'us' ? '⚽' : '😮'); lab.say(team === 'us' ? 'great choice' : 'good try'); showScore();
    // his player jogs back too (he is moved only by him in play, but a kick-off places everyone)
    setTimeout(() => m.kickoff(team === 'us' ? 'them' : 'us', () => { lab.waiting = false; m.cmd.delete(me); }), 1800);
  };
  const showScore = () => lab.setScore(`<i>${lab.us.short}</i> ${m.score.us} – ${m.score.them} <i>${lab.them.short}</i>`);
  showScore();
  const share = () => { const all = Object.values(touches).reduce((a, b) => a + b, 0); return all ? touches[me] / all : 0; };
  lab.extra = () => ({ ...S, actions: lab.stats.actions || 0, holds: view.holds, heldS: +(lab.stats.held || 0).toFixed(1), touches, meShare: +share().toFixed(2), favor: FAVOR, score: m.score, asks: lab.asks });
  lab.onEnd = () => `<div><b>${m.score.us}–${m.score.them}</b><small>⚽ score</small></div><div><b>${touches[me]}</b><small>🙋 his touches</small></div>`;

  lab.tick = dt => {
    m.step(dt);
    if (view.holding) lab.stats.held = (lab.stats.held || 0) + (lab.real - (lab._hl ?? lab.real)); lab._hl = lab.real;
    // standing on the ball again after a dribble: nobody tackles him while he thinks
    if (m.owner() === me && !m.cmd.has(me)) { m.hold = true; m.protect = null; }
    // pressing the carrier (he went right at him): stay on him, goal-side
    if (job?.press) { const c = m.owner(); if (!c || m.team(c) !== 'them') job = null; else { const ca = sim.a(c), gx = -ca.x, gy = W / 2 - ca.y, gl = Math.hypot(gx, gy) || 1; sim.go(me, ca.x + gx / gl * .4, ca.y + gy / gl * .4, 4.2); } }
    // the hint, after 4 s of nothing
    if (!hint && !lab.win && lab.real - lastAct > 4 && !m.dead && !lab.waiting) { const b = bestNow(); if (b) { hint = b; lab.say(b.line); lab.sfx('ping'); } }
    if ((freeT += dt) > .1) { freeT = 0; lab.freeWin = lab.win ? null : { options: freeOptions(), hinted: !!hint }; }
    cfg.tick?.(ctx, dt);
  };
  // (for the bot) what a child would do now: with goodP the best thing, else something else he can see
  lab.botWant = goodP => {
    const b = bestNow(); if (!b) return null;
    const pointOf = o => lab.pointOf(o) || { x: o.x, y: o.y, z: 0 };
    if (Math.random() < goodP) return { p: pointOf(b) };
    const a = sim.a(me); return { p: { x: clamp(a.x + (Math.random() - .3) * 8, 1, L - 1), y: clamp(a.y + (Math.random() - .5) * 8, 1, W - 1), z: 0 } };
  };
  return ctx;
}
export { wrap };
