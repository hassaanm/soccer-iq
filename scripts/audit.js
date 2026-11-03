// Prints how every scenario × option plays out, and which soccer-realism rules it breaks.
// Usage: npm run audit
import { PATH, allScenarios } from '../js/skills.js';
import { OPTIONS, playOption, judge } from '../tests/harness.js';

let fails = 0;
console.log('scenario      option      expect  result   gap   secs  problems');
for (const sk of PATH.filter(s => s.ready)) for (const sc of allScenarios(sk.id)) for (const opt of OPTIONS) {
  const r = await playOption(sc, opt), broken = judge(r);
  if (broken.length) fails++;
  console.log([sc.id.padEnd(13), opt.padEnd(11), (r.good ? 'good' : 'bad').padEnd(7), (r.banners.join(',') || '-').padEnd(8),
    r.minGap.toFixed(2).padStart(4), r.seconds.toFixed(1).padStart(5), broken.join('; ') || 'ok'].join(' '));
}
console.log(`\n${fails} play(s) with problems`);
process.exitCode = fails ? 1 : 0;
