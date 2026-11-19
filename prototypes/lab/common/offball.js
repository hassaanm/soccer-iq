// Choices without the ball, for any one player of ours (`me`), shared by Lab D and Lab E (ported from Lab B).
//  - runSpots: his friend F has the ball. Gold spots to run to: the most open one (good, best), one hidden behind a
//    defender, one crowding a friend. Spots all round him, so some are only seen when he looks.
//  - guardSpots: they have the ball. In front of the ball (right when he is our closest), guard an open player (right
//    when a friend is closer), between the ball and our goal (right when nobody else is), or behind (never).
//  - judgeSpot: how good a place he picked himself is (Lab E), by the same rules.
import { dist, clamp, onLane } from './lab.js';

export function runSpots(lab, m, me, F) {
  const sim = lab.sim, L = lab.L, W = lab.W, f = sim.a(F), h = sim.a(me), mates = m.ids('us').filter(x => x !== F && x !== me).map(x => sim.a(x)), foes = m.foes('us');
  const inside = p => p.x > 1.5 && p.x < L - 1.5 && p.y > 1.5 && p.y < W - 1.5;
  const look = p => { let lane = 99, by = null, room = 99; for (const o of foes) { const c = onLane(o, f, p); if (c.d < lane) { lane = c.d; by = c.t < .9 ? o : null; } room = Math.min(room, dist(o, p)); } return { lane, by, room, crowd: Math.min(dist(p, f), ...mates.map(q => dist(p, q))) }; };
  const cands = [];
  for (const r of [3.5, 5.5, 7.5]) for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6, p = { x: h.x + Math.cos(a) * r, y: h.y + Math.sin(a) * r }; if (inside(p) && dist(p, f) > 3) cands.push({ ...p, ...look(p) }); }
  const score = p => (p.x - f.x) * .5 + Math.min(p.lane, 3) + Math.min(p.room, 4) * .4 - dist(p, h) * .2;
  let open = cands.filter(p => p.lane >= 1.3 && p.room >= 2.2 && p.crowd >= 3.2).sort((p, q) => score(q) - score(p));
  if (!open.length) open = cands.filter(p => p.lane >= .9 && p.room >= 1.6 && p.crowd >= 2.6).sort((p, q) => score(q) - score(p));
  if (!open.length) open = cands.slice().sort((p, q) => score(q) - score(p));
  if (!open.length) { const p = { x: clamp(h.x + 4, 2, L - 2), y: clamp(h.y, 2, W - 2) }; open = [{ ...p, ...look(p) }]; }
  const g = open[0], far = p => dist(p, g) > 3;
  const shadow = cands.filter(p => p.lane < .6 && p.by && p.crowd >= 3 && far(p)).sort((p, q) => dist(p, h) - dist(q, h))[0];
  const near = [...mates, f].sort((p, q) => dist(p, h) - dist(q, h))[0], ca = Math.atan2(h.y - near.y, h.x - near.x);
  const crowd = [{ x: near.x + Math.cos(ca) * 1.6, y: near.y + Math.sin(ca) * 1.6 }].filter(p => inside(p) && far(p) && (!shadow || dist(p, shadow) > 2.6))[0];
  const out = [{ id: 'spot:open', kind: 'spot', x: g.x, y: g.y, good: true, best: true, word: 'Open!', emo: '👍', line: g.x - f.x > 2.5 ? 'great run' : 'great choice', why: 'open' }];
  if (shadow) out.push({ id: 'spot:hidden', kind: 'spot', x: shadow.x, y: shadow.y, good: false, word: 'Hidden!', emo: '✋', line: 'move to open space so your friend can pass to you', why: 'shadow', by: shadow.by.id });
  if (crowd) out.push({ id: 'spot:crowd', kind: 'spot', x: crowd.x, y: crowd.y, good: false, word: 'Too close!', emo: '✋', line: "don't crowd your friend", why: 'crowd' });
  return out;
}
export function guardSpots(lab, m, me) {
  const sim = lab.sim, L = lab.L, W = lab.W, C = m.owner(), c = sim.a(C), h = sim.a(me), friends = m.ids('us').filter(x => x !== me).map(x => sim.a(x));
  const hD = dist(h, c), fD = Math.min(...friends.map(f => dist(f, c))), heroNear = hD < fD - .6, friendNear = fD < hD - .6;
  const gs = (p, k) => { const gx = 0 - p.x, gy = W / 2 - p.y, gl = Math.hypot(gx, gy) || 1; return { x: clamp(p.x + gx / gl * k, 1, L - 1), y: clamp(p.y + gy / gl * k, 1, W - 1) }; };
  const out = [], add = o => { if (out.every(q => dist(q, o) > 2.3)) out.push(o); };
  add({ id: 'front', kind: 'spot', ...gs(c, 1.9), job: 'press', good: !friendNear, word: friendNear ? 'Friend closer!' : 'In front!', emo: friendNear ? '✋' : '👍', line: friendNear ? 'a friend was chasing the ball you guard the open player' : 'great choice' });
  // the open attacker nearest our goal that no friend is on
  const open = m.ids('them').filter(x => x !== C).map(x => sim.a(x)).filter(o => !friends.some(f => dist(f, o) < 2)).sort((p, q) => p.x - q.x);
  for (const o of open.slice(0, 2)) add({ id: 'guard:' + o.id, kind: 'spot', ...gs(o, 1.4), job: 'mark', who: o.id, good: !heroNear, word: heroNear ? 'You were closest!' : 'Guard!', emo: heroNear ? '✋' : '👍', line: heroNear ? 'nobody was on the ball and you were closest go get it' : 'great choice' });
  if (!open.length) add({ id: 'cover', kind: 'spot', x: clamp((c.x) * .5, 1.5, L - 1.5), y: clamp(W / 2 + (c.y - W / 2) * .5, 1.5, W - 1.5), job: 'cover', good: !heroNear, word: heroNear ? 'You were closest!' : 'In the way!', emo: heroNear ? '✋' : '👍', line: heroNear ? 'nobody was on the ball and you were closest go get it' : 'great choice' });
  add({ id: 'behind', kind: 'spot', x: clamp(c.x + 1.8, 1, L - 1), y: c.y, job: 'chase', good: false, word: 'Get in front!', emo: '✋', line: 'lost the ball get back in front of it' });
  const best = out.find(o => o.good && o.job === (heroNear ? 'press' : 'mark')) || out.find(o => o.good); if (best) best.best = true;
  return out;
}
// A place he chose himself (Lab E): open for a pass from the ball (attacking), or between the ball and our goal (defending).
export function judgeSpot(lab, m, me, p) {
  const sim = lab.sim, c = m.owner(); if (!c) return { good: true };
  const ca = sim.a(c);
  if (m.team(c) === 'us') {
    let lane = 99, room = 99; for (const o of m.foes('us')) { lane = Math.min(lane, onLane(o, ca, p).d); room = Math.min(room, dist(o, p)); }
    const crowd = Math.min(...m.ids('us').filter(x => x !== me).map(x => dist(sim.a(x), p)));
    return lane >= 1 && room >= 1.8 && crowd >= 2.4 ? { good: true, word: 'Open!' } : crowd < 2.4 ? { good: false, word: 'Too close!', line: "don't crowd your friend" } : { good: false, word: 'Hidden!', line: 'move to open space so your friend can pass to you' };
  }
  const goalSide = p.x < ca.x + .5; return goalSide ? { good: true, word: 'In the way!' } : { good: false, word: 'Get in front!', line: 'lost the ball get back in front of it' };
}
