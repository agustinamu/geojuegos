// Siluetas por país desde Natural Earth 10m (máximo detalle disponible).
// Un mapa mundial simplificado deja a los países pequeños con media docena de
// vértices, así que aquí cada país se simplifica por separado hacia un número
// de vértices objetivo y se emite como fichero individual:
//   public/shapes/<iso>.json  — GeoJSON Feature (solo geometría)
//   public/data/countries.json — índice {iso, name, continent, centroid}
// Requiere las banderas ya sincronizadas (npm run sync:data): los países sin
// bandera se excluyen para que la ronda de banderas nunca rompa.
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mapshaper from 'mapshaper';
import { geoCentroid } from 'd3-geo';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, 'data', 'cache');
const splitDir = path.join(cacheDir, 'split');
const shapesDir = path.join(root, 'public', 'shapes');
const flagsDir = path.join(root, 'public', 'flags');
mkdirSync(cacheDir, { recursive: true });
mkdirSync(path.join(root, 'public', 'data'), { recursive: true });

const TARGET_VERTICES = 1200;

async function fetchNaturalEarth(scale) {
  const base = `ne_${scale}_admin_0_countries`;
  const zip = path.join(cacheDir, `${base}.zip`);
  const shp = path.join(cacheDir, base, `${base}.shp`);
  if (existsSync(shp)) return shp;
  if (!existsSync(zip)) {
    const url = `https://naciscdn.org/naturalearth/${scale}/cultural/${base}.zip`;
    console.log(`Descargando ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));
  }
  execFileSync('unzip', ['-o', '-q', zip, '-d', path.join(cacheDir, base)]);
  return shp;
}

function countVertices(geometry) {
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat(1);
  return rings.reduce((n, ring) => n + ring.length, 0);
}

const flags = new Set(readdirSync(flagsDir).map((f) => f.replace('.svg', '')));
const shp = await fetchNaturalEarth('10m');

rmSync(splitDir, { recursive: true, force: true });
mkdirSync(splitDir, { recursive: true });
await mapshaper.runCommands(
  [
    `-i "${shp}"`,
    `-filter "ISO_A2_EH && ISO_A2_EH.length === 2 && CONTINENT !== 'Antarctica'"`,
    `-each "iso = ISO_A2_EH.toLowerCase(); name = NAME_ES || NAME; continent = CONTINENT"`,
    '-filter-fields iso,name,continent',
    '-split iso',
    `-o "${splitDir}" format=geojson`,
  ].join(' '),
);

rmSync(shapesDir, { recursive: true, force: true });
mkdirSync(shapesDir, { recursive: true });
const index = [];
let skipped = 0;

for (const file of readdirSync(splitDir).sort()) {
  const fc = JSON.parse(readFileSync(path.join(splitDir, file), 'utf8'));
  const feat = fc.features[0];
  const { iso, name, continent } = feat.properties;
  if (!flags.has(iso)) {
    console.warn(`· ${name} (${iso}) sin bandera — excluido`);
    skipped++;
    continue;
  }
  const pct = Math.min(100, (TARGET_VERTICES / countVertices(feat.geometry)) * 100);
  await mapshaper.runCommands(
    [
      `-i "${path.join(splitDir, file)}"`,
      pct < 100 ? `-simplify ${pct}% keep-shapes` : '',
      '-filter-fields',
      // gj2008: winding pre-RFC7946, el que espera d3-geo (si no, rellena la esfera entera).
      `-o "${path.join(shapesDir, `${iso}.json`)}" format=geojson gj2008 precision=0.00001`,
    ]
      .filter(Boolean)
      .join(' '),
  );
  // Centroide sobre el fichero final (winding gj2008): sobre el intermedio
  // RFC7946 d3 devuelve el antípoda y la proyección del juego se va al lado
  // opuesto de la esfera.
  const finalShape = JSON.parse(readFileSync(path.join(shapesDir, `${iso}.json`), 'utf8'));
  const centroid = geoCentroid(finalShape).map((v) => Math.round(v * 1e4) / 1e4);
  index.push({ iso, name, continent, centroid });
}

index.sort((a, b) => a.name.localeCompare(b.name, 'es'));
writeFileSync(path.join(root, 'public', 'data', 'countries.json'), JSON.stringify(index));
console.log(`✓ ${index.length} países → public/shapes/ + countries.json (${skipped} excluidos)`);
