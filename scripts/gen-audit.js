// Generates many "Look up" scenarios and plays every option, reporting any that break the realism rules.
// Usage: npm run audit:gen [count]
import { generateLookUp } from '../js/generate.js';
import { OPTIONS, playOption, judge } from '../tests/harness.js';

const n = +(process.argv[2] || 40);
let made = 0, bad = 0, nulls = 0; const counts = {};
for (let seed = 1; made < n && seed < n * 5; seed++) {
  const sc = generateLookUp(seed); if (!sc) { nulls++; continue; }
  made++; counts[sc.pattern] = (counts[sc.pattern] || 0) + 1;
  for (const opt of OPTIONS) {
    const r = await playOption(sc, opt), broken = judge(r);
    if (broken.length) { bad++; console.log(sc.id, opt, r.good ? 'good' : 'bad', r.banners.join(',') || '-', '→', broken.join('; ')); }
  }
}
console.log(`\n${made} scenarios ${JSON.stringify(counts)}, ${nulls} failed to generate, ${bad} plays with problems`);
process.exitCode = bad ? 1 : 0;
