// Mapa base → public/data/world.json
// Combina los public/shapes/<iso>.json (GeometryCollection, winding gj2008 ya
// correcto para d3-geo) en UNA FeatureCollection:
//   Feature = { type:"Feature", id:"<iso>", properties:{iso}, geometry }
// La unión sin simplificar pesa ~3.6 MB (≈283k vértices, TARGET_VERTICES=1200
// por país es fiel para siluetas pero excesivo para un basemap). Para bajar de
// ~1.5 MB se re-simplifica con mapshaper (-simplify keep-shapes) RE-emitiendo
// con winding gj2008 —el que espera d3-geo— y precisión 0.001 (≈100 m). No se
// toca el winding original de los shapes. mapshaper conserva id y properties.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shapesDir = resolve(root, 'public/shapes');
const outFile = resolve(root, 'public/data/world.json');
const tmpDir = resolve(root, 'data', 'cache');
const tmpIn = resolve(tmpDir, 'world-full.json');
const tmpOut = resolve(tmpDir, 'world-simplified.json');
const MAX_BYTES = 1.5 * 1024 * 1024;

mkdirSync(tmpDir, { recursive: true });

const isos = readdirSync(shapesDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''))
  .sort();

const features = isos.map((iso) => {
  const geometry = JSON.parse(readFileSync(resolve(shapesDir, `${iso}.json`), 'utf8'));
  return { type: 'Feature', id: iso, properties: { iso }, geometry };
});
writeFileSync(tmpIn, JSON.stringify({ type: 'FeatureCollection', features }));

async function simplify(pct) {
  await mapshaper.runCommands(
    `-i "${tmpIn}" -simplify ${pct}% keep-shapes -o "${tmpOut}" format=geojson gj2008 precision=0.001 force`,
  );
  // mapshaper conserva id; re-aseguramos id/properties por si acaso.
  const fc = JSON.parse(readFileSync(tmpOut, 'utf8'));
  for (const f of fc.features) {
    const iso = f.properties?.iso ?? f.id;
    f.id = iso;
    f.properties = { iso };
  }
  const json = JSON.stringify(fc);
  return { json, bytes: Buffer.byteLength(json), features: fc.features.length };
}

let chosen = null;
for (const pct of [40, 30, 22, 15, 10]) {
  const r = await simplify(pct);
  console.log(`  -simplify ${pct}% → ${(r.bytes / 1024 / 1024).toFixed(2)} MB (${r.features} features)`);
  chosen = { pct, ...r };
  if (r.bytes <= MAX_BYTES) break;
}

writeFileSync(outFile, chosen.json);
const bytes = statSync(outFile).size;
console.log(`✓ world.json: ${chosen.features} features, ${(bytes / 1024 / 1024).toFixed(2)} MB (-simplify ${chosen.pct}% keep-shapes, gj2008, precision 0.001)`);
