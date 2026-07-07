# Geojuegos

Juegos de geografía en ekain.amutxastegi.com/geojuegos/.

## Juegos

- **Siluetas** (`/siluetas/`): adivina el país por su forma en 6 intentos.
  Cada fallo indica distancia, dirección (flecha) y proximidad al país
  objetivo. Al acertar, ronda extra: elegir su bandera entre 8.
- **Banderas** (`/banderas/`): la bandera empieza tapada por 6 paneles (2×3);
  cada fallo destapa uno. Al acertar, cascada + confeti + ondeo; sin pistas de
  distancia. El ratio real se parsea del SVG (width/height → viewBox → 3/2).
- Próximos: Fronteras.

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

Los datos generados se versionan; el deploy (GitHub Actions → Pages) solo
ejecuta `npm run build`.

## Añadir un juego

1. Copiar `siluetas/index.html` a `<juego>/index.html` (mismo `<head>`;
   cambiar title, favicon y h1).
2. Crear `src/<juego>.ts` (importar de `geo.ts` lo que necesite).
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
