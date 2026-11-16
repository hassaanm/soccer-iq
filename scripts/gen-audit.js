// Generates many scenarios for every lesson and plays every option, reporting any that break the realism rules, at
// every team size the game offers (geom.js SIZES).
// Usage: npm run audit:gen [count] [lesson] [size]
import { generate } from '../js/generate.js';
import { PATH } from '../js/skills.js';
import { SIZES, setSize } from '../js/geom.js';
import { optionsFor, playOption, judge } from '../tests/harness.js';

const n = +(process.argv[2] || 40), only = process.argv[3], sizes = process.argv[4] ? [process.argv[4]] : Object.keys(SIZES).filter(k => SIZES[k].offer);
let made = 0, bad = 0, nulls = 0;
for (const size of sizes) {
  setSize(size); const counts = {}; let here = 0, m0 = made, n0 = nulls;
  for (const sk of PATH.filter(s => s.ready && (!only || s.id === only))) for (let seed = 1, k = 0; k < n && seed < n * 5; seed++) {
    const sc = generate(sk.id, seed); if (!sc) { nulls++; continue; }
    k++;
    made++; counts[sc.pattern] = (counts[sc.pattern] || 0) + 1;
    for (const opt of optionsFor(sc)) {
      const r = await playOption(sc, opt), broken = judge(r);
      if (broken.length) { bad++; here++; console.log(size, sc.id, opt, r.good ? 'good' : 'bad', r.banners.join(',') || '-', '→', broken.join('; ')); }
    }
  }
  console.log(`${size}: ${made - m0} scenarios ${JSON.stringify(counts)}, ${nulls - n0} failed to generate, ${here} plays with problems`);
}
console.log(`\n${made} scenarios, ${nulls} failed to generate, ${bad} plays with problems`);
process.exitCode = bad ? 1 : 0;
