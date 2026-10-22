import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import manifest from '../../src/data/surfaceTextures.json';

describe('packaged procedural surfaces', () => {
  it('packages complete lossless RGBA maps at their original resolution', () => {
    expect(Object.keys(manifest).length).toBeGreaterThan(50);
    for (const [key, filename] of Object.entries(manifest)) {
      const image = readFileSync(new URL(`../../public/assets/surfaces/${filename}`, import.meta.url));
      expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      const size = Number(key.split(':')[1]);
      expect(image.readUInt32BE(16)).toBe(size); expect(image.readUInt32BE(20)).toBe(size);
      expect(image[24]).toBe(8); expect(image[25]).toBe(6);
      const chunks: Buffer[] = [];
      for (let offset = 8; offset < image.length;) {
        const length = image.readUInt32BE(offset);
        if (image.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(image.subarray(offset + 8, offset + 8 + length));
        offset += length + 12;
      }
      expect(inflateSync(Buffer.concat(chunks)).length).toBe((size * 4 + 1) * size);
    }
  });
});
