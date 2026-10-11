// 把 icon.svg 转成多尺寸的 Windows .ico。
//
// 用法（在 packaging/icon/ 目录里）：
//     npm i sharp        # 只需一次
//     node make-ico.mjs
//
// 为什么用 sharp：它自带 libvips/librsvg 预编译二进制，是本机上唯一能
// 离线把 SVG 光栅化的东西（Pillow 读不了 SVG；cairosvg 缺 libcairo-2.dll；
// ImageMagick / Inkscape / rsvg-convert 都没装）。
//
// ICO 容器是手写的：Vista 以后的 Windows 允许 .ico 里直接塞 PNG，
// 所以只需要拼一个头 + 每个尺寸一段 PNG，不必自己做 BMP 调色板。

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const svgPath = join(here, 'icon.svg');
const icoPath = join(here, 'icon.ico');

// 16/24/32/48 是任务栏与资源管理器实际会取的小尺寸，256 是大图标视图。
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const svg = await readFile(svgPath);

const pngs = [];
for (const size of SIZES) {
  // density 提到 384 再缩，避免小尺寸直接光栅化时渐变出现色带。
  const png = await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  pngs.push({ size, png });
}

// --- 拼 ICO ---------------------------------------------------------------
// ICONDIR      6 字节： 保留(2)=0  类型(2)=1  图像数(2)=N
// ICONDIRENTRY 16 字节 × N
// 之后是各图像数据，PNG 直接内联
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);          // reserved
header.writeUInt16LE(1, 2);          // 1 = icon
header.writeUInt16LE(pngs.length, 4);

const directory = Buffer.alloc(16 * pngs.length);
let offset = header.length + directory.length;

pngs.forEach(({ size, png }, i) => {
  const at = i * 16;
  directory.writeUInt8(size >= 256 ? 0 : size, at + 0); // 0 表示 256
  directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
  directory.writeUInt8(0, at + 2);   // 调色板数（真彩色填 0）
  directory.writeUInt8(0, at + 3);   // reserved
  directory.writeUInt16LE(1, at + 4);   // planes
  directory.writeUInt16LE(32, at + 6);  // 位深
  directory.writeUInt32LE(png.length, at + 8);
  directory.writeUInt32LE(offset, at + 12);
  offset += png.length;
});

const ico = Buffer.concat([header, directory, ...pngs.map((p) => p.png)]);
await writeFile(icoPath, ico);

const kb = (ico.length / 1024).toFixed(1);
console.log(`icon.ico 已生成：${SIZES.join('/')} 共 ${pngs.length} 档，${kb} KB`);
