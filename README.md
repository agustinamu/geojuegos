# Geojuegos

Juegos de geografía en ekain.amutxastegi.com/geojuegos/.

## Juegos

- **Siluetas** (`/siluetas/`): adivina el país por su forma en 6 intentos.
  Cada fallo indica distancia, dirección (flecha) y proximidad al país
  objetivo. Al acertar, ronda extra: elegir su bandera entre 8.
- **Banderas** (`/banderas/`): la bandera empieza tapada por 6 paneles (2×3);
  cada fallo destapa uno. Al acertar, cascada + confeti + ondeo; sin pistas de
  distancia. El ratio real se parsea del SVG (width/height → viewBox → 3/2).
- **Viaje** (`/viaje/`): encadena países limítrofes por tierra de A a B;
  al llegar, veredicto contra el óptimo (BFS) — «camino más corto» o «+N países».
  Solo fronteras terrestres (las islas no son extremos; A y B en la misma
  componente conexa, óptimo en [2,6]). Mapa con zoom a la región A–B, pan/zoom
  táctil (rueda, arrastre, pinza) y revelado progresivo; 6 intentos, deshacer y
  3 ayudas (silueta del siguiente país, siluetas de vecinos, vecinos en el mapa).

## Datos

- `public/flags/` — banderas SVG copiadas del repo hermano
  [flagmaps](../flagmaps) + miniaturas WebP para las rondas de elección:
  `npm run sync:data`.
- `public/shapes/<iso>.json` + `public/data/countries.json` — siluetas por
  país desde Natural Earth 10m con simplificación adaptativa (~1200 vértices
  por país) e índice con nombre/continente/centroide: `npm run build:shapes`.
  - Microterritorios (<40 vértices en NE): se sustituyen por geometría OSM de
    [geoBoundaries](https://www.geoboundaries.org) (CC BY) o Nominatim
    (ODbL), descartando candidatos que incluyan aguas territoriales (área
    ≫ superficie real del Banco Mundial vía flagmaps).
  - Ojo: los GeoJSON se emiten con winding `gj2008` porque d3-geo no sigue
    RFC 7946; sin eso cada país se pinta como la esfera entera (y
    `geoCentroid` da el antípoda).
- `public/data/borders.json` — grafo de fronteras terrestres `{iso: [vecinos]}`
  desde [mledoze/countries](https://github.com/mledoze/countries) (cca3→alpha-2,
  filtrado a los isos de `countries.json`, simetría forzada): `npm run
  build:borders`. Verificable con `node scripts/verify-borders.mjs` (cobertura,
  simetría, componentes, pares jugables). Lo usa Viaje.
- `public/data/world.json` — TopoJSON (objeto `countries`, una geometría por
  `iso`) combinando `public/shapes/`, resimplificado (~40%) y cuantizado (1e5)
  para deduplicar arcos compartidos entre vecinos: `npm run build:world`. El
  cliente lo convierte con `feature()` de topojson-client (el winding `gj2008`
  de los shapes se conserva). Basemap/fuente de geometrías por país para el
  mapa de Viaje (que recorta cada país a su masa principal antes de
  encuadrar, para no estirar el zoom con territorios de ultramar).

Los datos generados se versionan; el deploy (GitHub Actions → Pages) solo
ejecuta `npm run build`.

## Añadir un juego

1. Copiar `siluetas/index.html` a `<juego>/index.html` (mismo `<head>`;
   cambiar title, favicon y h1).
2. Crear `src/<juego>.ts` y reutilizar los helpers compartidos: `qs`,
   `loadError`, `createCombobox`, `shuffle`, `span`, `normalize` (`ui.ts`);
   `silhouetteSvg`, `silhouettePath`, `loadShape`, `distanceKm` (`geo.ts`);
   `loadCountries`, `flagUrl`/`flagThumbUrl` (`data.ts`).
3. Registrar la página en `vite.config.ts` → `rollupOptions.input` (si se
   olvida, el build la omite sin dar error).
4. Activar la card en `index.html` (quitar la clase `soon`, convertir el
   `span` en `<a href="./<juego>/">`).
5. Estilos: reutilizar `body.game`; ids nuevos al final de `style.css` bajo
   un comentario `/* ——— <Juego> ——— */`.

## Desarrollo

```
npm install
npm run dev
```

Si se regenera `public/` (shapes, thumbs) con el dev server arrancado, la
caché de públicos de Vite se queda obsoleta: reiniciar `npm run dev`.
