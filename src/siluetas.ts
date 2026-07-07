import {
  bearingDeg,
  distanceKm,
  flagThumbUrl,
  loadCountries,
  loadShape,
  MAX_DISTANCE_KM,
  silhouettePath,
} from './geo';
import type { Country } from './geo';
import type { GeoGeometryObjects } from 'd3-geo';

const MAX_ATTEMPTS = 6;
const FLAG_OPTIONS = 8;
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

const shapeEl = document.querySelector<HTMLDivElement>('#shape')!;
const form = document.querySelector<HTMLFormElement>('#guess-form')!;
const input = document.querySelector<HTMLInputElement>('#guess')!;
const suggestionsEl = document.querySelector<HTMLUListElement>('#suggestions')!;
const attemptsEl = document.querySelector<HTMLOListElement>('#attempts')!;
const resultEl = document.querySelector<HTMLElement>('#result')!;
const verdictEl = document.querySelector<HTMLParagraphElement>('#verdict')!;
const flagRoundEl = document.querySelector<HTMLDivElement>('#flag-round')!;
const flagGridEl = document.querySelector<HTMLDivElement>('#flag-grid')!;
const flagVerdictEl = document.querySelector<HTMLParagraphElement>('#flag-verdict')!;
const againBtn = document.querySelector<HTMLButtonElement>('#btn-again')!;

type Round = { country: Country; shape: Promise<GeoGeometryObjects | null> };

let countries: Country[] = [];
let normalized = new Map<Country, string>();
let target: Country;
let guessed = new Set<string>();
let finished = false;
let highlighted = -1;
let round = 0;
let prefetched: Round | null = null;

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickRound(): Round {
  const country = countries[Math.floor(Math.random() * countries.length)];
  return { country, shape: loadShape(country.iso).catch(() => null) };
}

async function newRound(): Promise<void> {
  round++;
  const current = prefetched ?? pickRound();
  prefetched = null;
  target = current.country;
  guessed = new Set();
  finished = false;
  attemptsEl.replaceChildren();
  resultEl.hidden = true;
  flagRoundEl.hidden = true;
  flagGridEl.replaceChildren();
  flagVerdictEl.textContent = '';
  form.hidden = false;
  input.value = '';
  hideSuggestions();
  await renderSilhouette(current.shape);
  // Con la ronda en marcha, se adelanta la descarga de la siguiente silueta.
  prefetched = pickRound();
  input.focus();
}

async function renderSilhouette(shapePromise: Promise<GeoGeometryObjects | null>): Promise<void> {
  const size = 320;
  const thisRound = round;
  shapeEl.replaceChildren();
  const shape = (await shapePromise) ?? (await loadShape(target.iso));
  if (thisRound !== round) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('role', 'img');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', silhouettePath(shape, target.centroid, size, size));
  svg.append(path);
  shapeEl.replaceChildren(svg);
}

function hideSuggestions(): void {
  suggestionsEl.hidden = true;
  suggestionsEl.replaceChildren();
  highlighted = -1;
}

function matches(query: string): Country[] {
  const q = normalize(query);
  if (!q) return [];
  const starts: Country[] = [];
  const contains: Country[] = [];
  for (const c of countries) {
    if (guessed.has(c.iso)) continue;
    const n = normalized.get(c)!;
    if (n.startsWith(q)) starts.push(c);
    else if (n.includes(q)) contains.push(c);
  }
  return [...starts, ...contains].slice(0, 8);
}

function showSuggestions(): void {
  const list = matches(input.value);
  if (!list.length) return hideSuggestions();
  suggestionsEl.replaceChildren(
    ...list.map((c, i) => {
      const li = document.createElement('li');
      li.textContent = c.name;
      li.classList.toggle('active', i === highlighted);
      li.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        submitGuess(c);
      });
      return li;
    }),
  );
  suggestionsEl.hidden = false;
}

function submitGuess(country: Country): void {
  if (finished || guessed.has(country.iso)) return;
  guessed.add(country.iso);
  input.value = '';
  hideSuggestions();

  const li = document.createElement('li');
  if (country.iso === target.iso) {
    li.className = 'hit';
    li.append(span('g-name', country.name), span('g-dir', '🎯'));
    attemptsEl.append(li);
    win();
    return;
  }
  const km = distanceKm(country.centroid, target.centroid);
  const arrow = ARROWS[Math.round(bearingDeg(country.centroid, target.centroid) / 45) % 8];
  const pct = Math.max(0, Math.round(100 * (1 - km / MAX_DISTANCE_KM)));
  li.append(
    span('g-name', country.name),
    span('g-km', `${km.toLocaleString('es')} km`),
    span('g-dir', arrow),
    span('g-pct', `${pct}%`),
  );
  attemptsEl.append(li);

  if (guessed.size >= MAX_ATTEMPTS) lose();
  else input.focus();
}

function win(): void {
  finished = true;
  form.hidden = true;
  resultEl.hidden = false;
  verdictEl.className = 'ok';
  verdictEl.textContent = `¡Es ${target.name}! Acertado en ${guessed.size} de ${MAX_ATTEMPTS}.`;
  startFlagRound();
}

function lose(): void {
  finished = true;
  form.hidden = true;
  resultEl.hidden = false;
  verdictEl.className = 'bad';
  verdictEl.textContent = `Era ${target.name} `;
  const flag = document.createElement('img');
  flag.className = 'mini-flag';
  flag.src = flagThumbUrl(target.iso);
  flag.alt = '';
  verdictEl.append(flag);
}

function startFlagRound(): void {
  flagRoundEl.hidden = false;
  flagGridEl.classList.remove('resolved');
  const sameContinent = countries.filter((c) => c.iso !== target.iso && c.continent === target.continent);
  const others = countries.filter((c) => c.iso !== target.iso && c.continent !== target.continent);
  const pool = shuffle(sameContinent).concat(shuffle(others));
  const options = shuffle([target, ...pool.slice(0, FLAG_OPTIONS - 1)]);

  flagGridEl.replaceChildren(
    ...options.map((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.iso = c.iso;
      const img = document.createElement('img');
      img.src = flagThumbUrl(c.iso);
      img.alt = 'bandera';
      img.loading = 'lazy';
      // El nombre queda oculto hasta resolver: antes delataría la respuesta.
      btn.append(img, span('flag-name', c.name));
      btn.addEventListener('click', () => pickFlag(btn, c));
      return btn;
    }),
  );
}

function pickFlag(btn: HTMLButtonElement, picked: Country): void {
  flagGridEl.classList.add('resolved');
  for (const b of flagGridEl.querySelectorAll('button')) {
    b.disabled = true;
    if (b.dataset.iso === target.iso) b.classList.add('ok');
  }
  if (picked.iso === target.iso) {
    flagVerdictEl.className = 'ok';
    flagVerdictEl.textContent = '¡Bandera correcta! Ronda perfecta.';
  } else {
    btn.classList.add('bad');
    flagVerdictEl.className = 'bad';
    flagVerdictEl.textContent = `No: esa es la de ${picked.name}.`;
  }
}

input.addEventListener('input', () => {
  highlighted = -1;
  showSuggestions();
});

input.addEventListener('keydown', (e) => {
  const items = suggestionsEl.querySelectorAll('li');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!items.length) return;
    highlighted = (highlighted + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((li, i) => li.classList.toggle('active', i === highlighted));
  } else if (e.key === 'Escape') {
    hideSuggestions();
  }
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const list = matches(input.value);
  if (!list.length) return;
  submitGuess(highlighted >= 0 ? list[highlighted] : list[0]);
});

input.addEventListener('blur', () => setTimeout(hideSuggestions, 150));

function showLoadError(err: unknown): void {
  shapeEl.textContent = 'No se pudieron cargar los datos. Recarga la página.';
  console.error(err);
}

againBtn.addEventListener('click', () => newRound().catch(showLoadError));

loadCountries()
  .then((all) => {
    countries = all;
    normalized = new Map(all.map((c) => [c, normalize(c.name)]));
    return newRound();
  })
  .catch(showLoadError);

if (import.meta.env.DEV) {
  Object.defineProperty(window, '__target', { get: () => target?.name });
}
