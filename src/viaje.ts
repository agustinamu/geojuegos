import { fetchJson, flagThumbUrl, loadCountries } from './data';
import type { Country } from './data';
import { loadShape, silhouetteSvg } from './geo';
import { geoArea, geoBounds, geoCentroid, geoDistance, geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { createCombobox, loadError, qs, span } from './ui';

const MAX_ATTEMPTS = 6; // fallos (países no contiguos) antes de perder
const MIN_OPT = 2; // óptimo mínimo para que un par sea jugable
const MAX_OPT = 6; // óptimo máximo
// Lienzo del mapa: relación ~1.55 (parecida a la de Natural Earth). viewBox fijo
// → la caja no salta de tamaño al reencuadrar; el contenido se centra dentro.
const MAP_W = 960;
const MAP_H = 620;
const MAP_MARGIN = 46; // margen generoso alrededor de la región A–B
const SVG_NS = 'http://www.w3.org/2000/svg';

type IsoProps = { iso: string };
type WorldFeature = Feature<Geometry, IsoProps>;
type WorldFC = FeatureCollection<Geometry, IsoProps>;
type Pair = { a: string; b: string; optimal: number };

const mapEl = qs<HTMLDivElement>('#map');
const routeEl = qs<HTMLParagraphElement>('#route');
const chainEl = qs<HTMLOListElement>('#chain');
const form = qs<HTMLFormElement>('#guess-form');
const input = qs<HTMLInputElement>('#guess');
const suggestionsEl = qs<HTMLUListElement>('#suggestions');
const undoBtn = qs<HTMLButtonElement>('#btn-undo');
const failsEl = qs<HTMLDivElement>('#fails');
const verdictEl = qs<HTMLParagraphElement>('#verdict');
const hintNextBtn = qs<HTMLButtonElement>('#hint-next');
const hintNeighBtn = qs<HTMLButtonElement>('#hint-neigh');
const hintMapBtn = qs<HTMLButtonElement>('#hint-map');
const hintShapesEl = qs<HTMLDivElement>('#hint-shapes');
const resultEl = qs<HTMLElement>('#result');
const solutionEl = qs<HTMLParagraphElement>('#solution');
const againBtn = qs<HTMLButtonElement>('#btn-again');

// —— Datos e índices ——
let countries: Country[] = [];
const countryByIso = new Map<string, Country>();
const graph = new Map<string, Set<string>>(); // iso → vecinos terrestres
let pairs: Pair[] = []; // pares jugables (ordenados; ambos sentidos)
const worldByIso = new Map<string, WorldFeature>(); // geometría por iso (fuente, no basemap)
let mapSvg: SVGSVGElement; // único <svg>
let mapG: SVGGElement; // capa de países; su contenido se rehace en cada reencuadre

// Botón flotante para volver al encuadre base; se crea aquí y lo coloca initMap.
const recenterBtn = document.createElement('button');
recenterBtn.id = 'btn-recenter';
recenterBtn.type = 'button';
recenterBtn.textContent = 'Centrar';
recenterBtn.hidden = true;
recenterBtn.addEventListener('click', () => resetView());

// —— Estado de ronda ——
let origin = ''; // A
let dest = ''; // B
let optimal = 0; // óptimo BFS de A a B
let chain: string[] = []; // cadena escrita, empieza en [A]; la punta es el actual
let fails = 0;
let finished = false;
let neighborsShown = false; // ayuda 3: vecinos resaltados en el mapa
let hintToken = 0; // anti-carreras al cargar siluetas de ayuda

const combo = createCombobox({
  form,
  input,
  list: suggestionsEl,
  // Todos los países son candidatos: así el jugador puede toparse con el aviso
  // de "ya en la cadena" y con el gasto de intento al nombrar un no limítrofe.
  candidates: () => countries,
  onPick: submitGuess,
});

// —— Grafo y BFS ——

function buildGraph(borders: Record<string, string[]>): void {
  for (const [iso, neigh] of Object.entries(borders)) {
    const set = graph.get(iso) ?? new Set<string>();
    for (const n of neigh) {
      set.add(n);
      // Refuerza simetría por si acaso; la fuente ya la garantiza.
      const back = graph.get(n) ?? new Set<string>();
      back.add(iso);
      graph.set(n, back);
    }
    graph.set(iso, set);
  }
}

// Distancias en aristas desde start a todo lo alcanzable.
function bfsDist(start: string): Map<string, number> {
  const dist = new Map<string, number>([[start, 0]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i];
    const du = dist.get(u)!;
    for (const v of graph.get(u) ?? []) {
      if (!dist.has(v)) {
        dist.set(v, du + 1);
        queue.push(v);
      }
    }
  }
  return dist;
}

// Un camino mínimo start→goal (isos incluidos); [] si no hay ruta. `blocked`
// marca nodos intransitables (p. ej. países ya en la cadena) salvo el propio start.
function bfsPath(start: string, goal: string, blocked?: Set<string>): string[] {
  if (start === goal) return [start];
  const prev = new Map<string, string>();
  const seen = new Set<string>([start]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i];
    for (const v of graph.get(u) ?? []) {
      if (seen.has(v) || blocked?.has(v)) continue;
      seen.add(v);
      prev.set(v, u);
      if (v === goal) {
        const path = [v];
        let c = v;
        while (c !== start) {
          c = prev.get(c)!;
          path.push(c);
        }
        return path.reverse();
      }
      queue.push(v);
    }
  }
  return [];
}

// Pares jugables: misma componente (distancia finita) y óptimo en [MIN_OPT, MAX_OPT].
function buildPairs(): void {
  for (const a of graph.keys()) {
    for (const [b, d] of bfsDist(a)) {
      if (d >= MIN_OPT && d <= MAX_OPT) pairs.push({ a, b, optimal: d });
    }
  }
}

// Componentes conexas (solo informativo/depuración).
function componentCount(): number {
  const seen = new Set<string>();
  let count = 0;
  for (const start of graph.keys()) {
    if (seen.has(start)) continue;
    count++;
    const queue = [start];
    seen.add(start);
    for (let i = 0; i < queue.length; i++) {
      for (const v of graph.get(queue[i]) ?? []) {
        if (!seen.has(v)) {
          seen.add(v);
          queue.push(v);
        }
      }
    }
  }
  return count;
}

// —— Mapa: solo la región A–B, revelada progresivamente ——
//
// A diferencia de los otros juegos, world.json NO se pinta entero: es la fuente
// de geometrías por iso. Solo se dibujan A, B, la cadena y (temporalmente) los
// vecinos de la ayuda 3; la proyección se reencuadra a lo visible en cada cambio.

function initMap(world: WorldFC): void {
  for (const f of world.features) worldByIso.set(f.properties.iso, f);
  mapSvg = document.createElementNS(SVG_NS, 'svg');
  mapSvg.setAttribute('viewBox', `0 0 ${MAP_W} ${MAP_H}`);
  mapSvg.setAttribute('role', 'img');
  mapSvg.setAttribute('aria-label', 'Mapa mundi');
  // Los países cuelgan de un <g> con transform de vista (zoom/desplazamiento).
  mapG = document.createElementNS(SVG_NS, 'g');
  mapSvg.append(mapG);
  mapEl.replaceChildren(mapSvg, recenterBtn);
  initPanZoom();
}

// —— Zoom y desplazamiento del mapa (ratón, rueda y táctil con pinza) ——

const MIN_SCALE = 1; // 1 = encuadre ajustado; no se aleja más
const MAX_SCALE = 8;
const view = { k: 1, x: 0, y: 0 }; // transform aplicado a mapG
const pointers = new Map<number, { x: number; y: number }>();
let pinchDist = 0;

function applyView(): void {
  mapG.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
  recenterBtn.hidden = view.k === 1 && view.x === 0 && view.y === 0;
}

function resetView(): void {
  view.k = 1;
  view.x = 0;
  view.y = 0;
  applyView();
}

// Coordenadas de cliente → coordenadas del viewBox del SVG.
function toSvg(ev: { clientX: number; clientY: number }): { x: number; y: number } {
  const r = mapSvg.getBoundingClientRect();
  return { x: ((ev.clientX - r.left) / r.width) * MAP_W, y: ((ev.clientY - r.top) / r.height) * MAP_H };
}

// Escala alrededor de un punto del viewBox, manteniéndolo fijo bajo el cursor/dedo.
function zoomAt(px: number, py: number, factor: number): void {
  const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.k * factor));
  const f = k / view.k;
  view.k = k;
  if (k === MIN_SCALE) {
    view.x = 0; // de vuelta al encuadre base, recentra del todo
    view.y = 0;
  } else {
    view.x = px - f * (px - view.x);
    view.y = py - f * (py - view.y);
  }
  applyView();
}

function pointsDist(): number {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointsMid(): { x: number; y: number } {
  const [a, b] = [...pointers.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function initPanZoom(): void {
  mapSvg.addEventListener(
    'wheel',
    (e) => {
      // Rueda directa (preferencia del dueño tras probarlo): el scroll de
      // página se detiene sobre el mapa, a cambio de zoom sin modificador.
      e.preventDefault();
      const p = toSvg(e);
      zoomAt(p.x, p.y, e.deltaY < 0 ? 1.2 : 1 / 1.2);
    },
    { passive: false },
  );
  mapSvg.addEventListener('pointerdown', (e) => {
    mapSvg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, toSvg(e));
    if (pointers.size === 2) pinchDist = pointsDist();
  });
  mapSvg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId)!;
    const cur = toSvg(e);
    pointers.set(e.pointerId, cur);
    if (pointers.size === 1) {
      // Un dedo no panea (touch-action: pan-y deja ese gesto al scroll de página).
      if (e.pointerType === 'touch') return;
      view.x += cur.x - prev.x; // desplazar
      view.y += cur.y - prev.y;
      applyView();
    } else if (pointers.size === 2 && pinchDist > 0) {
      const d = pointsDist();
      const mid = pointsMid();
      zoomAt(mid.x, mid.y, d / pinchDist); // pinza
      pinchDist = d;
    }
  });
  const end = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
  };
  mapSvg.addEventListener('pointerup', end);
  mapSvg.addEventListener('pointercancel', end);
  mapSvg.addEventListener('dblclick', (e) => {
    e.preventDefault();
    resetView();
  });
}

// Longitud central de la región visible, con corrección de antimeridiano
// (geoBounds devuelve oeste>este cuando la caja cruza el ±180).
function centerLon(fc: WorldFC): number {
  const [[west], [east]] = geoBounds(fc);
  let width = east - west;
  if (width < 0) width += 360; // cruza el antimeridiano
  const mid = west + width / 2;
  return ((mid + 180) % 360 + 360) % 360 - 180; // normaliza a [-180, 180]
}

// Prioridad de dibujo: los vecinos-ayuda debajo; la punta actual arriba del todo
// para que su contorno claro no quede tapado por rellenos contiguos.
function drawOrder(iso: string, current: string, neigh: Set<string>): number {
  if (iso === current) return 2;
  if (neigh.has(iso)) return 0;
  return 1;
}

function classFor(iso: string, current: string, chainSet: Set<string>, neigh: Set<string>): string {
  let cls = 'country';
  if (iso === origin) cls += ' a';
  else if (iso === dest) cls += ' b';
  else if (chainSet.has(iso)) cls += ' chain';
  else if (neigh.has(iso)) cls += ' neighbor';
  if (iso === current) cls += ' current';
  return cls;
}

// Territorios más lejanos que esto del centroide oficial se ocultan del mapa.
const TRIM_RAD = 1400 / 6371; // ~1400 km sobre la esfera terrestre

const mainPartCache = new Map<string, WorldFeature>();

function polygonsOf(geom: Geometry): number[][][][] {
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}

// Recorta la geometría de un país a su masa principal: el polígono de mayor área
// más los que queden cerca del centroide oficial. Sin esto, los territorios de
// ultramar (Guayana, Alaska, Canarias, Isla de Pascua…) estirarían fitExtent a
// varios hemisferios y dejarían A y B como motas.
function mainPart(iso: string): WorldFeature | undefined {
  const cached = mainPartCache.get(iso);
  if (cached) return cached;
  const f = worldByIso.get(iso);
  if (!f) return undefined;
  const polys = polygonsOf(f.geometry);
  let out: WorldFeature = f;
  if (polys.length > 1) {
    const center = countryByIso.get(iso)?.centroid;
    const areas = polys.map((coords) => geoArea({ type: 'Polygon', coordinates: coords }));
    let largest = 0;
    for (let i = 1; i < areas.length; i++) if (areas[i] > areas[largest]) largest = i;
    const kept = polys.filter((coords, i) => {
      if (i === largest) return true; // el continente siempre se conserva
      if (!center) return false;
      const c = geoCentroid({ type: 'Polygon', coordinates: coords });
      return geoDistance(center, c) <= TRIM_RAD;
    });
    const geometry: Geometry =
      kept.length === 1
        ? { type: 'Polygon', coordinates: kept[0] }
        : { type: 'MultiPolygon', coordinates: kept };
    out = { type: 'Feature', id: iso, properties: { iso }, geometry };
  }
  mainPartCache.set(iso, out);
  return out;
}

// Reencuadra y redibuja el mapa con lo visible en el estado actual (reencuadre
// directo; sin transición, robusto ante regiones muy dispares de una ronda a otra).
function renderMap(): void {
  const current = chain[chain.length - 1];
  const chainSet = new Set(chain);
  const neigh = neighborsShown ? graph.get(current) ?? new Set<string>() : new Set<string>();
  const isos = new Set<string>([origin, dest, ...chain, ...neigh]);

  const features: WorldFeature[] = [];
  for (const iso of isos) {
    const f = mainPart(iso);
    if (f) features.push(f);
  }
  const fc: WorldFC = { type: 'FeatureCollection', features };

  // Recentra el meridiano en la región → evita cortes de países que cruzan el
  // antimeridiano (p. ej. Rusia) y centra el encuadre antes de ajustar tamaño.
  const projection = geoNaturalEarth1().rotate([-centerLon(fc), 0]);
  projection.fitExtent(
    [
      [MAP_MARGIN, MAP_MARGIN],
      [MAP_W - MAP_MARGIN, MAP_H - MAP_MARGIN],
    ],
    fc,
  );
  const pathGen = geoPath(projection);

  features.sort((x, y) => drawOrder(x.properties.iso, current, neigh) - drawOrder(y.properties.iso, current, neigh));
  const paths = features.map((f) => {
    const iso = f.properties.iso;
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', pathGen(f) ?? '');
    p.setAttribute('class', classFor(iso, current, chainSet, neigh));
    p.dataset.iso = iso;
    return p;
  });
  mapG.replaceChildren(...paths);
}

// —— Render de la interfaz ——

function chip(iso: string, extra: string): HTMLElement {
  const el = document.createElement('li');
  el.className = 'chip' + (extra ? ' ' + extra : '');
  const img = document.createElement('img');
  img.className = 'mini-flag';
  img.src = flagThumbUrl(iso);
  img.alt = '';
  el.append(img, span('c-name', countryByIso.get(iso)?.name ?? iso));
  return el;
}

function renderRoute(): void {
  const from = chip(origin, 'a');
  const to = chip(dest, 'b');
  const arrow = span('arrow', '→');
  routeEl.replaceChildren(from, arrow, to);
}

function renderChain(): void {
  chainEl.replaceChildren(
    ...chain.map((iso, i) => {
      const extra = [
        iso === origin ? 'a' : '',
        iso === dest ? 'b' : '',
        i === chain.length - 1 ? 'current' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return chip(iso, extra);
    }),
  );
  undoBtn.hidden = finished || chain.length <= 1;
}

function renderFails(): void {
  failsEl.replaceChildren(
    ...Array.from({ length: MAX_ATTEMPTS }, (_, i) => {
      const pip = document.createElement('span');
      pip.className = 'pip' + (i < fails ? ' used' : '');
      return pip;
    }),
    span('fails-label', `${MAX_ATTEMPTS - fails} intentos`),
  );
}

function msg(text: string, cls: string): void {
  verdictEl.textContent = text;
  verdictEl.className = cls;
}

// —— Lógica de juego ——

function submitGuess(country: Country): void {
  if (finished) return;
  const iso = country.iso;
  const current = chain[chain.length - 1];
  const currentName = countryByIso.get(current)!.name;

  if (chain.includes(iso)) {
    msg(`${country.name} ya está en la cadena.`, '');
    input.focus();
    return;
  }

  const neigh = graph.get(current) ?? new Set<string>();
  if (!neigh.has(iso)) {
    fails++;
    msg(`${country.name} no limita con ${currentName}.`, 'bad');
    renderFails();
    if (fails >= MAX_ATTEMPTS) lose();
    else input.focus();
    return;
  }

  // País contiguo: avanza la cadena (aunque no sea el óptimo).
  chain.push(iso);
  hintShapesEl.replaceChildren();
  renderChain();
  setNeighborsShown(false); // también redibuja el mapa

  if (iso === dest) {
    win();
    return;
  }
  msg(`Bien: ${country.name}. Ahora limita desde aquí.`, 'ok');
  input.focus();
}

// Retrocede un paso de la cadena. No devuelve intentos (esos son por países no
// limítrofes); sirve para salir de un rodeo o de un callejón sin salida.
function undo(): void {
  if (finished || chain.length <= 1) return;
  chain.pop();
  hintShapesEl.replaceChildren();
  renderChain();
  setNeighborsShown(false); // también redibuja el mapa
  const currentName = countryByIso.get(chain[chain.length - 1])!.name;
  msg(`Deshecho. Ahora limita desde ${currentName}.`, '');
  input.focus();
}

function endRound(): void {
  finished = true;
  form.hidden = true;
  undoBtn.hidden = true;
  resultEl.hidden = false;
  hintNextBtn.disabled = true;
  hintNeighBtn.disabled = true;
  hintMapBtn.disabled = true;
  againBtn.focus(); // el input queda oculto: sin esto el foco cae a body
}

function routeText(prefix: string, path: string[]): string {
  return prefix + path.map((iso) => countryByIso.get(iso)?.name ?? iso).join(' → ');
}

function win(): void {
  const steps = chain.length - 1;
  const extra = steps - optimal;
  if (extra === 0) {
    msg(`¡Camino más corto! Lo lograste en ${steps} países.`, 'ok');
    solutionEl.textContent = '';
  } else {
    msg(`Llegaste en ${steps} países, ${extra} más que el camino más corto (${optimal}).`, 'ok');
    solutionEl.textContent = routeText(`El camino más corto (${optimal} países): `, bfsPath(origin, dest));
  }
  endRound();
}

function lose(): void {
  const currentName = countryByIso.get(chain[chain.length - 1])!.name;
  const destName = countryByIso.get(dest)!.name;
  msg(`Sin intentos. Faltaba llegar a ${destName} desde ${currentName}.`, 'bad');
  solutionEl.textContent = routeText(`El camino más corto (${optimal} países): `, bfsPath(origin, dest));
  endRound();
}

// —— Ayudas ——

// Carga y pinta las siluetas de los isos dados en la zona de ayuda.
async function showSilhouettes(isos: string[]): Promise<void> {
  const token = ++hintToken;
  const size = 140;
  const figs = isos.map((iso) => {
    const fig = document.createElement('div');
    fig.className = 'hint-shape';
    return { iso, fig };
  });
  hintShapesEl.replaceChildren(...figs.map((f) => f.fig));
  // Descargas en paralelo; el await en orden mantiene el pintado estable.
  const loads = figs.map(({ iso }) => loadShape(iso));
  // Si otra ayuda corta el bucle (token), que ningún rechazo quede sin handler.
  for (const p of loads) p.catch(() => {});
  for (const [i, { iso, fig }] of figs.entries()) {
    const country = countryByIso.get(iso);
    if (!country) continue;
    try {
      const shape = await loads[i];
      if (token !== hintToken) return; // llegó otra ayuda o ronda nueva
      fig.replaceChildren(silhouetteSvg(shape, country.centroid, size));
    } catch {
      // Silueta sin cargar: se deja el hueco vacío, no rompe el resto.
    }
  }
}

// Ayuda 1: silueta del siguiente país de una ruta óptima desde la punta actual,
// sin repetir países ya en la cadena (o el paso sugerido sería injugable).
function hintNext(): void {
  if (finished) return;
  const current = chain[chain.length - 1];
  const blocked = new Set(chain.filter((iso) => iso !== current));
  const path = bfsPath(current, dest, blocked);
  if (path.length < 2) {
    msg('Sin salida hacia el destino sin repetir países. Usa Deshacer.', 'bad');
    return;
  }
  void showSilhouettes([path[1]]);
}

// Ayuda 2: siluetas de todos los vecinos del país actual.
function hintNeighbors(): void {
  if (finished) return;
  const current = chain[chain.length - 1];
  void showSilhouettes([...(graph.get(current) ?? [])]);
}

// Estado del toggle "Vecinos (mapa)": variable, aria-pressed del botón y
// redibujo van siempre juntos, o el botón mentiría sobre el mapa.
function setNeighborsShown(v: boolean): void {
  neighborsShown = v;
  hintMapBtn.setAttribute('aria-pressed', String(v));
  renderMap();
}

// Ayuda 3: resalta en el mapa los vecinos del país actual (conmutable).
function hintMap(): void {
  if (finished) return;
  setNeighborsShown(!neighborsShown);
}

// —— Ciclo de ronda ——

function newRound(): void {
  const pair = pairs[Math.floor(Math.random() * pairs.length)];
  origin = pair.a;
  dest = pair.b;
  optimal = pair.optimal;
  chain = [origin];
  fails = 0;
  finished = false;
  hintToken++;
  hintShapesEl.replaceChildren();
  solutionEl.textContent = '';
  resultEl.hidden = true;
  form.hidden = false;
  hintNextBtn.disabled = false;
  hintNeighBtn.disabled = false;
  hintMapBtn.disabled = false;
  combo.clear();
  resetView();
  renderRoute();
  renderChain();
  renderFails();
  setNeighborsShown(false); // también redibuja el mapa
  msg(`Encadena países limítrofes desde ${countryByIso.get(origin)!.name} hasta ${countryByIso.get(dest)!.name}: el camino más corto son ${optimal} países.`, '');
  input.focus();
}

function showLoadError(err: unknown): void {
  loadError(mapEl, err);
}

hintNextBtn.addEventListener('click', hintNext);
hintNeighBtn.addEventListener('click', hintNeighbors);
hintMapBtn.addEventListener('click', hintMap);
undoBtn.addEventListener('click', undo);
againBtn.addEventListener('click', newRound);

Promise.all([
  loadCountries(),
  fetchJson<Record<string, string[]>>('../data/borders.json'),
  // TopoJSON (objeto "countries"): deduplica arcos compartidos entre vecinos.
  fetchJson<Topology>('../data/world.json'),
])
  .then(([allCountries, borders, topo]) => {
    const world = feature(topo, topo.objects.countries) as WorldFC;
    countries = allCountries;
    for (const c of countries) countryByIso.set(c.iso, c);
    buildGraph(borders);
    buildPairs();
    initMap(world);
    newRound();
  })
  .catch(showLoadError);

if (import.meta.env.DEV) {
  Object.defineProperty(window, '__pair', {
    get: () => ({
      a: countryByIso.get(origin)?.name,
      b: countryByIso.get(dest)?.name,
      optimal,
      chain: chain.map((iso) => countryByIso.get(iso)?.name),
      solution: bfsPath(origin, dest).map((iso) => countryByIso.get(iso)?.name),
    }),
  });
  Object.defineProperty(window, '__stats', {
    get: () => ({ nodes: graph.size, pairs: pairs.length, components: componentCount() }),
  });
}
