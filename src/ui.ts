// Helpers de UI compartidos entre juegos.
import type { Country } from './data';

// querySelector tipado que falla ruidoso si el id no existe (mejor que `!`).
export function qs<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Elemento no encontrado: ${selector}`);
  return el;
}

// Mensaje de error de carga de datos, común a los juegos.
export function loadError(el: HTMLElement, err: unknown): void {
  el.textContent = 'No se pudieron cargar los datos. Recarga la página.';
  console.error(err);
}

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

  // Semántica ARIA del patrón combobox (cubre los tres juegos desde aquí).
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', list.id);
  list.setAttribute('role', 'listbox');

  function optionId(i: number): string {
    return `${list.id}-opt-${i}`;
  }

  // Sincroniza .active con aria-selected y aria-activedescendant.
  function setHighlight(i: number): void {
    highlighted = i;
    list.querySelectorAll('li').forEach((li, idx) => {
      const active = idx === i;
      li.classList.toggle('active', active);
      li.setAttribute('aria-selected', String(active));
    });
    if (i >= 0) input.setAttribute('aria-activedescendant', optionId(i));
    else input.removeAttribute('aria-activedescendant');
  }

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
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function pick(c: Country): void {
    input.value = '';
    hide();
    onPick(c);
  }

  function show(): void {
    const items = matches(input.value);
    if (!items.length) return hide();
    // items[0] resaltado: lo que Enter enviará por defecto siempre es visible.
    highlighted = 0;
    list.replaceChildren(
      ...items.map((c, i) => {
        const li = document.createElement('li');
        li.id = optionId(i);
        li.setAttribute('role', 'option');
        li.textContent = c.name;
        const active = i === highlighted;
        li.classList.toggle('active', active);
        li.setAttribute('aria-selected', String(active));
        li.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          pick(c);
        });
        return li;
      }),
    );
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', optionId(highlighted));
  }

  input.addEventListener('input', () => {
    show();
  });

  input.addEventListener('keydown', (e) => {
    const items = list.querySelectorAll('li');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      setHighlight((highlighted + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
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
