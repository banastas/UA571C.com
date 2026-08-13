import { access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/app.mjs', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../site.webmanifest', import.meta.url), 'utf8'));

const errors = [];
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) errors.push(`Duplicate IDs: ${[...new Set(duplicates)].join(', ')}`);

for (const id of [...app.matchAll(/\$\('#([^']+)'\)/g)].map((match) => match[1])) {
  if (!ids.includes(id)) errors.push(`App references missing #${id}`);
}

for (const required of ['<main', '<h1', 'aria-live=', '<dialog', 'prefers-reduced-motion']) {
  if (!html.includes(required) && !css.includes(required)) errors.push(`Missing required accessibility feature: ${required}`);
}

if (!html.includes('type="module"')) errors.push('Application script is not loaded as a module');
if (!css.includes(':focus-visible')) errors.push('No visible keyboard focus styles found');
const canonical = html.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
if (!canonical || new URL(canonical).hostname.toLowerCase() !== 'ua571c.com') errors.push('Missing canonical UA571C.com URL');
if (!html.includes('property="og:image"')) errors.push('Missing Open Graph preview image');
if (!html.includes('application/ld+json')) errors.push('Missing structured data');
if (manifest.orientation !== 'landscape') errors.push('Web app manifest must request landscape orientation');
if (!css.includes('@media (orientation: portrait) and (pointer: coarse)')) errors.push('Missing portrait touch-device orientation interlock');
if (!css.includes('html[data-display-orientation="landscape"] .orientation-lock')) errors.push('Missing stale portrait-query landscape override');
if (!app.includes('window.visualViewport')) errors.push('Orientation interlock must synchronize with the visual viewport');

for (const file of ['404.html', 'CNAME', '.nojekyll', '_headers', 'robots.txt', 'sitemap.xml', 'site.webmanifest']) {
  try {
    await access(new URL(`../${file}`, import.meta.url));
  } catch {
    errors.push(`Missing deployment file: ${file}`);
  }
}

for (const file of [
  'assets/fonts/grid-typeblock-9x12.48e03d10.woff2',
  'assets/fonts/grid-typeblock-12x16.55dd2fe9.woff2',
  'assets/fonts/grid-typeblock-24x32.b5aaf5a1.woff2',
  'assets/fonts/grid-typegrid-5x8.a57a3fb3.woff2',
  'assets/fonts/source/TB9X12.TYP',
  'assets/fonts/source/TB12X16.TYP',
  'assets/fonts/source/TB24X32.TYP',
  'assets/fonts/source/TG5X8.TYP',
  'assets/fonts/README.md',
]) {
  try {
    await access(new URL(`../${file}`, import.meta.url));
    const digestMatch = file.match(/\.([0-9a-f]{8})\.woff2$/);
    if (digestMatch) {
      const data = await readFile(new URL(`../${file}`, import.meta.url));
      const actualDigest = createHash('sha256').update(data).digest('hex').slice(0, 8);
      if (actualDigest !== digestMatch[1]) errors.push(`Stale font digest in filename: ${file}`);
    }
  } catch {
    errors.push(`Missing original GRiD font artifact: ${file}`);
  }
}

for (const family of [
  'GRiD TypeBlock 9x12',
  'GRiD TypeBlock 12x16',
  'GRiD TypeBlock 24x32',
  'GRiD TypeGRiD 5x8',
]) {
  if (!css.includes(`font-family: "${family}"`)) errors.push(`Missing GRiD font face: ${family}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`Validated ${ids.length} unique IDs, application hooks, metadata, deployment files, module loading, and accessibility affordances.`);
