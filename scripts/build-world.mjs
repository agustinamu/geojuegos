// Mapa base → public/data/world.json
// Combina los public/shapes/<iso>.json (GeometryCollection, winding gj2008 ya
// correcto para d3-geo) en UNA FeatureCollection. NO se toca el winding.
// Cada Feature = { type:"Feature", id:"<iso>", properties:{iso}, geometry }.
// Si el resultado supera ~1.5 MB se recortan decimales de coordenadas.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shapesDir = resolve(root, 'public/shapes');
const outFile = resolve(root, 'public/data/world.json');
const MAX_BYTES = 1.5 * 1024 * 1024;

const files = readdirSync(shapesDir).filter((f) => f.endsWith('.json'));

// Recorta cada número a `dp` decimales, recursivo sobre el árbol de coords.
function round(node, dp) {
  if (typeof node === 'number') return Number(node.toFixed(dp));
  if (Array.isArray(node)) return node.map((n) => round(n, dp));
  return node;
}

function build(dp) {
  const features = files
    .map((f) => f.replace('.json', ''))
    .sort()
    .map((iso) => {
      const geometry = JSON.parse(readFileSync(resolve(shapesDir, `${iso}.json`), 'utf8'));
      const geom = dp == null ? geometry : { ...geometry, geometries: round(geometry.geometries, dp) };
      return { type: 'Feature', id: iso, properties: { iso }, geometry: geom };
    });
  return { type: 'FeatureCollection', features };
}

// Primero sin tocar; si pasa de 1.5 MB, recorta decimales progresivamente.
let dp = null;
let json = JSON.stringify(build(dp));
for (const candidate of [3, 2]) {
  if (Buffer.byteLength(json) <= MAX_BYTES) break;
  dp = candidate;
  json = JSON.stringify(build(dp));
}

writeFileSync(outFile, json);
const bytes = statSync(outFile).size;
console.log(`✓ world.json: ${files.length} features, ${(bytes / 1024 / 1024).toFixed(2)} MB${dp != null ? ` (coords a ${dp} decimales)` : ' (coords intactas)'}`);
