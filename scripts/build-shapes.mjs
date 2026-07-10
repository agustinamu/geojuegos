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
import { geoArea, geoCentroid } from 'd3-geo';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, 'data', 'cache');
const splitDir = path.join(cacheDir, 'split');
const shapesDir = path.join(root, 'public', 'shapes');
const flagsDir = path.join(root, 'public', 'flags');
mkdirSync(cacheDir, { recursive: true });
mkdirSync(path.join(root, 'public', 'data'), { recursive: true });

const TARGET_VERTICES = 1200;
// Por debajo de esto la forma de NE 10m se ve basta comparada con el resto
// (mediana ~930 vértices; por debajo de ~300 hay una cola de microestados e
// islas con silueta pobre): se sustituye por la geometría OSM de geoBoundaries
// o Nominatim. El árbitro de áreas descarta los candidatos OSM malos.
const MIN_VERTICES = 300;
// Territorios sin entrada propia en geoBoundaries.
const NOMINATIM_QUERIES = {
  sx: 'Sint Maarten',
  mf: 'Collectivité de Saint-Martin',
  nf: 'Norfolk Island',
};
const USER_AGENT = 'geojuegos-build/0.1 (https://github.com/agustinamu/geojuegos)';

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

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.json();
}

// Features candidatas con la geometría OSM del territorio (geoBoundaries da
// una; Nominatim varias, porque su primer resultado a veces es el límite
// marítimo y otro el terrestre). Caché en data/cache/detail/.
async function fetchDetailedCandidates(iso, a3) {
  const cached = path.join(cacheDir, 'detail', `candidates-${iso}.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8'));
  let features;
  if (NOMINATIM_QUERIES[iso]) {
    const q = encodeURIComponent(NOMINATIM_QUERIES[iso]);
    const results = await fetchJson(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=jsonv2&polygon_geojson=1&limit=5`,
    );
    features = results
      .filter((r) => r.geojson && ['Polygon', 'MultiPolygon'].includes(r.geojson.type))
      .map((r) => ({ type: 'Feature', properties: {}, geometry: r.geojson }));
    if (!features.length) throw new Error('Nominatim sin resultado');
    await new Promise((r) => setTimeout(r, 1100)); // política de uso de Nominatim: 1 req/s
  } else {
    const meta = await fetchJson(`https://www.geoboundaries.org/api/current/gbOpen/${a3}/ADM0/`);
    const gj = await fetchJson(meta.gjDownloadURL);
    features = gj.type === 'FeatureCollection' ? [gj.features[0]] : [gj];
  }
  mkdirSync(path.dirname(cached), { recursive: true });
  writeFileSync(cached, JSON.stringify(features));
  return features;
}

// Superficies reales (Banco Mundial vía flagmaps) como árbitro de calidad.
const statsFile = path.join(root, '..', 'flagmaps', 'public', 'data', 'stats.json');
const refAreas = existsSync(statsFile) ? JSON.parse(readFileSync(statsFile, 'utf8')).countries : {};
const KM2 = 6371 * 6371;

// Sustituye shapes/<iso>.json por la versión OSM solo si su superficie se
// acerca más a la real que la de NE (los límites admin de OSM a veces incluyen
// aguas territoriales, y NE dibuja manchas infladas o encogidas en
// microestados; la superficie publicada arbitra). Devuelve true si sustituyó.
async function upgradeSmallShape(iso, a3, name, outFile) {
  let candidates;
  try {
    candidates = await fetchDetailedCandidates(iso, a3);
  } catch (err) {
    console.warn(`· ${name} (${iso}): sin detalle OSM — ${err.message}`);
    return false;
  }
  const neArea = geoArea(JSON.parse(readFileSync(outFile, 'utf8'))) * KM2;
  const ref = refAreas[iso]?.area;
  // OSM detalla mejor la costa siempre; el único fallo que trae es incluir
  // aguas territoriales, y eso se delata por un área mucho mayor que la
  // terrestre (NE o publicada). Área menor nunca es señal de aguas.
  // Floor de 1 km²: en microestados NE puede estar tan encogido que 3×NE
  // rechazaría la forma buena.
  const maxArea = 3 * Math.max(neArea, ref ?? 0, 1);
  const tmpIn = path.join(splitDir, `detail-${iso}.json`);
  const tmpOut = path.join(splitDir, `detail-${iso}-out.json`);
  for (const feature of candidates) {
    writeFileSync(tmpIn, JSON.stringify(feature));
    const pct = Math.min(100, (TARGET_VERTICES / countVertices(feature.geometry)) * 100);
    await mapshaper.runCommands(
      [
        `-i "${tmpIn}"`,
        pct < 100 ? `-simplify ${pct}% keep-shapes` : '',
        '-filter-fields',
        `-o "${tmpOut}" format=geojson gj2008 precision=0.00001 force`,
      ]
        .filter(Boolean)
        .join(' '),
    );
    const osm = JSON.parse(readFileSync(tmpOut, 'utf8'));
    const osmArea = geoArea(osm) * KM2;
    if (osmArea > maxArea) continue;
    writeFileSync(outFile, JSON.stringify(osm));
    return true;
  }
  console.warn(
    `· ${name} (${iso}): todos los candidatos OSM incluyen aguas — se mantiene NE (NE ${neArea.toFixed(1)} km² · real ${ref ?? '?'} km²)`,
  );
  return false;
}

const flags = new Set(readdirSync(flagsDir).map((f) => f.replace('.svg', '')));
const shp = await fetchNaturalEarth('10m');

rmSync(splitDir, { recursive: true, force: true });
mkdirSync(splitDir, { recursive: true });
await mapshaper.runCommands(
  [
    `-i "${shp}"`,
    `-filter "ISO_A2_EH && ISO_A2_EH.length === 2 && CONTINENT !== 'Antarctica'"`,
    `-each "iso = ISO_A2_EH.toLowerCase(); a3 = ISO_A3_EH; name = NAME_ES || NAME; continent = CONTINENT"`,
    '-filter-fields iso,a3,name,continent',
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
  const { iso, a3, name, continent } = feat.properties;
  if (!flags.has(iso)) {
    console.warn(`· ${name} (${iso}) sin bandera — excluido`);
    skipped++;
    continue;
  }
  const outFile = path.join(shapesDir, `${iso}.json`);
  const neVertices = countVertices(feat.geometry);
  const pct = Math.min(100, (TARGET_VERTICES / neVertices) * 100);
  await mapshaper.runCommands(
    [
      `-i "${path.join(splitDir, file)}"`,
      pct < 100 ? `-simplify ${pct}% keep-shapes` : '',
      '-filter-fields',
      // gj2008: winding pre-RFC7946, el que espera d3-geo (si no, rellena la esfera entera).
      `-o "${outFile}" format=geojson gj2008 precision=0.00001`,
    ]
      .filter(Boolean)
      .join(' '),
  );
  if (neVertices < MIN_VERTICES && (await upgradeSmallShape(iso, a3, name, outFile))) {
    console.log(`↑ ${name} (${iso}): ${neVertices} vértices NE → OSM`);
  }
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
