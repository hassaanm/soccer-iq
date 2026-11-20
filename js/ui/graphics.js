// The graphics settings in plain words, with no page and no imports (so a test can load it): the standard look, what a
// speed test result (`settings.tuned`) is worth, and the words the grown-ups menu and the speed test page say about them.
// js/ui/speed.js applies them to the game.
export const SFX_MODES = ['one', 'pool', 'later', 'pool+later']; // (the same list as sound.js SFX_MODES; speed.js passes the real one)
export const STANDARD = { blur: true, glow: true, soft: true, pr: 0 };
export const TUNED_VERSION = 2; // (the speed test's version that wrote `settings.tuned`: an older result, as v76's, is ignored)
// What the speed test (dev/speed.html) chose for this device, kept in the save when it finishes: { blur, glow, soft, pr, sfx,
// at }. Each value wins over the standard only when it is a real one: true or false, a pixel ratio of 2 or 3, a known way of
// starting sounds; anything else ("no", "1") leaves the standard.
// A result from another version of the test, or one with no valid value at all, reads as the standard (fromTest false).
export const tunedFrom = (settings, sfxModes = SFX_MODES) => { const t = settings?.tuned, o = { ...STANDARD, fromTest: false }; if (!t || typeof t !== 'object' || t.tv !== TUNED_VERSION) return o;
  let n = 0;
  for (const k of ['blur', 'glow', 'soft']) if (typeof t[k] === 'boolean') { o[k] = t[k]; n++; }
  if (t.pr === 2 || t.pr === 3 || t.pr === 0) { if (t.pr) o.pr = t.pr; n++; }
  if (sfxModes.includes(t.sfx)) { o.sfx = t.sfx; n++; }
  if (!n) return { ...STANDARD, fromTest: false };
  if (typeof t.at === 'string') o.at = t.at;
  o.fromTest = true; return o; };
// (v93) What is in force, in plain words (the menu and the speed test page both use these). Nothing is ever applied by the
// speed test by itself: it offers its result, and the grown-up chooses ("Use these settings" or "Keep what I have").
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m && MONTHS[+m[2] - 1] ? `${MONTHS[+m[2] - 1]} ${+m[3]}` : ''; }; // ('2026-11-20' -> 'Nov 20')
export const graphicsState = t => { const set = !!t.fromTest, d = set ? shortDate(t.at) : '';
  return { set, text: set ? `Graphics: tuned for this phone${d ? ` (${d})` : ''}` : 'Graphics: standard',
    facts: `sharpness ${t.pr || 1.5}, head-down blur ${t.blur ? 'on' : 'off'}, glow ${t.glow ? 'on' : 'off'}, soft shadow ${t.soft ? 'on' : 'off'}` }; };
// How a result (the speed test's { blur, glow, soft, pr, sfx }) differs from the standard, in words; [] = the same.
export const SFX_STANDARD = 'pool+later';
export const differences = b => { const d = [];
  if (b.pr) d.push('sharper picture'); if (b.blur === false) d.push('no head-down blur'); if (b.glow === false) d.push('no glow'); if (b.soft === false) d.push('no soft shadow');
  if (b.sfx && b.sfx !== SFX_STANDARD) d.push('sounds that start another way'); return d; };
// Two results are the same when their words are.
export const sameSettings = (a, b) => JSON.stringify(differences(a)) === JSON.stringify(differences(b));
// The one plain sentence under the test's table.
export const resultSentence = (b, inForce) => { const d = differences(b);
  if (!d.length) return 'The standard settings are already the best for this phone.';
  if (inForce?.fromTest && sameSettings(b, inForce)) return `This phone can use: ${d.join(', ')}. These are already in use.`;
  return `This phone can use: ${d.join(', ')}.`; };
