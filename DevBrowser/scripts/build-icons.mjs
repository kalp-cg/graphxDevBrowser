// Renders build/icon.svg into the PNG files the installers and the docs need:  npm run icons
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const build = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build');
const svg = fs.readFileSync(path.join(build, 'icon.svg'));

await sharp(svg, { density: 384 }).resize(1024, 1024).png().toFile(path.join(build, 'icon.png'));
for (const size of [512, 256, 128, 64, 32, 16]) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(path.join(build, `icon-${size}.png`));
}
console.log('wrote build/icon.png (1024) and 512/256/128/64/32/16');
