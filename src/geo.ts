import { geoAzimuthalEqualArea, geoDistance, geoPath } from 'd3-geo';
import type { GeoGeometryObjects } from 'd3-geo';

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

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

export function loadCountries(): Promise<Country[]> {
  return fetchJson<Country[]>('../data/countries.json');
}

// Silueta generada por scripts/build-shapes.mjs: GeometryCollection del país.
export function loadShape(iso: string): Promise<GeoGeometryObjects> {
  return fetchJson<GeoGeometryObjects>(`../shapes/${iso}.json`);
}

const EARTH_RADIUS_KM = 6371;
// Distancia máxima posible sobre la esfera (antípodas), para el % de proximidad.
export const MAX_DISTANCE_KM = Math.PI * EARTH_RADIUS_KM;

export function distanceKm(a: LonLat, b: LonLat): number {
  return Math.round(geoDistance(a, b) * EARTH_RADIUS_KM);
}

export function bearingDeg(from: LonLat, to: LonLat): number {
  const rad = Math.PI / 180;
  const [λ1, φ1] = [from[0] * rad, from[1] * rad];
  const [λ2, φ2] = [to[0] * rad, to[1] * rad];
  const Δλ = λ2 - λ1;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

export function silhouettePath(
  shape: GeoGeometryObjects,
  centroid: LonLat,
  width: number,
  height: number,
  margin = 12,
): string {
  // Azimutal centrada en el país: evita distorsión en latitudes altas y cortes en el antimeridiano.
  const projection = geoAzimuthalEqualArea().rotate([-centroid[0], -centroid[1]]);
  projection.fitExtent(
    [
      [margin, margin],
      [width - margin, height - margin],
    ],
    shape,
  );
  return geoPath(projection)(shape) ?? '';
}
