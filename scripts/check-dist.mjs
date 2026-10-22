import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = path.resolve(root, process.argv[2] || 'dist');
const errors = [], references = new Set();
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const assets = JSON.parse(await fs.readFile(path.join(root, 'src/data/assets.manifest.json'), 'utf8'));
const surfaces = JSON.parse(await fs.readFile(path.join(root, 'src/data/surfaceTextures.json'), 'utf8'));
const music = JSON.parse(await fs.readFile(path.join(root, 'public/assets/audio/bgm/sources.json'), 'utf8'));
function collect(value) {
  if (typeof value === 'string' && value.startsWith('/assets/')) references.add(value.slice(1));
  else if (Array.isArray(value)) value.forEach(collect);
  else if (value && typeof value === 'object') Object.values(value).forEach(collect);
}
collect(assets);
for (const file of Object.values(surfaces)) references.add(`assets/surfaces/${file}`);
for (const cue of ['deal','play','uiClick','hit','attack','slash','fire','ice','lightning','heal','shield','teleport']) references.add(`assets/audio/${cue}.wav`);
for (const track of music.tracks) {
  references.add(`assets/audio/bgm/${track.file}`);
  if (!track.license.includes('用户确认已获发布授权')) errors.push(`BGM release authorization missing: ${track.file}`);
}
for (const reference of references) {
  const target = path.resolve(dist, reference);
  if (!target.startsWith(`${dist}${path.sep}`)) { errors.push(`Unsafe asset path: ${reference}`); continue; }
  try { if (!(await fs.stat(target)).isFile()) errors.push(`Not a file: ${reference}`); }
  catch { errors.push(`Missing: ${reference}`); }
}
const html = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)) {
  const reference = match[1], start = reference.indexOf('assets/');
  if (start < 0) continue;
  try { await fs.access(path.join(dist, reference.slice(start))); }
  catch { errors.push(`HTML entry missing: ${reference}`); }
}
for (const track of music.tracks) {
  const bytes = (await fs.stat(path.join(dist, 'assets/audio/bgm', track.file))).size;
  if (bytes !== track.bytes) errors.push(`Music size/provenance mismatch: ${track.file}`);
}
// CSS layer order is fixed by first declaration, not by the later stylesheet order.
// Loading a scene's hub layer first otherwise lets legacy menu geometry override it.
const expectedLayers = ['control-defaults', 'legacy', 'theme', 'hub', 'controls'];
for (const file of (await fs.readdir(path.join(dist, 'assets'))).filter(name => name.endsWith('.css'))) {
  const css = await fs.readFile(path.join(dist, 'assets', file), 'utf8');
  const layers = [];
  for (const match of css.matchAll(/@layer\s+([^;{]+)[;{]/g)) {
    for (const name of match[1].split(',').map(name => name.trim())) {
      if (expectedLayers.includes(name) && !layers.includes(name)) layers.push(name);
    }
  }
  if (layers.includes('legacy') && layers.includes('hub') && layers.join(',') !== expectedLayers.join(',')) {
    errors.push(`CSS cascade layer order invalid (${file}): ${layers.join(',')}`);
  }
}
const maps = (await fs.readdir(path.join(dist, 'assets'))).filter(name => name.endsWith('.map'));
if (maps.length && process.env.BUILD_SOURCEMAP !== 'true') errors.push('Unexpected production source maps');
if (errors.length) {
  console.error(`Static release check failed (${errors.length}):\n${errors.join('\n')}`);
  process.exitCode = 1;
} else {
  await fs.writeFile(path.join(dist, 'release-readiness.json'), JSON.stringify({ version: pkg.version,
    deployment: 'static-local-accounts', developerTools: false, checkedAssetReferences: references.size,
    surfaceTextures: Object.keys(surfaces).length, sourceMaps: maps.length, buildBase: process.env.VITE_BASE_PATH || '/',
  }, null, 2) + '\n');
  console.log(`Static release check passed: ${references.size} local assets, ${Object.keys(surfaces).length} baked surfaces, authorized BGM, valid HTML entries.`);
}
