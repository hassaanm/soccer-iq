// Whether a Fast match is on the field (js/fast/fast.js sets it). The Slow game's touch handler (js/ui/input.js) and the
// frame loop (js/main.js) ask it, so a Fast match gets every touch and frame, and the Slow game none.
export const FAST = { on: false };
export const FAST_GOALS = 3; // a Fast match is first to this many goals (fast.js, flows.js)
