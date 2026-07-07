// Helpers de UI compartidos entre juegos.
import type { Country } from './data';

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export interface ComboboxOpts {
  form: HTMLFormElement;
  input: HTMLInputElement;
  list: HTMLUListElement;
  candidates: () => Country[]; // ya filtrados: el juego decide exclusiones
  onPick: (c: Country) => void;
}

// Combobox con autocompletado sin acentos, navegación con flechas y clic.
export function createCombobox(opts: ComboboxOpts): { clear(): void } {
  const { form, input, list, candidates, onPick } = opts;
  let highlighted = -1;

  function matches(query: string): Country[] {
    const q = normalize(query);
    if (!q) return [];
    const starts: Country[] = [];
    const contains: Country[] = [];
    for (const c of candidates()) {
      const n = normalize(c.name);
      if (n.startsWith(q)) starts.push(c);
      else if (n.includes(q)) contains.push(c);
    }
    return [...starts, ...contains].slice(0, 8);
  }

  function hide(): void {
    list.hidden = true;
    list.replaceChildren();
    highlighted = -1;
  }

  function pick(c: Country): void {
    input.value = '';
    hide();
    onPick(c);
  }

  function show(): void {
    const items = matches(input.value);
    if (!items.length) return hide();
    list.replaceChildren(
      ...items.map((c, i) => {
        const li = document.createElement('li');
        li.textContent = c.name;
        li.classList.toggle('active', i === highlighted);
        li.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          pick(c);
        });
        return li;
      }),
    );
    list.hidden = false;
  }

  input.addEventListener('input', () => {
    highlighted = -1;
    show();
  });

  input.addEventListener('keydown', (e) => {
    const items = list.querySelectorAll('li');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      highlighted = (highlighted + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle('active', i === highlighted));
    } else if (e.key === 'Escape') {
      hide();
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const items = matches(input.value);
    if (!items.length) return;
    pick(highlighted >= 0 ? items[highlighted] : items[0]);
  });

  // El setTimeout deja ganar al pointerdown de una sugerencia frente al blur.
  input.addEventListener('blur', () => setTimeout(hide, 150));

  return {
    clear(): void {
      input.value = '';
      hide();
    },
  };
}
