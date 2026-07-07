// Miniaturas WebP de las banderas para la ronda de elección (los SVG con
// escudos heráldicos llegan a 250 KB para pintarse a ~90 px CSS).
// Emite public/flags/thumb/<iso>.webp a 320 px de ancho.
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flagsDir = resolve(root, 'public/flags');
const outDir = resolve(flagsDir, 'thumb');
mkdirSync(outDir, { recursive: true });

const files = readdirSync(flagsDir).filter((f) => f.endsWith('.svg'));
for (const f of files) {
  await sharp(resolve(flagsDir, f), { density: 96 })
    .resize({ width: 320 })
    .webp({ quality: 80 })
    .toFile(resolve(outDir, f.replace('.svg', '.webp')));
}
console.log(`✓ ${files.length} miniaturas → public/flags/thumb/`);
