// STEAL's look by how far the ball is (v96; the owner: a STEAL button always up, even on the far side of the pitch, was a
// button to press "all the time"). Pure rules and one class writer, shared by Live's action button (fast/fast.js) and the
// rondo's "Win the ball" (mini/rondo-ui.js). It changes only how the button looks and whether it shows, never the steal
// rule: `inReach` is the game's own test (a press would win now: the one that makes the ball glow).
//   far  more than FAR_ON m from the ball: not shown (clear, and it takes no touch)
//   mid  from there down to reach: shown small and dim (a press still lunges, and misses, as ever)
//   in   within reach: full size, bright, with a short pop as it gets there
// A little room (FAR_OFF) so it does not flicker at the edge. The button's nodes exist before play; the states are
// classes (css: sl-far, sl-mid, sl-in) that change only opacity and scale.
export const FAR_ON = 6.4, FAR_OFF = 5.6;
export const stealState = (dist, inReach, wasFar) => inReach ? 'in' : dist > (wasFar ? FAR_OFF : FAR_ON) ? 'far' : 'mid';
export function setStealLook(btn, st) {
  btn.classList.toggle('sl-far', st === 'far'); btn.classList.toggle('sl-mid', st === 'mid'); btn.classList.toggle('sl-in', st === 'in');
}
