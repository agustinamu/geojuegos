// Verificación de borders.json y world.json. Sólo lectura, imprime JSON.
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoArea } from 'd3-geo';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const countries = JSON.parse(readFileSync(resolve(root, 'public/data/countries.json'), 'utf8'));
const borders = JSON.parse(readFileSync(resolve(root, 'public/data/borders.json'), 'utf8'));
const world = JSON.parse(readFileSync(resolve(root, 'public/data/world.json'), 'utf8'));

const name = Object.fromEntries(countries.map((c) => [c.iso, c.name]));
const allIsos = countries.map((c) => c.iso);
const issues = [];

// Cobertura
const withNeighbors = allIsos.filter((i) => borders[i] && borders[i].length);
const without = allIsos.filter((i) => !borders[i] || !borders[i].length).sort();

// Vecinos que apuntan a isos fuera de countries.json (no debería haber)
for (const [a, list] of Object.entries(borders)) {
  if (!allIsos.includes(a)) issues.push(`borders tiene iso desconocido: ${a}`);
  for (const b of list) if (!allIsos.includes(b)) issues.push(`vecino desconocido ${b} en ${a}`);
}

// Simetría
let symmetryOk = true;
for (const [a, list] of Object.entries(borders)) {
  for (const b of list) {
    if (!borders[b] || !borders[b].includes(a)) {
      symmetryOk = false;
      issues.push(`asimetría: ${a}->${b} pero no ${b}->${a}`);
    }
  }
}

// Componentes conexas (sólo nodos con >=1 vecino)
const seen = new Set();
const components = [];
for (const start of withNeighbors) {
  if (seen.has(start)) continue;
  const comp = [];
  const stack = [start];
  seen.add(start);
  while (stack.length) {
    const n = stack.pop();
    comp.push(n);
    for (const m of borders[n] || []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
  }
  components.push(comp);
}
const bigComps = components.filter((c) => c.length >= 2).sort((a, b) => b.length - a.length);

// BFS distancias
function bfs(src) {
  const dist = { [src]: 0 };
  const q = [src];
  while (q.length) {
    const n = q.shift();
    for (const m of borders[n] || []) if (!(m in dist)) { dist[m] = dist[n] + 1; q.push(m); }
  }
  return dist;
}

// Pares jugables: óptimo BFS en [2,6], misma componente (garantizado por dist finita)
let playablePairCount = 0;
const samples = [];
for (const a of withNeighbors) {
  const dist = bfs(a);
  for (const b of Object.keys(dist)) {
    if (a < b && dist[b] >= 2 && dist[b] <= 6) {
      playablePairCount++;
      if (samples.length < 40 && Math.random() < 0.02) {
        samples.push({ a, aName: name[a], b, bName: name[b], optimal: dist[b] });
      }
    }
  }
}
// 8 ejemplos variados por longitud óptima
const byOpt = {};
for (const s of samples) (byOpt[s.optimal] ||= []).push(s);
const playablePairsSample = [];
for (const opt of [2, 3, 4, 5, 6]) if (byOpt[opt]) playablePairsSample.push(byOpt[opt][0]);
for (const s of samples) { if (playablePairsSample.length >= 8) break; if (!playablePairsSample.includes(s)) playablePairsSample.push(s); }

// world.json: winding sanity (geoArea de un país no debe acercarse a 4π=12.566)
const worldBytes = statSync(resolve(root, 'public/data/world.json')).size;
let maxArea = 0, maxAreaIso = null;
const idsSet = new Set();
for (const f of world.features) {
  idsSet.add(f.id);
  if (f.properties?.iso !== f.id) issues.push(`world feature id/props desalineado: ${f.id}`);
  const ar = geoArea(f);
  if (ar > maxArea) { maxArea = ar; maxAreaIso = f.id; }
}
if (maxArea > 6.3) issues.push(`winding sospechoso: ${maxAreaIso} geoArea=${maxArea.toFixed(2)} (≈esfera=12.57)`);
// Cobertura world vs countries
const worldMissing = allIsos.filter((i) => !idsSet.has(i));
if (worldMissing.length) issues.push(`world.json sin features para: ${worldMissing.join(',')}`);

console.log(JSON.stringify({
  countriesTotal: allIsos.length,
  bordersEntries: withNeighbors.length,
  isoMissingFromBorders: without,
  symmetryOk,
  componentCount: bigComps.length,
  largestComponentSize: bigComps[0]?.length ?? 0,
  componentSizes: bigComps.map((c) => c.length),
  playablePairCount,
  playablePairsSample,
  worldFeatureCount: world.features.length,
  worldFileBytes: worldBytes,
  maxCountryGeoArea: Number(maxArea.toFixed(3)),
  maxCountryGeoAreaIso: maxAreaIso,
  issues,
}, null, 2));
