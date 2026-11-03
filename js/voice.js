// Pre-recorded voice: every spoken line is cut into player names and the text between them, and each piece is
// a short recorded clip (audio/voice/). Clips play through Web Audio like the game sounds, so they come out of
// car speakers at media volume (CarPlay plays the built-in speech voice very quietly). scripts/voice-build.js
// records the clips; this module is shared by it and by the game.
import { TEAMS, displayName } from './teams.js';

export const NAMES = [...new Set(TEAMS.flatMap(t => t.players.map(p => displayName(p.name))))];

// The lookup key for a piece of text: lowercase letters, digits and apostrophes, single spaces.
export const norm = t => t.normalize('NFC').toLowerCase().replace(/[’]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAME_RE = new RegExp(`(?<![\\p{L}])(${[...NAMES].sort((a, b) => b.length - a.length).map(esc).join('|')})(?![\\p{L}])`, 'giu'); // whole words only
const NAME_KEYS = new Set(NAMES.map(norm));

// "Saka was open and closer to the goal!" → [{ name: 'saka' }, { text: 'was open and closer to the goal' }]
export function pieces(text) {
  const out = [];
  for (const part of text.split(NAME_RE)) {
    const k = norm(part);
    if (!k) continue;
    out.push(NAME_KEYS.has(k) ? { name: k, raw: part } : { text: k, raw: part.trim() }); // raw keeps punctuation for recording
  }
  return out;
}
export const clipKey = p => (p.name ? 'name:' + p.name : p.text);
