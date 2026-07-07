// Grafo de fronteras TERRESTRES → public/data/borders.json
//   { "<iso>": ["<vecino_iso>", ...] }  con iso alpha-2 minúscula.
// Fuente: mledoze/countries (cada país trae cca2, cca3 y "borders" en cca3).
// Se cachea la descarga en data/cache/, se mapea cca3→alpha-2 minúscula y se
// conserva sólo el espacio de isos de public/data/countries.json. Se fuerza
// simetría. Las islas quedan sin entrada (correcto: no tienen vecino terrestre).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = resolve(root, 'data', 'cache');
const cacheFile = resolve(cacheDir, 'mledoze-countries.json');
const URL = 'https://raw.githubusercontent.com/mledoze/countries/master/dist/countries.json';

mkdirSync(cacheDir, { recursive: true });

async function loadSource() {
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Descarga falló: ${res.status}`);
  const text = await res.text();
  writeFileSync(cacheFile, text);
  return JSON.parse(text);
}

const src = await loadSource();

// Espacio de isos válido: el de countries.json.
const countries = JSON.parse(readFileSync(resolve(root, 'public/data/countries.json'), 'utf8'));
const valid = new Set(countries.map((c) => c.iso));

// cca3 (mayúscula) → alpha-2 minúscula, usando el propio cca2 de la fuente.
const a3toA2 = new Map();
for (const c of src) {
  if (c.cca3 && c.cca2) a3toA2.set(c.cca3.toUpperCase(), c.cca2.toLowerCase());
}

const borders = {};
const unmappedA3 = new Set();
for (const c of src) {
  const iso = c.cca2 ? c.cca2.toLowerCase() : null;
  if (!iso || !valid.has(iso)) continue;
  const list = new Set();
  for (const a3 of c.borders || []) {
    const nb = a3toA2.get(a3.toUpperCase());
    if (!nb) { unmappedA3.add(a3); continue; }
    if (valid.has(nb)) list.add(nb);
  }
  if (list.size) borders[iso] = [...list];
}

// Simetría: si a∈borders[b] entonces b∈borders[a].
let added = 0;
for (const a of Object.keys(borders)) {
  for (const b of borders[a]) {
    if (!borders[b]) borders[b] = [];
    if (!borders[b].includes(a)) { borders[b].push(a); added++; }
  }
}

// Orden estable.
const out = {};
for (const iso of Object.keys(borders).sort()) out[iso] = borders[iso].sort();

writeFileSync(resolve(root, 'public/data/borders.json'), JSON.stringify(out));

const withNeighbors = Object.keys(out).length;
console.log(`✓ borders.json: ${withNeighbors} países con vecinos, ${added} añadidos por simetría`);
if (unmappedA3.size) console.log(`  cca3 sin mapear (ignorados): ${[...unmappedA3].join(', ')}`);
// Comprobación Kosovo.
console.log(`  xk → ${out.xk ? out.xk.join(',') : '(sin entrada)'}`);
