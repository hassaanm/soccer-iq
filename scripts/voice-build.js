// Records every spoken line as short clips with a macOS voice (free, offline) into audio/voice/.
// Usage: npm run voice [-- "Voice Name"]   (default Samantha; e.g. "Ava (Premium)" once downloaded in macOS settings)
// Re-run it after changing any spoken text; tests/voice.test.js fails if a line has no clip.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NAMES, pieces, clipKey } from '../js/voice.js';
import { spokenLines } from '../tests/spoken.js';

const voice = process.argv[2] || 'Samantha', dir = 'audio/voice', tmp = '/tmp/soccer-voice.aiff';
mkdirSync(dir, { recursive: true });
const clips = new Map(); // key -> text to record
for (const n of NAMES) for (const p of pieces(n)) clips.set(clipKey(p), p.raw);
for (const line of spokenLines()) for (const p of pieces(line)) if (!clips.has(clipKey(p))) clips.set(clipKey(p), p.raw);

const index = {};
let made = 0;
for (const [key, text] of clips) {
  const file = createHash('sha1').update(voice + '|' + text).digest('hex').slice(0, 12) + '.m4a';
  index[key] = file;
  if (existsSync(`${dir}/${file}`)) continue;
  execFileSync('say', ['-v', voice, '-r', '175', '-o', tmp, text]);
  execFileSync('afconvert', [tmp, `${dir}/${file}`, '-f', 'm4af', '-d', 'aac', '-b', '48000']);
  made++;
}
rmSync(tmp, { force: true });
writeFileSync(`${dir}/index.json`, JSON.stringify({ voice, clips: index }));
console.log(`${clips.size} clips (${made} new) with ${voice}`);
