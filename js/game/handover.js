// (v67) He plays our keeper, now and then, inside a match (5v5): when they shoot at our goal the game hands him our
// keeper for that shot, with the keeper game's two taps and its rule (saves.js): where to stand as the shooter sets the
// ball, then where to dive as he winds up. The page (ui/goalie.js) plays the moment itself (`keeperMoment`: the camera
// to the keeper's view and back, the slow motion, the ring, his taps); this decides when, sets the shot up, and goes on
// after it as the match does after our keeper's save (outcomes.js ourSave) or their goal.
// keeperMoment(spec, shooterId) → a promise of the shot's result (game/goalie.js inMatch); keeperPlay() → the setting.
import { PITCH } from '../geom.js';
import { seeded } from './keeper.js';
import { keeperGive, matchShot, gradeOf, KEEPER_IDEA } from '../saves.js';

export const handover = {
  // Whether this shot of theirs is his. A new match starts its own count (match() makes a new `missed` each match).
  keeperTurn(shooter) {
    if (!this.keeperMoment || (this.mode !== 'match' && this.mode !== 'free') || !this.sim.keeper('us')) return false;
    if (this.kOf !== this.missed) Object.assign(this, { kOf: this.missed, kSaves: 0, kShots: 0, kGiven: false });
    const give = keeperGive(this.keeperPlay?.() || 'off', this.kGiven, seeded(shooter.x, shooter.y, this.sim.time, ++this.kShots, 17));
    this.kGiven = give;
    return give;
  },
  // His saves in this match (the results card's line).
  keeperSaves() { return this.kOf === this.missed ? this.kSaves || 0 : 0; },
  // The shot. The shooter takes one touch to set it (toward the middle of the goal, never closer than KEEP_OUT m to the
  // line), and strikes at a target picked by the place (seeded: the same play, the same shot).
  *keeperShot(shooter) {
    const s = this.sim, gk = s.keeper('us'), cy = PITCH.W / 2;
    this.ai = false; s.stopAll(); gk.gkm = null; this.scripted.add(gk.id); this.scripted.add(shooter.id);
    const start = { x: shooter.x, u: shooter.y - cy }, d = Math.hypot(start.x, start.u) || 1;
    let dir = { x: -start.x / d, u: -start.u / d }; if (start.x + dir.x * TOUCH < KEEP_OUT) dir = { x: 0, u: -Math.sign(start.u) || 1 };
    const from = { x: Math.max(KEEP_OUT, start.x + dir.x * TOUCH), u: start.u + dir.u * TOUCH };
    const spec = matchShot(from, start, seeded(from.x, from.u, this.kShots, 23));
    let r = null; this.keeperMoment(spec, shooter.id).then(v => { r = v; }, e => { console.error(e); r = { res: 'goal', failed: true }; });
    yield () => r;
    if (!r.failed) { const grade = gradeOf(r); this.onChoice?.({ id: KEEPER_IDEA, mode: this.mode, grade: grade === 'timeout' ? 'miss' : grade, sec: r.sec ?? -1, looked: null, timeout: grade === 'timeout' }); }
    if (r.res === 'save') {
      this.kSaves = (this.kSaves || 0) + 1; this.result = 'keeperSave';
      if (s.ball.state !== 'held') { // (pushed away: he gets up and gathers it, as our keeper does after a spill)
        yield () => !gk.gkm || s.time - gk.gkm.t0 > gk.gkm.dur + .9; gk.gkm = null;
        const t0 = s.time; yield () => { s.go(gk.id, s.ball.x, s.ball.y, 3); return Math.hypot(gk.x - s.ball.x, gk.y - s.ball.y) < .6 || s.time - t0 > 2; };
      }
      this.ai = false; s.stopAll(); yield* this.rollOut(gk); this.result = 'keeperSave'; return;
    }
    this.result = 'goalAgainst'; this.ai = false; s.stopAll(); yield this.hold('goalAgainst', 1.1);
  },
};
const TOUCH = .9, KEEP_OUT = 4.2;
