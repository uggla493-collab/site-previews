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
  check(!/Built by a vendor|learned the hard way|Google Sheets|Excel|printable|PDF|spreadsheet|testimonial|guarantee|five.star|best.seller|instant download|calculator/i.test(html), 'No unverified formats, experience, testimonials or calculator promotion (limited scan)');
  check(html.includes('not a preview of the paid product or a customer result'), 'Hypothetical example is explicitly separate from product contents and customer outcomes');
  check(html.includes('name="robots" content="noindex, nofollow, noarchive"'), 'Page indexing restrictions present');
  check(html.includes('Preview · for review before publication'), 'Visible preview label present');
  check((await readFile(path.join(release, 'robots.txt'), 'utf8')).trim() === 'User-agent: *\nDisallow: /', 'Crawler exclusion present');
  const costs = 80 + 20, contribution = 15 - 5, units = Math.ceil(costs / contribution);
  check(costs === 100 && contribution === 10 && units === 10, 'Arithmetic: $100 event costs / $10 contribution = 10 sales');
  check(units * 15 - units * 5 - costs === 0, 'Ten sales leave $0 before excluded expenses');
  check((units - 1) * contribution < costs, 'Nine sales do not cover the event costs');
  for (const copy of ['$80 stall fee + $20 travel', '$100 in event costs', '$15 selling price − $5 variable cost', '$10 contribution per item', '$100 event costs ÷ $10 contribution', '10 sales to cover those event costs', '$150 in sales revenue − $50 in variable costs − $100 in event costs = $0 left over', 'excludes compensation for your working time and any other expenses']) {
    check(html.includes(copy), 'Worked-example copy: ' + copy);
  }
  check(html.includes('View the $5 product'), 'Supplied product price shown');
  check(css.includes('.calculation-steps{grid-template-columns:1fr;gap:12px}'), 'Example stacks into one column on narrow screens');
  const files = (await readdir(release)).sort();
  check(JSON.stringify(files) === JSON.stringify(['index.html', 'robots.txt', 'styles.css']), 'Release contains only the three intended static files');
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
  return { status: 'PASS', checkedAt: new Date().toISOString(), stagingRoot: '.', releaseDirectory: 'release', checks, files, limitations: ['See mobile-results.json for browser layout checks when available.', 'External destinations not fetched; URL equality checked offline only.', 'No local product feature evidence supplied; no paid-product feature claims added.'] };
}

const result = await verifyRelease();
await writeFile(new URL('./verification-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
