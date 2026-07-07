// Índice de países y rutas de datos. Sin dependencia de d3: los juegos que no
// proyectan geometría (Banderas) importan de aquí y no arrastran d3-geo.
export type LonLat = [number, number];

export interface Country {
  iso: string;
  name: string;
  continent: string;
  centroid: LonLat;
}

// Rutas relativas a la página: todos los juegos viven en /<juego>/, un nivel
// bajo la raíz (base './' en vite.config.ts).
export const flagUrl = (iso: string): string => `../flags/${iso}.svg`;
export const flagThumbUrl = (iso: string): string => `../flags/thumb/${iso}.webp`;

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar ${url}: ${res.status}`);
  return res;
}

export async function fetchJson<T>(url: string): Promise<T> {
  return (await fetchOk(url)).json() as Promise<T>;
}

export async function fetchText(url: string): Promise<string> {
  return (await fetchOk(url)).text();
}

export function loadCountries(): Promise<Country[]> {
  return fetchJson<Country[]>('../data/countries.json');
}
