import { fetchText, flagUrl, loadCountries } from './data';
import type { Country } from './data';
import { createCombobox, loadError, qs, shuffle, span } from './ui';

const MAX_ATTEMPTS = 6;
const PANELS = 6; // rejilla 2×3

const flagBox = qs<HTMLDivElement>('#flag-box');
const flagImg = qs<HTMLImageElement>('#flag');
const coverEl = qs<HTMLDivElement>('#cover');
const form = qs<HTMLFormElement>('#guess-form');
const input = qs<HTMLInputElement>('#guess');
const suggestionsEl = qs<HTMLUListElement>('#suggestions');
const attemptsEl = qs<HTMLOListElement>('#attempts');
const verdictEl = qs<HTMLParagraphElement>('#verdict');
const resultEl = qs<HTMLElement>('#result');
const againBtn = qs<HTMLButtonElement>('#btn-again');

let countries: Country[] = [];
let target: Country;
let guessed = new Set<string>();
let finished = false;
let fails = 0;
let revealOrder: number[] = []; // permutación de [0..5], orden de destape
let panels: HTMLDivElement[] = [];
let round = 0; // token anti-carreras: cada await/setTimeout captura y compara

const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

const combo = createCombobox({
  form,
  input,
  list: suggestionsEl,
  candidates: () => countries.filter((c) => !guessed.has(c.iso)),
  onPick: submitGuess,
});

// Ratio real de la bandera parseando el SVG: varios (bd, dk, ki, no, uy) solo
// traen viewBox y naturalWidth mentiría; en np/qa width/height mandan.
// No inyectar el SVG en el DOM: alguno trae <style> con clases genéricas.
function flagRatio(svgText: string): number {
  const svg = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement;
  // Solo dimensiones absolutas: width="100%" parsearía como 100 y taparía al viewBox.
  const dim = (attr: string): number => {
    const v = svg.getAttribute(attr) ?? '';
    return v.includes('%') ? NaN : parseFloat(v);
  };
  const w = dim('width');
  const h = dim('height');
  if (w > 0 && h > 0) return w / h;
  const vb = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  if (vb && vb[2] > 0 && vb[3] > 0) return vb[2] / vb[3];
  return 3 / 2; // último recurso: deforma levemente, nunca destapa
}

// load/error clásicos: img.decode() se comporta irregular con SVG en Safari.
function loadImg(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    flagImg.onload = () => resolve();
    flagImg.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    flagImg.src = src;
  });
}

async function newRound(): Promise<void> {
  const thisRound = ++round;
  againBtn.disabled = true;
  document.querySelector('#confetti')?.remove();
  target = countries[Math.floor(Math.random() * countries.length)];
  guessed = new Set();
  fails = 0;
  finished = false;
  revealOrder = shuffle(Array.from({ length: PANELS }, (_, i) => i));
  // Reconstruir los paneles: quitar clases no basta con animaciones forwards.
  panels = Array.from({ length: PANELS }, () => {
    const d = document.createElement('div');
    d.className = 'panel';
    return d;
  });
  coverEl.replaceChildren(...panels);
  flagBox.classList.remove('won');
  flagBox.setAttribute('aria-label', 'Bandera oculta');
  attemptsEl.replaceChildren();
  verdictEl.textContent = '';
  verdictEl.className = '';
  resultEl.hidden = true;
  form.hidden = false;
  combo.clear();
  input.disabled = true; // sin intentos hasta que la bandera esté lista
  const url = flagUrl(target.iso);
  try {
    // Una sola descarga: el mismo texto da el ratio y, vía blob, la imagen.
    const svgText = await fetchText(url);
    if (thisRound !== round) return;
    flagBox.style.setProperty('--flag-ratio', String(flagRatio(svgText)));
    const blobUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    try {
      await loadImg(blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
    if (thisRound !== round) return;
  } catch (err) {
    if (thisRound !== round) return;
    verdictEl.className = 'bad';
    verdictEl.textContent = 'No se pudo cargar la bandera. Prueba otra ronda.';
    form.hidden = true;
    resultEl.hidden = false;
    againBtn.disabled = false;
    console.error(err);
    return;
  }
  input.disabled = false;
  input.focus();
}

function submitGuess(country: Country): void {
  if (finished || input.disabled || guessed.has(country.iso)) return;
  guessed.add(country.iso);
  const li = document.createElement('li');
  if (country.iso === target.iso) {
    li.className = 'hit';
    li.append(span('g-name', country.name), span('g-dir', '🎯'));
    attemptsEl.append(li);
    win();
    return;
  }
  li.append(span('g-name', country.name), span('g-dir bad', '✗'));
  attemptsEl.append(li);
  fails++;
  const r = round;
  // Capturar el panel ya: si el timeout leyera fails, dos fallos en <120ms
  // destaparían el mismo panel.
  const panel = panels[revealOrder[fails - 1]];
  // +120ms: primero se lee el fallo en la lista, luego llega la compensación.
  // La guarda de finished evita apilar 'abierto' sobre un panel que ya cae
  // con 'cae' si el acierto llega justo después del fallo.
  setTimeout(() => {
    if (r === round && !finished) panel.classList.add('abierto');
  }, 120);
  flagBox.setAttribute('aria-label', `Bandera oculta, ${fails} de ${PANELS} secciones descubiertas`);
  if (fails >= MAX_ATTEMPTS) lose();
  else input.focus();
}

function finishRound(cls: string, text: string): void {
  verdictEl.className = cls;
  verdictEl.textContent = text;
  flagBox.setAttribute('aria-label', `Bandera de ${target.name}`);
  resultEl.hidden = false;
  againBtn.disabled = false;
  againBtn.focus(); // el input queda oculto: sin esto el foco cae a body
}

function win(): void {
  finished = true;
  form.hidden = true;
  input.disabled = true;
  const restantes = panels.filter((p) => !p.classList.contains('abierto'));
  const texto = `¡Es ${target.name}! Acertado en ${guessed.size} de ${MAX_ATTEMPTS}.`;
  if (reduced()) {
    for (const p of restantes) p.classList.add('cae'); // CSS reduce: opacity 0 instantáneo
    finishRound('ok', texto);
    return;
  }
  restantes.forEach((p, i) => {
    p.style.setProperty('--rot', `${(Math.random() * 24 - 12).toFixed(1)}deg`);
    p.style.animationDelay = `${i * 80}ms`;
    p.classList.add('cae');
  });
  const r = round;
  setTimeout(() => {
    if (r === round) confeti();
  }, 250);
  const total = 80 * (restantes.length - 1) + 620;
  setTimeout(() => {
    if (r !== round) return;
    flagBox.classList.add('won');
    finishRound('ok', texto);
  }, total + 100);
}

// El 6º destape ya es la revelación; veredicto sobrio, sin ceremonia.
function lose(): void {
  finished = true;
  form.hidden = true;
  input.disabled = true;
  const r = round;
  const delay = reduced() ? 0 : 550;
  setTimeout(() => {
    if (r === round) finishRound('bad', `Era ${target.name}.`);
  }, delay);
}

const COLORS = ['#d2a14c', '#ece5d3', '#7fbf7f', '#d47d6a', '#8a6f3d'];

// Confeti con WAAPI: dos ráfagas desde las esquinas inferiores de la bandera.
function confeti(): void {
  const rect = flagBox.getBoundingClientRect();
  const box = document.createElement('div');
  box.id = 'confetti';
  document.body.append(box);
  for (let i = 0; i < 80; i++) {
    const p = document.createElement('span');
    const izq = i % 2 === 0;
    p.style.cssText =
      `left:${izq ? rect.left : rect.right}px;top:${rect.bottom}px;` +
      `width:${6 + Math.random() * 3}px;height:${10 + Math.random() * 5}px;` +
      `background:${COLORS[i % COLORS.length]};`;
    const dx = (izq ? 1 : -1) * (40 + Math.random() * rect.width * 0.9);
    const sube = -(140 + Math.random() * 220);
    const cae = 260 + Math.random() * 220;
    const giro = `rotate3d(1, ${(Math.random() * 0.8).toFixed(2)}, ${(Math.random() * 0.4).toFixed(2)}, ${(2 + Math.random() * 2).toFixed(1)}turn)`;
    p.animate(
      [
        { transform: 'translate(0,0)', opacity: 1, easing: 'cubic-bezier(0.17, 0.67, 0.35, 1)' },
        {
          transform: `translate(${dx * 0.6}px, ${sube}px)`,
          opacity: 1,
          offset: 0.35,
          easing: 'cubic-bezier(0.45, 0.03, 0.85, 0.55)',
        },
        { transform: `translate(${dx}px, ${cae}px) ${giro}`, opacity: 0 },
      ],
      { duration: 1300 + Math.random() * 700, fill: 'forwards' },
    );
    box.append(p);
  }
  setTimeout(() => box.remove(), 2200); // > duración máxima: se limpia solo
}

function showLoadError(err: unknown): void {
  verdictEl.className = 'bad';
  loadError(verdictEl, err);
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
