// Lab E: "One player: flowing" (implicit). The shared one-player match (common/flow.js) at one calm speed, 0.55 of real
// speed, that never stops and never slows down for him: no decision is announced. He acts when he wants (tap the
// ground, a friend he can see, the goal; drag to look). A hint comes only after 4 s with nothing done. After a clearly
// bad pass, shot or dribble, play freezes for 1.5 s to show why: a switch on the pause sheet turns that off. 4 v 4.
import { onePlayer } from '../common/flow.js';
const ctx = await onePlayer({ letter: 'E', name: 'One player: flowing', version: 'v1', base: .55, whySwitch: true });
ctx.lab.run();
