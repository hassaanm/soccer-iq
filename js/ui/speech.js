// The coach's voice: recorded clips first, the device's speech voice as the fallback.
import { P } from './store.js';
import { voiceVolume, duck, loadVoice, canSpeak, speakClips, stopVoice } from '../sound.js';
import { pieces, clipKey } from '../voice.js';

const synth = 'speechSynthesis' in window ? speechSynthesis : null;
// English voices, warmest first: downloaded Premium/Enhanced voices sound far less robotic than the defaults.
// Joke voices (Bubbles, Zarvox...) are left out. The grown-ups menu can pick any of them.
const NOVELTY = /Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Kathy|Ralph|Grandma|Grandpa|Eddy|Flo|Reed|Rocko|Sandy|Shelley/;
const WARM = ['Ava', 'Zoe', 'Allison', 'Samantha', 'Nicky', 'Evan', 'Nathan', 'Tom', 'Susan', 'Karen', 'Serena', 'Daniel', 'Moira', 'Google US English'];
const voiceScore = v => (/Premium/.test(v.name) ? 0 : /Enhanced/.test(v.name) ? 100 : 200) + ((WARM.findIndex(n => v.name.startsWith(n)) + 1) || 50) + (v.lang === 'en-US' ? 0 : 5);
export let voice = null, voices = [];
export function pickVoice() {
  if (!synth) return;
  voices = synth.getVoices().filter(v => v.lang.startsWith('en') && !NOVELTY.test(v.name)).sort((a, b) => voiceScore(a) - voiceScore(b));
  voice = voices.find(v => v.name === P.settings.voiceName) || voices[0] || null;
}
if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }
loadVoice();

// The line the menus play to try a voice or a volume.
export const SAMPLE = 'Nice pass! You looked up!';
// Says a line. Returns a promise that resolves once it has been said (null when the voice is off), so demos can
// wait for the end of a sentence before moving on.
export function say(text) {
  if (!P.settings.voice || P.settings.muted) return null;
  const line = text.replace(/[^\p{L}\p{N}\s.,!?'’-]/gu, '');
  // Recorded clips first: they play through the speakers like the game sounds (loud in the car too).
  // If a clip turns out not to load (no signal), the device's voice says the line instead.
  const keys = pieces(line).map(clipKey);
  if (P.settings.recorded !== false && canSpeak(keys)) { synth?.cancel(); return speakClips(keys).then(ok => (ok === false ? speak(line) : ok)); }
  return speak(line);
}
// Says a line with the device's speech voice.
function speak(line) {
  if (!synth) return null;
  stopVoice();
  const u = new SpeechSynthesisUtterance(line);
  if (voice) u.voice = voice; u.rate = .92; u.pitch = 1.12; u.volume = voiceVolume();
  // The music dips while he talks, so the words stand out (in the car the voice can come through quieter).
  u.onstart = () => duck(true);
  // iOS sometimes never fires onend, so a timeout (about the time the line takes) finishes it too. Every way out
  // brings the music back up.
  const done = new Promise(res => { const fin = () => { duck(false); res(); }; u.onend = u.onerror = fin; setTimeout(fin, 1500 + line.length * 90); });
  synth.cancel(); synth.speak(u);
  return done;
}
// Stops whatever is being said.
export function hush() { stopVoice(); synth?.cancel(); }
// iOS only lets the speech voice talk after a tap has used it once, so a tap that starts a game says a silent line.
export function unlockSpeech() {
  if (!synth || !P.settings.voice) return;
  const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u);
}
