// Prints how every scenario × option plays out, and which soccer-realism rules it breaks, at every team size the game
// offers (geom.js SIZES).
// Usage: npm run audit [size]   (size: 3v3, 4v4; all offered sizes if left out)
import { PATH, allScenarios } from '../js/skills.js';
import { SIZES, setSize } from '../js/geom.js';
import { optionsFor, playOption, judge } from '../tests/harness.js';

const sizes = process.argv[2] ? [process.argv[2]] : Object.keys(SIZES).filter(k => SIZES[k].offer);
let fails = 0;
for (const size of sizes) {
  setSize(size); let here = 0;
  console.log(`\n${size}\nscenario      option      expect  result   gap   secs  problems`);
  for (const sk of PATH.filter(s => s.ready)) for (const sc of allScenarios(sk.id)) for (const opt of optionsFor(sc)) {
    const r = await playOption(sc, opt), broken = judge(r);
    if (broken.length) { fails++; here++; }
    console.log([sc.id.padEnd(13), opt.padEnd(11), (r.good ? 'good' : 'bad').padEnd(7), (r.banners.join(',') || '-').padEnd(8),
      r.minGap.toFixed(2).padStart(4), r.seconds.toFixed(1).padStart(5), broken.join('; ') || 'ok'].join(' '));
  }
  console.log(`${size}: ${here} play(s) with problems`);
}
console.log(`\n${fails} play(s) with problems`);
process.exitCode = fails ? 1 : 0;
