/*
 * Puts the release signing settings into android/gradle.properties, replacing any there before.
 *
 *   node scripts/signing.js android/gradle.properties <signing.properties>
 *
 * Done in node rather than with `cat >>` because prebuild writes the file with no newline at the
 * end, and a setting appended to it joins the last line and is silently lost.
 */
const fs = require('node:fs');

const [target, signing] = process.argv.slice(2);
const kept = fs
  .readFileSync(target, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.replace(/MYAPP_RELEASE_.*$/, ''))
  // A stray control character left by an earlier broken run is dropped too.
  .filter((l) => l.trim() !== '' && !/^[\x00-\x1f]+$/.test(l));
const add = fs
  .readFileSync(signing, 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.startsWith('MYAPP_RELEASE_'));
if (add.length !== 4) {
  console.error('Expected four MYAPP_RELEASE_ lines in ' + signing + ', found ' + add.length);
  process.exit(1);
}
fs.writeFileSync(target, [...kept, ...add].join('\n') + '\n');
