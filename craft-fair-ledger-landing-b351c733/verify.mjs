import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function verifyRelease(base = path.dirname(fileURLToPath(import.meta.url))) {
  const release = path.join(base, 'release');
  const html = await readFile(path.join(release, 'index.html'), 'utf8');
  const css = await readFile(path.join(release, 'styles.css'), 'utf8');
  const checks = [];
  function check(condition, label) { assert.ok(condition, label); checks.push(label); }
  check(/^<!doctype html>/i.test(html), 'HTML doctype present');
  check(/<html lang="en">/.test(html), 'English document language');
  check(/<meta name="viewport"/.test(html), 'Responsive viewport present');
  check((html.match(/<h1[ >]/g) || []).length === 1, 'One primary heading');
  check(!/<(?:script|iframe|form|img|video|audio|object|embed|base)\b/i.test(html), 'No active content, forms, embeds or image dependencies');
  check(!/\son[a-z]+\s*=/i.test(html), 'No inline event handlers');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  check(ids.length === new Set(ids).size, 'Unique element IDs');
  const refs = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map(m => m[1]);
  const purchase = 'https://wesslingdigital.gumroad.com/l/yxqdf';
  check(refs.filter(ref => ref === purchase).length === 2, 'Both purchase links match supplied URL exactly');
  for (const ref of refs) {
    if (ref.startsWith('#')) { check(ids.includes(ref.slice(1)), 'Fragment target exists: ' + ref); continue; }
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) { check(ref === purchase, 'Only supplied external destination: ' + ref); continue; }
    const resolved = path.resolve(release, ref);
    check(resolved.startsWith(release + path.sep), 'Relative asset stays inside release: ' + ref);
    check((await stat(resolved)).isFile(), 'Relative asset exists: ' + ref);
  }
  check(!/url\s*\(|@import/i.test(css), 'No CSS asset requests or remote imports');
  check((css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length, 'Balanced CSS blocks (basic structural check)');
  check(css.includes('@media(max-width:600px)'), 'Mobile layout rule present');
  check(css.includes(':focus-visible'), 'Keyboard focus styling present');
  check(html.includes('Skip to content') && html.includes('href="#main"'), 'Skip navigation present');
  check(html.includes('not a product preview'), 'Decorative artwork clearly labeled');
  check(!/testimonial|revenue|guarantee|five.star|best.seller|instant download|\$[0-9]|€[0-9]/i.test(html), 'No selected unsupported marketing terms or price claims (limited scan)');
  const files = (await readdir(release)).sort();
  check(JSON.stringify(files) === JSON.stringify(['index.html', 'styles.css']), 'Release contains only the two intended static assets');
  for (const file of files) {
    const source = await readFile(path.join(release, file));
    const staged = await readFile(path.join(base, file));
    check(source.equals(staged), 'Worker root matches release byte for byte: ' + file);
  }
  for (const ref of refs) {
    if (ref.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) continue;
    const resolved = path.resolve(base, ref);
    check(resolved.startsWith(base + path.sep), 'Local asset stays inside worker root: ' + ref);
    check((await stat(resolved)).isFile(), 'Local asset resolves from worker root: ' + ref);
  }
  return { status: 'PASS', checkedAt: new Date().toISOString(), stagingRoot: '.', releaseDirectory: 'release', checks, files, limitations: ['No browser rendering performed.', 'External destination not fetched; URL equality checked offline only.', 'Product evidence and original HTML missing; feature claims cannot be verified.'] };
}

const result = await verifyRelease();
await writeFile(new URL('./verification-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
