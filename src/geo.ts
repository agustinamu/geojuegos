import { geoAzimuthalEqualArea, geoDistance, geoPath } from 'd3-geo';
import type { GeoGeometryObjects } from 'd3-geo';
import { fetchJson } from './data';
import type { LonLat } from './data';

// Sin re-export de data.ts: los juegos importan datos de './data' y solo los
// que proyectan geometría importan de aquí (y arrastran d3-geo).

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

const SVG_NS = 'http://www.w3.org/2000/svg';

// SVG cuadrado (viewBox size×size) con la silueta del país. Compartido por
// Siluetas y las ayudas de Viaje.
export function silhouetteSvg(shape: GeoGeometryObjects, centroid: LonLat, size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Silueta de país');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', silhouettePath(shape, centroid, size, size));
  svg.append(path);
  return svg;
}
