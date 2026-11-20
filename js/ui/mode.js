// How a match plays (the home screen's one "Mode" toggle): `settings.mode` is 'slow' (Classic: play stops at each choice) or
// 'fast' (Live: real time); unset or anything else is Classic. No page here, so a test can load it.
export const modeOf = settings => (settings?.mode === 'fast' ? 'fast' : 'slow');
export const modeName = settings => (modeOf(settings) === 'fast' ? 'Live' : 'Classic');
// (v93, the owner) What PLAY starts: Classic, the chosen lesson; Live, a Live match as Match does (Live lessons do not
// exist yet, so no lesson is offered in Live: home.js hides the lesson chip).
export const playGoes = settings => (modeOf(settings) === 'fast' ? 'match' : 'lesson');
export const nextMode = settings => (modeOf(settings) === 'fast' ? 'slow' : 'fast');
