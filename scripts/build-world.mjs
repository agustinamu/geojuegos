// Mapa base → public/data/world.json
// Combina los public/shapes/<iso>.json (GeometryCollection, winding gj2008 ya
// correcto para d3-geo) en UN TopoJSON con objeto "countries":
//   geometría = { id:"<iso>", properties:{iso}, ... }
// La unión sin simplificar pesa ~3.6 MB (≈283k vértices, TARGET_VERTICES=1200
// por país es fiel para siluetas pero excesivo para un basemap). Para bajar de
// ~1.5 MB se re-simplifica con mapshaper (-simplify keep-shapes) y se emite
// TopoJSON (quantization=1e5): deduplica arcos compartidos entre vecinos, ~⅓
// del peso del GeoJSON equivalente. mapshaper NO rebobina anillos al emitir
// TopoJSON (RFC 7946 solo aplica a GeoJSON), así que el winding gj2008 de los
// shapes llega intacto a d3-geo tras feature() — mismo enfoque que flagmaps.
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
    `-i "${tmpIn}" -simplify ${pct}% keep-shapes -rename-layers countries -o "${tmpOut}" format=topojson quantization=1e5 force`,
  );
  // mapshaper conserva id; re-aseguramos id/properties por si acaso.
  const topo = JSON.parse(readFileSync(tmpOut, 'utf8'));
  const geoms = topo.objects.countries.geometries;
  for (const g of geoms) {
    const iso = g.properties?.iso ?? g.id;
    g.id = iso;
    g.properties = { iso };
  }
  const json = JSON.stringify(topo);
  return { json, bytes: Buffer.byteLength(json), features: geoms.length };
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
console.log(`✓ world.json: ${chosen.features} features, ${(bytes / 1024 / 1024).toFixed(2)} MB (-simplify ${chosen.pct}% keep-shapes, topojson quantization=1e5)`);
