/** Offline, exact-pixel bake. No browser or GPU is needed; PNG uses Node's lossless zlib. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { stripTypeScriptTypes } from 'node:module';
import { parseSync } from 'rolldown/utils';

const root = process.cwd(), manifest = {}, outputs = new Map();
class PixelCanvas {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() { return {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: image => { this.data = image.data; },
  }; }
}
globalThis.OffscreenCanvas = PixelCanvas;
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ -1) >>> 0;
}
function chunk(name, data) {
  const body = Buffer.concat([Buffer.from(name), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function png(image) {
  const header = Buffer.alloc(13); header.writeUInt32BE(image.width); header.writeUInt32BE(image.height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((image.width * 4 + 1) * image.height);
  for (let y = 0; y < image.height; y++) Buffer.from(image.data.buffer, image.data.byteOffset + y * image.width * 4, image.width * 4).copy(rows, y * (image.width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
globalThis.__bakeSurface = (key, texture) => {
  const filename = `${key.split(':')[0]}-${createHash('sha256').update(key).digest('hex').slice(0, 16)}.png`;
  manifest[key] = filename;
  outputs.set(filename, png(texture.image));
};
const transpile = source => stripTypeScriptTypes(source);
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(transpile(source)).toString('base64')}`;
let source = await fs.readFile(path.join(root, 'src/rendering/table/proceduralTextures.ts'), 'utf8');
source = source.replace(/import \{ bakedSurfaceTexture \} from .*?;\s*/, '').replace(/  const baked = bakedSurfaceTexture\(key\);\s*if \(baked\) \{ cache.set\(key, baked\); return baked as T; \}\s*/, '');
source = source.replace("from 'three'", `from '${pathToFileURL(path.join(root, 'node_modules/three/build/three.module.js')).href}'`)
  .replace('cache.set(key, texture);', 'cache.set(key, texture); globalThis.__bakeSurface(key, texture);');
const textures = await import(moduleUrl(source));
const themes = await import(moduleUrl(await fs.readFile(path.join(root, 'src/rendering/table/themes.ts'), 'utf8')));
function bake(surface, quality) {
  if (!surface || typeof surface !== 'object') return;
  const size = quality === 'high' ? 768 : 512, roughness = surface.roughness ?? .5;
  if (surface.kind === 'wood') {
    textures.woodTexture({ size, light: surface.light ?? 0xc8a06a, dark: surface.dark ?? 0x6b4526, rings: surface.rings ?? 12, turbulence: surface.turbulence ?? 5.5, seed: surface.seed ?? 7, angle: surface.angle ?? 0 });
    textures.roughnessTexture({ base: roughness, spread: .1, scale: 40, seed: 5 });
    textures.grainNormalTexture({ strength: .45, scale: 26, seed: 13 });
  } else if (surface.kind === 'marble') {
    textures.marbleTexture({ size, base: surface.base ?? 0xf2efe6, vein: surface.vein ?? 0x9a9384, scale: surface.scale ?? 3.2, turbulence: surface.turbulence ?? 6, seed: surface.seed ?? 21 });
    textures.roughnessTexture({ base: roughness, spread: .07, scale: 30, seed: 17 });
    textures.grainNormalTexture({ strength: .2, scale: 18, seed: 23 });
  } else if (surface.kind === 'metal') {
    textures.roughnessTexture({ base: roughness, spread: .22, scale: 240, seed: 31 });
    textures.grainNormalTexture({ strength: .5, scale: 200, seed: 29 });
  } else if (surface.kind === 'stone') {
    textures.roughnessTexture({ base: roughness, spread: .3, scale: 60, seed: 37 });
    textures.grainNormalTexture({ strength: .7, scale: 28, seed: 41 });
  }
}
// Bake every theme's data, then statically evaluable custom material overrides.
for (const theme of themes.TABLE_THEMES) for (const quality of ['medium', 'high']) for (const surface of [theme.mat.light, theme.mat.dark, theme.mat.frame]) bake(surface, quality);
async function visit(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await visit(file); continue; }
    if (!/\.tsx?$/.test(file) || file.endsWith('materials.ts')) continue;
    const code = await fs.readFile(file, 'utf8');
    const ast = parseSync(file, code).program;
    function walk(node) {
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'buildMaterial' && node.arguments[0]) {
        const expression = code.slice(node.arguments[0].start, node.arguments[0].end);
        // Only literal data objects and theme references. Runtime-specific specs retain the generator fallback.
        if (node.arguments[0].type === 'ObjectExpression' && !expression.includes('...spec')) {
          for (const theme of themes.TABLE_THEMES) {
            try {
              const value = Function('theme', `return (${expression})`)(theme);
              for (const quality of ['medium', 'high']) bake(value, quality);
            } catch { /* Dynamic material inputs are intentionally not evaluated. */ }
          }
        }
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) { for (const child of value) if (child?.type) walk(child); }
        else if (value?.type) walk(value);
      }
    }
    walk(ast);
  }
}
await visit(path.join(root, 'src/rendering'));
const output = path.join(root, 'public/assets/surfaces');
await fs.mkdir(output, { recursive: true });
for (const [name, data] of outputs) await fs.writeFile(path.join(output, name), data);
await fs.writeFile(path.join(root, 'src/data/surfaceTextures.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Baked ${outputs.size} lossless surfaces, ${(Array.from(outputs.values()).reduce((n, b) => n + b.length, 0) / 1048576).toFixed(1)} MiB. Unknown parameter sets retain procedural fallback.`);
