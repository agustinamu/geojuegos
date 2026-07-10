import { bearingDeg, distanceKm, loadShape, MAX_DISTANCE_KM, silhouetteSvg } from './geo';
import { flagThumbUrl, loadCountries } from './data';
import type { Country } from './data';
import type { GeoGeometryObjects } from 'd3-geo';
import { createCombobox, loadError, qs, shuffle, span } from './ui';

const MAX_ATTEMPTS = 6;
const FLAG_OPTIONS = 8;
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

const shapeEl = qs<HTMLDivElement>('#shape');
const form = qs<HTMLFormElement>('#guess-form');
const input = qs<HTMLInputElement>('#guess');
const suggestionsEl = qs<HTMLUListElement>('#suggestions');
const attemptsEl = qs<HTMLOListElement>('#attempts');
const resultEl = qs<HTMLElement>('#result');
const verdictEl = qs<HTMLParagraphElement>('#verdict');
const flagRoundEl = qs<HTMLDivElement>('#flag-round');
const flagGridEl = qs<HTMLDivElement>('#flag-grid');
const flagVerdictEl = qs<HTMLParagraphElement>('#flag-verdict');
const againBtn = qs<HTMLButtonElement>('#btn-again');

type Round = { country: Country; shape: Promise<GeoGeometryObjects | null> };

let countries: Country[] = [];
let target: Country;
let guessed = new Set<string>();
let finished = false;
let round = 0;
let prefetched: Round | null = null;

const combo = createCombobox({
  form,
  input,
  list: suggestionsEl,
  candidates: () => countries.filter((c) => !guessed.has(c.iso)),
  onPick: submitGuess,
});

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
  verdictEl.replaceChildren();
  verdictEl.className = '';
  form.hidden = false;
  combo.clear();
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
  shapeEl.replaceChildren(silhouetteSvg(shape, target.centroid, size));
}

function submitGuess(country: Country): void {
  if (finished || guessed.has(country.iso)) return;
  guessed.add(country.iso);

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
  flagGridEl.querySelector<HTMLButtonElement>('button')?.focus();
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
  againBtn.focus(); // el input queda oculto: sin esto el foco cae a body
}

function startFlagRound(): void {
  flagRoundEl.hidden = false;
  flagGridEl.classList.remove('resolved');
  const sameContinent = countries.filter((c) => c.iso !== target.iso && c.continent === target.continent);
  const others = countries.filter((c) => c.iso !== target.iso && c.continent !== target.continent);
  const pool = shuffle(sameContinent).concat(shuffle(others));
  const options = shuffle([target, ...pool.slice(0, FLAG_OPTIONS - 1)]);

  flagGridEl.replaceChildren(
    ...options.map((c, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.iso = c.iso;
      // Nombre accesible numerado: el real (span.flag-name) queda oculto
      // hasta resolver, así que sin esto las 8 opciones son indistinguibles.
      btn.setAttribute('aria-label', `Opción ${i + 1} de ${FLAG_OPTIONS}`);
      const img = document.createElement('img');
      img.src = flagThumbUrl(c.iso);
      img.alt = '';
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
    // El nombre ya es visible: el aria-label numerado dejaría de tener sentido.
    b.removeAttribute('aria-label');
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
  againBtn.focus(); // el botón enfocado se acaba de deshabilitar: sin esto el foco cae a body
}

function showLoadError(err: unknown): void {
  loadError(shapeEl, err);
}

againBtn.addEventListener('click', () => newRound().catch(showLoadError));

loadCountries()
  .then((all) => {
    countries = all;
    return newRound();
  })
  .catch(showLoadError);

if (import.meta.env.DEV) {
  Object.defineProperty(window, '__target', { get: () => target?.name });
}
