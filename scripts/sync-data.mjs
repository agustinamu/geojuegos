// Copia las banderas del repo hermano flagmaps. Ejecutar tras actualizar
// banderas allí (y después regenerar siluetas: npm run build:shapes).
import { cpSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flagmaps = resolve(root, '..', 'flagmaps', 'public');

if (!existsSync(flagmaps)) {
  console.error(`No se encuentra ${flagmaps}. Clona flagmaps como repo hermano.`);
  process.exit(1);
}

cpSync(resolve(flagmaps, 'flags'), resolve(root, 'public/flags'), { recursive: true });
console.log('Sincronizado: public/flags/');
