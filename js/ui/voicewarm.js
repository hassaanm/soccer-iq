// (round 11) The lines a mode can say are fetched and decoded as the mode starts (while its intro, demo or first
// run-up shows), so no line is fetched or decoded in a frame of play: the lines every mode shares, this round list's
// own cues and its lessons' names and tips; the keeper game's lines for the keeper game. Not all 479 clips: decoded,
// they would be over 100 MB. (The list of shared lines is the fixed part of tests/spoken.js, which the recordings are
// made from; a line missing here is still said, fetched as it is needed, and shows in the speed record as voice-fetch.)
import { preloadClips } from '../sound.js';
import { pieces, clipKey } from '../voice.js';
import { linesFor, keeperLines, clean, fill } from '../voicelines.js';
const load = lines => preloadClips([...new Set(lines.filter(Boolean).map(l => clean(fill(l))).flatMap(l => pieces(l).map(clipKey)))]);
export function warmVoice(scenes = []) { try { load(linesFor(scenes)); } catch (e) { console.error(e); } }
export function warmKeeper() { try { load(keeperLines()); } catch (e) { console.error(e); } }
