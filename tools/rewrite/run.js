/* Run the offline rewrite tests: node tools/rewrite/run.js */
const path = require('path');
const R = require(path.join(__dirname, '..', '..', 'src', 'lib', 'rewrite_core.js'));
const cases = require('./cases.js');
let pass = 0; const fails = [];
for (const [mode, input, want] of cases) {
  const exp = want === '=' ? input : want, got = R[mode](input);
  if (got === exp) pass++; else fails.push(`${mode.padEnd(12)} ${input}\n  want: ${exp}\n  got:  ${got}`);
}
console.log(`${pass} of ${cases.length} pass` + (fails.length ? '\n\n' + fails.join('\n') : ''));
process.exit(fails.length ? 1 : 0);
